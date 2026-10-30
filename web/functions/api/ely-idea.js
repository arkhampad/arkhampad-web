// POST /api/ely-idea  { address? } -> { name, ticker, description, picture, left }
// One fresh meme coin idea that fits what is trending on Elysium right now. The trend list (top coins
// by 24h volume, from our Elysium index) is refreshed every 2 hours and shared by all visitors.
// 10 ideas per visitor per day (counted by IP and by wallet, through Supabase ely_ai_take).
import { clean, parse } from "./ideas.js";

const MODELS = [
  "@cf/meta/llama-4-scout-17b-16e-instruct",
  "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
  "@cf/mistralai/mistral-small-3.1-24b-instruct",
];
const TREND_TTL = 2 * 3600; // seconds
const CACHE_KEY = "https://arkhampad.com/__cache/ely-trends-v1";
const LIMIT = 10;

// The database address is public (the site uses the same one); Cloudflare's runtime may not have the
// NEXT_PUBLIC_* build variables, so fall back to it. Without this the daily limit never counted.
const SB_URL = "https://yvdudswzmdziwnfurwir.supabase.co";
const SB_KEY = "sb_publishable_S49UWqqXDzSaRbjBsAfYaA_kjfxyRPB";
const sbUrl = (env) => env.NEXT_PUBLIC_SUPABASE_URL || SB_URL;
const sbKey = (env) => env.NEXT_PUBLIC_SUPABASE_KEY || SB_KEY;

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

async function trends(env, waitUntil) {
  const cache = caches.default;
  const hit = await cache.match(CACHE_KEY);
  if (hit) return hit.json();
  const url = `${sbUrl(env)}/rest/v1/ely_tokens?select=name,symbol,description,vol24_hype,change24&ours=eq.false&order=vol24_hype.desc&limit=30`;
  let rows = [];
  try {
    const r = await fetch(url, { headers: { apikey: sbKey(env), authorization: `Bearer ${sbKey(env)}` } });
    if (r.ok) rows = await r.json();
  } catch {}
  const list = rows
    .filter((t) => t.vol24_hype > 0)
    .map((t) => ({ name: String(t.name).slice(0, 30), symbol: String(t.symbol).slice(0, 12), about: t.description ? String(t.description).replace(/\s+/g, " ").slice(0, 90) : "", change: t.change24 == null ? null : Math.round(t.change24) }));
  const res = new Response(JSON.stringify(list), { headers: { "content-type": "application/json", "cache-control": `max-age=${TREND_TTL}` } });
  if (list.length) waitUntil(cache.put(CACHE_KEY, res.clone()));
  return list;
}

async function take(env, key) {
  try {
    const r = await fetch(`${sbUrl(env)}/rest/v1/rpc/ely_ai_take`, {
      method: "POST",
      headers: { apikey: sbKey(env), authorization: `Bearer ${sbKey(env)}`, "content-type": "application/json" },
      body: JSON.stringify({ p_key: key }),
    });
    if (!r.ok) return 0; // counting is down: don't block people
    return Number(await r.json()) || 0;
  } catch {
    return 0;
  }
}

/** One of these is picked at random each time, so every tap gives a different kind of coin. */
const THEMES = [
  "a mythic creature that guards the gates of Elysium (Elysium means paradise in Greek myth)",
  "an animal mascot who just bridged to Elysium and is way too early",
  "a joke about gas being paid in HYPE",
  "a hero from Greek mythology reimagined as a degen trader on Elysium",
  "a cute animal that lives on a floating island in the Elysian Fields",
  "a meme about sub-second blocks: something absurdly fast",
  "a creature made of glowing teal light, the color of Elysium",
  "a meme about staking and liquid staking (Kinetiq is the team behind Elysium)",
  "an animal astronaut landing on a brand new chain",
  "a lazy creature that sleeps in paradise while its bags grow",
  "a tiny god of luck who blesses early buyers on Elysium",
  "a meme about being first on a new chain before the crowd",
  "a frog, dog, cat or bird with a fresh Elysium twist (pick one, make it unusual)",
  "an ancient Greek object (lyre, amphora, laurel, olive tree) turned into a funny character",
  "a meme about the Nov 9 Elysium mainnet launch party",
  "a robot or AI agent that trades on Elysium",
];

const SYSTEM = `You invent meme coins for Elysium, a fast new blockchain in the Hyperliquid ecosystem where the currency is HYPE.
You get the list of coins trending on Elysium right now. Study what is working: the kind of humor, animals or characters, themes, word style and ticker style.
Then invent ONE brand-new coin that would fit right in with that crowd and could trend next.
Rules: it must be clearly original. Never reuse or slightly change any listed name or ticker. English only.
Reply with JSON only, no other text, exactly: {"name":"...","ticker":"...","description":"...","picture":"..."}
Name: 2-24 characters, catchy. Ticker: 3-6 capital letters A-Z. Description: one or two fun sentences, max 140 characters.
Picture: a vivid 20-40 word art direction for the logo: one character or object, its expression and pose, an accessory, the colors (teal and glowing accents fit Elysium), and the lighting.
No real people, no brands or logos, no promises of profit or price, nothing hateful or sexual.`;

export async function onRequestPost({ request, env, waitUntil }) {
  if (!env.AI) return json({ error: "AI is not set up on this site yet." }, 503);
  let address = "";
  let avoid = [];
  try {
    const b = await request.json();
    address = String(b.address ?? "").toLowerCase().slice(0, 42);
    // names this visitor already got: never hand them out again
    if (Array.isArray(b.avoid)) avoid = b.avoid.map((x) => String(x).toLowerCase().replace(/[^a-z0-9 ]/g, "").slice(0, 24)).filter(Boolean).slice(0, 30);
  } catch {}
  const ip = request.headers.get("cf-connecting-ip") || "unknown";
  const [byIp, byWallet] = await Promise.all([take(env, `ip:${ip}`), /^0x[0-9a-f]{40}$/.test(address) ? take(env, `w:${address}`) : 0]);
  const used = Math.max(byIp, byWallet);
  if (used > LIMIT) return json({ error: `You've used today's ${LIMIT} AI ideas. They reset at midnight UTC.`, left: 0 }, 429);
  const list = await trends(env, waitUntil);
  const taken = new Set([...list.flatMap((t) => [t.name.toLowerCase(), t.symbol.toLowerCase()]), ...avoid]);
  const brief = list.length
    ? list.map((t, i) => `${i + 1}. ${t.name} ($${t.symbol})${t.change != null ? `, ${t.change > 0 ? "+" : ""}${t.change}% today` : ""}${t.about ? `: ${t.about}` : ""}`).join("\n")
    : "(no data right now: invent something that fits a young, playful crypto chain)";
  for (const model of MODELS) {
    try {
      const seed = Math.floor(Math.random() * 1e9);
      const out = await env.AI.run(model, {
        messages: [{ role: "system", content: SYSTEM }, { role: "user", content: `Trending on Elysium now:\n${brief}\n\nTheme for this coin: ${THEMES[seed % THEMES.length]}.${avoid.length ? `\nDo NOT use any of these names or tickers (already used): ${avoid.join(", ")}.` : ""}\nThe name should feel like it belongs on Elysium (paradise, myth, teal light, HYPE, speed, being early) without being literally "Elysium". Invent one new coin. (variation ${seed})` }],
        max_tokens: 300, temperature: 1.05, seed,
      });
      const idea = clean(parse(out?.response ?? out));
      const nm = idea?.name.toLowerCase().replace(/[^a-z0-9 ]/g, "");
      if (idea && !taken.has(nm) && !taken.has(idea.name.toLowerCase()) && !taken.has(idea.ticker.toLowerCase())) return json({ ...idea, left: Math.max(0, LIMIT - used) });
    } catch { /* next model */ }
  }
  return json({ error: "AI is busy right now. Try again in a few seconds." }, 503);
}
