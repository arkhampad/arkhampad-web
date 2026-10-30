// GET /api/ely-rest?p=<PostgREST path>&ttl=<seconds>: read-only window onto the public Elysium tables,
// cached at Cloudflare's edge. Every visitor shares one cached answer per few seconds, so the database
// sends each list once instead of once per visitor (Supabase's free plan counts every byte sent out).
const SB_URL = "https://yvdudswzmdziwnfurwir.supabase.co";
const SB_KEY = "sb_publishable_S49UWqqXDzSaRbjBsAfYaA_kjfxyRPB";
const TABLES = /^(ely_tokens|ely_trades|ely_balances|ely_meta)\?/;

export async function onRequestGet({ request, env, waitUntil }) {
  const u = new URL(request.url);
  const p = u.searchParams.get("p") || "";
  if (!TABLES.test(p) || p.length > 4000) return new Response("bad path", { status: 400 });
  const ttl = Math.min(300, Math.max(2, Number(u.searchParams.get("ttl")) || 5));
  const cache = caches.default;
  const key = new Request(`${u.origin}/api/ely-rest?p=${encodeURIComponent(p)}&ttl=${ttl}`);
  const hit = await cache.match(key);
  if (hit) return hit;
  const base = env.NEXT_PUBLIC_SUPABASE_URL || SB_URL;
  const k = env.NEXT_PUBLIC_SUPABASE_KEY || SB_KEY;
  const r = await fetch(`${base}/rest/v1/${p}`, { headers: { apikey: k, authorization: `Bearer ${k}`, accept: "application/json" } });
  const body = await r.text();
  const res = new Response(body, {
    status: r.status,
    headers: { "content-type": "application/json", "cache-control": `public, max-age=${Math.min(ttl, 5)}, s-maxage=${ttl}` },
  });
  if (r.ok) waitUntil(cache.put(key, res.clone()));
  return res;
}
