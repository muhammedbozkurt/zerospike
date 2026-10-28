/**
 * G253-FIX-C3 widget / watch surfaces: C-15 (sensor mode must not announce
 * reminders that never ring), D-14 (Wear OS knows the sensor mode), D-17
 * (Android widget age cannot freeze; a background import refreshes the
 * surfaces) and D-18 (the parked publish is flushed when the app leaves the
 * foreground).
 *
 * The RN-bound files cannot load under plain Node, so their wiring is pinned by
 * source text, next to behavioural checks on the pure parts.
 *
 * Run: npx -y tsx scripts/widgetSurfaces.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { cgmWidgetModel, widgetUpcomingInputs } from "../lib/services/liveDataCgm";
import { createPublishCoalescer } from "../lib/services/publishCoalescer";
import { nextUpcoming, type UpcomingReminderRow } from "../lib/upcomingReminders";

const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const MIN = 60_000;

// ---------------------------------------------------------------- C-15
{
  const now = new Date(2026, 9, 28, 7, 0, 0).getTime();
  const rows: UpcomingReminderRow[] = [
    { id: "g1", type: "glucose", label: "Sabah", time: "08:00", enabled: 1, alarm_enabled: 0 },
    { id: "m1", type: "med", label: "Metformin", time: "20:00", enabled: 1, alarm_enabled: 0 },
  ];
  const base = {
    now,
    windowMs: 24 * 60 * MIN,
    masterEnabled: true,
    notificationPermission: true,
    showsBasal: true,
    showsMeds: true,
    alarmKitAvailable: false,
    alarmAuthorized: false,
  };
  const pick = (mode: "manual" | "cgm" | "nightscout", optIn: string[], pm: number | null) => {
    const u = widgetUpcomingInputs(mode, rows, new Set(optIn), pm);
    return nextUpcoming({ ...base, rows: u.rows, postMealEndsAt: u.postMealEndsAt });
  };

  assert.equal(pick("manual", [], null)?.id, "g1", "manual: the glucose reminder is next");
  assert.equal(pick("cgm", [], null)?.id, "m1", "C-15: sensor mode skips the paused glucose reminder");
  assert.equal(pick("nightscout", [], null)?.id, "m1", "C-15: nightscout mode too");
  assert.equal(pick("cgm", ["g1"], null)?.id, "g1", "an opted-in glucose reminder stays");

  const pm = now + 30 * MIN;
  assert.equal(pick("manual", [], pm)?.kind, "postMeal", "manual: the post-meal end is listed");
  assert.notEqual(pick("cgm", [], pm)?.kind, "postMeal", "C-15: sensor mode arms nothing at the end");
  // The input rows are not mutated.
  assert.equal(rows[0].enabled, 1);

  const live = read("lib/services/liveData.ts");
  assert.ok(live.includes("widgetUpcomingInputs("), "liveData must route through widgetUpcomingInputs");
  assert.ok(live.includes("getGlucoseOptIn(profileId)"), "liveData reads the profile's opt-in list");
  assert.ok(
    live.includes("postMealEndsAt: runningPostMeal,"),
    "the countdown field itself stays published"
  );
}

// ---------------------------------------------------------------- D-18
{
  let clock = 100_000;
  const timers: { id: number; at: number; fn: () => void }[] = [];
  let nextId = 1;
  const shown: string[] = [];
  const c = createPublishCoalescer((j) => shown.push(j), 30_000, {
    now: () => clock,
    setTimer: (fn, ms) => {
      const t = { id: nextId++, at: clock + ms, fn };
      timers.push(t);
      return t.id;
    },
    clearTimer: (h) => {
      const i = timers.findIndex((t) => t.id === h);
      if (i >= 0) timers.splice(i, 1);
    },
  });

  c.push("45");
  clock += 12_000;
  c.push("145");
  assert.deepEqual(shown, ["45"], "second write is parked inside the window");
  // iOS goes to the background: no timer will ever run, so flush.
  c.flush();
  assert.deepEqual(shown, ["45", "145"], "D-18: flush publishes the parked value at once");
  assert.equal(timers.length, 0, "flush clears the pending timer");
  c.flush();
  assert.deepEqual(shown, ["45", "145"], "a second flush has nothing to send");
  // A flush counts as a publish: the next push inside the window parks again.
  clock += 1_000;
  c.push("150");
  assert.deepEqual(shown, ["45", "145"]);
  clock += 30_000;
  timers.sort((a, b) => a.at - b.at)[0].fn();
  assert.deepEqual(shown, ["45", "145", "150"], "the trailing timer still works");

  const live = read("lib/services/liveData.ts");
  assert.ok(/AppState\.addEventListener\("change"/.test(live), "liveData listens to AppState");
  assert.ok(/state === "background" \|\| state === "inactive"/.test(live));
  assert.ok(live.includes("coalescer.flush()"));
}

// ---------------------------------------------------------------- D-17
{
  const readAt = Date.UTC(2026, 9, 28, 10, 0, 0);
  const snap = {
    mode: "cgm",
    labels: { hourShort: "sa", minuteShort: "dk", agoTemplate: "{{t}} önce", cgm: "CGM" },
    cgm: { mgdl: 142, at: readAt, trend: null as null, ageMin: 0, display: "142" },
  };
  const early = cgmWidgetModel(snap, readAt + 4 * MIN)!;
  const late = cgmWidgetModel(snap, readAt + 30 * MIN)!;
  assert.equal(early.readAt, readAt);
  assert.equal(late.readAt, readAt, "the model carries the reading time regardless of render time");
  assert.equal(late.stale, true);

  const widget = read("lib/services/androidWidget.ts");
  assert.ok(!/cgm\.ageText/.test(widget), "D-17: the Android widget must not freeze a relative age");
  assert.equal((widget.match(/formatTimeForLang\(cgm\.readAt/g) ?? []).length, 2);

  const sync = read("lib/services/sourceSync.ts");
  assert.ok(sync.includes("syncLiveDataAfterImport"), "D-17: a background import refreshes the surfaces");
  assert.ok(/if \(inserted > 0\) await refreshSurfacesAfterImport\(\)/.test(sync));
  const live = read("lib/services/liveData.ts");
  assert.ok(/export async function syncLiveDataAfterImport/.test(live));
}

// ---------------------------------------------------------------- D-14
{
  const dir = "wear/app/src/main/java/com/greeneyeapp/zerospike/wear/";
  const store = read(dir + "LiveDataStore.kt");
  assert.ok(store.includes('nullableString("mode")') && store.includes('optJSONObject("cgm")'));
  assert.ok(store.includes('nullableString("cgm")'), "the sensor heading label is parsed");

  const design = read(dir + "WearDesign.kt");
  assert.ok(design.includes("CGM_STALE_MINUTES = 20L"), "same 20 minute rule as the phone and the Apple Watch");
  assert.ok(/if \(ageMin > CGM_STALE_MINUTES\) Ink\.Muted else Ink\.Primary/.test(design), "plain colour, faded when stale");

  // Every surface reads the reading through the sensor-aware helpers.
  for (const f of ["MainActivity.kt", "ZerospikeTileService.kt", "ZerospikeComplicationService.kt"]) {
    const src = read(dir + f);
    assert.ok(!/\.lastGlucoseDisplay|\.lastGlucoseMgdl|\.lastGlucoseAt/.test(src), `${f} reads the raw manual fields`);
    assert.ok(/readingDisplay\(\)|readingMgdl\(\)/.test(src), `${f} uses the sensor-aware reading`);
  }
  assert.ok(read(dir + "ZerospikeComplicationService.kt").includes("sensor.at"), "complication title is the read time");
  assert.ok(read(dir + "MainActivity.kt").includes("resumeTick"), "the age is re-measured on resume");
  assert.ok(
    read("modules/zerospike-watch-bridge/android/src/main/java/expo/modules/zerospikewatchbridge/ZerospikeWatchBridgeModule.kt").includes(".setUrgent()")
  );
}

console.log("widgetSurfaces: tamam");
