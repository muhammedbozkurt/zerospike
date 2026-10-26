// Token sifreleme ve baglanti sirri ozeti. AES-256-GCM; anahtar yalniz DEXCOM_TOKEN_KEY
// (64 hex karakter) secret'inda. Her kayit device_id'ye baglanir (AAD): bir satirin sifreli
// degeri baska bir satira kopyalansa cozulmez.

const encoder = new TextEncoder();

export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function randomHex(byteLength: number): string {
  return toHex(crypto.getRandomValues(new Uint8Array(byteLength)));
}

export async function sha256Hex(text: string): Promise<string> {
  return toHex(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(text))));
}

function fromHex(hex: string): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(new ArrayBuffer(hex.length / 2));
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function fromBase64(text: string): Uint8Array {
  const s = atob(text);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export function validTokenKey(hex: string | undefined): hex is string {
  return typeof hex === "string" && /^[0-9a-fA-F]{64}$/.test(hex);
}

async function importKey(hex: string): Promise<CryptoKey> {
  return await crypto.subtle.importKey("raw", fromHex(hex), "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function encryptToken(keyHex: string, deviceId: string, plain: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv, additionalData: encoder.encode(deviceId) },
      await importKey(keyHex),
      encoder.encode(plain),
    ),
  );
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv, 0);
  out.set(ct, iv.length);
  return toBase64(out);
}

/** Cozulemeyen (yanlis anahtar, bozuk veri, baska satir) kayit null doner. */
export async function decryptToken(keyHex: string, deviceId: string, packed: string): Promise<string | null> {
  try {
    const raw = fromBase64(packed);
    if (raw.length < 13) return null;
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: raw.slice(0, 12), additionalData: encoder.encode(deviceId) },
      await importKey(keyHex),
      raw.slice(12),
    );
    return new TextDecoder().decode(plain);
  } catch {
    return null;
  }
}

/** Sabit sureli karsilastirma (hex ozetler). */
export function sameHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
