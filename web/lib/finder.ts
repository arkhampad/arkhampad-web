// Ask-AI search on Discover: a plain-language request becomes filters you can see and remove.
// The filter shape is shared by the /api/discover function (AI + rules) and the page.
export type Finder = {
  source?: "all" | "here" | "other";
  chain?: "Base" | "Robinhood" | "BNB" | "Arc";
  topic?: "AI" | "Animals" | "Gaming" | "Culture";
  text?: string;           // words in the name or ticker
  maxAgeMin?: number;      // younger than
  minAgeMin?: number;      // older than
  minMc?: number; maxMc?: number;
  minChange?: number;      // 24h % change at least
  maxChange?: number;      // 24h % change at most
  minVol?: number;         // 24h volume at least
  nearGrad?: boolean;      // launched here, 70%+ of the way to graduation
  graduated?: boolean;     // launched here and graduated
  locked?: boolean;        // creator lock still running
  sort?: "trending" | "new" | "gainers" | "losers" | "volume" | "mc" | "graduation";
};

const CHAINS = ["Base", "Robinhood", "BNB", "Arc"] as const;
const TOPICS = ["AI", "Animals", "Gaming", "Culture"] as const;
const SORTS = ["trending", "new", "gainers", "losers", "volume", "mc", "graduation"] as const;
const n = (v: unknown, lo: number, hi: number) => { const x = Number(v); return v !== null && v !== "" && Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : undefined; };
const pick = <T extends string>(v: unknown, list: readonly T[]) => list.find((x) => typeof v === "string" && x.toLowerCase() === v.toLowerCase());

/** Keeps only known keys with sane values. */
export function cleanFinder(o: Record<string, unknown> | null | undefined): Finder {
  if (!o) return {};
  const f: Finder = {};
  const src = pick(o.source, ["all", "here", "other"] as const); if (src && src !== "all") f.source = src;
  const ch = pick(o.chain, CHAINS); if (ch) f.chain = ch;
  const tp = pick(o.topic, TOPICS); if (tp) f.topic = tp;
  if (typeof o.text === "string") { const t = o.text.replace(/[^A-Za-z0-9 $._-]/g, "").replace(/^\$/, "").trim().slice(0, 24); if (t.length >= 2) f.text = t; }
  const maxAge = n(o.maxAgeMin, 1, 525600); if (maxAge) f.maxAgeMin = Math.round(maxAge);
  const minAge = n(o.minAgeMin, 1, 525600); if (minAge) f.minAgeMin = Math.round(minAge);
  const minMc = n(o.minMc, 0, 1e13); if (minMc) f.minMc = minMc;
  const maxMc = n(o.maxMc, 1, 1e13); if (maxMc) f.maxMc = maxMc;
  const minCh = n(o.minChange, -100, 100000); if (minCh !== undefined) f.minChange = minCh;
  const maxCh = n(o.maxChange, -100, 100000); if (maxCh !== undefined) f.maxChange = maxCh;
  const minVol = n(o.minVol, 0, 1e12); if (minVol) f.minVol = minVol;
  // v2: coins open in their pool at launch, there is no graduation to filter on
  if (o.locked === true) f.locked = true;
  const so = pick(o.sort, SORTS); if (so) f.sort = so;
  // ArkhamPad-only ideas imply coins launched here
  if (f.nearGrad || f.graduated || f.locked) f.source = "here";
  if (f.nearGrad && f.graduated) delete f.graduated;
  return f;
}

const money = (v: number) => (v >= 1e9 ? `$${+(v / 1e9).toFixed(1)}B` : v >= 1e6 ? `$${+(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `$${+(v / 1e3).toFixed(1)}K` : `$${Math.round(v)}`);
const mins = (m: number) => (m < 60 ? `${m}m` : m < 1440 ? `${+(m / 60).toFixed(1)}h` : `${+(m / 1440).toFixed(1)}d`);

/** Chips for the page: one per filter, removable. */
export function finderChips(f: Finder): { key: keyof Finder; label: string }[] {
  const c: { key: keyof Finder; label: string }[] = [];
  if (f.source === "here") c.push({ key: "source", label: "Launched on ArkhamPad" });
  if (f.source === "other") c.push({ key: "source", label: "Other DEXs" });
  if (f.chain) c.push({ key: "chain", label: `Chain: ${f.chain}` });
  if (f.topic) c.push({ key: "topic", label: `Topic: ${f.topic}` });
  if (f.text) c.push({ key: "text", label: `Name: “${f.text}”` });
  if (f.maxAgeMin) c.push({ key: "maxAgeMin", label: `Younger than ${mins(f.maxAgeMin)}` });
  if (f.minAgeMin) c.push({ key: "minAgeMin", label: `Older than ${mins(f.minAgeMin)}` });
  if (f.minMc) c.push({ key: "minMc", label: `Market cap ${money(f.minMc)}+` });
  if (f.maxMc) c.push({ key: "maxMc", label: `Market cap under ${money(f.maxMc)}` });
  if (f.minChange !== undefined) c.push({ key: "minChange", label: `24h ${f.minChange >= 0 ? "+" : ""}${f.minChange}% or more` });
  if (f.maxChange !== undefined) c.push({ key: "maxChange", label: `24h ${f.maxChange >= 0 ? "+" : ""}${f.maxChange}% or less` });
  if (f.minVol) c.push({ key: "minVol", label: `Volume ${money(f.minVol)}+` });
  if (f.nearGrad) c.push({ key: "nearGrad", label: "Almost graduating" });
  if (f.graduated) c.push({ key: "graduated", label: "Graduated" });
  if (f.locked) c.push({ key: "locked", label: "Creator locked" });
  if (f.sort) c.push({ key: "sort", label: `Sorted by ${f.sort === "mc" ? "market cap" : f.sort}` });
  return c;
}

/** Offline understanding of common requests (any of the site's languages), used when AI is unavailable. */
export function ruleFinder(q: string): Finder {
  const s = q.toLowerCase();
  const o: Record<string, unknown> = {};
  if (/\bbase\b/.test(s)) o.chain = "Base";
  else if (/robinhood|\brh\b/.test(s)) o.chain = "Robinhood";
  else if (/\bbnb\b|binance|\bbsc\b/.test(s)) o.chain = "BNB";
  if (/graduat|mezun/.test(s)) o.nearGrad = !/graduated|mezun ol(an|muş)/.test(s); if (/\bgraduated\b|mezun ol(an|muş)/.test(s)) o.graduated = true;
  if (/lock|kilit/.test(s)) o.locked = true;
  if (/(launched|made|created) (here|on arkhampad)|arkhampad/.test(s)) o.source = "here";
  const h = s.match(/(\d+)\s*(h|hour|hours|saat)/); const m = s.match(/(\d+)\s*(min|mins|minute|minutes|dk|dakika)\b/);
  if (h) o.maxAgeMin = Number(h[1]) * 60; else if (m) o.maxAgeMin = Number(m[1]); else if (/\bnew\b|newest|fresh|just launched|yeni/.test(s)) o.maxAgeMin = 1440;
  if (/volume|hacim|most traded|active|aktif/.test(s)) o.sort = "volume";
  else if (/gainer|pump|up the most|mooning|yüksel|kazandır/.test(s)) { o.sort = "gainers"; o.minChange = 20; }
  else if (/loser|dump|down the most|düş/.test(s)) o.sort = "losers";
  else if (o.maxAgeMin) o.sort = "new";
  // money needs a unit or a $ ("under 50k", "over $2m"), so "under 1 hour" isn't read as a market cap
  const amt = (re: RegExp) => { const x = s.match(re); if (!x) return undefined; const u = x[3]; if (!u && !x[0].includes("$")) return undefined; return Number(x[2]) * (u === "k" ? 1e3 : u === "m" ? 1e6 : u === "b" ? 1e9 : 1); };
  const maxMc = amt(/(under|below|less than|altında)\s*\$?(\d+(?:\.\d+)?)\s*(k|m|b)?\b/); if (maxMc) o.maxMc = maxMc;
  const minMc = amt(/(over|above|more than|üstünde)\s*\$?(\d+(?:\.\d+)?)\s*(k|m|b)?\b/); if (minMc) o.minMc = minMc;
  if (/\bai\b|robot|agent|yapay zeka/.test(s)) o.topic = "AI";
  else if (/dog|cat|frog|animal|pepe|hayvan|köpek|kedi/.test(s)) o.topic = "Animals";
  else if (/game|gaming|oyun/.test(s)) o.topic = "Gaming";
  const f = cleanFinder(o);
  return Object.keys(f).length ? f : { sort: "trending" };
}
