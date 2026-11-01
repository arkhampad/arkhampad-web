// Scout — the Smart Money Radar's poster. Reads the same indexed data the site uses (ely_trades,
// ely_tokens) and posts to Telegram: a periodic "top signals" alert and a once-a-day "Scout's Catch".
// Entirely opt-in and self-disabling: with no TG_SCOUT_TOKEN / TG_SCOUT_CHANNEL set it logs "off" and
// does nothing, so the build never depends on it. No token is ever hardcoded. No external data sources.
//
// Env:
//   TG_SCOUT_TOKEN, TG_SCOUT_CHANNEL   Telegram bot token + channel/chat id (both required to post)
//   SCOUT_EVERY_MIN (default 30)       how often to check for a fresh top-signals alert
//   SCOUT_CATCH_HOUR (default 15)      UTC hour to post the daily "Scout's Catch"
//   SCOUT_SITE (default https://arkhampad.com)
//   X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN, X_ACCESS_SECRET  optional: also tweet (best-effort)
import crypto from "node:crypto";

// ---- scoring (same thresholds as web/lib/scout.ts) ---------------------------------------------
const WINDOW_MS = 60 * 60_000, RECENT_MS = 10 * 60_000, CLUSTER_MS = 10 * 60_000;
const DUST_USD = 25, NOTABLE_MC_PCT = 0.015, RUNNER_PCT = 50, RUNNER_MIN_MC_USD = 3000, SMART_MIN_RUNNERS = 2;
const lc = (a) => String(a || "").toLowerCase();

function computeWallets(trades, byAddr, usd, now) {
  const spend = new Map();
  for (const x of trades) {
    if (x.side !== "buy" || !x.trader || now - Date.parse(x.at) > WINDOW_MS) continue;
    const w = lc(x.trader), coin = lc(x.token);
    let m = spend.get(w); if (!m) spend.set(w, (m = new Map()));
    const e = m.get(coin) || { hype: 0, amount: 0 };
    e.hype += Number(x.hype) || 0; e.amount += Number(x.amount) || 0; m.set(coin, e);
  }
  const out = new Map();
  for (const [w, coins] of spend) {
    let runners = 0;
    for (const [coin, e] of coins) {
      const t = byAddr.get(coin);
      if (!t || e.amount <= 0) continue;
      const mcUsd = (Number(t.mcap_hype) || 0) * usd;
      if ((Number(t.change24) || 0) >= RUNNER_PCT && mcUsd >= RUNNER_MIN_MC_USD) {
        const avg = e.hype / e.amount;
        if (Number(t.price_hype) > 0 && avg > 0 && Number(t.price_hype) > avg) runners++;
      }
    }
    out.set(w, { smart: runners >= SMART_MIN_RUNNERS, runners, coins: coins.size });
  }
  return out;
}

function scoutCoin(token, coinTrades, records, usd, now) {
  const mcapHype = Number(token.mcap_hype) || 0;
  const notableHype = NOTABLE_MC_PCT * mcapHype;
  const agg = new Map();
  for (const x of coinTrades) {
    if (x.side !== "buy" || !x.trader) continue;
    const ts = Date.parse(x.at); if (now - ts > WINDOW_MS) continue;
    const w = lc(x.trader); let e = agg.get(w);
    if (!e) { e = { wallet: w, hype: 0, firstTs: ts, lastTs: ts, smart: !!records.get(w)?.smart }; agg.set(w, e); }
    e.hype += Number(x.hype) || 0; if (ts < e.firstTs) e.firstTs = ts; if (ts > e.lastTs) e.lastTs = ts;
  }
  const events = [];
  for (const e of agg.values()) { if (e.hype * usd < DUST_USD) continue; e.notable = notableHype > 0 && e.hype >= notableHype; events.push(e); }
  const smartCount = events.filter((e) => e.smart).length;
  const notableCount = events.filter((e) => e.notable).length;
  const recentCount = events.filter((e) => now - e.lastTs <= RECENT_MS).length;
  const hot = events.filter((e) => e.smart || e.notable).map((e) => e.firstTs).sort((a, b) => a - b);
  let clusterSize = 0;
  for (let i = 0; i < hot.length; i++) { let n = 0; for (let j = i; j < hot.length && hot[j] - hot[i] <= CLUSTER_MS; j++) n++; if (n > clusterSize) clusterSize = n; }
  const cluster = clusterSize >= 2;
  let signal = "none";
  if (smartCount >= 3 || (cluster && notableCount >= 1) || (smartCount >= 2 && notableCount >= 1)) signal = "strong";
  else if (smartCount >= 1 || notableCount >= 1 || cluster) signal = "building";
  const score = smartCount * 4 + notableCount * 2.5 + clusterSize * 1.5 + Math.min(recentCount, 10) * 0.5;
  return { token, signal, score, smartCount, notableCount, recentCount, clusterSize };
}

function buildRadar(tokens, trades, usd, now = Date.now()) {
  const byAddr = new Map(tokens.map((t) => [lc(t.address), t]));
  const records = computeWallets(trades, byAddr, usd, now);
  const byCoin = new Map();
  for (const x of trades) { const c = lc(x.token); (byCoin.get(c) || byCoin.set(c, []).get(c)).push(x); }
  const scored = [];
  for (const [coin, list] of byCoin) { const t = byAddr.get(coin); if (!t) continue; const sc = scoutCoin(t, list, records, usd, now); if (sc.signal !== "none") scored.push(sc); }
  const rank = (c) => (c.signal === "strong" ? 2 : 1);
  scored.sort((a, b) => rank(b) - rank(a) || b.score - a.score);
  return scored;
}

// ---- data --------------------------------------------------------------------------------------
async function load(pool) {
  const [{ rows: toks }, { rows: trades }, { rows: meta }] = await Promise.all([
    pool.query("select address, symbol, name, mcap_hype, price_hype, change24, holders, creator, created_at from ely_tokens where price_hype is not null"),
    pool.query("select token, trader, side, hype, amount, at from ely_trades where at > now() - interval '60 minutes'"),
    pool.query("select v from ely_meta where k = 'hype_usd' limit 1"),
  ]);
  const usd = Number(meta[0]?.v) || 0;
  return { tokens: toks, trades, usd };
}

// ---- posting -----------------------------------------------------------------------------------
const money = (v) => {
  const a = Math.abs(v || 0);
  if (a >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `$${(v / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return `$${(v / 1e3).toFixed(1)}K`;
  return `$${(v || 0).toFixed(2)}`;
};

function topSignalsText(radar, usd, site) {
  const strong = radar.filter((c) => c.signal === "strong").slice(0, 5);
  if (!strong.length) return null;
  const lines = strong.map((c) => {
    const t = c.token;
    return `• $${t.symbol} — ${c.smartCount} smart in, ${c.recentCount} in last 10m · ${money((Number(t.mcap_hype) || 0) * usd)} mc\n  ${site}/t/?a=${t.address}`;
  });
  return `Smart Money Radar — live\n\nScout is tracking fresh smart-money buys on Elysium:\n\n${lines.join("\n")}\n\nSignal, not advice.\n— Scout · ArkhamPad`;
}

function catchText(radar, usd, site) {
  const top = radar[0];
  if (!top) return null;
  const t = top.token;
  return `Scout's Catch of the day\n\n$${t.symbol} tops the Smart Money Radar — ${top.smartCount} smart buyers, ${top.recentCount} in the last 10 minutes.\n${money((Number(t.mcap_hype) || 0) * usd)} market cap.\n\n${site}/t/?a=${t.address}\n\nSignal, not advice.\n— Scout · ArkhamPad`;
}

async function sendTelegram(token, chat, text, log) {
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chat, text, disable_web_page_preview: false }),
    });
    if (!r.ok) log(`scout: telegram ${r.status} ${(await r.text()).slice(0, 120)}`);
    return r.ok;
  } catch (e) { log(`scout: telegram ${e.message}`); return false; }
}

// Optional tweet via X API v2 with OAuth 1.0a user context. Best-effort and never throws; only runs when
// all four keys are set. Untested here — the owner should confirm once with real keys.
function xKeys() {
  const k = { ck: process.env.X_API_KEY, cs: process.env.X_API_SECRET, at: process.env.X_ACCESS_TOKEN, ats: process.env.X_ACCESS_SECRET };
  return k.ck && k.cs && k.at && k.ats ? k : null;
}
async function postX(text, log) {
  const k = xKeys();
  if (!k) return;
  try {
    const url = "https://api.twitter.com/2/tweets";
    const oauth = {
      oauth_consumer_key: k.ck, oauth_token: k.at, oauth_signature_method: "HMAC-SHA1",
      oauth_timestamp: String(Math.floor(Date.now() / 1000)), oauth_nonce: crypto.randomBytes(16).toString("hex"), oauth_version: "1.0",
    };
    // signature base string covers only the OAuth params for a JSON body POST (no query/body params)
    const base = ["POST", encodeURIComponent(url), encodeURIComponent(Object.keys(oauth).sort().map((p) => `${p}=${oauth[p]}`).join("&"))].join("&");
    const signingKey = `${encodeURIComponent(k.cs)}&${encodeURIComponent(k.ats)}`;
    oauth.oauth_signature = crypto.createHmac("sha1", signingKey).update(base).digest("base64");
    const header = "OAuth " + Object.keys(oauth).sort().map((p) => `${encodeURIComponent(p)}="${encodeURIComponent(oauth[p])}"`).join(", ");
    const r = await fetch(url, { method: "POST", headers: { authorization: header, "content-type": "application/json" }, body: JSON.stringify({ text: text.slice(0, 280) }) });
    if (!r.ok) log(`scout: x ${r.status} ${(await r.text()).slice(0, 120)}`);
  } catch (e) { log(`scout: x ${e.message}`); }
}

// ---- loop --------------------------------------------------------------------------------------
export function startScout(pool, { log = (...a) => console.log(new Date().toISOString(), ...a) } = {}) {
  const token = (process.env.TG_SCOUT_TOKEN || "").trim();
  const chat = (process.env.TG_SCOUT_CHANNEL || "").trim();
  if (!token || !chat) { log("scout: off (set TG_SCOUT_TOKEN and TG_SCOUT_CHANNEL to post)"); return; }
  const site = (process.env.SCOUT_SITE || "https://arkhampad.com").replace(/\/$/, "");
  const everyMs = Math.max(5, Number(process.env.SCOUT_EVERY_MIN || 30)) * 60_000;
  const catchHour = Math.min(23, Math.max(0, Number(process.env.SCOUT_CATCH_HOUR || 15)));
  log(`scout: posting to Telegram every ${everyMs / 60_000} min; daily catch at ${catchHour}:00 UTC`);

  let lastTopKey = ""; // dedupe: only post when the leading strong coin changes
  let lastCatchDay = "";

  async function tick() {
    try {
      const { tokens, trades, usd } = await load(pool);
      const radar = buildRadar(tokens, trades, usd);

      // daily Scout's Catch
      const now = new Date();
      const day = now.toISOString().slice(0, 10);
      if (now.getUTCHours() >= catchHour && lastCatchDay !== day) {
        const text = catchText(radar, usd, site);
        if (text) { await sendTelegram(token, chat, text, log); await postX(text, log); lastCatchDay = day; }
      }

      // top-signals alert (only on a new strong leader)
      const strong = radar.filter((c) => c.signal === "strong");
      const key = strong.slice(0, 3).map((c) => lc(c.token.address)).join(",");
      if (strong.length && key && key !== lastTopKey) {
        const text = topSignalsText(radar, usd, site);
        if (text) { await sendTelegram(token, chat, text, log); lastTopKey = key; }
      }
    } catch (e) { log(`scout: ${e.message}`); }
  }

  tick();
  setInterval(tick, everyMs);
}

export { buildRadar }; // exported for tests / reuse
