// POST /api/ideas  { idea } -> { options: [{ name, ticker, description }], ai }
// One sentence in any language becomes three ready meme coins (English), using
// Cloudflare Workers AI (binding "AI"). Without AI, a simple local generator answers.
const MODELS = ["@cf/meta/llama-3.3-70b-instruct-fp8-fast", "@cf/meta/llama-3.1-8b-instruct"];

const SYSTEM = `You create meme coins. The user describes an idea in any language.
Reply with JSON only, no other text, exactly:
{"options":[{"name":"...","ticker":"...","description":"..."},{"name":"...","ticker":"...","description":"..."},{"name":"...","ticker":"...","description":"..."}]}
Rules: English only. Name: 2-24 characters, catchy. Ticker: 3-6 capital letters A-Z, no numbers. Description: one or two fun sentences, max 140 characters.
Three clearly different takes on the idea. No real people, no brands, no promises of profit or price, nothing hateful or sexual.`;

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

export function clean(o) {
  if (!o || typeof o !== "object") return null;
  const name = String(o.name ?? "").replace(/[^\p{L}\p{N} .'!&-]/gu, "").replace(/\s+/g, " ").trim().slice(0, 24);
  let ticker = String(o.ticker ?? "").toUpperCase().replace(/[^A-Z]/g, "").slice(0, 6);
  const description = String(o.description ?? "").replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 140);
  if (ticker.length < 3) ticker = name.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 5);
  if (name.length < 2 || ticker.length < 3 || description.length < 8) return null;
  return { name, ticker, description };
}

export function parse(text) {
  if (text && typeof text === "object") return text; // some models return parsed JSON
  const m = String(text ?? "").match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

/** Offline fallback: still gives three sensible coins from the words in the idea. */
export function fallback(idea) {
  const words = String(idea).replace(/[^\p{L}\p{N} ]/gu, " ").split(/\s+/).filter((w) => w.length > 2);
  const pick = (i) => (words[i % Math.max(words.length, 1)] || "Moon").replace(/^./, (c) => c.toUpperCase());
  const a = pick(0), b = pick(1), c = pick(2);
  const mk = (name, desc) => clean({ name, ticker: name, description: desc });
  return [
    mk(`${a} ${b}`.slice(0, 24), `${a} and ${b}, together on one chart. Born from a single sentence.`),
    mk(`${b} Coin`.slice(0, 24), `The internet's favourite ${b.toLowerCase()} finally has a coin.`),
    mk(`Lil ${c}`.slice(0, 24), `Small ${c.toLowerCase()}, big energy. Launched in one sentence.`),
  ].filter(Boolean);
}

/** A different creative angle on every request, so the same sentence never gives the same three coins. */
const ANGLES = [
  "Lean into absurd internet humor.", "Make one option cute, one bold, one weird.", "Use wordplay and puns.",
  "Think like a crypto degen naming a coin at 3am.", "Give it a mascot-style character.", "Go short and punchy, one-word names welcome.",
  "Use animal or food twists.", "Make it feel like a cult classic meme.", "Mix retro gaming and internet slang.",
  "Make the names sound like a chant.", "Go mysterious and lore-heavy.", "Make it wholesome and funny.",
];

export async function onRequestPost({ request, env }) {
  let idea = "";
  try { idea = String((await request.json()).idea ?? ""); } catch { return json({ error: "bad request" }, 400); }
  idea = idea.replace(/\s+/g, " ").trim().slice(0, 300);
  if (idea.length < 2) return json({ error: "Describe your coin in a few words." }, 400);
  if (env.AI) {
    for (const model of MODELS) {
      try {
        const angle = ANGLES[Math.floor(Math.random() * ANGLES.length)];
        const seed = Math.floor(Math.random() * 1e9);
        const out = await env.AI.run(model, {
          messages: [{ role: "system", content: SYSTEM }, { role: "user", content: `${idea}\n\nStyle for this round: ${angle} Avoid the most obvious names. (variation ${seed})` }],
          max_tokens: 500, temperature: 1.05, seed,
        });
        const data = parse(out?.response ?? out);
        const options = (data?.options ?? []).map(clean).filter(Boolean).slice(0, 3);
        if (options.length === 3) return json({ options, ai: true });
      } catch { /* try the next model */ }
    }
  }
  return json({ options: fallback(idea), ai: false });
}
