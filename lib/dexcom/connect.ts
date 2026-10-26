import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Crypto from "expo-crypto";
import { Linking } from "react-native";

import { getDeviceId } from "../identity/deviceId";
import { exchangeCode, startAuthorization, type ClientDeps, type DexcomFailure } from "./client";
import { getDexcomConfig, type DexcomConfig, type DexcomRegion } from "./config";
import {
  consumePendingState,
  createPendingState,
  parseCallbackParams,
  type KeyValueStore,
} from "./oauth";

/**
 * Baglanti sirri (256 bit) cihazda yalniz guvenli depoda durur. Guvenli depo
 * modulu (CGM-E, lib/secureStore.ts) bu kartta yok; baglandiginda
 * setDexcomLinkSecretStore() ile verilir. O zamana kadar baglanti kurulmaz,
 * yarim kalan bir takas olmasin diye Dexcom girisi de acilmaz.
 */
export interface LinkSecretStore {
  get(): Promise<string | null>;
  set(secret: string): Promise<void>;
  remove(): Promise<void>;
}

let secretStore: LinkSecretStore | null = null;

export function setDexcomLinkSecretStore(store: LinkSecretStore | null): void {
  secretStore = store;
}

export function getDexcomLinkSecretStore(): LinkSecretStore | null {
  return secretStore;
}

const kv: KeyValueStore = {
  get: (k) => AsyncStorage.getItem(k),
  set: (k, v) => AsyncStorage.setItem(k, v),
  remove: (k) => AsyncStorage.removeItem(k),
};

function randomHex(): string {
  return Array.from(Crypto.getRandomBytes(32), (b) => b.toString(16).padStart(2, "0")).join("");
}

async function deps(config: DexcomConfig): Promise<ClientDeps> {
  return { config, deviceId: await getDeviceId(), fetch };
}

export type ConnectFailure = DexcomFailure | "no_secure_store" | "state_invalid" | "denied" | "open_failed";

/** Dexcom giris adresini tarayicida acar. Bayrak kapaliysa hicbir sey yapmaz. */
export async function startDexcomConnect(region?: DexcomRegion): Promise<{ ok: true } | { ok: false; reason: ConnectFailure }> {
  const config = getDexcomConfig();
  if (!config) return { ok: false, reason: "disabled" };
  if (!secretStore) return { ok: false, reason: "no_secure_store" };
  const d = await deps(config);
  const pending = await createPendingState(kv, region ?? config.defaultRegion, Date.now(), randomHex);
  const started = await startAuthorization(d, { state: pending.state, region: pending.region });
  if (!started.ok) return started;
  try {
    await Linking.openURL(started.authorizeUrl);
  } catch {
    return { ok: false, reason: "open_failed" };
  }
  return { ok: true };
}

/** zerospike://oauth/dexcom donusunu isler: state dogrular, kodu sunucuya takas ettirir, sirri saklar. */
export async function finishDexcomConnect(
  params: Record<string, string | string[] | undefined>
): Promise<{ ok: true } | { ok: false; reason: ConnectFailure }> {
  const config = getDexcomConfig();
  if (!config) return { ok: false, reason: "disabled" };
  if (!secretStore) return { ok: false, reason: "no_secure_store" };
  const cb = parseCallbackParams(params);
  if (cb.kind === "denied") return { ok: false, reason: "denied" };
  if (cb.kind === "invalid") return { ok: false, reason: "state_invalid" };
  const check = await consumePendingState(kv, cb.state, Date.now());
  if (!check.ok) return { ok: false, reason: "state_invalid" };
  const d = await deps(config);
  const done = await exchangeCode(d, { code: cb.code, state: cb.state });
  if (!done.ok) return done;
  await secretStore.set(done.linkSecret);
  return { ok: true };
}
