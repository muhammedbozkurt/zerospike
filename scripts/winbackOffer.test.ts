/**
 * lib/winbackOffer.ts: the pure decision behind the iOS win-back surface
 * (Apple win-back offer, else the existing downsell card; Android untouched).
 * No jest, same standalone style as scripts/downsell.test.ts.
 *
 * Run: npx -y tsx scripts/winbackOffer.test.ts
 */
declare const console: { log: (...a: unknown[]) => void };
declare const process: { exit: (code: number) => void };
declare function setTimeout(handler: () => void, ms?: number): unknown;

import {
  WINBACK_OFFER_TIMEOUT_MS,
  iosSupportsWinBack,
  pickAppleWinBackOffer,
  resolveAppleWinBack,
  decideWinbackSource,
  winbackOfferToParams,
  winbackOfferFromParams,
  type AppleWinBackCandidate,
} from "../lib/winbackOffer";

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean, detail = ""): void {
  if (cond) passed++;
  else {
    failed++;
    console.log(`  x ${name}${detail ? ": " + detail : ""}`);
  }
}
function eq<T>(name: string, actual: T, expected: T): void {
  ok(name, JSON.stringify(actual) === JSON.stringify(expected), `got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
}
function section(title: string): void {
  console.log(`\n${title}`);
}

const STANDARD = 29.99;
const offer = (extra: Partial<AppleWinBackCandidate> = {}): AppleWinBackCandidate => ({
  identifier: "winback_y1",
  price: 19.99,
  priceString: "$19.99",
  cycles: 1,
  periodUnit: "YEAR",
  periodNumberOfUnits: 1,
  ...extra,
});

console.log("zerospike winbackOffer test");

(async () => {
  section("A. iOS version gate (win-back needs iOS 18+)");
  eq("timeout is 3 s", WINBACK_OFFER_TIMEOUT_MS, 3000);
  ok("18.0", iosSupportsWinBack("ios", "18.0"));
  ok("18.4.1", iosSupportsWinBack("ios", "18.4.1"));
  ok("26.0", iosSupportsWinBack("ios", "26.0"));
  ok("17.6 is below", !iosSupportsWinBack("ios", "17.6"));
  ok("numeric 18 works", iosSupportsWinBack("ios", 18));
  ok("garbage version fails closed", !iosSupportsWinBack("ios", "abc"));
  ok("undefined version fails closed", !iosSupportsWinBack("ios", undefined));
  ok("android never", !iosSupportsWinBack("android", "34"));

  section("B. pickAppleWinBackOffer");
  eq("one valid yearly pay-up-front offer", pickAppleWinBackOffer([offer()], STANDARD)?.identifier, "winback_y1");
  eq("percent vs standard", pickAppleWinBackOffer([offer()], STANDARD)?.savingsPercent, 33);
  eq("price string from the store", pickAppleWinBackOffer([offer()], STANDARD)?.discountedPriceString, "$19.99");
  eq(
    "lowest price wins",
    pickAppleWinBackOffer([offer({ identifier: "a", price: 24.99, priceString: "$24.99" }), offer({ identifier: "b" })], STANDARD)?.identifier,
    "b"
  );
  eq("12 months counts as a year", pickAppleWinBackOffer([offer({ periodUnit: "MONTH", periodNumberOfUnits: 12 })], STANDARD)?.identifier, "winback_y1");
  eq("lowercase unit is read", pickAppleWinBackOffer([offer({ periodUnit: "year" })], STANDARD)?.identifier, "winback_y1");
  eq("empty list", pickAppleWinBackOffer([], STANDARD), null);
  eq("undefined list", pickAppleWinBackOffer(undefined, STANDARD), null);
  eq("null list", pickAppleWinBackOffer(null, STANDARD), null);
  eq("free offer (price 0) is not a discount card", pickAppleWinBackOffer([offer({ price: 0, priceString: "$0.00" })], STANDARD), null);
  eq(
    "pay-as-you-go (cycles > 1) is skipped",
    pickAppleWinBackOffer([offer({ cycles: 3, periodUnit: "MONTH", periodNumberOfUnits: 1, price: 2.99 })], STANDARD),
    null
  );
  eq("3-month offer is skipped", pickAppleWinBackOffer([offer({ periodUnit: "MONTH", periodNumberOfUnits: 3 })], STANDARD), null);
  eq("not cheaper than standard", pickAppleWinBackOffer([offer({ price: 29.99 })], STANDARD), null);
  eq("dearer than standard", pickAppleWinBackOffer([offer({ price: 39.99 })], STANDARD), null);
  eq("rounds to 0 percent is skipped", pickAppleWinBackOffer([offer({ price: 29.9 })], STANDARD), null);
  eq("standard price unreadable", pickAppleWinBackOffer([offer()], 0), null);
  eq("NaN price skipped", pickAppleWinBackOffer([offer({ price: NaN })], STANDARD), null);
  eq("empty price string skipped", pickAppleWinBackOffer([offer({ priceString: "" })], STANDARD), null);
  eq("a bad offer does not hide a good one", pickAppleWinBackOffer([offer({ price: 0 }), offer({ identifier: "good" })], STANDARD)?.identifier, "good");

  section("C. resolveAppleWinBack fails closed (null) on error and timeout");
  eq("resolves the pick", (await resolveAppleWinBack(async () => [offer()], STANDARD, 50))?.identifier, "winback_y1");
  eq("undefined from the SDK (old iOS / android)", await resolveAppleWinBack(async () => undefined, STANDARD, 50), null);
  eq(
    "rejected lookup",
    await resolveAppleWinBack(async () => {
      throw new Error("boom");
    }, STANDARD, 50),
    null
  );
  eq(
    "sync throw",
    await resolveAppleWinBack((() => {
      throw new Error("boom");
    }) as any, STANDARD, 50),
    null
  );
  const t0 = Date.now();
  eq("hung lookup times out", await resolveAppleWinBack(() => new Promise(() => {}), STANDARD, 40), null);
  ok("timeout returns promptly", Date.now() - t0 < 400, `${Date.now() - t0} ms`);
  eq(
    "a late answer after the timeout is ignored",
    await resolveAppleWinBack(() => new Promise((r) => setTimeout(() => r([offer()]), 120)), STANDARD, 30),
    null
  );

  section("D. decideWinbackSource: platform split");
  const apple = pickAppleWinBackOffer([offer()], STANDARD);
  const down = { hasRealDiscount: true };
  const noDown = { hasRealDiscount: false };
  eq("iOS 18+, apple offer, downsell too: apple first", decideWinbackSource({ os: "ios", osVersion: "18.2", apple, downsell: down }), "apple");
  eq("iOS 18+, apple offer, no downsell: apple", decideWinbackSource({ os: "ios", osVersion: "18.2", apple, downsell: noDown }), "apple");
  eq("iOS 18+, no apple offer, downsell: existing card", decideWinbackSource({ os: "ios", osVersion: "18.2", apple: null, downsell: down }), "downsell");
  eq("iOS 18+, no apple offer, no downsell: nothing", decideWinbackSource({ os: "ios", osVersion: "18.2", apple: null, downsell: noDown }), "none");
  eq("iOS 17 ignores an apple offer: existing card", decideWinbackSource({ os: "ios", osVersion: "17.5", apple, downsell: down }), "downsell");
  eq("iOS 17, no downsell: nothing", decideWinbackSource({ os: "ios", osVersion: "17.5", apple, downsell: noDown }), "none");
  eq("android never uses apple", decideWinbackSource({ os: "android", osVersion: 34, apple, downsell: down }), "downsell");
  eq("android, no downsell: nothing", decideWinbackSource({ os: "android", osVersion: 34, apple, downsell: noDown }), "none");
  eq("unknown version fails closed to existing", decideWinbackSource({ os: "ios", osVersion: undefined, apple, downsell: down }), "downsell");

  section("E. the trigger's offer travels to the screen as route params");
  const found = {
    hasRealDiscount: true,
    discountedPriceString: "$29.99",
    standardPriceString: "$49.99",
    savingsPercent: 40,
    source: "apple" as const,
    appleOfferId: "winback_1",
  };
  eq("no discount, no params", winbackOfferToParams({ ...found, hasRealDiscount: false }), null);
  const params = winbackOfferToParams(found);
  ok("a real offer yields params", params != null);
  eq("the screen rebuilds exactly the offer the trigger found", winbackOfferFromParams(params ?? {}), found);
  eq("an array-valued param (repeated key) is read by its first value", winbackOfferFromParams(Object.fromEntries(Object.entries(params ?? {}).map(([k, v]) => [k, [v, "x"]]))), found);
  eq("a link with no params falls back to a fetch", winbackOfferFromParams({}), null);
  eq("params that were never handed off by the trigger are ignored", winbackOfferFromParams({ ...(params ?? {}), wbPrice: "$0.01" }), null);
  const downFound = { ...found, source: "downsell" as const, appleOfferId: null };
  const dParams = winbackOfferToParams(downFound);
  eq("the downsell offer round-trips with a null Apple id", winbackOfferFromParams(dParams ?? {}), downFound);
  eq("an older handoff is replaced by the newest", winbackOfferFromParams(params ?? {}), null);

  const fs = (globalThis as any).process.getBuiltinModule("node:fs");
  const screen: string = fs.readFileSync("app/winback.tsx", "utf8");
  const layout: string = fs.readFileSync("app/_layout.tsx", "utf8");
  ok("purchase_result carries the winback source", screen.includes('source: offer.source === "apple" ? "apple_winback" : "downsell"'));
  ok("accept is locked by a ref, not only by state", screen.includes("acceptingRef.current"));
  ok("the screen starts from the trigger's offer", screen.includes("winbackOfferFromParams(routeParams)"));
  ok("the trigger pushes the offer it found", layout.includes('router.push({ pathname: "/winback", params })'));

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})();
