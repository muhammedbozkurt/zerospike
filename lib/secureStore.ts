/**
 * The device's secure store (iOS Keychain, Android Keystore-backed prefs), used
 * for secrets only: today the Nightscout address and token.
 *
 * The native module is looked up with requireOptionalNativeModule and talked to
 * directly, never through the expo-secure-store JS package: that package calls
 * requireNativeModule at import time and throws in a binary built before the
 * module was added. Without the module there is NO fallback to a weaker store:
 * the feature that needs it is hidden (secureStoreAvailable() is false).
 */
import { requireOptionalNativeModule } from "expo-modules-core";

interface ExpoSecureStoreNative {
  getValueWithKeyAsync?: (key: string, options: Record<string, unknown>) => Promise<string | null>;
  setValueWithKeyAsync?: (value: string, key: string, options: Record<string, unknown>) => Promise<void>;
  deleteValueWithKeyAsync?: (key: string, options: Record<string, unknown>) => Promise<void>;
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY?: unknown;
}

let cached: ExpoSecureStoreNative | null | undefined;

function native(): ExpoSecureStoreNative | null {
  if (cached !== undefined) return cached;
  try {
    const mod = requireOptionalNativeModule<ExpoSecureStoreNative>("ExpoSecureStore");
    cached =
      mod && mod.getValueWithKeyAsync && mod.setValueWithKeyAsync && mod.deleteValueWithKeyAsync
        ? mod
        : null;
  } catch {
    cached = null;
  }
  return cached;
}

/** For tests: forget the cached lookup. */
export function resetSecureStoreCache(): void {
  cached = undefined;
}

export function secureStoreAvailable(): boolean {
  return native() != null;
}

/** iOS: readable after the first unlock (background fetch works) and never
 *  copied to another device by a backup or iCloud Keychain. Android ignores it. */
function options(mod: ExpoSecureStoreNative): Record<string, unknown> {
  const accessible = mod.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY;
  return accessible === undefined ? {} : { keychainAccessible: accessible };
}

/** The native side rejects other characters; failing here keeps the key out of its error text. */
const KEY_RE = /^[A-Za-z0-9._-]+$/;

function need(key: string): ExpoSecureStoreNative {
  const mod = native();
  if (!mod) throw new Error("secure store unavailable");
  if (!KEY_RE.test(key)) throw new Error("invalid secure store key");
  return mod;
}

export async function secureGet(key: string): Promise<string | null> {
  const mod = need(key);
  return (await mod.getValueWithKeyAsync!(key, options(mod))) ?? null;
}

export async function secureSet(key: string, value: string): Promise<void> {
  const mod = need(key);
  await mod.setValueWithKeyAsync!(value, key, options(mod));
}

export async function secureRemove(key: string): Promise<void> {
  const mod = need(key);
  await mod.deleteValueWithKeyAsync!(key, options(mod));
}
