/**
 * VoiceOver / TalkBack contract. Run: npx tsx scripts/a11yLabels.test.ts
 *
 * Part 1 pins the pure builders in lib/a11y.ts (behaviour).
 * Part 2 scans app/ and components/ JSX (the a11y contract lives in source):
 *  - every Switch and Slider carries a label (accessibilityLabel or a spread of
 *    switchProps / sliderProps),
 *  - every pressable with a handler has a role (accessibilityRole, role, or a
 *    spread of pressableProps / pressProps) unless it explicitly opts out with
 *    an `accessible` prop or is hidden from the tree,
 *  - a pressable with a role but no readable text child also has a label.
 * Part 3 pins the shared header roles and the icon-glyph hiding hook.
 */
declare const require: (m: string) => any;
declare const process: { exit: (code: number) => void };
declare const __dirname: string;
const ts = require("typescript");
const fs = require("fs");
const path = require("path");
const { switchProps, pressableProps, sliderProps, HIDDEN_FROM_A11Y } = require("../lib/a11y");

let failed = 0;
let checks = 0;
const fail = (msg: string) => {
  failed++;
  console.log("FAIL " + msg);
};
const eq = (name: string, actual: unknown, expected: unknown) => {
  checks++;
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    fail(`${name}: got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
  }
};

// Part 1: helpers
eq("switch label+role", switchProps("Post-meal reminder"), {
  accessibilityRole: "switch",
  accessibilityLabel: "Post-meal reminder",
});
eq("switch blank label dropped", switchProps("   "), { accessibilityRole: "switch" });
eq("pressable default role", pressableProps(), { accessibilityRole: "button" });
eq("pressable label+role", pressableProps(" Back ", "link"), {
  accessibilityRole: "link",
  accessibilityLabel: "Back",
});
eq("slider value", sliderProps("Portion", { min: 0, max: 500, now: 150, text: "150 g" }), {
  accessibilityLabel: "Portion",
  accessibilityValue: { min: 0, max: 500, now: 150, text: "150 g" },
});
eq("slider clamps now to range, text keeps real value", sliderProps("Portion", { min: 0, max: 500, now: 900, text: "900 g" }).accessibilityValue, {
  min: 0,
  max: 500,
  now: 500,
  text: "900 g",
});
eq("slider text defaults to now", sliderProps("Portion", { min: 0, max: 10, now: 4 }).accessibilityValue.text, "4");
eq("hidden glyph props", HIDDEN_FROM_A11Y, {
  accessible: false,
  accessibilityElementsHidden: true,
  importantForAccessibility: "no-hide-descendants",
});

// Part 2: source scan
const root = path.join(__dirname, "..");
function collect(dir: string, out: string[]) {
  for (const e of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const rel = dir + "/" + e.name;
    if (e.isDirectory()) collect(rel, out);
    else if (e.name.endsWith(".tsx")) out.push(rel);
  }
}
const files: string[] = [];
collect("app", files);
collect("components", files);

const TOUCH = /^(Pressable|AnimatedPressable|TouchableOpacity|TouchableHighlight|TouchableWithoutFeedback|PressableScale)$/;
const SWITCHES = /^(Switch|Slider)$/;
const TEXTY = /^(Text|Txt|Muted|H1|SectionLabel|Animated\.Text|AnimatedNumber)$/;
const ICONY = /Icon|Ionicons|Svg|Path|Image/;
const LABEL_SPREAD = /\b(switchProps|sliderProps|pressableProps|pressProps)\(/;
const ROLE_SPREAD = /\b(switchProps|pressableProps|pressProps)\(/;

function childKind(el: any): "text" | "dynamic" | "icon" | "none" {
  if (!ts.isJsxElement(el)) return "none";
  let text = false;
  let dynamic = false;
  let icon = false;
  const visit = (n: any) => {
    if (ts.isJsxText(n)) {
      if (n.getText().trim()) text = true;
    } else if (ts.isJsxElement(n) || ts.isJsxSelfClosingElement(n)) {
      const tag = (ts.isJsxElement(n) ? n.openingElement : n).tagName.getText();
      if (TEXTY.test(tag)) text = true;
      else if (ICONY.test(tag)) icon = true;
      if (ts.isJsxElement(n)) n.children.forEach(visit);
    } else if (ts.isJsxExpression(n)) {
      if (n.expression) dynamic = true;
    } else if (ts.isJsxFragment(n)) n.children.forEach(visit);
  };
  el.children.forEach(visit);
  return text ? "text" : dynamic ? "dynamic" : icon ? "icon" : "none";
}

let scanned = 0;
for (const f of files) {
  const src = fs.readFileSync(path.join(root, f), "utf8");
  const sf = ts.createSourceFile(f, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const lineOf = (n: any) => sf.getLineAndCharacterOfPosition(n.getStart()).line + 1;
  const visit = (n: any) => {
    const opening = ts.isJsxElement(n) ? n.openingElement : ts.isJsxSelfClosingElement(n) ? n : null;
    if (opening) {
      const tag = opening.tagName.getText();
      const attrs = new Map<string, string>();
      let labelViaSpread = false;
      let roleViaSpread = false;
      for (const p of opening.attributes.properties) {
        if (ts.isJsxSpreadAttribute(p)) {
          const text = p.expression.getText();
          if (LABEL_SPREAD.test(text)) labelViaSpread = true;
          if (ROLE_SPREAD.test(text)) roleViaSpread = true;
        } else attrs.set(p.name.getText(), p.initializer ? p.initializer.getText() : "true");
      }
      const hasLabel = attrs.has("accessibilityLabel") || attrs.has("aria-label") || labelViaSpread;
      const hasRole = attrs.has("accessibilityRole") || attrs.has("role") || roleViaSpread;
      const hidden =
        attrs.get("accessible") === "{false}" ||
        attrs.has("accessibilityElementsHidden") ||
        /no-hide|"no"/.test(attrs.get("importantForAccessibility") ?? "");
      const where = `${f}:${lineOf(n)} <${tag}>`;
      if (SWITCHES.test(tag)) {
        scanned++;
        if (!hasLabel && !hidden) fail(`${where} has no accessibility label`);
      } else if (TOUCH.test(tag) && (attrs.has("onPress") || attrs.has("onLongPress"))) {
        scanned++;
        const optedOut = attrs.has("accessible");
        if (!hidden && !optedOut) {
          const kind = childKind(n);
          if (!hasRole) fail(`${where} has a handler but no accessibilityRole`);
          if (hasRole && !hasLabel && (kind === "icon" || kind === "none")) {
            fail(`${where} has no readable text child and no accessibilityLabel`);
          }
        }
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
}
checks += scanned;
if (scanned < 100) fail(`scan looks broken: only ${scanned} interactive elements found`);

// Part 3: shared contracts
const read = (rel: string) => fs.readFileSync(path.join(root, rel), "utf8");
const mustInclude = (rel: string, needle: string, why: string) => {
  checks++;
  if (!read(rel).includes(needle)) fail(`${rel}: ${why}`);
};
mustInclude("components/ui.tsx", 'accessibilityRole="header"', "SectionLabel must be a header");
mustInclude("components/SheetShell.tsx", 'accessibilityRole="header"', "sheet title must be a header");
mustInclude("components/ScreenHeader.tsx", 'accessibilityRole="header"', "screen title must be a header");
mustInclude("app/_layout.tsx", 'import "../lib/iconA11y"', "icon glyph hiding must be installed at the root");
mustInclude("lib/iconA11y.ts", "HIDDEN_FROM_A11Y", "icon families must default to hidden from the screen reader");

console.log(failed === 0 ? `a11yLabels: all passed (${checks} checks)` : `a11yLabels: ${failed} failed`);
if (failed) process.exit(1);
