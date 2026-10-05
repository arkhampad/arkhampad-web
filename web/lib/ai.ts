// Shared helpers for the AI Pages Functions (Cloudflare Workers AI, binding "AI").
// Server-only: imported by web/functions/api/*.js, never by pages.
type AiBinding = { run: (model: string, input: unknown) => Promise<unknown> };
export type AiEnv = { AI?: AiBinding };

export const MODELS = ["@cf/meta/llama-3.3-70b-instruct-fp8-fast", "@cf/meta/llama-3.1-8b-instruct"];
export const FAST = ["@cf/meta/llama-3.1-8b-instruct-fast", "@cf/meta/llama-3.1-8b-instruct"];

export const json = (body: unknown, status = 200, cache = "no-store") =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": cache } });

export async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  try { const b = await request.json(); return b && typeof b === "object" ? (b as Record<string, unknown>) : null; } catch { return null; }
}

/** Runs the first model that answers. Returns the raw text, or null. */
export async function ask(env: AiEnv, system: string, user: string, opts: { max?: number; temp?: number; models?: string[] } = {}): Promise<string | null> {
  if (!env.AI) return null;
  for (const model of opts.models ?? MODELS) {
    try {
      const out = (await env.AI.run(model, { messages: [{ role: "system", content: system }, { role: "user", content: user }], max_tokens: opts.max ?? 200, temperature: opts.temp ?? 0.3 })) as { response?: unknown } | null;
      const r = out?.response;
      const text = typeof r === "string" ? r : r && typeof r === "object" ? JSON.stringify(r) : "";
      if (text.trim()) return text.trim();
    } catch { /* next model */ }
  }
  return null;
}

/** First {...} object in a model reply. */
export function parseObj(text: string | null): Record<string, unknown> | null {
  const m = String(text ?? "").match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { const o = JSON.parse(m[0]); return o && typeof o === "object" ? o : null; } catch { return null; }
}

export const oneLine = (s: string, max: number) => s.replace(/\s+/g, " ").replace(/^["'\s]+|["'\s]+$/g, "").trim().slice(0, max);

/** Edge cache (per data centre) for answers that don't change for the same input.
 *  `make` returns the response and whether it is worth keeping (AI answers yes, fallbacks no). */
export async function cached(key: string, ttl: number, make: () => Promise<[Response, boolean]>): Promise<Response> {
  const cache = (globalThis as unknown as { caches?: { default?: Cache } }).caches?.default;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key));
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  const req = new Request(`https://cache.arkhampad.internal/${hex}`);
  if (cache) { const hit = await cache.match(req).catch(() => undefined); if (hit) return hit; }
  const [res, keep] = await make();
  if (cache && keep && res.ok) {
    const copy = new Response(res.clone().body, res);
    copy.headers.set("cache-control", `public, max-age=${ttl}`);
    await cache.put(req, copy).catch(() => {});
  }
  return res;
}
