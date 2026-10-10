// ArkhamPad relayer: takes requests the user signed in the browser (buy, sell, launch,
// withdraw, promote, cancel, token approvals by signature) and sends them on-chain.
// The relayer pays the network gas in ETH; the router pays it back from the user's
// USDC (the fee the user signed). Users never need ETH.
//
// Env: RELAYER_KEY (the relayer wallet's private key), and the chain RPC env vars.
import fs from "node:fs";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { createPublicClient, createWalletClient, http, encodeFunctionData, decodeErrorResult, decodeFunctionResult, getAddress, isAddress, isHex, parseSignature, nonceManager, keccak256, recoverTypedDataAddress, verifyTypedData } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { moderate } from "./moderation.mjs";
import { makeFees } from "./fees.mjs";
import { makeLimits, LIMITS } from "./limits.mjs";

// Arbitrum-based chains: gas units include the L1 data cost.
const ARB_CHAINS = new Set([4663, 46630, 42161]);

const CHAINS = JSON.parse(fs.readFileSync(process.env.CHAINS_FILE || new URL("./chains.json", import.meta.url), "utf8"));
const log = (...a) => console.log(new Date().toISOString(), "relayer:", ...a);

const ROUTER_ABI = [
  { type: "function", name: "permit", stateMutability: "nonpayable", inputs: [{ name: "token", type: "address" }, { name: "owner", type: "address" }, { name: "value", type: "uint256" }, { name: "deadline", type: "uint256" }, { name: "v", type: "uint8" }, { name: "r", type: "bytes32" }, { name: "s", type: "bytes32" }], outputs: [] },
  { type: "function", name: "buy", stateMutability: "nonpayable", inputs: [{ name: "user", type: "address" }, { name: "curve", type: "address" }, { name: "usdcIn", type: "uint256" }, { name: "minCoinsOut", type: "uint256" }, { name: "fee", type: "uint256" }, { name: "sig", type: "tuple", components: [{ name: "deadline", type: "uint256" }, { name: "nonce", type: "uint256" }, { name: "signature", type: "bytes" }] }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "sell", stateMutability: "nonpayable", inputs: [{ name: "user", type: "address" }, { name: "curve", type: "address" }, { name: "coinAmount", type: "uint256" }, { name: "minUsdcOut", type: "uint256" }, { name: "fee", type: "uint256" }, { name: "sig", type: "tuple", components: [{ name: "deadline", type: "uint256" }, { name: "nonce", type: "uint256" }, { name: "signature", type: "bytes" }] }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "launch", stateMutability: "nonpayable", inputs: [{ name: "user", type: "address" }, { name: "l", type: "tuple", components: [{ name: "name", type: "string" }, { name: "symbol", type: "string" }, { name: "metadataURI", type: "string" }, { name: "lockSeconds", type: "uint256" }, { name: "feeMode", type: "uint8" }, { name: "launchUsdc", type: "uint256" }, { name: "minCoinsOut", type: "uint256" }] }, { name: "fee", type: "uint256" }, { name: "sig", type: "tuple", components: [{ name: "deadline", type: "uint256" }, { name: "nonce", type: "uint256" }, { name: "signature", type: "bytes" }] }], outputs: [{ type: "address" }] },
  { type: "function", name: "withdraw", stateMutability: "nonpayable", inputs: [{ name: "user", type: "address" }, { name: "to", type: "address" }, { name: "amount", type: "uint256" }, { name: "fee", type: "uint256" }, { name: "sig", type: "tuple", components: [{ name: "deadline", type: "uint256" }, { name: "nonce", type: "uint256" }, { name: "signature", type: "bytes" }] }], outputs: [] },
  { type: "function", name: "promote", stateMutability: "nonpayable", inputs: [{ name: "user", type: "address" }, { name: "coin", type: "address" }, { name: "coinChainId", type: "uint256" }, { name: "plan", type: "uint8" }, { name: "maxPrice", type: "uint256" }, { name: "fee", type: "uint256" }, { name: "sig", type: "tuple", components: [{ name: "deadline", type: "uint256" }, { name: "nonce", type: "uint256" }, { name: "signature", type: "bytes" }] }], outputs: [] },
  { type: "function", name: "poolBuy", stateMutability: "nonpayable", inputs: [{ name: "user", type: "address" }, { name: "coin", type: "address" }, { name: "usdcIn", type: "uint256" }, { name: "minCoinsOut", type: "uint256" }, { name: "fee", type: "uint256" }, { name: "sig", type: "tuple", components: [{ name: "deadline", type: "uint256" }, { name: "nonce", type: "uint256" }, { name: "signature", type: "bytes" }] }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "poolSell", stateMutability: "nonpayable", inputs: [{ name: "user", type: "address" }, { name: "coin", type: "address" }, { name: "coinAmount", type: "uint256" }, { name: "minUsdcOut", type: "uint256" }, { name: "fee", type: "uint256" }, { name: "sig", type: "tuple", components: [{ name: "deadline", type: "uint256" }, { name: "nonce", type: "uint256" }, { name: "signature", type: "bytes" }] }], outputs: [{ type: "uint256" }] },
  { type: "error", name: "NotGraduated", inputs: [] },
  { type: "function", name: "cancel", stateMutability: "nonpayable", inputs: [{ name: "user", type: "address" }, { name: "nonce", type: "uint256" }, { name: "signature", type: "bytes" }], outputs: [] },
  { type: "error", name: "Expired", inputs: [] }, { type: "error", name: "NonceAlreadyUsed", inputs: [] }, { type: "error", name: "BadSignature", inputs: [] },
  { type: "error", name: "NotACurve", inputs: [] }, { type: "error", name: "FeeTooHigh", inputs: [] }, { type: "error", name: "ZeroAddress", inputs: [] },
  { type: "error", name: "Slippage", inputs: [{ type: "uint256" }, { type: "uint256" }] },
  // errors that can bubble up from the curve, hub and coin
  { type: "error", name: "NotOpen", inputs: [] }, { type: "error", name: "BuysPaused", inputs: [] }, { type: "error", name: "NothingToDo", inputs: [] },
  { type: "error", name: "CreatorLocked", inputs: [{ type: "uint256" }] }, { type: "error", name: "BadName", inputs: [] }, { type: "error", name: "NotAllowed", inputs: [] },
  { type: "error", name: "ERC20InsufficientBalance", inputs: [{ type: "address" }, { type: "uint256" }, { type: "uint256" }] },
  { type: "error", name: "ERC20InsufficientAllowance", inputs: [{ type: "address" }, { type: "uint256" }, { type: "uint256" }] },
  // v2 (instant pools)
  { type: "error", name: "NoPool", inputs: [] }, { type: "error", name: "LaunchBuyTooSmall", inputs: [{ type: "uint256" }] },
];
// Permissionless upkeep calls (no user signature; the relayer pays the gas).
const UPKEEP_ABI = [
  { type: "function", name: "settleCreatorFees", stateMutability: "nonpayable", inputs: [], outputs: [{ name: "used", type: "uint256" }] },
  { type: "function", name: "creatorFees", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "collectFees", stateMutability: "nonpayable", inputs: [{ name: "coin", type: "address" }], outputs: [{ type: "uint256" }, { type: "uint256" }] },
  { type: "function", name: "buyback", stateMutability: "nonpayable", inputs: [{ name: "coin", type: "address" }], outputs: [{ type: "uint256" }, { type: "uint256" }] },
  { type: "function", name: "isCurve", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "isCoin", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "bool" }] },
];
// Automatic fee collection and referral payouts (see sweepFees).
const SWEEP_ABI = [
  { type: "function", name: "platformFees", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "creatorFees", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "claimPlatformFees", stateMutability: "nonpayable", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "settleCreatorFees", stateMutability: "nonpayable", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "collectFees", stateMutability: "nonpayable", inputs: [{ name: "coin", type: "address" }], outputs: [{ type: "uint256" }, { type: "uint256" }] },
];
const VAULT_ABI = [
  { type: "function", name: "leftToday", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "payReferral", stateMutability: "nonpayable", inputs: [{ name: "to", type: "address" }, { name: "amount", type: "uint256" }, { name: "ref", type: "bytes32" }], outputs: [] },
];
const MINT_ABI = [{ type: "function", name: "mint", stateMutability: "nonpayable", inputs: [{ name: "to", type: "address" }, { name: "amount", type: "uint256" }], outputs: [] }];

// What each error means for the person using the site.
const FRIENDLY = {
  Expired: "This request expired. Please try again.",
  NonceAlreadyUsed: "This request was already sent.",
  BadSignature: "Signature check failed. Please try again.",
  NotACurve: "Unknown coin.",
  FeeTooHigh: "This sale is too small to cover the network fee.",
  Slippage: "Price moved too much. Please try again.",
  SwapFailed: "The DEX couldn't fill this trade right now. Please try again.",
  TargetNotAllowed: "This route isn't supported. Please try again.",
  NotOpen: "Trading on this curve is closed (it graduated or is about to).",
  BuysPaused: "Buying is paused right now.",
  NothingToDo: "Amount is too small.",
  CreatorLocked: "Creator coins are locked for now.",
  BadName: "Name or ticker is not valid.",
  NotAllowed: "Not allowed right now.",
  NotGraduated: "This coin trades on its bonding curve, not in the pool yet.",
  NoPool: "This coin wasn't launched on ArkhamPad.",
  LaunchBuyTooSmall: "The first buy must be at least $5.",
  ERC20InsufficientBalance: "Not enough balance.",
  ERC20InsufficientAllowance: "Approval missing. Please try again.",
};

/** Minimum fee in USDC (6 decimals) per request; flat on testnets. */
const MIN_FEE = BigInt(process.env.RELAYER_MIN_FEE ?? 10_000); // $0.01
const FAUCET_AMOUNT = 100_000_000n; // 100 test USDC
const FAUCET_EVERY_MS = 3_600_000;

const big = (v, name) => {
  if (typeof v !== "string" && typeof v !== "number") throw new Error(`${name} missing`);
  const s = String(v);
  if (!/^\d{1,78}$/.test(s)) throw new Error(`${name} must be a whole number`);
  return BigInt(s);
};
const addr = (v, name) => { if (typeof v !== "string" || !isAddress(v)) throw new Error(`${name} is not an address`); return getAddress(v); };
const hex = (v, name) => { if (typeof v !== "string" || !isHex(v)) throw new Error(`${name} is not hex`); return v; };
const str = (v, name, max) => { if (typeof v !== "string" || v.length > max) throw new Error(`${name} too long`); return v; };
const sigOf = (b) => ({ deadline: big(b.deadline, "deadline"), nonce: big(b.nonce, "nonce"), signature: hex(b.signature, "signature") });
/** $0.01 in a network's dollar token (6 decimals for USDC/USDG, 18 on BNB). */
const DEC = (n) => n?.c?.usdDecimals ?? 6;
const minFeeOf = (n) => (n ? 10n ** BigInt(DEC(n) - 2) : MIN_FEE);
const feeOf = (b, n) => { const f = big(b.fee, "fee"); if (f < minFeeOf(n)) throw new Error("fee too low"); return f; };

const IMG_MAX = 200_000; // bytes of image data

// What the user signs for each kind of request (must match the router's EIP-712 types).
const F = (pairs) => pairs.map(([name, type]) => ({ name, type }));
const SIGNED = {
  buy: { primaryType: "Buy", fields: F([["user", "address"], ["curve", "address"], ["usdcIn", "uint256"], ["minCoinsOut", "uint256"], ["fee", "uint256"], ["nonce", "uint256"], ["deadline", "uint256"]]) },
  sell: { primaryType: "Sell", fields: F([["user", "address"], ["curve", "address"], ["coinAmount", "uint256"], ["minUsdcOut", "uint256"], ["fee", "uint256"], ["nonce", "uint256"], ["deadline", "uint256"]]) },
  poolBuy: { primaryType: "PoolBuy", fields: F([["user", "address"], ["coin", "address"], ["usdcIn", "uint256"], ["minCoinsOut", "uint256"], ["fee", "uint256"], ["nonce", "uint256"], ["deadline", "uint256"]]) },
  poolSell: { primaryType: "PoolSell", fields: F([["user", "address"], ["coin", "address"], ["coinAmount", "uint256"], ["minUsdcOut", "uint256"], ["fee", "uint256"], ["nonce", "uint256"], ["deadline", "uint256"]]) },
};
const CANCEL_TYPES = { Cancel: F([["user", "address"], ["nonce", "uint256"]]) };
// Coins from other DEXs (mainnet): PadExtSwap
const EXT_ABI = [{ type: "function", name: "swap", stateMutability: "nonpayable", inputs: [{ name: "s", type: "tuple", components: [
  { name: "user", type: "address" }, { name: "isBuy", type: "bool" }, { name: "coin", type: "address" }, { name: "amountIn", type: "uint256" }, { name: "minOut", type: "uint256" },
  { name: "target", type: "address" }, { name: "data", type: "bytes" }, { name: "fee", type: "uint256" }, { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint256" }, { name: "signature", type: "bytes" }] }], outputs: [{ type: "uint256" }] },
  { type: "error", name: "Slippage", inputs: [{ type: "uint256" }, { type: "uint256" }] }, { type: "error", name: "SwapFailed", inputs: [{ type: "bytes" }] },
  { type: "error", name: "TargetNotAllowed", inputs: [] }, { type: "error", name: "BadSignature", inputs: [] }, { type: "error", name: "Expired", inputs: [] }, { type: "error", name: "NonceAlreadyUsed", inputs: [] }];
const PERMIT_ABI = [{ type: "function", name: "permit", stateMutability: "nonpayable", inputs: [{ type: "address" }, { type: "address" }, { type: "uint256" }, { type: "uint256" }, { type: "uint8" }, { type: "bytes32" }, { type: "bytes32" }], outputs: [] }];
const CURVE_PRICE_ABI = [
  { type: "function", name: "vUsdc", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "vCoin", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
];
const QUOTE_POOL_ABI = [{ type: "function", name: "quotePool", stateMutability: "nonpayable", inputs: [{ type: "address" }, { type: "bool" }, { type: "uint256" }], outputs: [{ type: "uint256" }] }];
const ORDER_KINDS = { limit_buy: ["buy", "poolBuy"], take_profit: ["sell", "poolSell"], stop_loss: ["sell", "poolSell"] };
const MAX_OPEN_ORDERS = 20;
const IMAGE_TYPES = { CoinImage: [{ name: "coin", type: "address" }, { name: "imageHash", type: "bytes32" }] };

export function makeRelayer() {
  const key = (process.env.RELAYER_KEY || "").trim();
  if (!key) return null;
  const account = privateKeyToAccount(key.startsWith("0x") ? key : `0x${key}`, { nonceManager });
  const nets = new Map();
  for (const c of CHAINS) {
    // The relayer can use its own (faster, paid) RPC; the indexer keeps the one with big log ranges.
    const rpc = ((c.relayRpcEnv && process.env[c.relayRpcEnv]) || process.env[c.rpcEnv] || "").trim();
    if (!rpc || !c.router) continue;
    const chain = { id: c.chainId, name: c.name, nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [rpc] } } };
    const transport = http(rpc, { retryCount: 2, timeout: 20_000 });
    // read-only backups, used to look up receipts when the main RPC lags or forgets (BNB)
    const backups = (c.receiptRpcs ?? []).filter((u) => u !== rpc).map((u) => createPublicClient({ chain, transport: http(u, { retryCount: 0, timeout: 8_000 }) }));
    nets.set(c.chainId, { c, pub: createPublicClient({ chain, transport }), backups, wallet: createWalletClient({ account, chain, transport }), router: getAddress(c.router), faucet: c.faucet ? getAddress(c.usdc) : null });
  }
  const faucetLast = new Map();
  let db = null;
  let notifier = null;
  let og = null;
  const upkeepLast = new Map();
  const dripLog = new Map(); // user -> [timestamps] for gas top-ups
  const owed = new Map(); // `${chainId}:${user}` -> USDC still owed for an approval top-up
  const fees = makeFees({ log });
  const limits = makeLimits({ log });
  fees.warm([...nets.values()]);
  log(`relayer ${account.address} on ${[...nets.values()].map((n) => n.c.name).join(", ")}`);

  /**
   * Waits for a receipt by asking for it directly, again and again. viem's own waiter also reads
   * blocks, and a load-balanced public RPC (BNB) can answer from a node a block behind, which
   * fails the whole wait even though the transaction went through. Any error here = not yet.
   */
  async function waitRc(n, { hash, pollingInterval = 300, timeout = 60_000 }) {
    const end = Date.now() + timeout;
    // some public nodes never return a fresh receipt: ask the main RPC and the backups in turn
    const all = [n.pub, ...(n.backups ?? [])];
    for (let i = 0; ; i++) {
      const rc = await all[i % all.length].getTransactionReceipt({ hash }).catch(() => null);
      if (rc) return rc;
      if (Date.now() > end) throw new Error(`no receipt for ${hash} after ${Math.round(timeout / 1000)}s`);
      await new Promise((ok) => setTimeout(ok, Math.max(pollingInterval, 250)));
    }
  }

  async function send(n, to, data, fixedGas) {
    // Simulate first: a request that would fail never costs gas, and the user gets a clear reason.
    try {
      await n.pub.call({ account: account.address, to, data });
    } catch (e) {
      const raw = e?.cause?.data ?? e?.data ?? e?.cause?.cause?.data;
      let name = null;
      if (typeof raw === "string") { try { name = decodeErrorResult({ abi: ROUTER_ABI, data: raw }).errorName; } catch { try { name = decodeErrorResult({ abi: EXT_ABI, data: raw }).errorName; } catch { /* unknown error */ } } }
      const err = new Error(FRIENDLY[name] ?? "This request would fail. Please try again.");
      err.status = 400; err.code = name ?? "REVERT";
      throw err;
    }
    // router.permit swallows a failing permit on purpose, so gas estimation would happily
    // pick a limit where the permit runs out of gas: permits get a fixed, safe limit.
    let gas = fixedGas ?? ((await n.pub.estimateGas({ account: account.address, to, data })) * 12n) / 10n;
    // Arbitrum-based chains (Robinhood) count the L1 data cost inside the gas units, so a fixed
    // limit can be too small there: take the node's estimate (+30%) when it is higher.
    if (ARB_CHAINS.has(n.c.chainId) && fixedGas) {
      const est = await n.pub.estimateGas({ account: account.address, to, data }).catch(() => 0n);
      if ((est * 13n) / 10n > gas) gas = (est * 13n) / 10n;
    }
    // (simulation above already proved the call works; trades use a fixed, generous limit)
    const hash = await n.wallet.sendTransaction({ to, data, gas });
    return hash;
  }

  async function handle(body, opts = {}) {
    const n = nets.get(Number(body?.chainId));
    if (!n) { const e = new Error("unsupported chain"); e.status = 400; throw e; }
    const kind = body.kind;
    let to = n.router, data, fixedGas;
    if (kind === "permit") {
      const { r, s, v, yParity } = parseSignature(hex(body.signature, "signature"));
      data = encodeFunctionData({ abi: ROUTER_ABI, functionName: "permit", args: [addr(body.token, "token"), addr(body.owner, "owner"), big(body.value, "value"), big(body.deadline, "deadline"), Number(v ?? 27n + BigInt(yParity)), r, s] });
      fixedGas = 200_000n;
    } else if (kind === "buy") {
      fixedGas = 700_000n;
      data = encodeFunctionData({ abi: ROUTER_ABI, functionName: "buy", args: [addr(body.user, "user"), addr(body.curve, "curve"), big(body.usdcIn, "usdcIn"), big(body.minCoinsOut, "minCoinsOut"), feeOf(body, n), sigOf(body)] });
    } else if (kind === "sell") {
      fixedGas = 700_000n;
      data = encodeFunctionData({ abi: ROUTER_ABI, functionName: "sell", args: [addr(body.user, "user"), addr(body.curve, "curve"), big(body.coinAmount, "coinAmount"), big(body.minUsdcOut, "minUsdcOut"), feeOf(body, n), sigOf(body)] });
    } else if (kind === "poolBuy") {
      fixedGas = 900_000n;
      data = encodeFunctionData({ abi: ROUTER_ABI, functionName: "poolBuy", args: [addr(body.user, "user"), addr(body.coin, "coin"), big(body.usdcIn, "usdcIn"), big(body.minCoinsOut, "minCoinsOut"), feeOf(body, n), sigOf(body)] });
    } else if (kind === "poolSell") {
      fixedGas = 900_000n;
      data = encodeFunctionData({ abi: ROUTER_ABI, functionName: "poolSell", args: [addr(body.user, "user"), addr(body.coin, "coin"), big(body.coinAmount, "coinAmount"), big(body.minUsdcOut, "minUsdcOut"), feeOf(body, n), sigOf(body)] });
    } else if (kind === "launch") {
      const l = body.launch ?? {};
      // our name is ours: no coin may pose as ArkhamPad (or Arkham) on ArkhamPad
      if (/arkham/i.test(String(l.name ?? "")) || /arkham/i.test(String(l.symbol ?? ""))) { const e = new Error("Coins can't use the ArkhamPad name."); e.status = 400; throw e; }
      const launch = { name: str(l.name, "name", 32), symbol: str(l.symbol, "symbol", 10), metadataURI: str(l.metadataURI ?? "", "metadataURI", 1200), lockSeconds: big(l.lockSeconds, "lockSeconds"), feeMode: Number(l.feeMode) === 1 ? 1 : 0, launchUsdc: big(l.launchUsdc, "launchUsdc"), minCoinsOut: big(l.minCoinsOut, "minCoinsOut") };
      data = encodeFunctionData({ abi: ROUTER_ABI, functionName: "launch", args: [addr(body.user, "user"), launch, feeOf(body, n), sigOf(body)] });
    } else if (kind === "withdraw") {
      data = encodeFunctionData({ abi: ROUTER_ABI, functionName: "withdraw", args: [addr(body.user, "user"), addr(body.to, "to"), big(body.amount, "amount"), feeOf(body, n), sigOf(body)] });
    } else if (kind === "promote") {
      data = encodeFunctionData({ abi: ROUTER_ABI, functionName: "promote", args: [addr(body.user, "user"), addr(body.coin, "coin"), big(body.coinChainId, "coinChainId"), Number(big(body.plan, "plan")), big(body.maxPrice, "maxPrice"), feeOf(body, n), sigOf(body)] });
    } else if (kind === "cancel") {
      data = encodeFunctionData({ abi: ROUTER_ABI, functionName: "cancel", args: [addr(body.user, "user"), big(body.nonce, "nonce"), hex(body.signature, "signature")] });
    } else if (kind === "extSwap") {
      // coins from other DEXs; only on networks where PadExtSwap is deployed (mainnet)
      if (!n.c.extSwap) { const e = new Error("Trading coins from other DEXs opens on mainnet."); e.status = 400; throw e; }
      const w = body.swap ?? {};
      to = getAddress(n.c.extSwap);
      data = encodeFunctionData({ abi: EXT_ABI, functionName: "swap", args: [{ user: addr(w.user, "user"), isBuy: w.isBuy === true, coin: addr(w.coin, "coin"), amountIn: big(w.amountIn, "amountIn"), minOut: big(w.minOut, "minOut"), target: addr(w.target, "target"), data: hex(w.data, "data"), fee: feeOf(w, n), nonce: big(w.nonce, "nonce"), deadline: big(w.deadline, "deadline"), signature: hex(w.signature, "signature") }] });
      fixedGas = 1_500_000n;
    } else if (kind === "permitExt") {
      // EIP-2612 approval for PadExtSwap (USDC or a coin that supports permit)
      if (!n.c.extSwap) { const e = new Error("Not available on this network."); e.status = 400; throw e; }
      const { v, r, s: ss } = parseSignature(hex(body.signature, "signature"));
      to = addr(body.token, "token");
      data = encodeFunctionData({ abi: PERMIT_ABI, functionName: "permit", args: [addr(body.owner, "owner"), getAddress(n.c.extSwap), big(body.value, "value"), big(body.deadline, "deadline"), Number(v ?? 27n), r, ss] });
      fixedGas = 200_000n;
    } else if (kind === "gas") {
      // Networks whose dollar has no permit (BNB): give the user just enough gas for one approve.
      // BNB's dollar has no permit; on any network, coins from other DEXs often don't either.
      // "move": the user's own wallet sends a cross-chain cash move (approve + deposit) where the dollar has no EIP-3009
      const isMove = body.spender === "move";
      if (n.c.approvals !== "gas" && !(body.spender === "ext" && n.c.extSwap) && !isMove) { const e = new Error("Not needed on this network."); e.status = 400; throw e; }
      const user = addr(body.user, "user"), token = addr(body.token, "token");
      if (isMove && getAddress(token) !== getAddress(n.c.usdc)) { const e = new Error("Not needed for this token."); e.status = 400; throw e; }
      const dest = isMove ? nets.get(Number(body.dest)) : null;
      if (isMove && !dest) { const e = new Error("unsupported chain"); e.status = 400; throw e; }
      const spender = body.spender === "ext" && n.c.extSwap ? getAddress(n.c.extSwap) : n.router;
      const ERC = [{ type: "function", name: "allowance", stateMutability: "view", inputs: [{ type: "address" }, { type: "address" }], outputs: [{ type: "uint256" }] }, { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] }];
      const [allow, bal, native, gasPrice] = await Promise.all([
        n.pub.readContract({ address: token, abi: ERC, functionName: "allowance", args: [user, spender] }),
        n.pub.readContract({ address: token, abi: ERC, functionName: "balanceOf", args: [user] }),
        n.pub.getBalance({ address: user }),
        n.pub.getGasPrice(),
      ]);
      if (!isMove && allow >= 2n ** 128n) return { ok: true, already: true };
      if (bal === 0n) { const e = new Error("Nothing to approve yet."); e.status = 400; throw e; }
      // one approve with generous room: wallets bid above the current gas price, and on
      // OP-stack chains (Base) the L1 data fee comes on top. The user repays all of it.
      const l1 = [8453, 84532, 10].includes(n.c.chainId) ? 2_000_000_000_000n : 0n;
      // Arbitrum-based chains (Robinhood) put the L1 cost inside the gas units, so an approve needs more units
      const units = ARB_CHAINS.has(n.c.chainId) ? 400_000n : 130_000n;
      const need = (gasPrice * units * 4n + l1) * (isMove ? 2n : 1n); // a move is two transactions
      if (native >= need) return { ok: true, already: true };
      const day = Date.now() - 86_400_000;
      const seen = (dripLog.get(user) ?? []).filter((t) => t > day);
      if (seen.length >= 6) { const e = new Error("Too many approvals today. Please try again tomorrow."); e.status = 429; throw e; }
      dripLog.set(user, [...seen, Date.now()]);
      const t0 = Date.now();
      const hash = await n.wallet.sendTransaction({ to: user, value: need - native, ...(ARB_CHAINS.has(n.c.chainId) ? {} : { gas: 21_000n }) });
      const rc = await waitRc(n, { hash, pollingInterval: 150, timeout: 60_000 });
      // The user repays this (top-up + the transfer's own gas) in USDC with their next trade
      // from other DEXs: ArkhamPad never pays anyone's gas.
      const spentWei = (need - native) + rc.gasUsed * rc.effectiveGasPrice + (typeof rc.l1Fee === "bigint" ? rc.l1Fee : 0n);
      const usd = (Number(spentWei) / 1e18) * (await fees.nativeUsd(n.c.native ?? "ETH")) * 1.2;
      const owe = BigInt(Math.ceil(Math.max(usd, 0.001) * 1e6)) * 10n ** BigInt(DEC(n) - 6);
      if (body.spender === "ext") owed.set(`${n.c.chainId}:${user.toLowerCase()}`, (owed.get(`${n.c.chainId}:${user.toLowerCase()}`) ?? 0n) + owe);
      // a move's gas is repaid with the user's next trade on the chain the cash moved to
      if (isMove) { const k = `${dest.c.chainId}:${user.toLowerCase()}`; const o = (owe * 10n ** BigInt(DEC(dest))) / 10n ** BigInt(DEC(n)); owed.set(k, (owed.get(k) ?? 0n) + o); }
      log(`${n.c.name} gas top-up ${user} ${need - native} wei ${hash} (${Date.now() - t0}ms), owed ${owe}`);
      return { hash, status: "success", logs: [], owed: owe.toString() };
    } else if (kind === "settle" || kind === "collect" || kind === "buyback") {
      // Anyone can trigger these; they only move fees where the contracts say. One per coin a minute.
      const target = addr(kind === "settle" ? body.curve : body.coin, kind === "settle" ? "curve" : "coin");
      const key = `${n.c.chainId}:${kind}:${target}`;
      if (Date.now() - (upkeepLast.get(key) ?? 0) < 60_000) { const e = new Error("Already done a moment ago."); e.status = 429; throw e; }
      if (kind === "settle" && n.c.v2) {
        // v2 has no curve: the creator's share of pool fees is paid out by collect.
        const e = new Error("Creator fees are paid automatically when pool fees are collected."); e.status = 400; throw e;
      }
      if (kind === "settle") {
        const ok = await n.pub.readContract({ address: getAddress(n.c.hub), abi: UPKEEP_ABI, functionName: "isCurve", args: [target] });
        if (!ok) { const e = new Error("Unknown coin."); e.status = 400; throw e; }
        const fees = await n.pub.readContract({ address: target, abi: UPKEEP_ABI, functionName: "creatorFees" });
        if (fees < 10_000n) { const e = new Error("Nothing to claim yet."); e.status = 400; throw e; }
        to = target;
        data = encodeFunctionData({ abi: UPKEEP_ABI, functionName: "settleCreatorFees" });
      } else {
        if (!n.c.poolBuilder) { const e = new Error("Pools are not set up on this network."); e.status = 400; throw e; }
        to = getAddress(n.c.poolBuilder);
        data = encodeFunctionData({ abi: UPKEEP_ABI, functionName: kind === "collect" ? "collectFees" : "buyback", args: [target] });
        const sim = await n.pub.call({ account: account.address, to, data }).catch(() => null);
        const out = sim?.data ? decodeFunctionResult({ abi: UPKEEP_ABI, functionName: kind === "collect" ? "collectFees" : "buyback", data: sim.data }) : null;
        if (!out || (out[0] === 0n && out[1] === 0n)) { const e = new Error("Nothing to collect yet."); e.status = 400; throw e; }
      }
      upkeepLast.set(key, Date.now());
      fixedGas = 1_200_000n;
    } else if (kind === "faucet") {
      if (!n.faucet) { const e = new Error("no faucet on this network"); e.status = 400; throw e; }
      const who = addr(body.to, "to");
      const last = faucetLast.get(`${n.c.chainId}:${who}`) ?? 0;
      if (Date.now() - last < FAUCET_EVERY_MS) { const e = new Error("You can get test USDC once an hour."); e.status = 429; throw e; }
      faucetLast.set(`${n.c.chainId}:${who}`, Date.now());
      to = n.faucet;
      data = encodeFunctionData({ abi: MINT_ABI, functionName: "mint", args: [who, FAUCET_AMOUNT] });
    } else {
      const e = new Error("unknown request"); e.status = 400; throw e;
    }
    // Network fee: the signed fee must cover today's real cost (orders were signed earlier: skipped).
    const signedFee = kind === "extSwap" ? body.swap?.fee : body.fee;
    // an approval top-up still owed by this user is added on top of today's network fee
    const oweUser = kind === "extSwap" ? body.swap?.user : ["buy", "sell", "poolBuy", "poolSell", "launch", "promote", "withdraw"].includes(kind) ? body.user : null;
    const oweKey = oweUser ? `${n.c.chainId}:${String(oweUser).toLowerCase()}` : "";
    const owes = oweKey ? (owed.get(oweKey) ?? 0n) : 0n;
    if (!opts.order && signedFee !== undefined) await fees.check(n, kind, big(signedFee, "fee") - owes);
    // Volume limits (mainnet, first weeks): buys only.
    const D = 10 ** DEC(n);
    const buyUsd = kind === "buy" || kind === "poolBuy" ? Number(big(body.usdcIn, "usdcIn")) / D
      : kind === "launch" ? Number(big(body.launch?.launchUsdc ?? "0", "launchUsdc")) / D
      : kind === "extSwap" && body.swap?.isBuy === true ? Number(big(body.swap.amountIn, "amountIn")) / D : 0;
    if (buyUsd > 0) await limits.check(db, n, String(body.user ?? body.swap?.user ?? ""), buyUsd, [...nets.keys()]);
    const t0 = Date.now();
    const hash = await send(n, to, data, fixedGas);
    const t1 = Date.now();
    const rc = await waitRc(n, { hash, pollingInterval: 150, timeout: 60_000 });
    const t2 = Date.now();
    fees.record(n, kind, rc);
    if (kind === "extSwap" && buyUsd > 0 && rc.status === "success") limits.add(n, String(body.swap.user), buyUsd);
    if (rc.status === "success" && owes > 0n && kind !== "extSwap") owed.delete(oweKey);
    if (kind === "extSwap" && rc.status === "success") {
      if (owes > 0n) owed.delete(oweKey);
      if (db) db.query(`insert into ext_positions ("user", chain_id, coin) values ($1,$2,$3) on conflict ("user", chain_id, coin) do update set updated_at=now()`,
        [String(body.swap.user).toLowerCase(), n.c.chainId, String(body.swap.coin).toLowerCase()]).catch((e) => log(`ext_positions: ${e.message}`));
    }
    log(`${n.c.name} ${kind} ${hash} sent ${t1 - t0}ms mined ${t2 - t1}ms`);
    return {
      hash,
      status: rc.status,
      logs: rc.logs.map((l) => ({ address: l.address, data: l.data, topics: l.topics, logIndex: l.logIndex })),
      ms: { send: t1 - t0, mine: t2 - t1 },
    };
  }

  // Graduation keeper: anyone may call graduate() on a full curve; we do it at once.
  const GRAD_ABI = [{ type: "function", name: "graduate", stateMutability: "nonpayable", inputs: [], outputs: [] }];
  const graduating = new Set();
  async function graduate(chainId, curve) {
    const n = nets.get(Number(chainId));
    if (!n) return null;
    const key = `${chainId}:${curve.toLowerCase()}`;
    if (graduating.has(key)) return null;
    graduating.add(key);
    try {
      const hash = await send(n, getAddress(curve), encodeFunctionData({ abi: GRAD_ABI, functionName: "graduate" }));
      await waitRc(n, { hash });
      log(`${n.c.name} graduated ${curve} ${hash}`);
      return hash;
    } catch (e) {
      graduating.delete(key);
      throw e;
    }
  }

  /** Creator uploads a coin image, proven by a signature from the coin's creator wallet. */
  async function saveImage(body, publicBase) {
    if (!db) { const e = new Error("Images are not available right now."); e.status = 503; throw e; }
    const n = nets.get(Number(body?.chainId));
    if (!n) { const e = new Error("unsupported chain"); e.status = 400; throw e; }
    const coin = addr(body.coin, "coin").toLowerCase();
    const m = String(body.dataUrl || "").match(/^data:(image\/(?:webp|png|jpeg));base64,([A-Za-z0-9+/=]+)$/);
    if (!m) { const e = new Error("Use a PNG, JPG or WebP image."); e.status = 400; throw e; }
    const bytes = Buffer.from(m[2], "base64");
    if (bytes.length > IMG_MAX) { const e = new Error("Image is too large."); e.status = 413; throw e; }
    const imageHash = keccak256(bytes);
    const signer = await recoverTypedDataAddress({
      domain: { name: "ArkhamPad", version: "1", chainId: n.c.chainId, verifyingContract: n.router },
      types: IMAGE_TYPES, primaryType: "CoinImage", message: { coin: getAddress(coin), imageHash },
      signature: hex(body.signature, "signature"),
    }).catch(() => null);
    let creator = (await db.query("select creator from coins where chain_id=$1 and address=$2", [n.c.chainId, coin])).rows[0]?.creator;
    if (!creator) {
      // Right after launch the indexer may not have the coin yet: ask the coin itself who
      // created it. The image is stored now and attached when the coin is indexed.
      creator = await n.pub.readContract({ address: getAddress(coin), abi: [{ type: "function", name: "creator", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] }], functionName: "creator" })
        .then((a) => String(a).toLowerCase()).catch(() => null);
      if (!creator) { const e = new Error("Coin not found yet. Try again in a few seconds."); e.status = 404; throw e; }
    }
    if (!signer || signer.toLowerCase() !== creator) { const e = new Error("Only the creator can change the image."); e.status = 403; throw e; }
    await db.query(
      `insert into coin_images (chain_id, coin, mime, data, updated_at) values ($1,$2,$3,$4,now())
       on conflict (chain_id, coin) do update set mime=excluded.mime, data=excluded.data, updated_at=now()`,
      [n.c.chainId, coin, m[1], bytes],
    );
    const url = `${publicBase}/img/${n.c.chainId}-${coin}?v=${Date.now().toString(36)}`;
    await db.query("update coins set image_url=$3 where chain_id=$1 and address=$2", [n.c.chainId, coin, url]);
    log(`${n.c.name} image ${coin} ${bytes.length}b`);
    return { url };
  }

  /** Profile picture: signed by the wallet itself; stored like coin images (network 0 = profiles). */
  async function saveAvatar(body, publicBase) {
    if (!db) throw err("Not available right now.", 503);
    if (body?.action !== "profile.avatar") throw err("bad request");
    const user = await signedBy(body);
    const m = String(body.dataUrl || "").match(/^data:(image\/(?:webp|png|jpeg));base64,([A-Za-z0-9+/=]+)$/);
    if (!m) throw err("Use a PNG, JPG or WebP image.");
    const bytes = Buffer.from(m[2], "base64");
    if (bytes.length > IMG_MAX) throw err("Image is too large.", 413);
    if (keccak256(bytes) !== String(body.payload?.imageHash ?? "")) throw err("Image check failed. Please try again.");
    await db.query(
      `insert into coin_images (chain_id, coin, mime, data, updated_at) values (0,$1,$2,$3,now())
       on conflict (chain_id, coin) do update set mime=excluded.mime, data=excluded.data, updated_at=now()`,
      [user, m[1], bytes],
    );
    const url = `${publicBase}/img/0-${user}?v=${Date.now().toString(36)}`;
    await db.query("insert into profiles (wallet, avatar_url, updated_at) values ($1,$2,now()) on conflict (wallet) do update set avatar_url=excluded.avatar_url, updated_at=now()", [user, url]);
    log(`avatar ${user} ${bytes.length}b`);
    return { url };
  }

  async function image(id) {
    if (!db) return null;
    const mm = String(id).match(/^(\d+)-(0x[0-9a-f]{40})$/);
    if (!mm) return null;
    const r = await db.query("select mime, data from coin_images where chain_id=$1 and coin=$2", [Number(mm[1]), mm[2]]);
    return r.rows[0] ?? null;
  }

  // ---------------------------------------------------------------- automatic orders
  const err = (msg, status = 400) => { const e = new Error(msg); e.status = status; return e; };
  const domainOf = (n) => ({ name: "ArkhamPad", version: "1", chainId: n.c.chainId, verifyingContract: n.router });

  async function createOrder(body) {
    if (!db) throw err("Orders are not available right now.", 503);
    const n = nets.get(Number(body?.chainId));
    if (!n) throw err("unsupported chain");
    const kind = String(body.kind);
    const r = body.request ?? {};
    if (!ORDER_KINDS[kind] || !ORDER_KINDS[kind].includes(r.kind)) throw err("Unknown order type.");
    const venue = r.kind.startsWith("pool") ? "pool" : "curve";
    const user = addr(r.user, "user");
    const coin = addr(body.coin, "coin").toLowerCase();
    const triggerMc = Number(body.triggerMc);
    if (!Number.isFinite(triggerMc) || triggerMc <= 0 || triggerMc > 1e13) throw err("Pick a valid market cap.");
    const row = (await db.query("select curve from coins where chain_id=$1 and address=$2", [n.c.chainId, coin])).rows[0];
    if (!row) throw err("Unknown coin.");
    if (venue === "curve" && addr(r.curve, "curve").toLowerCase() !== row.curve) throw err("Order doesn't match this coin.");
    if (venue === "pool" && addr(r.coin, "coin").toLowerCase() !== coin) throw err("Order doesn't match this coin.");
    const dl = big(r.deadline, "deadline");
    const now = BigInt(Math.floor(Date.now() / 1000));
    if (dl < now + 60n || dl > now + 31n * 86400n) throw err("Order must last between a minute and a month.");
    feeOf(r, n);
    // the signature must really be the user's, for exactly these numbers
    const t = SIGNED[r.kind];
    const message = Object.fromEntries(t.fields.map((f) => [f.name, f.type === "address" ? getAddress(r[f.name]) : big(r[f.name], f.name)]));
    const ok = await verifyTypedData({ address: user, domain: domainOf(n), types: { [t.primaryType]: t.fields }, primaryType: t.primaryType, message, signature: hex(r.signature, "signature") }).catch(() => false);
    if (!ok) throw err("Signature check failed.");
    const open = (await db.query(`select count(*)::int n from orders where "user"=$1 and status='open'`, [user.toLowerCase()])).rows[0].n;
    if (open >= MAX_OPEN_ORDERS) throw err(`You can have up to ${MAX_OPEN_ORDERS} open orders.`);
    const amount = Number(r.kind.endsWith("uy") ? big(r.usdcIn, "usdcIn") : big(r.coinAmount, "coinAmount"));
    const res = await db.query(
      `insert into orders (chain_id, "user", coin, kind, venue, trigger_mc, amount, body, nonce, deadline)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,to_timestamp($10)) returning id`,
      [n.c.chainId, user.toLowerCase(), coin, kind, venue, triggerMc, amount, { ...r, chainId: n.c.chainId }, String(big(r.nonce, "nonce")), Number(dl)],
    ).catch((e) => { if (e.code === "23505") throw err("This order was already placed."); throw e; });
    log(`${n.c.name} order ${res.rows[0].id} ${kind} at $${triggerMc}`);
    return { id: String(res.rows[0].id) };
  }

  async function listOrders(user) {
    if (!db) return [];
    const u = addr(user, "user").toLowerCase();
    const { rows } = await db.query(
      `select id, chain_id, coin, kind, venue, trigger_mc, amount, nonce, status, note, tx_hash, created_at, deadline from orders where "user"=$1 order by created_at desc limit 100`, [u]);
    return rows.map((x) => ({ ...x, id: String(x.id), trigger_mc: Number(x.trigger_mc), amount: String(x.amount) }));
  }

  async function cancelOrder(body) {
    if (!db) throw err("Orders are not available right now.", 503);
    const o = (await db.query("select * from orders where id=$1", [String(body?.id ?? "0").replace(/\D/g, "") || "0"])).rows[0];
    if (!o) throw err("Order not found.", 404);
    if (o.status !== "open") return { status: o.status };
    const n = nets.get(o.chain_id);
    const signer = await recoverTypedDataAddress({ domain: domainOf(n), types: CANCEL_TYPES, primaryType: "Cancel", message: { user: getAddress(o.user), nonce: BigInt(o.nonce) }, signature: hex(body.signature, "signature") }).catch(() => null);
    if (!signer || signer.toLowerCase() !== o.user) throw err("Only the owner can cancel.", 403);
    // stop it on-chain too, so the signed order can never be used again
    try { await handle({ chainId: o.chain_id, kind: "cancel", user: o.user, nonce: o.nonce, signature: body.signature }); }
    catch (e) { if (e.code !== "NonceAlreadyUsed") throw e; }
    await db.query("update orders set status='cancelled', updated_at=now() where id=$1 and status='open'", [o.id]);
    return { status: "cancelled" };
  }

  async function marketCap(n, o) {
    if (o.venue === "curve") {
      const curve = getAddress(o.body.curve);
      const [v, t] = await Promise.all([
        n.pub.readContract({ address: curve, abi: CURVE_PRICE_ABI, functionName: "vUsdc" }),
        n.pub.readContract({ address: curve, abi: CURVE_PRICE_ABI, functionName: "vCoin" }),
      ]);
      return (Number(v) / 10 ** DEC(n)) / (Number(t) / 1e18) * 1e9;
    }
    // pool: what 1 coin sells for right now
    const { result } = await n.pub.simulateContract({ address: n.router, abi: QUOTE_POOL_ABI, functionName: "quotePool", args: [getAddress(o.coin), false, 10n ** 18n], account: account.address });
    return (Number(result) / 10 ** DEC(n)) * 1e9;
  }

  const inflight = new Set();
  async function orderTick() {
    if (!db) return;
    const { rows } = await db.query("select * from orders where status='open' order by created_at limit 300");
    const now = Date.now();
    const mcCache = new Map();
    for (const o of rows) {
      if (inflight.has(o.id)) continue;
      const n = nets.get(o.chain_id);
      if (!n) continue;
      if (new Date(o.deadline).getTime() <= now) { await db.query("update orders set status='expired', updated_at=now() where id=$1", [o.id]); continue; }
      const key = `${o.chain_id}:${o.coin}:${o.venue}`;
      let mc = mcCache.get(key);
      if (mc === undefined) { mc = await marketCap(n, o).catch(() => null); mcCache.set(key, mc); }
      if (mc === null) continue;
      const trig = Number(o.trigger_mc);
      const hit = o.kind === "take_profit" ? mc >= trig : mc <= trig;
      if (!hit) continue;
      inflight.add(o.id);
      try {
        const out = await handle(o.body, { order: true });
        await db.query("update orders set status='filled', tx_hash=$2, updated_at=now() where id=$1", [o.id, out.hash]);
        log(`${n.c.name} order ${o.id} ${o.kind} filled at mc $${mc.toFixed(0)} ${out.hash}`);
        const label = { limit_buy: "Limit buy", take_profit: "Take profit", stop_loss: "Stop loss" }[o.kind];
        notifier?.notify(o.user, { kind: "order", title: `${label} filled`, body: `Your order filled at about $${Math.round(mc).toLocaleString("en-US")} market cap.`, url: `/coin/?c=${o.chain_id}-${o.coin}` });
        if (o.kind !== "limit_buy") {
          // take profit + stop loss work as a pair: once one sells, the other is never sent
          const left = await n.pub.readContract({ address: getAddress(o.coin), abi: [{ type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] }], functionName: "balanceOf", args: [getAddress(o.user)] }).catch(() => null);
          if (left !== null) {
            await db.query(
              `update orders set status='cancelled', note='The other order already sold these coins.', updated_at=now()
               where "user"=$1 and coin=$2 and chain_id=$3 and status='open' and kind <> 'limit_buy' and amount > $4`,
              [o.user, o.coin, o.chain_id, left.toString()],
            );
          }
        }
        mcCache.delete(key); // the price just moved
      } catch (e) {
        const code = e.code || "";
        const final = { Expired: "expired", NonceAlreadyUsed: "cancelled", ERC20InsufficientBalance: "failed", ERC20InsufficientAllowance: "failed", NotOpen: "failed", NotGraduated: "failed", NotACurve: "failed", BadSignature: "failed" }[code];
        const note = code === "NotOpen" ? "The coin graduated. Set the order again." : code === "ERC20InsufficientBalance" ? "Not enough balance when it triggered." : e.message;
        if (final) await db.query("update orders set status=$2, note=$3, updated_at=now() where id=$1", [o.id, final, note]);
        if (final === "failed") notifier?.notify(o.user, { kind: "order", title: "Order couldn't fill", body: note, url: `/coin/?c=${o.chain_id}-${o.coin}` });
        else await db.query("update orders set tries=tries+1, note=$2, status=case when tries+1>=30 then 'failed' else status end, updated_at=now() where id=$1", [o.id, note]);
      } finally {
        inflight.delete(o.id);
      }
    }
  }
  let ticking = false;
  setInterval(async () => {
    if (ticking) return;
    ticking = true;
    try { await orderTick(); } catch (e) { log(`orders error: ${e.message}`); } finally { ticking = false; }
  }, Number(process.env.ORDER_TICK_MS ?? 4000));

  // ---------------------------------------------------------------- follows (signed by the follower)
  const FOLLOW_TYPES = { Follow: [{ name: "trader", type: "address" }, { name: "on", type: "bool" }, { name: "time", type: "uint256" }] };
  async function setFollow(body) {
    if (!db) throw err("Not available right now.", 503);
    const follower = addr(body?.follower, "follower").toLowerCase();
    const trader = addr(body?.trader, "trader").toLowerCase();
    if (follower === trader) throw err("You can't follow yourself.");
    const time = big(body.time, "time");
    if (Math.abs(Number(time) - Date.now() / 1000) > 600) throw err("Request expired, please try again.");
    const on = body.on === true;
    const signer = await recoverTypedDataAddress({ domain: { name: "ArkhamPad", version: "1" }, types: FOLLOW_TYPES, primaryType: "Follow", message: { trader: getAddress(trader), on, time }, signature: hex(body.signature, "signature") }).catch(() => null);
    if (!signer || signer.toLowerCase() !== follower) throw err("Signature check failed.", 403);
    if (on) {
      const n = (await db.query("select count(*)::int n from follows where follower=$1", [follower])).rows[0].n;
      if (n >= 500) throw err("You can follow up to 500 traders.");
      await db.query("insert into follows (follower, trader) values ($1,$2) on conflict do nothing", [follower, trader]);
    } else {
      await db.query("delete from follows where follower=$1 and trader=$2", [follower, trader]);
    }
    return { following: on };
  }

  // ---------------------------------------------------------------- price alerts, bell, push
  // Signed by the user: the action and a hash of its details, a few minutes old at most.
  const REQ_TYPES = { Request: [{ name: "action", type: "string" }, { name: "payload", type: "bytes32" }, { name: "time", type: "uint256" }] };
  async function signedBy(body) {
    const user = addr(body?.user, "user");
    const time = big(body.time, "time");
    if (Math.abs(Number(time) - Date.now() / 1000) > 600) throw err("Request expired, please try again.");
    const payload = keccak256(new TextEncoder().encode(JSON.stringify(body.payload ?? {})));
    const ok = await verifyTypedData({ address: user, domain: { name: "ArkhamPad", version: "1" }, types: REQ_TYPES, primaryType: "Request", message: { action: String(body.action), payload, time }, signature: hex(body.signature, "signature") }).catch(() => false);
    if (!ok) throw err("Signature check failed.", 403);
    return user.toLowerCase();
  }

  // ---- read sessions: a wallet signs once, then reads its private data (orders, inbox) with a token
  const SESSION_SECRET = createHash("sha256").update(`ap-session:${process.env.SESSION_SECRET || process.env.RELAYER_KEY || "dev"}`).digest();
  const SESSION_TTL = 24 * 3600;
  const mac = (msg) => createHmac("sha256", SESSION_SECRET).update(msg).digest("hex");
  async function session(body) {
    if (body?.action !== "session") throw err("bad request");
    const user = await signedBy(body);
    const exp = Math.floor(Date.now() / 1000) + SESSION_TTL;
    return { token: `${user}.${exp}.${mac(`${user}.${exp}`)}`, exp };
  }
  /** The wallet a read token belongs to, or an error. */
  function tokenUser(token) {
    const [user, exp, sig] = String(token || "").split(".");
    if (!user || !exp || !sig || !/^0x[0-9a-f]{40}$/.test(user)) throw err("Sign in again to see this.", 401);
    if (Number(exp) < Date.now() / 1000) throw err("Session expired. Sign in again.", 401);
    const want = Buffer.from(mac(`${user}.${exp}`), "hex"), got = Buffer.from(sig, "hex");
    if (want.length !== got.length || !timingSafeEqual(want, got)) throw err("Sign in again to see this.", 401);
    return user;
  }

  async function action(body) {
    if (!db) throw err("Not available right now.", 503);
    const user = await signedBy(body);
    const p = body.payload ?? {};
    switch (body.action) {
      case "alert.add": {
        const chainId = Number(p.chainId), target = Number(p.targetMc);
        const coin = addr(p.coin, "coin").toLowerCase();
        if (!(chainId > 0) || !(target > 0) || target > 1e13) throw err("Pick a valid market cap.");
        if (p.direction !== "above" && p.direction !== "below") throw err("Pick above or below.");
        const n = (await db.query(`select count(*)::int n from price_alerts where "user"=$1 and status='open'`, [user])).rows[0].n;
        if (n >= 50) throw err("You can have up to 50 price alerts.");
        const tick = String(p.tick ?? "").replace(/[^A-Za-z0-9$]/g, "").slice(0, 12) || "coin";
        const r = await db.query(`insert into price_alerts ("user", chain_id, coin, tick, direction, target_mc) values ($1,$2,$3,$4,$5,$6) returning id`, [user, chainId, coin, tick, p.direction, target]);
        return { id: String(r.rows[0].id) };
      }
      case "alert.delete":
        await db.query(`update price_alerts set status='deleted' where id=$1 and "user"=$2 and status='open'`, [String(p.id ?? "0").replace(/\D/g, "") || "0", user]);
        return { ok: true };
      case "push.subscribe": {
        const sub = p.subscription ?? {};
        if (typeof sub.endpoint !== "string" || !/^https:\/\//.test(sub.endpoint) || sub.endpoint.length > 1000 || !sub.keys?.p256dh || !sub.keys?.auth) throw err("Bad subscription.");
        await db.query(`insert into push_subs (endpoint, "user", keys) values ($1,$2,$3) on conflict (endpoint) do update set "user"=excluded."user", keys=excluded.keys`, [sub.endpoint, user, { p256dh: String(sub.keys.p256dh).slice(0, 200), auth: String(sub.keys.auth).slice(0, 100) }]);
        return { ok: true };
      }
      case "ref.set": {
        const referrer = addr(p.referrer, "referrer").toLowerCase();
        if (referrer === user) throw err("You can't invite yourself.");
        const first = (await db.query(`select min(ts) t from trades where trader=$1`, [user])).rows[0].t;
        if (first && Date.now() - new Date(first).getTime() > 7 * 86400_000) throw err("Invites only work for new accounts.");
        const r = await db.query(`insert into referrals ("user", referrer) values ($1,$2) on conflict do nothing`, [user, referrer]);
        return { linked: r.rowCount === 1 };
      }
      case "ref.claim": {
        const n = nets.get(Number(p.chainId));
        if (!n) throw err("unsupported chain");
        const row = (await db.query("select earned, paid from ref_earnings($1) where chain_id=$2", [user, n.c.chainId])).rows[0];
        const due = row ? Number(row.earned) - Number(row.paid) : 0;
        if (due < 1) throw err("You can claim from $1.00.");
        const amount = BigInt(Math.floor(due * 1e6)) * 10n ** BigInt(DEC(n) - 6);
        const usdc = getAddress(n.c.usdc);
        // with a fee vault, rewards come straight from the vault (within its daily limit)
        const vault = n.c.vault ? getAddress(n.c.vault) : null;
        if (vault) {
          const left = await n.pub.readContract({ address: vault, abi: VAULT_ABI, functionName: "leftToday" });
          if (left < amount) throw err("Today's payouts are done. Your reward is paid automatically tomorrow.", 503);
        } else {
          const bal = await n.pub.readContract({ address: usdc, abi: [{ type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] }], functionName: "balanceOf", args: [account.address] });
          if (bal < amount) throw err("Payouts are being topped up. Please try again later.", 503);
        }
        // record first (so a double tap can't pay twice), then send
        const ins = await db.query(`insert into ref_payouts (referrer, chain_id, amount) values ($1,$2,$3) returning id`, [user, n.c.chainId, Number(amount) / 10 ** DEC(n)]);
        try {
          const hash = vault
            ? await send(n, vault, encodeFunctionData({ abi: VAULT_ABI, functionName: "payReferral", args: [getAddress(user), amount, `0x${BigInt(ins.rows[0].id).toString(16).padStart(64, "0")}`] }))
            : await send(n, usdc, encodeFunctionData({ abi: [{ type: "function", name: "transfer", stateMutability: "nonpayable", inputs: [{ type: "address" }, { type: "uint256" }], outputs: [{ type: "bool" }] }], functionName: "transfer", args: [getAddress(user), amount] }), 120_000n);
          await waitRc(n, { hash, timeout: 60_000 });
          await db.query("update ref_payouts set tx_hash=$2 where id=$1", [ins.rows[0].id, hash]);
          log(`${n.c.name} referral payout ${user} $${(Number(amount) / 10 ** DEC(n)).toFixed(2)} ${hash}`);
          return { paid: Number(amount) / 10 ** DEC(n), hash };
        } catch (e) {
          await db.query("delete from ref_payouts where id=$1", [ins.rows[0].id]);
          throw err("Payout failed. Please try again.", 502);
        }
      }
      case "comment.add": {
        const n = nets.get(Number(p.chainId));
        if (!n) throw err("unsupported chain");
        const coin = addr(p.coin, "coin").toLowerCase();
        const body = String(p.body ?? "").replace(/[\u0000-\u0008\u000b-\u001f]/g, "").trim().slice(0, 280);
        if (body.length < 2) throw err("Write a little more.");
        if (/(https?:\/\/|www\.|t\.me\/|discord\.gg)/i.test(body)) throw err("Links aren't allowed in comments.");
        const coinRow = (await db.query("select creator from coins where chain_id=$1 and address=$2", [n.c.chainId, coin])).rows[0];
        if (!coinRow) throw err("Unknown coin.");
        const last = (await db.query(`select max(created_at) t from comments where "user"=$1`, [user])).rows[0].t;
        if (last && Date.now() - new Date(last).getTime() < 15_000) throw err("Slow down a little.", 429);
        const bal = await n.pub.readContract({ address: getAddress(coin), abi: [{ type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] }], functionName: "balanceOf", args: [getAddress(user)] });
        const isCreator = coinRow.creator === user;
        if (bal === 0n && !isCreator) throw err("Only holders can comment. Buy any amount to join the chat.", 403);
        const pct = Number(bal) / 1e18 / 1e9 * 100;
        // scams and spam are kept but hidden behind a notice (the writer still sees theirs)
        const mod = await moderate(body);
        const r = await db.query(`insert into comments (chain_id, coin, "user", body, holder_pct, hidden, hidden_reason) values ($1,$2,$3,$4,$5,$6,$7) returning id`, [n.c.chainId, coin, user, body, pct, mod.spam, mod.reason]);
        if (mod.spam) log(`comment ${r.rows[0].id} hidden: ${mod.reason}`);
        return { id: String(r.rows[0].id), hidden: mod.spam, reason: mod.reason };
      }
      case "comment.delete":
        await db.query(`update comments set deleted=true where id=$1 and "user"=$2`, [String(p.id ?? "0").replace(/\D/g, "") || "0", user]);
        return { ok: true };
      case "profile.name": {
        const name = String(p.name ?? "").trim();
        if (!/^[\p{L}\p{N}_.]{3,20}$/u.test(name)) throw err("Use 3-20 letters, numbers, dots or underscores.");
        if (/^(arkham|arkhampad|admin|support|team|official|mod|moderator|help|system)/i.test(name)) throw err("That name is reserved. Pick another one.");
        const taken = (await db.query("select wallet from profiles where lower(name)=lower($1) and wallet<>$2", [name, user])).rows[0];
        if (taken) throw err("That name is taken. Pick another one.", 409);
        await db.query("insert into profiles (wallet, name, updated_at) values ($1,$2,now()) on conflict (wallet) do update set name=excluded.name, updated_at=now()", [user, name]);
        return { name };
      }
      case "notes.read":
        await db.query(`update notifications set read=true where "user"=$1 and read=false`, [user]);
        return { ok: true };
      default:
        throw err("Unknown action.");
    }
  }

  async function inbox(user) {
    if (!db) return { notes: [], unread: 0, alerts: [] };
    const u = addr(user, "user").toLowerCase();
    const [notes, unread, alerts] = await Promise.all([
      db.query(`select id, kind, title, body, url, read, created_at from notifications where "user"=$1 order by created_at desc limit 50`, [u]),
      db.query(`select count(*)::int n from notifications where "user"=$1 and read=false`, [u]),
      db.query(`select id, chain_id, coin, tick, direction, target_mc, status, created_at, hit_at from price_alerts where "user"=$1 and status <> 'deleted' order by created_at desc limit 50`, [u]),
    ]);
    return { notes: notes.rows.map((r) => ({ ...r, id: String(r.id) })), unread: unread.rows[0].n, alerts: alerts.rows.map((r) => ({ ...r, id: String(r.id), target_mc: Number(r.target_mc) })) };
  }

  // checks every price alert against the latest market caps (our coins and coins from other DEXs)
  async function alertTick() {
    if (!db) return;
    const { rows } = await db.query(`
      select a.*, coalesce(c.mc_usd, e.mcap_usd, e.fdv_usd) as mc
      from price_alerts a
      left join coins c on c.chain_id = a.chain_id and c.address = a.coin
      left join ext_tokens e on e.chain_id = a.chain_id and e.address = a.coin
      where a.status = 'open' limit 1000`);
    for (const a of rows) {
      const mc = Number(a.mc);
      if (!(mc > 0)) continue;
      const hit = a.direction === "above" ? mc >= Number(a.target_mc) : mc <= Number(a.target_mc);
      if (!hit) continue;
      const done = await db.query(`update price_alerts set status='hit', hit_at=now() where id=$1 and status='open'`, [a.id]);
      if (!done.rowCount) continue;
      const fmt = (v) => (v >= 1e6 ? `$${(v / 1e6).toFixed(2)}M` : v >= 1e3 ? `$${(v / 1e3).toFixed(1)}K` : `$${v.toFixed(0)}`);
      notifier?.notify(a.user, { kind: "price", title: `${a.tick} is ${a.direction} ${fmt(Number(a.target_mc))}`, body: `${a.tick} market cap is now ${fmt(mc)}.`, url: `/coin/?c=${a.chain_id}-${a.coin}` });
    }
  }
  setInterval(() => { alertTick().catch((e) => log(`alerts error: ${e.message}`)); }, Number(process.env.ALERT_TICK_MS ?? 15_000));

  /** Live network fee for one kind of request, in site units (6-decimal dollars). */
  async function feeQuote(chainId, kind, user) {
    const n = nets.get(Number(chainId));
    if (!n) throw err("unsupported chain");
    const q = await fees.quote(n, String(kind));
    // an approval top-up this user still owes is repaid with their next trade from another DEX
    const owes = user && /^0x[0-9a-fA-F]{40}$/.test(user) ? (owed.get(`${n.c.chainId}:${user.toLowerCase()}`) ?? 0n) : 0n;
    return { fee: String(q.raw / 10n ** BigInt(DEC(n) - 6)), usd: q.usd, busy: q.busy, owed: String(owes / 10n ** BigInt(DEC(n) - 6)) };
  }

  // Relayer gas: if its ETH (or BNB) runs low, every trade stops. Watched every 5 minutes.
  // Users repay every transaction's gas in USDC (it lands in the fee vault), so when the relayer runs
  // low it refills itself: it takes a few dollars of those fees from the vault (the payer's daily
  // limit applies) and swaps them for the gas token through KyberSwap. The owner only gets an alert
  // (bell + push to ALERT_WALLET) when a refill didn't work and gas is really running out.
  // Alert levels: about a hundred transactions left on each network.
  const LOW_BY_CHAIN = { 8453: 0.001, 4663: 0.0006, 56: 0.004, 5042: 0.5 };
  const LOW = { ETH: Number(process.env.LOW_GAS_ETH ?? 0.001), BNB: Number(process.env.LOW_GAS_BNB ?? 0.004) };
  // refill when the balance falls under twice the alert level
  const REFILL_USD = Number(process.env.GAS_REFILL_USD ?? 10);
  const REFILL_PER_DAY = 3;
  const KYBER_SLUG = { 8453: "base", 4663: "robinhood", 56: "bsc", 5042: "arc" };
  const NATIVE = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
  const GAS_REF = "0x6761732d726566696c6c00000000000000000000000000000000000000000000"; // "gas-refill"
  const refills = new Map(); // chainId -> timestamps of today's refills
  const gasStarted = Date.now();
  const ERC20_MIN = [
    { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
    { type: "function", name: "allowance", stateMutability: "view", inputs: [{ type: "address" }, { type: "address" }], outputs: [{ type: "uint256" }] },
    { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ type: "address" }, { type: "uint256" }], outputs: [{ type: "bool" }] },
  ];
  async function refillGas(n) {
    const slug = KYBER_SLUG[n.c.chainId];
    if (!slug || !n.c.vault) return "no vault or swap route on this network";
    const day = Date.now() - 86_400_000;
    const done = (refills.get(n.c.chainId) ?? []).filter((t) => t > day);
    if (done.length >= REFILL_PER_DAY) return "daily refill limit reached";
    const vault = getAddress(n.c.vault), usdc = getAddress(n.c.usdc);
    const amount = BigInt(Math.round(REFILL_USD * 100)) * 10n ** BigInt(DEC(n) - 2);
    const [left, inVault] = await Promise.all([
      n.pub.readContract({ address: vault, abi: VAULT_ABI, functionName: "leftToday" }),
      n.pub.readContract({ address: usdc, abi: ERC20_MIN, functionName: "balanceOf", args: [vault] }),
    ]);
    if (inVault < amount || left < amount) return "not enough fees in the vault yet";
    refills.set(n.c.chainId, [...done, Date.now()]);
    // 1) fees from the vault to the relayer (shows on-chain as a payout with ref "gas-refill")
    const h1 = await send(n, vault, encodeFunctionData({ abi: VAULT_ABI, functionName: "payReferral", args: [account.address, amount, GAS_REF] }));
    await waitRc(n, { hash: h1, timeout: 60_000 });
    // Arc: USDC is the gas token itself, nothing to swap
    if (n.c.chainId === 5042) { log(`${n.c.name}: gas refilled with $${REFILL_USD} of collected fees`); return null; }
    // 2) swap them for the gas token through KyberSwap
    const head = { "x-client-id": "arkhampad", "content-type": "application/json" };
    const rr = await fetch(`https://aggregator-api.kyberswap.com/${slug}/api/v1/routes?tokenIn=${usdc}&tokenOut=${NATIVE}&amountIn=${amount}`, { headers: head, signal: AbortSignal.timeout(15_000) }).then((r) => r.json());
    const sum = rr?.data?.routeSummary, router = rr?.data?.routerAddress;
    if (!sum || !router) return "no swap route right now (the dollars stay in the relayer for the next try)";
    const b = await fetch(`https://aggregator-api.kyberswap.com/${slug}/api/v1/route/build`, { method: "POST", headers: head, body: JSON.stringify({ routeSummary: sum, sender: account.address, recipient: account.address, slippageTolerance: 100 }), signal: AbortSignal.timeout(15_000) }).then((r) => r.json());
    if (!b?.data?.data) return "swap build failed";
    const allow = await n.pub.readContract({ address: usdc, abi: ERC20_MIN, functionName: "allowance", args: [account.address, getAddress(router)] });
    if (allow < amount) {
      const ha = await send(n, usdc, encodeFunctionData({ abi: ERC20_MIN, functionName: "approve", args: [getAddress(router), 2n ** 256n - 1n] }));
      await waitRc(n, { hash: ha, timeout: 60_000 });
    }
    const h2 = await send(n, getAddress(router), b.data.data);
    const rc = await waitRc(n, { hash: h2, timeout: 60_000 });
    if (rc.status !== "success") return "swap failed on-chain";
    log(`${n.c.name}: gas refilled with $${REFILL_USD} of collected fees (${h2})`);
    return null;
  }
  const gasState = {};
  const warned = new Map();
  async function gasWatch() {
    for (const n of nets.values()) {
      try {
        const sym = n.c.native ?? "ETH";
        let bal = Number(await n.pub.getBalance({ address: account.address })) / 1e18;
        // testnet gas is almost free, so a much smaller balance lasts for thousands of trades
        const TESTNET = new Set([84532, 46630, 97, 11155111, 421614]);
        const min = TESTNET.has(n.c.chainId) ? Number(process.env.LOW_GAS_TESTNET ?? 0.0002) : (LOW_BY_CHAIN[n.c.chainId] ?? LOW[sym] ?? LOW.ETH);
        // getting low: refill from collected fees before it becomes a problem
        if (!TESTNET.has(n.c.chainId) && bal < min * 2) {
          const why = await refillGas(n).catch((e) => String(e.shortMessage || e.message).slice(0, 120));
          if (why) log(`${n.c.name}: gas refill skipped: ${why}`);
          else bal = Number(await n.pub.getBalance({ address: account.address })) / 1e18;
        }
        const low = bal < min;
        gasState[n.c.name] = { balance: +bal.toFixed(6), symbol: sym, low, alertBelow: min, at: new Date().toISOString() };
        if (!low) { warned.delete(n.c.chainId); continue; }
        const last = warned.get(n.c.chainId) ?? 0;
        // no alerts right after a restart (deploys restart the service): give the refill a chance first
        if (Date.now() - last < 6 * 3_600_000 || Date.now() - gasStarted < 15 * 60_000) continue;
        warned.set(n.c.chainId, Date.now());
        log(`LOW GAS on ${n.c.name}: ${bal.toFixed(5)} ${sym} left in ${account.address}`);
        const to = (process.env.ALERT_WALLET || "").trim().toLowerCase();
        if (to && notifier) notifier.notify(to, { kind: "system", title: `⚠️ Relayer gas low on ${n.c.name}`, body: `${bal.toFixed(5)} ${sym} left. Top up ${account.address} or trades will stop.`, url: "/" });
      } catch (e) { gasState[n.c.name] = { error: String(e.shortMessage || e.message).slice(0, 120), at: new Date().toISOString() }; }
    }
  }
  setTimeout(() => { gasWatch().catch(() => {}); }, 10_000);
  setInterval(() => { gasWatch().catch(() => {}); }, 300_000);
  const health = () => ({ address: account.address, gas: gasState, limits: LIMITS });

  function config() {
    return { relayer: account.address, minFee: String(MIN_FEE), vapidPublicKey: notifier?.publicKey ?? null, chains: [...nets.values()].map((n) => ({ chainId: n.c.chainId, name: n.c.name, router: n.router, usdc: n.c.usdc, usdDecimals: DEC(n), minFee: String(minFeeOf(n)), approvals: n.c.approvals ?? "permit", faucet: !!n.faucet })) };
  }
  /**
   * Every 30 minutes: move platform fees from every coin into the fee vault, pay creators their
   * share (or run their buyback), collect graduated pools' fees, and pay referral rewards from the
   * vault. Only amounts above a small minimum are touched, so gas never costs more than it moves.
   */
  let sweepRound = 0;
  async function sweepFees() {
    if (!db) return;
    sweepRound += 1;
    for (const n of nets.values()) {
      const one = 10n ** BigInt(DEC(n));
      const MIN_PLATFORM = 2n * one, MIN_CREATOR = one, MIN_POOL = 2n * one;
      // coins traded in the last 2 days every round; every coin once every 12 rounds (~6 h)
      const rows = (await db.query(
        sweepRound % 12 === 1
          ? "select address, curve, phase from coins where chain_id=$1"
          : "select c.address, c.curve, c.phase from coins c where c.chain_id=$1 and (exists (select 1 from trades t where t.chain_id=c.chain_id and t.coin=c.address and t.ts > now() - interval '2 days') or c.graduated_at > now() - interval '2 days')",
        [n.c.chainId],
      )).rows;
      let moved = 0;
      for (const r of rows) {
        try {
          // v1 coins had a bonding curve with its own fees; v2 coins store their pool id here instead
          if (/^0x[0-9a-fA-F]{40}$/.test(r.curve)) {
            const curve = getAddress(r.curve);
            const [plat, cre] = await Promise.all([
              n.pub.readContract({ address: curve, abi: SWEEP_ABI, functionName: "platformFees" }),
              n.pub.readContract({ address: curve, abi: SWEEP_ABI, functionName: "creatorFees" }),
            ]);
            if (plat >= MIN_PLATFORM) { await send(n, curve, encodeFunctionData({ abi: SWEEP_ABI, functionName: "claimPlatformFees" })); moved += 1; }
            if (cre >= MIN_CREATOR) { await send(n, curve, encodeFunctionData({ abi: SWEEP_ABI, functionName: "settleCreatorFees" })); moved += 1; }
          }
          if (Number(r.phase) === 2 && n.c.poolBuilder) {
            const pb = getAddress(n.c.poolBuilder), coin = getAddress(r.address);
            const sim = await n.pub.simulateContract({ account: account.address, address: pb, abi: SWEEP_ABI, functionName: "collectFees", args: [coin] }).catch(() => null);
            if (sim && sim.result?.[0] >= MIN_POOL) { await send(n, pb, encodeFunctionData({ abi: SWEEP_ABI, functionName: "collectFees", args: [coin] })); moved += 1; }
          }
        } catch (e) { log(`${n.c.name} sweep ${r.address}: ${e.message}`); }
      }
      if (moved) log(`${n.c.name}: fee sweep sent ${moved} transaction(s)`);
      await payReferrals(n).catch((e) => log(`${n.c.name} referral payouts: ${e.message}`));
    }
  }

  /** Referral rewards go out automatically from the fee vault ($1 minimum, vault's daily limit). */
  async function payReferrals(n) {
    if (!n.c.vault || !db) return;
    const vault = getAddress(n.c.vault);
    let left = await n.pub.readContract({ address: vault, abi: VAULT_ABI, functionName: "leftToday" });
    const refs = (await db.query("select distinct referrer from referrals")).rows.map((x) => x.referrer);
    for (const ref of refs) {
      const row = (await db.query("select earned, paid from ref_earnings($1) where chain_id=$2", [ref, n.c.chainId])).rows[0];
      const due = row ? Number(row.earned) - Number(row.paid) : 0;
      if (due < 1) continue;
      const amount = BigInt(Math.floor(due * 1e6)) * 10n ** BigInt(DEC(n) - 6);
      if (amount > left) { log(`${n.c.name}: referral payouts paused until tomorrow (vault daily limit)`); break; }
      // record first (a crash can't pay twice), then send
      const ins = await db.query("insert into ref_payouts (referrer, chain_id, amount) values ($1,$2,$3) returning id", [ref, n.c.chainId, Number(amount) / 10 ** DEC(n)]);
      try {
        const id = ins.rows[0].id;
        const hash = await send(n, vault, encodeFunctionData({ abi: VAULT_ABI, functionName: "payReferral", args: [getAddress(ref), amount, `0x${BigInt(id).toString(16).padStart(64, "0")}`] }));
        await waitRc(n, { hash, timeout: 60_000 });
        await db.query("update ref_payouts set tx_hash=$2 where id=$1", [id, hash]);
        left -= amount;
        log(`${n.c.name} referral paid ${ref} $${(Number(amount) / 10 ** DEC(n)).toFixed(2)} ${hash}`);
      } catch (e) {
        await db.query("delete from ref_payouts where id=$1", [ins.rows[0].id]);
        throw e;
      }
    }
  }

  // ---------------------------------------------------------------- cross-chain cash moves (Relay)
  // The site shows one USDC balance. When a trade needs cash on another chain, the user's own wallet
  // moves it through Relay (relay.link): a signed EIP-3009 authorization where the dollar supports it
  // (no gas at all), otherwise an approve + deposit sent from the user's wallet after a gas top-up.
  // Our API key stays here; 0.25% goes to the treasury as Relay's app fee.
  const RELAY_API = "https://api.relay.link";
  const RELAY_KEY = (process.env.RELAY_API_KEY || "").trim();
  const MOVE_FEE_TO = process.env.MOVE_FEE_TO || "0xd9D46EB26c9D753135683b7736FC2be097e7B099"; // treasury
  const MOVE_FEE_BPS = process.env.MOVE_FEE_BPS || "25";
  async function relayApi(path, init = {}) {
    const r = await fetch(RELAY_API + path, { ...init, headers: { "content-type": "application/json", ...(RELAY_KEY ? { "x-api-key": RELAY_KEY } : {}) }, signal: AbortSignal.timeout(15_000) });
    const j = await r.json().catch(() => null);
    if (!r.ok) {
      log(`relay.link ${path.split("?")[0]} ${r.status}: ${String(j?.message ?? "").slice(0, 200)}`);
      throw err(r.status === 400 && /amount|liquidity|route|small|large/i.test(String(j?.message)) ? "This amount can't be moved right now. Try a different amount." : "Couldn't move your cash right now. Please try again.", r.status >= 500 ? 502 : 400);
    }
    return j;
  }
  async function move(body) {
    const a = String(body?.action ?? "");
    if (a === "quote") {
      const from = nets.get(Number(body.from)), to = nets.get(Number(body.to));
      if (!from || !to || from === to) throw err("unsupported route");
      const user = addr(body.user, "user");
      const amount = big(body.amount, "amount"); // what must arrive, in the destination dollar's units
      if (amount <= 0n || Number(amount) / 10 ** DEC(to) > 5_000) throw err("amount out of range");
      const ask = (usePermit) => relayApi("/quote/v2", { method: "POST", body: JSON.stringify({
        user, recipient: user, refundTo: user,
        originChainId: from.c.chainId, destinationChainId: to.c.chainId,
        originCurrency: getAddress(from.c.usdc), destinationCurrency: getAddress(to.c.usdc),
        amount: String(amount), tradeType: "EXACT_OUTPUT", usePermit,
        appFees: [{ recipient: MOVE_FEE_TO, fee: MOVE_FEE_BPS }],
      }) });
      // gasless (EIP-3009) where the dollar supports it, otherwise approve + deposit from the user's wallet
      const q = await ask(true).catch(() => ask(false));
      const steps = Array.isArray(q?.steps) ? q.steps : [];
      return { requestId: steps[0]?.requestId ?? null, steps, amountIn: q?.details?.currencyIn?.amount ?? null };
    }
    if (a === "permit") {
      const sig = hex(body.signature, "signature");
      const post = body.post;
      if (!post || post.endpoint !== "/execute/permits" || typeof post.body !== "object") throw err("bad request");
      return relayApi(`/execute/permits?signature=${sig}`, { method: "POST", body: JSON.stringify(post.body) });
    }
    if (a === "status") {
      const id = String(body.requestId ?? "");
      if (!/^0x[0-9a-fA-F]{64}$/.test(id)) throw err("bad request");
      return relayApi(`/intents/status/v3?requestId=${id}`);
    }
    throw err("unknown request");
  }

  return { handle, move, config, feeQuote, health, graduate, saveImage, saveAvatar, sweepFees, image, createOrder, listOrders, cancelOrder, setFollow, action, inbox, session, tokenUser, setNotifier: (x) => { notifier = x; }, setOg: (x) => { og = x; }, ogCard: (id) => (og ? og(id) : null), vapid: () => notifier?.publicKey ?? null, setDb: (pool) => { db = pool; } };
}

// ---------------------------------------------------------------- HTTP (shared with the health check)
const ORIGINS = [/^https:\/\/(www\.)?arkhampad\.com$/, /^https:\/\/([a-z0-9-]+\.)?arkhampad-web\.pages\.dev$/, /^http:\/\/localhost(:\d+)?$/, /^http:\/\/127\.0\.0\.1(:\d+)?$/];
const hits = new Map();
function limited(ip) {
  const now = Date.now();
  const h = (hits.get(ip) ?? []).filter((t) => now - t < 60_000);
  h.push(now);
  hits.set(ip, h);
  return h.length > 60; // 60 requests a minute per IP
}

export function httpHandler(relayer, status) {
  return async (req, res) => {
    const origin = req.headers.origin || "";
    if (ORIGINS.some((r) => r.test(origin))) {
      res.setHeader("access-control-allow-origin", origin);
      res.setHeader("vary", "origin");
      res.setHeader("access-control-allow-headers", "content-type");
      res.setHeader("access-control-allow-methods", "GET, POST, OPTIONS");
    }
    res.setHeader("content-type", "application/json");
    if (req.method === "OPTIONS") { res.statusCode = 204; return res.end(); }
    const url = (req.url || "/").split("?")[0];
    if (url === "/health" || url === "/") return res.end(JSON.stringify(relayer ? { ...status, relayer: relayer.health() } : status));
    if (!relayer) { res.statusCode = 503; return res.end(JSON.stringify({ error: "relayer off" })); }
    if (url === "/config") return res.end(JSON.stringify(relayer.config()));
    if (url === "/fee" && req.method === "GET") {
      const q = new URL(req.url, "http://x").searchParams;
      try { res.setHeader("cache-control", "no-store"); return res.end(JSON.stringify(await relayer.feeQuote(q.get("chainId"), q.get("kind") || "buy", q.get("user")))); }
      catch (e) { res.statusCode = e.status || 500; return res.end(JSON.stringify({ error: e.status ? e.message : "fee unavailable" })); }
    }
    if (url.startsWith("/img/") && req.method === "GET") {
      const img = await relayer.image(url.slice(5)).catch(() => null);
      if (!img) { res.statusCode = 404; return res.end(JSON.stringify({ error: "not found" })); }
      res.setHeader("content-type", img.mime);
      res.setHeader("access-control-allow-origin", "*");
      res.setHeader("cache-control", "public, max-age=31536000, immutable"); // the URL changes with every new image
      return res.end(img.data);
    }
    if (url.startsWith("/og/coin/") && req.method === "GET") {
      // link preview image for a coin page
      const png = await relayer.ogCard(url.slice(9).replace(/\.png$/, "")).catch(() => null);
      if (!png) { res.statusCode = 404; return res.end(JSON.stringify({ error: "not found" })); }
      res.setHeader("content-type", "image/png");
      res.setHeader("access-control-allow-origin", "*");
      res.setHeader("cache-control", "public, max-age=300");
      return res.end(png);
    }
    if (url === "/inbox" && req.method === "GET") {
      const q = new URL(req.url, "http://x").searchParams;
      // private: only the wallet's own session token can read it
      try { return res.end(JSON.stringify(await relayer.inbox(relayer.tokenUser(q.get("token"))))); }
      catch (e) { res.statusCode = e.status || 400; return res.end(JSON.stringify({ error: e.message })); }
    }
    if (url === "/orders" && req.method === "GET") {
      const q = new URL(req.url, "http://x").searchParams;
      try { return res.end(JSON.stringify(await relayer.listOrders(relayer.tokenUser(q.get("token"))))); }
      catch (e) { res.statusCode = e.status || 400; return res.end(JSON.stringify({ error: e.message })); }
    }
    if ((url === "/orders" || url === "/orders/cancel" || url === "/follow" || url === "/action" || url === "/session") && req.method === "POST") {
      const ip = String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim();
      if (limited(ip)) { res.statusCode = 429; return res.end(JSON.stringify({ error: "Too many requests, slow down." })); }
      let raw = "";
      for await (const ch of req) { raw += ch; if (raw.length > 20_000) { res.statusCode = 413; return res.end(JSON.stringify({ error: "too large" })); } }
      let body;
      try { body = JSON.parse(raw); } catch { res.statusCode = 400; return res.end(JSON.stringify({ error: "bad request" })); }
      try { return res.end(JSON.stringify(url === "/orders" ? await relayer.createOrder(body) : url === "/follow" ? await relayer.setFollow(body) : url === "/action" ? await relayer.action(body) : url === "/session" ? await relayer.session(body) : await relayer.cancelOrder(body))); }
      catch (e) { res.statusCode = e.status || 500; if (!e.status) log("order error", e.message); return res.end(JSON.stringify({ error: e.status ? e.message : "Something went wrong. Please try again." })); }
    }
    if (url === "/avatar" && req.method === "POST") {
      const ip = String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim();
      if (limited(ip)) { res.statusCode = 429; return res.end(JSON.stringify({ error: "Too many requests, slow down." })); }
      let raw = "";
      for await (const ch of req) { raw += ch; if (raw.length > 400_000) { res.statusCode = 413; return res.end(JSON.stringify({ error: "Image is too large." })); } }
      let body;
      try { body = JSON.parse(raw); } catch { res.statusCode = 400; return res.end(JSON.stringify({ error: "bad request" })); }
      const base = `${String(req.headers["x-forwarded-proto"] || "http").split(",")[0]}://${req.headers.host}`;
      try { return res.end(JSON.stringify(await relayer.saveAvatar(body, base))); }
      catch (e) { res.statusCode = e.status || 500; return res.end(JSON.stringify({ error: e.status ? e.message : "Upload failed, please try again." })); }
    }
    if (url === "/image" && req.method === "POST") {
      const ip = String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim();
      if (limited(ip)) { res.statusCode = 429; return res.end(JSON.stringify({ error: "Too many requests, slow down." })); }
      let raw = "";
      for await (const ch of req) { raw += ch; if (raw.length > 400_000) { res.statusCode = 413; return res.end(JSON.stringify({ error: "Image is too large." })); } }
      let body;
      try { body = JSON.parse(raw); } catch { res.statusCode = 400; return res.end(JSON.stringify({ error: "bad request" })); }
      const base = `${String(req.headers["x-forwarded-proto"] || "http").split(",")[0]}://${req.headers.host}`; // Railway sends https
      try { return res.end(JSON.stringify(await relayer.saveImage(body, base))); }
      catch (e) { res.statusCode = e.status || 500; return res.end(JSON.stringify({ error: e.status ? e.message : "Upload failed, please try again." })); }
    }
    if (url === "/move" && req.method === "POST") {
      const ip = String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim();
      if (limited(ip)) { res.statusCode = 429; return res.end(JSON.stringify({ error: "Too many requests, slow down." })); }
      let raw = "";
      for await (const ch of req) { raw += ch; if (raw.length > 20_000) { res.statusCode = 413; return res.end(JSON.stringify({ error: "too large" })); } }
      let body;
      try { body = JSON.parse(raw); } catch { res.statusCode = 400; return res.end(JSON.stringify({ error: "bad request" })); }
      try { res.setHeader("cache-control", "no-store"); return res.end(JSON.stringify(await relayer.move(body))); }
      catch (e) { res.statusCode = e.status || 500; if (!e.status) log("move error", e.message); return res.end(JSON.stringify({ error: e.status ? e.message : "Couldn't move your cash right now. Please try again." })); }
    }
    if (url === "/relay" && req.method === "POST") {
      const ip = String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim();
      if (limited(ip)) { res.statusCode = 429; return res.end(JSON.stringify({ error: "Too many requests, slow down." })); }
      let raw = "";
      for await (const ch of req) { raw += ch; if (raw.length > 20_000) { res.statusCode = 413; return res.end(JSON.stringify({ error: "too large" })); } }
      let body;
      try { body = JSON.parse(raw); } catch { res.statusCode = 400; return res.end(JSON.stringify({ error: "bad request" })); }
      try {
        const out = await relayer.handle(body);
        return res.end(JSON.stringify(out));
      } catch (e) {
        res.statusCode = e.status || (/must be|missing|not an address|not hex|too long|too low/.test(e.message) ? 400 : 500);
        if (res.statusCode >= 500) log("error", e.shortMessage || e.message);
        return res.end(JSON.stringify({ error: res.statusCode >= 500 ? "Network busy, please try again." : e.message, code: e.code }));
      }
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ error: "not found" }));
  };
}
