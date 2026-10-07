// /logo/<chainId>-<address>.svg: a simple logo for coins launched without a picture
// (used by /tokens.json so every coin has a logo). Initials on a colour picked from the address.
const PALETTE = [["#9B8CFF", "#5B45D6"], ["#FF8A3D", "#C2410C"], ["#2EBD85", "#0F766E"], ["#3B6FF5", "#1D45B5"], ["#F6465D", "#9F1239"], ["#E3A008", "#92400E"], ["#14B8A6", "#0E7490"], ["#C6F01C", "#4D7C0F"]];
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

export async function onRequestGet({ params, env }) {
  const raw = (Array.isArray(params.path) ? params.path.join("/") : String(params.path || "")).replace(/\.svg$/, "");
  const m = raw.match(/^(\d+)-(0x[0-9a-fA-F]{40})$/);
  if (!m) return new Response("Not found", { status: 404 });
  const [, chain, address] = m;
  let sym = "";
  try {
    const base = env.NEXT_PUBLIC_SUPABASE_URL || "https://yvdudswzmdziwnfurwir.supabase.co";
    const key = env.NEXT_PUBLIC_SUPABASE_KEY || "sb_publishable_S49UWqqXDzSaRbjBsAfYaA_kjfxyRPB";
    const r = await fetch(`${base}/rest/v1/coins?select=name,symbol&chain_id=eq.${chain}&address=eq.${address.toLowerCase()}&limit=1`, { headers: { apikey: key, authorization: `Bearer ${key}` }, cf: { cacheTtl: 3600 } });
    const row = r.ok ? (await r.json())[0] : null;
    const words = String(row?.name || row?.symbol || "").trim().split(/\s+/).filter(Boolean);
    sym = (words.length > 1 ? words[0][0] + words[1][0] : (words[0] || "?").slice(0, 2)).toUpperCase();
  } catch { sym = "?"; }
  const [c1, c2] = PALETTE[parseInt(address.slice(-2), 16) % PALETTE.length];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient></defs><rect width="256" height="256" rx="56" fill="url(#g)"/><text x="128" y="150" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-weight="700" font-size="96" fill="#fff">${esc(sym || "?")}</text></svg>`;
  return new Response(svg, { headers: { "content-type": "image/svg+xml", "cache-control": "public, max-age=86400", "access-control-allow-origin": "*" } });
}
