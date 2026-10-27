/**
 * Nightscout address and token rules. Pure: no React Native, no network.
 *
 * Only https is accepted, local network included: ATS and Android cleartext
 * rules would need native changes, and every hosted Nightscout is https.
 * The address is parsed by hand because React Native's URL polyfill does not
 * implement hostname or searchParams reliably.
 */

export const NS_URL_MAX_LENGTH = 2048;

export type NsUrlError = "empty" | "invalid" | "insecure" | "credentials" | "too_long";

export type NsUrlResult =
  | { ok: true; base: string; token: string | null }
  | { ok: false; error: NsUrlError };

export type NsTokenError = "api_secret" | "invalid";

export type NsTokenResult =
  | { ok: true; token: string | null }
  | { ok: false; error: NsTokenError };

const HOST_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/;
const PATH_RE = /^[A-Za-z0-9._~\-/]*$/;
// A Nightscout access token is "<subject name>-<16 hex of the subject's hash>".
const TOKEN_RE = /^[A-Za-z0-9_.]{1,64}(?:-[A-Za-z0-9_.]{1,64})*-[0-9a-f]{16}$/;
// API_SECRET is stored as a 40 hex SHA-1; pasting it would hand the app an admin key.
const API_SECRET_HASH_RE = /^[0-9a-fA-F]{40}$/;
const TOKEN_MAX_LENGTH = 200;

function fail(error: NsUrlError): NsUrlResult {
  return { ok: false, error };
}

function tokenFromQuery(query: string): string | null {
  for (const pair of query.split("&")) {
    const eq = pair.indexOf("=");
    const key = eq < 0 ? pair : pair.slice(0, eq);
    if (key.toLowerCase() !== "token") continue;
    const raw = eq < 0 ? "" : pair.slice(eq + 1);
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  }
  return null;
}

/** Turns what the user typed or pasted into the base address of the site, plus
 *  a token that rode along in `?token=`. Never returns the input in an error. */
export function parseNightscoutUrl(input: string): NsUrlResult {
  const text = (input ?? "").trim();
  if (text.length === 0) return fail("empty");
  if (text.length > NS_URL_MAX_LENGTH) return fail("too_long");
  // eslint-disable-next-line no-control-regex
  if (/[\s\u0000-\u001f\u007f]/.test(text)) return fail("invalid");

  let rest = text;
  const hash = rest.indexOf("#");
  if (hash >= 0) rest = rest.slice(0, hash);

  let query = "";
  const q = rest.indexOf("?");
  if (q >= 0) {
    query = rest.slice(q + 1);
    rest = rest.slice(0, q);
  }

  const scheme = /^([a-zA-Z][a-zA-Z0-9+.-]*):\/\//.exec(rest);
  if (scheme) {
    const name = scheme[1].toLowerCase();
    if (name === "http") return fail("insecure");
    if (name !== "https") return fail("invalid");
    rest = rest.slice(scheme[0].length);
  } else if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(rest) && !/^[^/:]+:\d+(\/|$)/.test(rest)) {
    // javascript:, mailto: and friends
    return fail("invalid");
  }

  const slash = rest.indexOf("/");
  const authority = slash < 0 ? rest : rest.slice(0, slash);
  let path = slash < 0 ? "" : rest.slice(slash);

  if (authority.includes("@")) return fail("credentials");
  if (authority.length === 0) return fail("invalid");

  const colon = authority.lastIndexOf(":");
  const host = (colon >= 0 ? authority.slice(0, colon) : authority).toLowerCase();
  const port = colon >= 0 ? authority.slice(colon + 1) : "";
  if (!HOST_RE.test(host)) return fail("invalid");
  if (colon >= 0) {
    if (!/^\d{1,5}$/.test(port)) return fail("invalid");
    const n = Number(port);
    if (n < 1 || n > 65535) return fail("invalid");
  }

  const apiAt = path.search(/\/api(\/|$)/i);
  if (apiAt >= 0) path = path.slice(0, apiAt);
  path = path.replace(/\/+$/, "");
  if (!PATH_RE.test(path) || path.split("/").some((s) => s === ".." || s === ".")) {
    return fail("invalid");
  }

  const token = tokenFromQuery(query);
  return {
    ok: true,
    base: `https://${host}${colon >= 0 ? `:${port}` : ""}${path}`,
    token: token && token.trim().length > 0 ? token.trim() : null,
  };
}

/** The token is optional (a readable-by-default server needs none), but when
 *  given it must look like a subject access token, never the API_SECRET. */
export function validateNightscoutToken(input: string): NsTokenResult {
  const text = (input ?? "").trim();
  if (text.length === 0) return { ok: true, token: null };
  if (API_SECRET_HASH_RE.test(text)) return { ok: false, error: "api_secret" };
  if (text.length > TOKEN_MAX_LENGTH || !TOKEN_RE.test(text)) {
    return { ok: false, error: "invalid" };
  }
  return { ok: true, token: text };
}
