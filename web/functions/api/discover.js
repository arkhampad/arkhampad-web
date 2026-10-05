// POST /api/discover { q } -> { filters, ai }  Plain-language coin search -> filters (any language in, filters out).
import { ask, cached, json, parseObj, readJson } from "../../lib/ai.ts";
import { cleanFinder, ruleFinder } from "../../lib/finder.ts";

const SYSTEM = `You turn a trader's request into JSON filters for a meme coin list. The request can be in any language.
Reply with ONE JSON object only, no other text. Use only the keys you need from:
{"source":"all|here|other","chain":"Base|Robinhood|BNB|Arc","topic":"AI|Animals|Gaming|Culture","text":"words in the coin name or ticker",
"maxAgeMin":number,"minAgeMin":number,"minMc":number,"maxMc":number,"minChange":number,"maxChange":number,"minVol":number,
"nearGrad":true,"graduated":true,"locked":true,"sort":"trending|new|gainers|losers|volume|mc|graduation"}
Meaning: source "here" = launched on ArkhamPad, "other" = from other DEXs. Ages in minutes, money in US dollars, change in percent over 24h.
nearGrad = launched here and close to graduating; graduated = launched here and already graduated; locked = creator lock still running.
"new" or "fresh" without a time means maxAgeMin 1440. "Rising volume" or "active" means sort "volume". "Pumping" or "gainers" means sort "gainers" and minChange 20.
Never add filters the request didn't ask for.`;

export async function onRequestPost({ request, env }) {
  const b = await readJson(request);
  const q = String(b?.q ?? "").replace(/\s+/g, " ").trim().slice(0, 200);
  if (q.length < 2) return json({ error: "Type what you're looking for." }, 400);
  return cached(`discover|${q.toLowerCase()}`, 3600, async () => {
    const text = await ask(env, SYSTEM, q, { max: 160, temp: 0 });
    const f = cleanFinder(parseObj(text));
    if (Object.keys(f).length) return [json({ filters: f, ai: true }), true];
    return [json({ filters: ruleFinder(q), ai: false }), false];
  });
}
