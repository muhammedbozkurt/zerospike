/**
 * lib/swipeAction.ts correctness harness. No jest, same standalone style as
 * scripts/postMealTimer.test.ts.
 *
 * Two device QA rounds are pinned here at once.
 *
 * FEEL: "azicik sola slide edince bile sil butonu geliyor" (barely a swipe
 * already reveals the delete panel), then "slide yeni hali daha kotu olmus"
 * about the attempt that answered it by making the gesture sluggish and
 * invisible. The answer is that the row tracks the finger 1:1 (natural) while
 * a SMALL DRAG CANNOT LATCH THE PANEL OPEN, so the button is never left
 * reachable. That is a claim about react-native-gesture-handler's release rule
 * rather than about a prop value, so section C runs a pure mirror of it.
 *
 * SIZE: "o sola slide isleminde maksimum %25'i kadar buyusun satirda" - the
 * panel is a quarter of the row it belongs to, measured, not a fixed 88pt. So
 * every derived number is now a function of that measured width, and section A
 * pins the rule against the real row widths this app ships on.
 *
 * Sections H/I guard both ends against drift: H re-reads
 * components/JournalItem.tsx to confirm the app measures the row and hands the
 * library these numbers, I re-reads the real library and native sources to
 * confirm the rule and the constants section C assumes. Passing here without
 * the app being wired this way is therefore not possible.
 *
 * Run: npx tsx scripts/swipeAction.test.ts
 */
declare const console: { log: (...a: unknown[]) => void };
declare const process: { exit: (code: number) => void };

import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  deleteActionWidth,
  estimateRowWidth,
  SWIPE_ACTION_MAX_W,
  SWIPE_ACTION_MIN_W,
  SWIPE_ACTION_RATIO,
  SWIPE_DRAG_OFFSET,
  SWIPE_DRAG_TOSS,
  SWIPE_FRICTION,
  SWIPE_ICON_FULL,
  SWIPE_ICON_IN,
  SWIPE_LABEL_FULL,
  SWIPE_LABEL_IN,
  SWIPE_OPEN_RATIO,
  SWIPE_ROW_INSET_ESTIMATE,
  swipeContentOffset,
  swipeFingerTravelToOpen,
  swipeIconOpacity,
  swipeLabelOpacity,
  swipeOpenThreshold,
  swipeReleaseOpens,
  swipeRevealedWidth,
} from "../lib/swipeAction";

let passed = 0;
let failed = 0;

function ok(name: string, cond: boolean, detail = ""): void {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.log(`  ✗ ${name}${detail ? ": " + detail : ""}`);
  }
}
function eq<T>(name: string, actual: T, expected: T): void {
  ok(name, actual === expected, `got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
}
function near(name: string, actual: number, expected: number, tol = 1e-9): void {
  ok(name, Math.abs(actual - expected) <= tol, `got ${actual}, want ~${expected}`);
}
function section(title: string): void {
  console.log(`\n${title}`);
}

const root = join(__dirname, "..");
const read = (rel: string): string => readFileSync(join(root, rel), "utf8");

/**
 * Real row widths: the swipeable's own box, i.e. the window minus the screen
 * and journal-panel padding (about 40pt together, see SWIPE_ROW_INSET_ESTIMATE).
 */
const DEVICES: { name: string; window: number; row: number; phone: boolean }[] = [
  { name: "Android mid 360", window: 360, row: 320, phone: true },
  { name: "iPhone SE / 13 mini 375", window: 375, row: 335, phone: true },
  { name: "iPhone standard 393", window: 393, row: 353, phone: true },
  { name: "iPhone Plus 430", window: 430, row: 390, phone: true },
  { name: "iPhone Pro Max 440", window: 440, row: 400, phone: true },
  { name: "iPad 768", window: 768, row: 728, phone: false },
  { name: "iPad wide 1024", window: 1024, row: 984, phone: false },
];
const PHONES = DEVICES.filter((d) => d.phone);
/** The longest of the nine "Delete" labels, fr "Supprimer", at 10pt bold. */
const LONGEST_LABEL_PX = 50;
/** The trash glyph the panel draws (JournalItem.tsx, size={18}). */
const ICON_PX = 18;

console.log("zerospike swipe action test");

section("A. the panel is a quarter of the row it is actually in");
{
  eq("the ratio device QA asked for", SWIPE_ACTION_RATIO, 0.25);
  for (const d of DEVICES) {
    ok(
      `${d.name}: panel never exceeds 25% of the row`,
      deleteActionWidth(d.row) <= d.row * 0.25
    );
    ok(
      `${d.name}: the floor does NOT engage, so "maximum 25%" is really 25%`,
      d.row * SWIPE_ACTION_RATIO > SWIPE_ACTION_MIN_W
    );
  }
  // On a phone the panel is the pure ratio and the ceiling is INERT: it has to
  // be, or capping tablets would have silently changed every phone too.
  for (const d of PHONES) {
    eq(
      `${d.name}: row ${d.row}pt -> panel is exactly a quarter`,
      deleteActionWidth(d.row),
      d.row * SWIPE_ACTION_RATIO
    );
    ok(
      `${d.name}: the ceiling does NOT engage on this phone`,
      d.row * SWIPE_ACTION_RATIO < SWIPE_ACTION_MAX_W
    );
  }
  ok(
    "the widest phone row still sits clear of the ceiling",
    Math.max(...PHONES.map((d) => d.row)) * SWIPE_ACTION_RATIO < SWIPE_ACTION_MAX_W
  );
  eq("the ceiling", SWIPE_ACTION_MAX_W, 112);
  // On a tablet it binds, which is the whole point: a 246pt delete button with
  // a 172pt pull is not a swipe, it is a haul.
  for (const d of DEVICES.filter((x) => !x.phone)) {
    eq(`${d.name}: row ${d.row}pt -> panel is capped`, deleteActionWidth(d.row), SWIPE_ACTION_MAX_W);
    ok(`${d.name}: the ratio really would have exceeded the cap`, d.row * SWIPE_ACTION_RATIO > SWIPE_ACTION_MAX_W);
    near(`${d.name}: the pull drops to a sane 78.4pt`, swipeOpenThreshold(deleteActionWidth(d.row)), 78.4);
  }
  // The floor exists only for a pane far narrower than any shipping device.
  ok("the floor sits below every real panel width", SWIPE_ACTION_MIN_W < Math.min(...DEVICES.map((d) => deleteActionWidth(d.row))));
  eq("a 287pt row (narrower than any phone) does hit the floor", deleteActionWidth(287), SWIPE_ACTION_MIN_W);
  eq("a 289pt row is already back on the ratio", deleteActionWidth(289), 289 * 0.25);
  ok("...and the floor still fits the 18pt trash glyph in its fade window", SWIPE_ICON_FULL * SWIPE_ACTION_MIN_W >= ICON_PX);
  eq("an unmeasured row (0) falls back to the floor, never to zero", deleteActionWidth(0), SWIPE_ACTION_MIN_W);
  eq("a negative width falls back to the floor", deleteActionWidth(-320), SWIPE_ACTION_MIN_W);
  eq("NaN falls back to the floor", deleteActionWidth(Number.NaN), SWIPE_ACTION_MIN_W);
}

section("B. the first-frame estimate lands on the real row width");
{
  eq("the inset used", SWIPE_ROW_INSET_ESTIMATE, 40);
  for (const d of DEVICES) {
    eq(`${d.name}: window ${d.window} -> row ${d.row}`, estimateRowWidth(d.window), d.row);
  }
  eq("a degenerate window never produces a negative row", estimateRowWidth(20), 20);
}

section("C. releasing a small drag does NOT leave the panel open, at any width");
{
  // The whole point of the feel fix. `false` means: the finger lifts, the row
  // springs shut, the delete button is gone before it could be tapped.
  for (const d of DEVICES) {
    const w = deleteActionWidth(d.row);
    eq(`${d.name}: a tenth of the panel`, swipeReleaseOpens(-w * 0.1, 0, false, w), false);
    eq(`${d.name}: a third of the panel`, swipeReleaseOpens(-w / 3, 0, false, w), false);
    eq(
      `${d.name}: HALF the panel, which the library's own default WOULD have opened`,
      swipeReleaseOpens(-w * 0.5, 0, false, w),
      false
    );
    eq(`${d.name}: just short of the threshold`, swipeReleaseOpens(-w * 0.69, 0, false, w), false);
    eq(
      `${d.name}: a small drag that tapers off (25% at -200px/s)`,
      swipeReleaseOpens(-w * 0.25, -200, false, w),
      false
    );
    eq(`${d.name}: dragging the wrong way`, swipeReleaseOpens(w * 0.9, 0, false, w), false);
  }
  ok(
    "the release threshold really is stricter than the library's half-a-panel default",
    SWIPE_OPEN_RATIO > 0.5
  );
}

section("D. a committed swipe still opens, and a flick still counts");
{
  for (const d of DEVICES) {
    const w = deleteActionWidth(d.row);
    eq(`${d.name}: past the threshold`, swipeReleaseOpens(-w * 0.71, 0, false, w), true);
    eq(`${d.name}: dragged fully out`, swipeReleaseOpens(-w, 0, false, w), true);
    // A flick is worth DRAG_TOSS * velocity px, i.e. 40pt at 800px/s, and that
    // is an ABSOLUTE amount - so state it as one. A release 20pt short of the
    // threshold closes on its own and opens with the flick, on every width.
    const shortOfIt = -(swipeOpenThreshold(w) - 20);
    eq(`${d.name}: 20pt short of the threshold, no flick, closes`, swipeReleaseOpens(shortOfIt, 0, false, w), false);
    eq(`${d.name}: the same release WITH a flick opens`, swipeReleaseOpens(shortOfIt, -800, false, w), true);
  }
  eq("the flick allowance is the library's own DRAG_TOSS, not an invention", SWIPE_DRAG_TOSS, 0.05);
  // The flick allowance is absolute px while the threshold used to grow with
  // the row, so an uncapped tablet eventually outran it and a flick stopped
  // opening the row at all. SWIPE_ACTION_MAX_W is what bounds the threshold and
  // keeps the flick meaningful on EVERY screen - pinned here, because this is
  // the property the cap exists to protect.
  const flickPx = SWIPE_DRAG_TOSS * 800;
  for (const d of DEVICES) {
    const w = deleteActionWidth(d.row);
    eq(`${d.name}: a 40% drag plus a flick opens`, swipeReleaseOpens(-w * 0.4, -800, false, w), true);
    ok(
      `${d.name}: a flick is worth at least half the required pull`,
      flickPx / swipeOpenThreshold(w) >= 0.5
    );
  }
  ok(
    "an UNCAPPED 984pt row would have broken that (the defect the cap closes)",
    swipeReleaseOpens(-(984 * 0.25) * 0.4, -800, false, 984 * 0.25) === false
  );
  const w = deleteActionWidth(353);
  let monotone = true;
  let opened = false;
  for (let d = 0; d <= 140; d += 1) {
    const o = swipeReleaseOpens(-d, 0, false, w);
    if (opened && !o) monotone = false;
    if (o) opened = true;
  }
  ok("dragging further never turns an opening release back into a closing one", monotone);
  ok("...and somewhere in that sweep it does open", opened);
}

section("E. the threshold is 70% of the MEASURED panel, not an absolute constant");
{
  eq("friction is 1: the row follows the finger exactly", SWIPE_FRICTION, 1);
  eq("the drag offset stays absolute (it describes a finger, not a screen)", SWIPE_DRAG_OFFSET, 16);
  ok("...and still clears the platform scroll thresholds (library default 10)", SWIPE_DRAG_OFFSET > 10);
  ok("...without being the 28pt dead zone that made it worse", SWIPE_DRAG_OFFSET < 28);
  for (const d of DEVICES) {
    const w = deleteActionWidth(d.row);
    near(`${d.name}: threshold is 70% of the panel`, swipeOpenThreshold(w), w * SWIPE_OPEN_RATIO);
    near(
      `${d.name}: finger travel to open = dead zone + threshold`,
      swipeFingerTravelToOpen(w),
      SWIPE_DRAG_OFFSET + w * SWIPE_OPEN_RATIO
    );
  }
  const narrow = swipeOpenThreshold(deleteActionWidth(320));
  const widestPhone = swipeOpenThreshold(deleteActionWidth(400));
  ok("a wider phone really does get a longer pull, so this is not a hidden constant", widestPhone > narrow);
  near("...and the pull is bounded by the ceiling, never unlimited", swipeOpenThreshold(deleteActionWidth(4000)), SWIPE_ACTION_MAX_W * SWIPE_OPEN_RATIO);
}

section("F. RTL (Arabic) is the exact mirror, never a second set of numbers");
{
  for (const d of DEVICES) {
    const w = deleteActionWidth(d.row);
    for (const [frac, vel] of [
      [0.1, 0],
      [0.5, 0],
      [0.71, 0],
      [0.4, 800],
      [1, 0],
    ] as [number, number][]) {
      eq(
        `${d.name}: RTL +${frac} @ ${vel} mirrors LTR -${frac} @ ${-vel}`,
        swipeReleaseOpens(w * frac, vel, true, w),
        swipeReleaseOpens(-w * frac, -vel, false, w)
      );
    }
    eq(`${d.name}: RTL wrong-way drag never opens`, swipeReleaseOpens(-w * 0.9, 0, true, w), false);
    near(`${d.name}: RTL uncovers the same width`, swipeRevealedWidth(w / 2, w), swipeRevealedWidth(-w / 2, w));
    near(
      `${d.name}: RTL shifts the content the other way by the same amount`,
      swipeContentOffset(w / 2, w, true),
      -swipeContentOffset(-w / 2, w, false)
    );
  }
}

section("G. how much panel is uncovered, and where the content sits");
{
  for (const d of DEVICES) {
    const w = deleteActionWidth(d.row);
    eq(`${d.name}: closed`, swipeRevealedWidth(0, w), 0);
    near(`${d.name}: dragged a quarter out`, swipeRevealedWidth(-w * 0.25, w), w * 0.25);
    eq(`${d.name}: dragged fully out`, swipeRevealedWidth(-w, w), w);
    eq(`${d.name}: clamped past its width`, swipeRevealedWidth(-w * 2, w), w);
    // The panel is pinned at the row's trailing edge at its FULL width and is
    // uncovered from that edge inwards. Content centred in the panel would be
    // clipped off-centre for the whole reveal; this is the property that stops
    // it: the content's centre sits in the middle of the uncovered strip at
    // every width.
    for (const frac of [0, 0.1, 0.25, 0.5, 0.7, 0.85, 1]) {
      const revealed = w * frac;
      near(
        `${d.name} @ ${frac}: LTR centre sits mid-strip`,
        w / 2 + swipeContentOffset(-revealed, w, false),
        w - revealed / 2
      );
      near(
        `${d.name} @ ${frac}: RTL centre sits mid-strip`,
        w / 2 + swipeContentOffset(revealed, w, true),
        revealed / 2
      );
    }
    eq(`${d.name}: fully open, content is back where layout put it`, swipeContentOffset(-w, w, false), 0);
  }
}

section("H. a narrow sliver shows red, then the icon, then the word");
{
  ok("the icon always leads the word", SWIPE_ICON_IN < SWIPE_LABEL_IN && SWIPE_ICON_FULL < SWIPE_LABEL_FULL);
  ok("the word is fully legible before the panel is even fully out", SWIPE_LABEL_FULL < 1);
  for (const d of DEVICES) {
    const w = deleteActionWidth(d.row);
    eq(`${d.name}: a 4% sliver shows red only, no clipped glyph`, swipeIconOpacity(-w * 0.04, w), 0);
    eq(`${d.name}: the icon is fully there by 25%`, swipeIconOpacity(-w * SWIPE_ICON_FULL, w), 1);
    ok(`${d.name}: and that strip really fits the 18pt glyph`, SWIPE_ICON_FULL * w >= ICON_PX);
    eq(`${d.name}: the word is absent at half a panel`, swipeLabelOpacity(-w * 0.5, w), 0);
    eq(`${d.name}: the word is fully there by 85%`, swipeLabelOpacity(-w * SWIPE_LABEL_FULL, w), 1);
    ok(
      `${d.name}: the word only starts once the strip fits fr "Supprimer" (~${LONGEST_LABEL_PX}pt)`,
      SWIPE_LABEL_IN * w >= LONGEST_LABEL_PX
    );

    let monotone = true;
    let leads = true;
    let prevIcon = -Infinity;
    let prevLabel = -Infinity;
    for (let r = 0; r <= w * 1.2; r += w / 200) {
      const i = swipeIconOpacity(-r, w);
      const l = swipeLabelOpacity(-r, w);
      if (i < prevIcon || l < prevLabel) monotone = false;
      if (l > i) leads = false;
      prevIcon = i;
      prevLabel = l;
    }
    ok(`${d.name}: both curves monotonic`, monotone);
    ok(`${d.name}: the word is never more visible than the icon above it`, leads);
    eq(`${d.name}: past full reveal the icon stays clamped`, swipeIconOpacity(-w * 3, w), 1);
    eq(`${d.name}: past full reveal the word stays clamped`, swipeLabelOpacity(-w * 3, w), 1);
  }
}

section("I. the app really measures the row and is wired to these numbers");
{
  const src = read("components/JournalItem.tsx");
  const has = (needle: string): boolean => src.indexOf(needle) !== -1;

  ok("the row measures its own width", has("onLayout={") && has("e.nativeEvent.layout.width"));
  ok("...only when a swipe can happen, so a plain row pays nothing", has("onDelete\n          ? (e) => {"));
  ok("...and a sub-pixel remeasure cannot loop setState", has("Math.abs(prev - w) < 0.5 ? prev : w"));
  ok("the first frame is seeded from the window, not from the floor", has("useWindowDimensions()") && has("estimateRowWidth(windowW)"));
  // ...and the estimate must stay a SEED. It is only ever right because the
  // inset happens to be ~40pt; a tablet split pane or a changed panel padding
  // breaks it, so the measurement has to win as soon as it arrives.
  ok(
    "the measured width overrides the estimate from the first layout onwards",
    has("const rowW = measuredRowW > 0 ? measuredRowW : estimateRowWidth(windowW);")
  );
  ok("the panel width is derived, never a literal", has("const actionW = deleteActionWidth(rowW);"));
  ok("the fixed 88pt panel is gone for good", src.indexOf("DELETE_ACTION_W") === -1);
  // DEVICE QA, third round: this guard used to pin the literal
  // `{ width: actionWidth, flex: 1 }` - which was the bug, so nothing could
  // catch it. The library's action layer is a `flexDirection: "row-reverse"`
  // container, and in a ROW `flex: 1` grows along the MAIN axis while its
  // `flexBasis: 0%` overrides `width` outright: the red panel spanned the whole
  // row and the library measured that full span as the open distance. The
  // cross-axis property is what was wanted, so the guard now asserts stretch
  // AND that flex is not back on this view.
  const panelView = '<View style={{ width: actionWidth, alignSelf: "stretch" }}>';
  ok("the panel is drawn at the derived width", has(panelView));
  ok("...as a PLAIN View, so a partial reveal can never be a see-through hole", has(panelView));
  ok(
    "...and never with flex, which in the library's row container eats the width",
    src.indexOf("{{ width: actionWidth, flex:") === -1 &&
      src.indexOf("{{ flex: 1, width: actionWidth") === -1
  );
  ok("the release threshold is derived from that same width", has("const openThreshold = swipeOpenThreshold(actionW);"));
  ok(
    "...and handed to whichever edge the reading direction uses",
    has("leftThreshold={I18nManager.isRTL ? openThreshold : undefined}") &&
      has("rightThreshold={I18nManager.isRTL ? undefined : openThreshold}")
  );
  ok("friction is passed, not defaulted", has("friction={SWIPE_FRICTION}"));
  ok(
    "the drag offset is applied to BOTH edges",
    has("dragOffsetFromLeftEdge={SWIPE_DRAG_OFFSET}") && has("dragOffsetFromRightEdge={SWIPE_DRAG_OFFSET}")
  );
  ok(
    "every curve is driven off `translation` AND the measured width",
    has("swipeIconOpacity(translation.value, actionWidth)") &&
      has("swipeLabelOpacity(translation.value, actionWidth)") &&
      has("swipeContentOffset(translation.value, actionWidth, isRTL)")
  );
  ok("the width reaches the panel as a prop", has("actionWidth={actionW}"));
  ok(`the trash glyph is still the ${ICON_PX}pt one sized for above`, has(`name="trash-outline" size={${ICON_PX}}`));
  ok(
    "overshoot stays off on the side that renders",
    has("overshootLeft={I18nManager.isRTL ? false : undefined}") &&
      has("overshootRight={I18nManager.isRTL ? undefined : false}")
  );
  ok(
    "RTL still reveals from the leading edge",
    has("? { renderLeftActions: revealDelete }") && has(": { renderRightActions: revealDelete }")
  );
  ok("no onDelete means no Swipeable is mounted at all", has("if (!onDelete) return row;"));
  ok(
    "the panel geometry the earlier device QA fixed is untouched",
    has("borderTopLeftRadius: RADIUS.lg, borderTopRightRadius: RADIUS.lg") &&
      has("{ borderRadius: 13, marginBottom: 9 }") &&
      has("flex: 1,")
  );
  ok("the row is still memoized on its props alone", has("export const JournalItem = React.memo(JournalItemBase);"));
}

section("J. the library and native sources still work the way section C assumes");
{
  const lib = read(
    "node_modules/react-native-gesture-handler/src/components/ReanimatedSwipeable/ReanimatedSwipeable.tsx"
  );
  const libHas = (needle: string): boolean => lib.indexOf(needle) !== -1;

  ok("DRAG_TOSS is still 0.05", libHas("const DRAG_TOSS = 0.05;"));
  ok("the library's own friction default is still 1", libHas("const DEFAULT_FRICTION = 1;"));
  ok("the library's own drag offset default is still 10", libHas("const DEFAULT_DRAG_OFFSET = 10;"));
  ok(
    "the release rule is still (drag + DRAG_TOSS * velocity) / friction",
    libHas("const translationX = (userDrag.value + DRAG_TOSS * velocityX) / friction;")
  );
  ok(
    "...compared against rightThreshold, defaulting to half the panel",
    libHas("const rightThresholdProp = rightThreshold ?? rightWidth.value / 2;") &&
      libHas("} else if (translationX < -rightThresholdProp) {")
  );
  ok(
    "...and against leftThreshold on the mirrored side",
    libHas("const leftThresholdProp = leftThreshold ?? leftWidth.value / 2;") &&
      libHas("if (translationX > leftThresholdProp) {")
  );
  ok(
    "friction still divides the row's visible travel too",
    libHas("const offsetDrag = userDrag.value / friction + startOffset;")
  );
  ok(
    "the action layer is still all-or-nothing, so a faded fill would be a hole",
    libHas("opacity: showRightProgress.value === 0 ? 0 : 1,")
  );
  ok(
    "the drag offset is still the pan's activeOffsetX",
    libHas(".activeOffsetX([-dragOffsetFromRightEdge, dragOffsetFromLeftEdge])")
  );
  // The panel's width is now a moving target, so this one carries the change:
  // the library re-measures the action at the START of every gesture, which is
  // what lets a re-laid-out row (rotation, tablet split) use its new width with
  // no extra wiring on our side.
  ok(
    "the library re-measures the action on every gesture start",
    libHas(".onStart(updateElementWidths)") &&
      libHas("const rightLayout = measure(rightLayoutRef);")
  );
  ok(
    "vertical panning is still declared as the scroller's, not the row's",
    libHas('<GestureDetector gesture={panGesture} touchAction="pan-y">')
  );
  ok(
    "tapping an open row still closes it before anything else",
    libHas(".enabled(shouldEnableTap)") && libHas("if (rowState.value !== 0) {")
  );

  // The claim that the drag offset is a DEAD ZONE (nothing moves, then the row
  // starts from zero) rather than a jump: both native handlers reset the pan
  // translation at the moment they activate.
  const ios = read("node_modules/react-native-gesture-handler/apple/Handlers/RNPanHandler.m");
  ok(
    "iOS zeroes the pan translation on activation",
    ios.indexOf("[self setTranslation:CGPointMake(0, 0) inView:self.view];") !== -1
  );
  const android = read(
    "node_modules/react-native-gesture-handler/android/src/main/java/com/swmansion/gesturehandler/core/PanGestureHandler.kt"
  );
  const activateBlock = /override fun activate\(force: Boolean\) \{[\s\S]*?\n  \}/.exec(android);
  ok(
    "Android resets the pan's start point on activation",
    activateBlock !== null && activateBlock[0].indexOf("resetProgress()") !== -1
  );
  ok(
    "...and resetProgress really is 'start over from here'",
    /override fun resetProgress\(\) \{\s*startX = lastX/.test(android)
  );
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
