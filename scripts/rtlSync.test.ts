/**
 * Writing-direction flow: pure startup decision (lib/rtlSync.ts) and the
 * source contracts around it.
 * Run: npx tsx scripts/rtlSync.test.ts
 */
declare const console: { log: (...a: unknown[]) => void };
declare const process: { exit: (code: number) => void };
declare const require: (id: string) => any;
declare const __dirname: string;

import { decideRtlStartup, needsManualRestartNotice } from "../lib/rtlSync";

const fs = require("node:fs");
const path = require("node:path");
const read = (...p: string[]): string => fs.readFileSync(path.join(__dirname, "..", ...p), "utf8");

let passed = 0;
let failed = 0;
function eq<T>(name: string, got: T, want: T): void {
  if (JSON.stringify(got) === JSON.stringify(want)) passed++;
  else {
    failed++;
    console.log(`  x ${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  }
}

const base = { targetRTL: true, currentRTL: false, screenshotMode: false, reloadTriedFor: null as string | null };

console.log("A. startup decision");
eq("matching direction: nothing to do", decideRtlStartup({ ...base, currentRTL: true }), "none");
eq("ar saved, LTR running, first time: reload", decideRtlStartup(base), "reload");
eq("ar saved, LTR running, reload already tried for ar: flags only", decideRtlStartup({ ...base, reloadTriedFor: "true" }), "flagsOnly");
eq("a marker for the OTHER direction does not block", decideRtlStartup({ ...base, reloadTriedFor: "false" }), "reload");
eq("back to LTR, first time: reload", decideRtlStartup({ ...base, targetRTL: false, currentRTL: true }), "reload");
eq("screenshot mode never reloads", decideRtlStartup({ ...base, screenshotMode: true }), "flagsOnly");
eq("manual outcome asks the user to restart", needsManualRestartNotice("manual"), true);
eq("a real reload needs no notice", needsManualRestartNotice("reloaded"), false);

console.log("B. source contracts");
const layout = read("app", "_layout.tsx");
eq("startup sync goes through decideRtlStartup", layout.includes("decideRtlStartup({"), true);
const ctx = read("lib", "store", "AppContext.tsx");
eq("reloadForDirectionChange reports whether a real reload happened", /reloadForDirectionChange\(\): Promise<RtlReloadOutcome>/.test(ctx), true);
eq("setLanguage shows the manual restart notice", ctx.includes("settings.rtlManualTitle") && ctx.includes("needsManualRestartNotice(outcome)"), true);

// expo-localization (SDK 57) with supportsRTL set makes iOS rewrite the
// persisted forceRTL flag from the SYSTEM language at every native start, so an
// in-app Arabic choice on a non-Arabic phone (or the reverse) would be undone
// before JS runs. The app owns the flags (AppContext.setLanguage, startup sync),
// hence neither option may be set.
const appJson = JSON.parse(read("app.json"));
const plugins: unknown[] = appJson.expo.plugins;
const loc = plugins.find((p) => Array.isArray(p) && p[0] === "expo-localization") as [string, Record<string, unknown>] | undefined;
eq("expo-localization plugin is configured", loc != null, true);
eq("it does not set supportsRTL", loc != null && "supportsRTL" in loc[1], false);
eq("it does not set forcesRTL", loc != null && "forcesRTL" in loc[1], false);

const arLocale = read("lib", "i18n", "locales", "ar.ts");
for (const lang of ["en", "tr", "de", "fr", "es", "it", "pt", "ar", "ja"]) {
  const src = read("lib", "i18n", "locales", `${lang}.ts`);
  eq(`${lang} has rtlManualTitle and rtlManualBody`, src.includes("rtlManualTitle:") && src.includes("rtlManualBody:"), true);
}
eq("ar body uses Arabic script", /rtlManualBody: "[^"]*[؀-ۿ]/.test(arLocale), true);

console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
