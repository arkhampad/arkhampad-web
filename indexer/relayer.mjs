// ArkhamPad relayer: takes requests the user signed in the browser (buy, sell, launch,
// withdraw, promote, cancel, token approvals by signature) and sends them on-chain.
// The relayer pays the network gas in ETH; the router pays it back from the user's
// USDC (the fee the user signed). Users never need ETH.
//
// Env: RELAYER_KEY (the relayer wallet's private key), and the chain RPC env vars.
import fs from "node:fs";
import { createPublicClient, createWalletClient, http, encodeFunctionData, decodeErrorResult, decodeFunctionResult, getAddress, isAddress, isHex, parseSignature, nonceManager, keccak256, recoverTypedDataAddress, verifyTypedData } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { moderate } from "./moderation.mjs";
import { makeFees } from "./fees.mjs";
import { makeLimits, LIMITS } from "./limits.mjs";

const CHAINS = JSON.parse(fs.readFileSync(process.env.CHAINS_FILE || new URL("./chains.json", import.meta.url), "utf8"));
const log = (...a) => console.log(new Date().toISOString(), "relayer:", ...a);

const ROUTER_ABI = [
  { type: "function", name: "permit", stateMutability: "nonpayable", inputs: [{ name: "token", type: "address" }, { name: "owner", type: "address" }, { name: "value", type: "uint256" }, { name: "deadline", type: "uint256" }, { name: "v", type: "uint8" }, { name: "r", type: "bytes32" }, { name: "s", type: "bytes32" }], outputs: [] },
  { type: "function", name: "buy", stateMutability: "nonpayable", inputs: [{ name: "user", type: "address" }, { name: "curve", type: "address" }, { name: "usdcIn", type: "uint256" }, { name: "minCoinsOut", type: "uint256" }, { name: "fee", type: "uint256" }, { name: "sig", type: "tuple", components: [{ name: "deadline", type: "uint256" }, { name: "nonce", type: "uint256" }, { name: "signature", type: "bytes" }] }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "sell", stateMutability: "nonpayable", inputs: [{ name: "user", type: "address" }, { name: "curve", type: "address" }, { name: "coinAmount", type: "uint256" }, { name: "minUsdcOut", type: "uint256" }, { name: "fee", type: "uint256" }, { name: "sig", type: "tuple", components: [{ name: "deadline", type: "uint256" }, { name: "nonce", type: "uint256" }, { name: "signature", type: "bytes" }] }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "launch", stateMutability: "nonpayable", inputs: [{ name: "user", type: "address" }, { name: "l", type: "tuple", components: [{ name: "name", type: "string" }, { name: "symbol", type: "string" }, { name: "metadataURI", type: "string" }, { name: "lockSeconds", type: "uint256" }, { name: "feeMode", type: "uint8" }, { name: "launchUsdc", type: "uint256" }, { name: "minCoinsOut", type: "uint256" }] }, { name: "fee", type: "uint256" }, { name: "sig", type: "tuple", components: [{ name: "deadline", type: "uint256" }, { name: "nonce", type: "uint256" }, { name: "signature", type: "bytes" }] }], outputs: [{ type: "address" }, { type: "address" }] },
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
];
// Permissionless upkeep calls (no user signature; the relayer pays the gas).
const UPKEEP_ABI = [
  { type: "function", name: "settleCreatorFees", stateMutability: "nonpayable", inputs: [], outputs: [{ name: "used", type: "uint256" }] },
  { type: "function", name: "creatorFees", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "collectFees", stateMutability: "nonpayable", inputs: [{ name: "coin", type: "address" }], outputs: [{ type: "uint256" }, { type: "uint256" }] },
  { type: "function", name: "buyback", stateMutability: "nonpayable", inputs: [{ name: "coin", type: "address" }], outputs: [{ type: "uint256" }, { type: "uint256" }] },
  { type: "function", name: "isCurve", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "bool" }] },
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
    nets.set(c.chainId, { c, pub: createPublicClient({ chain, transport }), wallet: createWalletClient({ account, chain, transport }), router: getAddress(c.router), faucet: c.faucet ? getAddress(c.usdc) : null });
  }
  const faucetLast = new Map();
  let db = null;
  let notifier = null;
  let og = null;
  const upkeepLast = new Map();
  const dripLog = new Map(); // user -> [timestamps] for gas top-ups
  const fees = makeFees({ log });
  const limits = makeLimits({ log });
  fees.warm([...nets.values()]);
  log(`relayer ${account.address} on ${[...nets.values()].map((n) => n.c.name).join(", ")}`);

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
    const gas = fixedGas ?? ((await n.pub.estimateGas({ account: account.address, to, data })) * 12n) / 10n;
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
      if (n.c.approvals !== "gas") { const e = new Error("Not needed on this network."); e.status = 400; throw e; }
      const user = addr(body.user, "user"), token = addr(body.token, "token");
      const spender = body.spender === "ext" && n.c.extSwap ? getAddress(n.c.extSwap) : n.router;
      const ERC = [{ type: "function", name: "allowance", stateMutability: "view", inputs: [{ type: "address" }, { type: "address" }], outputs: [{ type: "uint256" }] }, { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] }];
      const [allow, bal, native, gasPrice] = await Promise.all([
        n.pub.readContract({ address: token, abi: ERC, functionName: "allowance", args: [user, spender] }),
        n.pub.readContract({ address: token, abi: ERC, functionName: "balanceOf", args: [user] }),
        n.pub.getBalance({ address: user }),
        n.pub.getGasPrice(),
      ]);
      if (allow >= 2n ** 128n) return { ok: true, already: true };
      if (bal === 0n) { const e = new Error("Nothing to approve yet."); e.status = 400; throw e; }
      const need = (gasPrice * 130_000n * 3n) / 2n; // one approve, with room
      if (native >= need) return { ok: true, already: true };
      const day = Date.now() - 86_400_000;
      const seen = (dripLog.get(user) ?? []).filter((t) => t > day);
      if (seen.length >= 6) { const e = new Error("Too many approvals today. Please try again tomorrow."); e.status = 429; throw e; }
      dripLog.set(user, [...seen, Date.now()]);
      const t0 = Date.now();
      const hash = await n.wallet.sendTransaction({ to: user, value: need - native, gas: 21_000n });
      await n.pub.waitForTransactionReceipt({ hash, pollingInterval: 150, timeout: 60_000 });
      log(`${n.c.name} gas top-up ${user} ${need - native} wei ${hash} (${Date.now() - t0}ms)`);
      return { hash, status: "success", logs: [] };
    } else if (kind === "settle" || kind === "collect" || kind === "buyback") {
      // Anyone can trigger these; they only move fees where the contracts say. One per coin a minute.
      const target = addr(kind === "settle" ? body.curve : body.coin, kind === "settle" ? "curve" : "coin");
      const key = `${n.c.chainId}:${kind}:${target}`;
      if (Date.now() - (upkeepLast.get(key) ?? 0) < 60_000) { const e = new Error("Already done a moment ago."); e.status = 429; throw e; }
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
    if (!opts.order && signedFee !== undefined) await fees.check(n, kind, big(signedFee, "fee"));
    // Volume limits (mainnet, first weeks): buys only.
    const D = 10 ** DEC(n);
    const buyUsd = kind === "buy" || kind === "poolBuy" ? Number(big(body.usdcIn, "usdcIn")) / D
      : kind === "launch" ? Number(big(body.launch?.launchUsdc ?? "0", "launchUsdc")) / D
      : kind === "extSwap" && body.swap?.isBuy === true ? Number(big(body.swap.amountIn, "amountIn")) / D : 0;
    if (buyUsd > 0) await limits.check(db, n, String(body.user ?? body.swap?.user ?? ""), buyUsd, [...nets.keys()]);
    const t0 = Date.now();
    const hash = await send(n, to, data, fixedGas);
    const t1 = Date.now();
    const rc = await n.pub.waitForTransactionReceipt({ hash, pollingInterval: 150, timeout: 60_000 });
    const t2 = Date.now();
    fees.record(n, kind, rc);
    if (kind === "extSwap" && buyUsd > 0 && rc.status === "success") limits.add(n, String(body.swap.user), buyUsd);
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
      await n.pub.waitForTransactionReceipt({ hash });
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
    const row = (await db.query("select creator from coins where chain_id=$1 and address=$2", [n.c.chainId, coin])).rows[0];
    if (!row) { const e = new Error("Coin not found yet. Try again in a few seconds."); e.status = 404; throw e; }
    if (!signer || signer.toLowerCase() !== row.creator) { const e = new Error("Only the creator can change the image."); e.status = 403; throw e; }
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
        const bal = await n.pub.readContract({ address: usdc, abi: [{ type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] }], functionName: "balanceOf", args: [account.address] });
        if (bal < amount) throw err("Payouts are being topped up. Please try again later.", 503);
        // record first (so a double tap can't pay twice), then send
        const ins = await db.query(`insert into ref_payouts (referrer, chain_id, amount) values ($1,$2,$3) returning id`, [user, n.c.chainId, Number(amount) / 10 ** DEC(n)]);
        try {
          const data = encodeFunctionData({ abi: [{ type: "function", name: "transfer", stateMutability: "nonpayable", inputs: [{ type: "address" }, { type: "uint256" }], outputs: [{ type: "bool" }] }], functionName: "transfer", args: [getAddress(user), amount] });
          const hash = await send(n, usdc, data, 120_000n);
          await n.pub.waitForTransactionReceipt({ hash, timeout: 60_000 });
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
  async function feeQuote(chainId, kind) {
    const n = nets.get(Number(chainId));
    if (!n) throw err("unsupported chain");
    const q = await fees.quote(n, String(kind));
    return { fee: String(q.raw / 10n ** BigInt(DEC(n) - 6)), usd: q.usd, busy: q.busy };
  }

  // Relayer gas: if its ETH (or BNB) runs low, every trade stops. Watched every 5 minutes;
  // the owner gets a bell + push alert (ALERT_WALLET) and the status page shows it.
  const LOW = { ETH: Number(process.env.LOW_GAS_ETH ?? 0.005), BNB: Number(process.env.LOW_GAS_BNB ?? 0.03) };
  const gasState = {};
  const warned = new Map();
  async function gasWatch() {
    for (const n of nets.values()) {
      try {
        const sym = n.c.native ?? "ETH";
        const bal = Number(await n.pub.getBalance({ address: account.address })) / 1e18;
        const low = bal < (LOW[sym] ?? LOW.ETH);
        gasState[n.c.name] = { balance: +bal.toFixed(6), symbol: sym, low, at: new Date().toISOString() };
        if (!low) { warned.delete(n.c.chainId); continue; }
        const last = warned.get(n.c.chainId) ?? 0;
        if (Date.now() - last < 6 * 3_600_000) continue;
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
  return { handle, config, feeQuote, health, graduate, saveImage, image, createOrder, listOrders, cancelOrder, setFollow, action, inbox, setNotifier: (x) => { notifier = x; }, setOg: (x) => { og = x; }, ogCard: (id) => (og ? og(id) : null), vapid: () => notifier?.publicKey ?? null, setDb: (pool) => { db = pool; } };
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
      try { res.setHeader("cache-control", "no-store"); return res.end(JSON.stringify(await relayer.feeQuote(q.get("chainId"), q.get("kind") || "buy"))); }
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
      try { return res.end(JSON.stringify(await relayer.inbox(q.get("user")))); }
      catch (e) { res.statusCode = 400; return res.end(JSON.stringify({ error: e.message })); }
    }
    if (url === "/orders" && req.method === "GET") {
      const q = new URL(req.url, "http://x").searchParams;
      try { return res.end(JSON.stringify(await relayer.listOrders(q.get("user")))); }
      catch (e) { res.statusCode = 400; return res.end(JSON.stringify({ error: e.message })); }
    }
    if ((url === "/orders" || url === "/orders/cancel" || url === "/follow" || url === "/action") && req.method === "POST") {
      const ip = String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim();
      if (limited(ip)) { res.statusCode = 429; return res.end(JSON.stringify({ error: "Too many requests, slow down." })); }
      let raw = "";
      for await (const ch of req) { raw += ch; if (raw.length > 20_000) { res.statusCode = 413; return res.end(JSON.stringify({ error: "too large" })); } }
      let body;
      try { body = JSON.parse(raw); } catch { res.statusCode = 400; return res.end(JSON.stringify({ error: "bad request" })); }
      try { return res.end(JSON.stringify(url === "/orders" ? await relayer.createOrder(body) : url === "/follow" ? await relayer.setFollow(body) : url === "/action" ? await relayer.action(body) : await relayer.cancelOrder(body))); }
      catch (e) { res.statusCode = e.status || 500; if (!e.status) log("order error", e.message); return res.end(JSON.stringify({ error: e.status ? e.message : "Something went wrong. Please try again." })); }
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
