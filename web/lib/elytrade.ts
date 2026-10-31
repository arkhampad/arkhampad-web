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
// ElysPump's node first (Oct 31: the others stopped seeing new blocks), then whatever the variable lists.
const MAIN_RPCS = ["https://rpc-live.elysp.com", "https://rpc-live.boxa.club"];
export const ELY_RPCS = [...new Set([MAIN_RPCS[0], ...(process.env.NEXT_PUBLIC_ELY_RPCS || process.env.NEXT_PUBLIC_ELY_RPC || "").split(",").map((u) => u.trim()).filter(Boolean), ...MAIN_RPCS.slice(1)])];
const OWN_RPC = "https://arkhampad.com/api/ely-rpc";
// our doorway second: it asks every node and answers with the newest head, so a stuck node can't hide new blocks
export const ELY_RPC_LIST = [ELY_RPCS[0], OWN_RPC, ...ELY_RPCS.slice(1)];
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
    transport: fallback(ELY_RPC_LIST.map((u) => http(u, { batch: { wait: 10 }, retryCount: 1, timeout: 5000 })), { rank: false, retryCount: 1 }),
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

// The last HYPE balance we read, kept per address (memory + this browser), so every page can show it at
// once while a fresh read is on its way.
const balMem = new Map<string, bigint>();
export function cachedHype(addr?: string | null): bigint | undefined {
  if (!addr) return undefined;
  const k = addr.toLowerCase();
  if (balMem.has(k)) return balMem.get(k);
  try { const v = localStorage.getItem(`ap_bal_${k}`); if (v) { balMem.set(k, BigInt(v)); return BigInt(v); } } catch {}
  return undefined;
}
/**
 * One read from the node that is furthest along: every node gets [eth_blockNumber, call] in one request and
 * the answer of the highest block wins (a node far behind would show an old balance). Waits at most ~3 s.
 */
async function freshest(method: string, params: unknown[]): Promise<string> {
  const best = { block: -1, result: null as string | null };
  const ask = async (url: string) => {
    const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify([{ jsonrpc: "2.0", id: 1, method: "eth_blockNumber", params: [] }, { jsonrpc: "2.0", id: 2, method, params }]), signal: AbortSignal.timeout(3000) });
    const j = await r.json();
    if (!Array.isArray(j)) throw new Error("no batch");
    const bn = j.find((x: { id: number }) => x.id === 1)?.result;
    const res = j.find((x: { id: number }) => x.id === 2)?.result;
    if (typeof res !== "string") throw new Error("no answer");
    const b = typeof bn === "string" ? Number(BigInt(bn)) : 0;
    if (b > best.block) { best.block = b; best.result = res; }
  };
  await Promise.allSettled(ELY_RPC_LIST.map(ask));
  if (best.result == null) throw new Error("no node answered");
  return best.result;
}
/** HYPE balance on Elysium, from the most up-to-date node. */
export async function hypeBalance(addr: Address) {
  const v = await freshest("eth_getBalance", [addr, "latest"]).then((x) => BigInt(x)).catch(() => ely().getBalance({ address: addr }));
  const k = addr.toLowerCase();
  balMem.set(k, v);
  try { localStorage.setItem(`ap_bal_${k}`, v.toString()); } catch {}
  return v;
}
export async function tokenBalance(token: Address, addr: Address) {
  const data = encodeFunctionData({ abi: ERC20, functionName: "balanceOf", args: [addr] });
  return freshest("eth_call", [{ to: token, data }, "latest"]).then((x) => (x === "0x" ? 0n : BigInt(x))).catch(() => ely().readContract({ address: token, abi: ERC20, functionName: "balanceOf", args: [addr] }));
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
/** MetaMask keeps its own transaction counter; when a node was a block behind it can get stuck one behind. */
export const USER_NO = /user (rejected|denied|cancel)|rejected by (the )?user|denied by (the )?user|cancelled by (the )?user|request was cancel/i;
export const SLOW_HELP = "Sent, but the network is slow to confirm right now. Check your balance in a minute before trying again.";
export const NONCE_HELP = "Your wallet's transaction counter is out of date. In MetaMask: Settings → Advanced → Clear activity tab data, then refresh and try again. Your funds are not affected.";
const nice = (e: unknown) => {
  const m = String((e as Error)?.message ?? e);
  if (/nonce/i.test(m)) return NONCE_HELP;
  if (e instanceof SlowTx || /timed out|timeout/i.test(m)) return SLOW_HELP;
  // a node didn't answer: say which one and how, so it can be fixed
  const he = e as { name?: string; status?: number; url?: string; details?: string };
  if (/HTTP request failed|network is busy/i.test(m)) {
    // which node failed and how goes to the console only; visitors just see a plain message
    console.warn("elysium rpc", he.status, he.url, he.details, (e as { data?: unknown })?.data);
    return "The Elysium network is busy right now. Please try again in a moment.";
  }
  if (/insufficient funds/i.test(m)) return "Not enough HYPE for this trade and gas.";
  // only a person saying no counts as "Cancelled"; a node refusing the transaction shows its real reason
  if (USER_NO.test(m)) return "Cancelled.";
  if (/Slippage|TooLittle|minOut/i.test(m)) return "Price moved. Try again or raise slippage.";
  const short = String((e as { shortMessage?: string })?.shortMessage || m).split("\n")[0].slice(0, 120);
  return `Trade failed: ${short}`;
};
export type RawReceipt = { status: "success" | "reverted"; logs: { address: Address; data: Hex; topics: [Hex, ...Hex[]] }[] };
/**
 * Waits for a transaction by asking every node at once, every 700 ms; the first node that has it wins.
 * (The public Elysium nodes catch up with the chain at different speeds; one may lag another by a minute.)
 * Throws SlowTx after `ms` (the transaction may still go through later).
 */
export class SlowTx extends Error {}
export async function waitReceipt(hash: Hex, ms = 120_000): Promise<RawReceipt> {
  const end = Date.now() + ms;
  const ask = async (url: string) => {
    const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getTransactionReceipt", params: [hash] }), signal: AbortSignal.timeout(4000) });
    const j = await r.json();
    if (!j?.result) throw new Error("not yet");
    return j.result as { status: Hex; logs: RawReceipt["logs"] };
  };
  while (Date.now() < end) {
    try {
      const r = await Promise.any(ELY_RPC_LIST.map(ask));
      return { status: r.status === "0x1" ? "success" : "reverted", logs: r.logs ?? [] };
    } catch {}
    await new Promise((r) => setTimeout(r, 700));
  }
  throw new SlowTx(SLOW_HELP);
}
async function wait(hash: Hex) {
  const r = await waitReceipt(hash);
  if (r.status !== "success") throw new TradeFail("Trade failed on chain. Nothing was spent except gas.");
  return hash;
}

/**
 * A sent trade. `hash` is known as soon as the network accepted it (a second or two); `confirmed` settles
 * when a public node has it in a block, which on Elysium can take another 20-40 seconds. The page shows
 * the trade at once and reports a failure later if the chain rejects it.
 */
export type SentTrade = { hash: Hex; confirmed: Promise<void> };
const track = (hash: Hex, token: string): SentTrade => {
  const confirmed = wait(hash).then(() => { rememberToken(token); balanceChanged(); }, (e) => { throw e instanceof TradeFail || e instanceof SlowTx ? e : new TradeFail(nice(e)); });
  confirmed.catch(() => {});
  return { hash, confirmed };
};

export async function buy(signer: Signer, t: EToken, hypeIn: bigint, minOut: bigint): Promise<SentTrade> {
  const p = poolArg(t);
  if (!ROUTER || !p || !signer.sendTx) throw new TradeFail("Trading for this token opens soon.");
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);
  try {
    const data = encodeFunctionData({ abi: ROUTER_ABI, functionName: "buy", args: [p, minOut, deadline] });
    let gas: bigint | undefined;
    try { gas = ((await ely().estimateGas({ account: signer.address, to: ROUTER, data, value: hypeIn })) * 13n) / 10n; } catch { gas = 600_000n; }
    const hash = await signer.sendTx(ELY_CHAIN, { to: ROUTER, data, value: hypeIn, gas });
    rememberToken(t.address);
    return track(hash, t.address);
  } catch (e) {
    throw e instanceof TradeFail ? e : new TradeFail(nice(e));
  }
}

export async function sell(signer: Signer, t: EToken, amountIn: bigint, minOut: bigint, onStep?: (s: string) => void): Promise<SentTrade> {
  const p = poolArg(t);
  if (!ROUTER || !p || !signer.sendTx) throw new TradeFail("Trading for this token opens soon.");
  try {
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);
    const data = encodeFunctionData({ abi: ROUTER_ABI, functionName: "sell", args: [p, amountIn, minOut, deadline] });
    const allowed = await ely().readContract({ address: p.token, abi: ERC20, functionName: "allowance", args: [signer.address, ROUTER] });
    const approveData = encodeFunctionData({ abi: ERC20, functionName: "approve", args: [ROUTER, MAX] });
    if (allowed < amountIn) {
      onStep?.("Approving…");
      if (signer.embedded && signer.nextNonce) {
        // built-in wallet: approval and sale go out back to back with consecutive nonces; the sequencer
        // runs them in order, so there's no waiting for the approval to show up on a node first
        const n = await signer.nextNonce();
        if (n != null) {
          await signer.sendTx(ELY_CHAIN, { to: p.token, data: approveData, gas: 80_000n, nonce: n });
          onStep?.("Selling…");
          const hash = await signer.sendTx(ELY_CHAIN, { to: ROUTER, data, gas: 600_000n, nonce: n + 1 });
          return track(hash, t.address);
        }
      }
      await wait(await signer.sendTx(ELY_CHAIN, { to: p.token, data: approveData, gas: 80_000n }));
      for (let i = 0; i < 25; i++) {
        const now = await ely().readContract({ address: p.token, abi: ERC20, functionName: "allowance", args: [signer.address, ROUTER] }).catch(() => 0n);
        if (now >= amountIn) break;
        await new Promise((r) => setTimeout(r, 300));
      }
    }
    onStep?.("Selling…");
    let gas: bigint;
    try { gas = ((await ely().estimateGas({ account: signer.address, to: ROUTER, data })) * 13n) / 10n; } catch { gas = 600_000n; }
    const hash = await signer.sendTx(ELY_CHAIN, { to: ROUTER, data, gas });
    return track(hash, t.address);
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
