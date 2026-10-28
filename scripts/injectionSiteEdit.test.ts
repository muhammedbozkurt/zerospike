/**
 * "Add region" on the region-less meal bolus: the toast action and the entry
 * guard open the EXISTING row's edit sheet, they never log a second bolus.
 * Run: npx -y tsx scripts/injectionSiteEdit.test.ts
 */
declare const console: { log: (...a: unknown[]) => void };
declare const process: { exit: (code: number) => void };

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { checkEntryGuards, type EntryGuardInput } from "../lib/entryGuard";
import {
  guardAddSiteOutcome,
  isRegionlessMealBolus,
  parseEditRequest,
  pickEditRow,
  siteEditParams,
} from "../lib/injectionEditTarget";
import { savedToastKey } from "../lib/mealEditPatch";
import { initialToastState, reduceToast } from "../lib/toastQueue";

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean): void {
  if (cond) passed++;
  else {
    failed++;
    console.log(`  FAIL ${name}`);
  }
}
const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8");

const now = Date.parse("2026-10-28T12:00:00Z");
const iso = (minAgo: number) => new Date(now - minAgo * 60_000).toISOString();

console.log("A. editId selects the right row, fallback otherwise");
const rows = [
  { id: "a", profile_id: "p1" },
  { id: "b", profile_id: "p1" },
];
ok("params carry id and History focus", JSON.stringify(siteEditParams("b")) === '{"editId":"b","focus":"history"}');
ok("params with no row still focus History", JSON.stringify(siteEditParams(null)) === '{"editId":"","focus":"history"}');
ok("request: id", parseEditRequest({ editId: "b", focus: "history" })?.id === "b");
ok("request: array param", parseEditRequest({ editId: ["b"] })?.id === "b");
ok("request: History only", parseEditRequest({ editId: "", focus: "history" })?.id === null);
ok("request: cleared params is no request", parseEditRequest({ editId: "", focus: "" }) === null);
ok("request: plain visit is no request", parseEditRequest({}) === null);
ok("row picked by id", pickEditRow("b", rows[1], "p1")?.id === "b");
ok("row missing -> null (History only)", pickEditRow("zzz", null, "p1") === null);
ok("row id mismatch -> null", pickEditRow("a", rows[1], "p1") === null);
ok("other profile -> null", pickEditRow("b", rows[1], "p2") === null);
ok("no id -> null", pickEditRow(null, rows[0], "p1") === null);

console.log("B. toast wiring");
ok("no-site meal save keys the no-site toast", savedToastKey({ doseWanted: true, wroteInjection: true, hasSite: false, createdReading: false }) === "autoInjectionNoSite");
ok("site chosen keys the plain toast", savedToastKey({ doseWanted: true, wroteInjection: true, hasSite: true, createdReading: false }) === "autoInjection");
const calc = read("app/calculator.tsx");
const branch = calc.slice(calc.indexOf('if (toastKey === "autoInjectionNoSite") {'));
ok("calculator: no-site toast gets addSite as primary", /label: t\("calculator\.addSite"\)/.test(branch.slice(0, 900)));
ok("calculator: undo kept as secondary", /secondary: undoAction/.test(branch.slice(0, 1200)));
ok("calculator: other toasts keep undo as primary", /else \{\s*toast\(message, "success", undoAction\);/.test(branch));
ok("calculator: addSite opens the edit route, not a compose route", /siteEditParams\(rowId\)/.test(branch) && !/compose/.test(branch.slice(0, 1400)));
const fb = read("components/Feedback.tsx");
ok("feedback: secondary runs through runToastAction", /runToastAction\("secondary"\)/.test(fb) && /secondary\?:/.test(fb));
{
  const secondary = { label: "Undo", onPress: () => undefined };
  const shown = reduceToast(initialToastState<{ label: string; secondary: typeof secondary }>(), {
    type: "show", message: "m", kind: "success", action: { label: "Add", secondary }, visibleMs: 5000,
  });
  const run = reduceToast(shown.state, { type: "actionRun", id: shown.state.current!.id });
  ok("toast with two actions dismisses after one runs", run.state.current?.action == null && run.state.phase === "out");
}
for (const l of ["en", "tr", "de", "fr", "es", "it", "pt", "ar", "ja"]) {
  const src = read(`lib/i18n/locales/${l}.ts`);
  ok(`${l}: addSite, guard labels present`, /\n    addSite: "/.test(src) && /addSiteToRecord: "/.test(src) && /saveAnyway: "/.test(src));
}
ok("tr toast text", read("lib/i18n/locales/tr.ts").includes("Doz, bölgesiz bir bolus olarak kaydedildi. Bölge eklemek için Bölge ekle'ye dokunun."));

console.log("C. entry guard offers 'add region' only for a region-less meal bolus");
type Inj = NonNullable<NonNullable<EntryGuardInput["recent"]>["injections"]>;
const calcRow: Inj[number] = { id: "calc1", insulin_type: "bolus", dose_units: 3, logged_at: iso(5), source: "calculator", site: null };
const guard = (injections: Inj, insulinType: "bolus" | "basal" = "bolus") =>
  checkEntryGuards({ now, entryKind: "injection", insulinType, entryAtIso: iso(0), recent: { injections } });
ok("region-less calculator bolus -> addSiteToId", guard([calcRow])[0]?.detail?.addSiteToId === "calc1");
ok("calculator bolus WITH a region -> none", guard([{ ...calcRow, site: "abdomen" }])[0]?.detail?.addSiteToId === undefined);
ok("manual region-less bolus -> none", guard([{ ...calcRow, source: "manual" }])[0]?.detail?.addSiteToId === undefined);
ok("row without source info -> none", guard([{ id: "x", insulin_type: "bolus", dose_units: 2, logged_at: iso(5) }])[0]?.detail?.addSiteToId === undefined);
ok("basal notice never carries it", guard([{ ...calcRow, insulin_type: "basal" }], "basal")[0]?.detail?.addSiteToId === undefined);
ok("notice itself still raised (kind, units)", guard([calcRow])[0]?.kind === "recent_bolus" && guard([calcRow])[0]?.detail?.units === 3);
ok(
  "nearest row decides",
  guard([calcRow, { id: "man", insulin_type: "bolus", dose_units: 1, logged_at: iso(1), source: "manual", site: "thigh" }])[0]?.detail?.addSiteToId === undefined
);
ok("helper: regionless calculator bolus", isRegionlessMealBolus(calcRow) && !isRegionlessMealBolus({ ...calcRow, site: "thigh" }));

console.log("D. adding a region never writes a new row");
ok("choice add -> no save, opens that row", JSON.stringify(guardAddSiteOutcome(true, "calc1")) === '{"save":false,"openEditId":"calc1"}');
ok("choice save anyway -> saves, opens nothing", JSON.stringify(guardAddSiteOutcome(false, "calc1")) === '{"save":true,"openEditId":null}');
ok("dismissed -> neither", JSON.stringify(guardAddSiteOutcome(null, "calc1")) === '{"save":false,"openEditId":null}');
const sheet = read("components/InjectionEditSheet.tsx");
ok("edit sheet only updates (no logInjection call)", !/logInjection\(/.test(sheet) && /updateInjection\(target\.id, patch\)/.test(sheet));
const screen = read("app/(tabs)/injection.tsx");
const at = screen.indexOf("const openEditById");
const open = screen.slice(at, at + 500);
ok("openEditById reads one row and opens the sheet", /getInjection\(id\)/.test(open) && /setEditing\(row\)/.test(open) && !/logInjection/.test(open));

console.log("E. map orientation toast is gone");
ok("injection tab no longer toasts the orientation change", !/flipNotice|injectionMapNotice|FlipNotice/.test(screen));
ok("no locale carries the orientation toast key", ["en", "tr", "de", "fr", "es", "it", "pt", "ar", "ja"].every((l) => !read(`lib/i18n/locales/${l}.ts`).includes("flipNotice")));

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
