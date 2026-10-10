"use client";
// On-chain side of ArkhamPad: networks, contract calls, signed (gasless) requests.
import { createPublicClient, createWalletClient, defineChain, domainSeparator, encodeFunctionData, fallback, http, keccak256, parseAbi, parseEventLogs, type Address, type Hex, type PublicClient } from "viem";
import { baseSepolia } from "viem/chains";

export const RELAYER = process.env.NEXT_PUBLIC_RELAYER_URL || "https://arkhampad-web-production.up.railway.app";

export const robinhoodTestnet = defineChain({
  id: 46630,
  name: "Robinhood Chain Testnet",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.testnet.chain.robinhood.com"] } },
  testnet: true,
});

export type Net = { id: number; name: string; short: string; rpc: string; rpcs?: string[]; hub: Address; router: Address; usdc: Address; faucet: boolean; faucetUrl?: string; usdDecimals?: number; approvals?: "permit" | "gas"; dollar?: string };

// Contract addresses come from contracts/deployments/<chainId>.json.
const DEFAULT_NETS: Net[] = [
  { id: 84532, name: "Base Sepolia", short: "Base", rpc: "https://sepolia.base.org", hub: "0x47C6A09e89294203962dF909eE36cA3Ea0189cC4", router: "0x0557fA969D81508C3E23568512C965c58Bd41637", usdc: "0x036CbD53842c5426634e7929541eC2318f3dCF7e", faucet: false, faucetUrl: "https://faucet.circle.com" },
  { id: 46630, name: "Robinhood Testnet", short: "Robinhood", rpc: "https://rpc.testnet.chain.robinhood.com", hub: "0x3f49Ab48d9e04bd12D9D5613d2d879Eb754a5CA9", router: "0xD8cAF98C955D8c1071807d4884BB04Ea2Ac55a49", usdc: "0x47AfD49069EAbEcfb153926f1f652249fFb61b57", faucet: true },
];
// Local test builds can point everything at a local chain.
const ENV_NETS: Net[] = process.env.NEXT_PUBLIC_NETS ? JSON.parse(process.env.NEXT_PUBLIC_NETS) : DEFAULT_NETS;
/** Mainnets opened after Base: switched on here in code (from contracts/deployments/<chainId>.json),
 *  so opening a chain needs no Cloudflare setting. Added only when the site runs on Base mainnet. */
const MORE_MAINNETS: Net[] = [
  // Robinhood Chain: the dollar is USDG (Global Dollar, 6 decimals, with permit)
  { id: 4663, name: "Robinhood Chain", short: "Robinhood", rpc: "https://robinhood.drpc.org", hub: "0x47AfD49069EAbEcfb153926f1f652249fFb61b57", router: "0x0Bdb2e316294Ef449aa94E242a88383dD3a35d88", usdc: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168", faucet: false, dollar: "USDG" },
  // BNB Chain: Binance-Peg USDC has 18 decimals and no permit (one approval after a small gas top-up)
  { id: 56, name: "BNB Chain", short: "BNB", rpc: "https://bsc-rpc.publicnode.com", hub: "0x5abe87751c6d0942805f53F33a4fa022255C08D1", router: "0x4669c253E875c351225B8354A02eE5f9DA5dd125", usdc: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d", faucet: false, usdDecimals: 18, approvals: "gas" },
];
export const NETS: Net[] = ENV_NETS.some((n) => n.id === 8453)
  ? [...ENV_NETS, ...MORE_MAINNETS.filter((m) => !ENV_NETS.some((n) => n.id === m.id))]
  : ENV_NETS;
/** The network's dollar token symbol ("USDC", or "USDG" on Robinhood). */
export const dollarOf = (id: number) => NETS.find((n) => n.id === id)?.dollar ?? "USDC";
/** True once the site runs on real networks (mainnet chains configured): no test money anywhere. */
export const LIVE = NETS.some((n) => [4663, 8453, 56, 5042].includes(n.id));
/** "Base", "Robinhood and Base"... for copy. */
export const NET_NAMES = NETS.map((n) => n.short).join(" and ");
export const netOf = (id: number) => NETS.find((n) => n.id === id) ?? null;
export const viemChain = (id: number) => (id === 84532 ? baseSepolia : id === 46630 ? robinhoodTestnet : defineChain({ id, name: `chain ${id}`, nativeCurrency: id === 56 ? { name: "BNB", symbol: "BNB", decimals: 18 } : { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [netOf(id)?.rpc ?? ""] } } }));

/** Public backup nodes per chain: used automatically when the main node is slow or down. */
const BACKUP_RPCS: Record<number, string[]> = {
  8453: ["https://mainnet.base.org", "https://base-rpc.publicnode.com"],
  84532: ["https://sepolia.base.org", "https://base-sepolia-rpc.publicnode.com"],
  56: ["https://bsc-dataseed.bnbchain.org", "https://bsc-rpc.publicnode.com", "https://bsc.drpc.org"],
  // the official endpoint sits behind a Cloudflare challenge that blocks apps now and then
  4663: ["https://robinhood.drpc.org", "https://rpc.mainnet.chain.robinhood.com"],
};

const clients = new Map<number, PublicClient>();

/**
 * Waits for a receipt by asking for it directly. viem's waiter also reads blocks, and a
 * load-balanced public RPC (BNB) can answer from a node a block behind, which fails the wait
 * even though the transaction went through. Here any error just means "not yet".
 */
const receiptClients = new Map<number, PublicClient[]>();
/** One client per RPC: a node that never returns a fresh receipt answers "null", not an error. */
function receiptClientsFor(id: number): PublicClient[] {
  let l = receiptClients.get(id);
  if (!l) {
    const n = netOf(id);
    const urls = [...new Set([n?.rpc, ...(n?.rpcs ?? []), ...(BACKUP_RPCS[id] ?? [])].filter(Boolean) as string[])];
    l = urls.map((u) => createPublicClient({ chain: viemChain(id), transport: http(u, { retryCount: 0, timeout: 8_000 }) }) as PublicClient);
    receiptClients.set(id, l);
  }
  return l;
}
export async function receipt(id: number, hash: Hex, timeout = 60_000, every = 300) {
  const end = Date.now() + timeout;
  const all = receiptClientsFor(id);
  for (let i = 0; ; i++) {
    const rc = await (all.length ? all[i % all.length] : client(id)).getTransactionReceipt({ hash }).catch(() => null);
    if (rc) return rc;
    if (Date.now() > end) throw new Error("Timed out waiting for the transaction.");
    await new Promise((ok) => setTimeout(ok, every));
  }
}
export function client(id: number): PublicClient {
  let c = clients.get(id);
  if (!c) {
    const n = netOf(id);
    if (!n) throw new Error("Unknown network");
    // main node first, then backups: a slow or failing node is skipped without the user noticing
    const urls = [...new Set([n.rpc, ...(n.rpcs ?? []), ...(BACKUP_RPCS[id] ?? [])].filter(Boolean))];
    const transport = urls.length > 1
      ? fallback(urls.map((u) => http(u, { retryCount: 1, timeout: 10_000 })), { rank: false, retryCount: 2 })
      : http(urls[0], { retryCount: 3, timeout: 15_000 });
    c = createPublicClient({ chain: viemChain(id), transport, pollingInterval: 250 }) as PublicClient;
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
// v2: every coin opens straight into its locked Uniswap v4 pool at launch (no bonding curve).
export const HUB = parseAbi([
  "function isCoin(address) view returns (bool)",
  "function startMarketCap() view returns (uint256)",
  "function minLaunchBuy() view returns (uint256)",
  "event CoinCreated(address indexed coin, address indexed creator, string name, string symbol, string metadataURI, uint256 lockSeconds, uint8 feeMode)",
]);
export const PROMOTE = parseAbi(["function plans(uint8) view returns (uint64 seconds_, uint128 price, bool active)", "function promoter() view returns (address)"]);
const ROUTER_VIEW = parseAbi(["function promoter() view returns (address)", "function quotePool(address coin, bool isBuy, uint256 amountIn) returns (uint256)"]);
const POOL_EVENT = parseAbi(["event PoolTraded(address indexed user, address indexed coin, bool isBuy, uint256 usdcAmount, uint256 coinAmount, uint256 fee, uint256 nonce)"]);

export const FEE = 10_000n; // smallest network fee ($0.01, site units: 6 decimals); the live one comes from the relayer

// Live network fee per kind of request: what the relayer really spends on gas, in USDC.
// Cached for 20 seconds and fetched ahead of time, so a trade never waits on it.
type FeeKind = "buy" | "sell" | "poolBuy" | "poolSell" | "launch" | "withdraw" | "promote" | "extSwap";
const feeCache = new Map<string, { at: number; fee: bigint }>();
const feeLoads = new Map<string, Promise<bigint>>();
export async function netFee(chainId: number, kind: FeeKind): Promise<bigint> {
  const key = `${chainId}:${kind}`;
  const hit = feeCache.get(key);
  if (hit && Date.now() - hit.at < 20_000) return hit.fee;
  let p = feeLoads.get(key);
  if (!p) {
    p = (async () => {
      try {
        const r = await fetch(`${RELAYER}/fee?chainId=${chainId}&kind=${kind}`, { signal: AbortSignal.timeout(3000) });
        const j = await r.json();
        if (j?.busy) throw new TradeError("The network is very busy right now. Please try again in a few minutes.");
        const fee = BigInt(String(j?.fee ?? "0"));
        if (r.ok && fee >= FEE) { feeCache.set(key, { at: Date.now(), fee }); return fee; }
      } catch (e) { if (e instanceof TradeError) throw e; }
      return hit?.fee ?? FEE;
    })().finally(() => feeLoads.delete(key));
    feeLoads.set(key, p);
  }
  return p;
}
/** Last known fee without waiting (for estimates on screen). */
export function lastFee(chainId: number, kind: FeeKind): bigint { return feeCache.get(`${chainId}:${kind}`)?.fee ?? FEE; }
/** Fetches the usual fees ahead of a trade. */
export function warmFees(chainId: number, kinds: FeeKind[] = ["buy", "sell"]) { for (const k of kinds) netFee(chainId, k).catch(() => {}); }

// The site counts dollars with 6 decimals everywhere. Some networks' dollar token has more
// (BNB's USDC: 18). These convert at the edge, right where amounts go to or come from a chain.
const decOf = (n: Net) => n.usdDecimals ?? 6;
const scaleOf = (n: Net) => 10n ** BigInt(decOf(n) - 6);
const up = (n: Net, v: bigint) => v * scaleOf(n); // site units -> chain units
const down = (n: Net, v: bigint) => v / scaleOf(n); // chain units -> site units
export const MAX = 2n ** 256n - 1n;
export const toUsdc = (n: number) => BigInt(Math.round(n * 1e6));
export const fromUsdc = (v: bigint) => Number(v) / 1e6;
export const fromCoin = (v: bigint) => Number(v) / 1e18;

export type Signer = {
  address: Address;
  signTypedData: (chainId: number, typed: TypedData) => Promise<Hex>;
  /** Sends a transaction from the user's wallet (only needed for one-time approvals on networks without permit). */
  sendTx?: (chainId: number, tx: { to: Address; data: Hex }) => Promise<Hex>;
};
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

/** Reads are safe to repeat: when a node doesn't answer, ask again (0.6 s, then 1.5 s) before giving up. */
export async function withRetry<T>(fn: () => Promise<T>, tries = 3): Promise<T> {
  const waits = [600, 1500];
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (e) {
      const m = String((e as { shortMessage?: string; message?: string })?.shortMessage ?? (e as Error)?.message ?? "");
      const network = /HTTP request failed|timed? ?out|fetch failed|Failed to fetch|429|rate limit|NetworkError/i.test(m) && !/revert/i.test(m);
      if (!network || i >= tries - 1) throw e;
      await new Promise((ok) => setTimeout(ok, waits[Math.min(i, waits.length - 1)]));
    }
  }
}

type Relayed = { hash: Hex; status?: string; logs?: { address: Address; data: Hex; topics: Hex[] }[] };

async function relay(body: Record<string, unknown>): Promise<Relayed> {
  let r: Response | null = null;
  // A dropped connection is retried once. That's safe: every signed trade carries a nonce,
  // so the same signature can never run twice on-chain.
  for (let attempt = 0; attempt < 2 && !r; attempt++) {
    try {
      r = await fetch(`${RELAYER}/relay`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(90_000) });
    } catch (e) {
      if ((e as Error)?.name === "TimeoutError") throw new TradeError("This is taking longer than usual. It may still go through: check your balance in a minute before trying again.");
      if (attempt === 1) throw new TradeError("Can't reach ArkhamPad right now. Check your connection and try again.");
      await new Promise((ok) => setTimeout(ok, 1200));
    }
  }
  if (!r) throw new TradeError("Can't reach ArkhamPad right now. Check your connection and try again.");
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    if (j.code === "FEE_CHANGED") { feeCache.clear(); owedHint.add(Number(body.chainId)); } // the next tap signs with the new fee (and any gas still owed)
    // after a dropped connection, "already sent" means the first attempt went through
    if (/already sent/i.test(String(j.error || ""))) throw new TradeError("Your trade already went through. Your balance updates in a moment.");
    throw new TradeError(j.error || "Something went wrong. Please try again.");
  }
  return j as Relayed;
}

/** The relayer waits for the block and returns the receipt logs, so no extra round trips here. */
async function confirm(n: Net, res: Relayed): Promise<{ logs: Relayed["logs"]; transactionHash: Hex }> {
  if (res.logs && res.status) {
    if (res.status !== "success") throw new TradeError("The transaction failed on-chain. Your funds are safe.");
    return { logs: res.logs, transactionHash: res.hash };
  }
  // the trade is already sent: wait longer rather than report a failure that didn't happen
  let rc;
  try {
    rc = await receipt(n.id, res.hash, 120_000, 500);
  } catch {
    throw new TradeError("Your trade was sent and is still confirming. It will show up in your balance shortly.");
  }
  if (rc.status !== "success") throw new TradeError("The transaction failed on-chain. Your funds are safe.");
  return { logs: rc.logs as never, transactionHash: rc.transactionHash };
}

/** One-time approval by signature (no gas): lets the router move this token when the user signs a trade. */
const permitted = new Set<string>();
/**
 * The EIP-712 "version" a token uses for permits differs between tokens (Circle USDC: "2",
 * most others: "1"). Pick the one whose domain matches the token's own DOMAIN_SEPARATOR.
 */
const versions = new Map<string, string>();
export async function permitVersion(chainId: number, token: Address): Promise<string> {
  const key = `${chainId}:${token}`.toLowerCase();
  const hit = versions.get(key);
  if (hit) return hit;
  const c = client(chainId);
  const [name, onchain, declared] = await Promise.all([
    c.readContract({ address: token, abi: ERC20, functionName: "name" }),
    c.readContract({ address: token, abi: parseAbi(["function DOMAIN_SEPARATOR() view returns (bytes32)"]), functionName: "DOMAIN_SEPARATOR" }).catch(() => null),
    c.readContract({ address: token, abi: ERC20, functionName: "version" }).catch(() => null),
  ]);
  const tries = [...new Set([declared, "1", "2"].filter(Boolean) as string[])];
  const found = onchain ? tries.find((v) => domainSeparator({ domain: { name, version: v, chainId, verifyingContract: token } }) === onchain) : undefined;
  const v = found ?? declared ?? "1";
  versions.set(key, v);
  return v;
}

/** Reads the allowance until it reaches `need` (up to ~8 s): nodes behind a load balancer can lag a block. */
async function allowanceReaches(n: Net, token: Address, owner: Address, need: bigint): Promise<boolean> {
  for (let i = 0; i < 12; i++) {
    const got = await withRetry(() => client(n.id).readContract({ address: token, abi: ERC20, functionName: "allowance", args: [owner, n.router] })).catch(() => 0n);
    if (got >= need) return true;
    await new Promise((ok) => setTimeout(ok, 700));
  }
  return false;
}

async function ensureAllowance(n: Net, s: Signer, token: Address, need: bigint) {
  const key = `${n.id}:${token}:${s.address}`.toLowerCase();
  if (permitted.has(key)) return;
  const c = client(n.id);
  const allowance = await c.readContract({ address: token, abi: ERC20, functionName: "allowance", args: [s.address, n.router] });
  if (allowance >= need) { permitted.add(key); return; }
  if (n.approvals === "gas") {
    // No permit on this network's dollar (BNB): ArkhamPad tops the wallet up with a little gas,
    // then the wallet approves once. The user never sees or pays any gas themselves.
    if (!s.sendTx) throw new TradeError("This wallet can't approve on this network yet.");
    await relay({ chainId: n.id, kind: "gas", user: s.address, token });
    const hash = await Promise.race([
      s.sendTx(n.id, { to: token, data: encodeFunctionData({ abi: parseAbi(["function approve(address,uint256) returns (bool)"]), functionName: "approve", args: [n.router, MAX] }) }),
      new Promise<never>((_, no) => setTimeout(() => no(new TradeError("Your wallet didn't respond. Please try again.")), 60_000)),
    ]);
    await receipt(n.id, hash, 60_000, 250);
    if (!(await allowanceReaches(n, token, s.address, need))) throw new TradeError("Approval didn't go through. Please try again.");
    permitted.add(key);
    return;
  }
  const [name, nonce, version] = await Promise.all([
    c.readContract({ address: token, abi: ERC20, functionName: "name" }),
    c.readContract({ address: token, abi: ERC20, functionName: "nonces", args: [s.address] }),
    permitVersion(n.id, token),
  ]);
  const dl = deadline();
  const signature = await s.signTypedData(n.id, { domain: { name, version, chainId: n.id, verifyingContract: token }, types: { Permit: TYPES.Permit }, primaryType: "Permit", message: { owner: s.address, spender: n.router, value: MAX, nonce, deadline: dl } });
  await confirm(n, await relay({ chainId: n.id, kind: "permit", token, owner: s.address, value: S(MAX), deadline: S(dl), signature }));
  // The approval is mined, but a load-balanced node can answer from a block or two behind:
  // look again for a few seconds before calling it a failure.
  if (!(await allowanceReaches(n, token, s.address, need))) throw new TradeError("Approval didn't go through. Please try again.");
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
  return down(n, await client(chainId).readContract({ address: n.usdc, abi: ERC20, functionName: "balanceOf", args: [who] }));
}

// ---------------------------------------------------------------- one cash balance across chains
// The user sees one USDC balance. Deposits and withdrawals use the home chain (Base). When a trade
// needs cash on another chain, it is moved there first through Relay (relay.link), from the
// user's own wallet: a gasless signed authorization where the dollar supports it, otherwise an
// approve + deposit after a small gas top-up (repaid with the next trade's network fee).
const MOVABLE = new Set([8453, 4663, 56, 5042]);
/** Deposits and withdrawals happen here. */
export const HOME_CHAIN = LIVE ? 8453 : (NETS[0]?.id ?? 84532);
const canMove = (id: number) => LIVE && MOVABLE.has(id) && !!netOf(id);
/** Chains where this user may owe a move's gas top-up: their next fee there includes it. */
const owedHint = new Set<number>();

type MoveItem = { status?: string; data?: Record<string, unknown> & { sign?: { signatureKind?: string; domain: Record<string, unknown>; types: Record<string, { name: string; type: string }[]>; primaryType: string; value: Record<string, unknown> }; post?: { endpoint: string; method: string; body: Record<string, unknown> } } };
type MoveStep = { id?: string; kind?: string; requestId?: string; items?: MoveItem[] };
async function moveApi(body: Record<string, unknown>): Promise<{ requestId?: string | null; steps?: MoveStep[]; amountIn?: string | null; status?: string }> {
  let r: Response;
  try {
    r = await fetch(`${RELAYER}/move`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(30_000) });
  } catch {
    throw new TradeError("Can't reach ArkhamPad right now. Check your connection and try again.");
  }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new TradeError(j.error || "Something went wrong. Please try again.");
  return j;
}

/** What the user still owes on this chain for a cash move's gas (site units), added to their next fee. */
async function owedFor(chainId: number, user: Address): Promise<bigint> {
  if (!owedHint.has(chainId)) return 0n;
  try {
    const r = await fetch(`${RELAYER}/fee?chainId=${chainId}&kind=buy&user=${user}`, { signal: AbortSignal.timeout(3000), cache: "no-store" });
    const j = await r.json();
    const o = BigInt(String(j?.owed ?? "0"));
    if (o === 0n) owedHint.delete(chainId);
    return o;
  } catch {
    return 0n;
  }
}

/** Every chain's cash for this user (site units), in one read. */
export async function cashByChain(who: Address): Promise<Record<number, bigint>> {
  const out: Record<number, bigint> = {};
  await Promise.all(NETS.map(async (n) => { out[n.id] = await usdcBalance(n.id, who).catch(() => 0n); }));
  return out;
}

/**
 * Makes sure `need` (site units) is on `chainId`, moving cash in from the user's other chains
 * when it's short there. Returns at once when the cash is already there.
 */
export async function ensureCash(chainId: number, need: bigint, s: Signer): Promise<void> {
  const n = netOf(chainId);
  if (!n) throw new TradeError("Unknown network");
  const have = await usdcBalance(chainId, s.address);
  if (have >= need || !canMove(chainId)) return;
  const short = need - have + 10_000n; // +$0.01 of room for rounding
  const others = NETS.filter((x) => x.id !== chainId && canMove(x.id));
  const bals = await Promise.all(others.map(async (x) => ({ x, b: await usdcBalance(x.id, s.address).catch(() => 0n) })));
  bals.sort((a, b) => (b.b > a.b ? 1 : b.b < a.b ? -1 : 0));
  const src = bals[0];
  if (!src || src.b < short) throw new TradeError("Not enough cash. Deposit USDC to continue.");
  const q = await moveApi({ action: "quote", from: src.x.id, to: chainId, user: s.address, amount: S(up(n, short)) });
  if (q.amountIn && down(src.x, BigInt(q.amountIn)) > src.b) throw new TradeError("Not enough cash to cover this trade. Try a slightly smaller amount.");
  let topped = false;
  for (const step of q.steps ?? []) {
    for (const item of step.items ?? []) {
      if (item.status === "complete") continue;
      if (step.kind === "signature") {
        const sign = item.data?.sign, post = item.data?.post;
        if (!sign || sign.signatureKind !== "eip712" || !post) throw new TradeError("Couldn't move your cash right now. Please try again.");
        const types = { ...sign.types };
        delete (types as Record<string, unknown>).EIP712Domain;
        const signature = await s.signTypedData(Number(sign.domain.chainId ?? src.x.id), { domain: sign.domain, types, primaryType: sign.primaryType, message: sign.value });
        await moveApi({ action: "permit", signature, post });
      } else {
        const d = item.data as { to?: Address; data?: Hex; value?: string; chainId?: number } | undefined;
        if (!d?.to || !d.data) throw new TradeError("Couldn't move your cash right now. Please try again.");
        if (BigInt(String(d.value ?? "0")) !== 0n) throw new TradeError("Couldn't move your cash right now. Please try again.");
        if (!s.sendTx) throw new TradeError("This wallet can't move cash between networks yet.");
        const cid = Number(d.chainId ?? src.x.id);
        if (!topped) {
          await relay({ chainId: cid, kind: "gas", spender: "move", user: s.address, token: src.x.usdc, dest: chainId });
          owedHint.add(chainId);
          topped = true;
        }
        const hash = await Promise.race([
          s.sendTx(cid, { to: d.to, data: d.data }),
          new Promise<never>((_, no) => setTimeout(() => no(new TradeError("Your wallet didn't respond. Please try again.")), 60_000)),
        ]);
        const rc = await receipt(cid, hash, 60_000, 300);
        if (rc.status !== "success") throw new TradeError("Moving your cash didn't go through. Your funds are safe; please try again.");
      }
    }
  }
  // wait for the cash to land (usually a few seconds)
  const t0 = Date.now();
  for (let i = 0; Date.now() - t0 < 120_000; i++) {
    const now = await usdcBalance(chainId, s.address).catch(() => 0n);
    if (now >= need) return;
    if (q.requestId && i % 4 === 3) {
      const st = await moveApi({ action: "status", requestId: q.requestId }).catch(() => null);
      if (st?.status === "failure" || st?.status === "refund") throw new TradeError("Moving your cash didn't go through. Your funds are safe; please try again.");
    }
    await new Promise((ok) => setTimeout(ok, 800));
  }
  throw new TradeError("This is taking longer than usual. Your cash is on its way: try again in a minute.");
}
export async function tokenBalance(chainId: number, token: Address, who: Address) {
  return client(chainId).readContract({ address: token, abi: ERC20, functionName: "balanceOf", args: [who] });
}
/** Reads the balance until it reaches `need` (up to ~8 s): nodes behind a load balancer can lag a block. */
async function balanceReaches(chainId: number, token: Address, who: Address, need: bigint): Promise<boolean> {
  for (let i = 0; i < 12; i++) {
    const got = await withRetry(() => tokenBalance(chainId, token, who)).catch(() => 0n);
    if (got >= need) return true;
    await new Promise((ok) => setTimeout(ok, 700));
  }
  return false;
}
/** v2 has no curve: quotes come from the coin's pool. `curve` is kept for old callers and holds the coin. */
export async function quoteBuy(chainId: number, curve: Address, usdcIn: bigint) {
  return quotePool(chainId, curve, true, usdcIn);
}
export async function quoteSell(chainId: number, curve: Address, coins: bigint) {
  return quotePool(chainId, curve, false, coins);
}

export type LocalTrade = { chainId: number; coin: Address; curve: Address; trader: Address; isBuy: boolean; usdc: number; coins: number; price: number; mc: number; hash: Hex; at: number };

function tradeFrom(n: Net, rc: { logs: { address: Address; data: Hex; topics: [Hex, ...Hex[]] | [] }[]; transactionHash: Hex }, curve: Address, coin: Address, user: Address): LocalTrade | null {
  const ev = parseEventLogs({ abi: CURVE, logs: rc.logs as never, eventName: "Trade" }).find((e) => e.address.toLowerCase() === curve.toLowerCase());
  if (!ev) return null;
  const a = ev.args as { isBuy: boolean; usdcAmount: bigint; coinAmount: bigint; vUsdcAfter: bigint; vCoinAfter: bigint };
  const price = fromUsdc(down(n, a.vUsdcAfter)) / fromCoin(a.vCoinAfter);
  return { chainId: n.id, coin, curve, trader: user, isBuy: a.isBuy, usdc: fromUsdc(down(n, a.usdcAmount)), coins: fromCoin(a.coinAmount), price, mc: price * 1e9, hash: rc.transactionHash, at: Date.now() };
}

// Trades made in this tab, so pages update instantly (before the indexer catches up).
type Listener = (t: LocalTrade) => void;
const listeners = new Set<Listener>();
export function onLocalTrade(fn: Listener) { listeners.add(fn); return () => { listeners.delete(fn); }; }
const emit = (t: LocalTrade | null) => { if (t) listeners.forEach((f) => f(t)); };

// ---------------------------------------------------------------- actions
const SLIPPAGE_BPS = 300n; // 3%

/** v2: every coin trades in its pool. Kept with the old signature so older callers keep working. */
export async function buy(chainId: number, _curve: Address, coin: Address, usdcIn: bigint, s: Signer) {
  return poolBuy(chainId, coin, usdcIn, s);
}

export async function sell(chainId: number, _curve: Address, coin: Address, coinAmount: bigint, s: Signer) {
  return poolSell(chainId, coin, coinAmount, s);
}

/** What a trade in a coin's pool gives right now (simulated on-chain, exact, after the pool fee). */
export async function quotePool(chainId: number, coin: Address, isBuy: boolean, amountIn: bigint) {
  const n = netOf(chainId);
  if (!n) return 0n;
  const { result } = await withRetry(() => client(chainId).simulateContract({ address: n.router, abi: ROUTER_VIEW, functionName: "quotePool", args: [coin, isBuy, isBuy ? up(n, amountIn) : amountIn] }));
  return isBuy ? (result as bigint) : down(n, result as bigint);
}

function poolTradeFrom(n: Net, rc: { logs: unknown[]; transactionHash: Hex }, coin: Address, user: Address): LocalTrade | null {
  const ev = parseEventLogs({ abi: POOL_EVENT, logs: rc.logs as never, eventName: "PoolTraded" })[0];
  if (!ev) return null;
  const a = ev.args as { isBuy: boolean; usdcAmount: bigint; coinAmount: bigint };
  const usdcN = fromUsdc(down(n, a.usdcAmount)), coinsN = fromCoin(a.coinAmount);
  const price = coinsN > 0 ? usdcN / coinsN : 0; // average fill price of this trade
  return { chainId: n.id, coin, curve: coin, trader: user, isBuy: a.isBuy, usdc: usdcN, coins: coinsN, price, mc: price * 1e9, hash: rc.transactionHash, at: Date.now() };
}

export async function poolBuy(chainId: number, coin: Address, usdcIn: bigint, s: Signer) {
  const n = netOf(chainId);
  if (!n) throw new TradeError("Unknown network");
  if (usdcIn <= 0n) throw new TradeError("Enter an amount.");
  const fee = (await netFee(chainId, "poolBuy")) + (await owedFor(chainId, s.address));
  await ensureCash(chainId, usdcIn + fee, s);
  const [bal, quote] = await Promise.all([usdcBalance(chainId, s.address), quotePool(chainId, coin, true, usdcIn), ensureAllowance(n, s, n.usdc, up(n, usdcIn + fee))]);
  if (bal < usdcIn + fee) throw new TradeError("Not enough cash. Deposit USDC to continue.");
  if (quote === 0n) throw new TradeError("Amount is too small.");
  const minOut = (quote * (10_000n - SLIPPAGE_BPS)) / 10_000n;
  const nonce = randomNonce(), dl = deadline();
  const signature = await s.signTypedData(n.id, { domain: routerDomain(n), types: { PoolBuy: TYPES.PoolBuy }, primaryType: "PoolBuy", message: { user: s.address, coin, usdcIn: up(n, usdcIn), minCoinsOut: minOut, fee: up(n, fee), nonce, deadline: dl } });
  const rc = await confirm(n, await relay({ chainId: n.id, kind: "poolBuy", user: s.address, coin, usdcIn: S(up(n, usdcIn)), minCoinsOut: S(minOut), fee: S(up(n, fee)), nonce: S(nonce), deadline: S(dl), signature }));
  const t = poolTradeFrom(n, rc as never, coin, s.address);
  emit(t);
  prepareSell(n, s, coin);
  return t;
}

export async function poolSell(chainId: number, coin: Address, coinAmount: bigint, s: Signer) {
  const n = netOf(chainId);
  if (!n) throw new TradeError("Unknown network");
  if (coinAmount <= 0n) throw new TradeError("Enter an amount.");
  const [held, quote, base, owes] = await Promise.all([tokenBalance(chainId, coin, s.address), quotePool(chainId, coin, false, coinAmount), netFee(chainId, "poolSell"), owedFor(chainId, s.address), ensureAllowance(n, s, coin, coinAmount)]);
  const fee = base + owes;
  // a load-balanced node can answer from a block behind right after a buy: look again for a few seconds
  if (held < coinAmount && !(await balanceReaches(chainId, coin, s.address, coinAmount))) throw new TradeError("You don't hold that many.");
  if (quote <= fee) throw new TradeError("This sale is too small to cover the network fee.");
  const minOut = ((quote - fee) * (10_000n - SLIPPAGE_BPS)) / 10_000n;
  const nonce = randomNonce(), dl = deadline();
  const signature = await s.signTypedData(n.id, { domain: routerDomain(n), types: { PoolSell: TYPES.PoolSell }, primaryType: "PoolSell", message: { user: s.address, coin, coinAmount, minUsdcOut: up(n, minOut), fee: up(n, fee), nonce, deadline: dl } });
  const rc = await confirm(n, await relay({ chainId: n.id, kind: "poolSell", user: s.address, coin, coinAmount: S(coinAmount), minUsdcOut: S(up(n, minOut)), fee: S(up(n, fee)), nonce: S(nonce), deadline: S(dl), signature }));
  const t = poolTradeFrom(n, rc as never, coin, s.address);
  emit(t);
  return t;
}

export type LaunchInput = { name: string; symbol: string; metadataURI: string; lockSeconds: number; feeMode: 0 | 1; launchUsdc: bigint };
/** Smallest first buy a launch must include (the dollar token's units: 6 decimals on the site). */
export const MIN_LAUNCH_BUY = 5_000_000n;

export async function launch(chainId: number, l: LaunchInput, s: Signer): Promise<{ coin: Address; curve: Address }> {
  const n = netOf(chainId);
  if (!n) throw new TradeError("Unknown network");
  if (l.launchUsdc < MIN_LAUNCH_BUY) throw new TradeError("Your first buy must be at least $5.");
  const fee = (await netFee(chainId, "launch")) + (await owedFor(chainId, s.address));
  const need = l.launchUsdc + fee;
  await ensureCash(chainId, need, s);
  const bal = await usdcBalance(chainId, s.address);
  if (bal < need) throw new TradeError(`You need at least $${fromUsdc(need).toFixed(2)} in cash to launch.`);
  await ensureAllowance(n, s, n.usdc, up(n, need));
  const nonce = randomNonce(), dl = deadline();
  const message = { user: s.address, name: l.name, symbol: l.symbol, metadataURI: l.metadataURI, lockSeconds: BigInt(l.lockSeconds), feeMode: l.feeMode, launchUsdc: up(n, l.launchUsdc), minCoinsOut: 0n, fee: up(n, fee), nonce, deadline: dl };
  const signature = await s.signTypedData(n.id, { domain: routerDomain(n), types: { Create: TYPES.Create }, primaryType: "Create", message });
  const rc = await confirm(n, await relay({ chainId: n.id, kind: "launch", user: s.address, launch: { name: l.name, symbol: l.symbol, metadataURI: l.metadataURI, lockSeconds: String(l.lockSeconds), feeMode: l.feeMode, launchUsdc: S(up(n, l.launchUsdc)), minCoinsOut: "0" }, fee: S(up(n, fee)), nonce: S(nonce), deadline: S(dl), signature }));
  const ev = parseEventLogs({ abi: HUB, logs: rc.logs as never, eventName: "CoinCreated" })[0];
  if (!ev) throw new TradeError("Launch went through but the coin wasn't found. Check your profile.");
  const a = ev.args as { coin: Address };
  // the launch buy shows up from the indexer within seconds (it has no router event to read here)
  return { coin: a.coin, curve: a.coin };
}

export async function withdraw(chainId: number, to: Address, amount: bigint, s: Signer) {
  const n = netOf(chainId);
  if (!n) throw new TradeError("Unknown network");
  if (amount <= 0n) throw new TradeError("Enter an amount.");
  const fee = (await netFee(chainId, "withdraw")) + (await owedFor(chainId, s.address));
  await ensureCash(chainId, amount + fee, s);
  const bal = await usdcBalance(chainId, s.address);
  if (bal < amount + fee) throw new TradeError(`Not enough USDC (keep $${fromUsdc(fee).toFixed(2)} for the network fee).`);
  await ensureAllowance(n, s, n.usdc, up(n, amount + fee));
  const nonce = randomNonce(), dl = deadline();
  const signature = await s.signTypedData(n.id, { domain: routerDomain(n), types: { Withdraw: TYPES.Withdraw }, primaryType: "Withdraw", message: { user: s.address, to, amount: up(n, amount), fee: up(n, fee), nonce, deadline: dl } });
  return confirm(n, await relay({ chainId: n.id, kind: "withdraw", user: s.address, to, amount: S(up(n, amount)), fee: S(up(n, fee)), nonce: S(nonce), deadline: S(dl), signature }));
}

export async function promote(chainId: number, coin: Address, plan: 1 | 2 | 3, s: Signer, coinChainId: number = chainId) {
  const n = netOf(chainId);
  if (!n) throw new TradeError("Unknown network");
  const promoter = await client(chainId).readContract({ address: n.router, abi: ROUTER_VIEW, functionName: "promoter" });
  const [, price, active] = await client(chainId).readContract({ address: promoter, abi: PROMOTE, functionName: "plans", args: [plan] });
  if (!active) throw new TradeError("This promotion isn't available right now.");
  const fee = (await netFee(chainId, "promote")) + (await owedFor(chainId, s.address));
  await ensureCash(chainId, down(n, price) + fee, s);
  const bal = await usdcBalance(chainId, s.address);
  if (bal < down(n, price) + fee) throw new TradeError("Not enough USDC to promote.");
  await ensureAllowance(n, s, n.usdc, price + up(n, fee));
  const nonce = randomNonce(), dl = deadline();
  const signature = await s.signTypedData(n.id, { domain: routerDomain(n), types: { Promote: TYPES.Promote }, primaryType: "Promote", message: { user: s.address, coin, coinChainId: BigInt(coinChainId), plan, maxPrice: price, fee: up(n, fee), nonce, deadline: dl } });
  return confirm(n, await relay({ chainId: n.id, kind: "promote", user: s.address, coin, coinChainId: String(coinChainId), plan: String(plan), maxPrice: S(price), fee: S(up(n, fee)), nonce: S(nonce), deadline: S(dl), signature }));
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
  const ok = await c.readContract({ address: n.hub, abi: HUB, functionName: "isCoin", args: [coin] });
  if (!ok) return null;
  const [name, symbol, startMc] = await Promise.all([
    c.readContract({ address: coin, abi: ERC20, functionName: "name" }),
    c.readContract({ address: coin, abi: ERC20, functionName: "symbol" }),
    c.readContract({ address: n.hub, abi: HUB, functionName: "startMarketCap" }),
  ]);
  const mc = fromUsdc(down(n, startMc));
  const now = new Date().toISOString();
  return { chain_id: chainId, address: coin.toLowerCase(), curve: coin.toLowerCase(), creator: "", name, symbol, phase: 2, price_usd: mc / 1e9, mc_usd: mc, start_mc_usd: mc, usdc_reserve: 0, trades_count: 0, created_at: now, volume_24h: 0, change_24h_pct: null, buyers: 0, metadata_uri: "", creator_fees_usd: 0, pool_usd: 0 };
}

// ---------------------------------------------------------------- creator tools & upkeep

export async function creatorFeesOf(chainId: number, curve: Address) {
  const c = client(chainId);
  const [fees, mode] = await Promise.all([
    c.readContract({ address: curve, abi: CURVE, functionName: "creatorFees" }),
    c.readContract({ address: curve, abi: CURVE, functionName: "feeMode" }),
  ]);
  const n = netOf(chainId);
  return { fees: n ? down(n, fees) : fees, mode: Number(mode) };
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

export function squareImage(file: File, size: number): Promise<string> {
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
  // orders fill later, maybe when gas is higher: they carry twice today's fee
  const fee = (await netFee(p.chainId, p.pool ? (isBuy ? "poolBuy" : "poolSell") : (isBuy ? "buy" : "sell"))) * 2n;
  const price = p.triggerMc / 1e9; // USDC per coin at the trigger
  let min: bigint;
  if (isBuy) {
    // coins for usdcIn at the trigger price, after the 1% fee, with 3% room
    min = BigInt(Math.floor((fromUsdc(p.amount) * 0.99 / price) * 0.97 * 1e6)) * 10n ** 12n;
  } else {
    // stop loss gets more room (prices fall fast); take profit sells at or above the target
    const room = p.kind === "stop_loss" ? 0.8 : 0.96;
    const v = fromCoin(p.amount) * price * 0.99 * room - fromUsdc(fee);
    min = up(n, BigInt(Math.max(1, Math.floor(v * 1e6))));
  }
  await ensureAllowance(n, s, isBuy ? n.usdc : p.coin, isBuy ? up(n, p.amount + fee) : p.amount);
  const nonce = randomNonce();
  const dl = BigInt(Math.floor(Date.now() / 1000) + 30 * 86400); // valid for 30 days
  const venue = p.pool ? "pool" : "curve";
  const reqKind = p.pool ? (isBuy ? "poolBuy" : "poolSell") : (isBuy ? "buy" : "sell");
  const types = { buy: TYPES.Buy, sell: TYPES.Sell, poolBuy: TYPES.PoolBuy, poolSell: TYPES.PoolSell }[reqKind];
  const primary = { buy: "Buy", sell: "Sell", poolBuy: "PoolBuy", poolSell: "PoolSell" }[reqKind];
  const target = p.pool ? { coin: p.coin } : { curve: p.curve as Address };
  const message = isBuy
    ? { user: s.address, ...target, usdcIn: up(n, p.amount), minCoinsOut: min, fee: up(n, fee), nonce, deadline: dl }
    : { user: s.address, ...target, coinAmount: p.amount, minUsdcOut: min, fee: up(n, fee), nonce, deadline: dl };
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

// ---- private reads (your orders and inbox): one signature per day per wallet, then a token
const sessions = new Map<string, { token: string; exp: number }>();
const pendingSession = new Map<string, Promise<string | null>>();
export async function readToken(s: Signer | null): Promise<string | null> {
  if (!s) return null;
  const k = s.address.toLowerCase();
  const now = Date.now() / 1000;
  let have = sessions.get(k);
  if (!have) { try { const raw = sessionStorage.getItem(`ap_sess_${k}`); if (raw) have = JSON.parse(raw); } catch { /* private mode */ } }
  if (have && have.exp - 120 > now) { sessions.set(k, have); return have.token; }
  if (pendingSession.has(k)) return pendingSession.get(k)!;
  const p = (async () => {
    try {
      const time = BigInt(Math.floor(now));
      const payload = {};
      const hash = keccak256(new TextEncoder().encode(JSON.stringify(payload)));
      const signature = await s.signTypedData(NETS[0].id, { domain: { name: "ArkhamPad", version: "1" }, types: { Request: [{ name: "action", type: "string" }, { name: "payload", type: "bytes32" }, { name: "time", type: "uint256" }] }, primaryType: "Request", message: { action: "session", payload: hash, time } });
      const r = await fetch(`${RELAYER}/session`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ user: s.address, action: "session", payload, time: time.toString(), signature }) });
      if (!r.ok) return null;
      const j = (await r.json()) as { token: string; exp: number };
      sessions.set(k, j);
      try { sessionStorage.setItem(`ap_sess_${k}`, JSON.stringify(j)); } catch { /* private mode */ }
      return j.token;
    } catch { return null; } finally { pendingSession.delete(k); }
  })();
  pendingSession.set(k, p);
  return p;
}
const dropToken = (s: Signer) => { const k = s.address.toLowerCase(); sessions.delete(k); try { sessionStorage.removeItem(`ap_sess_${k}`); } catch { /* */ } };

export async function myOrders(s: Signer | null): Promise<Order[]> {
  const token = await readToken(s);
  if (!token || !s) return [];
  const r = await fetch(`${RELAYER}/orders?token=${encodeURIComponent(token)}`).catch(() => null);
  if (r?.status === 401) dropToken(s);
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

// ---------------------------------------------------------------- follows

export async function setFollow(trader: Address, on: boolean, s: Signer) {
  const time = BigInt(Math.floor(Date.now() / 1000));
  const signature = await s.signTypedData(NETS[0].id, { domain: { name: "ArkhamPad", version: "1" }, types: { Follow: [{ name: "trader", type: "address" }, { name: "on", type: "bool" }, { name: "time", type: "uint256" }] }, primaryType: "Follow", message: { trader, on, time } });
  const r = await fetch(`${RELAYER}/follow`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ follower: s.address, trader, on, time: time.toString(), signature }) }).catch(() => null);
  const j = r ? await r.json().catch(() => ({})) : {};
  if (!r || !r.ok) throw new TradeError(j.error || "Couldn't update. Please try again.");
}

// ---------------------------------------------------------------- signed account actions (alerts, push, bell)

export async function accountAction(action: string, payload: Record<string, unknown>, s: Signer) {
  const time = BigInt(Math.floor(Date.now() / 1000));
  const hash = keccak256(new TextEncoder().encode(JSON.stringify(payload)));
  const signature = await s.signTypedData(NETS[0].id, { domain: { name: "ArkhamPad", version: "1" }, types: { Request: [{ name: "action", type: "string" }, { name: "payload", type: "bytes32" }, { name: "time", type: "uint256" }] }, primaryType: "Request", message: { action, payload: hash, time } });
  const r = await fetch(`${RELAYER}/action`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ user: s.address, action, payload, time: time.toString(), signature }) }).catch(() => null);
  const j = r ? await r.json().catch(() => ({})) : {};
  if (!r || !r.ok) throw new TradeError(j.error || "Something went wrong. Please try again.");
  return j;
}

export type Note = { id: string; kind: string; title: string; body: string; url: string; read: boolean; created_at: string };
export type PriceAlert = { id: string; chain_id: number; coin: string; tick: string; direction: "above" | "below"; target_mc: number; status: string; created_at: string; hit_at: string | null };
export async function inbox(s: Signer | null): Promise<{ notes: Note[]; unread: number; alerts: PriceAlert[] }> {
  const token = await readToken(s);
  if (!token || !s) return { notes: [], unread: 0, alerts: [] };
  const r = await fetch(`${RELAYER}/inbox?token=${encodeURIComponent(token)}`).catch(() => null);
  if (r?.status === 401) dropToken(s);
  if (!r || !r.ok) return { notes: [], unread: 0, alerts: [] };
  return r.json();
}
export async function vapidKey(): Promise<string | null> {
  const r = await fetch(`${RELAYER}/config`).catch(() => null);
  const j = r ? await r.json().catch(() => ({})) : {};
  return j.vapidPublicKey ?? null;
}


/** Dev wallet (local tests): send a transaction with a plain private-key account. */
export async function sendWithAccount(account: import("viem").Account, chainId: number, tx: { to: Address; data: Hex }) {
  const n = netOf(chainId);
  if (!n) throw new TradeError("Unknown network");
  const chain = defineChain({ id: n.id, name: n.name, nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [n.rpc] } } });
  return createWalletClient({ account, chain, transport: http(n.rpc) }).sendTransaction({ account, to: tx.to, data: tx.data, chain });
}
