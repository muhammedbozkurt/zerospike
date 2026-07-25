/**
 * Lightweight current-language holder.
 *
 * The pure formatting helpers (lib/format, lib/glucose) need the active language
 * to localize numbers/dates, but they MUST NOT import the full i18n module: that
 * pulls in expo-localization + AsyncStorage (and thus react-native), which the
 * node-run test gates (calc.test, migration.test) cannot transform. This tiny
 * module holds just the language string; lib/i18n keeps it in sync via
 * i18next's languageChanged event, and it defaults to "en" in a bare node run.
 */
let current = "en";

export function setActiveLang(lang: string): void {
  current = lang || "en";
}

export function getActiveLang(): string {
  return current;
}
