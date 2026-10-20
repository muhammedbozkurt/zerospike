/**
 * Paywall price math for the shipped price table (US, TR, MX, BR). The paywall
 * derives "about X / month" with perMonthPrice() + money() and the savings badge
 * inline in app/paywall.tsx (Math.round(1 - annual / (monthly * 12))); the
 * formula is mirrored here because the screen cannot be imported in node.
 *
 *   npx tsx scripts/paywallPricing.test.ts
 */
import { money, num, pct } from "../lib/format";
import { lifetimeYearsOfAnnual } from "../lib/paywallPricing";
import { setActiveLang } from "../lib/lang";
import { perMonthPrice } from "../lib/trialTimeline";

let failed = 0;
function eq<T>(name: string, actual: T, expected: T): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    failed++;
    console.log(`  x ${name}: got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
  }
}

const savePct = (monthly: number, annual: number) => Math.round((1 - annual / (monthly * 12)) * 100);
const norm = (s: string) => s.replace(/[  ]/g, " ");

const CASES = [
  { name: "US", lang: "en", cur: "USD", monthly: 4.99, annual: 29.99, offer: 19.99, save: 50, offerSave: 67, perMonth: "$2.50", badge: "50%" },
  { name: "TR", lang: "tr", cur: "TRY", monthly: 119.99, annual: 699.99, offer: 479.99, save: 51, offerSave: 67, perMonth: "₺58,33", badge: "%51" },
  { name: "MX", lang: "es", cur: "MXN", monthly: 59, annual: 349, offer: 229, save: 51, offerSave: 68, perMonth: "29,08", badge: "51 %" },
  { name: "BR", lang: "pt", cur: "BRL", monthly: 14.9, annual: 89.9, offer: 59.9, save: 50, offerSave: 66, perMonth: "7,49", badge: "50%" },
];

for (const c of CASES) {
  setActiveLang(c.lang);
  eq(`${c.name} annual savings`, savePct(c.monthly, c.annual), c.save);
  eq(`${c.name} second-offer savings vs 12 months`, savePct(c.monthly, c.offer), c.offerSave);
  eq(`${c.name} badge text`, norm(pct(savePct(c.monthly, c.annual))), c.badge);
  const pm = perMonthPrice(c.annual);
  eq(`${c.name} per-month value`, pm == null ? null : Math.round(pm * 100) / 100, Math.round((c.annual / 12) * 100) / 100);
  const text = norm(money(pm as number, c.cur));
  eq(`${c.name} approx per-month contains ${c.perMonth}`, text.includes(c.perMonth), true);
}

setActiveLang("tr");
eq("TR 699,99 / 12 shown as ₺58,33", norm(money(perMonthPrice(699.99) as number, "TRY")), "₺58,33");
eq("TR savings sentence", `${pct(51)} tasarruf`, "%51 tasarruf");
setActiveLang("en");
eq("per-month null for missing price", perMonthPrice(null), null);

// Lifetime anchor: lifetime / NORMAL annual price, one decimal, same currency.
const LT = [
  { name: "TR", cur: "TRY", lifetime: 2399.99, annual: 699.99, years: 3.4, lang: "tr", text: "3,4" },
  { name: "US", cur: "USD", lifetime: 99.99, annual: 29.99, years: 3.3, lang: "en", text: "3.3" },
  { name: "EUR", cur: "EUR", lifetime: 99.99, annual: 29.99, years: 3.3, lang: "de", text: "3,3" },
  { name: "BR", cur: "BRL", lifetime: 299.9, annual: 89.9, years: 3.3, lang: "pt", text: "3,3" },
  { name: "MX", cur: "MXN", lifetime: 1099, annual: 349, years: 3.1, lang: "es", text: "3,1" },
];
for (const c of LT) {
  const y = lifetimeYearsOfAnnual(
    { price: c.lifetime, currencyCode: c.cur },
    { price: c.annual, currencyCode: c.cur }
  );
  eq(`${c.name} lifetime years`, y, c.years);
  setActiveLang(c.lang);
  eq(`${c.name} lifetime years text`, norm(num(y as number)), c.text);
}
const P = (price: number, cur = "USD") => ({ price, currencyCode: cur });
eq("lifetime missing", lifetimeYearsOfAnnual(null, P(29.99)), null);
eq("annual missing", lifetimeYearsOfAnnual(P(99.99), undefined), null);
eq("annual zero", lifetimeYearsOfAnnual(P(99.99), P(0)), null);
eq("lifetime zero", lifetimeYearsOfAnnual(P(0), P(29.99)), null);
eq("NaN price", lifetimeYearsOfAnnual(P(Number.NaN), P(29.99)), null);
eq("currency differs", lifetimeYearsOfAnnual(P(99.99, "USD"), P(29.99, "EUR")), null);
eq("currency empty", lifetimeYearsOfAnnual(P(99.99, ""), P(29.99, "")), null);
eq("lifetime not dearer than a year", lifetimeYearsOfAnnual(P(29.99), P(29.99)), null);
eq("whole years", lifetimeYearsOfAnnual(P(90), P(30)), 3);
setActiveLang("en");

if (failed) {
  console.log(`paywallPricing: ${failed} failed`);
  process.exit(1);
}
console.log("paywallPricing: all passed");
