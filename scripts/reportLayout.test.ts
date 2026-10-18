/**
 * PDF report layout harness: the report HTML is built by the real report.ts with
 * the native edge (Expo, React Native, SQLite, analytics, purchases) stubbed at
 * the module loader. Pins: weekly comparison hidden without last-week data, the
 * "Profile:" line only with a report name, the one-page summary having no page
 * breaks and keeping its sections, the full report keeping its own, the
 * page-break rules, and that the report name stays on the device.
 *
 * Run: npx tsx scripts/reportLayout.test.ts
 * Optional: REPORT_HTML_DIR=<dir> also writes the sample documents there.
 */
declare const console: { log: (...a: unknown[]) => void };
declare const process: { exit: (code: number) => void; env: Record<string, string | undefined> };
declare const __dirname: string;
declare const require: { (id: string): any };

const fs = require("node:fs");
const path = require("node:path");
const nodeModule = require("module");

// Sabit "simdi" (Cuma 12:00 yerel): sonuc calistirma gunune ve saatine bagli olmasin.
const FIXED_NOW = process.env.TEST_NOW_MS ? Number(process.env.TEST_NOW_MS) : new Date(2026, 9, 16, 12, 0, 0).getTime();
Date.now = () => FIXED_NOW;

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean, detail = ""): void {
  if (cond) passed++;
  else {
    failed++;
    console.log(`  FAIL ${name}${detail ? ": " + detail : ""}`);
  }
}
function section(title: string): void {
  console.log(`\n${title}`);
}

const root = path.join(__dirname, "..");
const read = (rel: string) => fs.readFileSync(path.join(root, rel), "utf8");

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
const NATIVE = /^(expo|expo-.*|react-native.*|@react-native.*|@react-native-async-storage\/async-storage|@expo\/.*)$/;
const STUB_FILES = ["lib/db/journal.ts", "lib/analytics/index.ts", "lib/services/purchases.ts"];
const origLoad = nodeModule._load;
nodeModule._load = function (request: string, parent: unknown, isMain: boolean) {
  if (request === "@react-native-async-storage/async-storage") {
    return { __esModule: true, default: storageApi };
  }
  if (request === "expo-localization") return { getLocales: () => [{ languageCode: "tr" }] };
  if (NATIVE.test(request)) return generic;
  if (request.startsWith(".")) {
    try {
      const file = nodeModule._resolveFilename(request, parent, isMain) as string;
      const rel = path.relative(root, file);
      if (STUB_FILES.includes(rel)) {
        return { __esModule: true, getJournal: async () => [], logEvent: () => {}, isDuringTrial: async () => false };
      }
    } catch {
      /* fall through */
    }
  }
  return origLoad.apply(this, [request, parent, isMain]);
};

const report = require("../lib/services/report");
const i18nMod = require("../lib/i18n");
const i18n = i18nMod.default;
const { rangeFromWindow } = require("../lib/insights");
const { PROFILE_SCOPED_KEY_BASES } = require("../lib/profileScopedKeys");
const { setReportName, getReportName } = require("../lib/reportName");

const DAY = 86_400_000;
const profile: any = {
  id: "p1",
  name: "",
  insulin_sensitivity_factor: 50,
  carb_ratio_breakfast: 10,
  carb_ratio_lunch: 12,
  carb_ratio_dinner: 12,
  target_fasting_min: 70,
  target_fasting_max: 100,
  target_postmeal_min: 80,
  target_postmeal_max: 180,
  hypo_threshold_mgdl: 70,
  daily_carb_target_g: 200,
  daily_carb_target_min_g: 160,
  glucose_unit: "mgdl",
  diabetes_type: "type1",
  insulin_mode: "both",
  ratios_confirmed: 1,
  basal_daily_units: 20,
  basal_insulin_id: null,
  bolus_insulin_id: null,
  basal_insulin_other: null,
  bolus_insulin_other: null,
  oral_meds_enabled: 0,
  created_at: new Date(Date.now() - 60 * DAY).toISOString(),
};

function sampleEntries(withLastWeek: boolean): any[] {
  const out: any[] = [];
  const now = Date.now();
  const days = withLastWeek ? 30 : 3;
  let n = 0;
  for (let d = 0; d < days; d++) {
    const dayStart = new Date(now - d * DAY);
    dayStart.setHours(0, 0, 0, 0);
    for (const h of [7, 10, 13, 16, 19, 22]) {
      const at = new Date(dayStart.getTime() + h * 3_600_000 + (n % 7) * 60_000);
      if (at.getTime() > now - 600_000) continue;
      const base = 105 + ((n * 37) % 110);
      const low = n % 17 === 0 ? 58 : base;
      out.push({
        kind: "glucose",
        id: `g${n}`,
        logged_at: at.toISOString(),
        glucose_level_mgdl: low,
        period_tag: h < 9 ? "fasting" : "beforeMeal",
        source: "manual",
        tags: [],
        healthkit_uuid: null,
      });
      n++;
    }
    for (const h of [8, 13, 19]) {
      const at = new Date(dayStart.getTime() + h * 3_600_000 + 5 * 60_000);
      if (at.getTime() > now - 600_000) continue;
      out.push({
        kind: "meal",
        id: `m${d}-${h}`,
        logged_at: at.toISOString(),
        food_id: null,
        sugar_log_id: null,
        display_name: "Test",
        category: null,
        portion_g: 100,
        calculated_carbs_g: 40 + h,
        insulin_dose_units: 4,
        photo_uri_local: null,
        personal_note: null,
        tags: [],
      });
      out.push({
        kind: "injection",
        id: `i${d}-${h}`,
        logged_at: new Date(at.getTime() + 60_000).toISOString(),
        site: "abdomen",
        site_point: null,
        dose_units: 4,
        insulin_type: "bolus",
        bolus_kind: "meal",
        note: null,
        source: "manual",
        tags: [],
        insulin_product_id: null,
        insulin_product_other: null,
      });
    }
  }
  const cutoff = new Date(now);
  cutoff.setHours(0, 0, 0, 0);
  if (!withLastWeek) {
    // Haftalik kiyas takvim haftasina bagli: "gecen hafta yok" ornegi yalniz bu haftanin icinde kalir.
    while (cutoff.getDay() !== 1 && cutoff.getDay() !== 0) cutoff.setDate(cutoff.getDate() - 1);
  }
  const kept = withLastWeek ? out : out.filter((e) => new Date(e.logged_at).getTime() >= cutoff.getTime());
  return kept.sort((a, b) => (a.logged_at < b.logged_at ? 1 : -1));
}

function build(withLastWeek: boolean, opts: { reportName?: string; mode?: "full" | "summary" }): string {
  const entries = sampleEntries(withLastWeek);
  const range = rangeFromWindow(30);
  const doc = report.buildReportDocument(profile, range, entries, opts);
  if (!doc) throw new Error("no document");
  return doc.html as string;
}

async function main(): Promise<void> {
  console.log("zerospike report layout test");
  const dumpDir = process.env.REPORT_HTML_DIR;
  if (dumpDir) fs.mkdirSync(dumpDir, { recursive: true });

  for (const lang of ["tr", "de"]) {
    await i18nMod.setLanguage(lang);
    const T = (k: string) => i18n.t(k) as string;
    section(`lang ${lang}`);

    const fullPrev = build(true, { reportName: "Ayşe K.", mode: "full" });
    const fullNoPrev = build(false, { reportName: "", mode: "full" });
    const sumPrev = build(true, { reportName: "Ayşe K.", mode: "summary" });
    const sumNoName = build(true, { reportName: "  ", mode: "summary" });

    ok("weekly comparison present with last-week data", fullPrev.includes(T("insights.weeklyCompareTitle")));
    ok("weekly comparison absent without last-week data", !fullNoPrev.includes(T("insights.weeklyCompareTitle")));

    const profileLine = `<b>${T("report.profile")}:</b>`;
    ok("profile line printed with a report name", fullPrev.includes(profileLine) && fullPrev.includes("Ayşe K."));
    ok("no profile line when the report name is empty", !fullNoPrev.includes(profileLine));
    ok("no profile line when the report name is blank", !sumNoName.includes(profileLine));
    ok("default profile name is never printed", !fullNoPrev.includes(T("profiles.defaultName")));
    ok("date range line stays", fullNoPrev.includes(`<b>${T("report.dateRange")}:</b>`));

    ok("summary keeps the KPI boxes", sumPrev.includes('class="kpis"'));
    ok("summary keeps the target range bar", sumPrev.includes('class="tirbar"'));
    ok("summary keeps the AGP", sumPrev.includes(T("report.agpTitle")));
    ok("summary keeps the low readings table", sumPrev.includes(T("report.hypoEvents")));
    ok("summary notes the capped low table", sumPrev.includes(i18n.t("report.lowTableTail", { shown: 6, n: 11 }) as string));
    ok("summary keeps the footnote", sumPrev.includes('class="foot"') && sumPrev.includes(T("disclaimer.body")));
    ok("summary is one page: no forced break", !/page-break-before|break-before/.test(sumPrev));
    ok("summary drops the timeline", !sumPrev.includes(T("report.timelineTitle")));
    ok("summary drops the events page", !sumPrev.includes(`<h2>${T("report.eventsTitle")}`));
    ok("summary drops the long tables", !sumPrev.includes(T("report.glucoseReadings")));
    ok("summary drops the weekly comparison", !sumPrev.includes(T("insights.weeklyCompareTitle")));
    ok("summary carries the one-page class", sumPrev.includes('<body class="one"'));

    ok("full keeps the timeline", fullPrev.includes(T("report.timelineTitle")));
    ok("full keeps the events page", fullPrev.includes(`<h2>${T("report.eventsTitle")}`));
    ok("full keeps the glucose table", fullPrev.includes(T("report.glucoseReadings")));
    ok("full has no forced break (no near-empty pages)", !/page-break-before|break-before/.test(fullPrev));
    ok("full is not the one-page body", !fullPrev.includes('<body class="one"'));

    for (const [name, html] of [["full", fullPrev], ["summary", sumPrev]] as const) {
      ok(`${name}: break-inside avoid rule`, /break-inside:\s*avoid/.test(html));
      ok(`${name}: break-after avoid for headings`, /h2, h3, \.cap \{ break-after: avoid/.test(html));
      ok(`${name}: table rows do not split`, /tr \{ break-inside: avoid|, tr \{ break-inside: avoid/.test(html));
      ok(`${name}: colours print`, /print-color-adjust:\s*exact/.test(html));
      ok(`${name}: target bar sits before the AGP`, html.indexOf('class="tirbar"') < html.indexOf(T("report.agpTitle")));
    }

    if (dumpDir) {
      fs.writeFileSync(path.join(dumpDir, `tam-${lang}-ad-dolu-gecen-var.html`), fullPrev);
      fs.writeFileSync(path.join(dumpDir, `tam-${lang}-ad-bos-gecen-yok.html`), fullNoPrev);
      fs.writeFileSync(path.join(dumpDir, `ozet-${lang}-ad-dolu.html`), sumPrev);
      fs.writeFileSync(path.join(dumpDir, `ozet-${lang}-ad-bos.html`), sumNoName);
    }
  }

  section("report name storage");
  await setReportName("p1", "  Rapor Adı  ");
  ok("stored trimmed per profile", (await getReportName("p1")) === "Rapor Adı");
  ok("other profile unaffected", (await getReportName("p2")) === "");
  await setReportName("p1", "   ");
  ok("blank clears the value", (await getReportName("p1")) === "" && !store.has("zerospike.reportName.p1"));
  ok("key is in the per-profile sweep list", (PROFILE_SCOPED_KEY_BASES as string[]).includes("zerospike.reportName"));

  section("report name stays on the device");
  const reportSrc = read("lib/services/report.ts");
  ok("export_pdf event carries no name", /logEvent\("export_pdf", \{ during_trial: duringTrial \}\)/.test(reportSrc));
  for (const f of ["lib/reportName.ts"]) {
    const code = read(f).replace(/\/\*[\s\S]*?\*\//g, "");
    ok(`${f} does not touch analytics, Supabase or AI`, !/analytics|supabase|lib\/ai/i.test(code));
  }
  ok("profile.tsx imports the name helper only from reportName", /from "\.\.\/\.\.\/lib\/reportName"/.test(read("app/settings/profile.tsx")));

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

void main();
