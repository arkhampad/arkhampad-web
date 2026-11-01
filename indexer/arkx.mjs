// @Arkhampad on X: an auto-poster that tweets ArkhamPad's own corporate updates on a schedule.
// It posts on its own timeline only; it never replies to, follows or reads anyone else.
//
// Style (fixed): every post opens with the line "Arkham is Elysium's launchpad.", stays short and
// professional (a company voice, not an influencer), adds something real for the reader, features
// the ArkhamPad brand, links arkhampad.com, carries a DIFFERENT hashtag set each time, and never
// names a competitor or says "mainnet soon".
//
// Runs as its own Railway service: root /indexer, start command `node arkx.mjs`.
// Env:
//   ARK_X_API_KEY, ARK_X_API_SECRET, ARK_X_ACCESS_TOKEN, ARK_X_ACCESS_SECRET
//       the @Arkhampad app's OAuth 1.0a keys (console.x.com). Without all four this does nothing.
//   DATABASE_URL     the same Postgres as the indexer (used only to remember what was posted)
//   ARK_X_OFF=1      switch off          ARK_X_DRY=1   log what it would post, post nothing
//
// Schedule: 8 posts a day, Türkiye time (UTC+3), 09:00–23:00 every ~2 hours, each moved by a fixed
// ±20 min per day so it never goes out at the same minute two days running. A line is not reused
// until every other line has been posted (a 10-day no-repeat window in the database).

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
// Each entry is [id, text]. ids are what "not used lately" remembers. 24 lines, each opening with
// the fixed ArkhamPad line, each with its own hashtag set, the arkhampad.com link, no competitors.
const LINK = "arkhampad.com";
const OPEN = "Arkham is Elysium's launchpad.";
function POSTS() {
  return [
    ["a1", `${OPEN}\n\nTrade any coin on Elysium and watch the smart money move in real time — all in one place.\n\n${LINK}\n\n#Elysium #DeFi #OnChain #SmartMoney`],
    ["a2", `${OPEN}\n\nEvery token on ArkhamPad carries a live dev reputation and rug check right on its page. Trade what's real.\n\n${LINK}\n\n#Elysium #RugCheck #CryptoSafety #Web3`],
    ["a3", `${OPEN}\n\nLaunch a coin on Elysium in under a minute. No code, fair from the very first trade.\n\n${LINK}\n\n#Elysium #TokenLaunch #Crypto #Builders`],
    ["a4", `${OPEN}\n\nThe Smart Money Radar reads the chain live and surfaces which wallets are really buying, before the crowd notices.\n\n${LINK}\n\n#Elysium #SmartMoney #Trading #OnChain`],
    ["a5", `${OPEN}\n\nOne place to discover, launch and trade Elysium coins — with the on-chain data you need next to every one.\n\n${LINK}\n\n#Elysium #DeFi #CryptoTrading #Blockchain`],
    ["a6", `${OPEN}\n\nSafety Shield flags mint risks, liquidity locks and holder concentration on every coin. Due diligence, built in.\n\n${LINK}\n\n#Elysium #CryptoSafety #DeFiSecurity #DYOR`],
    ["a7", `${OPEN}\n\nTrade the whole chain from one page. Any Elysium coin, any pool, with live pricing.\n\n${LINK}\n\n#Elysium #Trading #OnChain #Altcoins`],
    ["a8", `${OPEN}\n\nSee who's buying before you do. ArkhamPad brings smart-money signals to every coin on Elysium.\n\n${LINK}\n\n#Elysium #SmartMoney #CryptoNews #DeFi`],
    ["a9", `${OPEN}\n\nCreate your coin, share it, and let it trade from the first second — no gatekeepers.\n\n${LINK}\n\n#Elysium #TokenLaunch #Web3 #LaunchPad`],
    ["a10", `${OPEN}\n\nA dev's track record follows them from coin to coin. ArkhamPad shows it, so you trade with open eyes.\n\n${LINK}\n\n#Elysium #RugCheck #CryptoSafety #OnChain`],
    ["a11", `${OPEN}\n\nMomentum, buy pressure and fresh launches, ranked live. Know what's waking up on Elysium right now.\n\n${LINK}\n\n#Elysium #Trading #SmartMoney #Altcoins`],
    ["a12", `${OPEN}\n\nBuilt on Elysium, for Elysium. Launch, trade and track coins where the chain lives.\n\n${LINK}\n\n#Elysium #DeFi #Blockchain #HYPE`],
    ["a13", `${OPEN}\n\nRug checks and dev reputation on every page mean fewer traps and better trades for everyone.\n\n${LINK}\n\n#Elysium #DeFiSecurity #RugCheck #Crypto`],
    ["a14", `${OPEN}\n\nThe fastest way to put a coin live on Elysium — and the clearest way to trade one.\n\n${LINK}\n\n#Elysium #TokenLaunch #CryptoTrading #Builders`],
    ["a15", `${OPEN}\n\nSmart money leaves a trail on-chain. ArkhamPad reads it live and shows you where it's heading.\n\n${LINK}\n\n#Elysium #SmartMoney #OnChain #Web3`],
    ["a16", `${OPEN}\n\nDiscover what's moving, check it's safe, and trade it — without leaving the page.\n\n${LINK}\n\n#Elysium #DeFi #CryptoSafety #Trading`],
    ["a17", `${OPEN}\n\nEvery Elysium coin, one home. Live charts, holders, and the signals that matter.\n\n${LINK}\n\n#Elysium #OnChain #Altcoins #CryptoNews`],
    ["a18", `${OPEN}\n\nLaunch fair, trade informed. ArkhamPad gives every coin a clean start and every trader a clear view.\n\n${LINK}\n\n#Elysium #TokenLaunch #DeFi #DYOR`],
    ["a19", `${OPEN}\n\nWhale buys, sized to each coin. ArkhamPad shows the moves that actually mean something.\n\n${LINK}\n\n#Elysium #SmartMoney #Trading #Crypto`],
    ["a20", `${OPEN}\n\nThe launchpad that also watches the chain for you — smart money in, risks flagged, all live.\n\n${LINK}\n\n#Elysium #DeFi #CryptoSafety #OnChain`],
    ["a21", `${OPEN}\n\nFrom idea to live coin on Elysium in minutes. Your coin, your terms.\n\n${LINK}\n\n#Elysium #TokenLaunch #Builders #Web3`],
    ["a22", `${OPEN}\n\nTrade with the full picture: price, holders, dev history and smart-money flow, on one screen.\n\n${LINK}\n\n#Elysium #Trading #SmartMoney #OnChain`],
    ["a23", `${OPEN}\n\nSafety first, speed always. Launch and trade Elysium coins with the checks already done for you.\n\n${LINK}\n\n#Elysium #CryptoSafety #DeFi #RugCheck`],
    ["a24", `${OPEN}\n\nThe home of coins on Elysium — launch them, find them, trade them, and see the money move.\n\n${LINK}\n\n#Elysium #DeFi #CryptoTrading #Altcoins`],
  ];
}

// ------------------------------------------------------------------ the day's plan (Türkiye time)
const PLAN = ["09:00", "11:00", "13:00", "15:00", "17:00", "19:00", "21:00", "23:00"];

/** Today's time (ms) for a slot, moved by a fixed ±20 min for that day + slot. */
function slotTime(at, now = Date.now()) {
  const day = new Date(now + TR).toISOString().slice(0, 10);
  let h = 2166136261;
  for (const ch of `${day}:${at}`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  const jitter = (h % 41) - 20; // minutes
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
