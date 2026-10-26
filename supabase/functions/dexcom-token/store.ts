// dexcom-token depolama katmani. Arayuz handler'in test edilebilmesi icin ayridir;
// PostgresStore, service role ile PostgREST'e gider (RLS acik tablo, politika yok).
// Ag/DB hatasinda atar; handler bunu 503 storage olarak karsilar.

import type { ServiceCreds } from "../_shared/http.ts";

export type Region = "us" | "ous" | "jp";

export interface LinkRow {
  link_id: string;
  device_id: string;
  link_secret_hash: string;
  region: Region;
  refresh_enc: string;
  access_enc: string | null;
  access_expires_at: string | null;
  refresh_lease_until: string | null;
}

export interface NewLink {
  device_id: string;
  link_secret_hash: string;
  region: Region;
  refresh_enc: string;
  access_enc: string;
  access_expires_at: string;
}

export interface Store {
  /** false: oran siniri asildi. */
  allowed(deviceBucket: string, ipBucket: string, maxDevice: number, maxIp: number): Promise<boolean>;
  saveState(stateHash: string, deviceId: string, region: Region, createdAtIso: string): Promise<void>;
  /** Atomik tek kullanim: ayni cihaz, kullanilmamis, notBeforeIso'dan yeni ise region doner. */
  consumeState(stateHash: string, deviceId: string, notBeforeIso: string, usedAtIso: string): Promise<Region | null>;
  getLink(deviceId: string): Promise<LinkRow | null>;
  upsertLink(link: NewLink): Promise<void>;
  deleteLink(deviceId: string): Promise<void>;
  /** Yenileme kilidi: bos ya da suresi dolmussa alir ve true doner. */
  claimRefresh(linkId: string, nowIso: string, untilIso: string): Promise<boolean>;
  saveTokens(
    linkId: string,
    t: { refresh_enc: string; access_enc: string; access_expires_at: string },
    nowIso: string,
  ): Promise<void>;
  clearAccess(linkId: string): Promise<void>;
  releaseLease(linkId: string): Promise<void>;
}

interface RestResult {
  ok: boolean;
  status: number;
  data: unknown;
}

async function rest(
  creds: ServiceCreds,
  method: string,
  path: string,
  body?: unknown,
  prefer?: string,
): Promise<RestResult> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    apikey: creds.key,
    Authorization: `Bearer ${creds.key}`,
  };
  if (prefer) headers.Prefer = prefer;
  const res = await fetch(`${creds.url}/rest/v1/${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  return { ok: res.ok, status: res.status, data };
}

function must(r: RestResult): RestResult {
  if (!r.ok) throw new Error(`storage ${r.status}`);
  return r;
}

const q = encodeURIComponent;

export class PostgresStore implements Store {
  constructor(private creds: ServiceCreds) {}

  async allowed(deviceBucket: string, ipBucket: string, maxDevice: number, maxIp: number): Promise<boolean> {
    const r = must(
      await rest(this.creds, "POST", "rpc/dexcom_request_allowed", {
        p_device_bucket: deviceBucket,
        p_ip_bucket: ipBucket,
        p_max_device: maxDevice,
        p_max_ip: maxIp,
      }),
    );
    if (typeof r.data !== "boolean") throw new Error("storage shape");
    return r.data;
  }

  async saveState(stateHash: string, deviceId: string, region: Region, createdAtIso: string): Promise<void> {
    must(
      await rest(
        this.creds,
        "POST",
        "dexcom_oauth_states",
        { state_hash: stateHash, device_id: deviceId, region, created_at: createdAtIso },
        "return=minimal",
      ),
    );
  }

  async consumeState(stateHash: string, deviceId: string, notBeforeIso: string, usedAtIso: string): Promise<Region | null> {
    const r = must(
      await rest(
        this.creds,
        "PATCH",
        `dexcom_oauth_states?state_hash=eq.${q(stateHash)}&device_id=eq.${q(deviceId)}&used_at=is.null&created_at=gte.${q(notBeforeIso)}`,
        { used_at: usedAtIso },
        "return=representation",
      ),
    );
    const row = Array.isArray(r.data) ? (r.data[0] as { region?: Region } | undefined) : undefined;
    return row?.region ?? null;
  }

  async getLink(deviceId: string): Promise<LinkRow | null> {
    const r = must(await rest(this.creds, "GET", `dexcom_links?device_id=eq.${q(deviceId)}&select=*&limit=1`));
    return Array.isArray(r.data) && r.data[0] ? (r.data[0] as LinkRow) : null;
  }

  async upsertLink(link: NewLink): Promise<void> {
    must(
      await rest(
        this.creds,
        "POST",
        "dexcom_links?on_conflict=device_id",
        { ...link, refresh_lease_until: null, updated_at: new Date().toISOString() },
        "resolution=merge-duplicates,return=minimal",
      ),
    );
  }

  async deleteLink(deviceId: string): Promise<void> {
    must(await rest(this.creds, "DELETE", `dexcom_links?device_id=eq.${q(deviceId)}`, undefined, "return=minimal"));
  }

  async claimRefresh(linkId: string, nowIso: string, untilIso: string): Promise<boolean> {
    const r = must(
      await rest(
        this.creds,
        "PATCH",
        `dexcom_links?link_id=eq.${q(linkId)}&or=(refresh_lease_until.is.null,refresh_lease_until.lt.${q(nowIso)})`,
        { refresh_lease_until: untilIso },
        "return=representation",
      ),
    );
    return Array.isArray(r.data) && r.data.length > 0;
  }

  async saveTokens(
    linkId: string,
    t: { refresh_enc: string; access_enc: string; access_expires_at: string },
    nowIso: string,
  ): Promise<void> {
    must(
      await rest(
        this.creds,
        "PATCH",
        `dexcom_links?link_id=eq.${q(linkId)}`,
        { ...t, refresh_lease_until: null, updated_at: nowIso, last_used_at: nowIso },
        "return=minimal",
      ),
    );
  }

  async clearAccess(linkId: string): Promise<void> {
    must(
      await rest(
        this.creds,
        "PATCH",
        `dexcom_links?link_id=eq.${q(linkId)}`,
        { access_enc: null, access_expires_at: null },
        "return=minimal",
      ),
    );
  }

  async releaseLease(linkId: string): Promise<void> {
    must(
      await rest(this.creds, "PATCH", `dexcom_links?link_id=eq.${q(linkId)}`, { refresh_lease_until: null }, "return=minimal"),
    );
  }
}
