/**
 * Geometry render of the tablet layout: NOT a device capture. It lays the
 * dashboard, the food tab and a bottom sheet out with the app's own pure
 * layout functions (lib/tabletLayout: column threshold, column widths, home
 * split, fixed card gap and top stacking, sheet width and height;
 * lib/sheetLayout) and the
 * theme palettes, into SVG, and rasterises it with rsvg-convert. Block heights
 * are representative natural heights (the real cards depend on data); the
 * columns, widths, gaps and sheet box are the real arithmetic. Cards are never
 * stretched, the columns are not forced to equal height, and the whole page is
 * one scroll: content past the viewport is clipped here the way it scrolls.
 *
 * Run: npx tsx scripts/tabletLayoutRender.ts <outDir>
 * Output per device and theme: tab-<device>-<light|dark>.svg / .png, three
 * panels side by side: home, food, sheet over home.
 */
declare const process: { argv: string[] };
declare const console: { log: (...a: unknown[]) => void };

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";

import { dialogHeights, sheetLayout } from "../lib/sheetLayout";
import {
  COLUMN_GUTTER,
  SHEET_MAX_WIDTH,
  TABLET_CARD_GAP,
  TWO_COL_MAX_WIDTH,
  columnWidth,
  isDialogSheet,
  isTwoColumn,
  sheetBoxStyle,
  sheetWidth,
  stackColumn,
  tabletSheetHeight,
} from "../lib/tabletLayout";
import { PALETTES, type Palette } from "../lib/theme/tokens";

const FONT = "Helvetica, Arial, sans-serif";
const f2 = (n: number): string => (Math.round(n * 100) / 100).toString();

type Device = { key: string; label: string; w: number; h: number; top: number; bottom: number };
const DEVICES: Device[] = [
  { key: "ipad13-portrait", label: "iPad 13in portrait 1032x1376 pt", w: 1032, h: 1376, top: 24, bottom: 20 },
  { key: "ipad13-landscape", label: "iPad 13in landscape 1376x1032 pt", w: 1376, h: 1032, top: 24, bottom: 20 },
  { key: "android10", label: "Android 10in 800x1280 pt", w: 800, h: 1280, top: 24, bottom: 48 },
  { key: "android7", label: "Android 7in 600x960 pt (under 700: one column)", w: 600, h: 960, top: 24, bottom: 48 },
];

const SCALE = 0.42;
const TITLE_H = 56;
const GAP = 16;
const CTA_FOOTPRINT = 8 + 13 * 2 + 24 + 10;
const RADIUS = 16;

type Box = { x: number; y: number; w: number; h: number; label: string; sub?: string; kind?: "card" | "accent" | "row"; top?: boolean };

function rect(p: Palette, b: Box): string {
  const fill = b.kind === "accent" ? p.accentFill : p.surfaceRaised;
  const op = b.kind === "accent" ? 0.22 : 1;
  const stroke = b.kind === "accent" ? p.accent : p.borderStrong;
  let o = `<rect x="${f2(b.x)}" y="${f2(b.y)}" width="${f2(Math.max(0, b.w))}" height="${f2(Math.max(0, b.h))}" rx="${b.kind === "row" ? 8 : RADIUS}" fill="${fill}" fill-opacity="${op}" stroke="${stroke}" stroke-opacity="0.55" stroke-width="1"/>`;
  const cy = b.top ? b.y + 28 : b.y + b.h / 2;
  o += `<text x="${f2(b.x + b.w / 2)}" y="${f2(b.h > 60 && !b.top ? cy : cy + 5)}" text-anchor="middle" font-family="${FONT}" font-size="15" font-weight="700" fill="${p.text}">${b.label}</text>`;
  if (b.sub && b.h > 60) {
    o += `<text x="${f2(b.x + b.w / 2)}" y="${f2(cy + 20)}" text-anchor="middle" font-family="${FONT}" font-size="12" fill="${p.textMuted}">${b.sub}</text>`;
  }
  return o;
}

function screenFrame(p: Palette, d: Device): string {
  let o = `<rect x="0" y="0" width="${d.w}" height="${d.h}" fill="${p.bg}"/>`;
  o += `<rect x="0" y="0" width="${d.w}" height="${d.top}" fill="${p.text}" fill-opacity="0.07"/>`;
  o += `<rect x="0" y="${d.h - d.bottom}" width="${d.w}" height="${d.bottom}" fill="${p.text}" fill-opacity="0.07"/>`;
  return o;
}

function cta(p: Palette, d: Device, colX: number, colW: number): string {
  const y = d.h - d.bottom - 10 - 50;
  return `<rect x="${f2(colX)}" y="${f2(y)}" width="${f2(colW)}" height="50" rx="25" fill="${p.accentFill}"/><text x="${f2(colX + colW / 2)}" y="${f2(y + 31)}" text-anchor="middle" font-family="${FONT}" font-size="16" font-weight="700" fill="${p.accentOnFill}">+ Add record</text>`;
}

/** Natural heights of the dashboard's right-column cards (representative). */
const RIGHT_NATURAL: Record<string, { h: number; label: string; kind?: Box["kind"] }> = {
  postMeal: { h: 170, label: "Post-meal counter", kind: "accent" },
  context: { h: 84, label: "Active insulin | Next reminder" },
  basal: { h: 64, label: "Basal status" },
  quick: { h: 140, label: "Insights | Health" },
  setup: { h: 120, label: "Finish setup" },
};

function home(p: Palette, d: Device): { svg: string; note: string } {
  const two = isTwoColumn(d.w, d.h);
  let o = screenFrame(p, d);
  const bodyW = Math.min(d.w, TWO_COL_MAX_WIDTH);
  const bodyX = (d.w - bodyW) / 2;
  const colTop = d.top + TITLE_H + 8;
  const colBottom = d.h - d.bottom;
  const viewport = colBottom - colTop - CTA_FOOTPRINT;
  o += `<text x="${f2((two ? bodyX : 0) + COLUMN_GUTTER)}" y="${f2(d.top + 38)}" font-family="${FONT}" font-size="26" font-weight="800" fill="${p.text}">Today</text>`;
  if (two) {
    const cw = columnWidth(d.w);
    const lx = bodyX + COLUMN_GUTTER;
    const rx = bodyX + cw + COLUMN_GUTTER;
    const inner = cw - COLUMN_GUTTER * 2;
    // Left column: ring, week boxes, then the daily flow as plain rows (the
    // preview slice is at most 15 rows over 2 days), all at natural height.
    const leftH = [250, 200, 56 + 7 * 62 + 70];
    const left = stackColumn(leftH, TABLET_CARD_GAP);
    o += rect(p, { x: lx, y: colTop + left.tops[0], w: inner, h: leftH[0], label: "Ring (today average)", sub: "hero" });
    o += rect(p, { x: lx, y: colTop + left.tops[1], w: inner, h: leftH[1], label: "This week boxes", sub: "week" });
    const fy = colTop + left.tops[2];
    o += rect(p, { x: lx, y: fy, w: inner, h: leftH[2], label: "Daily flow (journal)", top: true });
    for (let i = 0; i < 7; i++) {
      o += rect(p, { x: lx + 12, y: fy + 56 + i * 62, w: inner - 24, h: 52, label: `entry ${i + 1}`, kind: "row" });
    }
    const keys = ["postMeal", "context", "basal", "quick", "setup"];
    const heights = keys.map((k) => RIGHT_NATURAL[k].h);
    const right = stackColumn(heights, TABLET_CARD_GAP);
    keys.forEach((k, i) => {
      const meta = RIGHT_NATURAL[k];
      o += rect(p, { x: rx, y: colTop + right.tops[i], w: inner, h: heights[i], label: meta.label, sub: `natural ${heights[i]} pt`, kind: meta.kind ?? "card" });
    });
    o += cta(p, d, bodyX + COLUMN_GUTTER, bodyW - COLUMN_GUTTER * 2);
    return { svg: o, note: `2 cols, one scroll; left ${f2(left.total)}, right ${f2(right.total)} pt, gap ${TABLET_CARD_GAP}` };
  }
  // One column (phone order): hero, week, right-column cards, journal.
  const colW = Math.min(d.w, 680) - 32;
  const x = (d.w - colW) / 2;
  let y = colTop;
  const stack: [string, number, Box["kind"]?][] = [
    ["Ring (today average)", 250],
    ["This week boxes", 200],
    ["Post-meal counter", 170, "accent"],
    ["Active insulin | Next reminder", 84],
    ["Basal status", 64],
    ["Insights | Health", 140],
    ["Daily flow (journal)", 600],
  ];
  for (const [label, h, kind] of stack) {
    if (y > d.h) break;
    o += rect(p, { x, y, w: colW, h: Math.min(h, colBottom - y), label, kind: kind ?? "card" });
    y += h + GAP;
  }
  o += cta(p, d, x, colW);
  return { svg: o, note: "one column (same order as the phone)" };
}

function food(p: Palette, d: Device): { svg: string; note: string } {
  const two = isTwoColumn(d.w, d.h);
  let o = screenFrame(p, d);
  const bodyW = Math.min(d.w, TWO_COL_MAX_WIDTH);
  const colTop = d.top + 8;
  const colBottom = d.h - d.bottom - 12;
  const viewport = colBottom - colTop;
  if (!two) {
    const colW = Math.min(d.w, 680) - 32;
    const x = (d.w - colW) / 2;
    let y = colTop;
    for (const [label, h] of [["Title + create meal", 120], ["Daily carbs hero", 140], ["Search", 56], ["Today", 260], ["Templates", 260], ["Recent", 200], ["Categories", 400]] as [string, number][]) {
      if (y > d.h) break;
      o += rect(p, { x, y, w: colW, h: Math.min(h, colBottom - y), label });
      y += h + GAP;
    }
    return { svg: o, note: "one column" };
  }
  const cw = columnWidth(d.w);
  const bodyX = (d.w - bodyW) / 2;
  const inner = cw - COLUMN_GUTTER * 2;
  const lx = bodyX + COLUMN_GUTTER;
  const rx = bodyX + cw + COLUMN_GUTTER;
  const leftH = [110, 52, 200, 420];
  const left = stackColumn(leftH, TABLET_CARD_GAP);
  const leftLabels = ["Title + create meal", "Search", "Recent foods", "Categories grid"];
  leftH.forEach((h, i) => {
    o += rect(p, { x: lx, y: colTop + left.tops[i], w: inner, h, label: leftLabels[i], top: i === 3 });
  });
  const rightH = [150, 44, 270, 270];
  const right = stackColumn(rightH, TABLET_CARD_GAP);
  const rightLabels = ["Daily carbs hero", "Carb ratio", "Today", "Templates"];
  rightH.forEach((h, i) => {
    o += rect(p, { x: rx, y: colTop + right.tops[i], w: inner, h, label: rightLabels[i], sub: `natural ${h} pt` });
  });
  return { svg: o, note: `2 cols, one scroll; left ${f2(left.total)}, right ${f2(right.total)} pt, gap ${TABLET_CARD_GAP}` };
}

function sheetOverHome(p: Palette, d: Device, which: "meal" | "estimate"): { svg: string; note: string } {
  const wide = Math.min(d.w, d.h) >= 600;
  let o = home(p, d).svg;
  o += `<rect x="0" y="0" width="${d.w}" height="${d.h}" fill="#000" fill-opacity="0.5"/>`;
  const dialog = isDialogSheet(d.w, d.h);
  const box = sheetBoxStyle(d.w, wide, d.h);
  const sw = box ? box.width : d.w;
  const sx = (d.w - sw) / 2;
  // Meal compose: full allowance, tablet cap. Estimate: hugs its content.
  const dh = dialogHeights(d.h, d.h - d.top - d.bottom);
  const mealH = dialog ? dh.maxHeight : Math.floor(tabletSheetHeight(d.h, d.top, d.bottom, 0.92, wide));
  const estContent = 560;
  const est = sheetLayout({ windowHeight: d.h, keyboardHeight: 0, insetBottom: d.bottom, insetTop: d.top, contentHeight: estContent }).sheetMaxHeight;
  const estH = dialog ? Math.max(dh.minHeight, Math.min(dh.maxHeight, 240)) : Math.floor(Math.min(est, estContent + 40));
  const drawSheet = (x: number, w: number, h: number, title: string, sub: string): string => {
    const y = dialog ? (d.h - h) / 2 : d.h - h;
    let s = `<rect x="${f2(x)}" y="${f2(y)}" width="${f2(w)}" height="${f2(h)}" rx="26" fill="${p.surfaceRaised}" stroke="${p.borderStrong}" stroke-width="1"/>`;
    s += `<rect x="${f2(x + w / 2 - 19)}" y="${f2(y + 10)}" width="38" height="4" rx="2" fill="${p.borderStrong}"/>`;
    s += `<text x="${f2(x + 18)}" y="${f2(y + 44)}" font-family="${FONT}" font-size="17" font-weight="800" fill="${p.text}">${title}</text>`;
    const rows = Math.max(0, Math.floor((h - 150) / 66));
    for (let i = 0; i < rows; i++) {
      s += `<rect x="${f2(x + 16)}" y="${f2(y + 62 + i * 66)}" width="${f2(w - 32)}" height="54" rx="12" fill="${p.surface}" stroke="${p.border}"/>`;
    }
    const bottomPad = dialog ? 0 : d.bottom;
    s += `<rect x="${f2(x + 16)}" y="${f2(y + h - bottomPad - 16 - 50)}" width="${f2(w - 32)}" height="50" rx="25" fill="${p.accentFill}"/>`;
    s += `<text x="${f2(x + w / 2)}" y="${f2(y + h - bottomPad - 16 - 19)}" text-anchor="middle" font-family="${FONT}" font-size="13" font-weight="700" fill="${p.accentOnFill}">${sub}</text>`;
    return s;
  };
  if (which === "meal") {
    o += drawSheet(sx, sw, mealH, "Meal compose", `${f2(sw)} x ${mealH} pt, scrolls inside`);
  } else {
    o += drawSheet(sx, sw, estH, "Carb estimate", `${f2(sw)} x ${estH} pt, hugs content`);
  }
  const h = which === "meal" ? mealH : estH;
  return {
    svg: o,
    note: dialog
      ? `dialog w ${f2(sw)}, h ${h} (min ${dh.minHeight}, max ${dh.maxHeight}), top ${f2((d.h - h) / 2)} >= ${d.top}`
      : `w min(${SHEET_MAX_WIDTH},${d.w}-32)=${f2(sheetWidth(d.w))}, h ${h}, top ${f2(d.h - h)} >= ${d.top}`,
  };
}

function render(p: Palette, d: Device): string {
  const panels = [home(p, d), food(p, d), sheetOverHome(p, d, "meal"), sheetOverHome(p, d, "estimate")];
  const titles = ["Home", "Food", "Meal compose sheet", "Carb estimate sheet"];
  const pw = d.w * SCALE;
  const ph = d.h * SCALE;
  const pad = 24;
  const W = pad + panels.length * (pw + pad);
  const H = ph + 118;
  let o = `<svg xmlns="http://www.w3.org/2000/svg" width="${f2(W)}" height="${f2(H)}" viewBox="0 0 ${f2(W)} ${f2(H)}">`;
  o += `<rect width="${f2(W)}" height="${f2(H)}" fill="${p.scheme === "dark" ? "#05090d" : "#cfd6da"}"/>`;
  o += `<text x="${pad}" y="26" font-family="${FONT}" font-size="15" font-weight="700" fill="${p.scheme === "dark" ? "#e8eef2" : "#14212a"}">${d.label} | ${p.scheme} | geometry render, not a device capture</text>`;
  panels.forEach((pn, i) => {
    const x = pad + i * (pw + pad);
    o += `<g transform="translate(${f2(x)} 40) scale(${SCALE})"><svg width="${d.w}" height="${d.h}" viewBox="0 0 ${d.w} ${d.h}" overflow="hidden">${pn.svg}</svg></g>`;
    o += `<text x="${f2(x)}" y="${f2(40 + ph + 18)}" font-family="${FONT}" font-size="12" font-weight="700" fill="${p.scheme === "dark" ? "#e8eef2" : "#14212a"}">${titles[i]}</text>`;
    o += `<text x="${f2(x)}" y="${f2(40 + ph + 34)}" font-family="${FONT}" font-size="10" fill="${p.scheme === "dark" ? "#9fb2bd" : "#33444e"}">${pn.note.slice(0, 120)}</text>`;
  });
  return o + "</svg>";
}

const out = process.argv[2];
if (!out) throw new Error("usage: tabletLayoutRender.ts <outDir>");
mkdirSync(out, { recursive: true });
for (const d of DEVICES) {
  for (const scheme of ["light", "dark"] as const) {
    const base = `${out}/tab-${d.key}-${scheme}`;
    writeFileSync(`${base}.svg`, render(PALETTES[scheme], d));
    execFileSync("rsvg-convert", ["-z", "2", "-o", `${base}.png`, `${base}.svg`]);
    console.log(`${base}.png`);
  }
}
