// Buying and selling Ascend's coins on ArkhamPad. Ascend (Elysium's partner launchpad) runs on PancakeSwap
// Infinity CL pools, paired with USDC, traded through its UniversalRouter with Permit2 approvals.
//
// One config: the addresses come from Cloudflare variables. Until NEXT_PUBLIC_ASCEND_ROUTER and
// NEXT_PUBLIC_ASCEND_CL_POOL_MANAGERS are set (mainnet addresses, on Nov 9), Ascend coins are shown but
// "Not tradable here yet". ASCEND_TESTNET keeps the testnet addresses the encoding was checked against.
//
// Fee: these trades go straight to Ascend's router, so ArkhamPad's 0.5% is not taken on them (that would
// need our own router contract supporting Infinity pools).
import { encodeFunctionData, parseAbi, type Address, type Hex } from "viem";
import type { Signer } from "./chain";
import type { EToken } from "./ely";
import { ELY_CHAIN, TradeFail, ely, findRevertData, nice, rememberToken, track, wait, type SentTrade } from "./elytrade";
import { MAX_U128, receivedFromRevert, swapCalldata, type InfiPoolKey } from "./ascend-encode";

const ZERO = "0x0000000000000000000000000000000000000000" as Address;
const CANONICAL_PERMIT2 = "0x000000000022D473030F116dDEE9F6B43aC78BA3" as Address;

/** Elysium testnet (99801) addresses, read from Ascend's verified contracts on Oct 31, 2026. */
export const ASCEND_TESTNET = {
  router: "0x90332B0ECbb2c9517F405627b0Dd5D5265246563",
  permit2: CANONICAL_PERMIT2,
  vault: "0x2B738A9A69b7a45C9dA6B519f6bE6efBfb912aeC",
  poolManagers: ["0x12E84206cB53aE0df055482ebc4658635096E1aA"],
  usdc: "0x84cc00d13173f7016bbab22a736dbf75a154cfe2",
} as const;

const list = (v?: string) => (v || "").split(",").map((x) => x.trim().toLowerCase()).filter((x) => /^0x[0-9a-f]{40}$/.test(x));
/** Elysium mainnet (99901): from Cloudflare variables. */
export const ASCEND = {
  router: (process.env.NEXT_PUBLIC_ASCEND_ROUTER || "").toLowerCase() as Address | "",
  permit2: (process.env.NEXT_PUBLIC_ASCEND_PERMIT2 || CANONICAL_PERMIT2) as Address,
  poolManagers: list(process.env.NEXT_PUBLIC_ASCEND_CL_POOL_MANAGERS),
};
export const ascendOn = /^0x[0-9a-f]{40}$/.test(ASCEND.router) && ASCEND.poolManagers.length > 0;
/** A coin in one of Ascend's pools (shown either way; tradable here once the mainnet addresses are set). */
export const isAscendPool = (t: EToken) => t.venue === "cl";
export const isAscend = (t: EToken) => ascendOn && t.venue === "cl" && !!t.manager && ASCEND.poolManagers.includes(t.manager.toLowerCase()) && !!t.pool;

const PM_ABI = parseAbi([
  "function poolIdToPoolKey(bytes32 id) view returns (address currency0, address currency1, address hooks, address poolManager, uint24 fee, bytes32 parameters)",
  "function getSlot0(bytes32 id) view returns (uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee)",
]);
const HOOK_ABI = parseAbi(["function getHooksRegistrationBitmap() view returns (uint16)"]);
const ERC20 = parseAbi([
  "function allowance(address,address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
]);
const PERMIT2_ABI = parseAbi([
  "function allowance(address user, address token, address spender) view returns (uint160 amount, uint48 expiration, uint48 nonce)",
  "function approve(address token, address spender, uint160 amount, uint48 expiration)",
]);
const MAX = (1n << 256n) - 1n;
const MAX_U160 = (1n << 160n) - 1n;

/** What the coin is paired with: USDC on Ascend (could be native HYPE elsewhere). */
export type QuoteToken = { address: Address; symbol: string; decimals: number; native: boolean; usd: boolean };
const quoteCache = new Map<string, QuoteToken>();
export async function quoteToken(t: EToken): Promise<QuoteToken> {
  const a = ((t.whype as string) || ZERO).toLowerCase() as Address;
  if (a === ZERO) return { address: ZERO, symbol: "HYPE", decimals: 18, native: true, usd: false };
  const hit = quoteCache.get(a);
  if (hit) return hit;
  const [symbol, decimals] = await Promise.all([
    ely().readContract({ address: a, abi: ERC20, functionName: "symbol" }).catch(() => "USDC"),
    ely().readContract({ address: a, abi: ERC20, functionName: "decimals" }).catch(() => 6),
  ]);
  const q = { address: a, symbol: String(symbol), decimals: Number(decimals), native: false, usd: /usd/i.test(String(symbol)) };
  quoteCache.set(a, q);
  return q;
}

/** The pool key, read from the pool manager; worked out from the indexed row if that read fails. */
const keyCache = new Map<string, InfiPoolKey>();
async function poolKey(t: EToken): Promise<InfiPoolKey> {
  const id = (t.pool || "") as Hex;
  const hit = keyCache.get(id);
  if (hit) return hit;
  const manager = t.manager as Address;
  let key: InfiPoolKey | null = null;
  try {
    const k = await ely().readContract({ address: manager, abi: PM_ABI, functionName: "poolIdToPoolKey", args: [id] });
    const [currency0, currency1, hooks, pm, fee, parameters] = k as readonly [Address, Address, Address, Address, number, Hex];
    if (pm && pm.toLowerCase() === manager.toLowerCase()) key = { currency0, currency1, hooks, poolManager: pm, fee: Number(fee), parameters };
  } catch {}
  if (!key) {
    const token = t.address.toLowerCase() as Address;
    const q = ((t.whype as string) || ZERO).toLowerCase() as Address;
    const hooks = (t.hooks || ZERO) as Address;
    const bitmap = hooks === ZERO ? 0n : BigInt(await ely().readContract({ address: hooks, abi: HOOK_ABI, functionName: "getHooksRegistrationBitmap" }));
    const parameters = `0x${((BigInt(t.tick_spacing ?? 0) << 16n) | bitmap).toString(16).padStart(64, "0")}` as Hex;
    key = t.token_is0
      ? { currency0: token, currency1: q, hooks, poolManager: manager, fee: t.fee ?? 0, parameters }
      : { currency0: q, currency1: token, hooks, poolManager: manager, fee: t.fee ?? 0, parameters };
  }
  keyCache.set(id, key);
  return key;
}
const zeroForOneOf = (key: InfiPoolKey, t: EToken, isBuy: boolean) => {
  const tokenIs0 = key.currency0.toLowerCase() === t.address.toLowerCase();
  return isBuy ? !tokenIs0 : tokenIs0; // buy: quote -> coin
};

/**
 * Exact output for `amountIn`: the swap is dry-run with an impossible minimum, so the router reverts with
 * TooLittleReceived(min, received) before any payment is taken (no balance or approval needed, nothing
 * changes on chain). That number includes the pool's and the hook's fees. If the dry run doesn't answer,
 * an estimate from the pool's current price and fee.
 */
export async function ascendQuote(t: EToken, isBuy: boolean, amountIn: bigint, from?: Address | null): Promise<bigint | null> {
  if (!isAscend(t) || amountIn <= 0n) return null;
  try {
    const key = await poolKey(t);
    const z = zeroForOneOf(key, t, isBuy);
    const native = (z ? key.currency0 : key.currency1).toLowerCase() === ZERO;
    const data = swapCalldata(key, z, amountIn, MAX_U128, BigInt(Math.floor(Date.now() / 1000) + 600));
    try {
      await ely().call({ account: from || ("0x000000000000000000000000000000000000dEaD" as Address), to: ASCEND.router as Address, data, value: native ? amountIn : 0n });
    } catch (e) {
      const got = receivedFromRevert(findRevertData(e));
      if (got != null && got > 0n) return got;
    }
    // estimate from the pool price
    const [sqrt, , , lpFee] = (await ely().readContract({ address: key.poolManager, abi: PM_ABI, functionName: "getSlot0", args: [t.pool as Hex] })) as readonly [bigint, number, number, number];
    if (!sqrt) return null;
    const Q192 = 1n << 192n;
    const p = sqrt * sqrt; // currency1 per currency0 × 2^192
    const out = z ? (amountIn * p) / Q192 : (amountIn * Q192) / p;
    return (out * (1_000_000n - BigInt(lpFee))) / 1_000_000n;
  } catch {
    return null;
  }
}

/** ERC20 → Permit2 (once, max) and Permit2 → router (once, a year): the transactions still needed. */
async function approvals(owner: Address, token: Address, amount: bigint): Promise<{ to: Address; data: Hex }[]> {
  const out: { to: Address; data: Hex }[] = [];
  const toPermit2 = await ely().readContract({ address: token, abi: ERC20, functionName: "allowance", args: [owner, ASCEND.permit2] }).catch(() => 0n);
  if (toPermit2 < amount) out.push({ to: token, data: encodeFunctionData({ abi: ERC20, functionName: "approve", args: [ASCEND.permit2, MAX] }) });
  const [allowed, expiration] = (await ely().readContract({ address: ASCEND.permit2, abi: PERMIT2_ABI, functionName: "allowance", args: [owner, token, ASCEND.router as Address] }).catch(() => [0n, 0, 0])) as readonly [bigint, number, number];
  if (allowed < amount || Number(expiration) < Math.floor(Date.now() / 1000) + 600) {
    const until = Math.floor(Date.now() / 1000) + 365 * 86400;
    out.push({ to: ASCEND.permit2, data: encodeFunctionData({ abi: PERMIT2_ABI, functionName: "approve", args: [token, ASCEND.router as Address, MAX_U160, until] }) });
  }
  return out;
}

async function trade(signer: Signer, t: EToken, isBuy: boolean, amountIn: bigint, minOut: bigint, onStep?: (s: string) => void): Promise<SentTrade> {
  if (!isAscend(t) || !signer.sendTx) throw new TradeFail("Trading for this token opens soon.");
  try {
    const key = await poolKey(t);
    const z = zeroForOneOf(key, t, isBuy);
    const tokenIn = (z ? key.currency0 : key.currency1) as Address;
    const native = tokenIn.toLowerCase() === ZERO;
    const data = swapCalldata(key, z, amountIn, minOut, BigInt(Math.floor(Date.now() / 1000) + 600));
    const value = native ? amountIn : 0n;
    const router = ASCEND.router as Address;
    const pre = native ? [] : await approvals(signer.address, tokenIn, amountIn);
    if (pre.length) {
      onStep?.("Approving…");
      if (signer.embedded && signer.nextNonce) {
        // built-in wallet: approvals and the trade go out back to back with consecutive nonces
        const n = await signer.nextNonce();
        if (n != null) {
          for (let i = 0; i < pre.length; i++) await signer.sendTx(ELY_CHAIN, { ...pre[i], gas: 100_000n, nonce: n + i });
          onStep?.(isBuy ? "Buying…" : "Selling…");
          const hash = await signer.sendTx(ELY_CHAIN, { to: router, data, value, gas: 600_000n, nonce: n + pre.length });
          rememberToken(t.address);
          return track(hash, t.address);
        }
      }
      for (const tx of pre) await wait(await signer.sendTx(ELY_CHAIN, { ...tx, gas: 100_000n }));
    }
    onStep?.(isBuy ? "Buying…" : "Selling…");
    let gas: bigint;
    try { gas = ((await ely().estimateGas({ account: signer.address, to: router, data, value })) * 13n) / 10n; } catch { gas = 600_000n; }
    const hash = await signer.sendTx(ELY_CHAIN, { to: router, data, value, gas });
    rememberToken(t.address);
    return track(hash, t.address);
  } catch (e) {
    throw e instanceof TradeFail ? e : new TradeFail(nice(e));
  }
}
export const ascendBuy = (signer: Signer, t: EToken, quoteIn: bigint, minOut: bigint, onStep?: (s: string) => void) => trade(signer, t, true, quoteIn, minOut, onStep);
export const ascendSell = (signer: Signer, t: EToken, amountIn: bigint, minOut: bigint, onStep?: (s: string) => void) => trade(signer, t, false, amountIn, minOut, onStep);
