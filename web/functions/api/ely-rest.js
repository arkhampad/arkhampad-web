// GET /api/ely-rest?p=<PostgREST path>&ttl=<seconds>: read-only window onto the public Elysium tables,
// cached at Cloudflare's edge. Every visitor shares one cached answer per few seconds, so the database
// sends each list once instead of once per visitor (Supabase counts every byte sent out).
// If the database can't answer, the last good copy (kept for a day) is served instead of an error.
const SB_URL = "https://yvdudswzmdziwnfurwir.supabase.co";
const SB_KEY = "sb_publishable_S49UWqqXDzSaRbjBsAfYaA_kjfxyRPB";
const TABLES = /^(ely_tokens|ely_trades|ely_balances|ely_meta)\?/;

export async function onRequestGet({ request, env, waitUntil }) {
  const u = new URL(request.url);
  const p = u.searchParams.get("p") || "";
  if (!TABLES.test(p) || p.length > 4000) return new Response("bad path", { status: 400 });
  const ttl = Math.min(300, Math.max(3, Number(u.searchParams.get("ttl")) || 5));
  const cache = caches.default;
  const key = new Request(`${u.origin}/api/ely-rest?p=${encodeURIComponent(p)}&ttl=${ttl}`);
  const staleKey = new Request(`${u.origin}/api/ely-rest-stale?p=${encodeURIComponent(p)}`);
  const hit = await cache.match(key);
  if (hit) return hit;
  const base = env.NEXT_PUBLIC_SUPABASE_URL || SB_URL;
  const k = env.NEXT_PUBLIC_SUPABASE_KEY || SB_KEY;
  let r = null, body = "";
  try {
    r = await fetch(`${base}/rest/v1/${p}`, { headers: { apikey: k, authorization: `Bearer ${k}`, accept: "application/json" }, signal: AbortSignal.timeout(8000) });
    body = await r.text();
  } catch {}
  if (r && r.ok) {
    const res = new Response(body, { headers: { "content-type": "application/json", "cache-control": `public, max-age=${Math.min(ttl, 5)}, s-maxage=${ttl}` } });
    waitUntil(cache.put(key, res.clone()));
    waitUntil(cache.put(staleKey, new Response(body, { headers: { "content-type": "application/json", "cache-control": "public, s-maxage=86400" } })));
    return res;
  }
  if (r && r.status === 400) return new Response(body, { status: 400, headers: { "content-type": "application/json" } });
  const old = await cache.match(staleKey);
  if (old) return new Response(old.body, { headers: { "content-type": "application/json", "cache-control": "public, max-age=5", "x-stale": "1" } });
  return new Response(body || "upstream down", { status: r?.status || 502, headers: { "content-type": "application/json" } });
}
