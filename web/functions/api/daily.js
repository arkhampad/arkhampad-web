// POST /api/daily  { recap } -> { text }  Short, upbeat summary of one day on ArkhamPad.
const MODELS = ["@cf/meta/llama-3.3-70b-instruct-fp8-fast", "@cf/meta/llama-3.1-8b-instruct"];
const json = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const money = (v) => (v >= 1e6 ? `$${(v / 1e6).toFixed(2)}M` : v >= 1e3 ? `$${(v / 1e3).toFixed(1)}K` : `$${Number(v || 0).toFixed(2)}`);

/** Plain summary from the numbers (also used when AI is unavailable). */
export function template(r) {
  if (!r || !r.trades) return "A quiet day on ArkhamPad. No trades yet: be the first to launch or buy a coin.";
  const parts = [`${r.trades} trades and ${money(r.volume)} in volume from ${r.traders} traders.`];
  if (r.launches) parts.push(`${r.launches} new coin${r.launches === 1 ? "" : "s"} launched${r.graduations ? `, ${r.graduations} graduated` : ""}.`);
  if (r.gainer && r.gainer.change > 0) parts.push(`Top gainer: $${r.gainer.symbol} (+${r.gainer.change}%).`);
  if (r.top_volume) parts.push(`Most traded: $${r.top_volume.symbol} with ${money(r.top_volume.vol)}.`);
  return parts.join(" ");
}

export async function onRequestPost({ request, env }) {
  let r;
  try { r = (await request.json()).recap; } catch { return json({ error: "bad request" }, 400); }
  const base = template(r);
  if (!env.AI || !r || !r.trades) return json({ text: base, ai: false });
  const facts = JSON.stringify({ trades: r.trades, volume: r.volume, traders: r.traders, launches: r.launches, graduations: r.graduations, gainer: r.gainer && { symbol: r.gainer.symbol, change: r.gainer.change }, most_traded: r.top_volume && { symbol: r.top_volume.symbol, volume: r.top_volume.vol }, biggest_trade: r.biggest_trade && { usdc: r.biggest_trade.usdc, symbol: r.biggest_trade.symbol } });
  for (const model of MODELS) {
    try {
      const out = await env.AI.run(model, { messages: [
        { role: "system", content: "Write a 2-3 sentence daily recap for a meme coin launchpad called ArkhamPad, from the JSON facts only. Upbeat, plain English, no hashtags, no emojis, no advice, no price predictions, never invent numbers. Put $ before tickers." },
        { role: "user", content: facts },
      ], max_tokens: 160, temperature: 0.6 });
      const text = String(out?.response ?? "").replace(/\s+/g, " ").trim().slice(0, 400);
      if (text.length > 30) return json({ text, ai: true });
    } catch { /* next model */ }
  }
  return json({ text: base, ai: false });
}
