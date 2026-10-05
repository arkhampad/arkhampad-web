// POST /api/moderate { text } -> { spam, reason }  Used by the relayer when a comment is posted.
import { ask, json, parseObj, readJson } from "../../lib/ai.ts";
import { ruleCheck } from "../../lib/moderation.ts";

const SYSTEM = `You moderate comments on a meme coin page. Reply with JSON only: {"spam":true|false,"reason":"few words"}.
spam=true ONLY for: scams (fake airdrops or giveaways, "connect your wallet", fake support, requests for seed phrases or keys, "send me funds"), phishing links, advertising other projects or channels, or repeated junk.
Normal opinions, hype, jokes, criticism, swearing and questions are NOT spam. When unsure, answer false.`;

export async function onRequestPost({ request, env }) {
  const b = await readJson(request);
  const text = String(b?.text ?? "").replace(/\s+/g, " ").trim().slice(0, 300);
  if (!text) return json({ spam: false, reason: null });
  const rule = ruleCheck(text);
  if (rule.spam) return json({ ...rule, by: "rules" });
  const o = parseObj(await ask(env, SYSTEM, text, { max: 40, temp: 0 }));
  if (o && o.spam === true) return json({ spam: true, reason: String(o.reason ?? "looks like a scam").replace(/[^\w ,.'-]/g, "").slice(0, 60) || "looks like a scam", by: "ai" });
  return json({ spam: false, reason: null, by: o ? "ai" : "none" });
}
