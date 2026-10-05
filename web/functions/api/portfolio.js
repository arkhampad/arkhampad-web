// POST /api/portfolio { facts, variant } -> { text }  Two or three plain sentences about a user's own numbers.
import { ask, json, oneLine, readJson } from "../../lib/ai.ts";

const num = (v, lo, hi) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : 0; };
const tick = (v) => String(v ?? "").replace(/[^A-Za-z0-9]/g, "").slice(0, 10);

export async function onRequestPost({ request, env }) {
  const b = await readJson(request);
  const f = b?.facts ?? {};
  const facts = {
    coins_value_usd: +num(f.value, 0, 1e9).toFixed(2), spent_usd: +num(f.invested, 0, 1e9).toFixed(2),
    result_usd: +num(f.result, -1e9, 1e9).toFixed(2), result_pct: Math.round(num(f.resultPct, -100, 1e6)),
    coins: Math.round(num(f.coins, 0, 1000)), coins_in_profit: Math.round(num(f.winners, 0, 1000)),
    best: f.best ? { ticker: tick(f.best.tick), pct: Math.round(num(f.best.pct, -100, 1e6)) } : null,
    worst: f.worst ? { ticker: tick(f.worst.tick), pct: Math.round(num(f.worst.pct, -100, 1e6)) } : null,
    pct_in_coins_under_1h_old: Math.round(num(f.young, 0, 100)), pct_in_graduated_coins: Math.round(num(f.graduated, 0, 100)),
  };
  const text = await ask(env, `You summarise a user's meme coin portfolio from JSON facts only, speaking to them as "you".
Write 2 or 3 short plain English sentences, max 300 characters: the overall result, the best (or worst) coin, then one thing "worth noticing" about risk.
Put $ before tickers. Never invent numbers, never tell them to buy or sell, no emojis, no hashtags.`, JSON.stringify(facts), { max: 120, temp: 0.4 + Math.min(4, num(b?.variant, 0, 10)) * 0.1 });
  return text ? json({ text: oneLine(text, 340) }) : json({ text: null }, 503);
}
