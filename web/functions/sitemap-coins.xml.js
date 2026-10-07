// /sitemap-coins.xml: coin pages for search engines, read live from the database.
// Coins launched on ArkhamPad first (newest first), then the most traded coins from other DEXs.
const SUPA = "https://yvdudswzmdziwnfurwir.supabase.co";
const KEY = "sb_publishable_S49UWqqXDzSaRbjBsAfYaA_kjfxyRPB";
const SITE = "https://arkhampad.com";
const MAX_OWN = 20000, MAX_EXT = 10000, PAGE = 1000;

async function rows(env, path, max) {
  const base = env.NEXT_PUBLIC_SUPABASE_URL || SUPA, key = env.NEXT_PUBLIC_SUPABASE_KEY || KEY;
  const out = [];
  for (let from = 0; from < max; from += PAGE) {
    const r = await fetch(`${base}/rest/v1/${path}&limit=${PAGE}&offset=${from}`, { headers: { apikey: key, authorization: `Bearer ${key}` }, cf: { cacheTtl: 900 } });
    if (!r.ok) break;
    const page = await r.json();
    out.push(...page);
    if (page.length < PAGE) break;
  }
  return out;
}

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");
const ok = (a) => /^0x[0-9a-f]{40}$/.test(String(a));

export async function onRequestGet({ env }) {
  let own = [], ext = [];
  try {
    [own, ext] = await Promise.all([
      rows(env, "coins?select=chain_id,address,created_at&order=created_at.desc", MAX_OWN),
      rows(env, "ext_tokens?select=chain_id,address,updated_at&listed=eq.true&order=vol_24h.desc.nullslast", MAX_EXT),
    ]);
  } catch { /* serve whatever we have */ }
  const seen = new Set();
  const urls = [];
  for (const r of [...own.map((x) => ({ ...x, at: x.created_at, p: "0.6" })), ...ext.map((x) => ({ ...x, at: x.updated_at, p: "0.5" }))]) {
    const addr = String(r.address).toLowerCase();
    const id = `${r.chain_id}-${addr}`;
    if (!ok(addr) || seen.has(id)) continue;
    seen.add(id);
    const d = r.at ? new Date(r.at) : null;
    urls.push(`<url><loc>${esc(`${SITE}/coin/?c=${id}`)}</loc>${d && !isNaN(d) ? `<lastmod>${d.toISOString()}</lastmod>` : ""}<changefreq>hourly</changefreq><priority>${r.p}</priority></url>`);
  }
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>\n`;
  return new Response(xml, { headers: { "content-type": "application/xml; charset=utf-8", "cache-control": "public, max-age=3600" } });
}
