"use client";
// Trading any Elysium token from the user's own wallet, through the ArkhamPad router
// (contracts-elysium/src/ArkhamRouter.sol). One router works for every launchpad: Uniswap v3 style
// pools (called directly) and v4 style pools (through their pool manager). Pay and receive HYPE.
import { createPublicClient, decodeErrorResult, encodeFunctionData, http, parseAbi, type Address, type Hex } from "viem";
import type { Signer } from "./chain";
import type { EToken } from "./ely";

export const ELY_CHAIN = 99901;
export const ELY_RPC = process.env.NEXT_PUBLIC_ELY_RPC || "https://rpc-live.boxa.club";
/** Set once the router is deployed (Cloudflare env NEXT_PUBLIC_ELY_ROUTER). */
export const ROUTER = (process.env.NEXT_PUBLIC_ELY_ROUTER || "") as Address | "";
export const ELY_EXPLORER = process.env.NEXT_PUBLIC_ELY_EXPLORER || "";

let client: ReturnType<typeof createPublicClient> | null = null;
export const ely = () =>
  (client ??= createPublicClient({
    chain: { id: ELY_CHAIN, name: "Elysium", nativeCurrency: { name: "HYPE", symbol: "HYPE", decimals: 18 }, rpcUrls: { default: { http: [ELY_RPC] } } },
    transport: http(ELY_RPC, { batch: true, retryCount: 2 }),
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
  return "Trade failed. Please try again.";
};
async function wait(hash: Hex) {
  const r = await ely().waitForTransactionReceipt({ hash, timeout: 60_000 });
  if (r.status !== "success") throw new TradeFail("Trade failed on chain. Nothing was spent except gas.");
  return hash;
}

export async function buy(signer: Signer, t: EToken, hypeIn: bigint, minOut: bigint): Promise<Hex> {
  const p = poolArg(t);
  if (!ROUTER || !p || !signer.sendTx) throw new TradeFail("Trading for this token opens soon.");
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);
  try {
    const data = encodeFunctionData({ abi: ROUTER_ABI, functionName: "buy", args: [p, minOut, deadline] });
    return await wait(await signer.sendTx(ELY_CHAIN, { to: ROUTER, data, value: hypeIn }));
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
      await wait(await signer.sendTx(ELY_CHAIN, { to: p.token, data: encodeFunctionData({ abi: ERC20, functionName: "approve", args: [ROUTER, MAX] }) }));
    }
    onStep?.("Selling…");
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);
    const data = encodeFunctionData({ abi: ROUTER_ABI, functionName: "sell", args: [p, amountIn, minOut, deadline] });
    return await wait(await signer.sendTx(ELY_CHAIN, { to: ROUTER, data }));
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
