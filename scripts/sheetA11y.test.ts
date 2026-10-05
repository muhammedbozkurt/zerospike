/**
 * AST harness for sheet/modal accessibility. Run: npx tsx scripts/sheetA11y.test.ts
 *
 * For every card (an element whose onPress calls stopPropagation) it walks the
 * JSX ancestors up to the Modal / accessibilityViewIsModal root and requires:
 *  1. the card and every Pressable-like ancestor to be accessible={false} and
 *     focusable={false} (an accessible ancestor makes iOS fold the whole card
 *     into one element; Pressable is focusable on Android by default),
 *  2. no other ancestor to opt in with a truthy accessible,
 *  3. the Modal/overlay block to give a way out: onAccessibilityEscape on the
 *     root or an element inside it (an ancestor outside a Modal is a separate
 *     view controller on iOS), or a visible, pressable close/cancel/back button.
 */
declare const require: (m: string) => any;
declare const process: { exit: (code: number) => void };
declare const __dirname: string;
const ts = require("typescript");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
function collect(dir: string, out: string[]) {
  for (const e of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const rel = dir + "/" + e.name;
    if (e.isDirectory()) collect(rel, out);
    else if (e.name.endsWith(".tsx") && fs.readFileSync(path.join(root, rel), "utf8").includes("stopPropagation")) out.push(rel);
  }
}
const files: string[] = [];
collect("components", files);
collect("app", files);
const PRESS = /^(Pressable|AnimatedPressable|TouchableOpacity|TouchableWithoutFeedback|TouchableHighlight)$/;
const CLOSE_LABEL = /common\.(close|cancel|back)|closeLabel|cancelLabel/;

function attrs(el: any): Record<string, string> {
  const o: Record<string, string> = {};
  for (const p of el.attributes.properties) if (p.name) o[p.name.getText()] = p.initializer ? p.initializer.getText() : "true";
  return o;
}
function opening(n: any) {
  return ts.isJsxElement(n) ? n.openingElement : ts.isJsxSelfClosingElement(n) ? n : null;
}

let failed = 0;
const fail = (msg: string) => {
  failed++;
  console.log("FAIL " + msg);
};

for (const f of files) {
  const src = fs.readFileSync(path.join(root, f), "utf8");
  const sf = ts.createSourceFile(f, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const lineOf = (n: any) => sf.getLineAndCharacterOfPosition(n.getStart()).line + 1;
  const blocks = new Map<any, string[]>();
  let cards = 0;

  const isModalRoot = (el: any) => {
    const tag = el.tagName.getText();
    return tag === "Modal" || attrs(el).accessibilityViewIsModal !== undefined;
  };

  const visit = (n: any) => {
    const el = opening(n);
    if (el && (attrs(el).onPress || "").includes("stopPropagation")) {
      cards++;
      const chain: any[] = [n];
      let rootNode: any = null;
      for (let p = n.parent; p; p = p.parent) {
        if (!ts.isJsxElement(p)) continue;
        chain.push(p);
        if (isModalRoot(p.openingElement)) {
          rootNode = p;
          break;
        }
      }
      for (const node of chain) {
        const oe = opening(node);
        const tag = oe.tagName.getText();
        const a = attrs(oe);
        const where = `${f}:${lineOf(oe)} <${tag}>`;
        if (PRESS.test(tag)) {
          if (a.accessible !== "{false}") fail(`${where} is accessible (needs accessible={false})`);
          if (a.focusable !== "{false}") fail(`${where} lacks focusable={false}`);
        } else if (node !== rootNode && a.accessible && a.accessible !== "{false}") {
          fail(`${where} opts into accessible`);
        }
      }
      if (!rootNode) {
        fail(`${f}:${lineOf(el)} card has no Modal / accessibilityViewIsModal root`);
      } else if (!blocks.has(rootNode)) {
        blocks.set(rootNode, []);
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  if (cards === 0) fail(`${f} mentions stopPropagation but has no card element`);

  for (const rootNode of blocks.keys()) {
    let hasEscape = false;
    let hasButton = false;
    const scan = (n: any, hidden: boolean) => {
      const el = opening(n);
      let h = hidden;
      if (el) {
        const a = attrs(el);
        if (a.accessibilityElementsHidden === "true" || a.accessibilityElementsHidden === "{true}" || /no-hide-descendants|"no"/.test(a.importantForAccessibility || "")) h = true;
        if (!h) {
          if (a.onAccessibilityEscape) hasEscape = true;
          if (a.onPress && a.accessible !== "{false}") {
            if (a.accessibilityLabel && CLOSE_LABEL.test(a.accessibilityLabel)) hasButton = true;
            if (ts.isJsxElement(n) && a.accessibilityRole === '"button"' && /common\.(close|cancel|back)/.test(n.getText())) hasButton = true;
          }
        }
      }
      ts.forEachChild(n, (c: any) => scan(c, h));
    };
    scan(rootNode, false);
    if (!hasEscape && !hasButton) fail(`${f}:${lineOf(rootNode)} block has no onAccessibilityEscape or accessible close/cancel/back button`);
  }
}

console.log(failed === 0 ? "sheetA11y: all passed" : `sheetA11y: ${failed} failed`);
if (failed) process.exit(1);
