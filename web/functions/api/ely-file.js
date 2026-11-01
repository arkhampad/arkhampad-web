// GET /api/ely-file?h=<sha256>: an uploaded coin picture (animated GIF etc.), cached at the edge for a
// year (the address is the picture's own hash, so it never changes).
const SB_URL = "https://yvdudswzmdziwnfurwir.supabase.co";
const SB_KEY = "sb_publishable_S49UWqqXDzSaRbjBsAfYaA_kjfxyRPB";

export async function onRequestGet({ request, env, waitUntil }) {
  const u = new URL(request.url);
  const h = (u.searchParams.get("h") || "").toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(h)) return new Response("bad", { status: 400 });
  const cache = caches.default;
  const key = new Request(`${u.origin}/api/ely-file?h=${h}`);
  const hit = await cache.match(key);
  if (hit) return hit;
  const base = env.NEXT_PUBLIC_SUPABASE_URL || SB_URL;
  const k = env.NEXT_PUBLIC_SUPABASE_KEY || SB_KEY;
  let row = null;
  try {
    const r = await fetch(`${base}/rest/v1/ely_images?select=mime,data&hash=eq.${h}&limit=1`, { headers: { apikey: k, authorization: `Bearer ${k}` } });
    row = (await r.json())?.[0] ?? null;
  } catch {}
  if (!row) return new Response("not found", { status: 404, headers: { "cache-control": "public, max-age=30" } });
  const bin = Uint8Array.from(atob(row.data), (c) => c.charCodeAt(0));
  const res = new Response(bin, { headers: { "content-type": row.mime, "cache-control": "public, max-age=31536000, immutable", "access-control-allow-origin": "*" } });
  waitUntil(cache.put(key, res.clone()));
  return res;
}
