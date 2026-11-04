// ElyScreener X cards: 1600×900 PNGs drawn from live numbers (SVG → PNG with resvg, bundled fonts).
// Five kinds: gainer, smart money, fresh launch, launchpad volume, feature (with the Ask AI robot).
import { Resvg } from "@resvg/resvg-js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const FONTS = ["InterDisplay-Bold", "InterDisplay-ExtraBold", "Inter-SemiBold", "Inter-Bold", "Inter-Medium"].map((f) => here(`fonts/es/${f}.otf`)).concat(here("fonts/JetBrainsMono_700Bold.ttf"));
const ROBOT = `data:image/png;base64,${readFileSync(here("assets/es-robot.png")).toString("base64")}`;

const W = 1600, H = 900;
const BG = "#0B0A14", INK = "#F4F2FF", MUT = "#A9A6C9", DIM = "#6E6A90", UP = "#2BD9A0", DOWN = "#FF5C7A";
const D = "Inter Display", T = "Inter";
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]);
const defs = `<defs>
  <linearGradient id="m" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FF4FA3"/><stop offset=".55" stop-color="#9B5CFF"/><stop offset="1" stop-color="#4CC9FF"/></linearGradient>
  <linearGradient id="mh" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#FF4FA3"/><stop offset=".55" stop-color="#9B5CFF"/><stop offset="1" stop-color="#4CC9FF"/></linearGradient>
  <radialGradient id="bg" cx="18%" cy="0%" r="110%"><stop offset="0" stop-color="#2a1650"/><stop offset=".55" stop-color="#140f2a"/><stop offset="1" stop-color="${BG}"/></radialGradient>
  <linearGradient id="fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#9B5CFF" stop-opacity=".38"/><stop offset="1" stop-color="#9B5CFF" stop-opacity="0"/></linearGradient>
  <linearGradient id="fillUp" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${UP}" stop-opacity=".30"/><stop offset="1" stop-color="${UP}" stop-opacity="0"/></linearGradient>
  <linearGradient id="fillDn" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${DOWN}" stop-opacity=".26"/><stop offset="1" stop-color="${DOWN}" stop-opacity="0"/></linearGradient>
</defs>`;
function mark(x, y, s) {
  const r = s * 0.11, g = s * 0.09, h = (s - 2 * g) / 3, w = [1, 0.72, 0.88];
  let o = "";
  for (let i = 0; i < 3; i++) o += `<rect x="${x}" y="${y + i * (h + g)}" width="${s * w[i]}" height="${h}" rx="${r}" fill="url(#m)"/>`;
  return o + `<circle cx="${x + s * 0.87}" cy="${y + h / 2}" r="${h * 0.22}" fill="${BG}"/>`;
}
function frame(inner, tag) {
  const pw = tag.length * 16.5 + 76;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${defs}
<rect width="${W}" height="${H}" fill="url(#bg)"/>
<rect x="1.5" y="1.5" width="${W - 3}" height="${H - 3}" fill="none" stroke="url(#mh)" stroke-opacity=".35" stroke-width="3"/>
${mark(80, 70, 54)}
<text x="150" y="112" font-family="${D}" font-weight="700" font-size="40" fill="${INK}" letter-spacing="-1">Ely<tspan fill="url(#mh)">Screener</tspan></text>
<rect x="${W - 80 - pw}" y="66" width="${pw}" height="52" rx="26" fill="#ffffff" fill-opacity=".06" stroke="#ffffff" stroke-opacity=".14"/>
<circle cx="${W - 80 - pw + 28}" cy="92" r="7" fill="${UP}"/>
<text x="${W - 108}" y="102" text-anchor="end" font-family="${T}" font-weight="700" font-size="21" fill="${MUT}" letter-spacing="2">${esc(tag)}</text>
${inner}
<text x="80" y="${H - 58}" font-family="${T}" font-weight="600" font-size="28" fill="#FF4FA3">elyscreener.com</text>
<text x="${W - 80}" y="${H - 58}" text-anchor="end" font-family="${T}" font-weight="500" font-size="24" fill="${DIM}">Elysium’s live screener</text>
</svg>`;
}
// round coin logo: first letter on the gradient underneath, the coin's own image (data URI) on top
function avatar(img, sym, x, y, s) {
  const letter = `<circle cx="${x + s / 2}" cy="${y + s / 2}" r="${s / 2}" fill="url(#m)"/><text x="${x + s / 2}" y="${y + s * 0.66}" text-anchor="middle" font-family="${D}" font-weight="700" font-size="${s * 0.46}" fill="#fff">${esc(String(sym || "?").replace(/^\$/, "").slice(0, 1).toUpperCase())}</text>`;
  if (!img) return letter;
  const id = `av${x}${y}`;
  return `${letter}<clipPath id="${id}"><circle cx="${x + s / 2}" cy="${y + s / 2}" r="${s / 2}"/></clipPath><image href="${img}" x="${x}" y="${y}" width="${s}" height="${s}" preserveAspectRatio="xMidYMid slice" clip-path="url(#${id})"/>`;
}
function spark(vals, x, y, w, h, up = true) {
  if (!vals || vals.length < 3) return "";
  const lo = Math.min(...vals), hi = Math.max(...vals), d = hi - lo || 1;
  const pts = vals.map((v, i) => [x + (i / (vals.length - 1)) * w, y + h - ((v - lo) / d) * h]);
  const line = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join("");
  const [lx, ly] = pts[pts.length - 1];
  const c = up ? UP : DOWN;
  return `<path d="${line}L${x + w},${y + h}L${x},${y + h}Z" fill="url(#${up ? "fillUp" : "fillDn"})"/><path d="${line}" fill="none" stroke="${c}" stroke-width="5" stroke-linejoin="round" stroke-linecap="round"/><circle cx="${lx}" cy="${ly}" r="22" fill="${c}" fill-opacity=".18"/><circle cx="${lx}" cy="${ly}" r="10" fill="${c}"/>`;
}
const stat = (x, y, label, value, color = INK) => `<text x="${x}" y="${y}" font-family="${T}" font-weight="600" font-size="22" fill="${DIM}" letter-spacing="2">${esc(label)}</text><text x="${x}" y="${y + 52}" font-family="${D}" font-weight="700" font-size="46" fill="${color}">${esc(value)}</text>`;
const safetyColor = (s) => (s === "Safe" ? UP : s === "Caution" ? "#FFC24B" : s === "Risky" ? DOWN : INK);
const fit = (s, n) => { s = String(s ?? ""); return s.length > n ? s.slice(0, n - 1) + "…" : s; };
function png(svg) {
  return new Resvg(svg, { fitTo: { mode: "width", value: W }, font: { fontFiles: FONTS, loadSystemFonts: false, defaultFontFamily: T } }).render().asPng();
}

/** c: { symbol, name, pad, change, window, mc, holders, vol, safety, series, image } */
export function gainerCard(c) {
  const up = c.change >= 0;
  const big = `${up ? "+" : ""}${Math.abs(c.change) >= 1000 ? Math.round(c.change).toLocaleString("en-US") : c.change.toFixed(1)}%`;
  const inner = `${avatar(c.image, c.symbol, 80, 180, 140)}
<text x="250" y="262" font-family="${D}" font-weight="700" font-size="64" fill="${INK}">$${esc(fit(c.symbol, 12))}</text>
<text x="252" y="306" font-family="${T}" font-weight="500" font-size="28" fill="${MUT}">${esc(fit(c.name, 24))} · ${esc(c.pad)}</text>
<text x="80" y="510" font-family="${D}" font-weight="800" font-size="${big.length > 8 ? 150 : 190}" fill="${up ? UP : DOWN}" letter-spacing="-6">${esc(big)}</text>
<text x="88" y="566" font-family="${T}" font-weight="600" font-size="28" fill="${MUT}">${esc(c.window || "last hour")}</text>
${stat(80, 650, "MARKET CAP", c.mc)}${stat(400, 650, "HOLDERS", c.holders)}${stat(680, 650, "24H VOLUME", c.vol)}${c.safety ? stat(980, 650, "SAFETY", c.safety, safetyColor(c.safety)) : ""}
${spark(c.series, 900, 190, 620, 360, up)}`;
  return png(frame(inner, c.tag || "TRENDING ON ELYSIUM"));
}

/** c: { symbol, pad, count, when, wallets: [{addr, record, buy}], image } */
export function smartCard(c) {
  const rows = (c.wallets || []).slice(0, 4).map((w, i) => `
<g transform="translate(860,${236 + i * 104})"><rect width="660" height="86" rx="18" fill="#ffffff" fill-opacity=".05" stroke="#ffffff" stroke-opacity=".10"/>
<text x="28" y="54" font-family="JetBrains Mono" font-weight="700" font-size="28" fill="${INK}">${esc(w.addr)}</text>
<text x="340" y="54" font-family="${T}" font-weight="500" font-size="22" fill="${DIM}">${esc(w.record)}</text>
<text x="632" y="54" text-anchor="end" font-family="${D}" font-weight="700" font-size="30" fill="${UP}">${esc(w.buy)}</text></g>`).join("");
  const inner = `
<text x="80" y="250" font-family="${T}" font-weight="700" font-size="26" fill="#FF4FA3" letter-spacing="3">SMART MONEY</text>
<text x="80" y="390" font-family="${D}" font-weight="800" font-size="150" fill="${INK}" letter-spacing="-5">${esc(c.count)} wallets</text>
<text x="84" y="460" font-family="${T}" font-weight="500" font-size="36" fill="${MUT}">with a winning record bought</text>
${avatar(c.image, c.symbol, 80, 520, 140)}
<text x="250" y="606" font-family="${D}" font-weight="700" font-size="64" fill="${INK}">$${esc(fit(c.symbol, 12))}</text>
<text x="252" y="650" font-family="${T}" font-weight="500" font-size="28" fill="${MUT}">${esc(c.when)} · ${esc(c.pad)}</text>
${rows}`;
  return png(frame(inner, "SMART MONEY · LIVE"));
}

/** c: { symbol, name, pad, age, holders, buys, bots, botsBad, series, image } */
export function freshCard(c) {
  const inner = `
<text x="80" y="250" font-family="${T}" font-weight="700" font-size="26" fill="#4CC9FF" letter-spacing="3">JUST LAUNCHED</text>
${avatar(c.image, c.symbol, 80, 290, 140)}
<text x="250" y="372" font-family="${D}" font-weight="700" font-size="72" fill="${INK}">$${esc(fit(c.symbol, 12))}</text>
<text x="252" y="420" font-family="${T}" font-weight="500" font-size="30" fill="${MUT}">${esc(fit(c.name, 22))} · on ${esc(c.pad)}</text>
${stat(80, 560, "AGE", c.age)}${stat(380, 560, "HOLDERS", c.holders)}${stat(680, 560, "BUYS", c.buys)}${c.bots != null ? stat(980, 560, "BOT CLUSTERS", c.bots, c.botsBad ? DOWN : INK) : ""}
${spark(c.series, 1080, 200, 440, 220, true)}`;
  return png(frame(inner, "NEW ON ELYSIUM"));
}

/** p: { title, rows: [{ name, vol, label }] } */
export function padsCard(p) {
  const max = Math.max(...p.rows.map((r) => r.vol), 1e-9);
  const rows = p.rows.slice(0, 6).map((r, i) => {
    const y = 236 + i * 92, bw = Math.max(8, (r.vol / max) * 820);
    return `<text x="80" y="${y + 44}" font-family="${D}" font-weight="700" font-size="34" fill="${DIM}">${i + 1}</text>
<text x="130" y="${y + 44}" font-family="${D}" font-weight="700" font-size="38" fill="${INK}">${esc(fit(r.name, 14))}</text>
<rect x="470" y="${y + 6}" width="${bw}" height="50" rx="12" fill="url(#mh)" fill-opacity="${(1 - i * 0.12).toFixed(2)}"/>
<text x="${470 + bw + 20}" y="${y + 44}" font-family="${D}" font-weight="700" font-size="34" fill="${INK}">${esc(r.label)}</text>`;
  }).join("");
  return png(frame(`<text x="80" y="200" font-family="${T}" font-weight="700" font-size="26" fill="#FF4FA3" letter-spacing="3">${esc(p.title)}</text>${rows}`, "LAUNCHPADS · 24H"));
}

/** f: { lines: [headline, ...], chip, tag } — the Ask AI robot on the right */
export function featureCard(f) {
  const lines = f.lines.map((l, i) => `<text x="80" y="${300 + i * 92}" font-family="${D}" font-weight="700" font-size="${i ? 52 : 84}" fill="${i ? MUT : INK}" letter-spacing="-2">${esc(l)}</text>`).join("");
  const chip = f.chip ? `<g transform="translate(80,${330 + f.lines.length * 92})"><rect width="${f.chip.length * 19 + 64}" height="72" rx="36" fill="#ffffff"/><text x="32" y="47" font-family="${T}" font-weight="600" font-size="30" fill="#14102a">${esc(f.chip)}</text></g>` : "";
  const robot = `<circle cx="1270" cy="480" r="290" fill="#9B5CFF" fill-opacity=".14"/><circle cx="1270" cy="480" r="200" fill="#FF4FA3" fill-opacity=".08"/><image href="${ROBOT}" x="1086" y="170" width="367" height="600" preserveAspectRatio="xMidYMid meet"/>`;
  return png(frame(robot + lines + chip, f.tag || "ASK AI"));
}

/** "@elyscreener check $XYZ": c: { symbol, name, pad, score, label, why: [], mc, holders, top10, bots, dev, smart, change, image } */
export function checkCard(c) {
  const col = safetyColor(c.label);
  const why = (c.why || []).slice(0, 3);
  const whyRows = why.length
    ? why.map((w, i) => `<text x="80" y="${640 + i * 46}" font-family="${T}" font-weight="600" font-size="30" fill="${MUT}">· ${esc(fit(w, 34))}</text>`).join("")
    : `<text x="80" y="640" font-family="${T}" font-weight="600" font-size="30" fill="${MUT}">· nothing alarming on-chain</text>`;
  const cells = [["MARKET CAP", c.mc, INK], ["HOLDERS", c.holders, INK], ["TOP 10 HOLD", c.top10, INK], ["BOT CLUSTERS", c.bots, c.botsBad ? DOWN : INK], ["CREATOR", c.dev, c.devBad ? DOWN : INK], ["SMART WALLETS 24H", c.smart, c.smartN ? UP : INK]]
    .map(([k, v, cc], i) => stat(860 + (i % 2) * 360, 210 + Math.floor(i / 2) * 150, k, v ?? "—", cc)).join("");
  const inner = `${avatar(c.image, c.symbol, 80, 180, 120)}
<text x="230" y="250" font-family="${D}" font-weight="700" font-size="58" fill="${INK}">$${esc(fit(c.symbol, 12))}</text>
<text x="232" y="292" font-family="${T}" font-weight="500" font-size="26" fill="${MUT}">${esc(fit(c.name, 22))} · ${esc(c.pad)}</text>
<text x="80" y="420" font-family="${T}" font-weight="700" font-size="24" fill="${DIM}" letter-spacing="3">SAFETY CHECK</text>
<text x="76" y="540" font-family="${D}" font-weight="800" font-size="130" fill="${col}" letter-spacing="-4">${esc(c.label || "—")}</text>
<text x="${80 + (c.label || "—").length * 72}" y="540" font-family="${D}" font-weight="700" font-size="44" fill="${DIM}">${c.score != null ? `${c.score}/100` : ""}</text>
${whyRows}
<line x1="800" y1="190" x2="800" y2="760" stroke="#ffffff" stroke-opacity=".08" stroke-width="2"/>
${cells}`;
  return png(frame(inner, "COIN CHECK"));
}

/** A short ranked list (answers like "what's pumping"): l: { title, tag, rows: [{ symbol, sub, value, up, image }] } */
export function listCard(l) {
  const rows = l.rows.slice(0, 4).map((r, i) => {
    const y = 230 + i * 128;
    return `<rect x="80" y="${y}" width="${W - 160}" height="108" rx="22" fill="#ffffff" fill-opacity=".045" stroke="#ffffff" stroke-opacity=".09"/>
<text x="120" y="${y + 70}" font-family="${D}" font-weight="700" font-size="40" fill="${DIM}">${i + 1}</text>
${avatar(r.image, r.symbol, 180, y + 18, 72)}
<text x="280" y="${y + 52}" font-family="${D}" font-weight="700" font-size="40" fill="${INK}">${esc(fit(r.symbol, 18))}</text>
<text x="282" y="${y + 88}" font-family="${T}" font-weight="500" font-size="24" fill="${MUT}">${esc(fit(r.sub, 60))}</text>
<text x="${W - 120}" y="${y + 70}" text-anchor="end" font-family="${D}" font-weight="800" font-size="48" fill="${r.up === false ? DOWN : r.up ? UP : INK}">${esc(r.value)}</text>`;
  }).join("");
  return png(frame(`<text x="80" y="196" font-family="${T}" font-weight="700" font-size="26" fill="#FF4FA3" letter-spacing="3">${esc(l.title)}</text>${rows}`, l.tag || "LIVE ON ELYSIUM"));
}
