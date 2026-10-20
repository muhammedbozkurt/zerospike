const { withDangerousMod } = require("expo/config-plugins");
const fs = require("fs");
const path = require("path");

const BEGIN = "# @generated begin zerospike-proguard-rules (plugins/android-proguard-rules.pro)";
const END = "# @generated end zerospike-proguard-rules";

/**
 * Appends the tracked plugins/android-proguard-rules.pro to the generated
 * android/app/proguard-rules.pro. android/ is gitignored and rebuilt by
 * prebuild, so the rules live in a tracked file and are copied in; the marker
 * block makes repeated prebuilds idempotent. Release minify itself is switched
 * on through expo-build-properties in app.json.
 */
module.exports = function withAndroidProguardRules(config) {
  return withDangerousMod(config, [
    "android",
    async (c) => {
      const target = path.join(
        c.modRequest.platformProjectRoot,
        "app",
        "proguard-rules.pro"
      );
      const rules = fs
        .readFileSync(path.join(__dirname, "android-proguard-rules.pro"), "utf8")
        .trimEnd();
      const block = `${BEGIN}\n${rules}\n${END}\n`;

      const current = fs.readFileSync(target, "utf8");
      const start = current.indexOf(BEGIN);
      const stop = current.indexOf(END);
      let next;
      if (start !== -1 && stop > start) {
        next =
          current.slice(0, start) +
          block +
          current.slice(stop + END.length).replace(/^\n/, "");
      } else {
        next = current.trimEnd() + "\n\n" + block;
      }
      if (next !== current) fs.writeFileSync(target, next);
      return c;
    },
  ]);
};
