declare const console: { log: (...a: unknown[]) => void };
declare const process: { exit: (code: number) => void };
import {
  DIALOG_MAX_WIDTH,
  DIALOG_MIN_WIDTH,
  HOME_BLOCK_ESTIMATE,
  SHEET_MAX_WIDTH,
  TABLET_CARD_GAP,
  TABLET_SHEET_MAX_HEIGHT,
  TWO_COL_MAX_WIDTH,
  columnContentWidth,
  columnWidth,
  dialogWidth,
  estimateJournalHeight,
  isDialogSheet,
  isTwoColumn,
  isWideScreen,
  sheetBoxStyle,
  sheetVisibleHeight,
  sheetWidth,
  splitHomeColumns,
  stackColumn,
  stackHeight,
  tabletSheetHeight,
} from "../lib/tabletLayout";
import * as layout from "../lib/tabletLayout";
import { SPACE } from "../lib/theme/tokens";
import { dialogHeights, sheetFrame, sheetLayout } from "../lib/sheetLayout";

let bad = 0;
let n = 0;
function eq(label: string, got: unknown, want: unknown) {
  n++;
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    bad++;
    console.log(`FAIL ${label}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
  }
}

// Column threshold: 699 one column, 700 two (height tall enough to be wide).
eq("699 one", isTwoColumn(699, 1200), false);
eq("700 two", isTwoColumn(700, 1200), true);
eq("phone portrait", isTwoColumn(390, 844), false);
eq("phone landscape is not wide", isTwoColumn(932, 430), false);
eq("7in portrait 600", isTwoColumn(600, 960), false);
eq("7in landscape 960x600", isTwoColumn(960, 600), true);
eq("10in portrait 800", isTwoColumn(800, 1280), true);
eq("ipad 13 portrait", isTwoColumn(1032, 1376), true);
eq("ipad 13 landscape", isTwoColumn(1376, 1032), true);
eq("wide at 600", isWideScreen(600, 960), true);
eq("not wide at 599", isWideScreen(599, 960), false);

// Column widths: capped body, even halves, gutters removed.
eq("col width 800", columnWidth(800), 400);
eq("col content 800", columnContentWidth(800), 368);
eq("col content 1032", columnContentWidth(1032), 484);
eq("col content 1376 capped", columnContentWidth(1376), 560);
eq("body cap", TWO_COL_MAX_WIDTH, 1184);

// Home split: the cut between the columns follows the heights, never fixed ids.
{
  // Old fixed split (ring+week+journal | cards), natural heights, gap 12:
  // before = 450 + 560 + 12 = 1022 vs 494 (52% apart). Journal 7 rows = 560.
  const movable = [450, 170, 84, 64, 140]; // ring+week, post-meal, context, basal, tiles
  const journal7 = estimateJournalHeight(7);
  eq("journal estimate 7 rows", journal7, 560);
  const before = { left: stackHeight([450, journal7], 12), right: stackHeight([170, 84, 64, 140], 12) };
  eq("before left", before.left, 1022);
  eq("before right", before.right, 494);
  const s7 = splitHomeColumns(movable, journal7, { gap: 12 });
  eq("7 rows cut", s7.leftCount, 3);
  eq("7 rows left", s7.left, 728);
  eq("7 rows right", s7.right, 788);
  eq("7 rows imbalance < 15%", s7.imbalance < 0.15, true);
  const s15 = splitHomeColumns(movable, estimateJournalHeight(15), { gap: 12 });
  eq("15 rows keeps ring+cards left", s15.leftCount, 5);
  eq("15 rows imbalance < 15%", s15.imbalance < 0.15, true);
  const s2 = splitHomeColumns(movable, estimateJournalHeight(2), { gap: 12 });
  eq("2 rows imbalance not worse than fixed split", s2.imbalance <= Math.abs(before.left - before.right) / before.left, true);
  // Every cut is considered: best never worse than any other cut.
  for (const j of [0, 126, 300, 560, 1056]) {
    const best = splitHomeColumns(movable, j, { gap: 12 });
    let min = Infinity;
    for (let k = 0; k <= movable.length; k++) {
      const l = stackHeight(movable.slice(0, k), 12);
      const r = stackHeight([...movable.slice(k), j], 12);
      min = Math.min(min, Math.abs(l - r));
    }
    eq(`best cut for journal ${j}`, Math.abs(best.left - best.right), min);
  }
  // Order is kept: the left column is a prefix; journal is always on the right.
  eq("left is a prefix count", s7.leftCount >= 0 && s7.leftCount <= movable.length, true);
  // Hysteresis: a kept cut stays unless the best one gains more than 24 pt.
  const keep = splitHomeColumns([100, 10, 100], 100, { gap: 0, current: 1 });
  eq("hysteresis keeps near-equal cut", keep.leftCount, 1);
  const move = splitHomeColumns([100, 100, 100], 100, { gap: 0, current: 3 });
  eq("hysteresis moves a clearly worse cut", move.leftCount, 2);
  eq("invalid current ignored", splitHomeColumns([100, 100], 100, { current: 9 }).leftCount, 1);
  eq("zero-height block adds no gap", stackHeight([0, 50, 0, 50], 12), 112);
  eq("empty movable", splitHomeColumns([], 300, { gap: 12 }).leftCount, 0);
  eq("default block estimate", HOME_BLOCK_ESTIMATE, 140);
}

// No stretching: the grow weights and the fill / balance helpers are gone.
for (const name of ["fillColumn", "balancedSplit", "homeGrow"]) {
  eq(`no ${name}`, name in layout, false);
}

// Fixed gap equals the card bottom margin the dashboard cards carry.
eq("gap constant", TABLET_CARD_GAP, 12);
eq("gap equals SPACE.md", TABLET_CARD_GAP, SPACE.md);

// Stack: top-aligned, natural heights untouched, fixed gap between blocks.
{
  const heights = [170, 84, 64, 140, 120];
  const r = stackColumn(heights);
  eq("stack tops", r.tops, [0, 182, 278, 354, 506]);
  eq("stack total", r.total, 626);
  eq("stack total = sum + gaps", r.total, heights.reduce((s, h) => s + h, 0) + TABLET_CARD_GAP * 4);
  eq("stack gaps constant", r.tops.slice(1).map((t, i) => t - (r.tops[i] + heights[i])), [12, 12, 12, 12]);
  eq("stack first at top", r.tops[0], 0);
}
eq("stack empty", stackColumn([]), { tops: [], total: 0 });
eq("stack single", stackColumn([90]), { tops: [0], total: 90 });
// Short column vs tall viewport: nothing grows, the stack just ends early.
eq("stack ignores viewport", stackColumn([100, 100], 12).total, 212);
eq("stack custom gap", stackColumn([10, 10], 5).tops, [0, 15]);

// Sheet width: min(560, window - 2*16).
eq("sheet 1032", sheetWidth(1032), 560);
eq("sheet 800", sheetWidth(800), 560);
eq("sheet 600", sheetWidth(600), 560);
eq("sheet 576 edge", sheetWidth(576), 544);
eq("sheet 400", sheetWidth(400), 368);
eq("sheet cap constant", SHEET_MAX_WIDTH, 560);
eq("sheet box phone", sheetBoxStyle(390, false), undefined);
eq("sheet box tablet without height keeps the old box", sheetBoxStyle(1032, true), { width: 560, alignSelf: "center" });
eq("phone with height still undefined", sheetBoxStyle(390, false, 844), undefined);

// Centred dialog sheet (>= 700 wide): width 560..680, height 50%..85%.
{
  const devices: [string, number, number, number, number][] = [
    // name, w, h, width, [min,max] below
    ["iPad 13 portrait", 1032, 1376, 619, 0],
    ["iPad 13 landscape", 1376, 1032, 680, 0],
    ["iPad mini", 744, 1133, 560, 0],
    ["Android 10 portrait", 800, 1280, 560, 0],
  ];
  for (const [name, w, h, width] of devices) {
    eq(`${name} is dialog`, isDialogSheet(w, h), true);
    eq(`${name} width`, dialogWidth(w), width);
    eq(`${name} width in band`, dialogWidth(w) >= DIALOG_MIN_WIDTH && dialogWidth(w) <= DIALOG_MAX_WIDTH, true);
    const hh = dialogHeights(h);
    eq(`${name} min 50%`, hh.minHeight, Math.floor(h * 0.5));
    eq(`${name} max 85%`, hh.maxHeight, Math.floor(h * 0.85));
    const box = sheetBoxStyle(w, true, h);
    eq(`${name} box centred`, [box?.alignSelf, box?.marginTop, box?.marginBottom], ["center", "auto", "auto"]);
    eq(`${name} box heights`, [box?.minHeight, box?.maxHeight], [hh.minHeight, hh.maxHeight]);
  }
  eq("iPad 13 min/max pt", [dialogHeights(1376).minHeight, dialogHeights(1376).maxHeight], [688, 1169]);
  eq("iPad mini min/max pt", [dialogHeights(1133).minHeight, dialogHeights(1133).maxHeight], [566, 963]);
  eq("Android 10 min/max pt", [dialogHeights(1280).minHeight, dialogHeights(1280).maxHeight], [640, 1088]);
  // 7in portrait (600x960) is not a dialog: the old 560 bottom sheet stays.
  eq("7in portrait not dialog", isDialogSheet(600, 960), false);
  eq("7in portrait old box", sheetBoxStyle(600, true, 960), { width: 568 > 560 ? 560 : 568, alignSelf: "center" });
  // 7in landscape (960x600) is a dialog; 50..85% of 600.
  eq("7in landscape dialog", isDialogSheet(960, 600), true);
  eq("7in landscape min/max", [dialogHeights(600).minHeight, dialogHeights(600).maxHeight], [300, 510]);
  eq("7in landscape width", dialogWidth(960), 576);
  // Phone landscape is not wide: no dialog.
  eq("phone landscape no dialog", isDialogSheet(932, 430), false);
  // 699 wide wide-screen stays the old box, 700 flips.
  eq("699 old box", sheetBoxStyle(699, true, 1200)?.width, 560);
  eq("700 dialog", sheetBoxStyle(700, true, 1200)?.marginTop, "auto");
  // Keyboard up (iPad 13, 420 pt keyboard, status bar 24): max follows the room.
  const open = dialogHeights(1376, 1376 - 420, 48);
  eq("keyboard max", open.maxHeight, 908);
  eq("keyboard min stays 50%", open.minHeight, 688);
  const tight = dialogHeights(600, 600 - 300, 48);
  eq("tight: min follows max down", tight.minHeight <= tight.maxHeight, true);
  eq("tight max", tight.maxHeight, 252);
  // Frame-only box (surface false): no radius or border.
  eq("surface false", sheetBoxStyle(1032, true, 1376, undefined, false)?.borderRadius, undefined);
  eq("surface default", sheetBoxStyle(1032, true, 1376)?.borderRadius, 26);
  // sheetFrame in dialog mode: phone untouched, dialog centred and below insets.
  const phone = sheetFrame({ hostHeight: 844, windowHeight: 844, lift: 0, keyboardOpen: false, insetTop: 47, insetBottom: 34, contentHeight: 300 });
  eq("phone frame unchanged", [Math.round(phone.sheetMaxHeight * 10), phone.sheetMinHeight, Math.round(phone.sheetTop * 10)], [7173, 0, 1267]);
  const ipad = sheetFrame({ hostHeight: 1376, windowHeight: 1376, lift: 0, keyboardOpen: false, insetTop: 24, insetBottom: 20, contentHeight: 200, dialog: true });
  eq("ipad frame max/min", [ipad.sheetMaxHeight, ipad.sheetMinHeight], [1169, 688]);
  eq("ipad frame top centred", ipad.sheetTop, (1376 - 1169) / 2);
  eq("ipad frame top below inset", ipad.sheetTop >= 24, true);
  const ipadKb = sheetFrame({ hostHeight: 1376, windowHeight: 1376, lift: 420, keyboardOpen: true, insetTop: 24, insetBottom: 20, contentHeight: 900, dialog: true });
  eq("ipad keyboard top below inset", ipadKb.sheetTop >= 24, true);
  eq("ipad keyboard max", ipadKb.sheetMaxHeight, 908);
  eq("ipad keyboard bottom above keyboard", ipadKb.sheetTop + ipadKb.sheetMaxHeight <= 1376 - 420, true);
  const small = sheetFrame({ hostHeight: 600, windowHeight: 600, lift: 300, keyboardOpen: true, insetTop: 24, insetBottom: 0, contentHeight: 900, dialog: true });
  eq("7in landscape keyboard top below inset", small.sheetTop >= 24, true);
  eq("small min <= max", small.sheetMinHeight <= small.sheetMaxHeight, true);
}

// Sheet height stays inside the visible area.
eq("visible", sheetVisibleHeight(1376, 24, 20), 1324);
eq("tablet capped", tabletSheetHeight(1376, 24, 20, 0.92, true), TABLET_SHEET_MAX_HEIGHT);
eq("tablet small screen follows ratio", Math.round(tabletSheetHeight(960, 24, 0, 0.92, true)), 883);
eq("phone bounded by visible area", Math.round(tabletSheetHeight(844, 47, 34, 0.92, false)), 755);
eq("tablet never above visible", tabletSheetHeight(700, 100, 100, 1, true) <= 700 - 200, true);

// insetTop is optional in sheetLayout: omitting it keeps the old numbers.
eq(
  "sheetLayout legacy",
  sheetLayout({ windowHeight: 1000, keyboardHeight: 0, insetBottom: 20, contentHeight: 0 }).sheetMaxHeight,
  900
);
eq(
  "sheetLayout with top inset",
  sheetLayout({ windowHeight: 1000, keyboardHeight: 0, insetBottom: 20, insetTop: 100, contentHeight: 0 })
    .sheetMaxHeight,
  810
);

if (bad) process.exit(1);
console.log(`ok ${n} cases`);
