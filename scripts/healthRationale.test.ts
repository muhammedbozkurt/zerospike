/**
 * Health Connect permission rationale routing (plugins/withHealthRationaleRouting.js,
 * HealthRationaleActivity.kt, app/settings/health-rationale.tsx, healthRationale.*).
 *
 * Run: npx tsx scripts/healthRationale.test.ts
 */
declare const console: { log: (...a: unknown[]) => void };
declare const process: { exit: (code: number) => void };
declare function require(id: string): any;

const fs = require("fs");
const os = require("os");
const path = require("path");

const plugin = require("../plugins/withHealthRationaleRouting");
const appJson = require("../app.json");

const { routeHealthRationale, RATIONALE_ACTIVITY, RATIONALE_ACTION, VIEW_PERMISSION_USAGE_ACTION } = plugin;

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean): void {
  if (cond) passed++;
  else {
    failed++;
    console.log(`  ✗ ${name}`);
  }
}

const N = "android:name";
const f = (action: string, categories: string[] = [], data?: string) => ({
  action: [{ $: { [N]: action } }],
  ...(categories.length ? { category: categories.map((c) => ({ $: { [N]: c } })) } : {}),
  ...(data ? { data: [{ $: { "android:scheme": data } }] } : {}),
});

// Mirrors the build 94 AAB manifest: MainActivity carries MAIN, the zerospike://
// VIEW link and the rationale action; the Android 14 alias targets MainActivity.
function aabManifest() {
  return {
    $: {},
    application: [
      {
        activity: [
          {
            $: { [N]: "com.greeneyeapp.zerospike.MainActivity", "android:exported": "true", "android:launchMode": "singleTask" },
            "intent-filter": [
              f("android.intent.action.MAIN", ["android.intent.category.LAUNCHER"]),
              f("android.intent.action.VIEW", ["android.intent.category.DEFAULT", "android.intent.category.BROWSABLE"], "zerospike"),
              f(RATIONALE_ACTION),
            ],
          },
          { $: { [N]: "expo.modules.zerospikealarmkit.AlarmRingActivity", "android:exported": "false" } },
        ],
        "activity-alias": [
          {
            $: {
              [N]: "com.greeneyeapp.zerospike.ViewPermissionUsageActivity",
              "android:exported": "true",
              "android:targetActivity": "com.greeneyeapp.zerospike.MainActivity",
              "android:permission": "android.permission.START_VIEW_PERMISSION_USAGE",
            },
            "intent-filter": [f(VIEW_PERMISSION_USAGE_ACTION, ["android.intent.category.HEALTH_PERMISSIONS"])],
          },
        ],
      },
    ],
  };
}

const actionsOf = (node: any): string[] =>
  (node["intent-filter"] || []).flatMap((x: any) => (x.action || []).map((a: any) => a.$[N]));

// --- transform on the AAB-shaped manifest
const m: any = routeHealthRationale(aabManifest());
const app = m.application[0];
const main = app.activity.find((a: any) => a.$[N] === "com.greeneyeapp.zerospike.MainActivity");
const rationale = app.activity.find((a: any) => a.$[N] === RATIONALE_ACTIVITY);
const alias = app["activity-alias"][0];

ok("MainActivity no longer handles the rationale action", !actionsOf(main).includes(RATIONALE_ACTION));
ok("MainActivity keeps MAIN and the zerospike:// VIEW filter", actionsOf(main).join() === "android.intent.action.MAIN,android.intent.action.VIEW");
ok("MainActivity keeps its attributes", main.$["android:launchMode"] === "singleTask" && main.$["android:exported"] === "true");
ok("HealthRationaleActivity is declared once", app.activity.filter((a: any) => a.$[N] === RATIONALE_ACTIVITY).length === 1);
ok("HealthRationaleActivity handles the rationale action", actionsOf(rationale).includes(RATIONALE_ACTION));
ok("HealthRationaleActivity is exported and has a DEFAULT category", rationale.$["android:exported"] === "true" && JSON.stringify(rationale["intent-filter"]).includes("android.intent.category.DEFAULT"));
ok("alias targets HealthRationaleActivity", alias.$["android:targetActivity"] === RATIONALE_ACTIVITY);
ok("alias keeps name, permission and VIEW_PERMISSION_USAGE + HEALTH_PERMISSIONS filter",
  alias.$[N] === "com.greeneyeapp.zerospike.ViewPermissionUsageActivity" &&
    alias.$["android:permission"] === "android.permission.START_VIEW_PERMISSION_USAGE" &&
    alias.$["android:exported"] === "true" &&
    actionsOf(alias).join() === VIEW_PERMISSION_USAGE_ACTION &&
    JSON.stringify(alias["intent-filter"]).includes("android.intent.category.HEALTH_PERMISSIONS"));
ok("unrelated activity is untouched", app.activity.some((a: any) => a.$[N] === "expo.modules.zerospikealarmkit.AlarmRingActivity"));
ok("exactly one activity-alias remains", app["activity-alias"].length === 1);

// --- idempotent
const once = JSON.stringify(m);
ok("second run changes nothing", JSON.stringify(routeHealthRationale(JSON.parse(once))) === once);

// --- source-form manifest (before aapt prefixes the package), alias absent
const bare: any = aabManifest();
bare.application[0]["activity-alias"] = [];
bare.application[0].activity[0].$[N] = ".MainActivity";
routeHealthRationale(bare);
const created = bare.application[0]["activity-alias"];
ok("missing alias is created, pointed at the trampoline", created.length === 1 && created[0].$["android:targetActivity"] === RATIONALE_ACTIVITY && created[0].$["android:permission"] === "android.permission.START_VIEW_PERMISSION_USAGE");
ok("main found by name when it is .MainActivity", !actionsOf(bare.application[0].activity[0]).includes(RATIONALE_ACTION));

// --- a rationale action sharing a filter with another action keeps the other one
const shared: any = aabManifest();
shared.application[0].activity[0]["intent-filter"].push({ action: [{ $: { [N]: RATIONALE_ACTION } }, { $: { [N]: "x.OTHER" } }] });
routeHealthRationale(shared);
ok("shared filter keeps its other action", actionsOf(shared.application[0].activity[0]).includes("x.OTHER") && !actionsOf(shared.application[0].activity[0]).includes(RATIONALE_ACTION));

// --- missing MainActivity fails loudly instead of shipping a silent no-op
let threw = false;
try {
  routeHealthRationale({ application: [{ activity: [] }] });
} catch {
  threw = true;
}
ok("throws when MainActivity is missing", threw);

// --- app.json wiring: order matters, mods run in reverse of the plugins list
const plugins: unknown[] = appJson.expo.plugins;
const idxMine = plugins.indexOf("./plugins/withHealthRationaleRouting");
const idxHc = plugins.indexOf("react-native-health-connect");
ok("app.json lists the routing plugin", idxMine >= 0);
ok("routing plugin is listed before react-native-health-connect (so it runs after it)", idxMine >= 0 && idxHc > idxMine);
ok("app.json scheme is zerospike", appJson.expo.scheme === "zerospike");

// --- native side and route agree on the deep link
const root = path.join(__dirname, "..");
const kt: string = fs.readFileSync(path.join(root, "modules/zerospike-alarmkit/android/src/main/java/expo/modules/zerospikealarmkit/HealthRationaleActivity.kt"), "utf8");
const link = /ROUTE = "([^"]+)"/.exec(kt)?.[1] ?? "";
ok("Kotlin trampoline opens zerospike://settings/health-rationale", link === "zerospike://settings/health-rationale");
ok("Kotlin class name matches the manifest entry", RATIONALE_ACTIVITY === "expo.modules.zerospikealarmkit.HealthRationaleActivity" && /class HealthRationaleActivity\s*:\s*Activity\(\)/.test(kt) && /^package expo\.modules\.zerospikealarmkit$/m.test(kt));
const routeFile = path.join(root, "app", link.replace("zerospike://", "") + ".tsx");
ok("deep link path resolves to an expo-router file", fs.existsSync(routeFile));

// --- screen: accessible headers and no hard-coded colors
const screen: string = fs.readFileSync(routeFile, "utf8");
ok("screen marks section titles as headers", screen.includes('accessibilityRole="header"'));
ok("screen has no hex or rgba literals", !/#[0-9a-fA-F]{3,8}\b|rgba\(/.test(screen));
ok("screen links the privacy policy via lib/legal", screen.includes("privacyUrl()"));

// --- i18n: every key the screen reads exists in all nine languages
const LANGS = ["en", "tr", "de", "fr", "es", "it", "pt", "ar", "ja"];
const usedKeys = [...new Set<string>([...screen.matchAll(/t\("healthRationale\.(\w+)"/g)].map((x) => x[1]))];
ok("screen reads at least the expected keys", usedKeys.length >= 14);
const BANNED = [
  /uyar[ıi]|hipoglisemi alarm|\btan[ıi]\b|tedavi|önerilen doz/i,
  /\bwarn|hypoglyc\w* alarm|diagnos|\btreat(ment)?\b|recommended dose|dosage advice/i,
  /warnung|diagnose|behandlung|dosisempfehlung/i,
  /avertisse|diagnostic|traitement|dose recommandée/i,
  /advertencia|diagnóstico|tratamiento|dosis recomendada/i,
  /avvis|diagnosi|trattamento|dose consigliata/i,
  /aviso de|diagnóstico|tratamento|dose recomendada/i,
  /تحذير|تشخيص|علاج|جرعة موصى/,
  /警告|診断|治療|推奨用量/,
];
const PRONOUN: Record<string, RegExp> = {
  de: /\b(du|dein\w*|dich|dir)\b/i,
  fr: /\b(tu|ton|ta|tes|toi|te)\b/i,
  es: /\b(tú|tus|ti|contigo)\b/i,
  it: /\b(tu|tuo|tua|tuoi|ti)\b/i,
};
for (const lang of LANGS) {
  const block: Record<string, string> = require(`../lib/i18n/locales/${lang}`).default.healthRationale;
  ok(`${lang}: healthRationale namespace exists`, !!block);
  if (!block) continue;
  for (const key of usedKeys) {
    const v = block[key];
    ok(`${lang}: healthRationale.${key} is a non-empty string`, typeof v === "string" && v.trim().length > 0);
  }
  ok(`${lang}: same key set as en`, Object.keys(block).sort().join() === Object.keys(require("../lib/i18n/locales/en").default.healthRationale).sort().join());
  const text = Object.values(block).join("\n");
  ok(`${lang}: no em-dash`, !text.includes("—"));
  ok(`${lang}: no banned regulatory wording`, !BANNED.some((re) => re.test(text)));
  if (PRONOUN[lang]) ok(`${lang}: formal address only`, !PRONOUN[lang].test(text));
  ok(`${lang}: no hand-written percent`, !text.includes("%"));
}
ok("tr uses diacritics", /ş|ğ|ı|ü|ö|ç/.test(require("../lib/i18n/locales/tr").default.healthRationale.intro));

// --- real Expo plugin chain over a prebuild-like manifest (registration order = app.json order)
async function chain(): Promise<void> {
  const { compileModsAsync } = require("@expo/config-plugins");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "zs-hr-"));
  const dst = path.join(dir, "android/app/src/main");
  fs.mkdirSync(dst, { recursive: true });
  fs.writeFileSync(
    path.join(dst, "AndroidManifest.xml"),
    `<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="com.greeneyeapp.zerospike">
  <application android:name=".MainApplication">
    <activity android:name=".MainActivity" android:exported="true" android:launchMode="singleTask">
      <intent-filter><action android:name="android.intent.action.MAIN"/><category android:name="android.intent.category.LAUNCHER"/></intent-filter>
      <intent-filter><action android:name="android.intent.action.VIEW"/><category android:name="android.intent.category.DEFAULT"/><category android:name="android.intent.category.BROWSABLE"/><data android:scheme="zerospike"/></intent-filter>
    </activity>
  </application>
</manifest>`
  );
  const run = async (order: Array<(c: any) => any>): Promise<string> => {
    let config: any = { name: "x", slug: "x", android: { package: "com.greeneyeapp.zerospike" }, _internal: { projectRoot: dir } };
    for (const p of order) config = p(config);
    await compileModsAsync(config, { projectRoot: dir, platforms: ["android"], assertMissingModProviders: false });
    return fs.readFileSync(path.join(dst, "AndroidManifest.xml"), "utf8");
  };
  const hc = require("react-native-health-connect/app.plugin.js");
  const xml = await run([plugin, hc]);
  const mainBlock = xml.slice(xml.indexOf("<activity android:name=\".MainActivity\""), xml.indexOf("</activity>"));
  ok("chain: MainActivity has no rationale filter", !mainBlock.includes(RATIONALE_ACTION));
  ok("chain: rationale filter sits on HealthRationaleActivity", new RegExp(`${RATIONALE_ACTIVITY}[\\s\\S]*?${RATIONALE_ACTION}`).test(xml));
  ok("chain: alias targets HealthRationaleActivity", new RegExp(`<activity-alias[^>]*android:targetActivity="${RATIONALE_ACTIVITY}"`).test(xml));
  ok("chain: exactly one alias and one rationale filter", (xml.match(/<activity-alias /g) || []).length === 1 && (xml.match(new RegExp(RATIONALE_ACTION, "g")) || []).length === 1);
  ok("chain: still deep-linkable on zerospike://", mainBlock.includes('android:scheme="zerospike"'));
}

chain()
  .catch((e: unknown) => {
    failed++;
    console.log(`  ✗ chain threw: ${String(e)}`);
  })
  .then(() => {
    console.log(`healthRationale: ${passed} passed, ${failed} failed`);
    if (failed > 0) process.exit(1);
  });
