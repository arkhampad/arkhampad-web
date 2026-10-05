// POST /api/safety { facts, level } -> { text }  One plain sentence about a coin's on-chain safety facts.
// Only numbers are accepted, and the prompt is built here, so this can't be used as a general chatbot.
import { ask, cached, json, oneLine, readJson } from "../../lib/ai.ts";

const num = (v, lo, hi) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : null; };

export async function onRequestPost({ request, env }) {
  const b = await readJson(request);
  const f = b?.facts ?? {};
  const facts = {
    level: ["low", "medium", "high"][num(b?.level, 0, 2) ?? 0],
    age_minutes: Math.round(num(f.ageMin, 0, 1e7) ?? 0),
    creator_locked: (num(f.lockLeftSec, 0, 1e7) ?? 0) > 0,
    creator_holds_pct: +(num(f.creatorPct, 0, 100) ?? 0).toFixed(1),
    top10_holders_pct: +(num(f.top10Pct, 0, 100) ?? 0).toFixed(1),
    holders: Math.round(num(f.holders, 0, 1e6) ?? 0),
    different_buyers: Math.round(num(f.buyers, 0, 1e6) ?? 0),
    trades: Math.round(num(f.trades, 0, 1e7) ?? 0),
    top3_buyers_share_pct: +(num(f.topBuyersPct, 0, 100) ?? 0).toFixed(0),
    graduated_pool_locked: !!f.graduated,
  };
  return cached(`safety|${JSON.stringify(facts)}`, 600, async () => {
    const text = await ask(env, `You write one short safety note for a meme coin page, from JSON facts only.
One or two plain English sentences, max 200 characters. Mention the 1-2 facts that matter most for the given risk level.
Never invent numbers, never give advice to buy or sell, no emojis, no hashtags, no quotes.`, JSON.stringify(facts), { max: 90, temp: 0.3 });
    return text ? [json({ text: oneLine(text, 220) }), true] : [json({ text: null }, 503), false];
  });
}
