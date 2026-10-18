import { forward, MAX_BODY_BYTES } from "./forward.ts";

function assertEq(a: unknown, b: unknown, msg = "") {
  if (a !== b) throw new Error(`${msg} expected ${String(b)} got ${String(a)}`);
}

interface Seen {
  method: string;
  headers: Headers;
  body: Uint8Array;
  path: string;
  search: string;
}

async function withUpstream(
  respond: (req: Request) => Response,
  run: (base: string, seen: Seen[]) => Promise<void>,
) {
  const seen: Seen[] = [];
  const server = Deno.serve({ port: 0, onListen() {} }, async (req) => {
    seen.push({
      method: req.method,
      headers: req.headers,
      body: new Uint8Array(await req.arrayBuffer()),
      path: new URL(req.url).pathname,
      search: new URL(req.url).search,
    });
    return respond(req);
  });
  try {
    await run(`http://127.0.0.1:${server.addr.port}/functions/v1`, seen);
  } finally {
    await server.shutdown();
  }
}

Deno.test("body, status and safe headers pass through byte-identical", async () => {
  const payload = new Uint8Array([0, 1, 2, 255, 254, 10]);
  await withUpstream(
    () =>
      new Response("resp-ç", {
        status: 202,
        headers: { "content-type": "text/plain", "retry-after": "7", "set-cookie": "a=b", "x-secret": "1" },
      }),
    async (base, seen) => {
      const res = await forward("track", 5000, base)(
        new Request("http://legacy/track?q=1", { method: "POST", body: payload, headers: { "content-type": "application/octet-stream" } }),
      );
      assertEq(res.status, 202);
      assertEq(await res.text(), "resp-ç");
      assertEq(res.headers.get("retry-after"), "7");
      assertEq(res.headers.get("set-cookie"), null);
      assertEq(res.headers.get("x-secret"), null);
      assertEq(seen[0].path, "/functions/v1/track");
      assertEq(seen[0].search, "");
      assertEq(seen[0].body.join(","), payload.join(","));
    },
  );
});

Deno.test("header allowlist (x-forwarded-for is written)", async () => {
  await withUpstream(
    () => new Response("ok"),
    async (base, seen) => {
      await forward("rc-webhook", 5000, base)(
        new Request("http://legacy/x", {
          method: "POST",
          body: "{}",
          headers: {
            authorization: "Bearer test",
            "x-device-id": "d1",
            "x-consent-context": "c",
            "x-rc-app-user-id": "u",
            cookie: "s=1",
            "x-evil": "1",
            "x-forwarded-for": "9.9.9.9, 1.2.3.4",
          },
        }),
      );
      const h = seen[0].headers;
      assertEq(h.get("authorization"), "Bearer test");
      assertEq(h.get("x-device-id"), "d1");
      assertEq(h.get("x-consent-context"), "c");
      assertEq(h.get("x-rc-app-user-id"), "u");
      assertEq(h.get("cookie"), null);
      assertEq(h.get("x-evil"), null);
      assertEq(h.get("x-forwarded-for"), "1.2.3.4");
    },
  );
});

Deno.test("cf-connecting-ip wins; no ip means no header", async () => {
  await withUpstream(
    () => new Response("ok"),
    async (base, seen) => {
      const f = forward("track", 5000, base);
      await f(new Request("http://legacy/x", { method: "POST", body: "{}", headers: { "cf-connecting-ip": "5.5.5.5", "x-forwarded-for": "1.1.1.1" } }));
      await f(new Request("http://legacy/x", { method: "POST", body: "{}" }));
      assertEq(seen[0].headers.get("x-forwarded-for"), "5.5.5.5");
      assertEq(seen[1].headers.get("x-forwarded-for"), null);
    },
  );
});

Deno.test("OPTIONS answers 204 locally", async () => {
  const res = await forward("track", 5000, "http://127.0.0.1:1")(new Request("http://legacy/x", { method: "OPTIONS" }));
  assertEq(res.status, 204);
});

Deno.test("unreachable upstream gives 502", async () => {
  const res = await forward("track", 2000, "http://127.0.0.1:1")(new Request("http://legacy/x", { method: "POST", body: "{}" }));
  assertEq(res.status, 502);
  assertEq(await res.text(), '{"error":"upstream_unavailable"}');
});

Deno.test("timeout gives 502", async () => {
  await withUpstream(
    () => new Response("ok"),
    async () => {
      const server = Deno.serve({ port: 0, onListen() {} }, async () => {
        await new Promise((r) => setTimeout(r, 400));
        return new Response("late");
      });
      try {
        const res = await forward("track", 50, `http://127.0.0.1:${server.addr.port}`)(new Request("http://legacy/x", { method: "POST", body: "{}" }));
        assertEq(res.status, 502);
      } finally {
        await server.shutdown();
      }
    },
  );
});

Deno.test("oversize body gives 413 and never reaches upstream", async () => {
  await withUpstream(
    () => new Response("ok"),
    async (base, seen) => {
      const f = forward("track", 5000, base);
      const big = new Uint8Array(MAX_BODY_BYTES + 1);
      const res = await f(new Request("http://legacy/x", { method: "POST", body: big }));
      assertEq(res.status, 413);
      const stream = new ReadableStream({
        start(c) {
          c.enqueue(new Uint8Array(MAX_BODY_BYTES));
          c.enqueue(new Uint8Array(10));
          c.close();
        },
      });
      const res2 = await f(new Request("http://legacy/x", { method: "POST", body: stream, duplex: "half" } as RequestInit));
      assertEq(res2.status, 413);
      assertEq(seen.length, 0);
    },
  );
});

Deno.test("streamed body: first chunk arrives before the second is sent", async () => {
  const enc = new TextEncoder();
  const server = Deno.serve({ port: 0, onListen() {} }, () => {
    const stream = new ReadableStream({
      async start(c) {
        c.enqueue(enc.encode("data: one\n\n"));
        await new Promise((r) => setTimeout(r, 300));
        c.enqueue(enc.encode("data: two\n\n"));
        c.close();
      },
    });
    return new Response(stream, { headers: { "content-type": "text/event-stream" } });
  });
  try {
    const t0 = Date.now();
    const res = await forward("ai-ask-spike", 5000, `http://127.0.0.1:${server.addr.port}`)(
      new Request("http://legacy/x", { method: "POST", body: "{}" }),
    );
    const reader = res.body!.getReader();
    const first = await reader.read();
    const firstAt = Date.now() - t0;
    assertEq(new TextDecoder().decode(first.value), "data: one\n\n");
    if (firstAt >= 250) throw new Error(`first chunk delayed ${firstAt}ms`);
    const second = await reader.read();
    assertEq(new TextDecoder().decode(second.value), "data: two\n\n");
    assertEq((await reader.read()).done, true);
  } finally {
    await server.shutdown();
  }
});

Deno.test("client abort cancels the upstream request", async () => {
  let upstreamAborted: () => void = () => {};
  const aborted = new Promise<void>((r) => (upstreamAborted = r));
  const server = Deno.serve({ port: 0, onListen() {} }, () => {
    const stream = new ReadableStream({
      start(c) {
        c.enqueue(new TextEncoder().encode("data: one\n\n"));
      },
      cancel() {
        upstreamAborted();
      },
    });
    return new Response(stream, { headers: { "content-type": "text/event-stream" } });
  });
  try {
    const ac = new AbortController();
    const res = await forward("ai-ask-spike", 5000, `http://127.0.0.1:${server.addr.port}`)(
      new Request("http://legacy/x", { method: "POST", body: "{}", signal: ac.signal }),
    );
    await res.body!.getReader().read();
    ac.abort();
    const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error("upstream not aborted")), 3000));
    await Promise.race([aborted, timeout]);
  } finally {
    await server.shutdown();
  }
});

Deno.test("stalled stream is cut by the idle timeout", async () => {
  const server = Deno.serve({ port: 0, onListen() {} }, () => {
    const stream = new ReadableStream({
      start(c) {
        c.enqueue(new TextEncoder().encode("data: one\n\n"));
      },
    });
    return new Response(stream);
  });
  try {
    const res = await forward("track", 5000, `http://127.0.0.1:${server.addr.port}`, 100)(
      new Request("http://legacy/x", { method: "POST", body: "{}" }),
    );
    const reader = res.body!.getReader();
    await reader.read();
    let failed = false;
    try {
      await reader.read();
    } catch {
      failed = true;
    }
    assertEq(failed, true);
  } finally {
    await server.shutdown();
  }
});

Deno.test("no console calls", async () => {
  const calls: string[] = [];
  const orig = { ...console };
  for (const k of ["log", "error", "warn", "info", "debug"] as const) {
    console[k] = () => {
      calls.push(k);
    };
  }
  try {
    await withUpstream(
      () => new Response("ok"),
      async (base) => {
        await forward("track", 5000, base)(new Request("http://legacy/x", { method: "POST", body: "{}" }));
      },
    );
    await forward("track", 1000, "http://127.0.0.1:1")(new Request("http://legacy/x", { method: "POST", body: "{}" }));
  } finally {
    Object.assign(console, orig);
  }
  assertEq(calls.length, 0);
});

Deno.test("served end to end: stream survives and completes through Deno.serve", async () => {
  const enc = new TextEncoder();
  const upstream = Deno.serve({ port: 0, onListen() {} }, () => {
    const stream = new ReadableStream({
      async start(c) {
        c.enqueue(enc.encode("one;"));
        await new Promise((r) => setTimeout(r, 300));
        c.enqueue(enc.encode("two;"));
        await new Promise((r) => setTimeout(r, 300));
        c.enqueue(enc.encode("three"));
        c.close();
      },
    });
    return new Response(stream);
  });
  const front = Deno.serve({ port: 0, onListen() {} }, forward("ai-ask-spike", 5000, `http://127.0.0.1:${upstream.addr.port}`));
  try {
    const res = await fetch(`http://127.0.0.1:${front.addr.port}/x`, { method: "POST", body: "{}" });
    assertEq(await res.text(), "one;two;three");
  } finally {
    await front.shutdown();
    await upstream.shutdown();
  }
});

Deno.test("forwarder drops incoming x-zs-forwarder and adds its own secret", async () => {
  Deno.env.set("FORWARDER_SECRET", "own-secret");
  try {
    await withUpstream(
      () => new Response("ok"),
      async (base, seen) => {
        const f = forward("x", 5000, base);
        await f(new Request("http://legacy/x", { method: "POST", body: "{}", headers: { "x-zs-forwarder": "forged", "x-forwarded-for": "1.2.3.4" } }));
        assertEq(seen[0].headers.get("x-zs-forwarder"), "own-secret");
        assertEq(seen[0].headers.get("x-forwarded-for"), "1.2.3.4");
      },
    );
  } finally {
    Deno.env.delete("FORWARDER_SECRET");
  }
});

Deno.test("without FORWARDER_SECRET no x-zs-forwarder is sent, even if the client sets one", async () => {
  Deno.env.delete("FORWARDER_SECRET");
  await withUpstream(
    () => new Response("ok"),
    async (base, seen) => {
      const f = forward("x", 5000, base);
      await f(new Request("http://legacy/x", { method: "POST", body: "{}", headers: { "x-zs-forwarder": "forged" } }));
      assertEq(seen[0].headers.get("x-zs-forwarder"), null);
    },
  );
});
