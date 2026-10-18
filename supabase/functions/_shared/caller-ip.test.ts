import { resolveCallerIp } from "./http.ts";

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

Deno.test("wrong secret: forwarded ip ignored", () =>
  withSecret("good", async () => {
    assertEq(await resolveCallerIp(req({ "x-zs-forwarder": "bad", "x-forwarded-for": "7.7.7.7, 2.2.2.2" })), "2.2.2.2");
  }));

Deno.test("right secret: first forwarded ip used", () =>
  withSecret("good", async () => {
    assertEq(await resolveCallerIp(req({ "x-zs-forwarder": "good", "x-forwarded-for": "7.7.7.7, 2.2.2.2" })), "7.7.7.7");
  }));

Deno.test("secret undefined: header ignored", () =>
  withSecret(undefined, async () => {
    assertEq(await resolveCallerIp(req({ "x-zs-forwarder": "good", "x-forwarded-for": "7.7.7.7, 2.2.2.2" })), "2.2.2.2");
  }));

Deno.test("right secret but invalid ip: falls back", () =>
  withSecret("good", async () => {
    assertEq(await resolveCallerIp(req({ "x-zs-forwarder": "good", "x-forwarded-for": "not-an-ip, 2.2.2.2" })), "2.2.2.2");
  }));

Deno.test("right secret but malformed ip: falls back", () =>
  withSecret("good", async () => {
    for (const bad of [":::::", "007.007.007.007"]) {
      assertEq(await resolveCallerIp(req({ "x-zs-forwarder": "good", "x-forwarded-for": `${bad}, 2.2.2.2` })), "2.2.2.2");
    }
  }));
