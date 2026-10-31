"use client";
// Trading any Elysium token from the user's own wallet, through the ArkhamPad router
// (contracts-elysium/src/ArkhamRouter.sol). One router works for every launchpad: Uniswap v3 style
// pools (called directly) and v4 style pools (through their pool manager). Pay and receive HYPE.
import { createPublicClient, custom, decodeErrorResult, decodeFunctionResult, encodeFunctionData, parseAbi, type Address, type Hex } from "viem";
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
// Reads go straight to the nodes from the visitor's browser (each visitor has their own allowance there).
// Our doorway is only the backup: every visitor's reads through it share one allowance, and when that ran
// out, sends (which do go through it) failed with "network busy".
const DIRECT = ELY_RPCS;
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

/**
 * Every read goes to all nodes at once and the first good answer wins. (One after another, a slow or busy
 * node cost 5-10 s per read before the next was tried: that was most of the "Buying…" / "Selling…" wait.)
 * If every node refuses, the first node's error is passed on (e.g. "execution reverted").
 */
let rid = 0;
async function raceCall(method: string, params: unknown) {
  const ask = async (url: string) => {
    const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: ++rid, method, params }), signal: AbortSignal.timeout(6000) });
    const j = await r.json();
    if (j.error) throw Object.assign(new Error(j.error.message || "rpc error"), { code: j.error.code, data: j.error.data, rpc: true });
    if (!("result" in j)) throw new Error("no answer");
    return j.result;
  };
  try {
    return await Promise.any(DIRECT.map(ask));
  } catch (e) {
    const errs = (e as AggregateError).errors ?? [e];
    const real = errs.find((x: { rpc?: boolean }) => x?.rpc);
    if (real) throw real; // a node answered with a real error (e.g. "execution reverted")
    return ask(OWN_RPC); // no node reachable directly: through our doorway
  }
}
const raceTransport = custom({ request: ({ method, params }) => raceCall(method, params) });

let client: ReturnType<typeof createPublicClient> | null = null;
export const ely = () =>
  (client ??= createPublicClient({
    chain: { id: ELY_CHAIN, name: "Elysium", nativeCurrency: { name: "HYPE", symbol: "HYPE", decimals: 18 }, rpcUrls: { default: { http: ELY_RPC_LIST } } },
    pollingInterval: 400,
    transport: raceTransport,
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
  // Ascend's PancakeSwap Infinity pools need Ascend's own router (not wired up yet): shown, not tradable here
  if (t.venue === "cl") return null;
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
  await Promise.allSettled(DIRECT.map(ask));
  if (best.result == null) await ask(OWN_RPC).catch(() => {});
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
/** Tokens whose quote only worked as a dry run of the real trade (taxed / fee-on-transfer coins). */
export const taxedTokens = new Set<string>();
export async function quote(t: EToken, isBuy: boolean, amountIn: bigint, from?: Address | null): Promise<bigint | null> {
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
  }
  // The pool refused the plain quote (some taxed coins block transfers to the router during a quote).
  // Dry-run the real trade from the visitor's wallet instead: it returns what actually arrives after any
  // tax. Changes nothing on chain.
  if (!from) return null;
  try {
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);
    const { result } = isBuy
      ? await ely().simulateContract({ account: from, address: ROUTER, abi: ROUTER_ABI, functionName: "buy", args: [p, 0n, deadline], value: amountIn })
      : await ely().simulateContract({ account: from, address: ROUTER, abi: ROUTER_ABI, functionName: "sell", args: [p, amountIn, 0n, deadline] });
    const got = result as bigint;
    if (got > 0n) { taxedTokens.add(t.address.toLowerCase()); return got; }
  } catch {}
  return null;
}
/**
 * Can this coin be sold back here? A tiny helper contract (never deployed: put at a throwaway address for
 * one eth_call through a state override) buys 0.01 HYPE of the coin through our router and sells it
 * straight back. true = sellable, false = the sell reverted (taxed / blocked coin: a buyer could get
 * stuck), null = couldn't check (node without state overrides, pool problem...): then nothing is blocked.
 * Cached per coin for 10 minutes. Source: contracts-elysium/test-helpers/SellCheck.sol.
 */
const SELL_CHECK_CODE = "0x608060405260043610610020575f3560e01c8063ecac1fc91461002b575f80fd5b3661002757005b5f80fd5b348015610036575f80fd5b5061004a61004536600461029b565b61006b565b60408051931515845260208401929092529082015260600160405180910390f35b5f80806001600160a01b038616633ab1706085878461008c426102586102e2565b6040518563ffffffff1660e01b81526004016100aa9392919061040c565b60206040518083038185885af11580156100c6573d5f803e3d5ffd5b50505050506040513d601f19601f820116820180604052508101906100eb919061042e565b91505f6100fe6060870160408801610445565b6040516370a0823160e01b81523060048201526001600160a01b0391909116906370a0823190602401602060405180830381865afa158015610142573d5f803e3d5ffd5b505050506040513d601f19601f82011682018060405250810190610166919061042e565b90506101786060870160408801610445565b60405163095ea7b360e01b81526001600160a01b0389811660048301525f196024830152919091169063095ea7b3906044016020604051808303815f875af11580156101c6573d5f803e3d5ffd5b505050506040513d601f19601f820116820180604052508101906101ea9190610465565b506001600160a01b03871663ce432c2487835f610209426102586102e2565b6040518563ffffffff1660e01b81526004016102289493929190610480565b6020604051808303815f875af1925050508015610262575060408051601f3d908101601f1916820190925261025f9181019061042e565b60015b61026e575f9350610276565b801515945091505b5093509350939050565b80356001600160a01b0381168114610296575f80fd5b919050565b5f805f8385036101408112156102af575f80fd5b6102b885610280565b9350610100601f19820112156102cc575f80fd5b5060208401915061012084013590509250925092565b8082018082111561030157634e487b7160e01b5f52601160045260245ffd5b92915050565b8015158114610314575f80fd5b50565b803561029681610307565b803562ffffff81168114610296575f80fd5b8035600281900b8114610296575f80fd5b803560ff8116808214610356575f80fd5b83525061036560208201610280565b6001600160a01b0316602083015261037f60408201610280565b6001600160a01b0316604083015261039960608201610280565b6001600160a01b031660608301526103b360808201610317565b151560808301526103c660a08201610322565b62ffffff1660a08301526103dc60c08201610334565b6103eb60c084018260020b9052565b506103f860e08201610280565b6001600160a01b03811660e0840152505050565b610140810161041b8286610345565b6101008201939093526101200152919050565b5f6020828403121561043e575f80fd5b5051919050565b5f60208284031215610455575f80fd5b61045e82610280565b9392505050565b5f60208284031215610475575f80fd5b815161045e81610307565b610160810161048f8287610345565b8461010083015283610120830152826101408301529594505050505056fea264697066735822122094a473006a2a37807b9bd1bb7623f376c025fa6c165021406743f2657e6f945264736f6c634300081a0033" as Hex;
const SELL_CHECK_AT = "0x00000000000000000000000000000000a5e11c4e" as Address;
const SELL_CHECK_ABI = parseAbi([
  `function check(address router, ${POOL} p, uint256 buyWei) returns (bool ok, uint256 bought, uint256 back)`,
]);
const sellMemo = new Map<string, { ok: boolean | null; at: number }>();
export async function sellable(t: EToken): Promise<boolean | null> {
  const p = poolArg(t);
  if (!ROUTER || !p || t.ours) return null;
  const k = t.address.toLowerCase();
  const memo = sellMemo.get(k);
  if (memo && Date.now() - memo.at < 600_000) return memo.ok;
  const buyWei = 10n ** 16n; // 0.01 HYPE
  const data = encodeFunctionData({ abi: SELL_CHECK_ABI, functionName: "check", args: [ROUTER, p, buyWei] });
  const params = [
    { from: "0x000000000000000000000000000000000000dEaD", to: SELL_CHECK_AT, data },
    "latest",
    { [SELL_CHECK_AT]: { code: SELL_CHECK_CODE, balance: "0xde0b6b3a7640000" } }, // 1 HYPE for the test buy
  ];
  const ask = async (url: string) => {
    const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call", params }), signal: AbortSignal.timeout(6000) });
    const j = await r.json();
    if (typeof j?.result !== "string" || j.result === "0x") throw new Error("no answer");
    const [ok, bought] = decodeFunctionResult({ abi: SELL_CHECK_ABI, functionName: "check", data: j.result as Hex }) as readonly [boolean, bigint, bigint];
    if (bought === 0n) throw new Error("buy gave nothing"); // can't judge the sell
    return ok;
  };
  let ok: boolean | null = null;
  try { ok = await Promise.any([...DIRECT, OWN_RPC].map(ask)); } catch { ok = null; }
  sellMemo.set(k, { ok, at: Date.now() });
  return ok;
}
export function findRevertData(e: unknown): Hex | null {
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
export const nice = (e: unknown) => {
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
  let round = 0;
  while (Date.now() < end) {
    try {
      // the nodes directly every round; our doorway (which asks them all again) only every 5th
      const r = await Promise.any((round++ % 5 === 4 ? ELY_RPC_LIST : DIRECT).map(ask));
      return { status: r.status === "0x1" ? "success" : "reverted", logs: r.logs ?? [] };
    } catch {}
    await new Promise((r) => setTimeout(r, 700));
  }
  throw new SlowTx(SLOW_HELP);
}
export async function wait(hash: Hex) {
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
export const track = (hash: Hex, token: string): SentTrade => {
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
    prepareSell(signer, p.token);
    return track(hash, t.address);
  } catch (e) {
    throw e instanceof TradeFail ? e : new TradeFail(nice(e));
  }
}

/**
 * Built-in wallet: right after a buy, give the router permission to sell this coin (one tiny transaction,
 * sent in the background, no pop-up). The later sale is then a single transaction, with no approval racing
 * ahead of it through nodes that are a few seconds behind. Failing here costs nothing: sell() approves itself.
 */
function prepareSell(signer: Signer, token: Address) {
  if (!signer.embedded || !ROUTER) return;
  (async () => {
    const allowed = await ely().readContract({ address: token, abi: ERC20, functionName: "allowance", args: [signer.address, ROUTER as Address] }).catch(() => null);
    if (allowed == null || allowed > MAX / 2n) return;
    await signer.sendTx!(ELY_CHAIN, { to: token, data: encodeFunctionData({ abi: ERC20, functionName: "approve", args: [ROUTER as Address, MAX] }), gas: 80_000n });
  })().catch(() => {});
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
/**
 * A coin launched in this browser a moment ago, built from its Launched event. The token page and the
 * Discover board show it at once, before the indexer (or a lagging node) knows it. Kept 15 minutes.
 */
export function savePending(t: EToken) {
  try {
    const all = JSON.parse(localStorage.getItem("ap_pending") || "{}") as Record<string, EToken & { _at: number }>;
    all[t.address.toLowerCase()] = { ...t, _at: Date.now() };
    localStorage.setItem("ap_pending", JSON.stringify(all));
  } catch {}
}
export function pendingTokens(): EToken[] {
  try {
    const all = JSON.parse(localStorage.getItem("ap_pending") || "{}") as Record<string, EToken & { _at: number }>;
    return Object.values(all).filter((t) => Date.now() - t._at < 15 * 60_000);
  } catch { return []; }
}
export const pendingToken = (a: string) => pendingTokens().find((t) => t.address.toLowerCase() === a.toLowerCase()) ?? null;
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
