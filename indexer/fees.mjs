// Network fee (gas) the user pays back in USDC, worked out from what the relayer really spends.
// Every relayed transaction's receipt is recorded (gas used x price, plus the L1 data fee on
// rollups like Base); the quote is the recent median for that kind of request, scaled to
// today's gas price, converted at the live ETH (or BNB) price, plus a safety margin.
const MARGIN = Number(process.env.FEE_MARGIN ?? 1.25);
const MIN_USD = Number(process.env.FEE_MIN_USD ?? 0.01);
const MAX_USD = Number(process.env.FEE_MAX_USD ?? 1.0);   // above this the network counts as "busy"
const ACCEPT = Number(process.env.FEE_ACCEPT ?? 0.7);      // a signed fee may be this much below the live quote
// gas units for a request we have no history for yet (generous; replaced by real receipts)
const DEFAULT_GAS = { buy: 260_000n, sell: 240_000n, poolBuy: 420_000n, poolSell: 420_000n, launch: 3_600_000n, withdraw: 110_000n, promote: 160_000n, extSwap: 650_000n };
export const FEE_KINDS = Object.keys(DEFAULT_GAS);
const NATIVE_FALLBACK = { ETH: 3000, BNB: 600 };

const median = (a) => { const s = [...a].sort((x, y) => (x < y ? -1 : x > y ? 1 : 0)); return s.length ? s[Math.floor(s.length / 2)] : null; };

export function makeFees({ log }) {
  const hist = new Map();      // `${chainId}:${kind}` -> [{ wei, gasPrice }]
  const gasCache = new Map();  // chainId -> { at, price }
  const usdCache = new Map();  // symbol -> { at, usd }

  // Prices are kept warm in the background, so a trade never waits on a price lookup.
  async function fetchUsd(symbol) {
    const tries = [
      async () => Number((await (await fetch(`https://api.coinbase.com/v2/prices/${symbol}-USD/spot`, { signal: AbortSignal.timeout(4000) })).json())?.data?.amount),
      async () => { const j = await (await fetch(`https://api.kraken.com/0/public/Ticker?pair=${symbol === "ETH" ? "XETHZUSD" : `${symbol}USD`}`, { signal: AbortSignal.timeout(4000) })).json(); const v = Object.values(j?.result ?? {})[0]; return Number(v?.c?.[0]); },
    ];
    for (const t of tries) {
      try { const usd = await t(); if (usd > 0) { usdCache.set(symbol, { at: Date.now(), usd }); return usd; } } catch { /* next source */ }
    }
    return null;
  }
  async function nativeUsd(symbol) {
    const hit = usdCache.get(symbol);
    if (hit) { if (Date.now() - hit.at > 300_000) fetchUsd(symbol).catch(() => {}); return hit.usd; }
    return (await fetchUsd(symbol)) ?? NATIVE_FALLBACK[symbol] ?? 3000;
  }

  async function fetchGas(n) { const price = await n.pub.getGasPrice(); gasCache.set(n.c.chainId, { at: Date.now(), price }); return price; }
  async function gasPrice(n) {
    const hit = gasCache.get(n.c.chainId);
    if (hit) { if (Date.now() - hit.at > 15_000) fetchGas(n).catch(() => {}); return hit.price; }
    return fetchGas(n);
  }
  /** Fills the caches at start-up and keeps them fresh. */
  function warm(nets) {
    const run = () => { for (const n of nets) { fetchGas(n).catch(() => {}); fetchUsd(n.c.native ?? "ETH").catch(() => {}); } };
    run();
    setInterval(run, 60_000).unref?.();
  }

  /** Called after every relayed transaction. */
  function record(n, kind, rc) {
    if (!DEFAULT_GAS[kind] || !rc?.gasUsed || !rc?.effectiveGasPrice) return;
    const wei = rc.gasUsed * rc.effectiveGasPrice + (typeof rc.l1Fee === "bigint" ? rc.l1Fee : 0n);
    const key = `${n.c.chainId}:${kind}`;
    const list = hist.get(key) ?? [];
    list.push({ wei, gasPrice: rc.effectiveGasPrice });
    if (list.length > 30) list.shift();
    hist.set(key, list);
  }

  /** Live quote in the network's dollar units (6 decimals for USDC, 18 on BNB). */
  async function quote(n, kind) {
    const dec = n.c.usdDecimals ?? 6;
    const price = await gasPrice(n);
    const list = hist.get(`${n.c.chainId}:${kind}`) ?? [];
    let wei;
    if (list.length >= 3) {
      const m = median(list.map((x) => x.wei));
      const g = median(list.map((x) => x.gasPrice)) || 1n;
      // scale to today's gas price, within sane bounds
      let scale = Number(price) / Number(g);
      if (!Number.isFinite(scale)) scale = 1;
      scale = Math.min(5, Math.max(0.5, scale));
      wei = (m * BigInt(Math.round(scale * 1000))) / 1000n;
    } else {
      wei = (DEFAULT_GAS[kind] ?? 300_000n) * price * 3n / 2n; // no history yet: extra room for L1 data
    }
    const usd = (Number(wei) / 1e18) * (await nativeUsd(n.c.native ?? "ETH")) * MARGIN;
    const busy = usd > MAX_USD;
    const feeUsd = Math.min(MAX_USD, Math.max(MIN_USD, usd));
    const raw = BigInt(Math.ceil(feeUsd * 1e6)) * 10n ** BigInt(dec - 6);
    return { raw, usd: feeUsd, busy };
  }

  /** Rejects a signed fee that is clearly below today's cost (the site then asks again). */
  async function check(n, kind, signed) {
    if (!DEFAULT_GAS[kind]) return;
    let q;
    try { q = await quote(n, kind); } catch (e) { log(`fee quote failed on ${n.c.name}: ${e.message}`); return; } // never block trading on a quote error
    if (q.busy) { const e = new Error("The network is very busy right now. Please try again in a few minutes."); e.status = 503; e.code = "NETWORK_BUSY"; throw e; }
    const need = (q.raw * BigInt(Math.round(ACCEPT * 100))) / 100n;
    if (signed < need) { const e = new Error("The network fee changed. Please try again."); e.status = 409; e.code = "FEE_CHANGED"; throw e; }
  }

  return { record, quote, check, nativeUsd, warm };
}
