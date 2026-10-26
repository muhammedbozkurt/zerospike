/** K5: the EU dose-calculator flag is off by default; on, it hides the
 *  calculator only for an EU/EEA device region.
 *  Run: npx -y tsx scripts/regionFlags.test.ts */
import { readFileSync } from "node:fs";

declare const require: (id: string) => any;
const nodeModule = require("module");

let extra: Record<string, unknown> | undefined = {};
let region: string | null | undefined = "US";
let localeThrows = false;
const stubs: Record<string, unknown> = {
  "expo-constants": {
    __esModule: true,
    default: {
      get expoConfig() {
        return { extra };
      },
    },
  },
  "expo-localization": {
    getLocales: () => {
      if (localeThrows) throw new Error("not ready");
      return [{ regionCode: region }];
    },
  },
};
const realLoad = nodeModule._load;
nodeModule._load = function (request: string, ...rest: unknown[]) {
  if (Object.prototype.hasOwnProperty.call(stubs, request)) return stubs[request];
  return realLoad.call(this, request, ...rest);
};

let failed = 0;
function eq(name: string, got: unknown, want: unknown): void {
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    failed++;
    console.log(`  x ${name}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
  }
}
function ok(name: string, cond: boolean): void {
  eq(name, cond, true);
}
const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

const flags = require("../lib/regionFlags") as typeof import("../lib/regionFlags");

extra = {};
region = "DE";
eq("no flag field: visible even in DE", flags.calculatorHiddenForRegion(), false);
extra = undefined;
eq("no extra at all: visible", flags.calculatorHiddenForRegion(), false);
extra = { euHideCalculator: false };
eq("flag false + DE: visible", flags.calculatorHiddenForRegion(), false);
extra = { euHideCalculator: true };
region = "DE";
eq("flag on + DE: hidden", flags.calculatorHiddenForRegion(), true);
region = "NO";
eq("flag on + NO (EEA): hidden", flags.calculatorHiddenForRegion(), true);
region = "US";
eq("flag on + US: visible", flags.calculatorHiddenForRegion(), false);
region = "GB";
eq("flag on + GB (not EU/EEA): visible", flags.calculatorHiddenForRegion(), false);
region = null;
eq("flag on + unknown region: visible", flags.calculatorHiddenForRegion(), false);
region = "de";
eq("lower case region is read", flags.calculatorHiddenForRegion(), true);
extra = { euHideCalculator: "true" };
eq("only a real boolean counts", flags.calculatorHiddenForRegion(), false);
extra = { euHideCalculator: true };
localeThrows = true;
eq("locale not ready: visible", flags.calculatorHiddenForRegion(), false);
localeThrows = false;
eq("EU list has 27 members + 3 EEA", flags.EU_EEA_REGIONS.length, 30);

ok("app.json is untouched by the flag", !read("app.json").includes("euHideCalculator"));
const calc = read("app/calculator.tsx");
ok("calculator route falls back to the info screen", calc.includes("calculatorHiddenForRegion()") && calc.includes("CalculatorRegionInfo"));
ok("food tab hides the dose route", /showsDose = insulinModeShowsBolus\(insulinModeOf\(activeProfile\)\) && !calculatorHiddenForRegion\(\)/.test(read("app/(tabs)/food.tsx")));
ok("template screen hides the dose route", /showsDose = insulinModeShowsBolus\(insulinModeOf\(activeProfile\)\) && !calculatorHiddenForRegion\(\)/.test(read("app/meal-template.tsx")));

const en = read("lib/i18n/locales/en.ts");
ok("info copy has no regulated wording", !/(warn|diagnos|treatment|recommended dose|alarm)/i.test(en.slice(en.indexOf("regionInfoTitle:"), en.indexOf("regionInfoTitle:") + 400)));

if (failed) {
  console.log(`FAIL ${failed}`);
  process.exit(1);
}
console.log("regionFlags ok");
