/**
 * G23 / G24 / G26 harness: reminder, medication and profile writes must not
 * fail silently, double-write, or half-apply. Run: npx tsx scripts/saveFailures.test.ts
 */
declare const console: { log: (...a: unknown[]) => void };
declare const process: { exit: (code: number) => void };

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { runExclusive, tryWrite, type SaveLock } from "../lib/saveGuard";
import { saveReminderGuarded } from "../lib/reminderSave";
import { saveMedGuarded } from "../lib/medSave";
import { runReminderPlan, type ReminderPlanDeps } from "../lib/reminderPlanCore";

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean): void {
  if (cond) passed++;
  else {
    failed++;
    console.log(`  FAIL ${name}`);
  }
}

async function main(): Promise<void> {
  // G23: write and schedule are separate steps
  {
    let writes = 0;
    const outcome = await saveReminderGuarded({
      isCreate: true,
      write: async () => {
        writes++;
      },
      afterWrite: async () => {
        throw new Error("schedule boom");
      },
    });
    ok("G23 schedule throw -> scheduleFailed", outcome === "scheduleFailed");
    ok("G23 schedule throw -> row written exactly once", writes === 1);
  }
  {
    let after = 0;
    const outcome = await saveReminderGuarded({
      isCreate: true,
      write: async () => {
        throw new Error("disk full");
      },
      afterWrite: async () => {
        after++;
      },
    });
    ok("G23 write throw -> writeFailed", outcome === "writeFailed");
    ok("G23 write throw -> no scheduling attempted", after === 0);
  }
  {
    const outcome = await saveReminderGuarded({
      isCreate: true,
      write: async () => {
        throw new Error("createReminder: limit of 10 reminders reached");
      },
      afterWrite: async () => {},
    });
    ok("G23 limit error on create -> limit", outcome === "limit");
    const edit = await saveReminderGuarded({
      isCreate: false,
      write: async () => {
        throw new Error("createReminder: limit of 10 reminders reached");
      },
      afterWrite: async () => {},
    });
    ok("G23 limit text on edit is not a limit", edit === "writeFailed");
    const fine = await saveReminderGuarded({
      isCreate: true,
      write: async () => {},
      afterWrite: async () => {},
    });
    ok("G23 happy path -> ok", fine === "ok");
  }

  // double press: second Kaydet while the first is running writes nothing
  {
    const lock: SaveLock = { current: false };
    let writes = 0;
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const first = runExclusive(lock, async () => {
      writes++;
      await gate;
      return "a";
    });
    const second = await runExclusive(lock, async () => {
      writes++;
      return "b";
    });
    ok("double press -> second call does not run", second.ran === false);
    release();
    const firstRes = await first;
    ok("double press -> first completes", firstRes.ran === true && firstRes.value === "a");
    ok("double press -> single write", writes === 1);
    ok("lock released after success", lock.current === false);
    const third = await runExclusive(lock, async () => 1);
    ok("lock reusable after completion", third.ran === true);
    let threw = false;
    try {
      await runExclusive(lock, async () => {
        throw new Error("x");
      });
    } catch {
      threw = true;
    }
    ok("exception propagates from runExclusive", threw);
    ok("lock released after throw", lock.current === false);
  }

  // G24
  {
    let writes = 0;
    const outcome = await saveMedGuarded({
      write: async () => {
        writes++;
      },
      rememberName: async () => {
        throw new Error("upsertMedUse boom");
      },
    });
    ok("G24 upsertMedUse throw -> ok", outcome === "ok");
    ok("G24 upsertMedUse throw -> logMed exactly once", writes === 1);
  }
  {
    let remembered = 0;
    const outcome = await saveMedGuarded({
      write: async () => {
        throw new Error("logMed boom");
      },
      rememberName: async () => {
        remembered++;
      },
    });
    ok("G24 main write throw -> failed", outcome === "failed");
    ok("G24 main write throw -> name not remembered", remembered === 0);
  }

  // G26
  ok("G26 tryWrite success -> true", (await tryWrite(async () => 1)) === true);
  ok(
    "G26 tryWrite throw -> false, no throw",
    (await tryWrite(async () => {
      throw new Error("updateProfile boom");
    })) === false
  );

  // G23 plan: delete + write is one unit
  {
    type Row = { id: string; type: string; profile_id: string };
    const makeFake = (failOnCreate: number) => {
      let store: Row[] = [
        { id: "old1", type: "glucose", profile_id: "p" },
        { id: "old2", type: "glucose", profile_id: "p" },
        { id: "basal", type: "basal", profile_id: "p" },
      ];
      let creates = 0;
      let afterCalls = 0;
      const deps: ReminderPlanDeps = {
        list: async () => store.map((r) => ({ ...r })),
        count: async () => store.length,
        remove: async (id) => {
          store = store.filter((r) => r.id !== id);
        },
        create: async () => {
          creates++;
          if (creates === failOnCreate) throw new Error("insert boom");
          store.push({ id: `new${creates}`, type: "glucose", profile_id: "p" });
        },
        transaction: async (run) => {
          const snapshot = store.map((r) => ({ ...r }));
          try {
            return await run();
          } catch (e) {
            store = snapshot;
            throw e;
          }
        },
        maxReminders: 10,
        afterWrite: async () => {
          afterCalls++;
        },
      };
      return { deps, rows: () => store, afterCalls: () => afterCalls };
    };
    const preset = (time: string) => ({ type: "glucose" as const, time, bucket: "morning" as const });
    const rows = [preset("07:00"), preset("12:00"), preset("18:00")];

    const broken = makeFake(2);
    const res = await runReminderPlan(broken.deps, rows, () => "x", "p");
    ok("plan midway failure -> failed", res.outcome === "failed");
    ok(
      "plan midway failure -> old rows still there",
      broken.rows().some((r) => r.id === "old1") && broken.rows().some((r) => r.id === "old2")
    );
    ok("plan midway failure -> no new rows leaked", broken.rows().every((r) => !r.id.startsWith("new")));
    ok("plan midway failure -> unrelated rows untouched", broken.rows().some((r) => r.id === "basal"));
    ok("plan midway failure -> reports nothing written", res.written === 0);
    ok("plan midway failure -> no permission prompt", broken.afterCalls() === 0);

    const good = makeFake(0);
    const res2 = await runReminderPlan(good.deps, rows, () => "x", "p");
    ok("plan success -> written", res2.outcome === "written" && res2.written === 3);
    ok(
      "plan success -> old glucose rows replaced, basal kept",
      good.rows().filter((r) => r.type === "glucose").length === 3 &&
        good.rows().every((r) => r.id !== "old1") &&
        good.rows().some((r) => r.id === "basal")
    );

    const noisy = makeFake(0);
    noisy.deps.afterWrite = async () => {
      throw new Error("permission boom");
    };
    const res3 = await runReminderPlan(noisy.deps, rows, () => "x", "p");
    ok("plan permission step failing does not undo the rows", res3.outcome === "written" && res3.written === 3);
  }

  // wiring
  const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8");
  {
    const s = read("app/settings/reminders.tsx");
    ok("wire reminders.tsx uses saveReminderGuarded", s.includes("saveReminderGuarded"));
    ok("wire reminders.tsx reports saveFailed", s.includes("common.saveFailed"));
    ok("wire reminders.tsx has a double-press lock", s.includes("runExclusive"));
    const n = read("lib/services/notifications.ts");
    ok("wire notifications row loop is guarded", n.includes("reminderRowScheduleFailed"));
    const p = read("lib/services/reminderPlan.ts");
    ok("wire reminderPlan uses the core", p.includes("runReminderPlan"));
    const d = read("lib/db/reminders.ts");
    ok("wire db exposes a reminders transaction", d.includes("withTransactionAsync") && d.includes("inReminderTransaction"));
  }
  {
    const q = read("components/QuickAddSheet.tsx");
    ok("wire QuickAddSheet uses saveMedGuarded", q.includes("saveMedGuarded"));
    ok("wire QuickAddSheet reports saveFailed", q.includes("common.saveFailed"));
    ok("wire QuickAddSheet ref lock", q.includes("runExclusive"));
    const m = read("components/MedEditSheet.tsx");
    ok("wire MedEditSheet uses saveMedGuarded", m.includes("saveMedGuarded"));
    ok("wire MedEditSheet reports saveFailed", m.includes("common.saveFailed"));
    ok("wire MedEditSheet ref lock", m.includes("runExclusive"));
    const pk = read("components/MedNamePicker.tsx");
    ok("wire MedNamePicker leaves loading on read error", /catch/.test(pk));
    const ms = read("app/settings/medications.tsx");
    ok("wire medications.tsx leaves loading on read error", /catch/.test(ms));
  }
  {
    const ps = read("app/profile-setup.tsx");
    ok("wire profile-setup save is caught", ps.includes("tryWrite") && ps.includes("common.saveFailed"));
    const pr = read("app/settings/profile.tsx");
    ok("wire settings/profile persist is caught", pr.includes("tryWrite") && pr.includes("common.saveFailed"));
  }

  console.log(`saveFailures: ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

void main();
