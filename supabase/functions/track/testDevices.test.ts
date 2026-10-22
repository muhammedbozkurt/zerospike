import { createTestDeviceChecker, LOOKUP_FAILURE_TTL_MS, restLookup, TEST_DEVICE_TTL_MS } from "./testDevices.ts";

function assertEq(a: unknown, b: unknown) {
  if (a !== b) throw new Error(`expected ${String(b)} got ${String(a)}`);
}

const ID = "0f8fad5b-d9cb-469f-a165-70867728950e";
const quiet = () => {};

Deno.test("a listed device is a test device, an unlisted one is not", async () => {
  const c = createTestDeviceChecker((id) => Promise.resolve(id === ID), Date.now, quiet);
  assertEq(await c.isTestDevice(ID), true);
  assertEq(await c.isTestDevice("other"), false);
});

Deno.test("the answer is cached for the TTL, then asked again", async () => {
  let t = 1_000;
  let calls = 0;
  const c = createTestDeviceChecker(() => (calls++, Promise.resolve(true)), () => t, quiet);
  await c.isTestDevice(ID);
  await c.isTestDevice(ID);
  assertEq(calls, 1);
  t += TEST_DEVICE_TTL_MS - 1;
  await c.isTestDevice(ID);
  assertEq(calls, 1);
  t += 2;
  await c.isTestDevice(ID);
  assertEq(calls, 2);
});

Deno.test("a failing lookup fails open, is logged, and is retried after a short wait", async () => {
  let t = 0;
  let calls = 0;
  const logs: string[] = [];
  const c = createTestDeviceChecker(
    () => (calls++, Promise.reject(new Error("relation does not exist"))),
    () => t,
    (m) => logs.push(m),
  );
  assertEq(await c.isTestDevice(ID), false);
  assertEq(await c.isTestDevice(ID), false);
  assertEq(calls, 1);
  assertEq(logs.length, 1);
  t += LOOKUP_FAILURE_TTL_MS + 1;
  await c.isTestDevice(ID);
  assertEq(calls, 2);
});

const creds = { url: "https://x.supabase.co", key: "service-key" };

Deno.test("restLookup queries test_devices by device id with the service key", async () => {
  let seen = "";
  let auth = "";
  const f = ((url: string, init: RequestInit) => {
    seen = url;
    auth = (init.headers as Record<string, string>).Authorization;
    return Promise.resolve(new Response(JSON.stringify([{ device_id: ID }]), { status: 200 }));
  }) as unknown as typeof fetch;
  assertEq(await restLookup(creds, f)(ID), true);
  assertEq(seen, `https://x.supabase.co/rest/v1/test_devices?select=device_id&device_id=eq.${ID}&limit=1`);
  assertEq(auth, "Bearer service-key");
});

Deno.test("restLookup: empty list is false, a non-ok answer throws", async () => {
  const empty = (() => Promise.resolve(new Response("[]", { status: 200 }))) as unknown as typeof fetch;
  assertEq(await restLookup(creds, empty)(ID), false);
  const bad = (() => Promise.resolve(new Response('{"message":"x"}', { status: 404 }))) as unknown as typeof fetch;
  let threw = false;
  try {
    await restLookup(creds, bad)(ID);
  } catch {
    threw = true;
  }
  assertEq(threw, true);
});

Deno.test("index.ts checks the test device after parsing and before the ingest RPC", async () => {
  const src = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
  const check = src.indexOf("isTestDevice(deviceId)");
  assertEq(check > 0, true);
  assertEq(check < src.indexOf("await ingest(creds"), true);
  assertEq(check > src.indexOf("parseTrackBody(EVENT_SCHEMA"), true);
});
