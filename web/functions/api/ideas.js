// POST /api/ideas  { idea } -> { options: [{ name, ticker, description }], ai }
// One sentence in any language becomes three ready meme coins (English), using
// Cloudflare Workers AI (binding "AI"). Without AI, a simple local generator answers.
// Current Workers AI text models, tried in order (Cloudflare retires older ones from time to time).
const MODELS = [
  "@cf/meta/llama-4-scout-17b-16e-instruct", // fastest in our tests (~0.3 s)
  "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
  "@cf/mistralai/mistral-small-3.1-24b-instruct",
];

const SYSTEM = `You create meme coins. The user describes an idea in any language.
Reply with JSON only, no other text, exactly:
{"options":[{"name":"...","ticker":"...","description":"...","picture":"..."},{"name":"...","ticker":"...","description":"...","picture":"..."},{"name":"...","ticker":"...","description":"...","picture":"..."}]}
Rules: English only. Name: 2-24 characters, catchy. Ticker: 3-6 capital letters A-Z, no numbers. Description: one or two fun sentences, max 140 characters.
Picture: a vivid 15-30 word art direction for that coin's logo: the main character or object, its pose, colors and style (e.g. "chubby green frog in a gold crown, neon purple background, glossy 3D cartoon"). Each option gets a clearly different picture.
Three clearly different takes on the idea. No real people, no brands, no promises of profit or price, nothing hateful or sexual.`;

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

export function clean(o) {
  if (!o || typeof o !== "object") return null;
  const name = String(o.name ?? "").replace(/[^\p{L}\p{N} .'!&-]/gu, "").replace(/\s+/g, " ").trim().slice(0, 24);
  let ticker = String(o.ticker ?? "").toUpperCase().replace(/[^A-Z]/g, "").slice(0, 6);
  const description = String(o.description ?? "").replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 140);
  const picture = String(o.picture ?? "").replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 240);
  if (ticker.length < 3) ticker = name.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 5);
  if (name.length < 2 || ticker.length < 3 || description.length < 8) return null;
  return { name, ticker, description, picture };
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
  // No silent repeats: when every model is busy, say so (the form below still works by hand).
  if (env.AI) return json({ error: "AI is busy right now. Try again in a few seconds, or fill in the details yourself." }, 503);
  return json({ options: fallback(idea), ai: false });
}

// GET /api/ideas?test=1 — diagnostics (temporary): tries every text model and one image
// model with a tiny request and reports what each one answered. No user data involved.
export async function onRequestGet({ request, env }) {
  const u = new URL(request.url);
  if (u.searchParams.get("test") !== "1") return json({ error: "not found" }, 404);
  const out = { binding: !!(env.AI && typeof env.AI.run === "function"), text: [], image: null };
  if (!out.binding) return json(out);
  for (const model of MODELS) {
    const t0 = Date.now();
    try {
      const r = await env.AI.run(model, { messages: [{ role: "user", content: 'Reply with JSON only: {"ok":true}' }], max_tokens: 30 });
      const text = typeof r?.response === "string" ? r.response : JSON.stringify(r?.response ?? r);
      out.text.push({ model, ok: true, ms: Date.now() - t0, reply: String(text).slice(0, 80) });
    } catch (e) {
      out.text.push({ model, ok: false, ms: Date.now() - t0, error: String(e?.message || e).slice(0, 200) });
    }
  }
  const t1 = Date.now();
  try {
    const r = await env.AI.run("@cf/black-forest-labs/flux-1-schnell", { prompt: "a small green frog, cartoon", steps: 2 });
    out.image = { model: "flux-1-schnell", ok: !!(r && (r.image || r.length)), ms: Date.now() - t1 };
  } catch (e) {
    out.image = { model: "flux-1-schnell", ok: false, ms: Date.now() - t1, error: String(e?.message || e).slice(0, 200) };
  }
  return json(out);
}
