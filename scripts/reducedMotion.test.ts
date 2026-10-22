/**
 * Reduce Motion: pure rules (lib/reducedMotion.ts) plus a source contract that
 * every RN Animated timing/spring/loop goes through the shared helper.
 * Run: npx tsx scripts/reducedMotion.test.ts
 */
declare const require: (m: string) => any;
declare const console: { log: (...a: unknown[]) => void };
declare const process: { exit: (code: number) => void };

import { REDUCED_FADE_MS, fadeDuration, motionDuration, slideDistance } from "../lib/reducedMotion";

const fs = require("fs");
const path = require("path");

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean, detail = ""): void {
  if (cond) passed++;
  else {
    failed++;
    console.log(`FAIL ${name} ${detail}`);
  }
}
const root = path.join(__dirname, "..");
const read = (p: string): string => fs.readFileSync(path.join(root, p), "utf8");

// Pure rules
ok("normal: sure aynen", motionDuration(false, 200) === 200 && motionDuration(false, 0) === 0);
ok("reduced: sure 0", motionDuration(true, 200) === 0 && motionDuration(true, 900) === 0);
ok("fade normal: orijinal", fadeDuration(false, 200) === 200 && fadeDuration(false, 60) === 60);
ok("fade reduced: <= 120 ms", fadeDuration(true, 200) <= 120 && fadeDuration(true, 900) <= 120);
ok("fade reduced: kisa sure uzatilmaz", fadeDuration(true, 60) === 60);
ok("REDUCED_FADE_MS <= 120", REDUCED_FADE_MS <= 120 && REDUCED_FADE_MS > 0);
ok("kayma normal: aynen", slideDistance(false, 40) === 40);
ok("kayma reduced: 0", slideDistance(true, 40) === 0);

// Helper source: listens to the system setting, async first value
const hook = read("lib/useReducedMotion.ts");
ok("hook: isReduceMotionEnabled + reduceMotionChanged", hook.includes("isReduceMotionEnabled") && hook.includes("reduceMotionChanged"));
ok("hook: animate/animateFade/animateSpring export", ["animate(", "animateFade(", "animateSpring("].every((s) => hook.includes(`function ${s}`)));
ok("hook: saf yardimcilari yeniden ihrac eder", hook.includes("motionDuration") && hook.includes("fadeDuration"));

// Scan contract: any file with Animated timing/spring/loop uses the helper.
// Allowlist entries own their reduced behaviour and say how.
const ALLOW: Record<string, string> = {
  "lib/useReducedMotion.ts": "helper itself",
  "lib/useSheetKeyboard.ts": "keyboard slide follows the system keyboard duration, not an app effect",
  "components/Feedback.tsx": "toast timing comes from toastQueue (fx.ms 0 under reduce); useEnterAnim uses animateFade",
  "components/ScrollHint.tsx":"scrollHintMotion(reduce): no animation, no fade, no loop when reduced",
};
function walk(dir: string, out: string[]): void {
  for (const name of fs.readdirSync(path.join(root, dir))) {
    const rel = `${dir}/${name}`;
    const st = fs.statSync(path.join(root, rel));
    if (st.isDirectory()) walk(rel, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(rel);
  }
}
const files: string[] = [];
["app", "components", "lib", "hooks"].forEach((d) => {
  if (fs.existsSync(path.join(root, d))) walk(d, files);
});
const ANIMATED_CALL = /Animated\.(timing|spring|loop|decay)\s*\(/;
const users = files.filter((f) => ANIMATED_CALL.test(read(f)));
ok("tarama: Animated kullanan dosyalar bulundu", users.length >= 1, String(users.length));
for (const f of users) {
  if (ALLOW[f]) continue;
  ok(`${f}: dogrudan Animated.timing/spring/loop yok`, !ANIMATED_CALL.test(read(f)), "yardimci kullan: lib/useReducedMotion");
}
for (const f of files) {
  if (ALLOW[f] || f === "lib/useReducedMotion.ts") continue;
  const src = read(f);
  if (/\banimate(Fade|Spring)?\(\s*(isReducedMotionNow\(\)|reduced)/.test(src)) {
    ok(`${f}: yardimciyi ice aktarir`, src.includes("useReducedMotion\""));
  }
}
ok("allowlist Feedback: toast reduce motion bagli", read("components/Feedback.tsx").includes("reduceMotionChanged") && read("lib/toastQueue.ts").includes("reduceMotion"));
for (const f of Object.keys(ALLOW)) ok(`allowlist: ${f} var`, fs.existsSync(path.join(root, f)));
ok("allowlist ScrollHint: scrollHintMotion kullanir", read("components/ScrollHint.tsx").includes("scrollHintMotion(reduce)"));
ok("ScrollHint: dongu yalniz motion.loops ile", read("components/ScrollHint.tsx").includes("iterations: motion.loops"));
ok("allowlist useSheetKeyboard: yorum sistem klavyesi", read("lib/useSheetKeyboard.ts").includes("duration"));

// Loops stop under Reduce Motion: no unbounded loop, reanimated repeats are reduced-aware
const loopFiles = files.filter((f) => /Animated\.loop\s*\(/.test(read(f)));
ok("Animated.loop yalniz ScrollHint'te", loopFiles.length === 1 && loopFiles[0] === "components/ScrollHint.tsx", loopFiles.join(","));
for (const f of files.filter((x) => /withRepeat\(/.test(read(x)))) {
  ok(`${f}: withRepeat reduced korumali`, /useReducedMotion|reduced/.test(read(f)));
}

// Wiring
const wired: [string, string][] = [
  ["components/QuickAddSheet.tsx", "animateFade("],
  ["components/MealComposeSheet.tsx", "animateFade("],
  ["components/CarbEstimateSheet.tsx", "animateFade("],
  ["app/(tabs)/food.tsx", "animateFade("],
  ["components/GlucoseInputSheet.tsx", "animateSpring("],
  ["components/RangeInput.tsx", "animateSpring("],
  ["components/form.tsx", "animate(isReducedMotionNow()"],
  ["components/Feedback.tsx", "animateFade("],
  ["lib/theme/ThemeProvider.tsx", "animate(isReducedMotionNow()"],
];
for (const [f, needle] of wired) ok(`${f}: ${needle}`, read(f).includes(needle));
for (const f of ["components/QuickAddSheet.tsx", "components/MealComposeSheet.tsx", "components/CarbEstimateSheet.tsx", "app/(tabs)/food.tsx"]) {
  ok(`${f}: kayma reduced'da 0`, read(f).includes("slideDistance(reducedMotion, 40)"));
}
const spike = read("app/spike.tsx");
ok("spike: yazma efekti reduced'da kapali (tam metin)", /isReducedMotionNow\(\) \|\| total <= TYPE_STEP_WORDS/.test(spike));
ok("spike: scrollToEnd reduced'da animasyonsuz", spike.includes("animated: !isReducedMotionNow()"));
ok("injection: scrollToLocation reduced'da animasyonsuz", read("app/(tabs)/injection.tsx").includes("animated: !isReducedMotionNow()"));

for (const f of files) {
  ok(`${f}: useReducedMotion reanimated'den degil, lib/useReducedMotion'dan`, !/import\s*\{[^}]*\buseReducedMotion\b[^}]*\}\s*from\s*"react-native-reanimated"/.test(read(f)));
}
for (const f of ["components/onboarding/Reveal.tsx", "components/onboarding/WelcomePreview.tsx"]) {
  ok(`${f}: modul onbellekli hook`, read(f).includes('from "../../lib/useReducedMotion"'));
}
ok("emergency-contacts: 'zaten ekli' satir checked degil", read("app/emergency-contacts.tsx").includes("checked: checked && !already"));

console.log(`reducedMotion: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
console.log("reducedMotion: all passed");
