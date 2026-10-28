/**
 * G253-FIX-A, set-up (A-2, A-3, A-5, A-6, A-9, A-10): choosing CGM switches the
 * Health import on through the permission flow, an unconfigured Nightscout shows
 * its form, the last onboarding answer always wins, a missing Health Connect
 * disables the CGM option, Libre offers the manual route, and leaving CGM for
 * manual entry does not bring the offer card straight back.
 *
 * Real lib/cgm/state.ts, brand.ts, onboardingSteps.ts, healthConnect.ts and
 * nightscout/sync.ts over an in-memory AsyncStorage and a scripted Health
 * Connect module. Run: npx tsx scripts/g253FixAOnboarding.test.ts
 */
import Module from "node:module";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const kv = new Map<string, string>();
const AsyncStorage = {
  getItem: async (k: string) => (kv.has(k) ? kv.get(k)! : null),
  setItem: async (k: string, v: string) => void kv.set(k, v),
  removeItem: async (k: string) => void kv.delete(k),
  multiRemove: async (ks: string[]) => void ks.forEach((k) => kv.delete(k)),
};
const platform = { OS: "android" as "android" | "ios" };
const hc = { sdkStatus: 3, requestCalls: 0 };
const HC = {
  getSdkStatus: async () => hc.sdkStatus,
  initialize: async () => true,
  getGrantedPermissions: async () => [] as unknown[],
  requestPermission: async () => {
    hc.requestCalls++;
    return [];
  },
};
const M = Module as unknown as { _load: (...a: unknown[]) => unknown };
const realLoad = M._load;
M._load = function (this: unknown, request: string, ...rest: unknown[]) {
  if (request === "@react-native-async-storage/async-storage") return { __esModule: true, default: AsyncStorage };
  if (request === "react-native") {
    return { Platform: platform, AppState: { currentState: "active", addEventListener: () => ({ remove() {} }) } };
  }
  if (request === "react-native-health-connect") return HC;
  if (request === "../analytics") return { logCrash: () => {}, logEvent: () => {} };
  return realLoad.call(this, request, ...rest);
};

let passed = 0;
let failed = 0;
function eq(name: string, got: unknown, want: unknown): void {
  if (JSON.stringify(got) === JSON.stringify(want)) passed++;
  else {
    failed++;
    console.log(`  FAIL ${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  }
}
function ok(name: string, cond: boolean): void {
  eq(name, cond, true);
}
const ROOT = join(__dirname, "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

async function main(): Promise<void> {
  const state = await import("../lib/cgm/state");
  const brand = await import("../lib/cgm/brand");
  const steps = await import("../lib/onboardingSteps");
  const avail = await import("../lib/cgm/sourceAvailability");
  const { getHealthConnectStatus } = await import("../lib/services/healthConnect");
  const { readNightscoutState } = await import("../lib/nightscout/sync");
  const { cgmBrandMessageKeys } = brand;
  const { glucoseReminderPaused } = await import("../lib/cgm/reminderMode");

  console.log("A-5. the last onboarding answer wins");
  {
    kv.clear();
    // Attempt 1: CGM + Libre, the app closed on the reveal.
    await state.setCgmMode("p1", steps.measureModeToWrite("cgm"), { keepOffer: true });
    await brand.setCgmBrand("p1", "libre");
    // Attempt 2: finger prick. The same writes the finish makes.
    const mode = steps.measureModeToWrite("finger");
    eq("the finger prick is a mode to write", mode, "manual");
    await state.setCgmMode("p1", mode, { keepOffer: true });
    await brand.clearCgmBrand("p1");
    eq("profile is manual again", await state.getCgmMode("p1"), "manual");
    eq("the old brand is gone", await brand.getCgmBrand("p1"), null);
    eq("a reset is not an answer to the offer", await state.getCgmOfferAnswer("p1"), null);
    const onb = read("app/onboarding.tsx");
    ok("finish always writes the mode", /await setCgmMode\(activeProfile\.id, cgmMode, \{ keepOffer: true \}\);/.test(onb));
    ok("finish clears the brand outside CGM", onb.includes("clearCgmBrand(activeProfile.id)"));
    ok("finish writes the Health switch", /writeProfileFlag\(HEALTH_IMPORT_FLAG, activeProfile\.id, measureEnablesHealthImport\(effMeasure\)\)/.test(onb));
  }

  console.log("A-10. leaving CGM on purpose settles the offer");
  {
    kv.clear();
    await state.setCgmMode("p1", "cgm");
    await state.setCgmMode("p1", "manual");
    eq("the answer is recorded as declined", await state.getCgmOfferAnswer("p1"), "declined");
    eq("so the card is not due", await state.shouldOfferCgmSwitch("p1", { countRecent: async () => 200 }), false);
    kv.clear();
    await state.setCgmMode("p2", "manual");
    eq("manual to manual records nothing", await state.getCgmOfferAnswer("p2"), null);
    eq("a fresh manual profile still gets the offer", await state.shouldOfferCgmSwitch("p2", { countRecent: async () => 200 }), true);
    await state.setCgmMode("p3", "nightscout");
    await state.setCgmMode("p3", "manual");
    eq("Nightscout to manual settles it too", await state.getCgmOfferAnswer("p3"), "declined");
    await state.markCgmOfferShown("p4", "accepted");
    eq("accepting still moves the profile to CGM", await state.getCgmMode("p4"), "cgm");
  }

  console.log("A-9. Libre offers the manual route");
  {
    eq("Libre note still says to keep logging by hand", cgmBrandMessageKeys("libre", true).includes("cgmBrand.manualLine"), true);
    eq("the default after Libre is manual entry", steps.DEFAULT_LIBRE_CHOICE, "manual");
    eq("Libre + default acts as the finger prick", steps.effectiveMeasure("cgm", "libre", "manual"), "finger");
    eq("Libre + stay keeps CGM", steps.effectiveMeasure("cgm", "libre", "cgm"), "cgm");
    eq("Dexcom is unaffected by the choice", steps.effectiveMeasure("cgm", "dexcom", "manual"), "cgm");
    eq("no brand yet is unaffected", steps.effectiveMeasure("cgm", null, "manual"), "cgm");
    eq("Nightscout is unaffected", steps.effectiveMeasure("nightscout", "libre", "manual"), "nightscout");
    eq("the question is asked only for CGM + Libre", [steps.libreAsksChoice("cgm", "libre"), steps.libreAsksChoice("finger", "libre"), steps.libreAsksChoice("cgm", "dexcom")], [true, false, false]);
    const flags = { isTwoWayTreatment: false, hasInsulin: false, hasOralMeds: true };
    const manualSteps = steps.buildOnboardingSteps({ ...flags, measure: steps.effectiveMeasure("cgm", "libre", "manual") });
    ok("with the manual route the measurement reminder step is back", manualSteps.includes("reminderPlan"));
    const cgmSteps = steps.buildOnboardingSteps({ ...flags, measure: steps.effectiveMeasure("cgm", "libre", "cgm") });
    ok("staying in CGM drops it as before", !cgmSteps.includes("reminderPlan"));
    eq("manual route writes manual", steps.measureModeToWrite(steps.effectiveMeasure("cgm", "libre", "manual")), "manual");
    ok("a glucose reminder is not paused in manual mode", !glucoseReminderPaused({ id: "r1", type: "glucose" }, "manual", new Set()));
    const onb = read("app/onboarding.tsx");
    ok("onboarding shows the two choices", onb.includes('t("onboarding.libreManual")') && onb.includes('t("onboarding.libreCgm")'));
    ok("the plan rows follow the effective answer", onb.includes("skipsMeasurementReminders(effMeasure)"));
  }

  console.log("A-6. Health Connect missing or outdated");
  {
    platform.OS = "android";
    for (const [sdk, gate] of [[1, "install"], [2, "update"], [3, "ready"]] as const) {
      hc.sdkStatus = sdk;
      const status = await getHealthConnectStatus();
      eq(`SDK ${sdk} -> gate ${gate}`, avail.cgmChoiceGate({ os: "android", status }), gate);
    }
    eq("iOS has no such gate", avail.cgmChoiceGate({ os: "ios", status: "unavailable" }), "ready");
    eq("status not known yet does not block", avail.cgmChoiceGate({ os: "android", status: null }), "ready");
    ok("the Play link is Health Connect's listing", avail.HEALTH_CONNECT_PLAY_URL.includes("com.google.android.apps.healthdata"));
    const onb = read("app/onboarding.tsx");
    ok("onboarding dims the CGM card and explains", onb.includes("dimmed={opt === \"cgm\" && hcGate !== \"ready\"}") && onb.includes("onboarding.measureCgmNeedsHcUpdate"));
    ok("picking it opens the listing instead of asking", /hcGate !== "ready" && \(await cgmChoiceGateNow\([^)]*\)\) !== "ready"\) \{\s*void Linking\.openURL\(HEALTH_CONNECT_PLAY_URL\)/.test(onb));
    const ds = read("app/settings/data-sources.tsx");
    ok("data sources dims it too", ds.includes('dimmed: hcGate !== "ready"'));
    const dash = read("app/(tabs)/index.tsx");
    ok("the card says an update is needed", dash.includes('"dashboard.healthNeedsUpdate"'));
    ok("a tap with a missing HC never reaches the permission request", /if \(!\(await healthGateOpen\(\)\)\) return;\s*setCgmOn\(true\);/.test(dash));
    ok("and the dashboard asks for a fresh status first, not its cached gate", dash.includes("cgmChoiceGateNow(Platform.OS, getHealthConnectStatus)") && /void \(async \(\) => \{\s*if \(!\(await healthGateOpen\(\)\)\) return;/.test(dash));
    eq("no permission sheet was raised by any of this", hc.requestCalls, 0);
  }

  console.log("A-2. choosing CGM turns the import on, from the screen that can");
  {
    const ds = read("app/settings/data-sources.tsx");
    ok("switching to CGM runs the connect flow", /if \(next === "cgm"\) void enableSync\(\);/.test(ds));
    ok("through the shared health flow", ds.includes("connectHealthSync(flow,") && ds.includes("createHealthFlow("));
    ok("the dead 'open data settings' row is gone", !ds.includes("dataSources.openData") && !ds.includes('router.push("/settings/data")'));
    ok("a button turns syncing on", ds.includes('t("dataSources.enableSync")'));
    ok("the off-switch text shows only while it is off", /syncOn === false \? \(\s*<Txt kind="caption" tone="muted">\s*\{t\("dataSources\.needsHealth"/.test(ds));
    const en = read("lib/i18n/locales/en.ts");
    ok("the text no longer sends people to a screen with no switch", !/needsHealth: "[^"]*data settings/.test(en));
  }

  console.log("A-3. an unconfigured Nightscout shows its form");
  {
    kv.clear();
    await AsyncStorage.setItem("zerospike.cgmMode.p1", "nightscout");
    const deps = {
      storage: AsyncStorage,
      secure: { get: async () => null, set: async () => {}, remove: async () => {} },
      insert: async () => 0,
    };
    const s = await readNightscoutState("p1", deps as never);
    eq("mode nightscout without an address is not connected", s.connected, false);
    const ds = read("app/settings/data-sources.tsx");
    ok("the panel is told the real connection", ds.includes('connected={mode === "nightscout" && nsConnected}'));
    ok("and that the mode is already Nightscout", ds.includes('modeIsNightscout={mode === "nightscout"}'));
    ok("the status reads 'not set up'", ds.includes('t("nightscout.notSetUp")'));
    ok("tapping the card opens the form when nothing is connected", ds.includes('if (mode !== "nightscout" || !nsConnected) setNsFormOpen(true);'));
    ok("the connection is read from the real state", ds.includes("(await getNightscoutState(profileId)).connected"));
  }

  console.log("A-1. the waiting text tells a free profile the truth");
  {
    const home = read("components/CgmHomeCard.tsx");
    ok("the card picks the free text for a free CGM profile", home.includes('mode === "cgm" && !isPro ? "cgmHome.waitingBodyFree" : "cgmHome.waitingBody"'));
    for (const l of ["en", "tr", "de", "fr", "es", "it", "pt", "ar", "ja"]) {
      ok(`${l}: waitingBodyFree exists`, /waitingBodyFree: "[^"]+"/.test(read(`lib/i18n/locales/${l}.ts`)));
    }
    ok("en names the 24 hours and Pro", /waitingBodyFree: "[^"]*24 hours[^"]*Pro/.test(read("lib/i18n/locales/en.ts")));
    const dash = read("app/(tabs)/index.tsx");
    ok("free CGM profiles import in the foreground", dash.includes("freeWindow: !isProUser") && dash.includes("healthImportAllowed({ isPro: isProUser, mode: dataMode })"));
    ok("and again when the app comes back", dash.includes("latestRef.current.resumeFreeSync();"));
    ok("the open-time run waits for the mode before deciding", dash.includes('if (importGate === "pending") return;'));
  }

  console.log(failed ? `${failed} failed, ${passed} passed` : `${passed} passed`);
  process.exit(failed > 0 ? 1 : 0);
}

void main();
