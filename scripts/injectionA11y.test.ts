/**
 * J4 + J5: the edit sheet's two delete controls are told apart and the form's
 * Note field is labelled. Run: npx sucrase-node scripts/injectionA11y.test.ts
 */
declare const console: { log: (...a: unknown[]) => void };
declare const process: { exit: (code: number) => void };
declare const require: (m: string) => any;
declare const __dirname: string;
const { readFileSync } = require("node:fs");
const { join } = require("node:path");

let failed = 0;
function ok(name: string, cond: boolean): void {
  if (!cond) {
    failed++;
    console.log(`  FAIL ${name}`);
  }
}
const read = (f: string): string => readFileSync(join(__dirname, "..", f), "utf8");
const sheet = read("components/InjectionEditSheet.tsx");
const form = read("app/(tabs)/injection.tsx");

const clearAt = sheet.indexOf("setHasSite(false)");
const clearBtn = clearAt >= 0 ? sheet.slice(clearAt, clearAt + 700) : "";
ok("site-clear control has its own label", clearBtn.includes("injection.clearSite"));
ok("site-clear control no longer says Delete", !clearBtn.includes("common.delete"));

const inputAt = form.indexOf("<TextInput");
const noteInput = inputAt >= 0 ? form.slice(inputAt, form.indexOf("/>", inputAt)) : "";
ok("form Note input has an accessibilityLabel", noteInput.includes("accessibilityLabel="));

for (const lang of ["en", "tr", "de", "fr", "es", "it", "pt", "ar", "ja"]) {
  const loc = require(`../lib/i18n/locales/${lang}`).default;
  const clear = loc.injection.clearSite as string | undefined;
  ok(`${lang} has injection.clearSite`, typeof clear === "string" && clear.length > 0);
  ok(`${lang} clearSite differs from common.delete`, clear !== loc.common.delete);
}

console.log(failed ? `${failed} failed` : "all passed");
if (failed) process.exit(1);
