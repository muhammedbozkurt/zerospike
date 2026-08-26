/**
 * Pure geometry/feel for JournalItem's swipe-to-delete gesture (components/
 * JournalItem.tsx). No react-native import here on purpose, same reason as
 * lib/postMealCardLayout.ts: the react-native-gesture-handler and reanimated
 * runtimes cannot be imported from a plain Node/tsx test, so the numbers a
 * test actually needs to pin live here instead of only existing as inline
 * values inside the component.
 *
 * The panel's width is NOT a constant. It is a share of the row that is
 * actually on screen (see SWIPE_ACTION_RATIO), so every number derived from it
 * - the release threshold, the reveal curves, the content centring - takes an
 * `actionWidth` argument rather than reading a module-level width. A phone and
 * a tablet get proportionally the same gesture, not the same absolute one.
 *
 * WHAT THE LIBRARY ACTUALLY DOES (read before touching any constant below;
 * line numbers are node_modules/react-native-gesture-handler/src/components/
 * ReanimatedSwipeable/ReanimatedSwipeable.tsx):
 *
 * - :118  `offsetDrag = userDrag / friction` - `friction` divides the row's
 *         travel, so anything above 1 makes the row move SLOWER than the
 *         finger for the whole gesture.
 * - :438  `translationX = (userDrag + DRAG_TOSS * velocityX) / friction`, then
 *         :444 compares it against `rightThreshold`. So `friction` divides the
 *         RELEASE decision too: doubling friction doubles the finger distance
 *         needed to commit, on top of halving the visual travel.
 * - :506  `activeOffsetX([-dragOffsetFromRightEdge, dragOffsetFromLeftEdge])`.
 *         Both platforms ZERO the pan translation at the moment the gesture
 *         activates (iOS apple/Handlers/RNPanHandler.m:185
 *         `[self setTranslation:CGPointMake(0, 0) ...]`; Android
 *         android/.../core/PanGestureHandler.kt:228-233 `activate()` calls
 *         `resetProgress()` which does `startX = lastX`). The drag offset is
 *         therefore a literal DEAD ZONE: the row does not move at all for that
 *         many points of finger travel, and there is no catch-up jump either.
 * - :402  the library's own action wrapper is `opacity: progress === 0 ? 0 : 1`
 *         and the container is `overflow: hidden` with NO background of its
 *         own (:604). So anything that makes the action's own content
 *         transparent while the row is translated does not hide the action, it
 *         punches a HOLE: the row slides away and the page background shows
 *         through where the red should be.
 * - :285  `updateElementWidths()` re-measures the action on every gesture
 *         start, so a panel whose width changed since the last swipe (rotation,
 *         tablet, a re-laid-out row) is picked up without any extra wiring.
 *
 * Device QA history, and why the numbers are what they are:
 *   1. Library defaults (friction 1, offset 10, threshold half the panel, panel
 *      revealed 1:1 from the first pixel) drew the panel with broken geometry
 *      (taller than the row, square corners). Verdict "azicik sola slide edince
 *      bile sil butonu geliyor". The geometry was the defect; the tracking was
 *      not.
 *   2. friction 2 + offset 28 + a reveal held fully transparent below 45%
 *      progress. Measured against the library source above that means: 28pt of
 *      nothing, then 79pt more of finger travel before ANY red appears (with a
 *      see-through gap where the row used to be for all of it), first paint at
 *      107pt of travel, full opacity at 204pt, and 134pt of travel to commit.
 *      Verdict "daha kotu".
 *
 * The fix is therefore neither of those levers. The row tracks the finger 1:1
 * and the red is painted from the first moved pixel (natural, familiar, and no
 * hole); what changed is the RELEASE rule - a small drag springs shut, so the
 * button can never be left sitting there to be tapped.
 */

/**
 * The panel's share of the row it belongs to. Device QA asked for the delete
 * action to grow to "maksimum %25'i kadar" of the row, so this is a proportion
 * and a ceiling at once: the panel is never wider than a quarter of the row on
 * any screen, and on a wider screen it grows with the row instead of staying a
 * fixed stub. SWIPE_ACTION_MAX_W then caps it a second time for tablets, which
 * is a stricter bound than "a quarter", never a looser one.
 */
export const SWIPE_ACTION_RATIO = 0.25;

/**
 * Absolute ceiling for the panel, in px. The ratio alone is right for a phone
 * and wrong for a tablet: a 984pt row would give a 246pt delete button and,
 * worse, a 172pt pull to open it. The library's flick allowance is an ABSOLUTE
 * px amount (DRAG_TOSS seconds of release velocity, about 40pt at 800px/s), so
 * a threshold that grows without bound eventually outruns it and a flick stops
 * opening the row at all - the gesture quietly turns into a long haul on
 * exactly the screens with the most room to swipe in.
 *
 * 112 is chosen so it can never touch a phone: the widest phone row this app
 * renders is about 400pt (Pro Max), whose quarter is 100pt, so every phone
 * stays on the pure ratio and behaves exactly as it did before this cap
 * existed. It engages only on tablets and wide split layouts, where it holds
 * the pull at 78.4pt and keeps the flick working. Same discipline as
 * SWIPE_ACTION_MIN_W below: a bound that must be provably inert on real
 * phones, and scripts/swipeAction.test.ts pins that device by device.
 */
export const SWIPE_ACTION_MAX_W = 112;

/**
 * Absolute floor for the panel, in px. Only a guard for a pathologically
 * narrow row (an iPad Slide Over pane, a small Android multi-window split) -
 * below about 288pt of row, a quarter would no longer fit the 18pt trash glyph
 * inside its own fade-in window (SWIPE_ICON_FULL of the panel must stay >= 18,
 * and 0.25 * 72 is exactly 18).
 *
 * It must never engage on a real phone or tablet, or the "maximum 25%" promise
 * would be broken by the floor itself; the narrowest row this app renders on a
 * shipping device is about 320pt, whose quarter is 80pt, clear of this.
 * scripts/swipeAction.test.ts pins that for every device width it lists.
 */
export const SWIPE_ACTION_MIN_W = 72;

/**
 * The panel's width for a row this wide. `rowWidth` is the measured width of
 * the swipeable's own box, not the window: an in-panel journal row and a
 * free-standing card carry different insets, and both differ again on a tablet.
 *
 * A non-positive or NaN width (a row that has not been laid out yet, a garbled
 * measurement) falls back to the floor rather than to zero: a zero-width panel
 * would make the library's own `rightWidth` zero, which silently turns the
 * whole gesture off. The floor is the smallest width still guaranteed to draw
 * a usable action.
 */
export function deleteActionWidth(rowWidth: number): number {
  "worklet";
  if (!(rowWidth > 0)) return SWIPE_ACTION_MIN_W;
  const w = rowWidth * SWIPE_ACTION_RATIO;
  if (w < SWIPE_ACTION_MIN_W) return SWIPE_ACTION_MIN_W;
  return w > SWIPE_ACTION_MAX_W ? SWIPE_ACTION_MAX_W : w;
}

/**
 * Typical horizontal inset between the window and a journal row's own box:
 * the screen padding plus the journal panel's padding. Only used for the very
 * first frame, before onLayout has reported the real number.
 */
export const SWIPE_ROW_INSET_ESTIMATE = 40;

/**
 * A first-frame stand-in for the row width, from the window width. The row
 * reports its real width through onLayout one frame later and that measurement
 * wins from then on; this only exists so the first paint is approximately
 * right instead of a floor-width stub that visibly resizes.
 */
export function estimateRowWidth(windowWidth: number): number {
  const w = windowWidth - SWIPE_ROW_INSET_ESTIMATE;
  return w > 0 ? w : windowWidth;
}

/**
 * `friction`: 1 means the row follows the finger exactly (ReanimatedSwipeable
 * .tsx:118 divides the drag by it). This is the library default and the iOS
 * table-row behaviour, and it is deliberately NOT raised: friction also
 * divides the release comparison at :438, so raising it buys nothing that
 * SWIPE_OPEN_RATIO does not buy more honestly, while costing the 1:1 tracking
 * that makes the gesture feel like a gesture instead of a lagging animation.
 */
export const SWIPE_FRICTION = 1;

/**
 * How far (px) the finger travels horizontally before the pan gesture claims
 * the touch. A dead zone, not a delay (see the RNPanHandler/PanGestureHandler
 * note above): nothing moves until it is crossed, and the row starts from zero
 * once it is. Applied to BOTH edges so the same horizontal intent is required
 * whichever way the finger goes.
 *
 * The library's own default is 10, which sits right on top of the platform
 * scroll thresholds and lets a nearly-vertical drag inside the FlatList claim
 * the row instead of the list. 16 clears them without ever being long enough
 * to read as unresponsiveness (28 was, which is what killed attempt 2).
 *
 * Absolute, not proportional: it describes a finger and a scroll threshold,
 * both of which are the same size on every screen.
 */
export const SWIPE_DRAG_OFFSET = 16;

/**
 * `rightThreshold` (`leftThreshold` in RTL) as a fraction of the action's own
 * width: how far the panel must be pulled out before LETTING GO leaves it open
 * instead of springing shut. The library's own default is half (0.5).
 *
 * This is the whole fix. The panel still follows the finger from the first
 * pixel, exactly like iOS Mail, but the user has to pull 70% of it out and
 * then release to make it stay - so "azicik" (barely) sliding shows a red
 * sliver that immediately springs back, and the delete button is never left
 * reachable. It also raises the bar in the other direction (:456, an open row
 * needs the same fraction dragged back to close), which is why tapping the row
 * to close it stays wired up as the easy way out.
 */
export const SWIPE_OPEN_RATIO = 0.7;

/**
 * `DRAG_TOSS`, ReanimatedSwipeable.tsx:38 - the library adds this many seconds
 * of the release velocity to the drag before testing it against the threshold,
 * so a deliberate flick opens the row without dragging the full distance.
 * Mirrored here (not configurable) so swipeReleaseOpens below models the real
 * rule rather than a simplified one.
 */
export const SWIPE_DRAG_TOSS = 0.05;

/**
 * The release threshold in px for a panel this wide, i.e. what the component
 * hands the library. Proportional by construction: a wider row gets a wider
 * panel and a proportionally longer pull, so the gesture feels identical
 * across screen sizes rather than easier on a tablet.
 */
export function swipeOpenThreshold(actionWidth: number): number {
  return actionWidth * SWIPE_OPEN_RATIO;
}

/**
 * Does releasing here LATCH THE PANEL OPEN? A pure mirror of
 * ReanimatedSwipeable.tsx:435-447 for a closed row, using the exact constants
 * the component hands the library, so a test can state the property the device
 * QA is about ("a small swipe does not leave the button sitting there")
 * against the real rule instead of against a prop value.
 *
 * `dragPx` is the signed pan translation measured from the moment the gesture
 * activated (negative = swiping left). LTR reveals the action on the right, so
 * it opens on a negative drag; RTL mirrors the whole thing.
 */
export function swipeReleaseOpens(
  dragPx: number,
  velocityPxPerSec: number,
  isRTL: boolean,
  actionWidth: number
): boolean {
  const settled = (dragPx + SWIPE_DRAG_TOSS * velocityPxPerSec) / SWIPE_FRICTION;
  const threshold = swipeOpenThreshold(actionWidth);
  return isRTL ? settled > threshold : settled < -threshold;
}

/**
 * Total finger travel (px, from touch-down) a steady drag with no flick needs
 * before releasing latches the panel open: the dead zone, plus the threshold
 * scaled back up through friction. The single number that describes how
 * deliberate the gesture has to be.
 */
export function swipeFingerTravelToOpen(actionWidth: number): number {
  return SWIPE_DRAG_OFFSET + swipeOpenThreshold(actionWidth) * SWIPE_FRICTION;
}

/**
 * How much of the panel is actually uncovered, in px, given the library's
 * `translation` SharedValue (its `appliedTranslation`: negative while the row
 * is dragged left, positive in RTL). Clamped to the panel's own width because
 * the component turns overshoot off.
 */
export function swipeRevealedWidth(translation: number, actionWidth: number): number {
  "worklet";
  const w = translation < 0 ? -translation : translation;
  return w > actionWidth ? actionWidth : w;
}

/**
 * The panel is absolutely positioned at the row's trailing edge at its FULL
 * width and gets uncovered from that edge inwards, so content centred in the
 * panel would spend the whole reveal clipped off-centre (in LTR you would see
 * the right half of the trash can first, then the rest). This shifts the
 * content to stay centred in the UNCOVERED strip instead, which is what iOS
 * does and what makes a narrow sliver look deliberate rather than cropped.
 *
 * Sign: LTR uncovers the strip at the panel's right end, so the content moves
 * right; RTL uncovers the left end, so it moves left. React Native does not
 * mirror `transform: translateX` for RTL, hence the explicit branch.
 */
export function swipeContentOffset(
  translation: number,
  actionWidth: number,
  isRTL: boolean
): number {
  "worklet";
  const hidden = (actionWidth - swipeRevealedWidth(translation, actionWidth)) / 2;
  return isRTL ? -hidden : hidden;
}

/** Reveal fraction (0..1) at which the trash icon starts/finishes fading in. */
export const SWIPE_ICON_IN = 0.08;
export const SWIPE_ICON_FULL = 0.25;

/**
 * Reveal fraction (0..1) at which the word "Delete" starts/finishes fading in.
 *
 * SWIPE_LABEL_IN is set so the uncovered strip is already wide enough to hold
 * the longest of the nine labels at the moment the first pixel of the word
 * shows, on the NARROWEST row the app renders: French "Supprimer" (ahead of
 * German "Loeschen" and Spanish "Eliminar") runs about 50pt at 10pt bold, and
 * 0.65 of the narrowest real panel (80pt) is 52pt. The word is therefore never
 * both visible and clipped, at any width. Everything here is a fraction of the
 * panel rather than an absolute px count, so the same holds as the panel grows.
 */
export const SWIPE_LABEL_IN = 0.65;
export const SWIPE_LABEL_FULL = 0.85;

function ramp(value: number, start: number, end: number): number {
  "worklet";
  if (value <= start) return 0;
  if (value >= end) return 1;
  return (value - start) / (end - start);
}

/**
 * The trash icon's opacity as the panel uncovers. Zero only for the first few
 * points, where an 18pt glyph centred in a narrower strip could only ever show
 * a horizontal slice of itself; full well before the panel is half out. The
 * red fill itself is NOT faded - it is painted the instant the row moves, or
 * the reveal would be a see-through hole (ReanimatedSwipeable.tsx:402/:604,
 * and attempt 2's actual defect).
 */
export function swipeIconOpacity(translation: number, actionWidth: number): number {
  "worklet";
  return ramp(
    swipeRevealedWidth(translation, actionWidth) / actionWidth,
    SWIPE_ICON_IN,
    SWIPE_ICON_FULL
  );
}

/**
 * The label's opacity, on the same input but a later window: the word has to
 * fit the uncovered strip before it appears at all, or a narrow sliver shows a
 * couple of clipped letters. Below that the panel is a trash icon on red,
 * which is unambiguous on its own.
 *
 * This, swipeIconOpacity, swipeContentOffset, swipeRevealedWidth and
 * deleteActionWidth all carry a `"worklet"` directive: JournalItem.tsx calls
 * them straight from a `useAnimatedStyle` callback (Reanimated's Babel plugin
 * needs the directive to run a function referenced from a worklet on the UI
 * thread) so the component's real animation and the numbers
 * scripts/swipeAction.test.ts pins can never drift apart - the directive is an
 * inert string literal outside Reanimated's transform, so the plain tsx test is
 * unaffected.
 */
export function swipeLabelOpacity(translation: number, actionWidth: number): number {
  "worklet";
  return ramp(
    swipeRevealedWidth(translation, actionWidth) / actionWidth,
    SWIPE_LABEL_IN,
    SWIPE_LABEL_FULL
  );
}
