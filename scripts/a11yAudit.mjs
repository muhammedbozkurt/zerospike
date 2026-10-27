/**
 * 241-P7 VoiceOver static audit: AST scan of app/ components/ for interactive
 * JSX without accessibilityLabel/Role, icon-only controls, Modal without
 * accessibilityViewIsModal, Image/Svg without alt, allowFontScaling={false}.
 * Run from the repo root: node scripts/a11yAudit.mjs [--json]
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const ROOT = process.cwd();
const require = createRequire(ROOT + "/package.json");
const ts = require("typescript");

const NATIVE_TOUCH = new Set([
  "Pressable", "TouchableOpacity", "TouchableHighlight", "TouchableWithoutFeedback",
  "TouchableNativeFeedback", "PressableScale", "AnimatedPressable", "Animated.createAnimatedComponent",
]);
const INPUTS = new Set(["TextInput", "Field"]);
const SWITCHES = new Set(["Switch", "Slider"]);
const TEXTY = /^(Text|Txt|Muted|H1|SectionLabel|Animated\.Text|AnimatedNumber|SectionHeading|Title|Label|Caption)$/;

function walk(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.tsx$/.test(e.name)) out.push(p);
  }
  return out;
}

const files = [];
for (const d of ["app", "components"]) walk(path.join(ROOT, d), files);

// A Field's label prop only reaches the screen reader if ui.tsx hands it to the TextInput.
const uiSrc = fs.readFileSync(path.join(ROOT, "components/ui.tsx"), "utf8");
const fieldStart = uiSrc.indexOf("export const Field");
const FIELD_FORWARDS_LABEL = uiSrc
  .slice(fieldStart, uiSrc.indexOf("interface SegmentedProps", fieldStart))
  .includes("accessibilityLabel={label}");

const findings = [];
const stats = { files: files.length, pressables: 0, inputs: 0, switches: 0, modals: 0, images: 0, svgs: 0, fontScaleOff: 0, customOnPress: 0 };

function tagName(n) { return n.tagName.getText(); }
function attrs(opening) {
  const m = new Map(); let spread = false; let helperLabel = false; let helperRole = false;
  for (const a of opening.attributes.properties) {
    if (ts.isJsxSpreadAttribute(a)) {
      spread = true;
      // lib/a11y.ts builders and Stepper's pressProps always carry the role and the label.
      const text = a.expression.getText();
      if (/\b(switchProps|sliderProps|pressableProps|pressProps)\(/.test(text)) { helperLabel = true; helperRole = true; }
      continue;
    }
    m.set(a.name.getText(), a.initializer ? a.initializer.getText() : "true");
  }
  return { m, spread, helperLabel, helperRole };
}
function hasTextChild(el) {
  if (!ts.isJsxElement(el)) return "none";
  let text = false, dynamic = false, icon = false;
  const visit = (n) => {
    if (ts.isJsxText(n)) { if (n.getText().trim()) text = true; }
    else if (ts.isJsxElement(n) || ts.isJsxSelfClosingElement(n)) {
      const op = ts.isJsxElement(n) ? n.openingElement : n;
      const t = op.tagName.getText();
      if (TEXTY.test(t)) text = true;
      else if (/Icon|Ionicons|Feather|MaterialIcons|MaterialCommunityIcons|Svg|Path|Image/.test(t)) icon = true;
      if (ts.isJsxElement(n)) n.children.forEach(visit);
    } else if (ts.isJsxExpression(n)) { if (n.expression) dynamic = true; n.expression && ts.forEachChild(n.expression, visit); }
    else if (ts.isJsxFragment(n)) n.children.forEach(visit);
  };
  el.children.forEach(visit);
  return text ? "text" : dynamic ? "dynamic" : icon ? "icon" : "none";
}

for (const file of files) {
  const rel = path.relative(ROOT, file);
  const src = fs.readFileSync(file, "utf8");
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const lineOf = (n) => sf.getLineAndCharacterOfPosition(n.getStart()).line + 1;
  const visit = (node) => {
    let opening = null, el = null;
    if (ts.isJsxElement(node)) { opening = node.openingElement; el = node; }
    else if (ts.isJsxSelfClosingElement(node)) { opening = node; el = node; }
    if (opening) {
      const tag = opening.tagName.getText();
      const { m, spread, helperLabel, helperRole } = attrs(opening);
      const label = m.has("accessibilityLabel") || m.has("aria-label") || m.has("accessibilityLabelledBy") || helperLabel || (tag === "Field" && m.has("label") && FIELD_FORWARDS_LABEL);
      const role = m.has("accessibilityRole") || m.has("role") || helperRole;
      const hidden = /false/.test(m.get("accessible") ?? "") || /no-hide|"no"/.test(m.get("importantForAccessibility") ?? "") || m.has("accessibilityElementsHidden") || m.get("aria-hidden") === "true";
      const push = (sev, kind, extra = "") => findings.push({ file: rel, line: lineOf(node), tag, sev, kind, extra });
      if (m.get("allowFontScaling") && /false/.test(m.get("allowFontScaling"))) { stats.fontScaleOff++; push("info", "allowFontScaling=false"); }
      if (NATIVE_TOUCH.has(tag) || (tag.endsWith("Pressable"))) {
        stats.pressables++;
        if (!m.has("onPress") && !m.has("onLongPress") && !m.has("onPressIn") && !spread) {
          // pure wrapper / decorative Pressable (e.g. backdrop)
          if (!hidden) push("low", "pressable-no-handler");
        } else if (!hidden) {
          const child = hasTextChild(el);
          if (!label && !role) {
            if (child === "text") push("med", "no-role-no-label(text child)", "VO reads text but no button trait");
            else if (child === "dynamic") push("med", "no-role-no-label(dynamic child)", spread ? "spread" : "");
            else push("high", "ICON-ONLY no label/role", child);
          } else if (!role) push("med", "no-role", `label present`);
          else if (!label && child !== "text" && child !== "dynamic") push("high", "role but no label, no text child", child);
        }
      } else if (INPUTS.has(tag)) {
        stats.inputs++;
        if (!label && !hidden && !spread) push(m.has("placeholder") ? "med" : "high", "input-no-label", m.has("placeholder") ? "placeholder only" : "");
      } else if (SWITCHES.has(tag)) {
        stats.switches++;
        if (!label && !hidden) push("high", "switch/slider-no-label", spread ? "spread props (checked: spread does not carry a label)" : "");
      } else if (tag === "Modal") {
        stats.modals++;
        push(m.has("accessibilityViewIsModal") ? "ok" : "info", "Modal", m.has("accessibilityViewIsModal") ? "has viewIsModal" : "RN Modal already modal on iOS; check content");
      } else if (tag === "Image" || tag === "ExpoImage" || tag === "Animated.Image") {
        stats.images++;
        if (!label && !hidden && !m.has("alt")) push("low", "image-no-alt/hidden");
      } else if (tag === "Svg") {
        stats.svgs++;
        if (!label && !hidden && !m.has("accessible")) push("low", "svg-no-label/hidden");
      } else if (m.has("onPress") && !/^(Text|Txt)$/.test(tag)) {
        stats.customOnPress++;
        if (!label && !role && !spread) push("low", "custom-component-onPress", "verify component sets role/label internally");
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
}

const bySev = (s) => findings.filter((f) => f.sev === s);
if (process.argv.includes("--json")) {
  console.log(JSON.stringify({ stats, findings }, null, 1));
} else {
  console.log("STATS", JSON.stringify(stats));
  for (const s of ["high", "med", "low", "info"]) {
    const arr = bySev(s);
    console.log(`\n== ${s.toUpperCase()} (${arr.length}) ==`);
    const byKind = {};
    for (const f of arr) (byKind[f.kind] ??= []).push(f);
    for (const [k, v] of Object.entries(byKind)) {
      console.log(`-- ${k} (${v.length})`);
      for (const f of v) console.log(`${f.file}:${f.line} <${f.tag}> ${f.extra}`);
    }
  }
}
