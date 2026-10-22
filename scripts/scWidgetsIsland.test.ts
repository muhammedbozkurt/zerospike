// Calistir: npx tsx scripts/scWidgetsIsland.test.ts
// Sahne sabitleri (components/scWidgets/islandSpec.ts) gercek Swift ile eslesmeli.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DARK } from "../lib/theme/tokens";
import {
  ISLAND_COMPACT,
  ISLAND_EXPANDED,
  ISLAND_MINIMAL,
  ISLAND_TONES,
  LIVE_CARD,
} from "../components/scWidgets/islandSpec";

import { specFor } from "../components/scWidgets/layout";
import { SCENE_TIMER_REMAINING_MIN, SCENE_TIMER_WINDOW_MIN } from "../components/scWidgets/sceneData";

const root = join(__dirname, "..");
const swift = readFileSync(join(root, "targets/widget/PostMealActivity.swift"), "utf8");
const colors = readFileSync(join(root, "targets/widget/WidgetColors.swift"), "utf8");

const hex = (r: string, g: string, b: string) =>
  "#" +
  [r, g, b]
    .map((v) => Math.round(parseFloat(v) * 255).toString(16).padStart(2, "0"))
    .join("");

function tone(name: string): string {
  const m = colors.match(new RegExp(`${name} = Color\\(red: ([\\d.]+), green: ([\\d.]+), blue: ([\\d.]+)\\)`));
  assert.ok(m, `WidgetColors.swift: ${name} yok`);
  return hex(m[1], m[2], m[3]);
}

function between(from: string, to: string): string {
  const a = swift.indexOf(from);
  assert.ok(a >= 0, `Swift: "${from}" yok`);
  const b = swift.indexOf(to, a + from.length);
  assert.ok(b > a, `Swift: "${to}" yok`);
  return swift.slice(a, b);
}

const WEIGHT: Record<string, string> = { medium: "500", semibold: "600", bold: "700" };

function font(block: string, nth = 0): { size: number; weight: string } {
  const all = [...block.matchAll(/\.font\(\.system\(size: (\d+), weight: \.(\w+)/g)];
  assert.ok(all[nth], "Swift: font bulunamadi");
  return { size: Number(all[nth][1]), weight: WEIGHT[all[nth][2]] };
}

// Renkler
assert.equal(ISLAND_TONES.accent, tone("islandAccent"));
assert.equal(ISLAND_TONES.ink, tone("islandInk"));
assert.equal(ISLAND_TONES.muted, tone("islandMuted"));
assert.equal(ISLAND_TONES.accent, DARK.accentFill.toLowerCase());

// Kompakt: leading simge + trailing sure, SF Symbol "timer"
const compactLead = between("compactLeading:", "compactTrailing:");
const compactTrail = between("compactTrailing:", "minimal:");
assert.match(compactLead, /systemName: "timer"/);
assert.deepEqual(font(compactLead), { size: ISLAND_COMPACT.iconSize, weight: ISLAND_COMPACT.iconWeight });
assert.deepEqual(font(compactTrail), { size: ISLAND_COMPACT.timeSize, weight: ISLAND_COMPACT.timeWeight });
assert.equal(Number(compactTrail.match(/frame\(maxWidth: (\d+)\)/)![1]), ISLAND_COMPACT.timeMaxW);

// Minimal
const minimal = between("minimal:", "// Same destination");
assert.match(minimal, /systemName: "timer"/);
assert.deepEqual(font(minimal), { size: ISLAND_MINIMAL.iconSize, weight: ISLAND_MINIMAL.iconWeight });

// Genisletilmis rozet: timerBadge(size: 30, corner: 10, glyph: 14, tones: .island)
const badge = swift.match(/timerBadge\(size: (\d+), corner: (\d+), glyph: (\d+), tones: \.island\)/);
assert.ok(badge, "Swift: island timerBadge yok");
assert.equal(Number(badge[1]), ISLAND_EXPANDED.badge);
assert.equal(Number(badge[2]), ISLAND_EXPANDED.badgeCorner);
assert.equal(Number(badge[3]), ISLAND_EXPANDED.badgeGlyph);
const badgeFn = between("private func timerBadge", "/// The last logged reading");
assert.match(badgeFn, /systemName: "timer"/);
assert.equal(Number(badgeFn.match(/opacity\(([\d.]+)\)/)![1]), ISLAND_EXPANDED.badgeAlpha);
assert.equal(WEIGHT[badgeFn.match(/weight: \.(\w+)/)![1]], "600");

// Baslik (center) ve sure (trailing)
const center = between("DynamicIslandExpandedRegion(.center)", "DynamicIslandExpandedRegion(.trailing)");
assert.match(center, /context\.attributes\.title/);
assert.match(center, /lineLimit\(1\)/);
assert.deepEqual(font(center), { size: ISLAND_EXPANDED.titleSize, weight: ISLAND_EXPANDED.titleWeight });
assert.match(center, /island\.muted/);
const trailing = between("DynamicIslandExpandedRegion(.trailing)", "DynamicIslandExpandedRegion(.bottom)");
assert.deepEqual(font(trailing), { size: ISLAND_EXPANDED.timeSize, weight: ISLAND_EXPANDED.timeWeight });
assert.equal(Number(trailing.match(/minWidth: (\d+)/)![1]), ISLAND_EXPANDED.timeMinW);

// Okuma kapsulu
const pill = between("private func readingPill", "@available(iOS 16.2, *)\nstruct PostMealActivityWidget");
assert.deepEqual(font(pill, 0), { size: ISLAND_EXPANDED.pillValueSize, weight: ISLAND_EXPANDED.pillValueWeight });
assert.deepEqual(font(pill, 1), { size: ISLAND_EXPANDED.pillUnitSize, weight: ISLAND_EXPANDED.pillUnitWeight });
assert.equal(Number(pill.match(/spacing: (\d+)/)![1]), ISLAND_EXPANDED.pillGap);
assert.equal(Number(pill.match(/\.padding\(\.horizontal, (\d+)\)/)![1]), ISLAND_EXPANDED.pillPadX);
assert.equal(Number(pill.match(/\.padding\(\.vertical, (\d+)\)/)![1]), ISLAND_EXPANDED.pillPadY);
const opac = [...pill.matchAll(/opacity\(([\d.]+)\)/g)].map((m) => Number(m[1]));
assert.deepEqual(opac, [ISLAND_EXPANDED.pillFillAlpha, ISLAND_EXPANDED.pillStrokeAlpha]);
assert.match(pill, /lineWidth: 1\)/);

// Kilit ekrani karti
const card = between("// Lock screen / banner", "Spacer(minLength: 8)");
assert.match(card, /HStack\(spacing: (\d+)\)/);
assert.equal(Number(card.match(/HStack\(spacing: (\d+)\)/)![1]), LIVE_CARD.gap);
const cardBadge = card.match(/timerBadge\(size: (\d+), corner: (\d+), glyph: (\d+), tones: \.card\)/);
assert.ok(cardBadge, "Swift: card timerBadge yok");
assert.deepEqual(cardBadge.slice(1).map(Number), [LIVE_CARD.badge, LIVE_CARD.badgeCorner, LIVE_CARD.badgeGlyph]);
assert.deepEqual(font(card, 0), { size: LIVE_CARD.titleSize, weight: LIVE_CARD.titleWeight });
assert.deepEqual(font(card, 1), { size: LIVE_CARD.timeSize, weight: LIVE_CARD.timeWeight });
assert.equal(Number(card.match(/maxWidth: (\d+), alignment: \.leading/)![1]), LIVE_CARD.timeMaxW);
const afterCard = between("Spacer(minLength: 8)", "widgetURL(DeepLinks.postMeal2h)");
assert.equal(Number(afterCard.match(/\.padding\(\.horizontal, (\d+)\)/)![1]), LIVE_CARD.padX);
assert.equal(Number(afterCard.match(/\.padding\(\.vertical, (\d+)\)/)![1]), LIVE_CARD.padY);
assert.equal(LIVE_CARD.naturalH, LIVE_CARD.padY * 2 + LIVE_CARD.badge);

// Ilerleme cubugu: yalniz genisletilmis adada (bottom), kilit ekraninda YOK
const lockSection = between("// Lock screen / banner", "} dynamicIsland:");
assert.ok(!/ProgressView/.test(lockSection), "Kilit ekrani kartinda cubuk olmamali");
const bottom = between("DynamicIslandExpandedRegion(.bottom)", "} compactLeading:");
assert.match(bottom, /islandProgressBar\(context\.state, tones: \.island\)/);
assert.match(bottom, /context\.isStale \? 0\.55 : 1/);
assert.equal(Number(bottom.match(/\.padding\(\.bottom, (\d+)\)/)![1]), ISLAND_EXPANDED.barBottomPad);
assert.ok(ISLAND_EXPANDED.barBottomPad >= 6, "alt bosluk >= 6 pt");
assert.equal(Number(bottom.match(/VStack\(alignment: \.leading, spacing: (\d+)\)/)![1]), ISLAND_EXPANDED.barGap);
// Cubuk pilin ALTINDA (pill once, cubuk sonra)
assert.ok(bottom.indexOf("readingPill(") < bottom.indexOf("islandProgressBar("), "cubuk kapsulun altinda");
const barFn = between("private func islandProgressBar", "/// The timer glyph on its accent ground");
assert.match(barFn, /ProgressView\(timerInterval: timerRange\(state\), countsDown: false\)/);
assert.match(barFn, /EmptyView\(\)/);
assert.match(barFn, /\.labelsHidden\(\)/);
assert.match(barFn, /\.tint\(tones\.accent\)/);
assert.equal(Number(barFn.match(/\.frame\(height: (\d+)\)/)![1]), ISLAND_EXPANDED.barH);
assert.equal(Number(barFn.match(/opacity\(([\d.]+)\)/)![1]), ISLAND_EXPANDED.barTrackAlpha);
assert.match(barFn, /\.fill\(tones\.ink\.opacity/);
// Cubuk yalniz island tonuyla cizilir: accent islandAccent (= ISLAND_TONES.accent)
assert.match(swift, /islandProgressBar\(context\.state, tones: \.island\)/);
assert.equal(
  ISLAND_EXPANDED.h,
  ISLAND_EXPANDED.padTop + ISLAND_EXPANDED.badge + ISLAND_EXPANDED.rowToPill + 29 +
    ISLAND_EXPANDED.barGap + ISLAND_EXPANDED.barH + ISLAND_EXPANDED.padBottom,
  "genisletilmis yukseklik = dolgu + rozet + pil(29) + cubuk",
);

// Sahne: 72/120 dk kaldi -> gecen oran %40
assert.equal((SCENE_TIMER_WINDOW_MIN - SCENE_TIMER_REMAINING_MIN) / SCENE_TIMER_WINDOW_MIN, 0.4);

// Sahne: genisletilmis ada CIZILMEZ (yalniz uzun basinca acilir), kompakt hap + minimal kalir
const barSrc = readFileSync(join(root, "components/scWidgets/DynamicIslandBar.tsx"), "utf8");
assert.ok(!/import[^;]*ISLAND_EXPANDED/.test(barSrc) && !/ISLAND_EXPANDED\./.test(barSrc), "DynamicIslandBar genisletilmis adayi cizmemeli");
assert.match(barSrc, /ISLAND_COMPACT/);
assert.match(barSrc, /ISLAND_MINIMAL/);
const routeSrc = readFileSync(join(root, "app/sc-widgets.tsx"), "utf8");
assert.match(routeSrc, /scWidgets\.dynamicIsland/, "ada etiketi i18n anahtarindan");
assert.match(routeSrc, /scWidgets\.lockScreen/, "kilit ekrani etiketi i18n anahtarindan");

// iPhone butcesi: yigin tam 617'de biter bildirim kartini baslatir, kart 748 kesimini asar, 674 probu kartin icinde
const ip = specFor("iphone");
assert.equal(ip.kind, "ios");
if (ip.kind === "ios" && ip.island) {
  const h = ISLAND_COMPACT.h;
  let y = ip.contentTop + h + ip.island.captionGap + ip.headingH + ip.island.gapAfter;
  y += ip.headingH + ip.headingGap;
  y += ip.inlineH + ip.gapInlineToClock + ip.clockLine + ip.dateLine + ip.gapClockToAccessory + ip.accessoryH;
  y += ip.gapAccessoryToLive + ip.liveH + ip.sectionGap;
  y += ip.headingH + ip.headingGap + ip.unit + ip.sectionGap;
  assert.equal(y, 617, "bildirim karti ust kenari");
  assert.ok(y + ip.notif.height <= ip.visibleH, "kart 748 kesiminin icinde (degismedi)");
  assert.ok(ip.probeY > y && ip.probeY < y + ip.notif.height, "probe kartin icinde");
  // Canli etkinlik kilit ekraninin yildizi: dogal olcegin en az 1.4x'i
  const liveScale = Math.min(ip.liveH / LIVE_CARD.naturalH, ip.liveScaleCap);
  assert.ok(liveScale >= 1.4, "canli etkinlik icerigi dogal olcegin en az 1.4 kati");
  assert.ok(ip.liveH > LIVE_CARD.naturalH * liveScale, "kart kutusu icerikten yuksek (nefes payi)");
}
assert.equal(specFor("ipad").kind === "ios" && specFor("ipad").island, null, "iPad'de ada yok");

console.log("scWidgetsIsland: OK");
