// GET /api/ely-img?a=<token address>: a token's picture, cached at Cloudflare's edge for days. Pictures
// often live inside the token's metadata as a data URI (up to ~120 KB), so lists never carry them; each
// avatar loads from here once per edge location instead of being sent with every list refresh.
const SB_URL = "https://yvdudswzmdziwnfurwir.supabase.co";
const SB_KEY = "sb_publishable_S49UWqqXDzSaRbjBsAfYaA_kjfxyRPB";

export async function onRequestGet({ request, env, waitUntil }) {
  const u = new URL(request.url);
  const a = (u.searchParams.get("a") || "").toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(a)) return new Response("bad address", { status: 400 });
  const cache = caches.default;
  const key = new Request(`${u.origin}/api/ely-img?a=${a}`);
  const hit = await cache.match(key);
  if (hit) return hit;
  const base = env.NEXT_PUBLIC_SUPABASE_URL || SB_URL;
  const k = env.NEXT_PUBLIC_SUPABASE_KEY || SB_KEY;
  let img = null;
  try {
    const r = await fetch(`${base}/rest/v1/ely_tokens?select=image&address=eq.${a}&limit=1`, { headers: { apikey: k, authorization: `Bearer ${k}` } });
    img = (await r.json())?.[0]?.image || null;
  } catch {}
  let res;
  const m = typeof img === "string" && img.match(/^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i);
  if (m) {
    const bin = Uint8Array.from(atob(m[2]), (c) => c.charCodeAt(0));
    res = new Response(bin, { headers: { "content-type": m[1], "cache-control": "public, max-age=86400, s-maxage=604800" } });
  } else if (typeof img === "string" && /^https:\/\//.test(img)) {
    res = new Response(null, { status: 302, headers: { location: img, "cache-control": "public, max-age=86400, s-maxage=604800" } });
  } else if (typeof img === "string" && img.startsWith("ipfs://")) {
    res = new Response(null, { status: 302, headers: { location: `https://ipfs.io/ipfs/${img.slice(7)}`, "cache-control": "public, max-age=86400, s-maxage=604800" } });
  } else {
    // no picture yet (it may be filled in later): remember that only for a short while
    res = new Response("no image", { status: 404, headers: { "cache-control": "public, max-age=300, s-maxage=600" } });
  }
  waitUntil(cache.put(key, res.clone()));
  return res;
}
