"use client";
// On-chain side of ArkhamPad: networks, contract calls, signed (gasless) requests.
import { createPublicClient, defineChain, http, keccak256, parseAbi, parseEventLogs, type Address, type Hex, type PublicClient } from "viem";
import { baseSepolia } from "viem/chains";

export const RELAYER = process.env.NEXT_PUBLIC_RELAYER_URL || "https://arkhampad-web-production.up.railway.app";

export const robinhoodTestnet = defineChain({
  id: 46630,
  name: "Robinhood Chain Testnet",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.testnet.chain.robinhood.com"] } },
  testnet: true,
});

export type Net = { id: number; name: string; short: string; rpc: string; hub: Address; router: Address; usdc: Address; faucet: boolean; faucetUrl?: string };

// Contract addresses come from contracts/deployments/<chainId>.json.
const DEFAULT_NETS: Net[] = [
  { id: 84532, name: "Base Sepolia", short: "Base", rpc: "https://sepolia.base.org", hub: "0x27e9ba5b6C405c01b1D1714Fd72e99Be1ED0D125", router: "0xB5d157e046fa4363330B38E767b82eeB8b8460c1", usdc: "0x036CbD53842c5426634e7929541eC2318f3dCF7e", faucet: false, faucetUrl: "https://faucet.circle.com" },
  { id: 46630, name: "Robinhood Testnet", short: "Robinhood", rpc: "https://rpc.testnet.chain.robinhood.com", hub: "0x742f9EF29655202138CA48b8Ad3645653E95276F", router: "0x1Cf054C53A5e263881aC4b4DD235576dD36a7F42", usdc: "0x47AfD49069EAbEcfb153926f1f652249fFb61b57", faucet: true },
];
// Local test builds can point everything at a local chain.
export const NETS: Net[] = process.env.NEXT_PUBLIC_NETS ? JSON.parse(process.env.NEXT_PUBLIC_NETS) : DEFAULT_NETS;
export const netOf = (id: number) => NETS.find((n) => n.id === id) ?? null;
export const viemChain = (id: number) => (id === 84532 ? baseSepolia : id === 46630 ? robinhoodTestnet : defineChain({ id, name: `chain ${id}`, nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [netOf(id)?.rpc ?? ""] } } }));

const clients = new Map<number, PublicClient>();
export function client(id: number): PublicClient {
  let c = clients.get(id);
  if (!c) {
    const n = netOf(id);
    if (!n) throw new Error("Unknown network");
    c = createPublicClient({ chain: viemChain(id), transport: http(n.rpc, { retryCount: 2, timeout: 15_000 }), pollingInterval: 250 }) as PublicClient;
    clients.set(id, c);
  }
  return c;
}

export const ERC20 = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address,address) view returns (uint256)",
  "function nonces(address) view returns (uint256)",
  "function name() view returns (string)",
  "function version() view returns (string)",
  "function symbol() view returns (string)",
]);
export const CURVE = parseAbi([
  "function quoteBuy(uint256) view returns (uint256)",
  "function quoteSell(uint256) view returns (uint256)",
  "function phase() view returns (uint8)",
  "function coin() view returns (address)",
  "function creator() view returns (address)",
  "function marketCap() view returns (uint256)",
  "function usdcReserve() view returns (uint256)",
  "function vUsdc() view returns (uint256)",
  "function vCoin() view returns (uint256)",
  "function creatorFees() view returns (uint256)",
  "function feeMode() view returns (uint8)",
  "event Trade(address indexed trader, bool indexed isBuy, uint256 usdcAmount, uint256 coinAmount, uint256 fee, uint256 vUsdcAfter, uint256 vCoinAfter)",
]);
export const HUB = parseAbi([
  "function curveOf(address) view returns (address)",
  "event CoinCreated(address indexed coin, address indexed curve, address indexed creator, string name, string symbol, string metadataURI, uint256 lockSeconds, uint8 feeMode)",
]);
export const PROMOTE = parseAbi(["function plans(uint8) view returns (uint64 seconds_, uint128 price, bool active)", "function promoter() view returns (address)"]);
const ROUTER_VIEW = parseAbi(["function promoter() view returns (address)", "function quotePool(address coin, bool isBuy, uint256 amountIn) returns (uint256)"]);
const POOL_EVENT = parseAbi(["event PoolTraded(address indexed user, address indexed coin, bool isBuy, uint256 usdcAmount, uint256 coinAmount, uint256 fee, uint256 nonce)"]);

export const FEE = 10_000n; // network fee the relayer gets back, in USDC (6 decimals): $0.01 on testnets
export const MAX = 2n ** 256n - 1n;
export const toUsdc = (n: number) => BigInt(Math.round(n * 1e6));
export const fromUsdc = (v: bigint) => Number(v) / 1e6;
export const fromCoin = (v: bigint) => Number(v) / 1e18;

export type Signer = { address: Address; signTypedData: (chainId: number, typed: TypedData) => Promise<Hex> };
export type TypedData = { domain: Record<string, unknown>; types: Record<string, { name: string; type: string }[]>; primaryType: string; message: Record<string, unknown> };

const F = (pairs: [string, string][]) => pairs.map(([name, type]) => ({ name, type }));
const TYPES = {
  Buy: F([["user", "address"], ["curve", "address"], ["usdcIn", "uint256"], ["minCoinsOut", "uint256"], ["fee", "uint256"], ["nonce", "uint256"], ["deadline", "uint256"]]),
  Sell: F([["user", "address"], ["curve", "address"], ["coinAmount", "uint256"], ["minUsdcOut", "uint256"], ["fee", "uint256"], ["nonce", "uint256"], ["deadline", "uint256"]]),
  Create: F([["user", "address"], ["name", "string"], ["symbol", "string"], ["metadataURI", "string"], ["lockSeconds", "uint256"], ["feeMode", "uint8"], ["launchUsdc", "uint256"], ["minCoinsOut", "uint256"], ["fee", "uint256"], ["nonce", "uint256"], ["deadline", "uint256"]]),
  Withdraw: F([["user", "address"], ["to", "address"], ["amount", "uint256"], ["fee", "uint256"], ["nonce", "uint256"], ["deadline", "uint256"]]),
  PoolBuy: F([["user", "address"], ["coin", "address"], ["usdcIn", "uint256"], ["minCoinsOut", "uint256"], ["fee", "uint256"], ["nonce", "uint256"], ["deadline", "uint256"]]),
  PoolSell: F([["user", "address"], ["coin", "address"], ["coinAmount", "uint256"], ["minUsdcOut", "uint256"], ["fee", "uint256"], ["nonce", "uint256"], ["deadline", "uint256"]]),
  Promote: F([["user", "address"], ["coin", "address"], ["coinChainId", "uint256"], ["plan", "uint8"], ["maxPrice", "uint256"], ["fee", "uint256"], ["nonce", "uint256"], ["deadline", "uint256"]]),
  Permit: F([["owner", "address"], ["spender", "address"], ["value", "uint256"], ["nonce", "uint256"], ["deadline", "uint256"]]),
};

const routerDomain = (n: Net) => ({ name: "ArkhamPad", version: "1", chainId: n.id, verifyingContract: n.router });
const deadline = () => BigInt(Math.floor(Date.now() / 1000) + 600);
function randomNonce(): bigint {
  const a = new Uint32Array(2);
  crypto.getRandomValues(a);
  return (BigInt(a[0]) << 32n) | BigInt(a[1]);
}
const S = (v: bigint | number) => v.toString();

// ---------------------------------------------------------------- relayer
export class TradeError extends Error {}

type Relayed = { hash: Hex; status?: string; logs?: { address: Address; data: Hex; topics: Hex[] }[] };

async function relay(body: Record<string, unknown>): Promise<Relayed> {
  let r: Response;
  try {
    r = await fetch(`${RELAYER}/relay`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  } catch {
    throw new TradeError("Can't reach ArkhamPad right now. Check your connection.");
  }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new TradeError(j.error || "Something went wrong. Please try again.");
  return j as Relayed;
}

/** The relayer waits for the block and returns the receipt logs, so no extra round trips here. */
async function confirm(n: Net, res: Relayed): Promise<{ logs: Relayed["logs"]; transactionHash: Hex }> {
  if (res.logs && res.status) {
    if (res.status !== "success") throw new TradeError("The transaction failed on-chain. Your funds are safe.");
    return { logs: res.logs, transactionHash: res.hash };
  }
  const rc = await client(n.id).waitForTransactionReceipt({ hash: res.hash, pollingInterval: 250, timeout: 60_000 });
  if (rc.status !== "success") throw new TradeError("The transaction failed on-chain. Your funds are safe.");
  return { logs: rc.logs as never, transactionHash: rc.transactionHash };
}

/** One-time approval by signature (no gas): lets the router move this token when the user signs a trade. */
const permitted = new Set<string>();
async function ensureAllowance(n: Net, s: Signer, token: Address, need: bigint) {
  const key = `${n.id}:${token}:${s.address}`.toLowerCase();
  if (permitted.has(key)) return;
  const c = client(n.id);
  const allowance = await c.readContract({ address: token, abi: ERC20, functionName: "allowance", args: [s.address, n.router] });
  if (allowance >= need) { permitted.add(key); return; }
  const [name, nonce, version] = await Promise.all([
    c.readContract({ address: token, abi: ERC20, functionName: "name" }),
    c.readContract({ address: token, abi: ERC20, functionName: "nonces", args: [s.address] }),
    c.readContract({ address: token, abi: ERC20, functionName: "version" }).catch(() => "1"),
  ]);
  const dl = deadline();
  const signature = await s.signTypedData(n.id, { domain: { name, version, chainId: n.id, verifyingContract: token }, types: { Permit: TYPES.Permit }, primaryType: "Permit", message: { owner: s.address, spender: n.router, value: MAX, nonce, deadline: dl } });
  await confirm(n, await relay({ chainId: n.id, kind: "permit", token, owner: s.address, value: S(MAX), deadline: S(dl), signature }));
  const after = await c.readContract({ address: token, abi: ERC20, functionName: "allowance", args: [s.address, n.router] });
  if (after < need) throw new TradeError("Approval didn't go through. Please try again.");
  permitted.add(key);
}

/** Signs the coin's one-time sell approval right after a buy, in the background. */
function prepareSell(n: Net, s: Signer, coin: Address) {
  setTimeout(() => { ensureAllowance(n, s, coin, 1n).catch(() => {}); }, 300);
}

// ---------------------------------------------------------------- reads
export async function usdcBalance(chainId: number, who: Address) {
  const n = netOf(chainId);
  if (!n) return 0n;
  return client(chainId).readContract({ address: n.usdc, abi: ERC20, functionName: "balanceOf", args: [who] });
}
export async function tokenBalance(chainId: number, token: Address, who: Address) {
  return client(chainId).readContract({ address: token, abi: ERC20, functionName: "balanceOf", args: [who] });
}
export async function quoteBuy(chainId: number, curve: Address, usdcIn: bigint) {
  return client(chainId).readContract({ address: curve, abi: CURVE, functionName: "quoteBuy", args: [usdcIn] });
}
export async function quoteSell(chainId: number, curve: Address, coins: bigint) {
  return client(chainId).readContract({ address: curve, abi: CURVE, functionName: "quoteSell", args: [coins] });
}

export type LocalTrade = { chainId: number; coin: Address; curve: Address; trader: Address; isBuy: boolean; usdc: number; coins: number; price: number; mc: number; hash: Hex; at: number };

function tradeFrom(n: Net, rc: { logs: { address: Address; data: Hex; topics: [Hex, ...Hex[]] | [] }[]; transactionHash: Hex }, curve: Address, coin: Address, user: Address): LocalTrade | null {
  const ev = parseEventLogs({ abi: CURVE, logs: rc.logs as never, eventName: "Trade" }).find((e) => e.address.toLowerCase() === curve.toLowerCase());
  if (!ev) return null;
  const a = ev.args as { isBuy: boolean; usdcAmount: bigint; coinAmount: bigint; vUsdcAfter: bigint; vCoinAfter: bigint };
  const price = fromUsdc(a.vUsdcAfter) / fromCoin(a.vCoinAfter);
  return { chainId: n.id, coin, curve, trader: user, isBuy: a.isBuy, usdc: fromUsdc(a.usdcAmount), coins: fromCoin(a.coinAmount), price, mc: price * 1e9, hash: rc.transactionHash, at: Date.now() };
}

// Trades made in this tab, so pages update instantly (before the indexer catches up).
type Listener = (t: LocalTrade) => void;
const listeners = new Set<Listener>();
export function onLocalTrade(fn: Listener) { listeners.add(fn); return () => { listeners.delete(fn); }; }
const emit = (t: LocalTrade | null) => { if (t) listeners.forEach((f) => f(t)); };

// ---------------------------------------------------------------- actions
const SLIPPAGE_BPS = 300n; // 3%

export async function buy(chainId: number, curve: Address, coin: Address, usdcIn: bigint, s: Signer) {
  const n = netOf(chainId);
  if (!n) throw new TradeError("Unknown network");
  if (usdcIn <= 0n) throw new TradeError("Enter an amount.");
  const [bal, quote] = await Promise.all([usdcBalance(chainId, s.address), quoteBuy(chainId, curve, usdcIn), ensureAllowance(n, s, n.usdc, usdcIn + FEE)]);
  if (bal < usdcIn + FEE) throw new TradeError("Not enough USDC on this network.");
  if (quote === 0n) throw new TradeError("Amount is too small.");
  const minOut = (quote * (10_000n - SLIPPAGE_BPS)) / 10_000n;
  const nonce = randomNonce(), dl = deadline();
  const signature = await s.signTypedData(n.id, { domain: routerDomain(n), types: { Buy: TYPES.Buy }, primaryType: "Buy", message: { user: s.address, curve, usdcIn, minCoinsOut: minOut, fee: FEE, nonce, deadline: dl } });
  const rc = await confirm(n, await relay({ chainId: n.id, kind: "buy", user: s.address, curve, usdcIn: S(usdcIn), minCoinsOut: S(minOut), fee: S(FEE), nonce: S(nonce), deadline: S(dl), signature }));
  const t = tradeFrom(n, rc as never, curve, coin, s.address);
  emit(t);
  prepareSell(n, s, coin);
  return t;
}

export async function sell(chainId: number, curve: Address, coin: Address, coinAmount: bigint, s: Signer) {
  const n = netOf(chainId);
  if (!n) throw new TradeError("Unknown network");
  if (coinAmount <= 0n) throw new TradeError("Enter an amount.");
  const [held, quote] = await Promise.all([tokenBalance(chainId, coin, s.address), quoteSell(chainId, curve, coinAmount), ensureAllowance(n, s, coin, coinAmount)]);
  if (held < coinAmount) throw new TradeError("You don't hold that many.");
  if (quote <= FEE) throw new TradeError("This sale is too small to cover the network fee.");
  const net = quote - FEE;
  const minOut = (net * (10_000n - SLIPPAGE_BPS)) / 10_000n;
  const nonce = randomNonce(), dl = deadline();
  const signature = await s.signTypedData(n.id, { domain: routerDomain(n), types: { Sell: TYPES.Sell }, primaryType: "Sell", message: { user: s.address, curve, coinAmount, minUsdcOut: minOut, fee: FEE, nonce, deadline: dl } });
  const rc = await confirm(n, await relay({ chainId: n.id, kind: "sell", user: s.address, curve, coinAmount: S(coinAmount), minUsdcOut: S(minOut), fee: S(FEE), nonce: S(nonce), deadline: S(dl), signature }));
  const t = tradeFrom(n, rc as never, curve, coin, s.address);
  emit(t);
  return t;
}

/** Graduated coins: what a pool trade gives right now (simulated on-chain, exact). */
export async function quotePool(chainId: number, coin: Address, isBuy: boolean, amountIn: bigint) {
  const n = netOf(chainId);
  if (!n) return 0n;
  const { result } = await client(chainId).simulateContract({ address: n.router, abi: ROUTER_VIEW, functionName: "quotePool", args: [coin, isBuy, amountIn] });
  return result as bigint;
}

function poolTradeFrom(n: Net, rc: { logs: unknown[]; transactionHash: Hex }, coin: Address, user: Address): LocalTrade | null {
  const ev = parseEventLogs({ abi: POOL_EVENT, logs: rc.logs as never, eventName: "PoolTraded" })[0];
  if (!ev) return null;
  const a = ev.args as { isBuy: boolean; usdcAmount: bigint; coinAmount: bigint };
  const usdcN = fromUsdc(a.usdcAmount), coinsN = fromCoin(a.coinAmount);
  const price = coinsN > 0 ? usdcN / coinsN : 0; // average fill price of this trade
  return { chainId: n.id, coin, curve: coin, trader: user, isBuy: a.isBuy, usdc: usdcN, coins: coinsN, price, mc: price * 1e9, hash: rc.transactionHash, at: Date.now() };
}

export async function poolBuy(chainId: number, coin: Address, usdcIn: bigint, s: Signer) {
  const n = netOf(chainId);
  if (!n) throw new TradeError("Unknown network");
  if (usdcIn <= 0n) throw new TradeError("Enter an amount.");
  const [bal, quote] = await Promise.all([usdcBalance(chainId, s.address), quotePool(chainId, coin, true, usdcIn), ensureAllowance(n, s, n.usdc, usdcIn + FEE)]);
  if (bal < usdcIn + FEE) throw new TradeError("Not enough USDC on this network.");
  if (quote === 0n) throw new TradeError("Amount is too small.");
  const minOut = (quote * (10_000n - SLIPPAGE_BPS)) / 10_000n;
  const nonce = randomNonce(), dl = deadline();
  const signature = await s.signTypedData(n.id, { domain: routerDomain(n), types: { PoolBuy: TYPES.PoolBuy }, primaryType: "PoolBuy", message: { user: s.address, coin, usdcIn, minCoinsOut: minOut, fee: FEE, nonce, deadline: dl } });
  const rc = await confirm(n, await relay({ chainId: n.id, kind: "poolBuy", user: s.address, coin, usdcIn: S(usdcIn), minCoinsOut: S(minOut), fee: S(FEE), nonce: S(nonce), deadline: S(dl), signature }));
  const t = poolTradeFrom(n, rc as never, coin, s.address);
  emit(t);
  prepareSell(n, s, coin);
  return t;
}

export async function poolSell(chainId: number, coin: Address, coinAmount: bigint, s: Signer) {
  const n = netOf(chainId);
  if (!n) throw new TradeError("Unknown network");
  if (coinAmount <= 0n) throw new TradeError("Enter an amount.");
  const [held, quote] = await Promise.all([tokenBalance(chainId, coin, s.address), quotePool(chainId, coin, false, coinAmount), ensureAllowance(n, s, coin, coinAmount)]);
  if (held < coinAmount) throw new TradeError("You don't hold that many.");
  if (quote <= FEE) throw new TradeError("This sale is too small to cover the network fee.");
  const minOut = ((quote - FEE) * (10_000n - SLIPPAGE_BPS)) / 10_000n;
  const nonce = randomNonce(), dl = deadline();
  const signature = await s.signTypedData(n.id, { domain: routerDomain(n), types: { PoolSell: TYPES.PoolSell }, primaryType: "PoolSell", message: { user: s.address, coin, coinAmount, minUsdcOut: minOut, fee: FEE, nonce, deadline: dl } });
  const rc = await confirm(n, await relay({ chainId: n.id, kind: "poolSell", user: s.address, coin, coinAmount: S(coinAmount), minUsdcOut: S(minOut), fee: S(FEE), nonce: S(nonce), deadline: S(dl), signature }));
  const t = poolTradeFrom(n, rc as never, coin, s.address);
  emit(t);
  return t;
}

export type LaunchInput = { name: string; symbol: string; metadataURI: string; lockSeconds: number; feeMode: 0 | 1; launchUsdc: bigint };
export async function launch(chainId: number, l: LaunchInput, s: Signer): Promise<{ coin: Address; curve: Address }> {
  const n = netOf(chainId);
  if (!n) throw new TradeError("Unknown network");
  const need = l.launchUsdc + FEE;
  const bal = await usdcBalance(chainId, s.address);
  if (bal < need) throw new TradeError(`You need at least $${fromUsdc(need).toFixed(2)} USDC on ${n.short} to launch.`);
  await ensureAllowance(n, s, n.usdc, need);
  const nonce = randomNonce(), dl = deadline();
  const message = { user: s.address, name: l.name, symbol: l.symbol, metadataURI: l.metadataURI, lockSeconds: BigInt(l.lockSeconds), feeMode: l.feeMode, launchUsdc: l.launchUsdc, minCoinsOut: 0n, fee: FEE, nonce, deadline: dl };
  const signature = await s.signTypedData(n.id, { domain: routerDomain(n), types: { Create: TYPES.Create }, primaryType: "Create", message });
  const rc = await confirm(n, await relay({ chainId: n.id, kind: "launch", user: s.address, launch: { name: l.name, symbol: l.symbol, metadataURI: l.metadataURI, lockSeconds: String(l.lockSeconds), feeMode: l.feeMode, launchUsdc: S(l.launchUsdc), minCoinsOut: "0" }, fee: S(FEE), nonce: S(nonce), deadline: S(dl), signature }));
  const ev = parseEventLogs({ abi: HUB, logs: rc.logs as never, eventName: "CoinCreated" })[0];
  if (!ev) throw new TradeError("Launch went through but the coin wasn't found. Check your profile.");
  const a = ev.args as { coin: Address; curve: Address };
  if (l.launchUsdc > 0n) emit(tradeFrom(n, rc as never, a.curve, a.coin, s.address));
  return { coin: a.coin, curve: a.curve };
}

export async function withdraw(chainId: number, to: Address, amount: bigint, s: Signer) {
  const n = netOf(chainId);
  if (!n) throw new TradeError("Unknown network");
  if (amount <= 0n) throw new TradeError("Enter an amount.");
  const bal = await usdcBalance(chainId, s.address);
  if (bal < amount + FEE) throw new TradeError("Not enough USDC (keep $0.01 for the network fee).");
  await ensureAllowance(n, s, n.usdc, amount + FEE);
  const nonce = randomNonce(), dl = deadline();
  const signature = await s.signTypedData(n.id, { domain: routerDomain(n), types: { Withdraw: TYPES.Withdraw }, primaryType: "Withdraw", message: { user: s.address, to, amount, fee: FEE, nonce, deadline: dl } });
  return confirm(n, await relay({ chainId: n.id, kind: "withdraw", user: s.address, to, amount: S(amount), fee: S(FEE), nonce: S(nonce), deadline: S(dl), signature }));
}

export async function promote(chainId: number, coin: Address, plan: 1 | 2 | 3, s: Signer, coinChainId: number = chainId) {
  const n = netOf(chainId);
  if (!n) throw new TradeError("Unknown network");
  const promoter = await client(chainId).readContract({ address: n.router, abi: ROUTER_VIEW, functionName: "promoter" });
  const [, price, active] = await client(chainId).readContract({ address: promoter, abi: PROMOTE, functionName: "plans", args: [plan] });
  if (!active) throw new TradeError("This promotion isn't available right now.");
  const bal = await usdcBalance(chainId, s.address);
  if (bal < price + FEE) throw new TradeError("Not enough USDC to promote.");
  await ensureAllowance(n, s, n.usdc, price + FEE);
  const nonce = randomNonce(), dl = deadline();
  const signature = await s.signTypedData(n.id, { domain: routerDomain(n), types: { Promote: TYPES.Promote }, primaryType: "Promote", message: { user: s.address, coin, coinChainId: BigInt(coinChainId), plan, maxPrice: price, fee: FEE, nonce, deadline: dl } });
  return confirm(n, await relay({ chainId: n.id, kind: "promote", user: s.address, coin, coinChainId: String(coinChainId), plan: String(plan), maxPrice: S(price), fee: S(FEE), nonce: S(nonce), deadline: S(dl), signature }));
}

export async function faucet(chainId: number, to: Address) {
  const n = netOf(chainId);
  if (!n?.faucet) throw new TradeError("No test USDC faucet on this network.");
  return confirm(n, await relay({ chainId, kind: "faucet", to }));
}

/** A coin we launched seconds ago may not be in the database yet: read it from the chain. */
export async function coinFromChain(chainId: number, coin: Address) {
  const n = netOf(chainId);
  if (!n) return null;
  const c = client(chainId);
  const curve = await c.readContract({ address: n.hub, abi: HUB, functionName: "curveOf", args: [coin] });
  if (!curve || /^0x0+$/.test(curve)) return null;
  const [name, symbol, creator, vUsdc, vCoin, reserve, phase] = await Promise.all([
    c.readContract({ address: coin, abi: ERC20, functionName: "name" }),
    c.readContract({ address: coin, abi: ERC20, functionName: "symbol" }),
    c.readContract({ address: curve, abi: CURVE, functionName: "creator" }),
    c.readContract({ address: curve, abi: CURVE, functionName: "vUsdc" }),
    c.readContract({ address: curve, abi: CURVE, functionName: "vCoin" }),
    c.readContract({ address: curve, abi: CURVE, functionName: "usdcReserve" }),
    c.readContract({ address: curve, abi: CURVE, functionName: "phase" }),
  ]);
  const price = fromUsdc(vUsdc) / fromCoin(vCoin);
  return { chain_id: chainId, address: coin.toLowerCase(), curve: curve.toLowerCase(), creator: creator.toLowerCase(), name, symbol, phase: Number(phase), price_usd: price, mc_usd: price * 1e9, start_mc_usd: chainId === 84532 || chainId === 46630 ? 450 : 4500, usdc_reserve: fromUsdc(reserve), trades_count: 0, created_at: new Date().toISOString(), volume_24h: 0, change_24h_pct: null, buyers: 0, metadata_uri: "" };
}


// ---------------------------------------------------------------- creator tools & upkeep

export async function creatorFeesOf(chainId: number, curve: Address) {
  const c = client(chainId);
  const [fees, mode] = await Promise.all([
    c.readContract({ address: curve, abi: CURVE, functionName: "creatorFees" }),
    c.readContract({ address: curve, abi: CURVE, functionName: "feeMode" }),
  ]);
  return { fees, mode: Number(mode) };
}

/** Pays the creator (or buys back and burns) the fees a curve holds. Anyone can trigger it. */
export async function settleFees(chainId: number, curve: Address) {
  const n = netOf(chainId);
  if (!n) throw new TradeError("Unknown network");
  return confirm(n, await relay({ chainId, kind: "settle", curve }));
}
/** Graduated coins: collect the locked pool's trading fees (70% platform, 30% creator or buyback). */
export async function collectPoolFees(chainId: number, coin: Address) {
  const n = netOf(chainId);
  if (!n) throw new TradeError("Unknown network");
  return confirm(n, await relay({ chainId, kind: "collect", coin }));
}
export async function runBuyback(chainId: number, coin: Address) {
  const n = netOf(chainId);
  if (!n) throw new TradeError("Unknown network");
  return confirm(n, await relay({ chainId, kind: "buyback", coin }));
}

/** Resizes to a 256px square WebP, signs it as the creator and uploads it. Returns the image URL. */
export async function uploadCoinImage(chainId: number, coin: Address, file: File, s: Signer): Promise<string> {
  const n = netOf(chainId);
  if (!n) throw new TradeError("Unknown network");
  if (!/^image\/(png|jpe?g|webp|gif)$/.test(file.type)) throw new TradeError("Use a PNG, JPG or WebP image.");
  if (file.size > 10_000_000) throw new TradeError("Image is too large (max 10 MB).");
  const dataUrl = await squareImage(file, 256);
  const bytes = Uint8Array.from(atob(dataUrl.split(",")[1]), (ch) => ch.charCodeAt(0));
  const signature = await s.signTypedData(chainId, {
    domain: routerDomain(n),
    types: { CoinImage: [{ name: "coin", type: "address" }, { name: "imageHash", type: "bytes32" }] },
    primaryType: "CoinImage",
    message: { coin, imageHash: keccak256(bytes) },
  });
  let r: Response;
  try {
    r = await fetch(`${RELAYER}/image`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chainId, coin, dataUrl, signature }) });
  } catch { throw new TradeError("Can't reach ArkhamPad right now. Check your connection."); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new TradeError(j.error || "Upload failed, please try again.");
  return j.url as string;
}

function squareImage(file: File, size: number): Promise<string> {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const cv = document.createElement("canvas");
      cv.width = size; cv.height = size;
      const ctx = cv.getContext("2d");
      if (!ctx) { rej(new TradeError("Couldn't read the image.")); return; }
      const side = Math.min(img.width, img.height); // centre crop to a square
      ctx.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, size, size);
      URL.revokeObjectURL(url);
      let out = cv.toDataURL("image/webp", 0.86);
      if (!out.startsWith("data:image/webp")) out = cv.toDataURL("image/png");
      res(out);
    };
    img.onerror = () => { URL.revokeObjectURL(url); rej(new TradeError("Couldn't read the image.")); };
    img.src = url;
  });
}

/** Biggest holders, from everyone who ever bought plus the creator, read live from the chain. */
export async function holdersOf(chainId: number, coin: Address, wallets: string[]) {
  const c = client(chainId);
  const uniq = [...new Set(wallets.map((w) => w.toLowerCase()))].slice(0, 200);
  const rows: { wallet: string; amount: number }[] = [];
  for (let i = 0; i < uniq.length; i += 25) {
    const part = await Promise.all(uniq.slice(i, i + 25).map(async (w) => ({ wallet: w, amount: fromCoin(await c.readContract({ address: coin, abi: ERC20, functionName: "balanceOf", args: [w as Address] }).catch(() => 0n)) })));
    rows.push(...part.filter((r) => r.amount > 0));
  }
  return rows.sort((a, b) => b.amount - a.amount);
}

// ---------------------------------------------------------------- automatic orders

export type OrderKind = "limit_buy" | "take_profit" | "stop_loss";
export type Order = { id: string; chain_id: number; coin: string; kind: OrderKind; venue: "curve" | "pool"; trigger_mc: number; amount: string; nonce: string; status: string; note: string | null; tx_hash: string | null; created_at: string; deadline: string };

/**
 * Signs a trade now that the relayer sends later, when the market cap reaches `triggerMc`.
 * The signed minimum (how much the user gets at worst) is set from the trigger price, so the
 * order can never fill at a much worse price than the user chose.
 */
export async function placeOrder(p: { chainId: number; coin: Address; curve: Address | null; pool: boolean; kind: OrderKind; triggerMc: number; amount: bigint }, s: Signer) {
  const n = netOf(p.chainId);
  if (!n) throw new TradeError("Unknown network");
  if (p.amount <= 0n) throw new TradeError("Enter an amount.");
  if (!(p.triggerMc > 0)) throw new TradeError("Pick a market cap.");
  const isBuy = p.kind === "limit_buy";
  const price = p.triggerMc / 1e9; // USDC per coin at the trigger
  let min: bigint;
  if (isBuy) {
    // coins for usdcIn at the trigger price, after the 1% fee, with 3% room
    min = BigInt(Math.floor((fromUsdc(p.amount) * 0.99 / price) * 0.97 * 1e6)) * 10n ** 12n;
  } else {
    // stop loss gets more room (prices fall fast); take profit sells at or above the target
    const room = p.kind === "stop_loss" ? 0.8 : 0.96;
    const v = fromCoin(p.amount) * price * 0.99 * room - fromUsdc(FEE);
    min = BigInt(Math.max(1, Math.floor(v * 1e6)));
  }
  await ensureAllowance(n, s, isBuy ? n.usdc : p.coin, isBuy ? p.amount + FEE : p.amount);
  const nonce = randomNonce();
  const dl = BigInt(Math.floor(Date.now() / 1000) + 30 * 86400); // valid for 30 days
  const venue = p.pool ? "pool" : "curve";
  const reqKind = p.pool ? (isBuy ? "poolBuy" : "poolSell") : (isBuy ? "buy" : "sell");
  const types = { buy: TYPES.Buy, sell: TYPES.Sell, poolBuy: TYPES.PoolBuy, poolSell: TYPES.PoolSell }[reqKind];
  const primary = { buy: "Buy", sell: "Sell", poolBuy: "PoolBuy", poolSell: "PoolSell" }[reqKind];
  const target = p.pool ? { coin: p.coin } : { curve: p.curve as Address };
  const message = isBuy
    ? { user: s.address, ...target, usdcIn: p.amount, minCoinsOut: min, fee: FEE, nonce, deadline: dl }
    : { user: s.address, ...target, coinAmount: p.amount, minUsdcOut: min, fee: FEE, nonce, deadline: dl };
  const signature = await s.signTypedData(n.id, { domain: routerDomain(n), types: { [primary]: types }, primaryType: primary, message });
  const request = { kind: reqKind, ...Object.fromEntries(Object.entries(message).map(([k, v]) => [k, typeof v === "bigint" ? v.toString() : v])), signature };
  let r: Response;
  try { r = await fetch(`${RELAYER}/orders`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chainId: n.id, kind: p.kind, coin: p.coin, triggerMc: p.triggerMc, request }) }); }
  catch { throw new TradeError("Can't reach ArkhamPad right now. Check your connection."); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new TradeError(j.error || "Couldn't place the order.");
  void venue;
  return j.id as string;
}

export async function myOrders(user: Address): Promise<Order[]> {
  const r = await fetch(`${RELAYER}/orders?user=${user}`).catch(() => null);
  if (!r || !r.ok) return [];
  return r.json();
}

export async function cancelOrder(o: Order, s: Signer) {
  const n = netOf(o.chain_id);
  if (!n) throw new TradeError("Unknown network");
  const signature = await s.signTypedData(n.id, { domain: routerDomain(n), types: { Cancel: [{ name: "user", type: "address" }, { name: "nonce", type: "uint256" }] }, primaryType: "Cancel", message: { user: s.address, nonce: BigInt(o.nonce) } });
  const r = await fetch(`${RELAYER}/orders/cancel`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: o.id, signature }) }).catch(() => null);
  const j = r ? await r.json().catch(() => ({})) : {};
  if (!r || !r.ok) throw new TradeError(j.error || "Couldn't cancel the order.");
}
