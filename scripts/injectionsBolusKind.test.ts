/**
 * Locks the updateInjection bolus_kind decision (audit finding: a calculator
 * correction that patches {dose_units, insulin_type: 'bolus', tags,
 * logged_at} without bolus_kind used to silently null out a kind the user had
 * picked by hand on the injection tab).
 *
 * lib/db/injections.ts imports getDb from ./index, which imports expo-sqlite -
 * a native module the plain-node harness used by this script cannot load (see
 * scripts/seed.test.ts's header for the same constraint on lib/db/foods.ts).
 * So rather than importing the module, this test reads the exact
 * TEST-EXTRACT-START/END block out of the real, shipped injections.ts source,
 * strips its TypeScript types with the `typescript` package (already a
 * project dependency; no type-checking involved, just syntax stripping), and
 * evaluates the resulting JS. The functions under test are therefore the real
 * ones the app runs, not a hand-copied reimplementation.
 *
 * Run: npx tsx scripts/injectionsBolusKind.test.ts
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";

let passed = 0;
let failed = 0;

function eq(label: string, got: unknown, want: unknown): void {
  if (got === want) {
    passed++;
  } else {
    failed++;
    console.error(`  ✗ ${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  }
}

function section(title: string): void {
  console.log(`\n${title}`);
}

const SRC_PATH = join(__dirname, "../lib/db/injections.ts");
const source = readFileSync(SRC_PATH, "utf8");

const START = "// TEST-EXTRACT-START";
const END = "// TEST-EXTRACT-END";
const startIdx = source.indexOf(START);
const endIdx = source.indexOf(END);
if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) {
  throw new Error(
    "injectionsBolusKind.test.ts: TEST-EXTRACT markers not found in lib/db/injections.ts - " +
      "the source moved and this test can no longer pin the real function."
  );
}
const extracted = source.slice(startIdx, endIdx);

const { outputText } = ts.transpileModule(extracted, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 },
});

type BolusKind = "meal" | "correction";
type InsulinType = "basal" | "bolus";
type BolusKindResult = { touches: false } | { touches: true; value: BolusKind | null };

const factory = new Function(
  `${outputText}\nreturn { needsCurrentInsulinType, resolveBolusKindPatch, normalizedBolusKind };`
) as () => {
  needsCurrentInsulinType: (patch: {
    insulin_type?: InsulinType | null;
    bolus_kind?: BolusKind | null;
  }) => boolean;
  resolveBolusKindPatch: (
    patch: { insulin_type?: InsulinType | null; bolus_kind?: BolusKind | null },
    currentInsulinType: InsulinType | null
  ) => BolusKindResult;
  normalizedBolusKind: (
    insulinType: InsulinType | null | undefined,
    bolusKind: BolusKind | null | undefined
  ) => BolusKind | null;
};

const { needsCurrentInsulinType, resolveBolusKindPatch } = factory();

console.log("zerospike updateInjection bolus_kind decision test");

// ── A. The reported bug: a calculator correction must not touch the column ──
section("A. calculator re-save of an existing meal (the audit's failure case)");
{
  // {dose_units, insulin_type: 'bolus', tags, logged_at} - exactly what
  // app/calculator.tsx sends back to updateInjection, no bolus_kind key.
  const patch = { insulin_type: "bolus" as const };
  eq("no DB fetch needed", needsCurrentInsulinType(patch), false);
  const result = resolveBolusKindPatch(patch, null);
  eq("the column is left untouched (kind survives)", result.touches, false);
}

// ── B. User explicitly picks a bolus kind on the injection tab ─────────────
section("B. explicit bolus_kind, no insulin_type in the same patch");
{
  const patch = { bolus_kind: "meal" as const };
  eq("needs the row's current type", needsCurrentInsulinType(patch), true);

  const onBolusRow = resolveBolusKindPatch(patch, "bolus");
  eq("touches the column", onBolusRow.touches, true);
  eq("writes the chosen kind", onBolusRow.touches && onBolusRow.value, "meal");

  // Defensive: a bolus_kind patch against a row that (per the DB) is not
  // currently a bolus row is still normalised to null, never written raw.
  const onBasalRow = resolveBolusKindPatch(patch, "basal");
  eq("normalises to null against a non-bolus current row", onBasalRow.touches && onBasalRow.value, null);
}

// ── C. insulin_type set together with bolus_kind (edit sheet saving both) ──
section("C. insulin_type and bolus_kind set in the same patch");
{
  const patch = { insulin_type: "bolus" as const, bolus_kind: "correction" as const };
  eq("no DB fetch needed (type is already in the patch)", needsCurrentInsulinType(patch), false);
  const result = resolveBolusKindPatch(patch, null);
  eq("touches the column", result.touches, true);
  eq("writes the chosen kind", result.touches && result.value, "correction");
}

// ── D. Type moves OFF bolus: kind must clear even if not named in the patch ─
section("D. insulin_type moves off 'bolus'");
{
  const patch = { insulin_type: "basal" as const };
  eq("no DB fetch needed", needsCurrentInsulinType(patch), false);
  const result = resolveBolusKindPatch(patch, "meal");
  eq("touches the column", result.touches, true);
  eq("clears the kind", result.touches && result.value, null);
}

// ── E. Neither field touched: leave the column alone ────────────────────────
section("E. an unrelated patch (e.g. only a note edit)");
{
  const patch = {};
  eq("no DB fetch needed", needsCurrentInsulinType(patch), false);
  const result = resolveBolusKindPatch(patch, "meal");
  eq("the column is left untouched", result.touches, false);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
