// /tokens.json: every coin launched on ArkhamPad, as a standard token list
// (Uniswap token-list format, https://tokenlists.org). Wallets, DEX screeners and
// trackers can read it to show each coin's name, logo and links, and to know it was
// launched on ArkhamPad. Filters: ?chain=8453 (one chain), ?limit=500 (newest first).
const SUPA = "https://yvdudswzmdziwnfurwir.supabase.co";
const KEY = "sb_publishable_S49UWqqXDzSaRbjBsAfYaA_kjfxyRPB";
const SITE = "https://arkhampad.com";
const PAGE = 1000, MAX = 20000;

/** Coin details the creator added at launch (description and links). */
function meta(uri) {
  if (typeof uri !== "string" || !uri.startsWith("data:application/json;base64,")) return {};
  try {
    const j = JSON.parse(decodeURIComponent(escape(atob(uri.slice(29)))));
    const s = (v, n) => (typeof v === "string" && v.trim() ? v.trim().slice(0, n) : undefined);
    return { description: s(j.description, 280), x: s(j.x, 100), telegram: s(j.telegram, 100), website: s(j.website, 200) };
  } catch {
    return {};
  }
}

const xUrl = (h) => (h ? (/^https?:\/\//.test(h) ? h : `https://x.com/${h.replace(/^@/, "")}`) : undefined);
const tgUrl = (h) => (h ? (/^https?:\/\//.test(h) ? h : `https://t.me/${h.replace(/^@/, "")}`) : undefined);
const webUrl = (h) => (h ? (/^https?:\/\//.test(h) ? h : `https://${h}`) : undefined);

export async function onRequestGet({ request, env }) {
  const u = new URL(request.url);
  const chain = Number(u.searchParams.get("chain")) || null;
  const limit = Math.max(1, Math.min(MAX, Number(u.searchParams.get("limit")) || MAX));
  const base = env.NEXT_PUBLIC_SUPABASE_URL || SUPA, key = env.NEXT_PUBLIC_SUPABASE_KEY || KEY;
  const rows = [];
  try {
    for (let from = 0; from < limit; from += PAGE) {
      const q = `coins?select=chain_id,address,name,symbol,image_url,metadata_uri,creator,created_at${chain ? `&chain_id=eq.${chain}` : ""}&order=created_at.desc&limit=${Math.min(PAGE, limit - from)}&offset=${from}`;
      const r = await fetch(`${base}/rest/v1/${q}`, { headers: { apikey: key, authorization: `Bearer ${key}` }, cf: { cacheTtl: 120 } });
      if (!r.ok) break;
      const page = await r.json();
      rows.push(...page);
      if (page.length < PAGE) break;
    }
  } catch { /* serve what we have */ }

  const tokens = [];
  const seen = new Set();
  for (const r of rows) {
    const address = String(r.address || "").toLowerCase();
    if (!/^0x[0-9a-f]{40}$/.test(address)) continue;
    const id = `${r.chain_id}-${address}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const symbol = String(r.symbol || "").replace(/\s+/g, "").slice(0, 20);
    const name = String(r.name || symbol).trim().slice(0, 40);
    if (!symbol || !name) continue;
    const m = meta(r.metadata_uri);
    const ext = {
      launchpad: "ArkhamPad",
      launchpadUrl: SITE,
      coinPage: `${SITE}/coin/?c=${id}`,
      creator: r.creator ? String(r.creator).toLowerCase() : undefined,
      launchedAt: r.created_at || undefined,
      description: m.description,
      website: webUrl(m.website),
      x: xUrl(m.x),
      telegram: tgUrl(m.telegram),
    };
    for (const k of Object.keys(ext)) if (ext[k] === undefined) delete ext[k];
    tokens.push({
      chainId: Number(r.chain_id),
      address,
      name,
      symbol,
      decimals: 18,
      logoURI: typeof r.image_url === "string" && r.image_url.startsWith("https://") ? r.image_url : `${SITE}/logo/${id}.svg`,
      tags: ["arkhampad"],
      extensions: ext,
    });
  }

  const now = new Date();
  const body = {
    name: "ArkhamPad",
    timestamp: now.toISOString(),
    version: { major: 1, minor: Math.floor(now.getTime() / 86400000) % 1000, patch: 0 },
    logoURI: `${SITE}/icon-512.png`,
    keywords: ["arkhampad", "launchpad", "memecoin"],
    tags: { arkhampad: { name: "ArkhamPad", description: "Launched on ArkhamPad (arkhampad.com)" } },
    tokens,
  };
  return new Response(JSON.stringify(body), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
      "cache-control": "public, max-age=120",
    },
  });
}
