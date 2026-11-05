// "@elyscreener <anything about Elysium>" in any language. The AI never supplies facts: it only
// (1) tells what kind of question it is and which language, and (2) phrases the answer in that
// language from facts our own database prepared. Every number in its sentence is checked against
// those facts before posting; one number that doesn't match and the plain template answer goes out
// instead. Coins scored Risky are never recommended. No predictions, no "which is best" verdicts.
//
// AI: Cloudflare Workers AI over its REST API (has a free daily allowance).
// Env: CF_ACCOUNT_ID, CF_AI_TOKEN (a token with "Workers AI" permission). Without them: English templates.
//      CF_AI_MODEL (default @cf/meta/llama-3.3-70b-instruct-fp8-fast)

const env = (k) => (process.env[k] || "").trim();
const MODEL = env("CF_AI_MODEL") || "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

export async function ai(messages, max = 220) {
  if (!env("CF_ACCOUNT_ID") || !env("CF_AI_TOKEN")) return null;
  const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${env("CF_ACCOUNT_ID")}/ai/run/${MODEL}`, {
    method: "POST",
    headers: { authorization: `Bearer ${env("CF_AI_TOKEN")}`, "content-type": "application/json" },
    body: JSON.stringify({ messages, max_tokens: max, temperature: 0.1 }),
    signal: AbortSignal.timeout(25000),
  });
  if (!r.ok) throw new Error(`workers ai ${r.status}: ${(await r.text()).slice(0, 160)}`);
  const j = await r.json();
  const out = j?.result?.response;
  return typeof out === "string" ? out.trim() : out != null ? JSON.stringify(out) : null;
}

export const INTENTS = ["coin", "top_gainers", "top_volume", "new_coins", "smart_money", "launchpads", "buybacks", "general", "about", "off_topic", "chitchat"];

/** What is being asked, in which language, about which coin (if any). */
export async function classify(text) {
  const clean = text.replace(/@\w+/g, " ").replace(/\s+/g, " ").trim();
  const sym = clean.match(/\$([A-Za-z][A-Za-z0-9]{0,14})\b/)?.[1] || null;
  const addr = clean.match(/0x[0-9a-fA-F]{40}/)?.[0] || null;
  let r = null;
  try {
    const out = await ai([
      { role: "system", content: `You label tweets sent to @elyscreener, a live screener for the Elysium blockchain (Kinetiq's Hyperliquid L2). Reply with ONLY a JSON object: {"lang":"<ISO 639-1 code of the tweet's language>","intent":"<one of ${INTENTS.join("|")}>","coin":"<ticker or name of the one coin asked about, else null>"}.
coin = asks about one specific coin (safe? price? holders? how is it doing?). top_gainers = biggest risers / pumping now. top_volume = most traded. new_coins = new launches. smart_money = what smart wallets / whales buy. launchpads = which launchpad is best/biggest/safest or comparing launchpads. buybacks = Ascend's buybacks / what Ascend is buying back. general = any other question about Elysium (bridging, gas, wallets, DEXs, NFTs, mainnet, Kinetiq, HYPE on Elysium). about = what is ElyScreener / what can you do. off_topic = not about Elysium or crypto on Elysium. chitchat = greetings, thanks, no question.` },
      { role: "user", content: clean.slice(0, 500) || "(empty)" },
    ], 80);
    r = JSON.parse(out.match(/\{[\s\S]*\}/)?.[0] || "null");
  } catch {}
  // if the AI is unavailable: a few common words in several languages
  const guess = /buy ?back/i.test(clean) ? "buybacks"
    : /launch ?pad|launchpad|ランチパッド|发射台/i.test(clean) ? "launchpads"
    : /gainer|pump|moon|top|yüksel|artan|上昇|涨|sube|steig/i.test(clean) ? "top_gainers"
    : /volume|hacim|出来高|交易量|volumen/i.test(clean) ? "top_volume"
    : /new coin|yeni coin|新しい|新币|nuevo/i.test(clean) ? "new_coins"
    : /smart money|whale|balina|akıllı|クジラ|巨鲸/i.test(clean) ? "smart_money" : null;
  const intent = INTENTS.includes(r?.intent) ? r.intent : sym || addr ? "coin" : guess || (/\?|？|؟/.test(clean) ? "general" : "chitchat");
  const lang = typeof r?.lang === "string" && /^[a-z]{2}$/.test(r.lang) ? r.lang : "en";
  return { lang, intent: sym || addr ? "coin" : intent, coin: addr || sym || (typeof r?.coin === "string" && r.coin !== "null" ? r.coin.replace(/^\$/, "") : null), text: clean };
}

// X counts most non-Latin characters (CJK, emoji…) as 2.
export function xLength(s) {
  let n = 0;
  for (const ch of s) { const c = ch.codePointAt(0); n += c <= 4351 || (c >= 8192 && c <= 8205) || (c >= 8208 && c <= 8223) || (c >= 8242 && c <= 8247) ? 1 : 2; }
  return n;
}
const nums = (s) => (String(s).match(/\d[\d.,]*/g) || []).map((x) => x.replace(/[.,]+$/, ""));
const norm = (x) => x.replace(/,/g, ".").replace(/^0+(?=\d)/, "");

/** Phrase `facts` (English lines) in `lang`. Falls back to `fallback` if anything looks off. */
export async function phrase({ lang, question, facts, fallback, extraOk = [], exact = false }) {
  if (lang === "en" && !env("CF_AI_TOKEN")) return fallback;
  // a bare ticker / address / command says nothing about language or angle: the full template is the answer
  const bare = String(question).replace(/\/\w+|\$\w+|0x[0-9a-fA-F]{40}|@\w+/g, "").replace(/[^\p{L}]/gu, "");
  if (bare.length < 4 || (exact && lang === "en")) return fallback;
  let out = null;
  try {
    out = await ai([
      { role: "system", content: `You are ElyScreener on X, replying to a tweet. Write the reply in the language with code "${lang}". ${exact ? "Translate ALL the fact lines, keep every one of them. " : ""}Use ONLY the facts given: never add numbers, names, coins or claims that are not in the facts, never predict prices, never say which coin or launchpad is best, never give financial advice. Keep tickers like $BLOB exactly as written. Casual, short, human tone, no hashtags, no links, no emojis except at most one. At most 230 characters (Chinese/Japanese/Korean: at most 110 characters). Output only the reply text.` },
      { role: "user", content: `Their tweet: ${question.slice(0, 400)}\n\nFacts:\n${facts}` },
    ], 200);
  } catch {}
  if (!out) return fallback;
  out = out.replace(/^["'“”]+|["'“”]+$/g, "").replace(/https?:\/\/\S+/g, "").replace(/#\w+/g, "").trim();
  // every number in the sentence must come from the facts
  const ok = new Set([...nums(facts), ...nums(fallback), ...extraOk, "1", "2", "3", "24", "7", "10"].map(norm));
  const bad = nums(out).map(norm).filter((n) => !ok.has(n));
  if (bad.length || xLength(out) > 270 || out.length < 8) return fallback;
  return out;
}

/** Elysium basics for general questions (from ElyScreener's own Learn pages). */
export const KB = `Elysium is a Layer-2 built by Kinetiq (the team behind kHYPE liquid staking). It is an Arbitrum Orbit chain that settles to HyperEVM, Hyperliquid's EVM layer.
Gas on Elysium is paid in HYPE, bridged 1:1 from HyperEVM through Elysium's official bridge; there is no separate Elysium token and no official points program.
Public mainnet opens November 9, 2026. Chain ID 99901.
To trade: bridge HYPE from HyperEVM (or bring USDC), then buy coins on a launchpad or DEX. Withdrawals back to HyperEVM go through the official bridge and wait out a challenge period (about 5.5 days).
Launchpads on Elysium include Boxa, Kleos, ElysPump, Elyxa, Stockium, Eleos, Ronspad and Ascend (Kinetiq-aligned, opens with mainnet). Most graduate coins into Uniswap-style pools paired with HYPE or USDC.
Day-one apps reported: pump.fun trading, fomo, the DEX Nest; Uniswap and others coming. HyperCore market data for contracts is planned for an upgrade after mainnet.
Half of Elysium's sequencer fees go to KNTQ buybacks and burns.
ElyScreener shows every Elysium coin live: price, market cap, holders, bot clusters, a Safe / Caution / Risky label, smart-money buys, creator selling; you can buy and sell on the site. Ask it about any coin: @elyscreener $TICKER.`;

/**
 * Our own post, written fresh each time (so no two read the same). `facts` = the live data, `fallback` =
 * our template line. The AI may only rephrase: same numbers, same $tickers and @handles, no new claims.
 * Anything off (a number that isn't in the facts, a missing tag, too long) → the template goes out.
 */
export async function writePost({ facts, fallback, must = [], recent = [], max = 240 }) {
  if (!env("CF_AI_TOKEN")) return fallback;
  let out = null;
  try {
    out = await ai([
      { role: "system", content: `You write posts for ElyScreener, a live screener for the Elysium blockchain, on X. Write ONE short post in English from the facts, like a real crypto trader typing fast: mostly lowercase, casual, a bit of personality, no corporate tone, no "exciting", no "don't miss out", no hashtags, no links, at most one emoji. Use ONLY the facts: never add numbers, coins, claims or predictions, never give financial advice. Keep every $TICKER and @handle from the facts exactly as written. Under ${max - 20} characters. Don't start the way these recent posts start:\n${recent.slice(0, 6).map((x) => "- " + String(x).split("\n")[0].slice(0, 60)).join("\n") || "- (none)"}\nOutput only the post text.` },
      { role: "user", content: `Facts:\n${facts}\n\nA plain version for reference (say it differently):\n${fallback}` },
    ], 160);
  } catch {}
  if (!out) return fallback;
  out = out.replace(/^["'“”]+|["'“”]+$/g, "").replace(/https?:\/\/\S+/g, "").replace(/#\w+/g, "").replace(/\n{3,}/g, "\n\n").trim();
  const ok = new Set([...nums(facts), ...nums(fallback), "1", "2", "3", "24", "7", "10"].map(norm));
  if (nums(out).map(norm).some((n) => !ok.has(n))) return fallback;
  if (must.some((m) => m && !out.toLowerCase().includes(String(m).toLowerCase()))) return fallback;
  // keep $TICKERs and @handles exactly as written in the facts (the AI sometimes lowercases them)
  for (const m of must) if (m) out = out.replace(new RegExp(String(m).replace(/[$^.*+?()[\]{}|\\]/g, "\\$&"), "gi"), m);
  if (xLength(out) > max || out.length < 12) return fallback;
  return out;
}
