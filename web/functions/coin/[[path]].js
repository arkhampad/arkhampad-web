// /coin/?c=<chain>-<address>: give each coin link its own preview (title, text, image)
// when it's shared on X, Telegram, WhatsApp, Discord... The page itself is unchanged.
const SUPA = "https://yvdudswzmdziwnfurwir.supabase.co";
const KEY = "sb_publishable_S49UWqqXDzSaRbjBsAfYaA_kjfxyRPB";
const RELAYER = "https://arkhampad-web-production.up.railway.app";
const money = (v) => { v = Number(v) || 0; return v >= 1e9 ? `$${(v / 1e9).toFixed(2)}B` : v >= 1e6 ? `$${(v / 1e6).toFixed(2)}M` : v >= 1e3 ? `$${(v / 1e3).toFixed(1)}K` : `$${v.toFixed(2)}`; };

async function coinInfo(env, chainId, address) {
  const base = env.NEXT_PUBLIC_SUPABASE_URL || SUPA, key = env.NEXT_PUBLIC_SUPABASE_KEY || KEY;
  const h = { apikey: key, authorization: `Bearer ${key}` };
  const get = async (path) => { const r = await fetch(`${base}/rest/v1/${path}`, { headers: h, cf: { cacheTtl: 60 } }); return r.ok ? (await r.json())[0] : null; };
  const own = await get(`coin_list?select=name,symbol,mc_usd&chain_id=eq.${chainId}&address=eq.${address}&limit=1`);
  if (own) return { name: own.name, symbol: own.symbol, mc: own.mc_usd, own: true };
  const ext = await get(`ext_tokens?select=name,symbol,mcap_usd,fdv_usd&chain_id=eq.${chainId}&address=eq.${address}&limit=1`);
  return ext ? { name: ext.name, symbol: ext.symbol, mc: ext.mcap_usd || ext.fdv_usd, own: false } : null;
}

export async function onRequestGet(ctx) {
  const res = await ctx.next();
  try {
    const url = new URL(ctx.request.url);
    const id = (url.searchParams.get("c") || "").toLowerCase();
    const m = id.match(/^(\d+)-(0x[0-9a-f]{40})$/);
    if (!m || !(res.headers.get("content-type") || "").includes("text/html")) return res;
    const c = await coinInfo(ctx.env, m[1], m[2]);
    if (!c) return res;
    const relayer = ctx.env.NEXT_PUBLIC_RELAYER_URL || RELAYER;
    const title = `${c.name} ($${c.symbol}) · ArkhamPad`;
    const desc = `Market cap ${money(c.mc)}. ${c.own ? "Launched on ArkhamPad." : ""} Buy or sell with one tap, no wallet setup.`.replace(/\s+/g, " ").trim();
    const image = `${relayer}/og/coin/${id}.png`;
    const set = (v) => ({ element(e) { e.setAttribute("content", v); } });
    return new HTMLRewriter()
      .on("title", { element(e) { e.setInnerContent(title); } })
      .on('meta[property="og:title"]', set(title)).on('meta[name="twitter:title"]', set(title))
      .on('meta[property="og:description"]', set(desc)).on('meta[name="description"]', set(desc)).on('meta[name="twitter:description"]', set(desc))
      .on('meta[property="og:image"]', set(image)).on('meta[name="twitter:image"]', set(image))
      .on('meta[property="og:image:alt"]', set(title))
      .on('meta[property="og:url"]', set(`https://arkhampad.com/coin/?c=${id}`))
      .transform(res);
  } catch {
    return res; // never break the page for a preview
  }
}
