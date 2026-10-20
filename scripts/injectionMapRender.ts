/**
 * Geometry render of the injection map: NOT a device capture. It draws the
 * map from the component's own pure geometry (components/injectionMap:
 * silhouette, layout, tiers, paint, lib/injectionHeat and the theme palettes)
 * into SVG and rasterises it with rsvg-convert, so the picture shows the real
 * sizes, gaps and colours, not the React Native text rendering.
 *
 * Run: npx tsx scripts/injectionMapRender.ts <outDir>
 * Output per phone width and theme: map-<width>-<light|dark>.svg / .png, a 2x2
 * sheet (front, back, arm zoom, abdomen zoom).
 */
declare const process: { argv: string[] };
declare const console: { log: (...a: unknown[]) => void };

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";

import { HEAT_TIER_LABELS, heatTierForCount } from "../lib/injectionHeat";
import { PALETTES, type Palette } from "../lib/theme/tokens";
import {
  ARM_PATHS,
  FADE_FROM,
  FADE_TO,
  FULL_VIEW,
  GEOMETRY,
  NAVEL,
  REGIONS,
  SPINE_PATH,
  TORSO_PATH,
  VB_W,
  type Surface,
} from "../components/injectionMap/silhouette";
import {
  BADGE_H,
  BADGE_INNER_X,
  BADGE_TOP_Y,
  dotFonts,
  dotMetrics,
  mapHeight,
  mapWidth,
} from "../components/injectionMap/layout";
import { tierStroke } from "../components/injectionMap/tiers";
import { inkFor, mixHex } from "../components/injectionMap/paint";

const FONT = "Helvetica, Arial, sans-serif";
const f2 = (n: number): string => (Math.round(n * 100) / 100).toString();

/** Sample history: one count per site, and one per point of the zoomed sites. */
const SITE_COUNTS: Record<string, number> = {
  abdomen_left: 0,
  abdomen_right: 1,
  thigh_left: 2,
  thigh_right: 3,
  arm_left: 4,
  arm_right: 7,
  buttock_left: 2,
  buttock_right: 5,
};
const POINT_COUNTS: Record<string, number[]> = {
  arm_left: [0, 1, 2, 3],
  abdomen_left: [0, 3, 5, 12],
};

function figure(p: Palette, svgW: number, view: { surface: Surface; zoom: string | null }): string {
  const geo = view.zoom ? GEOMETRY.get(view.zoom as never)! : null;
  const [vx, vy, vw, vh] = geo ? geo.zoom : FULL_VIEW;
  const upx = vw / svgW;
  const svgH = mapHeight(svgW);
  const bodyFill = mixHex(p.surfaceRaised, p.text, 0.05);
  const plateFill = mixHex(p.surfaceRaised, p.text, 0.02);
  let o = `<svg x="0" y="0" width="${svgW}" height="${svgH}" viewBox="${vx} ${vy} ${vw} ${vh}">`;
  o += `<defs><linearGradient id="figFill" gradientUnits="userSpaceOnUse" x1="0" y1="${FADE_FROM}" x2="0" y2="${FADE_TO}"><stop offset="0" stop-color="${bodyFill}"/><stop offset="1" stop-color="${bodyFill}" stop-opacity="0"/></linearGradient>`;
  o += `<linearGradient id="figEdge" gradientUnits="userSpaceOnUse" x1="0" y1="${FADE_FROM}" x2="0" y2="${FADE_TO}"><stop offset="0" stop-color="${p.borderStrong}"/><stop offset="1" stop-color="${p.borderStrong}" stop-opacity="0"/></linearGradient></defs>`;
  if (geo) {
    o += `<rect x="${vx}" y="${vy}" width="${vw}" height="${vh}" rx="${f2(18 * upx)}" fill="${plateFill}" stroke="${p.heatEdge}" stroke-width="${f2(upx)}"/>`;
  } else {
    o += `<path d="${TORSO_PATH}" fill="url(#figFill)" stroke="url(#figEdge)" stroke-width="${f2(1.1 * upx)}"/>`;
    for (const d of ARM_PATHS) o += `<path d="${d}" fill="url(#figFill)" stroke="url(#figEdge)" stroke-width="${f2(1.1 * upx)}"/>`;
    o +=
      view.surface === "front"
        ? `<circle cx="${NAVEL.x}" cy="${NAVEL.y}" r="${NAVEL.r}" fill="${p.borderStrong}" opacity="0.5"/>`
        : `<path d="${SPINE_PATH}" stroke="${p.borderStrong}" stroke-opacity="0.4" stroke-width="${f2(upx)}" stroke-linecap="round" fill="none"/>`;
  }
  for (const r of REGIONS.filter((x) => x.surface === view.surface)) {
    const count = SITE_COUNTS[r.site] ?? 0;
    const tier = heatTierForCount(count);
    const inert = geo != null && geo.region.site !== r.site;
    const [bx, by, bw, bh] = r.box;
    const fill = p.heatScale[tier];
    const selected = !geo && r.site === "arm_right";
    o += `<g opacity="${inert ? 0.32 : 1}">`;
    if (selected) o += `<rect x="${bx - 1.4}" y="${by - 1.4}" width="${bw + 2.8}" height="${bh + 2.8}" rx="${r.rx + 1.4}" fill="none" stroke="${p.accent}" stroke-width="${f2(1.6 * upx)}"/>`;
    o += `<rect x="${bx}" y="${by}" width="${bw}" height="${bh}" rx="${r.rx}" fill="${fill}" stroke="${p.heatEdge}" stroke-width="${f2(tierStroke(tier) * upx)}"/>`;
    if (selected) o += `<text x="${bx + bw / 2}" y="${by + bh / 2 + 11 * upx * 0.36}" font-family="${FONT}" font-size="${f2(11 * upx)}" font-weight="700" fill="${inkFor(fill)}" text-anchor="middle">${count}</text>`;
    o += `</g>`;
  }
  if (geo) {
    const dm = dotMetrics(geo, svgW);
    const fonts = dotFonts(dm.r);
    const counts = POINT_COUNTS[geo.region.site] ?? [0, 1, 2, 3];
    for (const pp of geo.points) {
      const count = counts[pp.point - 1];
      const fill = p.heatScale[heatTierForCount(count)];
      const ink = inkFor(fill);
      const r = dm.r * upx;
      const tier = heatTierForCount(count);
      o += `<circle cx="${f2(pp.x)}" cy="${f2(pp.y)}" r="${f2(r)}" fill="${fill}" stroke="${p.heatEdge}" stroke-width="${f2(tierStroke(tier) * 1.2 * upx)}"/>`;
      o += `<text x="${f2(pp.x)}" y="${f2(pp.y - dm.r * (1.5 / 23) * upx + fonts.point * upx * 0.36)}" font-family="${FONT}" font-size="${f2(fonts.point * upx)}" font-weight="700" fill="${ink}" text-anchor="middle">${pp.point}</text>`;
      o += `<text x="${f2(pp.x)}" y="${f2(pp.y + r * 0.62)}" font-family="${FONT}" font-size="${f2(fonts.count * upx)}" font-weight="700" fill="${ink}" text-anchor="middle">${count}</text>`;
    }
  }
  o += `</svg>`;
  if (!geo) {
    const scale = svgW / VB_W;
    for (const [label, x] of [
      ["R", BADGE_INNER_X * scale - 28],
      ["L", (VB_W - BADGE_INNER_X) * scale],
    ] as const) {
      o += `<rect x="${f2(x)}" y="${f2(BADGE_TOP_Y * scale)}" width="28" height="${BADGE_H}" rx="${BADGE_H / 2}" fill="${p.surfaceInset}" stroke="${p.border}"/>`;
      o += `<text x="${f2(x + 14)}" y="${f2(BADGE_TOP_Y * scale + 13)}" font-family="${FONT}" font-size="12" font-weight="800" fill="${p.textMuted}" text-anchor="middle">${label}</text>`;
    }
  }
  return o;
}

function legend(p: Palette, cardW: number): string {
  const item = 16 + 4 + 18;
  const total = item * 5 + 12 * 4;
  let x = (cardW - total) / 2;
  let o = "";
  HEAT_TIER_LABELS.forEach((label, i) => {
    o += `<rect x="${f2(x + 0.5)}" y="0.5" width="15" height="11" rx="4" fill="${p.heatScale[i]}" stroke="${p.heatEdge}" stroke-width="${tierStroke(i as 0 | 1 | 2 | 3 | 4)}"/>`;
    o += `<text x="${f2(x + 20)}" y="10" font-family="${FONT}" font-size="10" font-weight="700" fill="${p.textMuted}">${label}</text>`;
    x += item + 12;
  });
  return o;
}

function card(p: Palette, winW: number, winH: number, view: { surface: Surface; zoom: string | null }, title: string): { svg: string; w: number; h: number } {
  const w = winW - 32;
  const pad = 16;
  const svgW = mapWidth(winW, winH);
  const svgH = mapHeight(svgW);
  const top = 56;
  const figX = (w - svgW) / 2;
  const h = top + svgH + 80;
  let o = `<rect width="${w}" height="${h}" rx="16" fill="${p.surface}" stroke="${p.border}"/>`;
  o += `<text x="${pad}" y="28" font-family="${FONT}" font-size="15" font-weight="700" fill="${p.text}">${title}</text>`;
  o += `<text x="${w - pad}" y="28" font-family="${FONT}" font-size="11" fill="${p.textMuted}" text-anchor="end">${winW} pt, map ${svgW}</text>`;
  o += `<g transform="translate(${f2(figX)} ${top})">${figure(p, svgW, view)}</g>`;
  o += `<g transform="translate(0 ${top + svgH + 18})">${legend(p, w)}</g>`;
  o += `<text x="${w / 2}" y="${top + svgH + 52}" font-family="${FONT}" font-size="11" fill="${p.textMuted}" text-anchor="middle">geometry render, not a device capture</text>`;
  return { svg: o, w, h };
}

function sheet(scheme: "light" | "dark", winW: number, winH: number): string {
  const p = PALETTES[scheme];
  const cards = [
    card(p, winW, winH, { surface: "front", zoom: null }, "Front"),
    card(p, winW, winH, { surface: "back", zoom: null }, "Back"),
    card(p, winW, winH, { surface: "front", zoom: "arm_left" }, "Zoom: arm"),
    card(p, winW, winH, { surface: "front", zoom: "abdomen_left" }, "Zoom: abdomen"),
  ];
  const gap = 16;
  const cw = cards[0].w;
  const rowH = [Math.max(cards[0].h, cards[1].h), Math.max(cards[2].h, cards[3].h)];
  const W = cw * 2 + gap * 3;
  const H = rowH[0] + rowH[1] + gap * 3;
  let o = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect width="${W}" height="${H}" fill="${p.bg}"/>`;
  cards.forEach((c, i) => {
    const x = gap + (i % 2) * (cw + gap);
    const y = gap + (i < 2 ? 0 : rowH[0] + gap);
    o += `<g transform="translate(${x} ${y})">${c.svg}</g>`;
  });
  return o + `</svg>`;
}

const out = process.argv[2];
if (!out) throw new Error("usage: tsx scripts/injectionMapRender.ts <outDir>");
mkdirSync(out, { recursive: true });
const PHONES: Array<[number, number]> = [
  [320, 568],
  [375, 812],
  [430, 932],
];
for (const [w, h] of PHONES) {
  for (const scheme of ["light", "dark"] as const) {
    const base = `${out}/map-${w}-${scheme === "light" ? "acik" : "koyu"}`;
    writeFileSync(`${base}.svg`, sheet(scheme, w, h));
    execFileSync("rsvg-convert", ["-z", "2", "-o", `${base}.png`, `${base}.svg`]);
    console.log(`${base}.png`);
  }
}
