// GET /api/trends -> { topics: [{ title, emoji, why, idea, heat }], scannedAt }
// "Create Trend Coin": every 5 minutes it reads what is moving right now (new and
// trending dex coins, Google trending searches, fresh news and Reddit), and the AI
// (Workers AI, binding "AI") picks the 3 hottest topics a meme coin could ride.
// The result is cached at Cloudflare's edge, so all visitors share one scan.
const FRESH_MS = 5 * 60_000; // scan again after 5 minutes
const STALE_MS = 45 * 60_000; // older than this: wait for a new scan instead of showing it
const CACHE_KEY = "https://arkhampad.com/__cache/trends-v1";

const MODELS = [
  "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
  "@cf/meta/llama-4-scout-17b-16e-instruct",
  "@cf/mistralai/mistral-small-3.1-24b-instruct",
];

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const UA = { "user-agent": "Mozilla/5.0 (compatible; ArkhamPadTrends/1.0; +https://arkhampad.com)", accept: "application/json, application/xml, text/xml, */*" };

async function get(url, kind = "json") {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 6000);
  try {
    const r = await fetch(url, { headers: UA, signal: ctl.signal, cf: { cacheTtl: 120 } });
    if (!r.ok) return null;
    return kind === "json" ? await r.json() : await r.text();
  } catch { return null; } finally { clearTimeout(t); }
}

const tidy = (s, n = 90) => String(s ?? "").replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim().slice(0, n);
const rssTitles = (xml, n) => [...String(xml ?? "").matchAll(/<item>[\s\S]*?<title>([\s\S]*?)<\/title>/g)].slice(0, n).map((m) => tidy(m[1].replace(/<!\[CDATA\[|\]\]>/g, ""), 110));

/** Reads every source in parallel. A source that is down or blocked is simply skipped. */
async function collect() {
  const news = (q) => `https://news.google.com/rss/search?q=${encodeURIComponent(q)}+when:3h&hl=en-US&gl=US&ceid=US:en`;
  const [boosts, profiles, gecko, cg, gtrends, nCrypto, nMusk, nCz, nViral, reddit] = await Promise.all([
    get("https://api.dexscreener.com/token-boosts/top/v1"),
    get("https://api.dexscreener.com/token-profiles/latest/v1"),
    get("https://api.geckoterminal.com/api/v2/networks/trending_pools?page=1"),
    get("https://api.coingecko.com/api/v3/search/trending"),
    get("https://trends.google.com/trending/rss?geo=US", "text"),
    get(news("memecoin OR \"meme coin\""), "text"),
    get(news("\"Elon Musk\" post"), "text"),
    get(news("CZ Binance"), "text"),
    get(news("viral meme"), "text"),
    get("https://www.reddit.com/r/memecoins/hot.json?limit=20"),
  ]);
  const out = [];
  const add = (label, lines) => { const l = lines.filter(Boolean); if (l.length) out.push(`## ${label}\n` + l.map((x) => `- ${x}`).join("\n")); };
  const desc = (a) => (Array.isArray(a) ? a : []).slice(0, 25).map((t) => tidy(`${t.chainId}: ${t.description || t.url?.split("/").pop() || ""}`, 100));
  add("Dex: most promoted coins right now", desc(boosts));
  add("Dex: newest coin profiles", desc(profiles));
  add("Dex: trending pools (name, 1h %, 24h volume)", (gecko?.data ?? []).slice(0, 20).map((p) => {
    const a = p.attributes || {};
    return tidy(`${a.name} (${p.relationships?.network?.data?.id ?? ""}) 1h ${a.price_change_percentage?.h1 ?? "?"}% vol $${Math.round(Number(a.volume_usd?.h24 || 0)).toLocaleString("en-US")}`, 110);
  }));
  add("CoinGecko trending coins", (cg?.coins ?? []).slice(0, 15).map((c) => tidy(`${c.item?.name} (${c.item?.symbol})`)));
  add("Google trending searches (US)", rssTitles(gtrends, 20));
  add("News: meme coins (last 3h)", rssTitles(nCrypto, 10));
  add("News: Elon Musk (last 3h)", rssTitles(nMusk, 8));
  add("News: CZ / Binance (last 3h)", rssTitles(nCz, 6));
  add("News: viral memes (last 3h)", rssTitles(nViral, 8));
  add("Reddit r/memecoins hot", (reddit?.data?.children ?? []).slice(0, 15).map((c) => tidy(`${c.data?.title} (${c.data?.score} pts)`, 110)));
  return { text: out.join("\n\n").slice(0, 9000), sources: out.length };
}

const SYSTEM = `You are a meme coin trend scout. You get raw signals scraped in the last minutes: dex coins, Google trending searches, news headlines and Reddit.
Find the 3 HOTTEST topics a brand-new meme coin could ride RIGHT NOW. Rules:
- Prefer topics that show up in several signals at once (e.g. many new dex coins on the same theme, or a viral post that dex coins are already copying).
- Prefer the newest and fastest-rising over old famous coins. Never pick an existing big coin itself (e.g. DOGE, PEPE) as a topic.
- A topic can be a viral post by a famous person, an animal or character meme, a news moment, or a dex theme wave.
- Skip anything tragic, hateful, sexual, political violence, scams or hacks.
Reply with JSON only, no other text:
{"topics":[{"title":"...","emoji":"...","why":"...","idea":"...","heat":0}]}
title: max 40 characters. emoji: one emoji. why: max 130 characters, concrete (what happened, where it shows). idea: one sentence for a coin designer, max 200 characters. heat: 1-100.`;

function parse(text) {
  if (text && typeof text === "object") return text;
  const m = String(text ?? "").match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

function clean(t) {
  if (!t || typeof t !== "object") return null;
  const title = tidy(t.title, 40), why = tidy(t.why, 140), idea = tidy(t.idea, 220);
  const emoji = (String(t.emoji ?? "").match(/\p{Extended_Pictographic}/u) ?? ["🔥"])[0];
  const heat = Math.max(1, Math.min(100, Math.round(Number(t.heat) || 50)));
  if (title.length < 3 || idea.length < 10) return null;
  return { title, emoji, why, idea, heat };
}

async function scan(env) {
  const { text, sources } = await collect();
  if (sources < 2) throw new Error("not enough signals");
  for (const model of MODELS) {
    try {
      const out = await env.AI.run(model, { messages: [{ role: "system", content: SYSTEM }, { role: "user", content: text }], max_tokens: 700, temperature: 0.4 });
      const topics = (parse(out?.response ?? out)?.topics ?? []).map(clean).filter(Boolean).sort((a, b) => b.heat - a.heat).slice(0, 3);
      if (topics.length === 3) return { topics, scannedAt: Date.now(), sources };
    } catch { /* next model */ }
  }
  throw new Error("AI busy");
}

async function save(data) {
  await caches.default.put(CACHE_KEY, new Response(JSON.stringify(data), { headers: { "content-type": "application/json", "cache-control": `public, max-age=${STALE_MS / 1000}` } }));
}

export async function onRequestGet({ env, waitUntil }) {
  if (!env.AI) return json({ error: "Trends are not set up yet." }, 503);
  let cached = null;
  try { const r = await caches.default.match(CACHE_KEY); if (r) cached = await r.json(); } catch { /* no cache */ }
  const age = cached ? Date.now() - cached.scannedAt : Infinity;
  const checked = cached ? Date.now() - (cached.checkedAt || cached.scannedAt) : Infinity;
  if (cached && checked < FRESH_MS) return json(cached);
  if (cached && age < STALE_MS) {
    // show the last scan at once and refresh in the background for the next visitor;
    // checkedAt stops many visitors from starting the same scan at the same time
    waitUntil(save({ ...cached, checkedAt: Date.now() }).then(() => scan(env)).then(save).catch(() => {}));
    return json(cached);
  }
  try {
    const data = await scan(env);
    waitUntil(save(data));
    return json(data);
  } catch {
    if (cached) return json(cached);
    return json({ error: "Couldn't read the trends right now. Try again in a minute." }, 503);
  }
}
