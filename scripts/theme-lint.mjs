/**
 * Theme lint (report mode). Finds
 *  1. module-level uses of THEME / GLUCOSE_* / RICH_BY_STATUS / ELEVATION that
 *     freeze the first palette (a top-level const that is not a function),
 *  2. hard-coded hex and rgba() colors in app code.
 * A bare alias of a live export (`export const A = LIVE;`) is not a freeze.
 * Out of scope: lib/services/report.ts, lib/services/androidWidget.ts,
 * lib/theme/tokens.ts. A line marked `// theme-ok`
 * (or `{/* theme-ok *\/}`) is allowed.
 * Run: node scripts/theme-lint.mjs [--strict] [--files]   (strict: exit 1 on findings)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCAN = ["app", "components", "lib"];
const SKIP = [
  "lib/services/report.ts",
  "lib/services/androidWidget.ts",
  "lib/services/widgetColors.ts",
  "lib/services/pdfColors.ts",
  "lib/theme/tokens.ts",
  "lib/theme/contrast.ts",
  "lib/i18n/",
];
const strict = process.argv.includes("--strict");
const listFiles = process.argv.includes("--files");

function walk(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(e.name)) out.push(p);
  }
  return out;
}

const TOKEN = /\b(THEME\b|GLUCOSE_COLORS|GLUCOSE_TINT|GLUCOSE_TEXT|GLUCOSE_RICH|RICH_BY_STATUS|ELEVATION|STATUS_COLOR)/;
const LIVE_ALIAS = /^(export\s+)?const\s+\w+(\s*:\s*[^=]+)?\s*=\s*[A-Z_]+;\s*$/;
const HEX = /#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b/g;
const RGBA = /rgba?\(/g;

const moduleLevel = [];
const hexHits = new Map();
const rgbaHits = new Map();
let hexTotal = 0;
let rgbaTotal = 0;

for (const top of SCAN) {
  const dir = path.join(root, top);
  if (!fs.existsSync(dir)) continue;
  for (const file of walk(dir, [])) {
    const rel = path.relative(root, file).split(path.sep).join("/");
    if (SKIP.some((s) => rel.startsWith(s) || rel === s)) continue;
    const lines = fs.readFileSync(file, "utf8").split("\n");

    let i = 0;
    while (i < lines.length) {
      if (/^(export\s+)?(const|let|var)\s/.test(lines[i])) {
        let j = i + 1;
        while (j < lines.length && !/^\S/.test(lines[j])) j++;
        const stmt = lines.slice(i, j).join("\n");
        const m = stmt.match(TOKEN);
        if (m) {
          const before = stmt.slice(0, m.index);
          const inFn = /=>|\bfunction\b/.test(before);
          if (!inFn && !/theme-ok/.test(stmt) && !LIVE_ALIAS.test(stmt.trim())) {
            const ln = i + 1 + stmt.slice(0, m.index).split("\n").length - 1;
            moduleLevel.push(`${rel}:${ln}`);
          }
        }
        i = j;
      } else i++;
    }

    lines.forEach((line, idx) => {
      if (/theme-ok/.test(line)) return;
      if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
      const h = line.match(HEX);
      if (h) {
        hexTotal += h.length;
        hexHits.set(rel, (hexHits.get(rel) || 0) + h.length);
      }
      const r = line.match(RGBA);
      if (r) {
        rgbaTotal += r.length;
        rgbaHits.set(rel, (rgbaHits.get(rel) || 0) + r.length);
      }
    });
  }
}

if (listFiles) {
  console.log("-- module-level token use");
  moduleLevel.forEach((m) => console.log(m));
  console.log("-- hex per file");
  [...hexHits].sort((a, b) => b[1] - a[1]).forEach(([f, n]) => console.log(`${n}\t${f}`));
  console.log("-- rgba per file");
  [...rgbaHits].sort((a, b) => b[1] - a[1]).forEach(([f, n]) => console.log(`${n}\t${f}`));
}
console.log(`module-level token uses: ${moduleLevel.length}`);
console.log(`hard-coded hex: ${hexTotal} in ${hexHits.size} files`);
console.log(`hard-coded rgba(: ${rgbaTotal} in ${rgbaHits.size} files`);
if (strict && (moduleLevel.length || hexTotal || rgbaTotal)) process.exit(1);
