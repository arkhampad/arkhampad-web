// @Arkhampad on X: an auto-poster that tweets ArkhamPad's own updates on a schedule.
// It posts on its own timeline only; it never replies to, follows or reads anyone else.
//
// Goal: pull people who trade (or want to trade) on Elysium over to ArkhamPad. Every post is a
// FOMO / curiosity hook about the opportunity of trading on Elysium and ArkhamPad's edge — trade
// any Elysium coin with USDC OR HYPE, smart-money signals, and rug/safety checks, all in one place.
// Every post features the ArkhamPad brand, links arkhampad.com, and uses a DIFFERENT, heavy hashtag
// set. About 30% of the day's posts tag an Elysium account (@Enter_Elysium / @HyperliquidX) — never
// a competitor. No made-up numbers, no "mainnet soon".
//
// Runs as its own Railway service: root /indexer, start command `node arkx.mjs`.
// Env:
//   ARK_X_API_KEY, ARK_X_API_SECRET, ARK_X_ACCESS_TOKEN, ARK_X_ACCESS_SECRET
//       the @Arkhampad app's OAuth 1.0a keys (console.x.com). Without all four this does nothing.
//   DATABASE_URL     the same Postgres as the indexer (used only to remember what was posted)
//   ARK_X_OFF=1      switch off          ARK_X_DRY=1   log what it would post, post nothing
//
// Schedule (Türkiye time, UTC+3): mornings ~06:00–12:45 roughly every 45 min, then evenings
// ~15:15–22:40 roughly every 45 min. Each slot is moved by a fixed ±12 min per day, so posts never
// go out at the same minute two days running. A line is not reused until every other line has been
// posted (a 10-day no-repeat window in the database), so text and hashtags change every time.

import { createHmac, randomBytes } from "node:crypto";
import pg from "pg";

const TR = 3 * 3600e3;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString(), "arkx:", ...a);

// ------------------------------------------------------------------ X API (OAuth 1.0a, user context)
const API = "https://api.x.com";
const enc = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

function oauthHeader(method, url, keys, nonce = randomBytes(16).toString("hex"), ts = Math.floor(Date.now() / 1000)) {
  const o = {
    oauth_consumer_key: keys.apiKey,
    oauth_nonce: nonce,
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: String(ts),
    oauth_token: keys.accessToken,
    oauth_version: "1.0",
  };
  const u = new URL(url);
  const params = [...Object.entries(o), ...u.searchParams.entries()]
    .map(([k, v]) => [enc(k), enc(v)])
    .sort((a, b) => (a[0] === b[0] ? (a[1] < b[1] ? -1 : 1) : a[0] < b[0] ? -1 : 1));
  const base = [method.toUpperCase(), enc(`${u.origin}${u.pathname}`), enc(params.map(([k, v]) => `${k}=${v}`).join("&"))].join("&");
  const sig = createHmac("sha1", `${enc(keys.apiSecret)}&${enc(keys.accessSecret)}`).update(base).digest("base64");
  return "OAuth " + Object.entries({ ...o, oauth_signature: sig }).map(([k, v]) => `${enc(k)}="${enc(v)}"`).join(", ");
}

async function postTweet(keys, text) {
  const url = `${API}/2/tweets`;
  const r = await fetch(url, {
    method: "POST",
    headers: { authorization: oauthHeader("POST", url, keys), "content-type": "application/json" },
    body: JSON.stringify({ text }),
  });
  const body = await r.text();
  if (!r.ok) throw new Error(`X /2/tweets ${r.status}: ${body.slice(0, 300)}`);
  try { return JSON.parse(body)?.data?.id ?? null; } catch { return null; }
}

// ------------------------------------------------------------------ the words
// Each entry is [id, text]. ids are what "not used lately" remembers. FOMO / curiosity hooks aimed
// at Elysium traders, every one featuring ArkhamPad + the arkhampad.com link + its own hashtag set.
// ~30% tag @Enter_Elysium or @HyperliquidX (never a competitor).
const LINK = "arkhampad.com";
function POSTS() {
  return [
    ["a1", `the people making real money on Elysium this week are already trading. are you? 👀\n\nArkhamPad — every Elysium coin, with USDC or HYPE\n\n${LINK}\n\n#Elysium #DeFi #SmartMoney #CryptoTrading #HYPE`],
    ["a2", `new chain, fresh coins, barely any crowd yet\n\ntrade them on ArkhamPad with USDC or HYPE — your call, no bridges\n\n${LINK}\n\n#Elysium #Altcoins #OnChain #Crypto #NewChain #USDC`],
    ["a3", `the smart money is already moving on @Enter_Elysium 👀\n\nArkhamPad shows you who's really buying, before the crowd catches on\n\n${LINK}\n\n#Elysium #SmartMoney #Trading #Web3 #CryptoNews`],
    ["a4", `USDC or HYPE — trade any Elysium coin either way on ArkhamPad. no wrapping, no friction\n\n${LINK}\n\n#Elysium #USDC #HYPE #DeFi #CryptoTrading #Hyperliquid`],
    ["a5", `everyone's about to find out what's trading on @Enter_Elysium 👀\n\nyou can already be in. ArkhamPad, USDC or HYPE\n\n${LINK}\n\n#Elysium #Altcoins #Crypto #OnChain #GEM`],
    ["a6", `Arkham is Elysium's launchpad.\n\nsee who's buying, check it's safe, trade it with USDC or HYPE — all on one page\n\n${LINK}\n\n#Elysium #SmartMoney #RugCheck #DeFi #Trading`],
    ["a7", `the first traders on a new chain are the ones who eat 👀\n\nElysium is early. ArkhamPad lets you trade it now, USDC or HYPE\n\n${LINK}\n\n#Elysium #NewChain #Altcoins #100x #CryptoTrading`],
    ["a8", `rug checks and dev reputation on every coin 👀\n\ntrade Elysium with your eyes open — and with USDC or HYPE — on ArkhamPad\n\n${LINK}\n\n#Elysium #RugCheck #CryptoSafety #DeFi #DYOR`],
    ["a9", `coins are moving on @HyperliquidX's new chain right now while you scroll\n\njump in on ArkhamPad, USDC or HYPE\n\n${LINK}\n\n#Elysium #HYPE #Hyperliquid #Trading #Altcoins`],
    ["a10", `you don't need HYPE to start. trade Elysium coins with USDC too — ArkhamPad handles the rest\n\n${LINK}\n\n#Elysium #USDC #DeFi #Crypto #OnChain #CryptoTrading`],
    ["a11", `the quiet window before a chain gets loud is where the money's made 👀\n\n@Enter_Elysium is in it. trade on ArkhamPad\n\n${LINK}\n\n#Elysium #SmartMoney #Altcoins #GEM #NewChain`],
    ["a12", `Arkham is Elysium's launchpad.\n\ndiscover what's pumping, trade it in one tap — USDC or HYPE, your choice\n\n${LINK}\n\n#Elysium #CryptoTrading #DeFi #Memecoins #HYPE`],
    ["a13", `smart wallets leave a trail. ArkhamPad reads it live so you trade where the money's actually going on Elysium\n\n${LINK}\n\n#Elysium #SmartMoney #OnChain #Trading #Web3`],
    ["a14", `trade the whole chain from one page — every Elysium coin, USDC or HYPE, live prices\n\nArkhamPad\n\n${LINK}\n\n#Elysium #DeFi #CryptoTrading #Altcoins #USDC`],
    ["a15", `@Enter_Elysium is early and wide open 👀\n\nthe traders who show up first win. ArkhamPad, USDC or HYPE\n\n${LINK}\n\n#Elysium #NewChain #Altcoins #100x #CryptoGems`],
    ["a16", `before you ape a coin on Elysium, see its dev's track record and rug score\n\nArkhamPad shows it, then you trade — USDC or HYPE\n\n${LINK}\n\n#Elysium #RugCheck #CryptoSafety #OnChain #Trading`],
    ["a17", `the trade you miss on @Enter_Elysium today is the screenshot you regret next week 👀\n\nArkhamPad. USDC or HYPE\n\n${LINK}\n\n#Elysium #Altcoins #CryptoTrading #GEM #SmartMoney`],
    ["a18", `no bridge marathon, no wrapped tokens. USDC or HYPE straight into any Elysium coin on ArkhamPad\n\n${LINK}\n\n#Elysium #USDC #HYPE #DeFi #OnChain`],
    ["a19", `Arkham is Elysium's launchpad.\n\nwhere the smart money, the safety checks and the trade all live on one page\n\n${LINK}\n\n#Elysium #SmartMoney #RugCheck #Trading #Web3`],
    ["a20", `the money on @HyperliquidX is hunting the next Elysium runner 👀\n\nbe early. trade on ArkhamPad with USDC or HYPE\n\n${LINK}\n\n#Elysium #HYPE #Hyperliquid #SmartMoney #Altcoins`],
    ["a21", `whale buys, sized to each coin, flagged live 👀\n\ntrade the moves that matter on Elysium — ArkhamPad, USDC or HYPE\n\n${LINK}\n\n#Elysium #Whales #SmartMoney #Trading #DeFi`],
    ["a22", `fresh launches on Elysium surface the second they go live on ArkhamPad\n\ncatch them early, trade USDC or HYPE\n\n${LINK}\n\n#Elysium #TokenLaunch #Altcoins #NewChain #CryptoTrading`],
    ["a23", `trading on Elysium shouldn't mean 12 steps. open ArkhamPad, pick USDC or HYPE, go\n\n${LINK}\n\n#Elysium #DeFi #USDC #OnChain #Crypto`],
    ["a24", `@Enter_Elysium coins, all in one place, with the data to trade them right 👀\n\nArkhamPad — USDC or HYPE\n\n${LINK}\n\n#Elysium #Altcoins #SmartMoney #OnChain #Trading`],
    ["a25", `the crowd shows up late, every time 👀\n\nbeat them to Elysium. trade on ArkhamPad with USDC or HYPE\n\n${LINK}\n\n#Elysium #Altcoins #CryptoTrading #GEM #Degens`],
    ["a26", `Arkham is Elysium's launchpad.\n\ntrade any coin with USDC or HYPE, see the smart money, skip the rugs\n\n${LINK}\n\n#Elysium #SmartMoney #RugCheck #HYPE #DeFi`],
    ["a27", `momentum, buy pressure and fresh launches on @Enter_Elysium — ranked live so you know what's moving right now\n\ntrade it on ArkhamPad\n\n${LINK}\n\n#Elysium #SmartMoney #Trading #Altcoins #OnChain`],
    ["a28", `two ways in, one place to trade: USDC or HYPE, every Elysium coin, on ArkhamPad 👀\n\n${LINK}\n\n#Elysium #USDC #HYPE #OnChain #Trading #Memecoins`],
  ];
}

// ------------------------------------------------------------------ the day's plan (Türkiye time)
const PLAN = [
  // morning: ~every 45 min, 06:00–12:45
  "06:00", "06:45", "07:30", "08:15", "09:00", "09:45", "10:30", "11:15", "12:00", "12:45",
  // evening: ~every 45 min, 15:15–22:40
  "15:15", "16:00", "16:45", "17:30", "18:15", "19:00", "19:45", "20:30", "21:15", "22:00", "22:40",
];

/** Today's time (ms) for a slot, moved by a fixed ±12 min for that day + slot. */
function slotTime(at, now = Date.now()) {
  const day = new Date(now + TR).toISOString().slice(0, 10);
  let h = 2166136261;
  for (const ch of `${day}:${at}`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  const jitter = (h % 25) - 12; // minutes
  const [hh, mm] = at.split(":").map(Number);
  return Date.parse(`${day}T00:00:00Z`) - TR + ((hh * 60 + mm + jitter) * 60e3);
}

/** One line not posted in the last 10 days (else any). */
async function fresh(pool, list) {
  const { rows } = await pool
    .query(`select tpl from arkx_posts where posted_at > now() - interval '10 days'`)
    .catch(() => ({ rows: [] }));
  const used = new Set(rows.map((r) => r.tpl));
  const left = list.filter(([id]) => !used.has(id));
  return (left.length ? left : list)[Math.floor(Math.random() * (left.length || list.length))];
}

async function main() {
  if (process.env.ARK_X_OFF === "1") return log("off (ARK_X_OFF=1)");
  const keys = {
    apiKey: process.env.ARK_X_API_KEY,
    apiSecret: process.env.ARK_X_API_SECRET,
    accessToken: process.env.ARK_X_ACCESS_TOKEN,
    accessSecret: process.env.ARK_X_ACCESS_SECRET,
  };
  if (!keys.apiKey || !keys.apiSecret || !keys.accessToken || !keys.accessSecret) return log("no X keys set — nothing to do");
  const dry = process.env.ARK_X_DRY === "1";

  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
  await pool.query(`create table if not exists arkx_posts (id bigserial primary key, slot text, tpl text, post_id text, posted_at timestamptz default now())`);
  log(`on${dry ? " (dry run)" : ""}; ${PLAN.length} posts a day`);

  // a tiny health endpoint so Railway sees the service as up
  if (process.env.PORT) {
    const http = await import("node:http");
    http.createServer((_, res) => res.end("ok")).listen(Number(process.env.PORT));
  }

  for (;;) {
    try {
      const now = Date.now();
      const today = new Date(now + TR).toISOString().slice(0, 10);
      for (const at of PLAN) {
        const t = slotTime(at, now);
        if (now < t || now > t + 3 * 3600e3) continue; // its time has come, and no more than 3h late
        const done = await pool.query(`select 1 from arkx_posts where slot = $1 and posted_at::date = $2 limit 1`, [at, today]).catch(() => ({ rows: [] }));
        if (done.rows.length) continue;
        const [tpl, text] = await fresh(pool, POSTS());
        if (dry) {
          log(`[dry] ${at} ${tpl}\n${text}`);
          await pool.query(`insert into arkx_posts (slot, tpl, post_id) values ($1,$2,$3)`, [at, tpl, "dry"]);
        } else {
          const id = await postTweet(keys, text);
          await pool.query(`insert into arkx_posts (slot, tpl, post_id) values ($1,$2,$3)`, [at, tpl, id ?? ""]);
          log(`posted ${at} ${tpl} -> ${id}`);
        }
        break; // one post per pass
      }
    } catch (e) {
      log(String(e.message).slice(0, 300));
      if (/ 4\d\d:/.test(String(e.message))) await sleep(20 * 60e3); // X refused (keys/credits): back off
    }
    await sleep(60e3);
  }
}

main().catch((e) => { log("fatal:", e.message); process.exit(1); });
