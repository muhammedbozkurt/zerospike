/**
 * "Add region" on the region-less meal bolus: the toast action and the entry
 * guard open the EXISTING row's edit sheet, they never log a second bolus.
 * Behaviour is driven through the same pure functions the screens call
 * (lib/injectionEditTarget.ts, lib/toastQueue.ts, lib/entryGuard.ts) with fake
 * callers; the few source checks at the end pin the wiring that cannot run
 * under plain node (React components).
 * Run: npx -y tsx scripts/injectionSiteEdit.test.ts
 */
declare const console: { log: (...a: unknown[]) => void };
declare const process: { exit: (code: number) => void };

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { checkEntryGuards, type EntryGuardInput } from "../lib/entryGuard";
import {
  ADD_SITE_WINDOW_MINUTES,
  guardAddSiteOutcome,
  handleEditRequest,
  isRegionlessMealBolus,
  loadEditRow,
  noSiteToastAction,
  offerAddSiteToRow,
  parseEditRequest,
  pickEditRow,
  runGuardDialog,
  siteEditParams,
  type GuardAddSiteChoice,
} from "../lib/injectionEditTarget";
import { savedToastKey } from "../lib/mealEditPatch";
import { initialToastState, pickToastAction, reduceToast, toastAnnouncement } from "../lib/toastQueue";

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
const flush = () => new Promise<void>((r) => setTimeout(r, 0));

const now = Date.parse("2026-10-28T12:00:00Z");
const iso = (minAgo: number) => new Date(now - minAgo * 60_000).toISOString();

async function main() {
  console.log("A. editId opens the right row, falls back to History otherwise");
  ok("params carry id and History focus", JSON.stringify(siteEditParams("b")) === '{"editId":"b","focus":"history"}');
  ok("params with no row still focus History", JSON.stringify(siteEditParams(null)) === '{"editId":"","focus":"history"}');
  ok("request: array param", parseEditRequest({ editId: ["b"] })?.id === "b");
  ok("request: cleared params is no request", parseEditRequest({ editId: "", focus: "" }) === null);
  {
    const calls: string[] = [];
    const deps = {
      showHistory: () => calls.push("history"),
      clearParams: () => calls.push("clear"),
      openEdit: (id: string) => calls.push(`open:${id}`),
    };
    ok("request with id: history, clear params, open that id", handleEditRequest({ editId: "b", focus: "history" }, deps) && calls.join() === "history,clear,open:b");
    calls.length = 0;
    handleEditRequest({ editId: "", focus: "history" }, deps);
    ok("History-only request: no sheet, params still cleared", calls.join() === "history,clear");
    calls.length = 0;
    ok("plain visit does nothing", !handleEditRequest({}, deps) && calls.length === 0);
    calls.length = 0;
    handleEditRequest({ editId: "", focus: "" }, deps);
    ok("cleared params do not reopen", calls.length === 0);
  }
  const rows: Record<string, { id: string; profile_id: string }> = {
    a: { id: "a", profile_id: "p1" },
    b: { id: "b", profile_id: "p1" },
  };
  const fetchRow = async (id: string) => rows[id] ?? null;
  ok("loadEditRow: the requested row", (await loadEditRow({ id: "b", profileId: "p1", fetchRow }))?.id === "b");
  ok("loadEditRow: missing row -> null", (await loadEditRow({ id: "zzz", profileId: "p1", fetchRow })) === null);
  ok("loadEditRow: other profile -> null", (await loadEditRow({ id: "b", profileId: "p2", fetchRow })) === null);
  ok("loadEditRow: undefined profile id -> null", (await loadEditRow({ id: "b", profileId: undefined, fetchRow })) === null);
  ok("pickEditRow: row for another id -> null", pickEditRow("a", rows.b, "p1") === null);
  {
    let reported = 0;
    const out = await loadEditRow({
      id: "b",
      profileId: "p1",
      fetchRow: async () => {
        throw new Error("db");
      },
      onError: () => reported++,
    });
    ok("loadEditRow: failing read -> null and reported", out === null && reported === 1);
  }

  console.log("B. toast: two actions, add-region never writes, undo stays");
  ok("no-site meal save keys the no-site toast", savedToastKey({ doseWanted: true, wroteInjection: true, hasSite: false, createdReading: false }) === "autoInjectionNoSite");
  ok("site chosen keys the plain toast", savedToastKey({ doseWanted: true, wroteInjection: true, hasSite: true, createdReading: false }) === "autoInjection");
  {
    const store = [{ id: "calc1" }];
    const nav: unknown[] = [];
    let undone = 0;
    let reported = 0;
    const make = (lookup: () => Promise<string | null>) =>
      noSiteToastAction({
        label: "Add region",
        lookupRowId: lookup,
        navigate: (p) => nav.push(p),
        onError: () => reported++,
        secondary: { label: "Undo", onPress: () => void undone++ },
      });
    const action = make(async () => store[0]?.id ?? null);
    action.onPress();
    await flush();
    ok("primary opens that row's edit route", nav.length === 1 && JSON.stringify(nav[0]) === '{"editId":"calc1","focus":"history"}');
    ok("add region adds no row", store.length === 1);
    ok("add region does not run undo", undone === 0);
    ok("secondary is the untouched undo", action.secondary?.label === "Undo");
    void action.secondary?.onPress();
    ok("secondary runs undo, not navigation", undone === 1 && nav.length === 1);
    nav.length = 0;
    make(async () => null).onPress();
    await flush();
    ok("row gone: History without a sheet", JSON.stringify(nav[0]) === '{"editId":"","focus":"history"}');
    nav.length = 0;
    make(async () => {
      throw new Error("db");
    }).onPress();
    await flush();
    ok("lookup failure: History fallback and reported", JSON.stringify(nav[0]) === '{"editId":"","focus":"history"}' && reported === 1);
  }
  {
    const primary = { label: "Add", onPress: () => undefined, secondary: { label: "Undo", onPress: () => undefined } };
    ok("pickToastAction: default is the primary", pickToastAction(primary).label === "Add");
    ok("pickToastAction: secondary only when asked", pickToastAction(primary, "secondary").label === "Undo");
    ok("pickToastAction: no secondary falls back to primary", pickToastAction({ label: "Add", onPress: () => undefined }, "secondary").label === "Add");
    ok("announcement names both buttons", toastAnnouncement("Saved", primary) === "Saved. Add. Undo");
    ok("announcement: one button", toastAnnouncement("Saved", { label: "Undo", onPress: () => undefined }) === "Saved. Undo");
    ok("announcement: none", toastAnnouncement("Saved", null) === "Saved");
    const shown = reduceToast(initialToastState<typeof primary>(), { type: "show", message: "m", kind: "success", action: primary, visibleMs: 5000 });
    const run = reduceToast(shown.state, { type: "actionRun", id: shown.state.current!.id });
    ok("toast with two actions dismisses after one runs", run.state.current?.action == null && run.state.phase === "out");
  }
  const calc = read("app/calculator.tsx");
  const addSiteAt = calc.indexOf("const addSiteAction");
  const addSiteDef = calc.slice(addSiteAt, calc.indexOf('if (toastKey === "bolusSaveFailed")'));
  ok("calculator: add-region action only looks up and navigates", /noSiteToastAction\(/.test(addSiteDef) && !/writeBolus|logInjection|insertInjection/.test(addSiteDef));
  ok("calculator: no-site save toast = addSite primary + undo secondary", /toast\(message, "success", addSiteAction\(undoAction\)\)/.test(calc));
  ok("calculator: retry success toast also offers addSite when no region", /chosenSite \? undefined : addSiteAction\(\)/.test(calc));
  ok("calculator: other saves keep undo as primary", /toast\(message, "success", undoAction\)/.test(calc));
  ok("feedback: announcement and press use the shared helpers", /toastAnnouncement\(message, action\)/.test(read("components/Feedback.tsx")) && /pickToastAction\(cur\.action, which\)/.test(read("components/Feedback.tsx")));

  console.log("C. entry guard offers 'add region' only for the same dose, in the window, region-less");
  type Inj = NonNullable<NonNullable<EntryGuardInput["recent"]>["injections"]>;
  const calcRow: Inj[number] = { id: "calc1", insulin_type: "bolus", dose_units: 3, logged_at: iso(5), source: "calculator", site: null };
  const guard = (injections: Inj, doseUnits: number | null = 3, insulinType: "bolus" | "basal" = "bolus") =>
    checkEntryGuards({ now, entryKind: "injection", insulinType, doseUnits, entryAtIso: iso(0), recent: { injections } });
  const offered = (n: ReturnType<typeof guard>) => n[0]?.detail?.addSiteToId;
  ok("region-less meal bolus, same dose, 5 min -> offered", offered(guard([calcRow])) === "calc1");
  ok("notice itself unchanged (kind, units)", guard([calcRow])[0]?.kind === "recent_bolus" && guard([calcRow])[0]?.detail?.units === 3);
  ok("different dose -> not offered", offered(guard([calcRow], 2)) === undefined);
  ok("no form dose -> not offered", offered(guard([calcRow], null)) === undefined);
  ok("4 U at 12:00, 2 U typed at 13:15 -> plain confirm", offered(guard([{ ...calcRow, dose_units: 4, logged_at: iso(75) }], 2)) === undefined && guard([{ ...calcRow, dose_units: 4, logged_at: iso(75) }], 2)[0]?.kind === "recent_bolus");
  ok("same dose but 20 min apart -> not offered", offered(guard([{ ...calcRow, logged_at: iso(20) }])) === undefined);
  ok("same dose at the 15 min edge -> offered", offered(guard([{ ...calcRow, logged_at: iso(15) }])) === "calc1");
  ok("row with a region -> not offered", offered(guard([{ ...calcRow, site: "abdomen_left" }])) === undefined);
  ok("manual region-less bolus -> not offered", offered(guard([{ ...calcRow, source: "manual" }])) === undefined);
  ok("row without source info -> not offered", offered(guard([{ id: "x", insulin_type: "bolus", dose_units: 3, logged_at: iso(5) }])) === undefined);
  ok("basal never offered", offered(guard([{ ...calcRow, insulin_type: "basal" }], 3, "basal")) === undefined);
  ok(
    "nearest row decides",
    offered(guard([calcRow, { id: "man", insulin_type: "bolus", dose_units: 3, logged_at: iso(1), source: "manual", site: "thigh_left" }])) === undefined
  );
  ok("offerAddSiteToRow: window is the double-bolus window", ADD_SITE_WINDOW_MINUTES === 15 && /DOUBLE_BOLUS_WINDOW_MINUTES = 15;/.test(read("lib/db/injections.ts")));
  ok("isRegionlessMealBolus", isRegionlessMealBolus(calcRow) && !isRegionlessMealBolus({ ...calcRow, site: "thigh_left" }));
  ok("offerAddSiteToRow direct: dose tolerance", offerAddSiteToRow({ row: calcRow, rowAtMs: now - 60_000, entryAtMs: now, doseUnits: 3.0 }));

  console.log("D. guard dialog flow with fake UI");
  const flow = async (choice: GuardAddSiteChoice, o: { addSiteId?: string; withCallback?: boolean; hasNotices?: boolean; confirmResult?: boolean } = {}) => {
    const opened: string[] = [];
    let confirms = 0;
    let choices = 0;
    const result = await runGuardDialog({
      hasNotices: o.hasNotices ?? true,
      addSiteId: "addSiteId" in o ? o.addSiteId : "calc1",
      onAddSite: o.withCallback === false ? undefined : (id) => void opened.push(id),
      confirmSave: async () => (confirms++, o.confirmResult ?? true),
      chooseAddSite: async () => (choices++, choice),
    });
    return { result, opened, confirms, choices };
  };
  {
    const r = await flow("addSite");
    ok("add region: save dropped, that row opened, only the 3-way dialog shown", r.result === false && r.opened.join() === "calc1" && r.choices === 1 && r.confirms === 0);
    const s = await flow("save");
    ok("save anyway: saves, opens nothing", s.result === true && s.opened.length === 0);
    const c = await flow("cancel");
    ok("cancel: no save, opens nothing", c.result === false && c.opened.length === 0);
    const noCb = await flow("addSite", { withCallback: false });
    ok("no onAddSite: plain confirm only, no offer", noCb.choices === 0 && noCb.confirms === 1 && noCb.result === true);
    const none = await flow("addSite", { addSiteId: undefined, confirmResult: false });
    ok("no eligible row: plain confirm decides", none.choices === 0 && none.confirms === 1 && none.result === false);
    const quiet = await flow("addSite", { hasNotices: false });
    ok("no notices: saves without any dialog", quiet.result === true && quiet.choices === 0 && quiet.confirms === 0);
  }
  ok("outcome table", JSON.stringify(guardAddSiteOutcome("addSite", "x")) === '{"save":false,"openEditId":"x"}' && guardAddSiteOutcome("cancel", "x").save === false && guardAddSiteOutcome("save", "x").save === true);

  console.log("E. wiring that cannot run under node");
  const hook = read("components/useEntryGuardConfirm.tsx");
  ok("hook delegates to runGuardDialog and passes the form dose through", /return runGuardDialog\(/.test(hook) && /doseUnits: req\.doseUnits/.test(hook) && /onAddSite: req\.onAddSite/.test(hook));
  ok("hook: dialog has add / save anyway / explicit cancel, dismiss = cancel", /cancelLabel: t\("entryGuard\.cancelSave"\)/.test(hook) && /onDismiss: \(\) => resolve\("cancel"\)/.test(hook) && /entryGuard\.addSiteBody/.test(hook));
  const screen = read("app/(tabs)/injection.tsx");
  const at = screen.indexOf("const openEditById");
  const open = screen.slice(at, at + 700);
  ok("screen: openEditById reads one row via loadEditRow with the active profile", /loadEditRow\(/.test(open) && /profileId: activeProfile\?\.id/.test(open) && /fetchRow: getInjection/.test(open) && !/logInjection/.test(open));
  ok("screen: edit request goes through handleEditRequest with clearParams", /handleEditRequest\(params/.test(screen) && /clearParams: \(\) => router\.setParams\(/.test(screen));
  ok("screen: guard gets dose and the chosen region as the sheet's preset", /doseUnits: dose,/.test(screen) && /openEditById\(id, \{ site: site\.site, point: site\.point \}\)/.test(screen) && /presetSite=\{editPreset\}/.test(screen));
  const sheet = read("components/InjectionEditSheet.tsx");
  ok("edit sheet only updates (no logInjection call) and honours the preset", !/logInjection\(/.test(sheet) && /updateInjection\(target\.id, patch\)/.test(sheet) && /presetSite \?\? null/.test(sheet));
  ok("injection tab no longer toasts the orientation change", !/flipNotice|injectionMapNotice|FlipNotice/.test(screen));
  ok("no stale reference to the removed notice module", !/injectionMapNotice/.test(read("lib/services/healthWritePrompt.ts")));
  for (const l of ["en", "tr", "de", "fr", "es", "it", "pt", "ar", "ja"]) {
    const src = read(`lib/i18n/locales/${l}.ts`);
    ok(
      `${l}: toast, guard dialog keys present, orientation key gone`,
      /\n    addSite: "/.test(src) && ["addSiteToRecord", "saveAnyway", "addSiteTitle", "addSiteBody", "cancelSave"].every((k) => src.includes(`    ${k}: "`)) && !src.includes("flipNotice")
    );
  }
  ok("tr toast text", read("lib/i18n/locales/tr.ts").includes("Doz, bölgesiz bir bolus olarak kaydedildi. Bölge eklemek için Bölge ekle'ye dokunun."));
  ok("tr dialog text", read("lib/i18n/locales/tr.ts").includes("Bu kayda bölge eklenir; yeni doz kaydedilmez.") && read("lib/i18n/locales/tr.ts").includes('cancelSave: "Vazgeç"'));

  console.log(`${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

void main();
