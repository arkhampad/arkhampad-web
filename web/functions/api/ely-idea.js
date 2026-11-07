// POST /api/ely-idea  { address? } -> { name, ticker, description, picture, left }
// One fresh meme coin idea that fits what is trending on Elysium right now. The trend list (top coins
// by 24h volume, from our Elysium index) is refreshed every 2 hours and shared by all visitors.
// 100 ideas per wallet per day (20 signed out, per IP) (counted by IP and by wallet, through Supabase ely_ai_take).
import { clean, parse } from "./ideas.js";

const MODELS = [
  "@cf/meta/llama-4-scout-17b-16e-instruct",
  "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
  "@cf/mistralai/mistral-small-3.1-24b-instruct",
];
const TREND_TTL = 30 * 60; // seconds: what is hot changes fast, so 30 minutes
const CACHE_KEY = "https://arkhampad.com/__cache/ely-trends-v2";
const RECENT_KEY = "https://arkhampad.com/__cache/ely-recent-v1";
const LIMIT = 100;

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
  const base = `${sbUrl(env)}/rest/v1/ely_tokens?select=name,symbol,description,vol24_hype,vol6h_hype,change24&ours=eq.false`;
  const since = new Date(Date.now() - 24 * 3600e3).toISOString();
  const get = async (q) => {
    try {
      const r = await fetch(base + q, { headers: { apikey: sbKey(env), authorization: `Bearer ${sbKey(env)}` } });
      return r.ok ? await r.json() : [];
    } catch { return []; }
  };
  // what is hot right now (last 6 hours) + the best coins launched in the last 24 hours
  const [hot, fresh] = await Promise.all([
    get("&order=vol6h_hype.desc.nullslast&limit=15"),
    get(`&created_at=gte.${since}&order=vol24_hype.desc.nullslast&limit=15`),
  ]);
  const seen = new Set();
  const list = [...hot, ...fresh]
    .filter((t) => t.symbol && ((t.vol6h_hype ?? 0) > 0 || (t.vol24_hype ?? 0) > 0))
    .filter((t) => { const k = String(t.symbol).toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; })
    .map((t) => ({ name: String(t.name).slice(0, 30), symbol: String(t.symbol).slice(0, 12), about: t.description ? String(t.description).replace(/\s+/g, " ").slice(0, 90) : "", change: t.change24 == null ? null : Math.round(t.change24) }));
  const res = new Response(JSON.stringify(list), { headers: { "content-type": "application/json", "cache-control": `max-age=${TREND_TTL}` } });
  if (list.length) waitUntil(cache.put(CACHE_KEY, res.clone()));
  return list;
}

/** Names handed out lately (shared by everyone, best effort): never give the same one twice in a row. */
async function recentNames() {
  try { const h = await caches.default.match(RECENT_KEY); return h ? await h.json() : []; } catch { return []; }
}
function rememberName(waitUntil, list, name, ticker) {
  const next = [name.toLowerCase(), ticker.toLowerCase(), ...list].slice(0, 120);
  waitUntil(caches.default.put(RECENT_KEY, new Response(JSON.stringify(next), { headers: { "content-type": "application/json", "cache-control": "max-age=21600" } })));
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

const rnd = (arr) => arr[Math.floor(Math.random() * arr.length)];

/** Every idea gets its own random Elysium-sounding name pattern, so names stop repeating. */
const PATTERNS = [
  "Ely {animal}", "Elysium {animal}", "Elysian {animal}", "Elys {noun}", "Elysium {noun}", "Elysian {noun}",
  "EACC {animal}", "E/acc {noun}", "Lil Ely {animal}", "Ely {noun}", "{noun} of Elysium", "Captain Elysium {animal}",
  "Elysium {animal} {noun}", "Super Ely {animal}", "Baby Elysium {animal}", "Elysian {noun} {animal}",
];
const ANIMALS = ["Cat", "Dog", "Frog", "Bird", "Fox", "Bear", "Owl", "Wolf", "Bunny", "Duck", "Panda", "Tiger", "Hamster", "Penguin", "Dragon", "Pegasus", "Phoenix", "Sphinx", "Unicorn", "Whale", "Shark", "Monkey", "Turtle", "Lion", "Raccoon", "Llama"];
const NOUNS = ["Power", "Doc", "Bot", "King", "Lord", "Gold", "Hype", "Rocket", "Wizard", "Oracle", "Angel", "Titan", "Spirit", "Wings", "Sun", "Light", "Crown", "Gas", "Bridge", "Blitz", "Legend", "Hero", "Chad", "Machine", "Agent", "Gate", "Garden", "Nectar", "Laurel", "Temple"];

const SYSTEM = `You invent meme coins for Elysium, a fast new blockchain in the Hyperliquid ecosystem where the currency is HYPE. Elysium means paradise in Greek myth.
You get the coins that are hot on Elysium right now (last hours) and the best coins launched in the last day. Look at what is working: humor, characters, themes, word style.
Then invent ONE brand-new coin for that crowd. Its NAME must clearly evoke Elysium (Ely, Elys, Elysium, Elysian, EACC / e/acc) and follow the name pattern you are given, for example "Ely Cat", "Elysium Dog", "EACC Doc", "Elysium Power". You may tweak the wording, but keep the Elysium feel and make it fun.
When one of the hot coins gives a good hook (a character, a joke, a trend), you may mix that hook in, but the name still evokes Elysium. Never reuse or slightly change any listed name or ticker. English only.
Reply with JSON only, no other text, exactly: {"name":"...","ticker":"...","description":"...","picture":"..."}
Name: 2-24 characters. Ticker: 3-6 capital letters A-Z that fit the name (ELYCAT, EACCDOC...). Description: one or two fun sentences about THIS character, max 140 characters, mention Elysium or being early on it.
Picture: a vivid 20-40 word art direction for the logo that shows EXACTLY the character or object in the name and ticker (a cat for "Ely Cat", a doctor for "EACC Doc"), its expression and pose, one accessory, glowing teal and gold paradise accents, and the lighting. The picture, name, ticker and description must all agree with each other.
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
  // signed in: counted per wallet only (phone networks put many people behind one IP address, so an IP
  // count ran out for people who had barely used it); signed out: per IP, with a lower allowance
  const wallet = /^0x[0-9a-f]{40}$/.test(address);
  const unlimited = String(env.AI_UNLIMITED || "").toLowerCase().split(",").map((x) => x.trim()).includes(address);
  const cap = wallet ? LIMIT : 20;
  const used = unlimited ? 0 : wallet ? await take(env, `w:${address}`) : await take(env, `ip:${ip}`);
  if (used > cap) return json({ error: wallet ? `You've used today's ${cap} AI ideas. More tomorrow (they reset at 00:00 UTC). You can still type a name and use Draw with AI.` : "Log in to get more AI ideas today.", left: 0 }, 429);
  const list = await trends(env, waitUntil);
  const recent = await recentNames();
  const taken = new Set([...list.flatMap((t) => [t.name.toLowerCase(), t.symbol.toLowerCase()]), ...avoid, ...recent]);
  const brief = list.length
    ? list.map((t, i) => `${i + 1}. ${t.name} ($${t.symbol})${t.change != null ? `, ${t.change > 0 ? "+" : ""}${t.change}% today` : ""}${t.about ? `: ${t.about}` : ""}`).join("\n")
    : "(no data right now: invent something that fits a young, playful crypto chain)";
  for (const model of MODELS) {
    try {
      const seed = Math.floor(Math.random() * 1e9);
      const pattern = rnd(PATTERNS).replace("{animal}", rnd(ANIMALS)).replace("{noun}", rnd(NOUNS));
      const out = await env.AI.run(model, {
        messages: [{ role: "system", content: SYSTEM }, { role: "user", content: `Hot on Elysium now:\n${brief}\n\nName pattern for this coin: "${pattern}" (tweak it if something funnier fits, keep the Elysium feel).${avoid.length ? `\nDo NOT use any of these names or tickers (already used): ${avoid.join(", ")}.` : ""}${recent.length ? `\nRecently handed out, do not repeat: ${recent.filter((_, i) => i % 2 === 0).slice(0, 25).join(", ")}.` : ""}\nInvent one new coin. (variation ${seed})` }],
        max_tokens: 300, temperature: 1.1, seed,
      });
      const idea = clean(parse(out?.response ?? out));
      const nm = idea?.name.toLowerCase().replace(/[^a-z0-9 ]/g, "");
      if (idea && !taken.has(nm) && !taken.has(idea.name.toLowerCase()) && !taken.has(idea.ticker.toLowerCase())) {
        rememberName(waitUntil, recent, idea.name, idea.ticker);
        return json({ ...idea, left: unlimited ? 999 : Math.max(0, cap - used) });
      }
    } catch { /* next model */ }
  }
  return json({ error: "AI is busy right now. Try again in a few seconds." }, 503);
}
