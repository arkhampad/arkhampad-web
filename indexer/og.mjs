// Link preview images (1200x630 PNG) for coin pages: shown when a coin link is shared on X,
// Telegram, WhatsApp, Discord... Rendered from SVG with bundled fonts.
import { Resvg } from "@resvg/resvg-js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const FONTS = ["fonts/Inter_800ExtraBold.ttf", "fonts/Inter_500Medium.ttf", "fonts/JetBrainsMono_700Bold.ttf"].map(here);
const LOGO = `data:image/png;base64,${readFileSync(here("assets/logo.png")).toString("base64")}`;
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]);
const money = (v) => { v = Number(v) || 0; return v >= 1e9 ? `$${(v / 1e9).toFixed(2)}B` : v >= 1e6 ? `$${(v / 1e6).toFixed(2)}M` : v >= 1e3 ? `$${(v / 1e3).toFixed(1)}K` : `$${v.toFixed(2)}`; };
const CHAINS = { 84532: "Base", 8453: "Base", 46630: "Robinhood", 4663: "Robinhood", 56: "BNB", 5042: "Arc" };
const COLORS = [["#7C5CFF", "#3A2BFF"], ["#FF8A3D", "#FF3D7F"], ["#2BB3FF", "#0066FF"], ["#3DDC97", "#00B37E"], ["#F5C542", "#FF7A00"], ["#E8559A", "#8A2BE2"]];

/** c: { name, symbol, chainId, address, mc, change, image (data URI or null), own } */
export function coinSvg(c) {
  const [c1, c2] = COLORS[parseInt(String(c.address).slice(-2), 16) % COLORS.length] || COLORS[0];
  let name = String(c.name || "Coin");
  if (name.length > 18) name = name.slice(0, 17) + "…";
  const up = (c.change ?? 0) >= 0;
  const chg = c.change == null ? (c.own ? "New" : "") : `${up ? "+" : ""}${Number(c.change).toFixed(1)}%`;
  const avatar = c.image
    ? `<clipPath id="av"><rect x="64" y="170" width="170" height="170" rx="40"/></clipPath><image href="${c.image}" x="64" y="170" width="170" height="170" preserveAspectRatio="xMidYMid slice" clip-path="url(#av)"/>`
    : `<rect x="64" y="170" width="170" height="170" rx="40" fill="url(#g)"/><text x="149" y="275" font-family="Inter" font-weight="800" font-size="64" fill="#fff" text-anchor="middle">${esc(String(c.symbol || "?").slice(0, 2).toUpperCase())}</text>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0A0B10"/><stop offset="1" stop-color="#12151E"/></linearGradient>
    <radialGradient id="glow" cx="1040" cy="110" r="520" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#D4FF3A" stop-opacity="0.18"/><stop offset="1" stop-color="#D4FF3A" stop-opacity="0"/></radialGradient>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#bg)"/><rect width="1200" height="630" fill="url(#glow)"/>
  <image href="${LOGO}" x="64" y="56" width="56" height="56"/>
  <text x="136" y="96" font-family="Inter" font-weight="800" font-size="34" fill="#F2F3F5">ArkhamPad</text>
  <text x="1136" y="96" font-family="Inter" font-weight="800" font-size="22" fill="#D4FF3A" text-anchor="end">${esc(c.own ? "Launched on ArkhamPad" : CHAINS[c.chainId] || "")}</text>
  ${avatar}
  <text x="270" y="250" font-family="Inter" font-weight="800" font-size="70" fill="#F2F3F5">${esc(name)}</text>
  <text x="272" y="310" font-family="JetBrains Mono" font-weight="700" font-size="32" fill="#8A909C">$${esc(c.symbol)} · ${esc(CHAINS[c.chainId] || "")}</text>
  <text x="64" y="430" font-family="Inter" font-weight="500" font-size="26" fill="#8A909C">${c.mcLabel || "Market cap"}</text>
  <text x="64" y="500" font-family="JetBrains Mono" font-weight="700" font-size="76" fill="#F2F3F5">${esc(money(c.mc))}</text>
  ${chg ? `<text x="600" y="430" font-family="Inter" font-weight="500" font-size="26" fill="#8A909C">24h</text><text x="600" y="500" font-family="JetBrains Mono" font-weight="700" font-size="76" fill="${up ? "#3DDC97" : "#FF6B6B"}">${esc(chg)}</text>` : ""}
  <rect x="64" y="540" width="1072" height="56" rx="16" fill="#FFFFFF" fill-opacity="0.05"/>
  <text x="90" y="577" font-family="JetBrains Mono" font-weight="700" font-size="22" fill="#8A909C">CA ${esc(c.address)}</text>
  <text x="1112" y="577" font-family="Inter" font-weight="800" font-size="22" fill="#D4FF3A" text-anchor="end">arkhampad.com</text>
</svg>`;
}

export function renderPng(svg) {
  return new Resvg(svg, { font: { fontFiles: FONTS, loadSystemFonts: false, defaultFontFamily: "Inter" }, fitTo: { mode: "width", value: 1200 } }).render().asPng();
}

/** Loads a coin's data (ours or another DEX's) and renders its card. Cached for 5 minutes. */
export function makeOg(db) {
  const cache = new Map();
  async function imageData(url) {
    if (!url) return null;
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(2500) });
      if (!r.ok) return null;
      const type = (r.headers.get("content-type") || "image/png").split(";")[0];
      if (!/^image\/(png|jpe?g|webp|gif)$/.test(type)) return null;
      const buf = Buffer.from(await r.arrayBuffer());
      return buf.length < 3_000_000 ? `data:${type};base64,${buf.toString("base64")}` : null;
    } catch { return null; }
  }
  return async function coinCard(id, imgBase) {
    const m = String(id).match(/^(\d+)-(0x[0-9a-f]{40})$/i);
    if (!m) return null;
    const chainId = Number(m[1]), address = m[2].toLowerCase();
    const hit = cache.get(id);
    if (hit && Date.now() - hit.at < 300_000) return hit.png;
    const own = (await db.query("select name, symbol, mc_usd, image_url from coin_list where chain_id=$1 and address=$2", [chainId, address]).catch(() => ({ rows: [] }))).rows[0];
    let card;
    if (own) {
      const img = (await db.query("select mime, data from coin_images where chain_id=$1 and coin=$2", [chainId, address]).catch(() => ({ rows: [] }))).rows[0];
      const ch = (await db.query("select change_24h_pct from coin_list where chain_id=$1 and address=$2", [chainId, address]).catch(() => ({ rows: [] }))).rows[0];
      card = { name: own.name, symbol: own.symbol, chainId, address, mc: own.mc_usd, change: ch?.change_24h_pct == null ? null : Number(ch.change_24h_pct), image: img ? `data:${img.mime};base64,${img.data.toString("base64")}` : null, own: true };
    } else {
      const e = (await db.query("select name, symbol, mcap_usd, fdv_usd, change_24h, image from ext_tokens where chain_id=$1 and address=$2", [chainId, address]).catch(() => ({ rows: [] }))).rows[0];
      if (!e) return null;
      card = { name: e.name, symbol: e.symbol, chainId, address, mc: e.mcap_usd || e.fdv_usd, mcLabel: e.mcap_usd ? "Market cap" : "FDV", change: e.change_24h == null ? null : Number(e.change_24h), image: await imageData(e.image), own: false };
    }
    const png = renderPng(coinSvg(card));
    cache.set(id, { png, at: Date.now() });
    if (cache.size > 500) cache.delete(cache.keys().next().value);
    return png;
  };
}
