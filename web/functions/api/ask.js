// POST /api/ask  { q } -> { answer, sources: [{ title, url }], ai }
// Answers questions about ArkhamPad from the Learn articles and Help answers only.
// The context is picked on the server, so this endpoint can't be used as a general chatbot.
import { helpDigest, search } from "../../lib/search.ts";
import { CONTACT_EMAIL } from "../../lib/help.ts";

const MODELS = ["@cf/meta/llama-3.3-70b-instruct-fp8-fast", "@cf/meta/llama-3.1-8b-instruct"];
const json = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "content-type": "application/json", "cache-control": "no-store" } });

const SYSTEM = `You are the help assistant of ArkhamPad, a site to create and trade meme coins with USDC on Robinhood Chain and Base.
Answer the user's question using ONLY the facts in the CONTEXT. Reply in the same language as the question.
Write 1 to 4 short, plain sentences. No headings, no lists, no emojis, no links.
If the context does not answer the question, say you're not sure and suggest emailing ${CONTACT_EMAIL}.
Never give financial advice, price predictions or opinions on which coin to buy. Never ask for a seed phrase or password.`;

export async function onRequestPost({ request, env }) {
  let q = "";
  try { q = String((await request.json()).q ?? ""); } catch { return json({ error: "bad request" }, 400); }
  q = q.replace(/\s+/g, " ").trim().slice(0, 300);
  if (q.length < 3) return json({ error: "Type a question first." }, 400);
  const hits = search(q, 5);
  const sources = hits.slice(0, 3).map((h) => ({ title: h.title, url: h.url }));
  if (!env.AI) return json({ answer: null, sources, ai: false });
  // No keyword match (often a question in another language): give AI every Help answer instead.
  const context = hits.length ? hits.map((h, i) => `[${i + 1}] ${h.title}\n${h.text}`).join("\n\n").slice(0, 6000) : helpDigest().slice(0, 12000);
  const sourcesOut = sources.length ? sources : [{ title: "Help centre", url: "/help/" }];
  for (const model of MODELS) {
    try {
      const out = await env.AI.run(model, { messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: `CONTEXT:\n${context}\n\nQUESTION: ${q}` },
      ], max_tokens: 220, temperature: 0.2 });
      const answer = String(out?.response ?? "").replace(/\s+/g, " ").trim().slice(0, 700);
      if (answer.length > 10) return json({ answer, sources: sourcesOut, ai: true });
    } catch { /* next model */ }
  }
  return json({ answer: null, sources, ai: false });
}
