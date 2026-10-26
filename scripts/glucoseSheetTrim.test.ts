/** G18: a pasted/inserted extra decimal is trimmed to the field's precision and
 *  accepted, only genuinely malformed text stays an error.
 *  Run: npx -y tsx scripts/glucoseSheetTrim.test.ts */
import { outsideTapAction, readGlucoseSheetInput } from "../lib/glucoseSheetInput";

let failed = 0;
function eq(name: string, got: unknown, want: unknown): void {
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    failed++;
    console.log(`  x ${name}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
  }
}

eq("insert mid", readGlucoseSheetInput("5,65", "5,5", true), { text: "5,6", bad: false });
eq("paste 5,55", readGlucoseSheetInput("5,55", "", true), { text: "5,5", bad: false });
eq("paste dot", readGlucoseSheetInput("7.25", "", true), { text: "7.2", bad: false });
eq("typed ok", readGlucoseSheetInput("5,6", "5,", true), { text: "5,6", bad: false });
eq("minus stays bad", readGlucoseSheetInput("-4.5", "", true).bad, true);
eq("exp stays bad", readGlucoseSheetInput("1e2", "", true).bad, true);
eq("two seps stay bad", readGlucoseSheetInput("7.5.5", "", true).bad, true);
eq("mgdl decimals stay bad", readGlucoseSheetInput("110,5", "", false).bad, true);
eq("mgdl ok", readGlucoseSheetInput("110", "11", false), { text: "110", bad: false });

eq("outside tap keyboard", outsideTapAction("5,5", true), "keyboard");
eq("outside tap empty", outsideTapAction("", true), "close");
eq("outside tap no kb", outsideTapAction("5,5", false), "close");

if (failed) {
  console.log(`FAIL ${failed}`);
  process.exit(1);
}
console.log("glucoseSheetTrim ok");
