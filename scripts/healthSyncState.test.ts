/**
 * Background and foreground Health import state (K26): blocker reasons,
 * source='background' never prompts, concurrent triggers share one import,
 * the last-sync record and its error states, the duplicate rules on the
 * import path, the background registration, and the summary wrappers.
 * Run: npx tsx scripts/healthSyncState.test.ts
 */
declare const console: { log: (...a: unknown[]) => void };
declare const process: { exit: (c: number) => void };
import {
  crashes, eq, fake, finish, kv, ok, PLATFORM, resetAll, rows, section, sleep, tasks,
} from "./healthTestHarness";

async function main(): Promise<void> {
  // The Android task is defined at module scope, so load it as Android once.
  resetAll("android");
  const BG = await import("../lib/services/healthBackground");
  const S = await import("../lib/services/health");
  console.log("zerospike health sync state test");

  const arm = async (profile = "P") => {
    kv.set(`zerospike.cgmSync.${profile}`, "true");
    await S.setHealthBackgroundEntitled(true);
  };
  const g = (value: number, minutesAgo: number) => ({
    value,
    date: new Date(Date.parse("2026-10-05T12:00:00.000Z") - minutesAgo * 60_000).toISOString(),
    period_tag: "random",
  });

  section("A. getHealthBackgroundBlocker reasons, in order");
  resetAll("web");
  eq("no provider", await S.getHealthBackgroundBlocker(), "no_provider");
  resetAll("ios");
  eq("not entitled (fails closed, nothing stored)", await S.getHealthBackgroundBlocker(), "not_entitled");
  await S.setHealthBackgroundEntitled(false);
  eq("explicitly not entitled", await S.getHealthBackgroundBlocker(), "not_entitled");
  await S.setHealthBackgroundEntitled(true);
  rows.profiles = [];
  kv.delete("zerospike.activeProfile");
  eq("no profile", await S.getHealthBackgroundBlocker(), "no_profile");
  rows.profiles = [{ id: "P" }, { id: "Q" }];
  kv.set("zerospike.activeProfile", "P");
  eq("sync switch off", await S.getHealthBackgroundBlocker(), "sync_off");
  kv.set("zerospike.cgmSync.P", "true");
  fake.readGranted = false;
  eq("read not granted", await S.getHealthBackgroundBlocker(), "no_permission");
  fake.readGranted = true;
  fake.readGrantedThrows = true;
  eq("grant lookup throws -> no_permission", await S.getHealthBackgroundBlocker(), "no_permission");
  fake.readGrantedThrows = false;
  eq("all clear on iOS", await S.getHealthBackgroundBlocker(), null);
  fake.bgGranted = false;
  eq("iOS ignores the Android background grant", await S.getHealthBackgroundBlocker(), null);
  await S.setHealthBgSyncEnabled(false);
  eq("own background switch off wins over sync on", await S.getHealthBackgroundBlocker(), "sync_off");
  resetAll("android");
  await arm();
  fake.bgGranted = false;
  eq("android without READ_HEALTH_DATA_IN_BACKGROUND", await S.getHealthBackgroundBlocker(), "no_background_permission");
  fake.bgGranted = true;
  eq("android all clear", await S.getHealthBackgroundBlocker(), null);
  resetAll("ios");
  await arm("Q");
  eq("sync switch of another profile does not count", await S.getHealthBackgroundBlocker(), "sync_off");

  section("B. background switch default follows the sync switch");
  resetAll("ios");
  eq("nothing set -> off", await S.getHealthBgSyncEnabled(), false);
  kv.set("zerospike.cgmSync.P", "true");
  eq("sync on, bg unset -> on", await S.getHealthBgSyncEnabled(), true);
  await S.setHealthBgSyncEnabled(false);
  eq("explicit off wins", await S.getHealthBgSyncEnabled(), false);
  kv.set("zerospike.cgmSync.P", "false");
  await S.setHealthBgSyncEnabled(true);
  eq("explicit on wins over sync off", await S.getHealthBgSyncEnabled(), true);
  eq("other profile unaffected", await S.getHealthBgSyncEnabled("Q"), false);

  section("C. importHealthGlucose: permission by source");
  resetAll("ios");
  fake.glucose = [g(110, 5)];
  const man = await S.importHealthGlucose("P", "manual");
  eq("manual ok", man.status, "ok");
  eq("manual asks for read permission", fake.requestReadCalls, 1);
  const bg = await S.importHealthGlucose("P", "background");
  eq("background never prompts", fake.requestReadCalls, 1);
  eq("duplicate of the first import inserted nothing", bg.inserted, 0);
  fake.readGranted = false;
  const den = await S.importHealthGlucose("P", "background");
  eq("background without grant -> denied", den.status, "denied");
  eq("still no prompt", fake.requestReadCalls, 1);
  fake.available = false;
  eq("unavailable store", (await S.importHealthGlucose("P", "foreground")).status, "unavailable");

  section("D. concurrent triggers share one import");
  resetAll("ios");
  fake.glucose = [g(120, 5), g(130, 40)];
  fake.readDelayMs = 40;
  const [r1, r2, r3] = await Promise.all([
    S.importHealthGlucose("P", "background"),
    S.importHealthGlucose("P", "foreground"),
    S.importHealthGlucose("P", "background"),
  ]);
  eq("one native read", fake.readCalls, 1);
  eq("same inserted count", `${r1.inserted}${r2.inserted}${r3.inserted}`, "222");
  eq("two rows, not six", rows.sugar.length, 2);
  await S.importHealthGlucose("P", "background");
  eq("a later call reads again", fake.readCalls, 2);
  await Promise.all([S.importHealthGlucose("P"), S.importHealthGlucose("Q")]);
  eq("different profiles do not share", fake.readCalls, 4);

  section("E. getHealthLastSync fields and error states");
  resetAll("ios");
  eq("nothing yet", await S.getHealthLastSync(), null);
  fake.glucose = [g(100, 1), g(101, 90)];
  await S.importHealthGlucose("P", "background");
  const ls = (await S.getHealthLastSync())!;
  eq("status", ls.status, "ok");
  eq("inserted", ls.inserted, 2);
  eq("read", ls.read, 2);
  eq("source", ls.source, "background");
  eq("no error", ls.error, null);
  ok("atIso is an ISO time", Number.isFinite(Date.parse(ls.atIso)));
  eq("other profile has none", await S.getHealthLastSync("Q"), null);
  fake.readGranted = false;
  await S.importHealthGlucose("P", "background");
  const d = (await S.getHealthLastSync())!;
  eq("denied status", d.status, "denied");
  eq("denied error", d.error, "denied");
  fake.available = false;
  await S.importHealthGlucose("P", "manual");
  const u = (await S.getHealthLastSync())!;
  eq("unavailable error", u.error, "unavailable");
  eq("manual source", u.source, "manual");
  kv.set("zerospike.healthLastSync.P", "{not json");
  eq("corrupt JSON -> null", await S.getHealthLastSync(), null);
  kv.set("zerospike.healthLastSync.P", JSON.stringify({ atIso: "2026-10-05T00:00:00.000Z", status: "weird" }));
  eq("unknown status -> null", await S.getHealthLastSync(), null);
  kv.set("zerospike.healthLastSync.P", JSON.stringify({ status: "ok" }));
  eq("missing time -> null", await S.getHealthLastSync(), null);
  kv.set("zerospike.healthLastSync.P", JSON.stringify({ atIso: "2026-10-05T00:00:00.000Z", status: "ok", source: "x", error: "y", inserted: "n" }));
  const sane = (await S.getHealthLastSync())!;
  eq("unknown source -> manual", sane.source, "manual");
  eq("unknown error -> null", sane.error, null);
  eq("non-numeric counts -> 0", sane.inserted + sane.read, 0);
  eq("explicit profile id", (await S.getHealthLastSync("P"))?.status, "ok");

  section("F. duplicate rules on the new (background) path");
  resetAll("ios");
  rows.sugar.push({ profile_id: "P", glucose_level_mgdl: 140, logged_at: g(140, 10).date, source: "manual" });
  fake.glucose = [g(140, 12), g(140, 60), g(150, 12), g(0, 5), g(Number.NaN, 5)];
  const dd = await S.importHealthGlucose("P", "background");
  eq("read counts every sample from the store", dd.read, 5);
  eq("manual entry within 15 min + same value is skipped; later and other values kept", dd.inserted, 2);
  eq("rows now", rows.sugar.length, 3);
  const again = await S.importHealthGlucose("P", "background");
  eq("repeating the import adds nothing", again.inserted, 0);
  eq("same sample of a second profile is its own row", (fake.glucose = [g(140, 12)], (await S.importHealthGlucose("Q", "background")).inserted), 1);

  section("G. syncHealthInBackground");
  resetAll("ios");
  eq("blocked -> skipped with the reason", (await S.syncHealthInBackground()).skipped, "not_entitled");
  await arm();
  fake.glucose = [g(111, 3)];
  let bumps = 0;
  const off = S.subscribeHealthBackgroundImport(() => { bumps++; });
  S.subscribeHealthBackgroundImport(() => { throw new Error("listener broke"); });
  const o = await S.syncHealthInBackground();
  eq("ran", o.ran, true);
  eq("inserted", o.result?.inserted, 1);
  eq("source recorded as background", (await S.getHealthLastSync())?.source, "background");
  eq("never prompted", fake.requestReadCalls, 0);
  eq("listener told", bumps, 1);
  const o2 = await S.syncHealthInBackground();
  eq("nothing new -> listener quiet", bumps, 1);
  eq("ran with 0 inserted", o2.result?.inserted, 0);
  off();
  fake.glucose = [g(150, 2)];
  await S.syncHealthInBackground();
  eq("unsubscribed listener not called", bumps, 1);
  eq("iOS has no change token to commit", fake.commits, 0);
  resetAll("android");
  await arm();
  fake.peekChanged = false;
  fake.glucose = [g(111, 3)];
  const un = await S.syncHealthInBackground();
  eq("unchanged -> skipped", un.skipped, "unchanged");
  eq("no read when unchanged", fake.readCalls, 0);
  fake.peekChanged = true;
  const ch = await S.syncHealthInBackground();
  eq("changed -> ran", ch.ran, true);
  eq("token committed after the successful import", fake.commits, 1);
  fake.readGranted = false;
  const dn = await S.syncHealthInBackground();
  eq("android denied is a blocker, not a run", dn.skipped, "no_permission");
  eq("denied does not commit", fake.commits, 1);

  section("H. registerHealthBackground (iOS observer)");
  resetAll("ios");
  eq("blocked -> inactive with reason", JSON.stringify(await BG.registerHealthBackground()), JSON.stringify({ active: false, reason: "not_entitled" }));
  eq("blocked stops the observer", fake.observerStops, 1);
  await arm();
  fake.glucose = [g(105, 4)];
  const st = await BG.registerHealthBackground();
  eq("active", st.active, true);
  eq("observer started", fake.observerStarts, 1);
  fake.readDelayMs = 40;
  fake.glucose = [g(106, 2)];
  fake.observerCb?.();
  fake.observerCb?.();
  fake.observerCb?.();
  await sleep(120);
  eq("an observer burst reads once", fake.readCalls, 1);
  eq("and inserted once", rows.sugar.length, 1);
  fake.observerOk = false;
  eq("observer refused -> register_failed", (await BG.registerHealthBackground()).reason, "register_failed");
  resetAll("web");
  eq("unsupported platform", (await BG.registerHealthBackground()).reason, "unsupported_platform");

  section("I. registerHealthBackground and the task (Android)");
  resetAll("android");
  tasks.registered.clear();
  tasks.registerArgs.length = 0;
  ok("task defined at module scope", tasks.defined.has(BG.HEALTH_BACKGROUND_TASK));
  eq("blocked (not entitled) registers nothing", tasks.registered.size, 0);
  eq("blocked reason", (await BG.registerHealthBackground()).reason, "not_entitled");
  await arm();
  fake.bgGranted = false;
  eq("without background permission", (await BG.registerHealthBackground()).reason, "no_background_permission");
  eq("still unregistered", tasks.registered.size, 0);
  fake.bgGranted = true;
  const ra = await BG.registerHealthBackground();
  eq("active", ra.active, true);
  eq("registered", tasks.registered.has(BG.HEALTH_BACKGROUND_TASK), true);
  eq("15 minute floor", (tasks.registerArgs[0] as any).minimumInterval, 15);
  await BG.registerHealthBackground();
  eq("second registration is not repeated", tasks.registerArgs.length, 1);
  tasks.status = 1;
  tasks.registered.clear();
  eq("restricted by the OS -> register_failed", (await BG.registerHealthBackground()).reason, "register_failed");
  tasks.status = 2;
  fake.bgGranted = false;
  await BG.registerHealthBackground();
  eq("losing the permission unregisters", tasks.registered.size, 0);
  fake.bgGranted = true;
  fake.peekChanged = true;
  fake.glucose = [g(131, 2)];
  const run = tasks.defined.get(BG.HEALTH_BACKGROUND_TASK)!;
  eq("task run -> Success", await run(), 1);
  eq("task imported", rows.sugar.length, 1);
  const acc = await BG.requestHealthBackgroundAccess();
  eq("request access re-registers", acc.active, true);

  section("J. readHealthSummary wrapper");
  resetAll("ios");
  fake.summary = { activeMinutes: 20, insulin: { basalUnits: 1, bolusUnits: 2, count: 3 } };
  eq("passes the provider summary", (await S.readHealthSummary(30)).insulin?.count, 3);
  fake.summaryThrows = true;
  eq("provider error -> all null", JSON.stringify(await S.readHealthSummary(30)), JSON.stringify({ activeMinutes: null, insulin: null }));
  resetAll("web");
  eq("no provider -> all null", JSON.stringify(await S.readHealthSummary(30)), JSON.stringify({ activeMinutes: null, insulin: null }));
  ok("platform check only", PLATFORM.OS === "web");

  eq("no crash was logged along the way", crashes.length, 0);
  finish();
}

main().catch((e) => {
  console.log("fatal", e);
  process.exit(1);
});
