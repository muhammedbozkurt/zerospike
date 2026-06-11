import * as Crypto from "expo-crypto";

/**
 * RFC4122 v4 UUID using a cryptographically secure RNG (expo-crypto).
 * Works fully offline, no native module beyond expo-crypto.
 */
export function uuid(): string {
  const bytes = Crypto.getRandomBytes(16);
  // Per RFC4122 section 4.4
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10

  const hex: string[] = [];
  for (let i = 0; i < 256; i++) {
    hex.push((i + 0x100).toString(16).substring(1));
  }

  const b = bytes;
  return (
    hex[b[0]] +
    hex[b[1]] +
    hex[b[2]] +
    hex[b[3]] +
    "-" +
    hex[b[4]] +
    hex[b[5]] +
    "-" +
    hex[b[6]] +
    hex[b[7]] +
    "-" +
    hex[b[8]] +
    hex[b[9]] +
    "-" +
    hex[b[10]] +
    hex[b[11]] +
    hex[b[12]] +
    hex[b[13]] +
    hex[b[14]] +
    hex[b[15]]
  );
}
