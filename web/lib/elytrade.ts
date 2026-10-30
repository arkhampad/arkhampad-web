"use client";
// Trading any Elysium token from the user's own wallet, through the ArkhamPad router
// (contracts-elysium/src/ArkhamRouter.sol). One router works for every launchpad: Uniswap v3 style
// pools (called directly) and v4 style pools (through their pool manager). Pay and receive HYPE.
import { createPublicClient, decodeErrorResult, encodeFunctionData, fallback, http, parseAbi, type Address, type Hex } from "viem";
import type { Signer } from "./chain";
import type { EToken } from "./ely";

export const ELY_CHAIN = 99901;
/**
 * Elysium nodes, fastest first, re-ranked every minute; when one is slow or refuses us the next one
 * answers within a few seconds. Last in line is our own doorway (/api/ely-rpc on Cloudflare), which
 * has its own list of nodes. Change the list with NEXT_PUBLIC_ELY_RPCS (comma-separated).
 */
export const ELY_RPCS = (process.env.NEXT_PUBLIC_ELY_RPCS || process.env.NEXT_PUBLIC_ELY_RPC || "https://rpc-live.boxa.club,https://rpc.ronspad.fun").split(",").map((u) => u.trim()).filter(Boolean);
const OWN_RPC = "https://arkhampad.com/api/ely-rpc";
export const ELY_RPC_LIST = [...ELY_RPCS, OWN_RPC];
export const ELY_RPC = ELY_RPCS[0];

let rpcAt = 0;
/** One raw JSON-RPC call with the same fail-over (for calls viem has no helper for). */
export async function elyRpc<T = unknown>(method: string, params: unknown[]): Promise<T> {
  let last: unknown;
  for (let i = 0; i < ELY_RPC_LIST.length; i++) {
    const url = ELY_RPC_LIST[(rpcAt + i) % ELY_RPC_LIST.length];
    try {
      const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: AbortSignal.timeout(5000) });
      const j = await r.json();
      if (j.error) throw new Error(j.error.message);
      rpcAt = (rpcAt + i) % ELY_RPC_LIST.length;
      return j.result as T;
    } catch (e) {
      last = e;
    }
  }
  throw last;
}
/** Set once the router is deployed (Cloudflare env NEXT_PUBLIC_ELY_ROUTER). */
export const ROUTER = (process.env.NEXT_PUBLIC_ELY_ROUTER || "") as Address | "";
export const ELY_EXPLORER = process.env.NEXT_PUBLIC_ELY_EXPLORER || "";

let client: ReturnType<typeof createPublicClient> | null = null;
export const ely = () =>
  (client ??= createPublicClient({
    chain: { id: ELY_CHAIN, name: "Elysium", nativeCurrency: { name: "HYPE", symbol: "HYPE", decimals: 18 }, rpcUrls: { default: { http: ELY_RPC_LIST } } },
    pollingInterval: 400,
    transport: fallback(ELY_RPC_LIST.map((u) => http(u, { batch: { wait: 10 }, retryCount: 1, timeout: 5000 })), { rank: { interval: 60_000, sampleCount: 5, timeout: 2500 }, retryCount: 1 }),
  }));

const POOL = "(uint8 venue,address target,address token,address hype,bool tokenIs0,uint24 fee,int24 tickSpacing,address hooks)";
export const ROUTER_ABI = parseAbi([
  `function buy(${POOL} p, uint256 minOut, uint256 deadline) payable returns (uint256)`,
  `function sell(${POOL} p, uint256 amountIn, uint256 minOut, uint256 deadline) returns (uint256)`,
  `function quote(${POOL} p, bool isBuy, uint256 amountIn) returns (uint256)`,
  "error Quote(uint256 amountOut)",
]);
const ERC20 = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address,address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
]);
const MAX = (1n << 256n) - 1n;

export type PoolArg = { venue: number; target: Address; token: Address; hype: Address; tokenIs0: boolean; fee: number; tickSpacing: number; hooks: Address };
export function poolArg(t: EToken): PoolArg | null {
  const v4 = t.venue === "v4";
  const target = (v4 ? t.manager : t.pool) as Address | null;
  if (!target || !/^0x[0-9a-f]{40}$/i.test(target) || t.whype == null) return null;
  return {
    venue: v4 ? 4 : 3,
    target,
    token: t.address as Address,
    hype: t.whype as Address,
    tokenIs0: t.token_is0,
    fee: t.fee ?? 0,
    tickSpacing: t.tick_spacing ?? 0,
    hooks: (t.hooks || "0x0000000000000000000000000000000000000000") as Address,
  };
}
export const canTrade = (t: EToken) => !!ROUTER && !!poolArg(t);

export async function hypeBalance(addr: Address) {
  return ely().getBalance({ address: addr });
}
export async function tokenBalance(token: Address, addr: Address) {
  return ely().readContract({ address: token, abi: ERC20, functionName: "balanceOf", args: [addr] });
}

/** Expected output (wei of the other side) for `amountIn`; null when this pool can't be traded here. */
export async function quote(t: EToken, isBuy: boolean, amountIn: bigint): Promise<bigint | null> {
  const p = poolArg(t);
  if (!ROUTER || !p || amountIn <= 0n) return null;
  try {
    const { result } = await ely().simulateContract({ address: ROUTER, abi: ROUTER_ABI, functionName: "quote", args: [p, isBuy, amountIn] });
    return result as bigint;
  } catch (e) {
    // the router answers a quote by reverting with Quote(amountOut)
    const data = findRevertData(e);
    if (data) {
      try {
        const d = decodeErrorResult({ abi: ROUTER_ABI, data });
        if (d.errorName === "Quote") return d.args[0] as bigint;
      } catch {}
    }
    return null;
  }
}
function findRevertData(e: unknown): Hex | null {
  let cur = e as { data?: unknown; cause?: unknown; walk?: unknown } | undefined;
  for (let i = 0; cur && i < 8; i++) {
    const d = (cur as { data?: unknown }).data;
    if (typeof d === "string" && d.startsWith("0x")) return d as Hex;
    if (d && typeof d === "object" && typeof (d as { data?: unknown }).data === "string") return (d as { data: Hex }).data;
    cur = cur.cause as typeof cur;
  }
  const m = String((e as Error)?.message ?? "").match(/0x[0-9a-fA-F]{8,}/);
  return m ? (m[0] as Hex) : null;
}

export class TradeFail extends Error {}
const nice = (e: unknown) => {
  const m = String((e as Error)?.message ?? e);
  if (/insufficient funds/i.test(m)) return "Not enough HYPE for this trade and gas.";
  if (/rejected|denied|cancel/i.test(m)) return "Cancelled.";
  if (/Slippage|TooLittle|minOut/i.test(m)) return "Price moved. Try again or raise slippage.";
  const short = String((e as { shortMessage?: string })?.shortMessage || m).split("\n")[0].slice(0, 120);
  return `Trade failed: ${short}`;
};
async function wait(hash: Hex) {
  const r = await ely().waitForTransactionReceipt({ hash, timeout: 60_000, pollingInterval: 400 });
  if (r.status !== "success") throw new TradeFail("Trade failed on chain. Nothing was spent except gas.");
  return hash;
}

export async function buy(signer: Signer, t: EToken, hypeIn: bigint, minOut: bigint): Promise<Hex> {
  const p = poolArg(t);
  if (!ROUTER || !p || !signer.sendTx) throw new TradeFail("Trading for this token opens soon.");
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);
  try {
    const data = encodeFunctionData({ abi: ROUTER_ABI, functionName: "buy", args: [p, minOut, deadline] });
    let gas: bigint | undefined;
    try { gas = ((await ely().estimateGas({ account: signer.address, to: ROUTER, data, value: hypeIn })) * 13n) / 10n; } catch { gas = undefined; }
    const h = await wait(await signer.sendTx(ELY_CHAIN, { to: ROUTER, data, value: hypeIn, gas }));
    rememberToken(t.address);
    return h;
  } catch (e) {
    throw e instanceof TradeFail ? e : new TradeFail(nice(e));
  }
}

export async function sell(signer: Signer, t: EToken, amountIn: bigint, minOut: bigint, onStep?: (s: string) => void): Promise<Hex> {
  const p = poolArg(t);
  if (!ROUTER || !p || !signer.sendTx) throw new TradeFail("Trading for this token opens soon.");
  try {
    const allowed = await ely().readContract({ address: p.token, abi: ERC20, functionName: "allowance", args: [signer.address, ROUTER] });
    if (allowed < amountIn) {
      onStep?.("Approving…");
      await wait(await signer.sendTx(ELY_CHAIN, { to: p.token, data: encodeFunctionData({ abi: ERC20, functionName: "approve", args: [ROUTER, MAX] }), gas: 80_000n }));
      // the node that estimates the sell may be a block behind: wait until it sees the approval
      for (let i = 0; i < 25; i++) {
        const now = await ely().readContract({ address: p.token, abi: ERC20, functionName: "allowance", args: [signer.address, ROUTER] }).catch(() => 0n);
        if (now >= amountIn) break;
        await new Promise((r) => setTimeout(r, 300));
      }
    }
    onStep?.("Selling…");
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);
    const data = encodeFunctionData({ abi: ROUTER_ABI, functionName: "sell", args: [p, amountIn, minOut, deadline] });
    let gas: bigint | undefined;
    try { gas = ((await ely().estimateGas({ account: signer.address, to: ROUTER, data })) * 13n) / 10n; } catch { gas = 600_000n; }
    const h = await wait(await signer.sendTx(ELY_CHAIN, { to: ROUTER, data, gas }));
    rememberToken(t.address);
    return h;
  } catch (e) {
    throw e instanceof TradeFail ? e : new TradeFail(nice(e));
  }
}

export const toWei = (v: string, decimals = 18): bigint => {
  const s = v.trim().replace(",", ".");
  if (!/^\d*\.?\d*$/.test(s) || s === "" || s === ".") return 0n;
  const [a, b = ""] = s.split(".");
  return BigInt(a || "0") * 10n ** BigInt(decimals) + BigInt((b + "0".repeat(decimals)).slice(0, decimals) || "0");
};
export const fromWei = (v: bigint, decimals = 18) => Number(v) / 10 ** decimals;

// ---------------------------------------------------------------- instant balances
/** Tokens this browser just bought or created: shown on "You" right away, before the indexer catches up. */
export function rememberToken(token: string) {
  try {
    const k = "ap_recent_tokens";
    const list: string[] = JSON.parse(localStorage.getItem(k) || "[]");
    const next = [token.toLowerCase(), ...list.filter((x) => x !== token.toLowerCase())].slice(0, 40);
    localStorage.setItem(k, JSON.stringify(next));
  } catch {}
  balanceChanged();
}
export function recentTokens(): string[] {
  try { return JSON.parse(localStorage.getItem("ap_recent_tokens") || "[]"); } catch { return []; }
}
/** Tells every balance on screen to read again now (after a trade, launch, deposit or withdrawal). */
export function balanceChanged() {
  try { window.dispatchEvent(new Event("ap:balance")); } catch {}
}

// ---------------------------------------------------------------- brand-new coins
/** ArkhamPad's launcher (from the deploy record). */
export const LAUNCHER = (process.env.NEXT_PUBLIC_ELY_LAUNCHER || "") as Address | "";
const LAUNCHER_READ = parseAbi([
  "function coins(address) view returns (uint256 tokenId, address pool, address creator, uint16 creatorBps, bool coinIsToken0)",
  "function wrapped() view returns (address)",
]);
const META_READ = parseAbi(["function name() view returns (string)", "function symbol() view returns (string)", "function totalSupply() view returns (uint256)"]);
const SLOT0_READ = parseAbi(["function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16, uint16, uint16, uint8, bool)"]);

/**
 * A coin from our launcher read straight from the chain, for the minute before the indexer has it
 * (right after someone launches). Enough to show the page and trade it; null if it isn't ours.
 */
export async function chainToken(address: string): Promise<EToken | null> {
  if (!LAUNCHER) return null;
  const a = address.toLowerCase() as Address;
  try {
    const c = ely();
    const [info, wrapped] = await Promise.all([
      c.readContract({ address: LAUNCHER, abi: LAUNCHER_READ, functionName: "coins", args: [a] }),
      c.readContract({ address: LAUNCHER, abi: LAUNCHER_READ, functionName: "wrapped" }),
    ]);
    const [, pool, creator, , tokenIs0] = info as readonly [bigint, Address, Address, number, boolean];
    if (!pool || /^0x0{40}$/i.test(pool)) return null;
    const [name, symbol, supply, slot] = await Promise.all([
      c.readContract({ address: a, abi: META_READ, functionName: "name" }),
      c.readContract({ address: a, abi: META_READ, functionName: "symbol" }),
      c.readContract({ address: a, abi: META_READ, functionName: "totalSupply" }),
      c.readContract({ address: pool, abi: SLOT0_READ, functionName: "slot0" }),
    ]);
    const s = Number((slot as readonly [bigint, ...unknown[]])[0]) / 2 ** 96;
    const p = s * s;
    const price = tokenIs0 ? p : p > 0 ? 1 / p : 0;
    const now = new Date().toISOString();
    return {
      address: a, name, symbol, decimals: 18, supply: supply.toString(), image: `/api/ely-img?a=${a}`, description: null,
      launchpad: "ArkhamPad", venue: "v3", pool: pool.toLowerCase(), manager: null, whype: (wrapped as string).toLowerCase(), token_is0: tokenIs0,
      fee: 10000, tick_spacing: 200, hooks: null, creator: (creator as string).toLowerCase(), ours: true, created_at: now,
      price_hype: price, mcap_hype: price * (Number(supply) / 1e18), vol24_hype: 0, buys24: 0, sells24: 0, change24: 0,
      holders: 1, top10_pct: null, last_trade_at: null,
    } as unknown as EToken;
  } catch {
    return null;
  }
}
