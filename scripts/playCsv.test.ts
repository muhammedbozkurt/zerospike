/**
 * Play Console CSV for the weekly metrics: a quote-aware parser, and a weekly
 * total only when all 7 days are present. Run from the repo root:
 *
 *   npx tsx scripts/playCsv.test.ts
 */
// @ts-ignore plain .mjs next to the script that uses it
import { playSourceFromText, splitCsvLine } from "./playCsv.mjs";

let passed = 0;
let failed = 0;
function eq<T>(name: string, actual: T, expected: T): void {
  if (JSON.stringify(actual) === JSON.stringify(expected)) passed++;
  else {
    failed++;
    console.log(`  x ${name}: got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
  }
}

const START = "2026-10-11";
const END = "2026-10-17";
const day = (i: number) => `2026-10-${String(11 + i).padStart(2, "0")}`;

eq("a quoted comma stays in its column", splitCsvLine('2026-10-11,"1,234",x'), ["2026-10-11", "1,234", "x"]);
eq("a doubled quote is one quote", splitCsvLine('a,"b ""c"" d",e'), ["a", 'b "c" d', "e"]);

{
  const rows = ["Date,Package Name,Daily User Installs"];
  for (let i = 0; i < 7; i++) rows.push(`${day(i)},com.zerospike,"1,${i}00"`);
  const r = playSourceFromText(rows.join("\n"), START, END);
  eq("7 days with quoted thousands: the weekly total", r.installs, 7 * 1000 + 2100);
  eq("no unavailable note", r.unavailable, []);
}
{
  const rows = ["Date,Package Name,Daily User Installs"];
  for (let i = 0; i < 5; i++) rows.push(`${day(i)},com.zerospike,10`);
  const r = playSourceFromText(rows.join("\n"), START, END);
  eq("5 days is no weekly total", r.installs, null);
  eq("and no row", r.rows, []);
  eq("the source is listed as unavailable", r.unavailable.length, 1);
  eq("naming the day count", /5 gun/.test(r.unavailable[0]), true);
}
{
  const rows = ["Date,Package Name,Daily User Installs"];
  for (let i = 0; i < 7; i++) rows.push(`${day(i)},com.zerospike,10`);
  rows.push(`${day(0)},com.zerospike.other,10`);
  const r = playSourceFromText(rows.join("\n"), START, END);
  eq("a repeated day does not count twice or make 8 days", r.installs, 70);
}
{
  const rows = ["Date,Package Name,Daily User Installs", `2026-09-01,com.zerospike,10`];
  const r = playSourceFromText(rows.join("\n"), START, END);
  eq("no day in the window: unavailable", r.installs, null);
}
{
  const r = playSourceFromText("Foo,Bar\n1,2", START, END);
  eq("unknown columns: unavailable", r.installs, null);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
