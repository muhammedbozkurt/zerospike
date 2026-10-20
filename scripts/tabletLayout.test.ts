declare const console: { log: (...a: unknown[]) => void };
declare const process: { exit: (code: number) => void };
import {
  HOME_LEFT,
  HOME_RIGHT,
  SHEET_MAX_WIDTH,
  TABLET_SHEET_MAX_HEIGHT,
  TWO_COL_MAX_WIDTH,
  balancedSplit,
  columnContentWidth,
  columnWidth,
  fillColumn,
  homeGrow,
  isTwoColumn,
  isWideScreen,
  sheetBoxStyle,
  sheetVisibleHeight,
  sheetWidth,
  tabletSheetHeight,
} from "../lib/tabletLayout";
import { sheetLayout } from "../lib/sheetLayout";

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

// Home split: ring + week + journal left; counter, strip, basal, tiles right.
eq("left ids", HOME_LEFT.map((b) => b.id), ["hero", "week", "journal"]);
eq(
  "right has no left block",
  HOME_RIGHT.some((b) => HOME_LEFT.some((l) => l.id === b.id)),
  false
);
eq("right ids", HOME_RIGHT.map((b) => b.id), [
  "postMeal",
  "widgetTip",
  "spike",
  "context",
  "basal",
  "quick",
  "setup",
]);
eq("grow lookup", homeGrow("quick"), 2);
eq("left blocks do not grow", homeGrow("journal"), 0);

// Fill: spare height is shared by weight; a column taller than the viewport scrolls.
{
  const r = fillColumn(
    [
      { id: "a", height: 100, grow: 1 },
      { id: "b", height: 100, grow: 0 },
      { id: "c", height: 100, grow: 3 },
    ],
    700,
    10
  );
  // natural 300 + 20 gaps = 320, spare 380: a +95, c +285
  eq("fill heights", r.heights, [195, 100, 385]);
  eq("fill no leftover", r.leftover, 0);
  eq("fill total", r.heights.reduce((s, h) => s + h, 0) + 20, 700);
}
eq("fill overflow", fillColumn([{ id: "a", height: 900, grow: 1 }], 700, 0).heights, [900]);
eq("fill no grow keeps leftover", fillColumn([{ id: "a", height: 100, grow: 0 }], 700, 0).leftover, 600);

// Balanced split: order kept, difference minimal.
eq("split even", balancedSplit([100, 100, 100, 100]), 2);
eq("split big first", balancedSplit([300, 100, 100, 100]), 1);
eq("split empty", balancedSplit([]), 0);
eq("split single tie keeps all right", balancedSplit([50]), 0);

// Sheet width: min(560, window - 2*16).
eq("sheet 1032", sheetWidth(1032), 560);
eq("sheet 800", sheetWidth(800), 560);
eq("sheet 600", sheetWidth(600), 560);
eq("sheet 576 edge", sheetWidth(576), 544);
eq("sheet 400", sheetWidth(400), 368);
eq("sheet cap constant", SHEET_MAX_WIDTH, 560);
eq("sheet box phone", sheetBoxStyle(390, false), undefined);
eq("sheet box tablet", sheetBoxStyle(1032, true), { width: 560, alignSelf: "center" });

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
