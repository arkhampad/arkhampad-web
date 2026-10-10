"use client";
// Trading coins listed on other DEXs (mainnet only): live quotes from the KyberSwap aggregator,
// gasless execution through PadExtSwap (the user signs; ArkhamPad takes 1%).
import { createPublicClient, domainSeparator, encodeFunctionData, http, parseAbi, type Address, type Hex } from "viem";
import { TradeError, client, ensureCash, netFee, netOf, receipt, type Signer } from "./chain";

// route: PadClankerRoute, ArkhamPad's own route into Clanker pools (no aggregator); weth + hook build a Clanker pool's key
type ExtNet = { id: number; slug: string; usdc: Address; usdcDecimals: number; rpc: string; swap: Address | null; permitUsdc: boolean; route: Address | null; weth: Address; hook: Address };
// NEXT_PUBLIC_* values reach the browser only when written as literal process.env.NAME
const env = (k: string) => (process.env as Record<string, string | undefined>)[k] || "";
const BNB_ROUTE: Address | null = "0xD8cAF98C955D8c1071807d4884BB04Ea2Ac55a49"; // PadClankerRoute on BNB Chain
export const EXT_NETS: ExtNet[] = [
  { id: 8453, slug: "base", usdc: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", usdcDecimals: 6, rpc: "https://mainnet.base.org", swap: (process.env.NEXT_PUBLIC_EXT_SWAP_8453 || null) as Address | null, permitUsdc: true,
    route: "0xB4B9F1706537eA2E876Ce8e3684dc982f05Da69E", weth: "0x4200000000000000000000000000000000000006", hook: "0xb429d62f8f3bFFb98CdB9569533eA23bF0Ba28CC" },
  { id: 4663, slug: "robinhood", usdc: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168", usdcDecimals: 6, rpc: "https://robinhood.drpc.org", swap: (process.env.NEXT_PUBLIC_EXT_SWAP_4663 || "0x9Ff5e104Dc5EEA1118bF719fF347cB09dccd6231") as Address | null, permitUsdc: true,
    route: "0x5abe87751c6d0942805f53F33a4fa022255C08D1", weth: "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73", hook: "0x48B8F6AD3A1b4aA477314c9a23035b8F84dDe8cc" },
  { id: 56, slug: "bsc", usdc: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d", usdcDecimals: 18, rpc: "https://bsc-rpc.publicnode.com", swap: (process.env.NEXT_PUBLIC_EXT_SWAP_56 || "0x3f49Ab48d9e04bd12D9D5613d2d879Eb754a5CA9") as Address | null, permitUsdc: false,
    route: BNB_ROUTE, weth: "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c", hook: "0xC5d309026BCAb6630888d51CE21154AD2f4828cC" },
];
export const extNet = (chainId: number) => EXT_NETS.find((n) => n.id === chainId) ?? null;
/** Can this coin be traded here right now? (needs PadExtSwap on its network = mainnet) */
export const extTradable = (chainId: number) => !!extNet(chainId)?.swap;

const API = "https://aggregator-api.kyberswap.com";
const HEAD = { "x-client-id": "arkhampad" };
export const FEE_BPS = 100n;
// The site counts dollars with 6 decimals; some networks' USDC has more (BNB Chain: 18).
// These convert at the edge, right where amounts go to or come from the chain.
const scaleOf = (n: ExtNet) => 10n ** BigInt(n.usdcDecimals - 6);
const up = (n: ExtNet, v: bigint) => v * scaleOf(n); // site units -> chain units
const down = (n: ExtNet, v: bigint) => v / scaleOf(n); // chain units -> site units
/** What PadExtSwap spends on the DEX for a buy of `amountIn` (chain units): the amount less its 1% fee. */
const spendOf = (amountIn: bigint) => amountIn - (amountIn * FEE_BPS) / 10_000n;

type Route = { amountOut: bigint; summary: unknown; router: Address };
async function route(n: ExtNet, tokenIn: Address, tokenOut: Address, amountIn: bigint): Promise<Route> {
  const r = await fetch(`${API}/${n.slug}/api/v1/routes?tokenIn=${tokenIn}&tokenOut=${tokenOut}&amountIn=${amountIn}&excludeRFQSources=true&gasInclude=true`, { headers: HEAD }).catch(() => null);
  const j = r ? await r.json().catch(() => null) : null;
  const d = j?.data;
  if (!r?.ok || !d?.routeSummary) throw new TradeError("No price for this coin right now.");
  return { amountOut: BigInt(d.routeSummary.amountOut), summary: d.routeSummary, router: d.routerAddress as Address };
}

// ---- ArkhamPad's own route into Clanker pools (PadClankerRoute): no aggregator needed.
// A Clanker coin's pool: coin/WETH, Clanker's dynamic fee flag, spacing 200, Clanker's fee hook.
type PoolKey = { currency0: Address; currency1: Address; fee: number; tickSpacing: number; hooks: Address };
const KEY_TYPE = { type: "tuple", components: [{ name: "currency0", type: "address" }, { name: "currency1", type: "address" }, { name: "fee", type: "uint24" }, { name: "tickSpacing", type: "int24" }, { name: "hooks", type: "address" }] } as const;
const ROUTE_ABI = [
  { type: "function", name: "quote", stateMutability: "nonpayable", inputs: [{ name: "isBuy", type: "bool" }, { name: "coin", type: "address" }, { name: "amountIn", type: "uint256" }, { name: "coinKey", ...KEY_TYPE }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "quoteRoundTrip", stateMutability: "nonpayable", inputs: [{ name: "coin", type: "address" }, { name: "usdcIn", type: "uint256" }, { name: "coinKey", ...KEY_TYPE }], outputs: [{ type: "uint256" }, { type: "uint256" }] },
  { type: "function", name: "buy", stateMutability: "nonpayable", inputs: [{ name: "coin", type: "address" }, { name: "usdcIn", type: "uint256" }, { name: "coinKey", ...KEY_TYPE }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "sell", stateMutability: "nonpayable", inputs: [{ name: "coin", type: "address" }, { name: "coinsIn", type: "uint256" }, { name: "coinKey", ...KEY_TYPE }], outputs: [{ type: "uint256" }] },
] as const;
/** A Clanker pool to trade through ArkhamPad's route: its pool id, and its hook when it isn't the
 *  network's default (a Clanker coin launched elsewhere: the hook the indexer matched to the pool id). */
export type RoutePool = { id: string; hook?: string | null };
// Clanker's own fee hooks (clanker-sdk `related`), the only hooks the route trades through
const HOOKS: Record<number, string[]> = {
  8453: ["0xDd5EeaFf7BD481AD55Db083062b13a3cdf0A68CC", "0xb429d62f8f3bFFb98CdB9569533eA23bF0Ba28CC", "0x34a45c6B61876d739400Bd71228CbcbD4F53E8cC", "0xd60D6B218116cFd801E28F78d011a203D2b068Cc"],
  56: ["0xC5d309026BCAb6630888d51CE21154AD2f4828cC", "0x011a8ed40095F2D7E9c19125B8254b19678D68Cc"],
  4663: ["0x48B8F6AD3A1b4aA477314c9a23035b8F84dDe8cc", "0x65efDF8Cce99b53C925DF878Df275Df21cB6E8Cc"],
};
/** The Clanker pool key of `coin`, checked against the pool id the indexer saved. */
async function clankerKey(n: ExtNet, coin: Address, rp: RoutePool): Promise<PoolKey> {
  if (!n.route) throw new TradeError("Trading this coin here opens soon.");
  const { encodeAbiParameters, keccak256 } = await import("viem");
  const [c0, c1] = BigInt(coin) < BigInt(n.weth) ? [coin, n.weth] : [n.weth, coin];
  const hook = (rp.hook || n.hook) as Address;
  if (!(HOOKS[n.id] ?? []).some((h) => h.toLowerCase() === hook.toLowerCase())) throw new TradeError("Trading this coin here opens soon.");
  const key: PoolKey = { currency0: c0, currency1: c1, fee: 0x800000, tickSpacing: 200, hooks: hook };
  if (keccak256(encodeAbiParameters([KEY_TYPE], [key])).toLowerCase() !== String(rp.id).toLowerCase()) throw new TradeError("Trading this coin here opens soon.");
  return key;
}
async function routeQuote(n: ExtNet, isBuy: boolean, coin: Address, amountIn: bigint, key: PoolKey): Promise<bigint> {
  const r = await pub(n).simulateContract({ address: n.route!, abi: ROUTE_ABI, functionName: "quote", args: [isBuy, coin, amountIn, key] }).catch(() => null);
  if (!r || !(r.result > 0n)) throw new TradeError(GUARD_MSG);
  return r.result;
}
/** Buy, then sell everything straight back (one simulation): must return at least 85% of the dollars. */
async function routeSellBack(n: ExtNet, coin: Address, usdcIn: bigint, key: PoolKey) {
  const r = await pub(n).simulateContract({ address: n.route!, abi: ROUTE_ABI, functionName: "quoteRoundTrip", args: [coin, usdcIn, key] }).catch(() => null);
  const back = r ? r.result[1] : 0n;
  if (!(Number(back) >= Number(usdcIn) * SELL_FLOOR)) throw new TradeError(NOSELL_MSG);
}

// Fair-price guard (the relayer checks the same): a DEX route can see only a nearly empty pool
// and quote a tiny fraction of a coin's real value. A route more than 7% worse than the market
// price DexScreener (or GeckoTerminal) shows is never traded; with no market price, neither.
const MAX_DEV = 0.07;
export const UNLISTED_MSG = "This coin doesn't pass ArkhamPad's safety checks, so buying it is turned off. If you hold it, you can still sell.";
export const NOSELL_MSG = "This coin can't be sold through ArkhamPad right now, so buying it is turned off to protect you. Please try again later.";
const SELL_FLOOR = 0.85;
export const GUARD_MSG = "We couldn't get a fair price for this coin right now, so the trade was stopped to protect you. Please try again in a few minutes.";
const refCache = new Map<string, { t: number; p: number }>();
async function refPrice(n: ExtNet, coin: Address): Promise<number | null> {
  const c = coin.toLowerCase(), key = `${n.id}:${c}`;
  const hit = refCache.get(key);
  if (hit && Date.now() - hit.t < 15_000) return hit.p;
  let p: number | null = null;
  try {
    const j = await (await fetch(`https://api.dexscreener.com/latest/dex/tokens/${c}`, { signal: AbortSignal.timeout(6000) })).json();
    const pairs = ((j?.pairs ?? []) as { chainId: string; baseToken?: { address?: string }; priceUsd?: string; liquidity?: { usd?: number } }[])
      .filter((x) => x.chainId === n.slug && String(x.baseToken?.address ?? "").toLowerCase() === c && Number(x.priceUsd) > 0)
      .sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0));
    if (pairs[0]) p = Number(pairs[0].priceUsd);
  } catch { /* GeckoTerminal next */ }
  if (!p) {
    try {
      const j = await (await fetch(`https://api.geckoterminal.com/api/v2/simple/networks/${n.slug}/token_price/${c}`, { signal: AbortSignal.timeout(6000) })).json();
      const v = Number(j?.data?.attributes?.token_prices?.[c]);
      if (v > 0) p = v;
    } catch { /* no price */ }
  }
  if (p) refCache.set(key, { t: Date.now(), p });
  return p;
}
/** Throws when the route fills more than 7% worse than the market price (amounts in chain units). */
async function guard(n: ExtNet, coin: Address, isBuy: boolean, amountIn: bigint, amountOut: bigint, key?: PoolKey) {
  const [price, dec] = await Promise.all([refPrice(n, coin), extDecimals(n.id, coin)]);
  if (!price) throw new TradeError(GUARD_MSG);
  const usd = (v: bigint) => Number(v) / 10 ** n.usdcDecimals, coins = (v: bigint) => Number(v) / 10 ** dec;
  const fair = isBuy ? (coins(amountOut) * price) / usd(amountIn) : usd(amountOut) / (coins(amountIn) * price);
  if (!(fair >= 1 - MAX_DEV)) throw new TradeError(GUARD_MSG);
  if (isBuy && key) return routeSellBack(n, coin, amountIn, key); // own route: buy-then-sell simulation
  if (isBuy) {
    // a buy only when what it gets can be sold back near the market price (the relayer checks it too)
    const r = await fetch(`${API}/${n.slug}/api/v1/routes?tokenIn=${coin}&tokenOut=${n.usdc}&amountIn=${amountOut}&excludeRFQSources=true`, { headers: HEAD }).catch(() => null);
    const j = r ? await r.json().catch(() => null) : null;
    const out = j?.data?.routeSummary?.amountOut;
    const back = out ? usd(BigInt(out)) / (coins(amountOut) * price) : 0;
    if (!(back >= SELL_FLOOR)) throw new TradeError(NOSELL_MSG);
  }
}

/** What the user gets: buy = coins for `usd` dollars (after 1%), sell = USDC for `coins` (after 1%). */
/** rp: a Clanker pool (a coin launched on ArkhamPad, or a Clanker coin from elsewhere whose pool the
 *  indexer matched): quoted and traded through ArkhamPad's own route. */
export async function extQuote(chainId: number, coin: Address, side: "buy" | "sell", amount: bigint, rp?: RoutePool) {
  const n = extNet(chainId);
  if (!n) throw new TradeError("Quotes aren't available for this network yet.");
  if (rp) {
    const key = await clankerKey(n, coin, rp);
    if (side === "buy") {
      const spend = spendOf(up(n, amount));
      const out = await routeQuote(n, true, coin, spend, key);
      await guard(n, coin, true, spend, out, key);
      return out;
    }
    const o = await routeQuote(n, false, coin, amount, key);
    await guard(n, coin, false, amount, o, key);
    const out = down(n, o);
    return out - (out * FEE_BPS) / 10_000n;
  }
  if (side === "buy") {
    const spend = spendOf(up(n, amount));
    const r = await route(n, n.usdc, coin, spend);
    await guard(n, coin, true, spend, r.amountOut);
    return r.amountOut;
  }
  const r = await route(n, coin, n.usdc, amount);
  await guard(n, coin, false, amount, r.amountOut);
  const out = down(n, r.amountOut); // site units
  return out - (out * FEE_BPS) / 10_000n;
}

const ERC = parseAbi(["function balanceOf(address) view returns (uint256)", "function allowance(address,address) view returns (uint256)", "function nonces(address) view returns (uint256)", "function name() view returns (string)", "function decimals() view returns (uint8)"]);
// the site's client for the network (main node plus backups), so one public node that fails or
// rate-limits never shows a balance of 0 or stops a trade
const pub = (n: ExtNet) => (netOf(n.id) ? client(n.id) : createPublicClient({ transport: http(n.rpc) }));
export async function extDecimals(chainId: number, token: Address): Promise<number> {
  const n = extNet(chainId);
  if (!n) return 18;
  return pub(n).readContract({ address: token, abi: parseAbi(["function decimals() view returns (uint8)"]), functionName: "decimals" }).then(Number).catch(() => 18);
}

export async function extBalance(chainId: number, token: Address, who: Address) {
  const n = extNet(chainId);
  if (!n) return 0n;
  // a failed read is asked again before it counts as 0
  for (let i = 0; i < 3; i++) {
    const b = await pub(n).readContract({ address: token, abi: ERC, functionName: "balanceOf", args: [who] }).catch(() => null);
    if (b !== null) return b;
    await new Promise((ok) => setTimeout(ok, 500));
  }
  return 0n;
}

const RELAYER = process.env.NEXT_PUBLIC_RELAYER_URL || "https://arkhampad-web-production.up.railway.app";
async function relay(body: Record<string, unknown>) {
  const r = await fetch(`${RELAYER}/relay`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
  const j = r ? await r.json().catch(() => ({})) : {};
  if (!r || !r.ok) { const e = new TradeError(j.error || "Something went wrong. Please try again."); (e as TradeError & { code?: string }).code = j.code; throw e; }
  return j;
}

/**
 * One-time approval for PadExtSwap. Signed (no gas) when the token supports permits;
 * otherwise the wallet approves once with a little gas from ArkhamPad, which the user
 * repays in USDC inside this trade's network fee. Returns that extra fee (0 if none).
 */
async function ensurePermit(n: ExtNet, s: Signer, token: Address, need: bigint): Promise<bigint> {
  const c = pub(n);
  if ((await c.readContract({ address: token, abi: ERC, functionName: "allowance", args: [s.address, n.swap!] })) >= need) return 0n;
  let nonce: bigint, name: string;
  try { [nonce, name] = await Promise.all([c.readContract({ address: token, abi: ERC, functionName: "nonces", args: [s.address] }), c.readContract({ address: token, abi: ERC, functionName: "name" })]); }
  catch { return approveWithGas(n, s, token, need); }
  const MAX = 2n ** 256n - 1n, deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
  const sep = await c.readContract({ address: token, abi: parseAbi(["function DOMAIN_SEPARATOR() view returns (bytes32)"]), functionName: "DOMAIN_SEPARATOR" }).catch(() => null);
  const version = ["2", "1"].find((v) => sep && domainSeparator({ domain: { name, version: v, chainId: n.id, verifyingContract: token } }) === sep) ?? (token.toLowerCase() === n.usdc.toLowerCase() ? "2" : "1");
  const signature = await s.signTypedData(n.id, { domain: { name, version, chainId: n.id, verifyingContract: token }, types: { Permit: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }, { name: "value", type: "uint256" }, { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint256" }] }, primaryType: "Permit", message: { owner: s.address, spender: n.swap!, value: MAX, nonce, deadline } });
  await relay({ chainId: n.id, kind: "permitExt", token, owner: s.address, value: MAX.toString(), deadline: deadline.toString(), signature });
  return 0n;
}

/** A wallet that never answers must not leave the trade spinning: give up after `ms`. */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([p, new Promise<T>((_, no) => setTimeout(() => no(new TradeError("Your wallet didn't respond. Please try again.")), ms))]);
}

async function approveWithGas(n: ExtNet, s: Signer, token: Address, need: bigint): Promise<bigint> {
  if (!s.sendTx) throw new TradeError("This wallet can't approve this coin yet. Please try again from your ArkhamPad account.");
  const r = await relay({ chainId: n.id, kind: "gas", user: s.address, token, spender: "ext" });
  const owed = down(n, BigInt(String(r?.owed ?? "0"))); // the relayer answers in chain units
  const hash = await withTimeout(s.sendTx(n.id, { to: token, data: encodeFunctionData({ abi: parseAbi(["function approve(address,uint256) returns (bool)"]), functionName: "approve", args: [n.swap!, 2n ** 256n - 1n] }) }), 60_000);
  const c = pub(n);
  // ask for the receipt directly: a load-balanced node a block behind must not fail the wait
  await receipt(n.id, hash, 60_000, 300).catch(() => { throw new TradeError("Approval is taking longer than usual. Please try again in a minute."); });
  void c;
  for (let i = 0; i < 12; i++) {
    if ((await c.readContract({ address: token, abi: ERC, functionName: "allowance", args: [s.address, n.swap!] }).catch(() => 0n)) >= need) return owed;
    await new Promise((ok) => setTimeout(ok, 700));
  }
  throw new TradeError("Approval didn't go through. Please try again.");
}

const TYPES = { ExtSwap: [["user", "address"], ["isBuy", "bool"], ["coin", "address"], ["amountIn", "uint256"], ["minOut", "uint256"], ["target", "address"], ["dataHash", "bytes32"], ["fee", "uint256"], ["nonce", "uint256"], ["deadline", "uint256"]].map(([name, type]) => ({ name, type })) };

/** Buys or sells a coin from another DEX. Fills within 2% of the quote; thin pools move between the
 *  quote and the trade, so when the route fails or the price moved, it is quoted again and retried
 *  (twice) with 3%, then 4% room. The fair-price guard (7% from the market price) always holds. */
export async function extTrade(chainId: number, coin: Address, side: "buy" | "sell", amount: bigint, s: Signer, rp?: RoutePool) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await extTradeOnce(chainId, coin, side, amount, s, attempt, rp);
    } catch (e) {
      // the pool moved between the quote and the trade: quote again and retry (twice), each time with
      // a little more room (2% -> 3% -> 4%), never past the fair-price guard (7% from the market price)
      const code = (e as { code?: string })?.code;
      if (attempt >= 2 || (code !== "SwapFailed" && code !== "Slippage")) throw e;
      await new Promise((ok) => setTimeout(ok, 600));
    }
  }
}

async function extTradeOnce(chainId: number, coin: Address, side: "buy" | "sell", amount: bigint, s: Signer, attempt: number, rp?: RoutePool) {
  const n = extNet(chainId);
  if (!n || !n.swap) throw new TradeError("Trading coins from other DEXs opens on mainnet.");
  const isBuy = side === "buy";
  const NET_FEE = await netFee(n.id, "extSwap"); // live network fee (site units: 6 decimals)
  // cash on another network comes over first (a few cents of room for any gas still owed)
  if (isBuy) await ensureCash(n.id, amount + NET_FEE + 50_000n, s);
  // BNB Chain (18-decimal USDC): full buy + sell passed the fork test (Oct 10, CAKE, RFQ sources left out)
  // what goes on-chain: a buy's dollars in the network's USDC units; a sell's coins as they are
  const amountIn = isBuy ? up(n, amount) : amount;
  const spend = isBuy ? spendOf(amountIn) : amountIn;
  let r: { amountOut: bigint }, data: Hex, target: Address;
  if (rp) {
    // a Clanker coin: ArkhamPad's own route into its pool (quoted on-chain)
    const key = await clankerKey(n, coin, rp);
    r = { amountOut: await routeQuote(n, isBuy, coin, spend, key) };
    await guard(n, coin, isBuy, spend, r.amountOut, key); // never trade far below the market price
    data = encodeFunctionData({ abi: ROUTE_ABI, functionName: isBuy ? "buy" : "sell", args: [coin, spend, key] });
    target = n.route!;
  } else {
    const kr = await route(n, isBuy ? n.usdc : coin, isBuy ? coin : n.usdc, spend);
    r = kr;
    await guard(n, coin, isBuy, spend, kr.amountOut); // never trade far below the market price
    const build = await fetch(`${API}/${n.slug}/api/v1/route/build`, { method: "POST", headers: { ...HEAD, "content-type": "application/json" }, body: JSON.stringify({ routeSummary: kr.summary, sender: n.swap, recipient: n.swap, slippageTolerance: [150, 300, 500][attempt] ?? 500, deadline: Math.floor(Date.now() / 1000) + 600 }) }).catch(() => null);
    const b = build ? await build.json().catch(() => null) : null;
    if (!build?.ok || !b?.data?.data) throw new TradeError("Couldn't prepare the trade. Please try again.");
    data = b.data.data as Hex;
    target = b.data.routerAddress as Address;
  }
  const extra = await ensurePermit(n, s, isBuy ? n.usdc : coin, isBuy ? up(n, amount + NET_FEE) : amount); // site units back
  // a first-time approval top-up is repaid here, never by ArkhamPad (the relayer keeps the
  // amount, so an earlier attempt that stopped half way is still counted exactly once)
  const owed = await fetch(`${RELAYER}/fee?chainId=${n.id}&kind=extSwap&user=${s.address}`, { cache: "no-store" })
    .then((r) => r.json()).then((j) => BigInt(String(j?.owed ?? "0"))).catch(() => extra);
  const FEE = NET_FEE + (owed > extra ? owed : extra); // site units
  const feeChain = up(n, FEE);
  // buys: coins out; sells: USDC to the user after the 1% fee and the network fee (chain units)
  const quoted = isBuy ? r.amountOut : r.amountOut - (r.amountOut * FEE_BPS) / 10_000n - feeChain;
  if (!isBuy && quoted <= 0n) throw new TradeError("This sale is too small to cover the network fee.");
  const minOut = (quoted * ([98n, 97n, 96n][attempt] ?? 96n)) / 100n; // more room on each retry
  const { keccak256 } = await import("viem");
  const nonce = BigInt(Date.now()) * 1000n + BigInt(Math.floor(Math.random() * 1000));
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);
  const msg = { user: s.address, isBuy, coin, amountIn, minOut, target, dataHash: keccak256(data), fee: feeChain, nonce, deadline };
  const signature = await s.signTypedData(n.id, { domain: { name: "ArkhamPad Swap", version: "1", chainId: n.id, verifyingContract: n.swap }, types: TYPES, primaryType: "ExtSwap", message: msg });
  const S = (v: bigint) => v.toString();
  const res = await relay({ chainId: n.id, kind: "extSwap", swap: { user: s.address, isBuy, coin, amountIn: S(amountIn), minOut: S(minOut), target, data, fee: S(feeChain), nonce: S(nonce), deadline: S(deadline), signature } });
  // a trade that was sent but failed on-chain must never look like it went through
  if (res?.status && res.status !== "success") throw new TradeError("The trade didn't go through. Your funds are safe; please try again.");
  return res;
}
