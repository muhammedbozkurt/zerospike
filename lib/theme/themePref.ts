import type { Scheme } from "./tokens";

export type ThemePref = "light" | "dark" | "system";

export const THEME_PREF_KEY = "zerospike.themePref";
export const ONBOARDED_KEY = "zerospike.onboarded";

export interface PrefStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

export function isThemePref(v: unknown): v is ThemePref {
  return v === "light" || v === "dark" || v === "system";
}

/** Stored choice wins. Without one, a user who already finished onboarding keeps
 *  the dark look they have always had and a new user gets light. The resolved
 *  default is written at once: left unwritten, a new user would flip to dark on
 *  the next launch because the onboarded flag turns true when onboarding ends. */
export async function loadThemePref(store: PrefStore): Promise<ThemePref> {
  const [stored, onboarded] = await Promise.all([
    store.getItem(THEME_PREF_KEY).catch(() => null),
    store.getItem(ONBOARDED_KEY).catch(() => null),
  ]);
  if (isThemePref(stored)) return stored;
  const fallback: ThemePref = onboarded === "true" ? "dark" : "light";
  await store.setItem(THEME_PREF_KEY, fallback).catch(() => {});
  return fallback;
}

export async function saveThemePref(store: PrefStore, pref: ThemePref): Promise<void> {
  await store.setItem(THEME_PREF_KEY, pref).catch(() => {});
}

/** `system` follows the OS; an unknown OS scheme resolves to dark, the app's
 *  historical look. */
export function resolveScheme(
  pref: ThemePref,
  system: string | null | undefined,
): Scheme {
  if (pref === "system") return system === "light" ? "light" : "dark";
  return pref;
}
