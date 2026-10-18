/**
 * v25 profile-name migration and displayProfileName.
 *
 * Run: npx tsx scripts/profileNameMigration.test.ts
 */
import { DatabaseSync } from "node:sqlite";

import { migrateToV25 } from "../lib/db/migrations";
import { V25_DEFAULT_PROFILE_NAMES } from "../lib/db/v25Sql";
import { displayProfileName } from "../lib/profileName";
import tr from "../lib/i18n/locales/tr";
import en from "../lib/i18n/locales/en";
import de from "../lib/i18n/locales/de";
import fr from "../lib/i18n/locales/fr";
import es from "../lib/i18n/locales/es";
import it from "../lib/i18n/locales/it";
import pt from "../lib/i18n/locales/pt";
import ar from "../lib/i18n/locales/ar";
import ja from "../lib/i18n/locales/ja";

let passed = 0;
let failed = 0;
function eq(label: string, got: unknown, want: unknown): void {
  if (JSON.stringify(got) === JSON.stringify(want)) passed++;
  else {
    failed++;
    console.error(`FAIL ${label}\n  got:  ${JSON.stringify(got)}\n  want: ${JSON.stringify(want)}`);
  }
}

function adapt(db: DatabaseSync) {
  return {
    execAsync: async (sql: string) => {
      db.exec(sql);
    },
    withTransactionAsync: async (fn: () => Promise<void>) => {
      db.exec("BEGIN");
      try {
        await fn();
        db.exec("COMMIT");
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
    },
  } as never;
}

const locales = { tr, en, de, fr, es, it, pt, ar, ja } as Record<
  string,
  { profiles: { defaultName: string } }
>;

async function main() {
  const defaults = Object.values(locales).map((l) => l.profiles.defaultName);
  eq("literal list matches locales", [...V25_DEFAULT_PROFILE_NAMES].sort(), [...defaults].sort());

  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE user_profiles (id TEXT PRIMARY KEY, name TEXT NOT NULL);");
  const keep = ["Ayse", "Kendi Profilim 2", " Kendi Profilim", "kendi profilim", "My Profile ", ""];
  defaults.forEach((n, i) => db.prepare("INSERT INTO user_profiles VALUES (?, ?)").run(`d${i}`, n));
  keep.forEach((n, i) => db.prepare("INSERT INTO user_profiles VALUES (?, ?)").run(`k${i}`, n));

  const read = (prefix: string) =>
    (db.prepare("SELECT name FROM user_profiles WHERE id LIKE ? ORDER BY id").all(`${prefix}%`) as { name: string }[]).map(
      (r) => r.name
    );

  await migrateToV25(adapt(db));
  eq("defaults emptied", read("d").every((n) => n === ""), true);
  eq("other names untouched", read("k"), keep);
  eq("user_version stamped", (db.prepare("PRAGMA user_version;").get() as { user_version: number }).user_version, 25);

  await migrateToV25(adapt(db));
  eq("idempotent: defaults", read("d").every((n) => n === ""), true);
  eq("idempotent: others", read("k"), keep);

  for (const [lang, l] of Object.entries(locales)) {
    const t = (k: string) => (k === "profiles.defaultName" ? l.profiles.defaultName : k);
    eq(`${lang} empty -> translation`, displayProfileName("", t), l.profiles.defaultName);
    eq(`${lang} whitespace -> translation`, displayProfileName("  ", t), l.profiles.defaultName);
    eq(`${lang} object empty`, displayProfileName({ name: "" }, t), l.profiles.defaultName);
    eq(`${lang} null`, displayProfileName(null, t), l.profiles.defaultName);
    eq(`${lang} typed name kept`, displayProfileName({ name: "Ayse" }, t), "Ayse");
  }

  console.log(`${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
}

main();
