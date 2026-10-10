// Fair-price guard for coins from other DEXs.
// A DEX route can see only a nearly empty pool (a new Uniswap v4 pool it doesn't know yet, say) and
// then quotes a tiny fraction of the coin's real value. Every buy and sell is checked against the
// market price DexScreener shows (GeckoTerminal when DexScreener has none). A trade that would fill
// more than MAX_DEV worse than that price is refused; with no market price at all it is refused too.
export const MAX_DEV = 0.07; // 7% worse than the market price, before ArkhamPad's 1% and the 2% room
export const GUARD_MSG = "We couldn't get a fair price for this coin right now, so the trade was stopped to protect you. Please try again in a few minutes.";
export const UNLISTED_MSG = "This coin doesn't pass ArkhamPad's safety checks, so buying it is turned off. If you hold it, you can still sell.";
const SLUG ={ 8453: { dex: "base", gt: "base" }, 56: { dex: "bsc", gt: "bsc" }, 4663: { dex: "robinhood", gt: "robinhood" } };
const cache = new Map();

/** Market price in USD of one whole coin, or null when no screener has one. Cached 15 s. */
export async function refPrice(chainId, coin, fetchFn = fetch) {
  const c = String(coin).toLowerCase();
  const key = `${chainId}:${c}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.t < 15_000) return hit.p;
  const s = SLUG[chainId];
  if (!s) return null;
  let p = null;
  try {
    const r = await fetchFn(`https://api.dexscreener.com/latest/dex/tokens/${c}`, { signal: AbortSignal.timeout(6000) });
    const j = await r.json();
    // the coin's own pairs on this chain, deepest pool first
    const pairs = (j?.pairs ?? []).filter((x) => x.chainId === s.dex && String(x.baseToken?.address ?? "").toLowerCase() === c && Number(x.priceUsd) > 0);
    pairs.sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0));
    if (pairs[0]) p = Number(pairs[0].priceUsd);
  } catch { /* fall through to GeckoTerminal */ }
  if (!p) {
    try {
      const r = await fetchFn(`https://api.geckoterminal.com/api/v2/simple/networks/${s.gt}/token_price/${c}`, { signal: AbortSignal.timeout(6000) });
      const j = await r.json();
      const v = Number(j?.data?.attributes?.token_prices?.[c]);
      if (v > 0) p = v;
    } catch { /* no price */ }
  }
  if (p) cache.set(key, { t: Date.now(), p });
  return p;
}

export const NOSELL_MSG = "This coin can't be sold through ArkhamPad right now, so buying it is turned off to protect you. Please try again later.";
export const SELL_FLOOR = 0.85; // selling back what a buy gets must return at least 85% of its market value

/**
 * Before any buy: can the coins it gets be sold back, near the market price? (KyberSwap quote only.)
 * A coin you can buy but not sell is how a user got stuck; such a buy is refused.
 * Returns { ok, back } where back is the share of market value a sale would return.
 */
export async function sellBackOk({ chainId, coin, coins, coinDec, usdc, usdcDec, price }, fetchFn = fetch) {
  const s = SLUG[chainId];
  if (!s || !(price > 0) || coins <= 0n) return { ok: false, back: 0 };
  try {
    const r = await fetchFn(`https://aggregator-api.kyberswap.com/${s.dex}/api/v1/routes?tokenIn=${coin}&tokenOut=${usdc}&amountIn=${coins}&excludeRFQSources=true`, { headers: { "x-client-id": "arkhampad" }, signal: AbortSignal.timeout(8000) });
    const j = await r.json().catch(() => null);
    const out = j?.data?.routeSummary?.amountOut;
    if (!out) return { ok: false, back: 0 };
    const value = (Number(coins) / 10 ** coinDec) * price;
    const back = Number(out) / 10 ** usdcDec / value;
    return { ok: back >= SELL_FLOOR, back };
  } catch { return { ok: false, back: 0 }; }
}

/**
 * Checks a signed PadExtSwap trade. Amounts are on-chain units (bigint).
 * buy:  amountIn = USDC paid (ArkhamPad keeps 1%), minOut = least coins received
 * sell: amountIn = coins sold, minOut = least USDC received after the 1% and the network fee `fee`
 * The site signs minOut = 98% of the route's quote, so a fair route always passes.
 * Returns { ok, dev } where dev is how much worse than the market price the trade can fill.
 */
export function judge({ isBuy, amountIn, minOut, fee, coinDec, usdcDec, price }) {
  if (!(price > 0)) return { ok: false, dev: 1 };
  const coins = (v) => Number(v) / 10 ** coinDec;
  const usd = (v) => Number(v) / 10 ** usdcDec;
  let worst; // the least the user can get, as a share of the market value of what they give
  if (isBuy) {
    const spend = usd(amountIn) * 0.99;
    worst = spend > 0 ? (coins(minOut) * price) / (spend * 0.98) : 0;
  } else {
    const value = coins(amountIn) * price;
    worst = value > 0 ? (usd(minOut) + usd(fee)) / (value * 0.99 * 0.98) : 0;
  }
  const dev = 1 - worst;
  return { ok: dev <= MAX_DEV, dev };
}
