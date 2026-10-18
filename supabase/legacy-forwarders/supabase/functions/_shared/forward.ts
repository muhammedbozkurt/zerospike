export const UPSTREAM_BASE = "https://jcpepqectdubbmchhdsn.supabase.co/functions/v1";
export const MAX_BODY_BYTES = 512 * 1024;
export const DEFAULT_TIMEOUT_MS = 25_000;

const REQUEST_HEADERS = ["content-type", "x-device-id", "x-consent-context", "x-rc-app-user-id", "authorization", "user-agent"];
const RESPONSE_HEADERS = ["content-type", "retry-after", "cache-control", "x-accel-buffering"];

function reply(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function clientIp(req: Request): string | null {
  const cf = req.headers.get("cf-connecting-ip")?.trim();
  if (cf) return cf;
  const hops = (req.headers.get("x-forwarded-for") ?? "").split(",").map((hop) => hop.trim()).filter((hop) => hop);
  return hops.at(-1) ?? null;
}

async function readBytes(req: Request): Promise<Uint8Array<ArrayBuffer> | null> {
  if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) return null;
  if (!req.body) return new Uint8Array(new ArrayBuffer(0));
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY_BYTES) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(new ArrayBuffer(size));
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function streamWithIdleTimeout(source: ReadableStream<Uint8Array>, idleMs: number, controller: AbortController): ReadableStream<Uint8Array> {
  const reader = source.getReader();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const arm = () => {
    clearTimeout(timer);
    timer = setTimeout(() => controller.abort(), idleMs);
  };
  return new ReadableStream<Uint8Array>({
    start: arm,
    async pull(out) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          clearTimeout(timer);
          out.close();
          return;
        }
        arm();
        out.enqueue(value);
      } catch (err) {
        clearTimeout(timer);
        out.error(err);
      }
    },
    cancel(reason) {
      clearTimeout(timer);
      controller.abort();
      return reader.cancel(reason).catch(() => {});
    },
  });
}

export function forward(
  name: string,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  base = UPSTREAM_BASE,
  idleMs = timeoutMs,
): (req: Request) => Promise<Response> {
  return async (req) => {
    if (req.method === "OPTIONS") return new Response(null, { status: 204 });
    const headers = new Headers();
    for (const key of REQUEST_HEADERS) {
      const value = req.headers.get(key);
      if (value !== null) headers.set(key, value);
    }
    const secret = (globalThis as any).Deno?.env?.get?.("FORWARDER_SECRET");
    if (typeof secret === "string" && secret !== "") {
      headers.set("x-zs-forwarder", secret);
      const ip = clientIp(req);
      if (ip) headers.set("x-zs-client-ip", ip);
    }

    let body: Uint8Array<ArrayBuffer> | undefined;
    if (req.method !== "GET" && req.method !== "HEAD") {
      let bytes: Uint8Array<ArrayBuffer> | null;
      try {
        bytes = await readBytes(req);
      } catch {
        return reply({ error: "bad_request" }, 400);
      }
      if (bytes === null) return reply({ error: "payload_too_large" }, 413);
      body = bytes;
    }

    const controller = new AbortController();
    if (req.signal.aborted) controller.abort();
    else req.signal.addEventListener("abort", () => controller.abort(), { once: true });
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${base}/${name}`, { method: req.method, headers, body, signal: controller.signal });
      clearTimeout(timer);
      const out = new Headers();
      res.headers.forEach((value, key) => {
        if (RESPONSE_HEADERS.includes(key) || key.startsWith("access-control-")) out.set(key, value);
      });
      if (!res.body || res.status === 204 || res.status === 304) {
        await res.body?.cancel().catch(() => {});
        return new Response(null, { status: res.status, headers: out });
      }
      return new Response(streamWithIdleTimeout(res.body, idleMs, controller), { status: res.status, headers: out });
    } catch {
      clearTimeout(timer);
      return reply({ error: "upstream_unavailable" }, 502);
    }
  };
}
