// ArkhamPad relayer: takes requests the user signed in the browser (buy, sell, launch,
// withdraw, promote, cancel, token approvals by signature) and sends them on-chain.
// The relayer pays the network gas in ETH; the router pays it back from the user's
// USDC (the fee the user signed). Users never need ETH.
//
// Env: RELAYER_KEY (the relayer wallet's private key), and the chain RPC env vars.
import fs from "node:fs";
import { createPublicClient, createWalletClient, http, encodeFunctionData, decodeErrorResult, getAddress, isAddress, isHex, parseSignature, nonceManager } from "viem";
import { privateKeyToAccount } from "viem/accounts";

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
const MINT_ABI = [{ type: "function", name: "mint", stateMutability: "nonpayable", inputs: [{ name: "to", type: "address" }, { name: "amount", type: "uint256" }], outputs: [] }];

// What each error means for the person using the site.
const FRIENDLY = {
  Expired: "This request expired. Please try again.",
  NonceAlreadyUsed: "This request was already sent.",
  BadSignature: "Signature check failed. Please try again.",
  NotACurve: "Unknown coin.",
  FeeTooHigh: "This sale is too small to cover the network fee.",
  Slippage: "Price moved too much. Please try again.",
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
const feeOf = (b) => { const f = big(b.fee, "fee"); if (f < MIN_FEE) throw new Error("fee too low"); return f; };

export function makeRelayer() {
  const key = (process.env.RELAYER_KEY || "").trim();
  if (!key) return null;
  const account = privateKeyToAccount(key.startsWith("0x") ? key : `0x${key}`, { nonceManager });
  const nets = new Map();
  for (const c of CHAINS) {
    const rpc = (process.env[c.rpcEnv] || "").trim();
    if (!rpc || !c.router) continue;
    const chain = { id: c.chainId, name: c.name, nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [rpc] } } };
    const transport = http(rpc, { retryCount: 2, timeout: 20_000 });
    nets.set(c.chainId, { c, pub: createPublicClient({ chain, transport }), wallet: createWalletClient({ account, chain, transport }), router: getAddress(c.router), faucet: c.faucet ? getAddress(c.usdc) : null });
  }
  const faucetLast = new Map();
  log(`relayer ${account.address} on ${[...nets.values()].map((n) => n.c.name).join(", ")}`);

  async function send(n, to, data, fixedGas) {
    // Simulate first: a request that would fail never costs gas, and the user gets a clear reason.
    try {
      await n.pub.call({ account: account.address, to, data });
    } catch (e) {
      const raw = e?.cause?.data ?? e?.data ?? e?.cause?.cause?.data;
      let name = null;
      if (typeof raw === "string") { try { name = decodeErrorResult({ abi: ROUTER_ABI, data: raw }).errorName; } catch { /* unknown error */ } }
      const err = new Error(FRIENDLY[name] ?? "This request would fail. Please try again.");
      err.status = 400; err.code = name ?? "REVERT";
      throw err;
    }
    // router.permit swallows a failing permit on purpose, so gas estimation would happily
    // pick a limit where the permit runs out of gas: permits get a fixed, safe limit.
    const gas = fixedGas ?? ((await n.pub.estimateGas({ account: account.address, to, data })) * 12n) / 10n;
    const hash = await n.wallet.sendTransaction({ to, data, gas });
    return hash;
  }

  async function handle(body) {
    const n = nets.get(Number(body?.chainId));
    if (!n) { const e = new Error("unsupported chain"); e.status = 400; throw e; }
    const kind = body.kind;
    let to = n.router, data, fixedGas;
    if (kind === "permit") {
      const { r, s, v, yParity } = parseSignature(hex(body.signature, "signature"));
      data = encodeFunctionData({ abi: ROUTER_ABI, functionName: "permit", args: [addr(body.token, "token"), addr(body.owner, "owner"), big(body.value, "value"), big(body.deadline, "deadline"), Number(v ?? 27n + BigInt(yParity)), r, s] });
      fixedGas = 200_000n;
    } else if (kind === "buy") {
      data = encodeFunctionData({ abi: ROUTER_ABI, functionName: "buy", args: [addr(body.user, "user"), addr(body.curve, "curve"), big(body.usdcIn, "usdcIn"), big(body.minCoinsOut, "minCoinsOut"), feeOf(body), sigOf(body)] });
    } else if (kind === "sell") {
      data = encodeFunctionData({ abi: ROUTER_ABI, functionName: "sell", args: [addr(body.user, "user"), addr(body.curve, "curve"), big(body.coinAmount, "coinAmount"), big(body.minUsdcOut, "minUsdcOut"), feeOf(body), sigOf(body)] });
    } else if (kind === "poolBuy") {
      data = encodeFunctionData({ abi: ROUTER_ABI, functionName: "poolBuy", args: [addr(body.user, "user"), addr(body.coin, "coin"), big(body.usdcIn, "usdcIn"), big(body.minCoinsOut, "minCoinsOut"), feeOf(body), sigOf(body)] });
    } else if (kind === "poolSell") {
      data = encodeFunctionData({ abi: ROUTER_ABI, functionName: "poolSell", args: [addr(body.user, "user"), addr(body.coin, "coin"), big(body.coinAmount, "coinAmount"), big(body.minUsdcOut, "minUsdcOut"), feeOf(body), sigOf(body)] });
    } else if (kind === "launch") {
      const l = body.launch ?? {};
      const launch = { name: str(l.name, "name", 32), symbol: str(l.symbol, "symbol", 10), metadataURI: str(l.metadataURI ?? "", "metadataURI", 1200), lockSeconds: big(l.lockSeconds, "lockSeconds"), feeMode: Number(l.feeMode) === 1 ? 1 : 0, launchUsdc: big(l.launchUsdc, "launchUsdc"), minCoinsOut: big(l.minCoinsOut, "minCoinsOut") };
      data = encodeFunctionData({ abi: ROUTER_ABI, functionName: "launch", args: [addr(body.user, "user"), launch, feeOf(body), sigOf(body)] });
    } else if (kind === "withdraw") {
      data = encodeFunctionData({ abi: ROUTER_ABI, functionName: "withdraw", args: [addr(body.user, "user"), addr(body.to, "to"), big(body.amount, "amount"), feeOf(body), sigOf(body)] });
    } else if (kind === "promote") {
      data = encodeFunctionData({ abi: ROUTER_ABI, functionName: "promote", args: [addr(body.user, "user"), addr(body.coin, "coin"), big(body.coinChainId, "coinChainId"), Number(big(body.plan, "plan")), big(body.maxPrice, "maxPrice"), feeOf(body), sigOf(body)] });
    } else if (kind === "cancel") {
      data = encodeFunctionData({ abi: ROUTER_ABI, functionName: "cancel", args: [addr(body.user, "user"), big(body.nonce, "nonce"), hex(body.signature, "signature")] });
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
    const hash = await send(n, to, data, fixedGas);
    log(`${n.c.name} ${kind} ${hash}`);
    return { hash };
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

  function config() {
    return { relayer: account.address, minFee: String(MIN_FEE), chains: [...nets.values()].map((n) => ({ chainId: n.c.chainId, name: n.c.name, router: n.router, usdc: n.c.usdc, faucet: !!n.faucet })) };
  }
  return { handle, config, graduate };
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
    if (url === "/health" || url === "/") return res.end(JSON.stringify(status));
    if (!relayer) { res.statusCode = 503; return res.end(JSON.stringify({ error: "relayer off" })); }
    if (url === "/config") return res.end(JSON.stringify(relayer.config()));
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
