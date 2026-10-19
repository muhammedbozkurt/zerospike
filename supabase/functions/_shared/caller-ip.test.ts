import { rateLimitKey, resolveCallerIp } from "./http.ts";

function assertEq(a: unknown, b: unknown) {
  if (a !== b) throw new Error(`expected ${String(b)} got ${String(a)}`);
}

function req(headers: Record<string, string>) {
  return new Request("http://x/", { method: "POST", headers });
}

async function withSecret(value: string | undefined, run: () => Promise<void>) {
  if (value === undefined) Deno.env.delete("FORWARDER_SECRET");
  else Deno.env.set("FORWARDER_SECRET", value);
  try {
    await run();
  } finally {
    Deno.env.delete("FORWARDER_SECRET");
  }
}

Deno.test("wrong secret: client ip header ignored", () =>
  withSecret("good", async () => {
    assertEq(await resolveCallerIp(req({ "x-zs-forwarder": "bad", "x-zs-client-ip": "7.7.7.7", "x-forwarded-for": "2.2.2.2" })), "2.2.2.2");
  }));

Deno.test("right secret: client ip header used, xff ignored", () =>
  withSecret("good", async () => {
    assertEq(await resolveCallerIp(req({ "x-zs-forwarder": "good", "x-zs-client-ip": "7.7.7.7", "x-forwarded-for": "6.6.6.6, 2.2.2.2" })), "7.7.7.7");
  }));

Deno.test("secret undefined: header ignored", () =>
  withSecret(undefined, async () => {
    assertEq(await resolveCallerIp(req({ "x-zs-forwarder": "good", "x-zs-client-ip": "7.7.7.7", "x-forwarded-for": "2.2.2.2" })), "2.2.2.2");
  }));

Deno.test("right secret but invalid ip: falls back", () =>
  withSecret("good", async () => {
    assertEq(await resolveCallerIp(req({ "x-zs-forwarder": "good", "x-zs-client-ip": "not-an-ip", "x-forwarded-for": "2.2.2.2" })), "2.2.2.2");
  }));

Deno.test("right secret but malformed ip: falls back", () =>
  withSecret("good", async () => {
    for (const bad of [":::::", "007.007.007.007"]) {
      assertEq(await resolveCallerIp(req({ "x-zs-forwarder": "good", "x-zs-client-ip": bad, "x-forwarded-for": "2.2.2.2" })), "2.2.2.2");
    }
  }));

Deno.test("ipv6 reduces to its /64, ipv4 and others untouched", async () => {
  assertEq(rateLimitKey("2001:db8:1:2:aaaa:bbbb:cccc:dddd"), "2001:db8:1:2::/64");
  assertEq(rateLimitKey("2001:DB8:1:2:1::1"), "2001:db8:1:2::/64");
  assertEq(rateLimitKey("2001:0db8:0:0::1"), "2001:db8:0:0::/64");
  assertEq(rateLimitKey("2001:db8::1"), "2001:db8:0:0::/64");
  assertEq(rateLimitKey("::1"), "0:0:0:0::/64");
  assertEq(rateLimitKey("1.2.3.4"), "1.2.3.4");
  assertEq(rateLimitKey("unknown"), "unknown");
  assertEq(rateLimitKey("::ffff:1.2.3.4"), "::ffff:1.2.3.4");
  assertEq(
    await resolveCallerIp(req({ "x-forwarded-for": "1.1.1.1, 2001:db8:5:6:1:2:3:4" })),
    await resolveCallerIp(req({ "x-forwarded-for": "1.1.1.1, 2001:db8:5:6:ffff:eeee:dddd:cccc" })),
  );
  assertEq(await resolveCallerIp(req({ "x-forwarded-for": "9.9.9.9" })), "9.9.9.9");
});

Deno.test("forwarded ipv6 is reduced too", () =>
  withSecret("good", async () => {
    assertEq(await resolveCallerIp(req({ "x-zs-forwarder": "good", "x-zs-client-ip": "2001:db8:5:6:1:2:3:4" })), "2001:db8:5:6::/64");
  }));
