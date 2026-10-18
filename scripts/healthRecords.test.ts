/**
 * Carbohydrate and insulin mirror (K26): the pure rewrite decisions in
 * lib/healthRecords.ts, the db hook seam, and the health.ts wrappers
 * (switches, mirrorHealthRecord outcomes, edit order, delete queue, revoke,
 * active-profile gate) on fake providers and an in-memory db.
 * Run: npx tsx scripts/healthRecords.test.ts
 */
declare const console: { log: (...a: unknown[]) => void };
declare const process: { exit: (c: number) => void };
import {
  crashes, eq, fake, finish, kv, meal, ok, PLATFORM, resetAll, rows, section, shot, until,
} from "./healthTestHarness";

async function main(): Promise<void> {
  const H = await import("../lib/healthRecords");
  const S = await import("../lib/services/health");
  const Hooks = await import("../lib/db/healthRecordHooks");
  console.log("zerospike health records test");

  const on = (kind: "carbs" | "insulin", profile = "P") =>
    kv.set(`zerospike.healthWrite${kind === "carbs" ? "Carbs" : "Insulin"}.${profile}`, "1");
  const idle = () => S.healthIdleForTests();

  section("A. mealRecordInput");
  eq("40 g -> input", H.mealRecordInput(meal() as any)?.kind, "carbs");
  eq("grams carried", (H.mealRecordInput(meal({ calculated_carbs_g: 12.5 }) as any) as any).grams, 12.5);
  eq("0 g -> no write", H.mealRecordInput(meal({ calculated_carbs_g: 0 }) as any), null);
  eq("negative -> no write", H.mealRecordInput(meal({ calculated_carbs_g: -3 }) as any), null);
  eq("null -> no write", H.mealRecordInput(meal({ calculated_carbs_g: null }) as any), null);
  eq("NaN -> no write", H.mealRecordInput(meal({ calculated_carbs_g: "abc" }) as any), null);
  eq("Infinity -> no write", H.mealRecordInput(meal({ calculated_carbs_g: Infinity }) as any), null);

  section("B. injectionRecordInput (basal and bolus meta)");
  const b = H.injectionRecordInput(shot() as any) as any;
  eq("bolus kind", b.insulinKind, "bolus");
  eq("units", b.units, 4);
  eq("insulin kind field", b.kind, "insulin");
  eq("basal kept", (H.injectionRecordInput(shot({ insulin_type: "basal" }) as any) as any).insulinKind, "basal");
  eq("other type -> none", H.injectionRecordInput(shot({ insulin_type: "mixed" }) as any), null);
  eq("null type -> none", H.injectionRecordInput(shot({ insulin_type: null }) as any), null);
  eq("0 units -> none", H.injectionRecordInput(shot({ dose_units: 0 }) as any), null);
  eq("null dose -> none", H.injectionRecordInput(shot({ dose_units: null }) as any), null);

  section("C. needsMirror: which edits rewrite");
  const m0 = H.mealRecordInput(meal() as any);
  eq("no input -> never", H.needsMirror(null, m0), false);
  eq("first save -> write", H.needsMirror(m0, null), true);
  eq("same values (note or tag edit) -> no rewrite", H.needsMirror(H.mealRecordInput(meal({ note: "x" }) as any), m0), false);
  eq("time change -> rewrite", H.needsMirror(H.mealRecordInput(meal({ logged_at: "2026-10-05T13:00:00.000Z" }) as any), m0), true);
  eq("grams change -> rewrite", H.needsMirror(H.mealRecordInput(meal({ calculated_carbs_g: 41 }) as any), m0), true);
  eq("previous had 0 g (null) -> write", H.needsMirror(m0, H.mealRecordInput(meal({ calculated_carbs_g: 0 }) as any)), true);
  const i0 = H.injectionRecordInput(shot() as any);
  eq("insulin same -> no rewrite", H.needsMirror(H.injectionRecordInput(shot({ note: "n" }) as any), i0), false);
  eq("dose change -> rewrite", H.needsMirror(H.injectionRecordInput(shot({ dose_units: 5 }) as any), i0), true);
  eq("type change -> rewrite", H.needsMirror(H.injectionRecordInput(shot({ insulin_type: "basal" }) as any), i0), true);
  eq("time change -> rewrite", H.needsMirror(H.injectionRecordInput(shot({ logged_at: "2026-10-05T12:05:00.000Z" }) as any), i0), true);
  eq("kind mismatch -> rewrite", H.needsMirror(m0, i0), true);

  section("E. switches: default OFF, per profile, per kind, no insulin on Android");
  resetAll("ios");
  eq("carbs default off", await S.getHealthKindWriteEnabled("carbs"), false);
  eq("insulin default off", await S.getHealthKindWriteEnabled("insulin"), false);
  await S.setHealthKindWriteEnabled("carbs", true);
  eq("carbs on for active profile", await S.getHealthKindWriteEnabled("carbs"), true);
  eq("insulin untouched", await S.getHealthKindWriteEnabled("insulin"), false);
  eq("other profile still off", await S.getHealthKindWriteEnabled("carbs", "Q"), false);
  await S.setHealthKindWriteEnabled("insulin", true, "Q");
  eq("explicit profile id", await S.getHealthKindWriteEnabled("insulin", "Q"), true);
  eq("not leaked to active", await S.getHealthKindWriteEnabled("insulin"), false);
  await S.setHealthKindWriteEnabled("carbs", false);
  eq("turned off again", await S.getHealthKindWriteEnabled("carbs"), false);
  resetAll("android");
  await S.setHealthKindWriteEnabled("insulin", true);
  eq("android insulin reads off even if stored", await S.getHealthKindWriteEnabled("insulin"), false);
  eq("android insulin unsupported", S.isHealthKindWriteSupported("insulin"), false);
  eq("android carbs supported", S.isHealthKindWriteSupported("carbs"), true);
  eq("android insulin permission is refused", await S.requestHealthKindWritePermission("insulin"), false);
  resetAll("web");
  eq("no provider: nothing supported", S.isHealthKindWriteSupported("carbs"), false);

  section("F. mirrorHealthRecord outcomes");
  resetAll("ios");
  const cIn = H.mealRecordInput(meal() as any)!;
  const iIn = H.injectionRecordInput(shot() as any)!;
  eq("switch off -> skipped", (await S.mirrorHealthRecord(cIn)).outcome, "skipped");
  eq("skipped wrote nothing", fake.samples.size, 0);
  on("carbs");
  const w = await S.mirrorHealthRecord(cIn);
  eq("written", w.outcome, "written");
  ok("uuid returned", typeof w.uuid === "string" && w.uuid!.length > 0);
  eq("sample is carbs with grams", `${fake.samples.get(w.uuid!)?.kind}:${fake.samples.get(w.uuid!)?.value}`, "carbs:40");
  eq("sync id is the row id", fake.samples.get(w.uuid!)?.meta?.recordId, "m1");
  eq("insulin switch still off -> skipped", (await S.mirrorHealthRecord(iIn)).outcome, "skipped");
  on("insulin");
  const wi = await S.mirrorHealthRecord(iIn);
  eq("insulin written", wi.outcome, "written");
  eq("insulin kind passed", fake.samples.get(wi.uuid!)?.insulinKind, "bolus");
  const other = H.mealRecordInput(meal({ id: "m9", profile_id: "Q" }) as any)!;
  on("carbs", "Q");
  eq("record of a non-active profile -> skipped even if its switch is on", (await S.mirrorHealthRecord(other)).outcome, "skipped");
  eq("NaN grams -> skipped", (await S.mirrorHealthRecord({ ...cIn, grams: NaN })).outcome, "skipped");
  resetAll("android");
  on("insulin");
  eq("android insulin -> unsupported", (await S.mirrorHealthRecord(iIn)).outcome, "unsupported");
  eq("unsupported wrote nothing", fake.samples.size, 0);
  on("carbs");
  eq("android carbs written", (await S.mirrorHealthRecord(cIn)).outcome, "written");
  resetAll("web");
  eq("no provider -> skipped", (await S.mirrorHealthRecord(cIn)).outcome, "skipped");

  section("G. failures: queue, permission, retry ids");
  resetAll("ios");
  on("carbs");
  fake.failWrites = 1;
  const f = await S.mirrorHealthRecord(cIn);
  eq("native returns nothing -> failed", f.outcome, "failed");
  eq("failed has no uuid", f.uuid, null);
  eq("failed id queued for retry", (await S.getHealthRecordRetryIds("carbs", "P")).join(), "m1");
  eq("queue is per kind", (await S.getHealthRecordRetryIds("insulin", "P")).length, 0);
  eq("queue is per profile", (await S.getHealthRecordRetryIds("carbs", "Q")).length, 0);
  eq("user is told once", S.takeHealthWriteFailureNotice(), true);
  const ok2 = await S.mirrorHealthRecord(cIn);
  eq("retry writes", ok2.outcome, "written");
  eq("success leaves the queue", (await S.getHealthRecordRetryIds("carbs", "P")).length, 0);
  fake.authorized = false;
  fake.requestGrant = false;
  const denied = await S.mirrorHealthRecord({ ...cIn, id: "m2" });
  eq("unauthorized -> failed", denied.outcome, "failed");
  eq("never asks for the permission", fake.ops.filter((o) => o === "requestKind").length, 0);
  eq("refused queue holds the id", (await S.getHealthRecordRetryIds("carbs", "P")).join(), "m2");
  fake.authorized = true;
  eq("authorized later -> written", (await S.mirrorHealthRecord({ ...cIn, id: "m2" })).outcome, "written");
  await S.clearHealthRecordRetryIds("carbs", "P", ["m2"]);
  eq("clear is explicit and idempotent", (await S.getHealthRecordRetryIds("carbs", "P")).length, 0);

  section("H. edit: new sample first, old one revoked after; failed rewrite keeps the old");
  resetAll("ios");
  on("carbs");
  const first = await S.mirrorHealthRecord(cIn);
  fake.ops.length = 0;
  const second = await S.mirrorHealthRecord({ ...cIn, grams: 55 }, [first.uuid]);
  eq("edit written", second.outcome, "written");
  ok("new uuid differs", second.uuid !== first.uuid);
  eq("order: write then delete", fake.ops.join("|"), `write:carbs:${second.uuid}|delete:carbs:${first.uuid}`);
  eq("only the new sample remains", [...fake.samples.keys()].join(), second.uuid!);
  eq("holds the new value", fake.samples.get(second.uuid!)?.value, 55);
  fake.failWrites = 1;
  const third = await S.mirrorHealthRecord({ ...cIn, grams: 60 }, [second.uuid]);
  eq("failed rewrite", third.outcome, "failed");
  ok("old sample kept", fake.samples.has(second.uuid!));
  const same = await S.mirrorHealthRecord({ ...cIn, grams: 60 }, [undefined, null, ""]);
  eq("empty held ids are ignored", same.outcome, "written");

  section("I. delete queue: failed revoke queues, retry drains");
  resetAll("ios");
  on("carbs");
  const wr = await S.mirrorHealthRecord(cIn);
  fake.failDeletes = true;
  eq("revoke that fails deletes none now", await S.revokeHealthRecords("carbs", [wr.uuid!]), 0);
  ok("sample still in store", fake.samples.has(wr.uuid!));
  const stuck = await S.retryPendingHealthRecordDeletes("carbs");
  eq("retry attempted the queued id", stuck.attempted, 1);
  eq("store still refusing -> none succeeded", stuck.succeeded, 0);
  fake.failDeletes = false;
  const drained = await S.retryPendingHealthRecordDeletes("carbs");
  eq("retry succeeds", drained.succeeded, 1);
  eq("sample gone", fake.samples.size, 0);
  eq("queue empty afterwards", (await S.retryPendingHealthRecordDeletes("carbs")).attempted, 0);
  eq("insulin queue is separate", (await S.retryPendingHealthRecordDeletes("insulin")).attempted, 0);
  eq("revoke of nothing", await S.revokeHealthRecords("carbs", []), 0);
  resetAll("android");
  eq("android insulin revoke is a no-op", await S.revokeHealthRecords("insulin", ["x"]), 0);
  eq("android insulin retry is a no-op", (await S.retryPendingHealthRecordDeletes("insulin")).attempted, 0);
  resetAll("ios");
  eq("revoke is not gated on the switch (user asked for removal)", await S.revokeHealthRecords("carbs", ["gone"]), 1);
  eq("deleteHealthRecord with no uuid is a no-op", (await S.deleteHealthRecord("carbs", "m1", null), fake.ops.length), 1);

  section("J. lib/healthRecords wiring through the hooks");
  resetAll("ios");
  on("carbs");
  on("insulin");
  const m = meal();
  rows.meals.set("m1", m);
  Hooks.emitMealSaved({ ...m } as any, null);
  ok("first save writes and links", await until(() => rows.meals.get("m1").health_uuid != null));
  await idle();
  const link1 = rows.meals.get("m1").health_uuid;
  eq("one sample", fake.samples.size, 1);
  const writesBefore = fake.ops.length;
  Hooks.emitMealSaved({ ...m, note: "lunch" } as any, { ...m } as any);
  await new Promise((r) => setTimeout(r, 30));
  await idle();
  eq("note edit does not rewrite", fake.ops.length, writesBefore);
  const edited = { ...m, calculated_carbs_g: 70, health_uuid: link1 };
  rows.meals.set("m1", edited);
  Hooks.emitMealSaved(edited as any, { ...m, health_uuid: link1 } as any);
  ok("gram change rewrites", await until(() => rows.meals.get("m1").health_uuid !== link1));
  await idle();
  eq("still one sample", fake.samples.size, 1);
  eq("holds 70", [...fake.samples.values()][0].value, 70);
  const link2 = rows.meals.get("m1").health_uuid;
  const zeroed = { ...edited, calculated_carbs_g: 0, health_uuid: link2 };
  rows.meals.set("m1", zeroed);
  Hooks.emitMealSaved(zeroed as any, edited as any);
  ok("carbs set to 0 drops the link", await until(() => rows.meals.get("m1").health_uuid === null));
  await idle();
  ok("and removes the sample", await until(() => fake.samples.size === 0));
  const zeroNoLink = { ...zeroed, health_uuid: null };
  const before0 = fake.ops.length;
  Hooks.emitMealSaved(zeroNoLink as any, zeroed as any);
  await new Promise((r) => setTimeout(r, 30));
  eq("0 g with no link writes and deletes nothing", fake.ops.length, before0);

  const s1 = shot();
  rows.shots.set("i1", s1);
  Hooks.emitInjectionSaved({ ...s1 } as any, null);
  ok("injection saved -> linked", await until(() => rows.shots.get("i1").health_uuid != null));
  await idle();
  eq("insulin sample type", [...fake.samples.values()].find((s) => s.kind === "insulin")?.insulinKind, "bolus");
  const sl = rows.shots.get("i1").health_uuid;
  const s2 = { ...s1, insulin_type: "basal", health_uuid: sl };
  rows.shots.set("i1", s2);
  Hooks.emitInjectionSaved(s2 as any, { ...s1, health_uuid: sl } as any);
  ok("type change rewrites as basal", await until(() => rows.shots.get("i1").health_uuid !== sl));
  await idle();
  eq("one insulin sample, basal", [...fake.samples.values()].filter((s) => s.kind === "insulin" && s.insulinKind === "basal").length, 1);
  const sl2 = rows.shots.get("i1").health_uuid;
  Hooks.emitRemoved("insulin", [{ id: "i1", uuid: sl2 }]);
  ok("removed hook revokes", await until(() => !fake.samples.has(sl2)));

  section("K. row deleted while the write was in flight: no orphan");
  resetAll("ios");
  on("carbs");
  const ghost = meal({ id: "ghost" });
  Hooks.emitMealSaved(ghost as any, null);
  ok("sample written then revoked", await until(() => fake.ops.some((o) => o.startsWith("delete:carbs"))));
  await idle();
  eq("store holds nothing", fake.samples.size, 0);

  section("L. retryHealthRecords: failed writes, vanished rows");
  resetAll("ios");
  on("carbs");
  rows.meals.set("m1", meal());
  rows.meals.set("m3", meal({ id: "m3", profile_id: "Q" }));
  fake.failWrites = 1;
  await S.mirrorHealthRecord(H.mealRecordInput(meal() as any)!);
  fake.failWrites = 1;
  await S.mirrorHealthRecord(H.mealRecordInput(meal({ id: "gone2" }) as any)!);
  eq("two ids queued", (await S.getHealthRecordRetryIds("carbs", "P")).length >= 2, true);
  await H.retryHealthRecords("P");
  await idle();
  ok("existing row got written and linked", rows.meals.get("m1").health_uuid != null);
  eq("vanished rows leave the queue", (await S.getHealthRecordRetryIds("carbs", "P")).length, 0);
  fake.failWrites = 1;
  await S.mirrorHealthRecord(H.mealRecordInput(meal({ id: "m3", profile_id: "Q" }) as any)!);
  eq("non-active profile never queued", (await S.getHealthRecordRetryIds("carbs", "Q")).length, 0);

  section("M. profile clear and counts");
  resetAll("ios");
  on("carbs");
  on("insulin");
  rows.meals.set("m1", meal({ health_uuid: "x1" }));
  rows.meals.set("m2", meal({ id: "m2", health_uuid: "x2" }));
  rows.shots.set("i1", shot({ health_uuid: "x3" }));
  rows.meals.set("m5", meal({ id: "m5", profile_id: "Q", health_uuid: "other" }));
  for (const k of ["x1", "x2", "other"]) fake.samples.set(k, { kind: "carbs", value: 1, dateIso: "", meta: {} });
  fake.samples.set("x3", { kind: "insulin", value: 1, dateIso: "", meta: {} });
  eq("copy count is this profile's", await H.countHealthRecordCopies("P"), 3);
  eq("revoke before delete", await H.revokeHealthRecordsBeforeDelete("P"), 3);
  ok("other profile's sample untouched", fake.samples.has("other"));
  ok("own samples gone", !fake.samples.has("x1") && !fake.samples.has("x3"));
  resetAll("web");
  eq("no provider: count 0", await H.countHealthRecordCopies("P"), 0);
  eq("no provider: revoke 0", await H.revokeHealthRecordsBeforeDelete("P"), 0);
  resetAll("android");
  rows.shots.set("i1", shot({ health_uuid: "x3" }));
  eq("android: insulin revoke deletes none", await H.revokeHealthRecordsBeforeDelete("P"), 0);
  resetAll("ios");
  fake.failDeletes = true;
  rows.meals.set("m1", meal({ health_uuid: "x1" }));
  eq("failed revoke reports 0 and queues", await H.revokeHealthRecordsBeforeDelete("P"), 0);
  fake.failDeletes = false;
  eq("queue retried later", (await S.retryPendingHealthRecordDeletes("carbs")).succeeded, 1);

  section("N. hooks without a provider do nothing");
  resetAll("web");
  const nm = meal();
  rows.meals.set("m1", nm);
  Hooks.emitMealSaved(nm as any, null);
  await new Promise((r) => setTimeout(r, 30));
  eq("no link set", rows.meals.get("m1").health_uuid, null);
  eq("no crash logged", crashes.length, 0);
  ok("PLATFORM restored not needed", PLATFORM.OS === "web");

  section("O. db hook seam: no-op unbound, swallows handler errors");
  const mm = meal() as any;
  Hooks.setHealthRecordHooks({});
  Hooks.emitMealSaved(mm, null);
  Hooks.emitInjectionSaved(shot() as any, null);
  Hooks.emitRemoved("carbs", [{ id: "a", uuid: "u" }]);
  ok("unbound emits are no-ops", true);
  let removedCalls = 0;
  Hooks.setHealthRecordHooks({
    mealSaved: () => { throw new Error("boom"); },
    injectionSaved: () => { throw new Error("boom"); },
    removed: () => { removedCalls++; throw new Error("boom"); },
  });
  let threw = false;
  try {
    Hooks.emitMealSaved(mm, null);
    Hooks.emitInjectionSaved(shot() as any, null);
    Hooks.emitRemoved("insulin", [{ id: "a", uuid: null }]);
  } catch {
    threw = true;
  }
  eq("handler errors never reach the save", threw, false);
  eq("removed handler was called", removedCalls, 1);
  Hooks.emitRemoved("carbs", []);
  eq("empty removal list is not emitted", removedCalls, 1);
  const seen: string[] = [];
  Hooks.setHealthRecordHooks({ mealSaved: (m, p) => void seen.push(`${m.id}:${p ? "prev" : "none"}`) });
  Hooks.emitMealSaved(mm, null);
  Hooks.emitMealSaved(mm, mm);
  eq("handler gets row and previous", seen.join(), "m1:none,m1:prev");
  Hooks.emitInjectionSaved(shot() as any, null);
  ok("a missing handler of another event is skipped", true);

  finish();
}

main().catch((e) => {
  console.log("fatal", e);
  process.exit(1);
});
