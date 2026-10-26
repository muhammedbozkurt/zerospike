import Constants from "expo-constants";

export type DexcomRegion = "us" | "ous" | "jp";

/** Resmi bolge hostlari (Dexcom Developer API, endpoint-overview). */
export const DEXCOM_HOSTS: Record<DexcomRegion, string> = {
  us: "https://api.dexcom.com",
  ous: "https://api.dexcom.eu",
  jp: "https://api.dexcom.jp",
};
export const DEXCOM_SANDBOX_HOST = "https://sandbox-api.dexcom.com";

/** Dexcom uygulama kaydindaki redirect_uri ile birebir; site sayfasi code ve state'i zerospike://oauth/dexcom adresine iletir. */
export const DEXCOM_REDIRECT_URI = "https://greeneyeapp.com/zerospike/oauth/dexcom";

export interface DexcomConfig {
  /** dexcom-token edge function adresi (https). */
  tokenFnUrl: string;
  /** Sandbox hostu; sunucu da kendi DEXCOM_SANDBOX anahtariyla ayni secimi yapar. */
  sandbox: boolean;
  defaultRegion: DexcomRegion;
}

export function isDexcomRegion(value: unknown): value is DexcomRegion {
  return value === "us" || value === "ous" || value === "jp";
}

/** ABD ve Japonya disindaki her ulke Dexcom'un AB/ABD disi hostuna gider. */
export function regionForCountry(country: string | null | undefined): DexcomRegion {
  const c = (country ?? "").trim().toUpperCase();
  if (c === "US") return "us";
  if (c === "JP") return "jp";
  return "ous";
}

export function dexcomHost(region: DexcomRegion, sandbox: boolean): string {
  return sandbox ? DEXCOM_SANDBOX_HOST : DEXCOM_HOSTS[region];
}

/**
 * app.json extra.dexcom -> yapilandirma. Alan yoksa, `enabled` tam olarak true
 * degilse ya da function adresi https degilse null: ozellik kapali. Dexcom kimlikleri
 * (istemci kimligi ve sirri) pakette yoktur; ikisi de yalniz sunucuda.
 */
export function resolveDexcomConfig(extra: unknown): DexcomConfig | null {
  if (typeof extra !== "object" || extra === null) return null;
  const raw = (extra as Record<string, unknown>).dexcom;
  if (typeof raw !== "object" || raw === null) return null;
  const d = raw as Record<string, unknown>;
  if (d.enabled !== true) return null;
  const url = typeof d.tokenFnUrl === "string" ? d.tokenFnUrl.trim() : "";
  if (!/^https:\/\/[^\s/]+/.test(url)) return null;
  return {
    tokenFnUrl: url,
    sandbox: d.sandbox === true,
    defaultRegion: isDexcomRegion(d.region) ? d.region : "ous",
  };
}

export function getDexcomConfig(): DexcomConfig | null {
  return resolveDexcomConfig(Constants.expoConfig?.extra);
}

/** Veri kaynaklari ekrani satiri yalniz bu true iken cizilir. */
export function dexcomRowVisible(): boolean {
  return getDexcomConfig() !== null;
}
