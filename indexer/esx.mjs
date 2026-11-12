// ElyScreener on X: posts live Elysium data as image cards, tagging the coin's own X account so the
// coin's team and holders see it (and share it). It replies only when someone tags it themselves
// ("@elyscreener check $BLOB" → a coin check card under their post); never follows, never likes. Each post is a short human-sounding line + a 1600×900 card; the link
// goes in a reply under it (X shows posts with an outside link to fewer people).
//
// Runs as its own Railway service: root /indexer, start command `node esx.mjs`.
// Env:
//   ES_X_API_KEY, ES_X_API_SECRET, ES_X_ACCESS_TOKEN, ES_X_ACCESS_SECRET   the ElyScreener app's keys
//   DATABASE_URL     the same Postgres as the indexer (reads coins/trades, remembers what was posted)
//   ELYSIUM_RPC      comma list of Elysium nodes (to read a coin's metadata for its X account)
//   ES_BUYBACK_WALLETS  Ascend's buyback wallet(s), comma-separated (from Nov 9). Each new buyback → a post with a
//                    card tagging ES_BUYBACK_X (default @AscendLaunch); also "/buybacks" on Telegram and answers on X.
//   ES_PAD_X         optional, launchpads' X handles: "Boxa=@boxa_club,Kleos=@kleosfun"
//   ES_X_DRY=1       log + save the cards to /tmp/esx, post nothing      ES_X_OFF=1   switch off
//   ES_X_NOW=1       post one right away on start (for a first test)
//   ES_X_LINK_REPLY=1  also reply under each post with the chart link (costs a second post each time)
//   Threads: ten a day through Nov 15 (TR), then one at 20:40; each day's ten use ten different themes (THEMES).
//   ES_X_DAILY_MAX   most posts per day (e.g. 16 on X's free plan); the day's slots are thinned evenly
//   ES_X_REPLIES=0   switch off answering "@elyscreener check $XYZ"   ES_X_REPLY_MAX  answers per day (300)
//   ES_X_USER_ID     the ElyScreener account's numeric id (else looked up once at start)
//   CF_ACCOUNT_ID, CF_AI_TOKEN   Cloudflare Workers AI: understand questions in any language and answer in
//                    that language (see esask.mjs). Without them answers are English templates.
//   ES_TG_TOKEN      Telegram bot token (from @BotFather): the same answers in Telegram. Groups add the bot;
//                    it answers "/check $BLOB", messages that mention it, and replies to it. Free (no per-message cost).
//   Nov 9–10 (TR) the daily answer cap rises to ES_X_REPLY_MAX_LAUNCH (1000) and 5 per person.
// Costs (X pay-per-use, Oct 2026): a post without a link $0.015, with a link $0.20, an answer to someone who
// tagged us $0.01, each mention read $0.001. So no links in the text: the card shows elyscreener.com.
// If X answers "too many requests" (daily limit), it waits until X says the limit resets.
//
// Schedule (Türkiye time): 04:15–12:00 every 30–45 min (gaps vary), 12:00–15:00 two posts,
// 15:00–23:20 every 25–45 min, 23:20–04:15 two posts. Different every day. The same coin is not
// posted twice within 6 hours; if there's nothing fresh worth posting, the slot is skipped.

import { createHmac, randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import pg from "pg";
import { checkCard, featureCard, freshCard, gainerCard, listCard, padsCard, smartCard } from "./escards.mjs";
import { classify, phrase, writePost, xLength, KB } from "./esask.mjs";

const TR = 3 * 3600e3;
const SITE = "elyscreener.com";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString(), "esx:", ...a);
const env = (k) => (process.env[k] || "").trim();
const DRY = env("ES_X_DRY") === "1";
const KEYS = { apiKey: env("ES_X_API_KEY"), apiSecret: env("ES_X_API_SECRET"), accessToken: env("ES_X_ACCESS_TOKEN"), accessSecret: env("ES_X_ACCESS_SECRET") };
const RPCS = env("ELYSIUM_RPC").split(",").map((s) => s.trim()).filter(Boolean);
const PAD_X = Object.fromEntries(env("ES_PAD_X").split(",").map((p) => p.split("=").map((s) => s.trim())).filter((p) => p[0] && /^@\w{1,15}$/.test(p[1] || "")).map(([k, v]) => [k.toLowerCase(), v]));
const MAINNET = Date.UTC(2026, 10, 9, 0, 0); // Nov 9, 2026
// Nov 12: general mode (default). The account posts about ElyScreener as a whole (every chain, buying, selling,
// launching, the tools), not about Elysium alone. ES_X_GENERAL=0 brings the old Elysium data posts back.
const GENERAL = env("ES_X_GENERAL") !== "0";

// ------------------------------------------------------------------ X API (OAuth 1.0a, user context)
const enc = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
function oauth(method, url) {
  const o = { oauth_consumer_key: KEYS.apiKey, oauth_nonce: randomBytes(16).toString("hex"), oauth_signature_method: "HMAC-SHA1", oauth_timestamp: String(Math.floor(Date.now() / 1000)), oauth_token: KEYS.accessToken, oauth_version: "1.0" };
  const u = new URL(url);
  const params = [...Object.entries(o), ...u.searchParams.entries()].map(([k, v]) => [enc(k), enc(v)]).sort((a, b) => (a[0] === b[0] ? (a[1] < b[1] ? -1 : 1) : a[0] < b[0] ? -1 : 1));
  const base = [method, enc(`${u.origin}${u.pathname}`), enc(params.map(([k, v]) => `${k}=${v}`).join("&"))].join("&");
  const sig = createHmac("sha1", `${enc(KEYS.apiSecret)}&${enc(KEYS.accessSecret)}`).update(base).digest("base64");
  return "OAuth " + Object.entries({ ...o, oauth_signature: sig }).map(([k, v]) => `${enc(k)}="${enc(v)}"`).join(", ");
}
async function uploadImage(buf) {
  // v2 media upload first, the older v1.1 endpoint as a fallback
  const tries = [
    ["https://api.x.com/2/media/upload", (j) => j?.data?.id ?? j?.id ?? j?.media_id_string],
    ["https://upload.twitter.com/1.1/media/upload.json", (j) => j?.media_id_string],
  ];
  let last;
  for (const [url, pick] of tries) {
    try {
      const fd = new FormData();
      fd.append("media", new Blob([buf], { type: "image/png" }), "card.png");
      fd.append("media_category", "tweet_image");
      const r = await fetch(url, { method: "POST", headers: { authorization: oauth("POST", url) }, body: fd });
      const t = await r.text();
      if (!r.ok) throw new Error(`${url} ${r.status}: ${t.slice(0, 200)}`);
      const id = pick(JSON.parse(t));
      if (id) return String(id);
      throw new Error(`no media id: ${t.slice(0, 200)}`);
    } catch (e) { last = e; }
  }
  throw last;
}
// X allows only one $CASHTAG per post: keep the first, the rest lose their "$"
function oneCashtag(text) {
  // a ticker with a symbol inside ("e/acc", "pepe.hl", "a-b") isn't a cashtag: X would read "$e" and show Ethereum
  text = text.replace(/\$([A-Za-z0-9_]+)(?=[\/\-.'’][A-Za-z0-9])/g, "$1");
  let seen = false;
  return text.replace(/\$([A-Za-z][A-Za-z0-9_]{0,14})\b/g, (m, sym) => (seen ? sym : ((seen = true), m)));
}
async function tweet(text, { mediaId, replyTo } = {}) {
  text = oneCashtag(text);
  const url = "https://api.x.com/2/tweets";
  const body = { text, ...(mediaId ? { media: { media_ids: [mediaId] } } : {}), ...(replyTo ? { reply: { in_reply_to_tweet_id: replyTo } } : {}) };
  const r = await fetch(url, { method: "POST", headers: { authorization: oauth("POST", url), "content-type": "application/json" }, body: JSON.stringify(body) });
  const t = await r.text();
  if (r.status === 429) {
    const reset = Number(r.headers.get("x-user-limit-24hour-reset") || r.headers.get("x-app-limit-24hour-reset") || r.headers.get("x-rate-limit-reset")) || 0;
    blockedUntil = reset ? reset * 1000 : Date.now() + 3 * 3600e3;
    throw new Error(`X limit reached, posting again after ${new Date(blockedUntil + TR).toISOString().slice(0, 16).replace("T", " ")} TR`);
  }
  if (!r.ok) throw new Error(`X /2/tweets ${r.status}: ${t.slice(0, 300)}`);
  return JSON.parse(t)?.data?.id ?? null;
}

let blockedUntil = 0;
// ------------------------------------------------------------------ schedule
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32); }
const pick = (r, a) => a[Math.floor(r() * a.length)];
/** All post times (UTC ms) for one Türkiye calendar day. */
function slotsFor(dayTR) {
  const [y, m, d] = dayTR.split("-").map(Number);
  const at = (h, min) => Date.UTC(y, m - 1, d, h, min) - TR;
  const r = rng(y * 10000 + m * 100 + d);
  const out = [];
  // night: two posts between 23:20 and 04:15 (this day's early hours)
  out.push(at(0, 30 + Math.floor(r() * 30)), at(2, 20 + Math.floor(r() * 40)));
  // morning: 04:15 → 12:00, gaps of 30–45 min
  for (let t = at(4, 15) + Math.floor(r() * 6) * 60e3; t < at(12, 0); t += pick(r, [30, 35, 37, 40, 42, 45]) * 60e3) out.push(t);
  // midday: two posts, about 1.5 h apart
  out.push(at(12, 40) + Math.floor(r() * 15) * 60e3, at(14, 10) + Math.floor(r() * 15) * 60e3);
  // afternoon/evening (US awake): 15:00 → 23:20, gaps of 25–45 min
  for (let t = at(15, 0) + Math.floor(r() * 8) * 60e3; t < at(23, 20); t += pick(r, [25, 30, 35, 38, 40, 45]) * 60e3) out.push(t);
  return out.sort((a, b) => a - b);
}
const trDay = (ms) => new Date(ms + TR).toISOString().slice(0, 10);
/** The day's slots, thinned evenly when a daily cap is set (keeps the morning/evening shape). */
function plan(day) {
  const all = slotsFor(day), cap = Number(env("ES_X_DAILY_MAX")) || 14; // Nov 11: 14 single posts a day (10 market posts + 4 Auto Trade / trading posts) plus 10 threads = 24
  if (!cap || cap >= all.length) return all;
  return Array.from({ length: cap }, (_, i) => all[Math.floor(((i + 0.5) * all.length) / cap)]);
}
/** Threads: through THREAD_BUSY_UNTIL (TR days) ten a day spread over the day, after that one at 20:40 TR. */
const THREAD_BUSY_UNTIL = "2026-11-15";
function threadTimes(day) {
  const [y, m, d] = day.split("-").map(Number);
  const at = (h, min) => Date.UTC(y, m - 1, d, h, min) - TR;
  const r = rng(y * 10000 + m * 100 + d + 7);
  if (env("ES_X_THREADS") === "0") return []; // threads off
  // Nov 11: ten threads a day, spread from late morning to late evening TR, between the single posts; minutes differ each day
  return [[9, 40], [11, 10], [12, 50], [14, 20], [15, 50], [17, 20], [18, 50], [20, 20], [21, 40], [23, 0]].map(([h, mi]) => at(h, mi + Math.floor(r() * 20)));
}
/** Which theme a thread time gets: each day every theme once, the order shifts from day to day. */
function themeFor(at) {
  const day = trDay(at), i = threadTimes(day).findIndex((t) => Math.abs(t - at) < 60e3);
  return (Math.max(i, 0) + Math.floor(Date.parse(day) / 86400e3)) % THEMES.length;
}
function nextThread(now) {
  for (const off of [0, 1]) { const t = threadTimes(trDay(now + off * 86400e3)).find((x) => x > now + 5e3); if (t) return t; }
  return now + 86400e3;
}
function nextSlot(now) {
  for (const off of [0, 1]) {
    const s = plan(trDay(now + off * 86400e3)).find((t) => t > now + 5e3);
    if (s) return s;
  }
  return now + 40 * 60e3;
}

// ------------------------------------------------------------------ data
let pool;
let hype = 0;
const usd = (h) => (Number(h) || 0) * hype;
const money = (v) => (v >= 1e6 ? `$${(v / 1e6).toFixed(2)}M` : v >= 1e3 ? `$${(v / 1e3).toFixed(1)}K` : `$${Math.round(v)}`);
const count = (n) => (n >= 1e4 ? `${(n / 1e3).toFixed(1)}K` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : String(n));
const short = (a) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const padName = (p) => (p && p !== "Other" ? p : "Elysium");
const ago = (t) => { const m = Math.max(1, Math.round((Date.now() - new Date(t).getTime()) / 60e3)); return m < 60 ? `${m} min` : `${Math.round(m / 60)}h`; };

async function q(sql, args = []) { return (await pool.query(sql, args)).rows; }
async function loadHype() {
  const r = await q(`select v from ely_meta where k = 'hype_usd' limit 1`).catch(() => []);
  const v = r[0]?.v;
  const n = typeof v === "number" ? v : Number(v?.usd ?? v?.price ?? v);
  if (n > 0) hype = n;
}
async function recentTokens(hours = 6) {
  return (await q(`select token from es_x_posts where token is not null and at > now() - make_interval(hours => $1)`, [hours])).map((r) => r.token);
}
async function safetyOf(token) {
  const r = await q(`select score, bots_pct from es_safety_cache where token = $1`, [token]).catch(() => []);
  if (!r[0]) return { label: null, bots: null };
  const s = Number(r[0].score);
  return { label: s >= 80 ? "Safe" : s >= 50 ? "Caution" : "Risky", score: s, bots: r[0].bots_pct == null ? null : Number(r[0].bots_pct) };
}
async function series(token, hours = 24, n = 48) {
  const rows = await q(`select extract(epoch from at) * 1000 as t, price_hype p from ely_trades where token = $1 and at > now() - make_interval(hours => $2) and price_hype > 0 order by at`, [token, hours]).catch(() => []);
  if (rows.length < 3) return null;
  const t0 = Number(rows[0].t), t1 = Number(rows[rows.length - 1].t), step = (t1 - t0) / (n - 1) || 1;
  const out = []; let i = 0, last = Number(rows[0].p);
  for (let k = 0; k < n; k++) { const edge = t0 + k * step; while (i < rows.length && Number(rows[i].t) <= edge) last = Number(rows[i++].p); out.push(last); }
  return out;
}
// a coin's logo as a data URI (png / jpeg / gif / webp), or null
async function logo(url) {
  if (!url) return null;
  try {
    const u = /^https?:\/\//.test(url) ? url : url.startsWith("ipfs://") ? url.replace("ipfs://", "https://ipfs.io/ipfs/") : `https://arkhampad.com${url.startsWith("/") ? "" : "/"}${url}`;
    const r = await fetch(u, { signal: AbortSignal.timeout(7000), headers: { "user-agent": "Mozilla/5.0" } });
    if (!r.ok) return null;
    const b = Buffer.from(await r.arrayBuffer());
    if (b.length > 2_500_000) return null;
    const type = b[0] === 0x89 ? "png" : b[0] === 0xff ? "jpeg" : b.slice(0, 3).toString() === "GIF" ? "gif" : b.slice(8, 12).toString() === "WEBP" ? "webp" : null;
    return type ? `data:image/${type};base64,${b.toString("base64")}` : null;
  } catch { return null; }
}
// the coin's own X account, from its metadata (top level or nested under extensions/links/socials)
const handleCache = new Map();
async function xHandle(t) {
  if (handleCache.has(t.address)) return handleCache.get(t.address);
  let h = null;
  try {
    let uri = t.uri;
    if (!uri && RPCS.length) {
      const r = await fetch(RPCS[0], { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to: t.address, data: "0x3c130d90" }, "latest"] }), signal: AbortSignal.timeout(6000) });
      const hex = (await r.json())?.result;
      if (hex && hex.length > 130) { const len = parseInt(hex.slice(66, 130), 16); uri = Buffer.from(hex.slice(130, 130 + len * 2), "hex").toString(); }
    }
    let j = null;
    if (uri?.startsWith("data:application/json")) { const body = uri.slice(uri.indexOf(",") + 1); j = JSON.parse(uri.includes(";base64,") ? Buffer.from(body, "base64").toString() : decodeURIComponent(body)); }
    else if (uri && /^(https?|ipfs):\/\//.test(uri)) { const r = await fetch(uri.replace(/^ipfs:\/\//, "https://ipfs.io/ipfs/"), { signal: AbortSignal.timeout(6000) }); if (r.ok) j = await r.json(); }
    if (j) {
      const nests = [j, j.extensions, j.links, j.socials].filter((o) => o && typeof o === "object");
      let x = null;
      for (const o of nests) for (const k of ["twitter", "x", "twitter_url"]) if (!x && typeof o[k] === "string") x = o[k];
      const m = x?.match(/(?:x|twitter)\.com\/@?([A-Za-z0-9_]{1,15})(?:[/?#]|$)/i) || x?.match(/^@?([A-Za-z0-9_]{1,15})$/);
      if (m && !/^(i|home|intent|share|search)$/i.test(m[1])) h = `@${m[1]}`;
    }
  } catch {}
  handleCache.set(t.address, h);
  return h;
}

// ------------------------------------------------------------------ words (lowercase, short, human)
const TAGS = ["#Elysium", "#HYPE", "#Hyperliquid", "#Kinetiq", "#memecoin", "#altcoins", "#crypto", "#onchain", "#DeFi", "#SmartMoney", "#Trading", "#DEX", "#Whales", "#CryptoTrading", "#Layer2", "#CryptoNews", "#GemHunter", "#Altseason", "#Web3", "#MemeSeason", "#CopyTrading", "#AutoTrade"];
/** n hashtags, none twice; `avoid` is a Set of tags a thread already used (each post of a thread gets its own). */
function tags(r, n = 2, must, avoid, pool) { const a = must && !(avoid && avoid.has(must)) ? [must] : []; let guard = 0; while (a.length < n && guard++ < 200) { const t = pick(r, pool || TAGS); if (!a.includes(t) && !(avoid && avoid.has(t))) a.push(t); } if (avoid) a.forEach((t) => avoid.add(t)); return a.join(" "); }
// Nov 11: every third post (and every third thread opener) also tags the four ecosystem accounts
const ECO = "@Enter_Elysium @HyperliquidX @Kinetiq_xyz @0xOmnia";
let tagTurn = 0;
const ecoNow = () => tagTurn++ % 3 === 0;
/** Adds the account line and 4 hashtags to a post: as many as fit in 280 characters, the accounts dropped first, then hashtags one by one. */
function attach(text, eco, tagSet) {
  const hs = tagSet.split(" ").filter(Boolean);
  for (const withEco of eco ? [true, false] : [false]) for (let k = hs.length; k >= 0; k--) {
    const extra = [withEco ? ECO : "", hs.slice(0, k).join(" ")].filter(Boolean).join("\n\n");
    const t = extra ? `${text}\n\n${extra}` : text;
    if (xLength(t) <= 280) return t;
  }
  return text;
}
const nl = (...l) => l.filter((x) => x != null && x !== false).join("\n");
const W = {
  gainer: [
    (d) => nl(`$${d.sym} up ${d.pct} ${d.win} and holders keep coming in. ${d.holders} now`, "", d.x ? `who's still sleeping on ${d.x} 👀` : `who's still sleeping on this one 👀`),
    (d) => nl(`${d.pct} ${d.win}. $${d.sym} on ${d.pad} is the one moving right now`, "", d.x ? `${d.x} cooking` : null),
    (d) => nl(`biggest mover on Elysium ${d.win === "in the last hour" ? "this hour" : "today"}: $${d.sym} ${d.pct}`, `mc ${d.mc}, ${d.holders} holders`, d.x),
    (d) => nl(`$${d.sym} just did ${d.pct} ${d.win}`, "", `chart's not subtle 📈 ${d.x || ""}`.trim()),
    (d) => nl(`ok $${d.sym} is ripping. ${d.pct} ${d.win}, ${d.holders} holders`, d.safety === "Safe" ? "and it scores safe on our checks, which is rare" : null, d.x),
    (d) => nl(`top of the board on Elysium rn → $${d.sym} ${d.pct}`, d.x ? `gm ${d.x}` : null),
  ],
  smart: [
    (d) => nl(`${d.n} wallets that have been right most of the time all bought $${d.sym} in the last ${d.when}`, "", `not saying anything. just saying 👀 ${d.x || ""}`.trim()),
    (d) => nl(`smart money is in $${d.sym}. ${d.n} wallets with a winning record, ${d.total} in`, d.x),
    (d) => nl(`noticed ${d.n} of the best traders on Elysium buying the same coin`, `$${d.sym} on ${d.pad} ${d.x || ""}`.trim()),
    (d) => nl(`when wallets with this kind of record pile into one coin we post it`, "", `$${d.sym}, ${d.n} wallets, last ${d.when} ${d.x || ""}`.trim()),
  ],
  fresh: [
    (d) => nl(`$${d.sym} went live on ${d.padX || d.pad} ${d.age} ago. ${d.holders} holders already${d.bots != null ? `, only ${d.bots} sitting in bot clusters` : ""}`, "", `early ones always look like this ${d.x || ""}`.trim()),
    (d) => nl(`new on Elysium: $${d.sym}`, `${d.age} old, ${d.holders} holders, ${d.buys} buys`, d.x),
    (d) => nl(`fresh one on ${d.padX || d.pad} getting real attention`, `$${d.sym} · ${d.holders} holders in ${d.age} ${d.x || ""}`.trim()),
    (d) => nl(`${d.age} old and already ${d.holders} holders. $${d.sym} is off to a fast start`, d.x),
  ],
  launched: [
    (d) => nl(`$${d.sym} was just launched on ElyScreener ${d.age} ago`, `${d.holders} holders already, mc ${d.mc}`, "", `launch yours in one tap → elyscreener.com ${d.x || ""}`.trim()),
    (d) => nl(`new coin on Elysium, launched right on ElyScreener: $${d.sym}`, `${d.age} old, ${d.holders} holders`, "", `anyone can do this, takes a minute 👀`),
    (d) => nl(`$${d.sym} just went live from ElyScreener's launch page`, `${d.holders} holders, mc ${d.mc}. creators earn up to 60% of the trade fees`, d.x),
  ],
  pads: [
    (d) => nl(`last 24h on Elysium, by launchpad:`, "", ...d.top3, "", d.tags ? `${d.tags} who takes #1 tomorrow?` : `who takes #1 tomorrow?`),
    (d) => nl(`launchpad volume, last 24h 👇`, "", ...d.top3, "", `${d.lead} still on top.${d.tags ? ` ${d.tags}` : ""}`),
    (d) => nl(`where Elysium traded today:`, "", ...d.top3, "", `full board live on ElyScreener`),
  ],
};
const FEATURES = [
  { card: { lines: ["Launch your coin.", "On Elysium. In one tap.", "Creators earn up to 60%."], chip: "Launch on ElyScreener", tag: "LAUNCH" },
    text: [() => nl(`you can launch a coin on Elysium straight from ElyScreener now`, "", `name, picture (or let AI make it), one tap. creators earn up to 60% of the trade fees`), () => nl(`new on ElyScreener: launch your own Elysium coin`, `promote it in the same flow if you want. elyscreener.com`)] },
  { card: { lines: ["Is this coin safe?", "Just ask.", "Every Elysium coin, one tap."], chip: "Ask AI on ElyScreener", tag: "ASK AI" },
    text: [() => nl(`you can literally ask ElyScreener "is this coin safe?" and it tells you`, "", `holders, bot clusters, dev selling, all of it. any coin on Elysium`), () => nl(`new thing: Ask AI`, `type a coin, ask anything. it reads the chain for you`)] },
  { card: { lines: ["Safe. Caution. Risky.", "Every coin, scored.", "Updated every 15 min."], chip: "Safety labels", tag: "SAFETY" },
    text: [() => nl(`every coin on Elysium gets a safety label on ElyScreener`, `safe / caution / risky, from holders, bots, dev selling. rechecked every 15 min`), () => nl(`before you ape, look at the label. that's it, that's the tweet`)] },
  { card: { lines: ["Who's really holding?", "Bot clusters, exposed.", "% of supply, every coin."], chip: "Holder bubble map", tag: "BOT CLUSTERS" },
    text: [() => nl(`3 wallets buying in the same block isn't a community, it's a bundle`, "", `ElyScreener shows what % of every coin sits in bot clusters`), () => nl(`ever wonder how much of a coin is just one guy with 20 wallets? we show it`)] },
  { card: { lines: ["Every coin on Elysium.", "Every launchpad.", "Live."], chip: "elyscreener.com", tag: "LIVE ON ELYSIUM" },
    text: [() => nl(`every coin on Elysium. every launchpad. live`, "", `basically Elysium's dexscreener, built for this chain from day one`), () => nl(`Boxa, Kleos, ElysPump and the rest, one screen`, `that's ElyScreener`)] },
  { card: { lines: ["Set an alarm.", "+50%. −30%. Dev sells.", "No account needed."], chip: "Alarms & favorites", tag: "ALARMS" },
    text: [() => nl(`put a bell on any Elysium coin`, `pump, dump, dev selling, big buy. you get pinged. no sign up`)] },
];

// ------------------------------------------------------------------ the posts
/* keep fake-looking movers out of every post: no stablecoin/major look-alikes, no absurd % from a dust price, real volume */
const SANE = `and upper(symbol) not in ('USDC','USDT','USDE','DAI','ETH','WETH','BTC','WBTC','HYPE','WHYPE','SOL','BNB') and coalesce(change24, 0) < 5000 and coalesce(change1h, 0) < 5000`;
async function gainer(r) {
  const skip = await recentTokens(6);
  const rows = await q(`select address, name, symbol, image, uri, launchpad, mcap_hype, vol24_hype, change1h, change24, holders from ely_tokens
    where last_trade_at > now() - interval '3 hours' and holders >= 25 and coalesce(mcap_hype, 0) * $1 >= 3000 and coalesce(vol24_hype, 0) * $1 >= 500 ${SANE} and not (address = any($2))
    order by greatest(coalesce(change1h, 0) * 1.6, coalesce(change24, 0)) desc limit 12`, [hype || 1, skip]);
  for (const t of rows) {
    const h1 = Number(t.change1h) || 0, d1 = Number(t.change24) || 0;
    const [chg, win] = h1 >= 15 ? [h1, "in the last hour"] : d1 >= 25 ? [d1, "today"] : [0, null];
    if (!win) continue;
    const s = await safetyOf(t.address);
    if (s.label === "Risky") continue; // don't push likely rugs
    const x = await xHandle(t);
    const d = { sym: t.symbol, pct: `+${chg >= 1000 ? Math.round(chg).toLocaleString("en-US") : chg.toFixed(chg >= 100 ? 0 : 1)}%`, win, pad: padName(t.launchpad), mc: money(usd(t.mcap_hype)), holders: count(t.holders), x, safety: s.label };
    const card = gainerCard({ symbol: t.symbol, name: t.name, pad: padName(t.launchpad), change: chg, window: win === "today" ? "last 24h" : "last hour", mc: d.mc, holders: d.holders, vol: money(usd(t.vol24_hype)), safety: s.label, series: await series(t.address, win === "today" ? 24 : 3), image: await logo(t.image) });
    return { kind: "gainer", token: t.address, tpl: Math.floor(r() * W.gainer.length), d, card };
  }
  return null;
}
async function smart(r) {
  const skip = await recentTokens(6);
  const rows = await q(`select token, count(distinct trader)::int n, sum(hype) h, max(at) last, min(at) first, json_agg(json_build_object('trader', trader, 'hype', hype, 'winrate', winrate, 'coins', coins) order by hype desc) w
    from es_smart_buys(2) where at > now() - interval '90 minutes' and not (token = any($1)) group by token having count(distinct trader) >= 2 order by 2 desc, 4 desc limit 3`, [skip]).catch((e) => { log("smart:", e.message); return []; });
  const g = rows[0];
  if (!g) return null;
  const t = (await q(`select address, name, symbol, image, uri, launchpad from ely_tokens where lower(address) = $1`, [g.token]))[0];
  if (!t) return null;
  const seen = new Set();
  const wallets = g.w.filter((w) => !seen.has(w.trader) && seen.add(w.trader)).slice(0, 4).map((w) => {
    const wr = Number(w.winrate) || 0, pctw = Math.round(wr > 1 ? wr : wr * 100);
    return { addr: short(w.trader), record: pctw ? `${pctw}% win rate` : `${w.coins || ""} coins`, buy: money(usd(w.hype)) };
  });
  const mins = Math.max(5, Math.ceil((Date.now() - new Date(g.first).getTime()) / 60e3 / 5) * 5);
  const when = mins >= 60 ? "hour" : `${mins} min`;
  const x = await xHandle(t);
  const d = { sym: t.symbol, n: g.n, when, total: money(usd(g.h)), pad: padName(t.launchpad), x };
  const card = smartCard({ symbol: t.symbol, pad: padName(t.launchpad), count: g.n, when: `last ${when}`, wallets, image: await logo(t.image) });
  return { kind: "smart", token: t.address, tpl: Math.floor(r() * W.smart.length), d, card };
}
async function fresh(r) {
  const skip = await recentTokens(12);
  const rows = await q(`select address, name, symbol, image, uri, launchpad, created_at, holders, buys24 from ely_tokens
    where created_at > now() - interval '90 minutes' and holders >= 30 and buys24 >= 25 and not (address = any($1)) order by holders desc limit 5`, [skip]);
  for (const t of rows) {
    const s = await safetyOf(t.address);
    if (s.label === "Risky") continue;
    const x = await xHandle(t);
    const bots = s.bots == null ? null : `${Math.round(s.bots)}%`;
    const d = { sym: t.symbol, pad: padName(t.launchpad), padX: PAD_X[String(t.launchpad || "").toLowerCase()], age: ago(t.created_at), holders: count(t.holders), buys: count(t.buys24), bots, x };
    const card = freshCard({ symbol: t.symbol, name: t.name, pad: padName(t.launchpad), age: d.age, holders: d.holders, buys: d.buys, bots, botsBad: (s.bots ?? 0) >= 30, series: await series(t.address, 2, 30), image: await logo(t.image) });
    return { kind: "fresh", token: t.address, tpl: Math.floor(r() * W.fresh.length), d, card };
  }
  return null;
}
async function launched(r) {
  // coins made on ElyScreener's own launch page (the newest one that has not been posted yet)
  const skip = await recentTokens(48);
  const rows = await q(`select address, name, symbol, image, uri, launchpad, created_at, holders, buys24, mcap_hype from ely_tokens
    where launchpad = 'ElyScreener' and address <> '0xafc9e0d3e5493885d8d75e09ef751ed3a235de8a' and created_at > now() - interval '4 hours' and not (address = any($1)) order by created_at desc limit 5`, [skip]);
  for (const t of rows) {
    const s = await safetyOf(t.address);
    if (s.label === "Risky") continue;
    const x = await xHandle(t);
    const d = { sym: t.symbol, age: ago(t.created_at), holders: count(t.holders || 0), mc: money(usd(t.mcap_hype)), x };
    const card = freshCard({ symbol: t.symbol, name: t.name, pad: "ElyScreener", age: d.age, holders: d.holders, buys: count(t.buys24 || 0), bots: null, botsBad: false, series: await series(t.address, 2, 30), image: await logo(t.image) });
    return { kind: "launched", token: t.address, tpl: Math.floor(r() * W.launched.length), d, card };
  }
  return null;
}
async function pads(r) {
  const done = await q(`select 1 from es_x_posts where kind = 'pads' and at > now() - interval '20 hours'`);
  if (done.length) return null;
  const rows = await q(`select launchpad pad, sum(vol24_hype) v from ely_tokens where launchpad is not null and launchpad <> 'Other' group by 1 having sum(vol24_hype) > 0 order by 2 desc limit 6`);
  if (rows.length < 3) return null;
  const list = rows.map((x) => ({ name: x.pad, vol: usd(x.v), label: money(usd(x.v)) }));
  const tagged = list.slice(0, 4).map((x) => PAD_X[x.name.toLowerCase()]).filter(Boolean).join(" ");
  const d = { top3: list.slice(0, 3).map((x) => `${x.name} ${x.label}`), lead: list[0].name, tags: tagged };
  const card = padsCard({ title: "LAUNCHPAD VOLUME · LAST 24H", rows: list });
  return { kind: "pads", token: null, tpl: Math.floor(r() * W.pads.length), d, card };
}
async function feature(r) {
  const last = (await q(`select tpl from es_x_posts where kind = 'feature' order by at desc limit 3`)).map((x) => x.tpl);
  const idx = [...FEATURES.keys()].filter((i) => !last.includes(i));
  const i = idx.length ? pick(r, idx) : Math.floor(r() * FEATURES.length);
  const f = FEATURES[i];
  let text = pick(r, f.text)();
  const days = Math.ceil((MAINNET - Date.now()) / 86400e3);
  if (days >= 1 && days <= 6 && r() < 0.5) text += `\n\n${pick(r, ["@Enter_Elysium", "Elysium"])} mainnet in ${days} day${days > 1 ? "s" : ""} 🔥`;
  else if (r() < 0.2) text += "\n\n@Enter_Elysium";
  return { kind: "feature", token: null, tpl: i, text, card: featureCard(f.card) };
}


// ------------------------------------------------------------------ general posts (Nov 12): ElyScreener on every chain
// Only things the site really does today. Chains: Elysium and Robinhood Chain are live; the others are said to be coming.
const GENERAL_TAGS = ["#memecoin", "#crypto", "#altcoins", "#onchain", "#DeFi", "#Web3", "#CryptoTrading", "#Trading", "#DEX", "#GemHunter", "#Altseason", "#MemeSeason", "#CryptoNews", "#Whales", "#SmartMoney", "#Layer2", "#RobinhoodChain"];
const GENERAL_POSTS = [
  { card: { lines: ["Every chain.", "One screen.", "Buy. Sell. Launch."], chip: "elyscreener.com", tag: "ELYSCREENER" },
    text: [() => nl(`pick a chain, see every coin on it, buy and sell, or launch your own. same screen for all of them`, "", `Elysium and Robinhood Chain are live, more chains coming`), () => nl(`ElyScreener is one screen for every chain`, `browse the coins, trade them, launch yours. no switching between five sites`)] },
  { card: { lines: ["Your wallet.", "Your amount.", "One tap."], chip: "Trade on ElyScreener", tag: "TRADE" },
    text: [() => nl(`open a coin on ElyScreener, connect your wallet, type an amount, buy`, "", `that's the whole flow. selling is the same`), () => nl(`no swaps in the background, no network settings to fix`, `you pay in the chain's own coin and the trade goes through. ElyScreener`)] },
  { card: { lines: ["Launch a coin", "on the chain you pick.", "One tap."], chip: "Launch on ElyScreener", tag: "LAUNCH" },
    text: [() => nl(`launch a meme coin straight from ElyScreener`, "", `pick the chain, add a name and a picture (or let AI make them), one tap. the coin and its pool go live together`), () => nl(`you can launch your own coin on ElyScreener now`, `choose the chain first, the rest is one tap`)] },
  { card: { lines: ["The AI knows", "which chain you picked.", "Names, tickers, logos."], chip: "Create with AI", tag: "CREATE WITH AI" },
    text: [() => nl(`the AI coin maker on ElyScreener now builds around the chain you picked`, "", `launching on Robinhood Chain gets a Robinhood style name, ticker and logo. other chain, other theme`), () => nl(`stuck on a name? ElyScreener's AI makes the name, ticker, description and logo`, `and it matches the chain you're launching on`)] },
  { card: { lines: ["Is this coin safe?", "Just ask.", "Any coin, one tap."], chip: "Ask AI on ElyScreener", tag: "ASK AI" },
    text: [() => nl(`you can ask ElyScreener "is this coin safe?" and it answers`, "", `holders, bot clusters, dev selling. before you ape, not after`), () => nl(`every coin on ElyScreener gets a safety label`, `safe / caution / risky, from holders, bots, dev selling`)] },
  { card: { lines: ["Stock tokens", "on Robinhood Chain.", "Real ones only."], chip: "elyscreener.com", tag: "STOCKS" },
    text: [() => nl(`Robinhood Chain stock tokens are on ElyScreener now`, "", `Tesla, Nvidia and the rest, with an Official badge so you can tell the real ones from the copies`)] },
  { card: { lines: ["Limit buy.", "Take profit.", "Stop loss."], chip: "ElyScreener Auto Trade", tag: "AUTO TRADE" },
    text: [() => nl(`set a limit buy, a take profit or a stop loss once and walk away`, "", `ElyScreener Auto Trade runs the rule for you. your funds sit in a vault only you can withdraw from`), () => nl(`nobody watches the chart at 3am. a rule does`, `limit buy, take profit, stop loss on ElyScreener`)] },
  { card: { lines: ["Follow a whale.", "Copy the buys.", "You set the budget."], chip: "ElyScreener Auto Trade", tag: "COPY A WHALE" },
    text: [() => nl(`ElyScreener Auto Trade can copy a whale`, "", `pick the wallet, set a budget and a max per trade, it mirrors their buys. which whale would you follow first?`)] },
  { card: { lines: ["Put a bell", "on any coin.", "No sign up."], chip: "elyscreener.com", tag: "ALERTS" },
    text: [() => nl(`put a bell on any coin on ElyScreener`, `pump, dump, dev selling, big buy. you get pinged. no sign up`)] },
  { card: { lines: ["Every launchpad.", "Every coin.", "Live."], chip: "elyscreener.com", tag: "LIVE" },
    text: [() => nl(`every coin from every launchpad, live on one screen`, "", `ElyScreener tracks them so you don't have to open ten tabs`)] },
  { card: { lines: ["Smart money.", "Whales.", "Fresh coins."], chip: "elyscreener.com", tag: "BOARDS" },
    text: [() => nl(`ElyScreener has boards for smart money, whales, top gainers and brand new coins`, "", `pick a chain and see what's moving on it right now`)] },
  { card: { lines: ["No wallet settings.", "No network fixes.", "Just trade."], chip: "elyscreener.com", tag: "SIMPLE" },
    text: [() => nl(`the point of ElyScreener: you shouldn't have to touch wallet or network settings to trade a coin`, "", `connect, enter an amount, buy or sell`)] },
];
async function general(r) {
  const last = (await q(`select tpl from es_x_posts where kind = 'general' order by at desc limit 8`)).map((x) => x.tpl);
  const idx = [...GENERAL_POSTS.keys()].filter((i) => !last.includes(i));
  const i = idx.length ? pick(r, idx) : Math.floor(r() * GENERAL_POSTS.length);
  const f = GENERAL_POSTS[i];
  return { kind: "general", token: null, tpl: i, text: pick(r, f.text)(), card: featureCard(f.card) };
}

// Nov 11: four posts a day about Auto Trade and trading right on ElyScreener (only what the site really does)
const PROMOS = [
  { card: { lines: ["Set a limit buy.", "Go touch grass.", "Auto Trade on ElyScreener."], chip: "Auto Trade", tag: "AUTO TRADE" },
    text: [() => nl(`you can set a limit buy on any Elysium coin on ElyScreener and just walk away`, "", `price hits your level, it buys. your HYPE sits in a vault only you can withdraw from`, "", `where would you put your limit on your favorite coin rn?`)] },
  { card: { lines: ["Take profit.", "Stop loss.", "Set once, done."], chip: "Auto Trade", tag: "AUTO TRADE" },
    text: [() => nl(`take profit and stop loss on an Elysium coin, set once, runs by itself`, "", `honest question: which one do you forget more, the TP or the SL? 👀`)] },
  { card: { lines: ["Copy a whale.", "Pick the wallet.", "Set a budget."], chip: "Auto Trade", tag: "COPY WHALE" },
    text: [() => nl(`ElyScreener Auto Trade can copy a whale on Elysium`, "", `pick the wallet, set a budget and a max per trade, it mirrors their buys`, "", `which whale would you follow first?`)] },
  { card: { lines: ["Buy. Sell.", "Right on the coin page.", "Connect, type, done."], chip: "Trade on ElyScreener", tag: "TRADE" },
    text: [() => nl(`you don't need to leave ElyScreener to trade an Elysium coin`, "", `open the coin, connect your wallet, type an amount, buy. that's the whole thing`)] },
  { card: { lines: ["Limit buy", "or market buy?", "Your call."], chip: "Auto Trade", tag: "AUTO TRADE" },
    text: [() => nl(`ok real question, limit buy 10% lower or just market buy?`, "", `ElyScreener Auto Trade does the limit one for you on Elysium coins. you can sleep`)] },
  { card: { lines: ["Nobody watches", "the chart at 3am.", "Auto Trade does."], chip: "Auto Trade", tag: "AUTO TRADE" },
    text: [() => nl(`nobody watches the chart at 3am. a rule does`, "", `limit buy, take profit, stop loss, copy a whale. all on Elysium, all on ElyScreener`)] },
  { card: { lines: ["Your HYPE.", "Your vault.", "Only you withdraw."], chip: "Auto Trade", tag: "NON-CUSTODIAL" },
    text: [() => nl(`how Auto Trade holds your money on ElyScreener: a vault contract, and only your wallet can withdraw`, "", `you can pull it out any time. would you trust a bot with that or nah?`)] },
  { card: { lines: ["Any coin.", "Any launchpad.", "Trade it here."], chip: "Trade on ElyScreener", tag: "TRADE" },
    text: [() => nl(`every Elysium coin from every launchpad, and you can trade all of them from one screen`, "", `which pad do you ape on most?`)] },
];
async function promo(r) {
  const [c] = await q(`select count(*)::int n, extract(epoch from now() - max(at))::float8 age from es_x_posts where kind = 'promo' and at > now() - interval '24 hours'`);
  if (c && c.n >= 4) return null;
  if (c && c.age != null && c.age < 3 * 3600) return null;
  const last = (await q(`select tpl from es_x_posts where kind = 'promo' order by at desc limit 4`)).map((x) => x.tpl);
  const idx = [...PROMOS.keys()].filter((i) => !last.includes(i));
  const i = idx.length ? pick(r, idx) : Math.floor(r() * PROMOS.length);
  const f = PROMOS[i];
  return { kind: "promo", token: null, tpl: i, text: pick(r, f.text)(), card: featureCard(f.card) };
}
// which kind goes in a slot: launchpad board once a day in the evening, a feature every few posts,
// otherwise live coins (gainers most, then smart money and fresh launches)
// threads: each theme is a different mix of boards and single-coin checks (a spec is an answerFor intent,
// or {coin: kind} for one coin's check card), with its own hook so no two threads open alike
const THEMES = [
  { parts: ["launchpads", "top_gainers", "smart_money", "new_coins"], hook: "a quick tour of what is moving on Elysium right now across every launchpad", lead: "elysium right now, by launchpad 🧵" },
  { parts: ["top_volume", { coin: "volume" }, "top_gainers"], hook: "where the volume is going, and what is behind the busiest coin", lead: "follow the volume 🧵" },
  { parts: ["smart_money", { coin: "smart" }, "new_coins"], hook: "wallets with a winning record all buying the same thing", lead: "the good wallets are buying something 🧵" },
  { parts: ["new_coins", { coin: "fresh" }, "launchpads"], hook: "brand new coins that already have real holders", lead: "fresh launches worth a look 🧵" },
  { parts: ["top_gainers", { coin: "gainer" }, "smart_money"], hook: "the biggest movers and whether the top one holds up", lead: "biggest movers, then the receipts 🧵" },
  { parts: ["launchpads", "top_volume", { coin: "volume" }], hook: "which launchpads are actually getting traded", lead: "who is getting traded 🧵" },
  { parts: ["smart_money", "top_gainers", { coin: "smart" }], hook: "smart money versus the crowd", lead: "smart money vs everyone else 🧵" },
  { parts: ["new_coins", "top_volume", { coin: "fresh" }], hook: "the newest coins and the most traded ones side by side", lead: "new vs busy 🧵" },
  { parts: [{ coin: "gainer" }, "launchpads", "new_coins"], hook: "one coin running hard, then the wider picture", lead: "one coin everybody is watching 🧵" },
  { parts: ["top_volume", "smart_money", "top_gainers", "launchpads"], hook: "the whole Elysium board in four posts", lead: "the whole board in four posts 🧵" },
];
const usedCoins = new Map(); // coin → when a thread last featured it (so threads through the day show different ones)
async function pickCoin(kind) {
  let rows = [];
  if (kind === "smart") {
    rows = (await q(`select token address, count(distinct trader)::int n from es_smart_buys(24) group by token order by 2 desc limit 8`).catch(() => []));
  } else {
    const where = kind === "fresh" ? `created_at > now() - interval '6 hours' and holders >= 20` : `last_trade_at > now() - interval '6 hours' and holders >= 25 and coalesce(vol24_hype, 0) * $1 >= 1000 ${SANE}${kind === "gainer" ? " and change24 is not null" : ""}`;
    const order = kind === "gainer" ? "change24 desc nulls last" : kind === "volume" ? "vol24_hype desc" : "holders desc";
    rows = await q(`select address from ely_tokens where ${where} order by ${order} limit 8`, kind === "fresh" ? [] : [hype || 1]).catch(() => []);
  }
  const sc = await scores(rows.map((r) => r.address));
  const now = Date.now();
  for (const r of rows) {
    const a = r.address.toLowerCase();
    if ((sc.get(a) ?? 60) < 50 || now - (usedCoins.get(a) || 0) < 6 * 3600e3) continue;
    return a;
  }
  return null;
}
async function thread(themeIdx = 0) {
  const done = await q(`select 1 from es_x_posts where kind = 'thread' and at > now() - interval '40 minutes'`);
  if (done.length) return null;
  const theme = THEMES[themeIdx % THEMES.length];
  const parts = [];
  const seen = new Set();
  for (const spec of theme.parts) {
    let a = null;
    if (typeof spec === "string") a = await answerFor({ intent: spec, lang: "en", text: "", quiet: true }).catch(() => null);
    else {
      const addr = await pickCoin(spec.coin);
      if (addr && !seen.has(addr)) { a = await answerFor({ intent: "coin", coin: addr, lang: "en", text: "", quiet: true }).catch(() => null); if (a?.card) { seen.add(addr); usedCoins.set(addr, Date.now()); } }
    }
    if (a?.card && !/^(No |Nothing)/.test(a.facts)) parts.push({ intent: typeof spec === "string" ? spec : "coin", ...a });
  }
  // at least four posts: fill up with other boards the thread has not used yet
  for (const extra of ["top_gainers", "smart_money", "new_coins", "top_volume", "launchpads"]) {
    if (parts.length >= 4) break;
    if (parts.some((x) => x.intent === extra)) continue;
    const a = await answerFor({ intent: extra, lang: "en", text: "", quiet: true }).catch(() => null);
    if (a?.card && !/^(No |Nothing)/.test(a.facts)) parts.push({ intent: extra, ...a });
  }
  if (parts.length < 4) return null;
  return { kind: "thread", token: null, parts, theme };
}
async function compose(slotIdx, r) {
  const hourTR = new Date(Date.now() + TR).getUTCHours();
  const order = [];
  if (GENERAL) order.push(general);
  else {
  // (the launchpad board now goes out inside the daily threads)
  order.push(promo); // four Auto Trade / trading posts a day, at least 3 h apart
  if (slotIdx % 4 === 3) order.push(feature);
  order.push(launched); // a coin made on ElyScreener goes first, whenever there is a new one
  order.push(...pick(r, [[gainer, smart], [smart, gainer]]));
  order.push(feature);
  }
  for (const f of order) {
    try { const p = await f(r); if (p) return p; } catch (e) { log(`${f.name}:`, e.message); }
  }
  return null;
}

async function postOne(slotIdx, asThread = false, themeIdx = 0) {
  await loadHype();
  const r = rng(Date.now() & 0xffffffff);
  const p = (asThread && !GENERAL && (await thread(themeIdx).catch((e) => { log("thread:", e.message); return null; }))) || (await compose(slotIdx, r));
  if (!p) { log("nothing worth posting, slot skipped"); return; }
  const recent = (await q(`select text from es_x_posts order by at desc limit 6`).catch(() => [])).map((x) => x.text);
  if (p.kind === "thread") return postThread(p, r, recent);
  const base = p.text ?? W[p.kind][p.tpl](p.d);
  // written fresh by the AI from the same data (checked), else our template line
  const facts = p.d ? Object.entries(p.d).filter(([, v]) => v != null && v !== "").map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(" / ") : v}`).join("\n") : base;
  // the key number must be in the post too (a gainer without its % is just noise)
  const must = [p.d?.sym && `$${p.d.sym}`, p.d?.x, p.d?.pct, p.kind === "smart" && p.d?.n != null && String(p.d.n), p.kind === "fresh" && p.d?.holders].filter(Boolean);
  let text = await writePost({ facts: `${facts}\n${base}`, fallback: base, must, recent, ...(GENERAL ? { brand: "ElyScreener, a multi-chain coin screener where people browse, buy, sell and launch coins on every chain" } : {}) });
  text = attach(text.replace(/\n{3,}/g, "\n\n").trim(), GENERAL ? false : ecoNow(), GENERAL ? tags(r, 2, null, null, GENERAL_TAGS) : tags(r, 4, r() < 0.7 ? "#Elysium" : null));
  const link = p.token ? `chart → ${SITE}/coin/${p.token}` : `live → ${SITE}`;
  if (DRY || !KEYS.apiKey) {
    mkdirSync("/tmp/esx", { recursive: true });
    const f = `/tmp/esx/${Date.now()}-${p.kind}.png`;
    writeFileSync(f, p.card);
    log(`[dry] ${p.kind}\n${text}\n  ↳ ${link}\n  card: ${f}`);
  } else {
    const mediaId = await uploadImage(p.card);
    const id = await tweet(text, { mediaId });
    if (id && env("ES_X_LINK_REPLY") === "1") { await sleep(4000); await tweet(link, { replyTo: id }).catch((e) => log("link reply:", e.message)); }
    log(`posted ${p.kind} ${id}`);
    p.tweetId = id;
  }
  await q(`insert into es_x_posts (kind, token, tpl, text, tweet_id) values ($1, $2, $3, $4, $5)`, [p.kind, p.token, p.tpl ?? null, text, p.tweetId ?? null]);
}

const CLOSERS = ["every coin on Elysium, live on ElyScreener", "all of it free on ElyScreener, no sign-up", "search any coin on ElyScreener and trade it right on its page", "wallets, whales and holders for every coin, on ElyScreener", "ElyScreener has the rest, every launchpad and every coin"];
async function postThread(p, r, recent) {
  const texts = [];
  for (const [i, part] of p.parts.entries()) {
    const fallback = `${i === 0 ? `${p.theme.lead}\n\n` : ""}${part.fallback.length > 230 ? part.fallback.split("\n").slice(0, 4).join("\n") : part.fallback}`.slice(0, 260);
    // the opening post gets a hook brief; the AI is told not to open like recent posts and never to talk dates
    const facts = i === 0 ? `This is the FIRST post of a thread. Make people want to open it. Angle: ${p.theme.hook}. Never mention mainnet, launch dates or "tomorrow".\n${part.facts}` : part.facts;
    const t = await writePost({ facts, fallback: fallback.slice(0, 175), recent: i === 0 ? recent : [], max: 175 });
    texts.push(i === 0 && !/🧵|thread/i.test(t) ? `${t} 🧵` : t);
  }
  const usedTags = new Set();
  const ecoFirst = ecoNow();
  // the first post is the one people see: it gets the launchpads' @handles (ES_PAD_X) and the hashtags
  const pads = p.parts.find((x) => x.intent === "launchpads");
  const handles = pads ? Object.entries(PAD_X).filter(([k]) => pads.facts.toLowerCase().includes(k)).map(([, v]) => v).slice(0, 4).join(" ") : "";
  const end = `\n\n${pick(r, CLOSERS)}`;
  const last = texts.length - 1;
  if (xLength(texts[last] + end + "\n\n#Elysium #Trading #AutoTrade #HYPE") <= 280) texts[last] += end;
  for (let i = 0; i < texts.length; i++) {
    const lead = i === 0 && handles && xLength(texts[0] + `\n\n${handles}\n\n#a #b #c #d`) <= 280 ? `${texts[0]}\n\n${handles}` : texts[i];
    texts[i] = attach(lead, i === 0 && ecoFirst, tags(r, 4, i === 0 ? "#Elysium" : null, usedTags));
  }
  for (let i = 0; i < texts.length; i++) while (xLength(texts[i]) > 280 && texts[i].includes("\n")) texts[i] = texts[i].split("\n").slice(0, -1).join("\n");
  if (DRY || !KEYS.apiKey) {
    mkdirSync("/tmp/esx", { recursive: true });
    p.parts.forEach((x, i) => writeFileSync(`/tmp/esx/${Date.now()}-thread-${i + 1}.png`, x.card));
    log(`[dry] thread\n${texts.map((t, i) => `(${i + 1}) ${t}`).join("\n---\n")}`);
  } else {
    let prev = null, first = null;
    for (const [i, part] of p.parts.entries()) {
      const mediaId = await uploadImage(part.card);
      prev = await tweet(texts[i], { mediaId, ...(prev ? { replyTo: prev } : {}) }); // replying to ourselves is allowed
      first ??= prev;
      await sleep(3000);
    }
    p.tweetId = first;
    log(`posted thread ${first} (${p.parts.length} posts)`);
  }
  await q(`insert into es_x_posts (kind, token, tpl, text, tweet_id) values ('thread', null, null, $1, $2)`, [texts.join("\n---\n"), p.tweetId ?? null]);
}

// ------------------------------------------------------------------ "@elyscreener check $XYZ"
async function xGet(path) {
  const url = `https://api.x.com${path}`;
  const r = await fetch(url, { headers: { authorization: oauth("GET", url) } });
  const t = await r.text();
  if (!r.ok) throw new Error(`X GET ${path.split("?")[0]} ${r.status}: ${t.slice(0, 200)}`);
  return JSON.parse(t);
}
let myId = null, myName = null;
async function findCoin(ref) {
  if (!ref) return null;
  const addr = String(ref).match(/0x[0-9a-fA-F]{40}/)?.[0]?.toLowerCase();
  if (addr) return (await q(`select * from ely_tokens where lower(address) = $1 limit 1`, [addr]))[0] || null;
  const w = String(ref).replace(/^\$/, "").trim();
  if (!w) return null;
  return (await q(`select * from ely_tokens where upper(symbol) = upper($1) or upper(name) = upper($1) order by (upper(symbol) = upper($1)) desc, vol24_hype desc nulls last, holders desc limit 1`, [w]))[0] || null;
}
const labelOf = (sc) => (sc == null ? null : sc >= 80 ? "Safe" : sc >= 50 ? "Caution" : "Risky");
async function scores(addrs) {
  if (!addrs.length) return new Map();
  const r = await q(`select lower(token) t, score from es_safety_cache where lower(token) = any($1)`, [addrs.map((a) => a.toLowerCase())]).catch(() => []);
  return new Map(r.map((x) => [x.t, Number(x.score)]));
}
const pctTxt = (v) => `${v >= 0 ? "+" : "-"}${Math.abs(v) >= 100 ? Math.round(Math.abs(v)) : Math.abs(v).toFixed(1)}%`;
/** Facts (English, from our data) + a template answer + a card, for one kind of question. */
async function answerFor(c) {
  if (c.intent === "coin") {
    const t = await findCoin(c.coin);
    if (!t) return { facts: `No coin called "${c.coin}" was found on Elysium. Ask with the contract address.`, fallback: "couldn't find that one on Elysium. paste the contract address and I'll check it" };
    const a = await coinCheck(t);
    return { facts: a.text, fallback: a.text, card: a.card, token: t.address };
  }
  if (["top_gainers", "top_volume", "new_coins"].includes(c.intent)) {
    const where = c.intent === "new_coins" ? `created_at > now() - interval '6 hours' and holders >= 20` : `last_trade_at > now() - interval '6 hours' and holders >= 25 and coalesce(vol24_hype, 0) * $1 >= 1000 ${SANE}`;
    const order = c.intent === "top_gainers" ? "change24 desc nulls last" : c.intent === "top_volume" ? "vol24_hype desc" : "holders desc";
    const rows = await q(`select address, name, symbol, image, launchpad, change24, vol24_hype, holders, mcap_hype, created_at from ely_tokens where ${where} ${c.intent === "top_gainers" ? "and change24 is not null" : ""} order by ${order} limit 12`, c.intent === "new_coins" ? [] : [hype || 1]);
    const sc = await scores(rows.map((r) => r.address));
    const top = rows.filter((r) => (sc.get(r.address.toLowerCase()) ?? 60) >= 50).slice(0, 3); // never recommend Risky coins
    if (!top.length) return { facts: "Nothing qualifies right now on Elysium.", fallback: "nothing standing out on Elysium right now, check back in a bit" };
    const line = (r, i) => {
      const lab = labelOf(sc.get(r.address.toLowerCase()));
      const v = c.intent === "top_gainers" ? `${pctTxt(Number(r.change24))} in 24h` : c.intent === "top_volume" ? `${money(usd(r.vol24_hype))} volume in 24h` : `${ago(r.created_at)} old, ${count(r.holders)} holders`;
      return `${i + 1}. $${r.symbol} (${padName(r.launchpad)}): ${v}${lab ? `, safety ${lab}` : ""}`;
    };
    const head = { top_gainers: "Biggest gainers on Elysium (24h, Risky coins left out):", top_volume: "Most traded on Elysium (24h):", new_coins: "New coins on Elysium getting traction:" }[c.intent];
    const facts = [head, ...top.map(line), "Not financial advice."].join("\n");
    const card = listCard({ title: head.replace(/:$/, "").toUpperCase(), tag: "LIVE ON ELYSIUM", rows: await Promise.all(top.map(async (r) => ({ symbol: `$${r.symbol}`, sub: `${padName(r.launchpad)} · ${count(r.holders)} holders · ${money(usd(r.mcap_hype))} mc`, value: c.intent === "top_gainers" ? pctTxt(Number(r.change24)) : c.intent === "top_volume" ? money(usd(r.vol24_hype)) : ago(r.created_at), up: c.intent === "top_gainers" ? Number(r.change24) >= 0 : undefined, image: await logo(r.image) }))) });
    return { facts, fallback: [head, ...top.map(line)].join("\n"), card };
  }
  if (c.intent === "smart_money") {
    const rows = await q(`select token, count(distinct trader)::int n from es_smart_buys(24) group by token order by 2 desc limit 6`).catch(() => []);
    const toks = await q(`select address, symbol, launchpad, image, holders from ely_tokens where lower(address) = any($1)`, [rows.map((r) => r.token)]);
    const by = new Map(toks.map((t) => [t.address.toLowerCase(), t]));
    const sc = await scores(toks.map((t) => t.address));
    const top = rows.filter((r) => by.has(r.token) && (sc.get(r.token) ?? 60) >= 50).slice(0, 3);
    if (!top.length) return { facts: "No smart-money buys stand out in the last 24h.", fallback: "no clear smart-money moves on Elysium in the last 24h" };
    const lines = top.map((r, i) => `${i + 1}. $${by.get(r.token).symbol} (${padName(by.get(r.token).launchpad)}): ${r.n} smart wallet${r.n > 1 ? "s" : ""} bought`);
    const head = "Where wallets with a winning record bought on Elysium (24h):";
    const card = listCard({ title: "SMART MONEY · LAST 24H", tag: "SMART MONEY", rows: await Promise.all(top.map(async (r) => { const t = by.get(r.token); return { symbol: `$${t.symbol}`, sub: `${padName(t.launchpad)} · ${count(t.holders)} holders`, value: `${r.n} wallets`, up: true, image: await logo(t.image) }; })) });
    return { facts: [head, ...lines, "Not financial advice."].join("\n"), fallback: [head, ...lines].join("\n"), card };
  }
  if (c.intent === "launchpads") {
    const rows = await q(`select t.launchpad pad, count(*)::int coins, round(100.0 * count(*) filter (where s.score >= 80) / nullif(count(s.score), 0))::int safe, sum(t.vol24_hype) v
      from ely_tokens t left join es_safety_cache s on lower(s.token) = lower(t.address) where t.launchpad is not null and t.launchpad <> 'Other' group by 1 having sum(t.vol24_hype) > 0 order by v desc limit 5`).catch(() => []);
    if (!rows.length) return { facts: "No launchpad data right now.", fallback: "no launchpad data right now, try again in a bit" };
    // our own scheduled posts leave out "% Safe" (no need to call out a launchpad in public); answers to a question keep it
    const lines = rows.map((r) => `${r.pad}: ${count(r.coins)} coin${r.coins === 1 ? "" : "s"}, ${c.quiet ? "" : `${r.safe ?? 0}% rated Safe, `}${money(usd(r.v))} volume in 24h`);
    const head = "Launchpads on Elysium by the numbers (no ranking of who is best, the data decides):";
    const card = padsCard({ title: c.quiet ? "LAUNCHPAD VOLUME · LAST 24H" : "LAUNCHPADS · 24H VOLUME · % RATED SAFE", rows: rows.map((r) => ({ name: r.pad, vol: usd(r.v), label: c.quiet ? money(usd(r.v)) : `${money(usd(r.v))} · ${r.safe ?? 0}% safe` })) });
    return { facts: [head, ...lines, "Your call, not financial advice."].join("\n"), fallback: ["launchpads on Elysium, by the numbers:", ...lines.slice(0, 4)].join("\n"), card };
  }
  if (c.intent === "buybacks") {
    if (!BB_WALLETS.length) return { facts: `${BB_NAME} buys back coins launched on it with its protocol fees, starting when Elysium mainnet opens on November 9. ElyScreener will show every buyback live in its Buybacks tab.`, fallback: `${BB_NAME} buybacks start nov 9. every single one will show up live on ElyScreener (Buybacks tab) the moment it hits the chain` };
    const rows = await q(`select tr.token, sum(tr.hype)::float8 h, count(*)::int n, max(tr.at) last, t.symbol, t.image, t.launchpad from ely_trades tr join ely_tokens t on lower(t.address) = lower(tr.token) where lower(tr.trader) = any($1) and tr.side = 'buy' and tr.at > now() - interval '7 days' group by tr.token, t.symbol, t.image, t.launchpad order by max(tr.at) desc limit 4`, [BB_WALLETS]);
    const total = await bbTotal();
    if (!rows.length) return { facts: `No ${BB_NAME} buybacks in the last 7 days. All-time total: ${money(usd(total))}.`, fallback: `no ${BB_NAME} buybacks in the last 7 days. all-time total ${money(usd(total))}` };
    const head = `Latest ${BB_NAME} buybacks (7d), all-time total ${money(usd(total))}:`;
    const lines = rows.map((r, i) => `${i + 1}. $${r.symbol}: ${money(usd(r.h))} bought back, last ${ago(r.last)} ago`);
    const card = listCard({ title: `${BB_NAME.toUpperCase()} BUYBACKS`, tag: "LAST 7 DAYS", rows: await Promise.all(rows.map(async (r) => ({ symbol: `$${r.symbol}`, sub: `${padName(r.launchpad)} · ${r.n} buy${r.n > 1 ? "s" : ""}`, value: money(usd(r.h)), up: true, image: await logo(r.image) }))) });
    return { facts: [head, ...lines].join("\n"), fallback: [head, ...lines].join("\n"), card };
  }
  if (c.intent === "general" || c.intent === "about") {
    return { facts: `Answer the question using only this background (if it isn't covered, say you only know live Elysium data and point to ElyScreener's Learn pages):\n${KB}`, fallback: c.intent === "about" ? "I'm ElyScreener: every coin on Elysium live. tag me with a ticker like $BLOB and I'll check it for you: safety, holders, bot clusters, smart money" : "good one. I mostly know live Elysium data, tag me with a ticker like $BLOB and I'll check it. guides are on ElyScreener's Learn pages", general: true };
  }
  if (c.intent === "off_topic") return { facts: "Say politely, in one short sentence, that you only look at Elysium (coins, launchpads, live data).", fallback: "I only look at Elysium, ask me about any coin or launchpad there 🙏", general: true };
  return null; // chitchat: no answer
}
async function coinCheck(t) {
  const s = (await q(`select score, why, dev_pct, bots_pct, dev_sold from es_safety_cache where lower(token) = lower($1)`, [t.address]).catch(() => []))[0];
  const sm = (await q(`select count(distinct trader)::int n from es_smart_buys(24) where token = lower($1)`, [t.address]).catch(() => []))[0]?.n || 0;
  const score = s ? Number(s.score) : null;
  const label = score == null ? "Unrated" : score >= 80 ? "Safe" : score >= 50 ? "Caution" : "Risky";
  const bots = s?.bots_pct == null ? null : Number(s.bots_pct);
  const dev = s?.dev_pct == null ? null : Number(s.dev_pct);
  const c = {
    symbol: t.symbol, name: t.name, pad: padName(t.launchpad), score, label, why: s?.why || [],
    mc: money(usd(t.mcap_hype)), holders: count(t.holders), top10: t.top10_pct == null || t.top10_pct > 100 ? "—" : `${Math.round(t.top10_pct)}%`,
    bots: bots == null ? "—" : `${bots.toFixed(bots < 10 ? 1 : 0)}%`, botsBad: (bots ?? 0) >= 20,
    dev: s?.dev_sold ? "sold" : dev == null ? "—" : `holds ${dev.toFixed(dev < 10 ? 1 : 0)}%`, devBad: !!s?.dev_sold || (dev ?? 0) > 20,
    smart: sm ? `${sm} bought` : "none", smartN: sm, image: await logo(t.image),
  };
  const lines = [
    `$${t.symbol} on ${c.pad}: ${label}${score != null ? ` (${score}/100)` : ""}`,
    `market cap ${c.mc} · ${money(usd(t.vol24_hype || 0))} traded in 24h`,
    `${c.holders} holders · top 10 hold ${c.top10} · ${c.bots} in bot clusters`,
    s?.dev_sold ? "heads up, the creator has sold" : dev != null ? `creator ${c.dev}` : null,
    sm ? `${sm} smart wallet${sm > 1 ? "s" : ""} bought in the last 24h` : null,
  ].filter(Boolean);
  return { text: lines.join("\n"), card: checkCard(c) };
}
// ------------------------------------------------------------------ Ascend buybacks
const BB_WALLETS = env("ES_BUYBACK_WALLETS").split(",").map((a) => a.trim().toLowerCase()).filter((a) => /^0x[0-9a-f]{40}$/.test(a));
const BB_NAME = env("ES_BUYBACK_NAME") || "Ascend";
const BB_X = env("ES_BUYBACK_X") || "@AscendLaunch";
const bbTotal = async () => Number((await q(`select coalesce(sum(hype), 0)::float8 h from ely_trades where lower(trader) = any($1) and side = 'buy'`, [BB_WALLETS]))[0]?.h || 0);
/** New buybacks since the last check → one post (every coin bought back since, biggest first). At most one post per 20 min. */
async function watchBuybacks() {
  if (!BB_WALLETS.length) return;
  await q(`create table if not exists es_bb_seen (trade_id bigint primary key, at timestamptz not null default now())`);
  const first = !(await q(`select 1 from es_bb_seen limit 1`)).length;
  const fresh = await q(`select tr.id, tr.token, tr.hype::float8 h, tr.at from ely_trades tr where lower(tr.trader) = any($1) and tr.side = 'buy' and not exists (select 1 from es_bb_seen s where s.trade_id = tr.id) order by tr.at limit 500`, [BB_WALLETS]);
  if (!fresh.length) return;
  const mark = () => q(`insert into es_bb_seen (trade_id) select unnest($1::bigint[]) on conflict do nothing`, [fresh.map((r) => r.id)]);
  if (first) { await mark(); log(`buybacks: watching ${BB_WALLETS.length} wallet(s), ${fresh.length} earlier buys skipped`); return; } // never post the backlog
  const lastPost = (await q(`select max(at) m from es_x_posts where kind = 'buyback'`))[0]?.m;
  if (lastPost && Date.now() - new Date(lastPost).getTime() < 20 * 60e3) return; // collect, post together later
  await loadHype();
  const by = new Map();
  for (const r of fresh) { const g = by.get(r.token) || { token: r.token, h: 0, n: 0 }; g.h += r.h; g.n++; by.set(r.token, g); }
  const groups = [...by.values()].sort((a, b) => b.h - a.h);
  const toks = await q(`select address, symbol, name, image, launchpad from ely_tokens where lower(address) = any($1)`, [groups.map((g) => g.token.toLowerCase())]);
  const tk = new Map(toks.map((t) => [t.address.toLowerCase(), t]));
  const list = groups.map((g) => ({ ...g, t: tk.get(g.token.toLowerCase()) })).filter((g) => g.t);
  if (!list.length) { await mark(); return; }
  const total = await bbTotal();
  const sym = (t) => `$${t.symbol}`;
  const text = list.length === 1
    ? nl(`${BB_NAME} just bought back ${sym(list[0].t)} 🔁`, "", `${money(usd(list[0].h))} (${list[0].h.toFixed(2)} HYPE)${list[0].n > 1 ? ` over ${list[0].n} buys` : ""}`, `${BB_NAME} buybacks so far: ${money(usd(total))}`, "", BB_X)
    : nl(`${BB_NAME} buyback round 🔁`, "", ...list.slice(0, 4).map((g) => `${sym(g.t)} ${money(usd(g.h))}`), "", `${BB_NAME} buybacks so far: ${money(usd(total))}`, "", BB_X);
  const card = listCard({ title: `${BB_NAME.toUpperCase()} BUYBACK`, tag: "LIVE ON ELYSIUM", rows: await Promise.all(list.slice(0, 4).map(async (g) => ({ symbol: `$${g.t.symbol}`, sub: `${padName(g.t.launchpad)} · bought back`, value: money(usd(g.h)), up: true, image: await logo(g.t.image) }))) });
  let id = null;
  if (DRY) log(`[dry] buyback post:\n${text}`);
  else id = await tweet(text, { mediaId: await uploadImage(card) });
  await mark();
  await q(`insert into es_x_posts (kind, token, tpl, text, tweet_id) values ('buyback', $1, null, $2, $3)`, [list[0].token, text, id]);
  log(`buyback post ${id || "(dry)"}: ${list.length} coin(s)`);
}

/** The coin of the post a mention replies to, when that post is one of ours (a coin post or an answer). */
async function contextCoin(m) {
  const parent = (m.referenced_tweets || []).find((r) => r.type === "replied_to")?.id;
  if (!parent) return null;
  const r = (await q(`select token from es_x_posts where tweet_id = $1 and token is not null
    union all select token from es_x_replies where reply_id = $1 and token is not null limit 1`, [parent]).catch(() => []))[0];
  return r?.token || null;
}
async function answerMentions() {
  if (env("ES_X_REPLIES") === "0" || DRY || !KEYS.apiKey) return;
  if (!myId) {
    if (env("ES_X_USER_ID")) myId = env("ES_X_USER_ID");
    else { const me = await xGet("/2/users/me"); myId = me?.data?.id; myName = me?.data?.username; }
    if (!myId) return;
  }
  const since = (await q(`select max(mention_id::numeric)::text m from es_x_replies where mention_id ~ '^[0-9]+$'`))[0]?.m;
  const j = await xGet(`/2/users/${myId}/mentions?max_results=${since ? 50 : 5}&tweet.fields=author_id,created_at,referenced_tweets${since ? `&since_id=${since}` : ""}`);
  const list = (j?.data || []).sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1));
  // first run (nothing saved yet): skip only mentions older than an hour, answer the fresh ones
  const fresh = since ? list : list.filter((m) => Date.now() - Date.parse(m.created_at || 0) < 3600e3);
  if (!since) for (const m of list) if (!fresh.includes(m)) await q(`insert into es_x_replies (mention_id, author, note) values ($1, $2, 'skipped (before start)') on conflict do nothing`, [m.id, m.author_id]);
  const day = trDay(Date.now());
  const launch = day === "2026-11-09" || day === "2026-11-10";
  const cap = launch ? Number(env("ES_X_REPLY_MAX_LAUNCH")) || 1000 : Number(env("ES_X_REPLY_MAX")) || 300;
  const perUser = launch ? 5 : 3;
  if (fresh.length) await loadHype(); // without the HYPE price every $ figure comes out as $0
  for (const m of fresh) {
    const save = (note, token = null, reply = null) => q(`insert into es_x_replies (mention_id, author, token, reply_id, note) values ($1, $2, $3, $4, $5) on conflict do nothing`, [m.id, m.author_id, token, reply, note]);
    if (m.author_id === myId) { await save("own"); continue; }
    const today = (await q(`select count(*)::int n, count(*) filter (where author = $1)::int a from es_x_replies where reply_id is not null and at > now() - interval '24 hours'`, [m.author_id]))[0];
    if (today.n >= cap) { await save("daily cap"); continue; }
    if (today.a >= perUser) { await save("per-person daily limit"); continue; }
    const c = await classify(m.text || "");
    // Nov 6: a reply under one of our own posts (or answers) is about that post's coin: "how deep is the
    // liquidity?" under the $MESA post means $MESA, not "couldn't find that one"
    const ctx = await contextCoin(m);
    if (ctx) {
      const named = c.intent === "coin" && c.coin ? await findCoin(c.coin).catch(() => null) : null;
      const asks = /\?/.test(m.text || "") || /\b(liq|liquidity|safe|rug|holders?|dev|bots?|chart|mc|cap|volume|vol)\b/i.test(m.text || "");
      if (!named && (c.intent === "coin" || (asks && ["general", "off_topic", "chitchat", "about"].includes(c.intent)))) { c.intent = "coin"; c.coin = ctx; }
    }
    let a;
    try { a = await answerFor(c); } catch (e) { log("answer data:", e.message); a = null; }
    if (!a) { await save(`no answer (${c.intent})`); continue; }
    try {
      const text = await phrase({ lang: c.lang, question: c.text, facts: a.facts, fallback: a.fallback, exact: !a.general });
      const mediaId = a.card ? await uploadImage(a.card) : null;
      const id = await tweet(text, { mediaId, replyTo: m.id });
      await save(`answered ${c.intent} (${c.lang})`, a.token || null, id);
      log(`answered ${m.id}: ${c.intent} in ${c.lang}`);
    } catch (e) { await save(`failed: ${String(e.message).slice(0, 120)}`); log("answer failed:", e.message); }
    await sleep(1500);
  }
}

// ------------------------------------------------------------------ Telegram: the same answers, free
async function tg(method, body, file) {
  const url = `https://api.telegram.org/bot${env("ES_TG_TOKEN")}/${method}`;
  let r;
  if (file) {
    const fd = new FormData();
    for (const [k, v] of Object.entries(body)) if (v != null) fd.append(k, typeof v === "object" ? JSON.stringify(v) : String(v));
    fd.append("photo", new Blob([file], { type: "image/png" }), "card.png");
    r = await fetch(url, { method: "POST", body: fd, signal: AbortSignal.timeout(40000) });
  } else r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(40000) });
  const j = await r.json();
  if (!j.ok) throw new Error(`telegram ${method}: ${j.description}`);
  return j.result;
}
const TG_HELLO = "hey 👋 I'm ElyScreener, live data for every coin on Elysium.\n\nask me anything about Elysium in any language, or:\n/check $TICKER  (or a contract address)\n/top  biggest movers\n/new  new coins with traction\n/smart  where smart money is buying\n/pads  launchpads by the numbers\n/buybacks  what Ascend is buying back\n\nin groups: use the commands or mention me.";
async function telegramLoop() {
  const me = await tg("getMe", {});
  const handle = `@${me.username}`.toLowerCase();
  log(`telegram: on as @${me.username}`);
  await tg("setMyCommands", { commands: [
    { command: "check", description: "check a coin: /check $BLOB" }, { command: "top", description: "biggest movers on Elysium" },
    { command: "new", description: "new coins with traction" }, { command: "smart", description: "where smart money is buying" }, { command: "pads", description: "launchpads by the numbers" },
    { command: "buybacks", description: "what Ascend is buying back" },
  ] }).catch(() => {});
  let offset = 0;
  const per = new Map(); // chat → answers in the last minute (keeps busy groups calm)
  for (;;) {
    let ups = [];
    try { ups = await tg("getUpdates", { offset, timeout: 25, allowed_updates: ["message"] }); } catch (e) { log(e.message); await sleep(5000); continue; }
    for (const u of ups) {
      offset = u.update_id + 1;
      const m = u.message;
      if (!m?.text || m.from?.is_bot) continue;
      const priv = m.chat.type === "private";
      const text = m.text.trim();
      const cmd = text.match(/^\/(\w+)(?:@\w+)?\s*(.*)$/s);
      const toUs = priv || !!cmd || text.toLowerCase().includes(handle) || m.reply_to_message?.from?.username === me.username;
      if (!toUs) continue;
      if (cmd && (cmd[1] === "start" || cmd[1] === "help")) { await tg("sendMessage", { chat_id: m.chat.id, text: TG_HELLO, reply_to_message_id: m.message_id }).catch(() => {}); continue; }
      const now = Date.now(), list = (per.get(m.chat.id) || []).filter((t) => now - t < 60e3);
      if (list.length >= 6) continue;
      per.set(m.chat.id, [...list, now]);
      try {
        await loadHype();
        let c;
        const fixed = { top: "top_gainers", new: "new_coins", smart: "smart_money", pads: "launchpads", volume: "top_volume", buybacks: "buybacks" }[cmd?.[1]];
        if (fixed) c = { intent: fixed, lang: "en", text, coin: null };
        else if (cmd?.[1] === "check") { const arg = (cmd[2] || "").trim(); c = /^\$?[A-Za-z][A-Za-z0-9]{0,14}$|^0x[0-9a-fA-F]{40}$/.test(arg) ? { lang: "en", intent: "coin", text: arg, coin: arg.replace(/^\$/, "") } : await classify(arg); c.intent = "coin"; c.coin = c.coin || cmd[2].replace(/^\$/, "").trim() || null; if (!c.coin) { await tg("sendMessage", { chat_id: m.chat.id, text: "which one? /check $TICKER or paste the contract address", reply_to_message_id: m.message_id }); continue; } }
        else c = await classify(text);
        const a = await answerFor(c);
        if (!a) continue;
        const reply = await phrase({ lang: c.lang, question: c.text, facts: a.facts, fallback: a.fallback, exact: !a.general });
        const link = a.token ? `\n\n📈 chart: ${SITE}/coin/${a.token}` : `\n\n📈 ${SITE}`;
        if (a.card) await tg("sendPhoto", { chat_id: m.chat.id, caption: (reply + link).slice(0, 1000), reply_to_message_id: m.message_id }, a.card);
        else await tg("sendMessage", { chat_id: m.chat.id, text: reply + link, reply_to_message_id: m.message_id, disable_web_page_preview: true });
        await q(`insert into es_tg_answers (chat, chat_type, intent) values ($1, $2, $3)`, [String(m.chat.id), m.chat.type, c.intent]).catch(() => {});
      } catch (e) { log("telegram answer:", e.message); }
    }
  }
}

async function main() {
  if (env("ES_X_OFF") === "1") { log("off"); return; }
  if (!env("DATABASE_URL")) { log("off (no DATABASE_URL)"); return; }
  if (!DRY && !(KEYS.apiKey && KEYS.apiSecret && KEYS.accessToken && KEYS.accessSecret)) log("no X keys: running dry");
  // the Supabase session pooler (port 5432) has few slots and the indexer uses them; the transaction pooler
  // (6543) shares connections, so this bot never waits for one. ES_DB_SESSION=1 keeps the URL as it is.
  let dbUrl = env("DATABASE_URL");
  if (env("ES_DB_SESSION") !== "1" && /pooler\.supabase\.com:5432/.test(dbUrl)) dbUrl = dbUrl.replace("pooler.supabase.com:5432", "pooler.supabase.com:6543");
  pool = new pg.Pool({ connectionString: dbUrl, max: 2, idleTimeoutMillis: 5000, connectionTimeoutMillis: 20000 });
  await q(`create table if not exists es_x_posts (id bigserial primary key, kind text not null, token text, tpl int, text text, tweet_id text, at timestamptz not null default now())`);
  await q(`create index if not exists es_x_posts_at on es_x_posts (at desc)`);
  await q(`create table if not exists es_tg_answers (id bigserial primary key, chat text, chat_type text, intent text, at timestamptz not null default now())`);
  // Telegram: if it can't connect (network hiccup at start, Telegram busy), try again every 30 s
  if (env("ES_TG_TOKEN")) (async () => { for (let i = 0; ; i++) { try { await telegramLoop(); } catch (e) { log(`telegram: ${e.message}${e.cause ? ` (${e.cause.code || e.cause.message})` : ""}, retrying in 30 s`); } await sleep(30_000); } })();
  await q(`create table if not exists es_x_replies (mention_id text primary key, author text, token text, reply_id text, note text, at timestamptz not null default now())`);
  // the old first-run rule skipped every mention while the table was empty: give the recent ones another chance
  await q(`delete from es_x_replies where note = 'skipped (before start)' and at > now() - interval '3 hours'`).catch(() => {});
  // answer people who tag us, every 75 s (each mention read costs $0.001, each answer $0.01)
  if (env("ES_X_REPLIES") !== "0" && !DRY && KEYS.apiKey) {
    const loop = async () => { for (;;) { await answerMentions().catch((e) => log("mentions:", e.message)); await sleep(75_000); } };
    loop();
  }
  // Ascend buybacks: checked every 2 min
  if (BB_WALLETS.length) (async () => { for (;;) { await watchBuybacks().catch((e) => log("buybacks:", e.message)); await sleep(120_000); } })();
  log(`on${DRY ? " (dry)" : ""}; today: ${plan(trDay(Date.now())).map((t) => new Date(t + TR).toISOString().slice(11, 16)).join(" ")} (TR)`);
  if (env("ES_X_NOW") === "1") await postOne(0).catch((e) => log("post failed:", e.message));
  if (env("ES_X_ONCE") === "1") { await pool.end(); return; }
  let idx = 0;
  for (;;) {
    const slot = nextSlot(Date.now()), th = nextThread(Date.now());
    const isThread = th <= slot + 10 * 60e3; // a thread time wins over a post slot within 10 min of it
    const at = isThread ? th : slot;
    log(`next ${isThread ? "thread" : "post"} ${new Date(at + TR).toISOString().slice(0, 16).replace("T", " ")} TR`);
    while (Date.now() < at) await sleep(Math.min(60e3, at - Date.now()));
    // never two posts within 15 min (restarts, clock drift)
    const recent = await q(`select 1 from es_x_posts where at > now() - interval '15 minutes'`).catch(() => []);
    if (Date.now() < blockedUntil) log("X daily limit still on, slot skipped");
    else if (isThread || !recent.length) await postOne(idx++, isThread, isThread ? themeFor(at) : 0).catch((e) => log("post failed:", e.message));
  }
}
main().catch((e) => { log("fatal", e.message); process.exit(1); });
