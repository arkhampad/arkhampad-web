"use client";
// Trading coins listed on other DEXs (mainnet only): live quotes from the KyberSwap aggregator,
// gasless execution through PadExtSwap (the user signs; ArkhamPad takes 1%).
import { createPublicClient, http, parseAbi, type Address, type Hex } from "viem";
import { TradeError, type Signer } from "./chain";

type ExtNet = { id: number; slug: string; usdc: Address; usdcDecimals: number; rpc: string; swap: Address | null; permitUsdc: boolean };
const env = (k: string) => (process.env as Record<string, string | undefined>)[k] || "";
export const EXT_NETS: ExtNet[] = [
  { id: 8453, slug: "base", usdc: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", usdcDecimals: 6, rpc: "https://mainnet.base.org", swap: (env("NEXT_PUBLIC_EXT_SWAP_8453") || null) as Address | null, permitUsdc: true },
  { id: 56, slug: "bsc", usdc: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d", usdcDecimals: 18, rpc: "https://bsc-dataseed.bnbchain.org", swap: (env("NEXT_PUBLIC_EXT_SWAP_56") || null) as Address | null, permitUsdc: false },
];
export const extNet = (chainId: number) => EXT_NETS.find((n) => n.id === chainId) ?? null;
/** Can this coin be traded here right now? (needs PadExtSwap on its network = mainnet) */
export const extTradable = (chainId: number) => !!extNet(chainId)?.swap;

const API = "https://aggregator-api.kyberswap.com";
const HEAD = { "x-client-id": "arkhampad" };
export const FEE_BPS = 100n;

type Route = { amountOut: bigint; summary: unknown; router: Address };
async function route(n: ExtNet, tokenIn: Address, tokenOut: Address, amountIn: bigint): Promise<Route> {
  const r = await fetch(`${API}/${n.slug}/api/v1/routes?tokenIn=${tokenIn}&tokenOut=${tokenOut}&amountIn=${amountIn}&gasInclude=true`, { headers: HEAD }).catch(() => null);
  const j = r ? await r.json().catch(() => null) : null;
  const d = j?.data;
  if (!r?.ok || !d?.routeSummary) throw new TradeError("No price for this coin right now.");
  return { amountOut: BigInt(d.routeSummary.amountOut), summary: d.routeSummary, router: d.routerAddress as Address };
}

/** What the user gets: buy = coins for `usd` dollars (after 1%), sell = USDC for `coins` (after 1%). */
export async function extQuote(chainId: number, coin: Address, side: "buy" | "sell", amount: bigint) {
  const n = extNet(chainId);
  if (!n) throw new TradeError("Quotes aren't available for this network yet.");
  if (side === "buy") {
    const spend = amount - (amount * FEE_BPS) / 10_000n;
    return (await route(n, n.usdc, coin, spend)).amountOut;
  }
  const out = (await route(n, coin, n.usdc, amount)).amountOut;
  return out - (out * FEE_BPS) / 10_000n;
}

const ERC = parseAbi(["function balanceOf(address) view returns (uint256)", "function allowance(address,address) view returns (uint256)", "function nonces(address) view returns (uint256)", "function name() view returns (string)", "function decimals() view returns (uint8)"]);
const pub = (n: ExtNet) => createPublicClient({ transport: http(n.rpc) });
export async function extBalance(chainId: number, token: Address, who: Address) {
  const n = extNet(chainId);
  if (!n) return 0n;
  return pub(n).readContract({ address: token, abi: ERC, functionName: "balanceOf", args: [who] }).catch(() => 0n);
}

const RELAYER = env("NEXT_PUBLIC_RELAYER_URL") || "https://arkhampad-web-production.up.railway.app";
async function relay(body: Record<string, unknown>) {
  const r = await fetch(`${RELAYER}/relay`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
  const j = r ? await r.json().catch(() => ({})) : {};
  if (!r || !r.ok) throw new TradeError(j.error || "Something went wrong. Please try again.");
  return j;
}

/** One-time EIP-2612 approval for PadExtSwap, signed (no gas). */
async function ensurePermit(n: ExtNet, s: Signer, token: Address, need: bigint) {
  const c = pub(n);
  if ((await c.readContract({ address: token, abi: ERC, functionName: "allowance", args: [s.address, n.swap!] })) >= need) return;
  let nonce: bigint, name: string;
  try { [nonce, name] = await Promise.all([c.readContract({ address: token, abi: ERC, functionName: "nonces", args: [s.address] }), c.readContract({ address: token, abi: ERC, functionName: "name" })]); }
  catch { throw new TradeError("This coin needs a one-time approval that isn't supported yet."); }
  const MAX = 2n ** 256n - 1n, deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
  const signature = await s.signTypedData(n.id, { domain: { name, version: token.toLowerCase() === n.usdc.toLowerCase() ? "2" : "1", chainId: n.id, verifyingContract: token }, types: { Permit: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }, { name: "value", type: "uint256" }, { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint256" }] }, primaryType: "Permit", message: { owner: s.address, spender: n.swap!, value: MAX, nonce, deadline } });
  await relay({ chainId: n.id, kind: "permitExt", token, owner: s.address, value: MAX.toString(), deadline: deadline.toString(), signature });
}

const NET_FEE = 10_000n; // $0.01 in 6-decimal USDC
const TYPES = { ExtSwap: [["user", "address"], ["isBuy", "bool"], ["coin", "address"], ["amountIn", "uint256"], ["minOut", "uint256"], ["target", "address"], ["dataHash", "bytes32"], ["fee", "uint256"], ["nonce", "uint256"], ["deadline", "uint256"]].map(([name, type]) => ({ name, type })) };

/** Buys or sells a coin from another DEX. Never fills worse than the quote minus 2%. */
export async function extTrade(chainId: number, coin: Address, side: "buy" | "sell", amount: bigint, s: Signer) {
  const n = extNet(chainId);
  if (!n || !n.swap) throw new TradeError("Trading coins from other DEXs opens on mainnet.");
  if (n.usdcDecimals !== 6) throw new TradeError("This network isn't supported yet.");
  const isBuy = side === "buy";
  const spend = isBuy ? amount - (amount * FEE_BPS) / 10_000n : amount;
  const r = await route(n, isBuy ? n.usdc : coin, isBuy ? coin : n.usdc, spend);
  const build = await fetch(`${API}/${n.slug}/api/v1/route/build`, { method: "POST", headers: { ...HEAD, "content-type": "application/json" }, body: JSON.stringify({ routeSummary: r.summary, sender: n.swap, recipient: n.swap, slippageTolerance: 150, deadline: Math.floor(Date.now() / 1000) + 600 }) }).catch(() => null);
  const b = build ? await build.json().catch(() => null) : null;
  if (!build?.ok || !b?.data?.data) throw new TradeError("Couldn't prepare the trade. Please try again.");
  const data = b.data.data as Hex;
  const target = b.data.routerAddress as Address;
  const quoted = isBuy ? r.amountOut : r.amountOut - (r.amountOut * FEE_BPS) / 10_000n - NET_FEE;
  const minOut = (quoted * 98n) / 100n;
  await ensurePermit(n, s, isBuy ? n.usdc : coin, isBuy ? amount + NET_FEE : amount);
  const { keccak256 } = await import("viem");
  const nonce = BigInt(Date.now()) * 1000n + BigInt(Math.floor(Math.random() * 1000));
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);
  const msg = { user: s.address, isBuy, coin, amountIn: amount, minOut, target, dataHash: keccak256(data), fee: NET_FEE, nonce, deadline };
  const signature = await s.signTypedData(n.id, { domain: { name: "ArkhamPad Swap", version: "1", chainId: n.id, verifyingContract: n.swap }, types: TYPES, primaryType: "ExtSwap", message: msg });
  const S = (v: bigint) => v.toString();
  return relay({ chainId: n.id, kind: "extSwap", swap: { user: s.address, isBuy, coin, amountIn: S(amount), minOut: S(minOut), target, data, fee: S(NET_FEE), nonce: S(nonce), deadline: S(deadline), signature } });
}
