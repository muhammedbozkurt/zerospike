/**
 * CGM-E: Nightscout address and token validation (pure).
 * Run: npx tsx scripts/nightscoutUrl.test.ts
 */
declare const console: { log: (...a: unknown[]) => void };
declare const process: { exit: (code: number) => void };

import { parseNightscoutUrl, validateNightscoutToken } from "../lib/nightscout/url";

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean, detail = ""): void {
  if (cond) passed++;
  else {
    failed++;
    console.log(`  x ${name}${detail ? ": " + detail : ""}`);
  }
}
function eq<T>(name: string, actual: T, expected: T): void {
  ok(name, actual === expected, `got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
}

function base(input: string): string | null {
  const r = parseNightscoutUrl(input);
  return r.ok ? r.base : null;
}
function err(input: string): string | null {
  const r = parseNightscoutUrl(input);
  return r.ok ? null : r.error;
}

console.log("zerospike nightscout url test");

// normalization
eq("plain https", base("https://my.herokuapp.com"), "https://my.herokuapp.com");
eq("trailing slash", base("https://my.herokuapp.com/"), "https://my.herokuapp.com");
eq("spaces around", base("  https://my.herokuapp.com/  "), "https://my.herokuapp.com");
eq("host lowercased", base("https://My.HerokuApp.com"), "https://my.herokuapp.com");
eq("scheme case", base("HTTPS://my.herokuapp.com"), "https://my.herokuapp.com");
eq("no scheme gets https", base("my.herokuapp.com"), "https://my.herokuapp.com");
eq("port kept", base("https://ns.example.org:8443/"), "https://ns.example.org:8443");
eq("api path cut", base("https://my.herokuapp.com/api/v1/entries.json"), "https://my.herokuapp.com");
eq("api only cut", base("https://my.herokuapp.com/api"), "https://my.herokuapp.com");
eq("fragment cut", base("https://my.herokuapp.com/#/report"), "https://my.herokuapp.com");
eq("subpath kept", base("https://example.org/ns/"), "https://example.org/ns");
eq("query dropped", base("https://my.herokuapp.com/?a=1&b=2"), "https://my.herokuapp.com");

// token in the pasted address moves out
{
  const r = parseNightscoutUrl("https://my.herokuapp.com/?token=alice-0123456789abcdef&x=1");
  ok("token extracted", r.ok && r.token === "alice-0123456789abcdef");
  ok("token gone from base", r.ok && !r.base.includes("token") && !r.base.includes("?"));
}
{
  const r = parseNightscoutUrl("https://my.herokuapp.com/api/v1/entries.json?count=3&token=alice-0123456789abcdef");
  ok("token from api url", r.ok && r.token === "alice-0123456789abcdef" && r.base === "https://my.herokuapp.com");
}
{
  const r = parseNightscoutUrl("https://my.herokuapp.com");
  ok("no token -> null", r.ok && r.token === null);
}

// rejections
eq("http rejected", err("http://my.herokuapp.com"), "insecure");
eq("http local rejected", err("http://192.168.1.20:1337"), "insecure");
eq("ftp rejected", err("ftp://my.herokuapp.com"), "invalid");
eq("javascript rejected", err("javascript:alert(1)"), "invalid");
eq("userinfo rejected", err("https://user:pass@my.herokuapp.com"), "credentials");
eq("user only rejected", err("https://user@my.herokuapp.com"), "credentials");
eq("empty", err("   "), "empty");
eq("empty string", err(""), "empty");
eq("inner space", err("https://my herokuapp.com"), "invalid");
eq("no dot host", err("https://localhost"), "invalid");
eq("empty host", err("https:///path"), "invalid");
eq("bad port", err("https://ns.example.org:99999"), "invalid");
eq("ipv6 literal", err("https://[::1]/"), "invalid");
eq("underscore host", err("https://my_host.example.org"), "invalid");
eq("too long", err("https://" + "a".repeat(2050) + ".com"), "too_long");
eq("path traversal", err("https://example.org/../x"), "invalid");
eq("control char", err("https://my.herokuapp.com/\u0007"), "invalid");

// token rules
{
  const good = validateNightscoutToken("alice-0123456789abcdef");
  ok("subject token ok", good.ok && good.token === "alice-0123456789abcdef");
  const trimmed = validateNightscoutToken("  readable-0123456789abcdef \n");
  ok("token trimmed", trimmed.ok && trimmed.token === "readable-0123456789abcdef");
  const empty = validateNightscoutToken("   ");
  ok("empty token is allowed (readable servers)", empty.ok && empty.token === null);

  const sha1 = validateNightscoutToken("a94a8fe5ccb19ba61c4c0873d391e987982fbbd3");
  ok("40 hex API_SECRET hash rejected", !sha1.ok && sha1.error === "api_secret");
  const sha1Upper = validateNightscoutToken("A94A8FE5CCB19BA61C4C0873D391E987982FBBD3");
  ok("40 hex uppercase rejected", !sha1Upper.ok && sha1Upper.error === "api_secret");
  const plain = validateNightscoutToken("my-super-secret-passphrase");
  ok("plain API_SECRET passphrase rejected", !plain.ok);
  const spaced = validateNightscoutToken("alice 0123456789abcdef");
  ok("space inside rejected", !spaced.ok);
  const short = validateNightscoutToken("alice-0123");
  ok("short hash rejected", !short.ok);
  const long = validateNightscoutToken("a".repeat(300) + "-0123456789abcdef");
  ok("overlong rejected", !long.ok);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
