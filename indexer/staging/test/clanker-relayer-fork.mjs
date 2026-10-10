// End-to-end check of the REAL relayer code for Clanker launches, on a local copy (anvil fork) of
// the chain. Nothing touches the real chain. Run by .github/workflows/clanker-fork.yml:
//   anvil --fork-url $RPC &  CHAIN_ID=8453 node test/clanker-relayer-fork.mjs
// What it does, exactly like the site:
//   1. a user with only USDC (no ETH needed for the launch) signs the payment (router Withdraw)
//   2. relayer.clankerLaunch(): the user pays first buy + network fee in USDC, the coin is created
//      on Clanker, and the first buy's coins land in the user's wallet
//   3. a launch that fails after the payment gives the user's first buy back (refund)
//   4. trading happens, then the creator claims their WETH/WBNB rewards with a signed payment
//   5. the indexer's trade math turns the pool's Swap events into sensible dollar numbers
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createPublicClient, createTestClient, createWalletClient, http, decodeEventLog, encodeAbiParameters, encodeFunctionData, keccak256, getAddress, maxUint256, parseEther, formatEther, formatUnits, parseAbiItem, pad, toHex } from "viem";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";

const CHAIN_ID = Number(process.env.CHAIN_ID || 8453);
const RPC = process.env.ANVIL_URL || "http://127.0.0.1:8545";
const NATIVE = CHAIN_ID === 56 ? "BNB" : "ETH";
const PUBLIC_URL = "https://img.example.test";

// the relayer reads its chain list from CHAINS_FILE: the real mainnet entry, pointed at the fork
const mainnet = JSON.parse(fs.readFileSync(new URL("../chains.mainnet.json", import.meta.url), "utf8"));
const entry = mainnet.find((c) => c.chainId === CHAIN_ID);
if (!entry) throw new Error(`no chain ${CHAIN_ID} in chains.mainnet.json`);
const forkEntry = { ...entry, rpcEnv: "FORK_RPC", relayRpcEnv: "FORK_RPC", receiptRpcs: [] };
const file = path.join(os.tmpdir(), `chains-fork-${CHAIN_ID}.json`);
fs.writeFileSync(file, JSON.stringify([forkEntry]));
const relayerKey = generatePrivateKey();
Object.assign(process.env, { CHAINS_FILE: file, FORK_RPC: RPC, RELAYER_KEY: relayerKey, PUBLIC_URL, CLANKER_FLOAT_USD: "0", FEE_MAX_USD: "100000", LIMITS_ON: "off" });
const { makeRelayer } = await import("../relayer.mjs");
const priceGuard = await import("../priceguard.mjs");
const quality = await import("../quality.mjs");
const { clankerOf, lockersOf, TOKEN_CREATED } = await import("../clanker.mjs");
const { clankerTrade } = await import("../poolmath.mjs");

const chain = { id: CHAIN_ID, name: `fork-${CHAIN_ID}`, nativeCurrency: { name: NATIVE, symbol: NATIVE, decimals: 18 }, rpcUrls: { default: { http: [RPC] } } };
const transport = http(RPC, { timeout: 120_000 });
const pub = createPublicClient({ chain, transport });
const test = createTestClient({ chain, transport, mode: "anvil" });
const userAcc = privateKeyToAccount(generatePrivateKey());
const trader = privateKeyToAccount(generatePrivateKey());
const relayerAddr = privateKeyToAccount(relayerKey).address;
const wUser = createWalletClient({ chain, transport, account: userAcc });
const wTrader = createWalletClient({ chain, transport, account: trader });
const USDC = getAddress(entry.usdc), ROUTER = getAddress(entry.router), DEC = entry.usdDecimals ?? 6;
const UR = getAddress({ 8453: "0x6ff5693b99212da76ad316178a184ab56d299b43", 56: "0x1906c1d672b88cd1b9ac7593301ca990f94eae07", 4663: "0x8876789976decbfcbbbe364623c63652db8c0904" }[CHAIN_ID]);
const PERMIT2 = "0x000000000022D473030F116dDEE9F6B43aC78BA3";
const k = clankerOf(CHAIN_ID);

const ERC20 = [
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ type: "address" }, { type: "uint256" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "deposit", stateMutability: "payable", inputs: [], outputs: [] },
];
const PERMIT2_ABI = [{ type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ type: "address" }, { type: "address" }, { type: "uint160" }, { type: "uint48" }], outputs: [] }];
const UR_ABI = [{ type: "function", name: "execute", stateMutability: "payable", inputs: [{ type: "bytes" }, { type: "bytes[]" }, { type: "uint256" }], outputs: [] }];
const POOLKEY = { type: "tuple", components: [{ name: "currency0", type: "address" }, { name: "currency1", type: "address" }, { name: "fee", type: "uint24" }, { name: "tickSpacing", type: "int24" }, { name: "hooks", type: "address" }] };
const LOCKER_ABI = [{ type: "function", name: "tokenRewards", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "tuple", components: [
  { name: "token", type: "address" }, { name: "poolKey", ...POOLKEY }, { name: "positionId", type: "uint256" }, { name: "numPositions", type: "uint256" }, { name: "rewardBps", type: "uint16[]" }, { name: "rewardAdmins", type: "address[]" }, { name: "rewardRecipients", type: "address[]" }] }] },
  { type: "function", name: "collectRewards", stateMutability: "nonpayable", inputs: [{ type: "address" }], outputs: [] }];
const SWAP_EV = parseAbiItem("event Swap(bytes32 indexed id, address indexed sender, int128 amount0, int128 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick, uint24 fee)");
const WITHDRAW_TYPES = { Withdraw: [["user", "address"], ["to", "address"], ["amount", "uint256"], ["fee", "uint256"], ["nonce", "uint256"], ["deadline", "uint256"]].map(([name, type]) => ({ name, type })) };

const ok = (m) => console.log(`  ✓ ${m}`);
const bal = (token, who) => pub.readContract({ address: token, abi: ERC20, functionName: "balanceOf", args: [who] });
async function mined(hash) { const rc = await pub.waitForTransactionReceipt({ hash, timeout: 120_000 }); assert.equal(rc.status, "success", `tx failed ${hash}`); return rc; }

/** Gives `who` dollars on the fork by writing the token's balance slot (found by trying slots). */
async function deal(token, who, amount) {
  for (let slot = 0; slot < 60; slot++) {
    const key = keccak256(encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [who, BigInt(slot)]));
    const before = await pub.getStorageAt({ address: token, slot: key });
    await test.setStorageAt({ address: token, index: key, value: pad(toHex(amount), { size: 32 }) });
    if ((await bal(token, who)) === amount) return slot;
    await test.setStorageAt({ address: token, index: key, value: before ?? pad("0x0", { size: 32 }) });
  }
  return -1;
}

let NEW_PARAMS = false;
function swapCall(key, zeroForOne, amountIn) {
  const inC = zeroForOne ? key.currency0 : key.currency1, outC = zeroForOne ? key.currency1 : key.currency0;
  const single = NEW_PARAMS
    ? encodeAbiParameters([{ type: "tuple", components: [{ name: "poolKey", ...POOLKEY }, { name: "zeroForOne", type: "bool" }, { name: "amountIn", type: "uint128" }, { name: "amountOutMinimum", type: "uint128" }, { name: "minHopPriceX36", type: "uint256" }, { name: "hookData", type: "bytes" }] }], [{ poolKey: key, zeroForOne, amountIn, amountOutMinimum: 1n, minHopPriceX36: 0n, hookData: "0x" }])
    : encodeAbiParameters([{ type: "tuple", components: [{ name: "poolKey", ...POOLKEY }, { name: "zeroForOne", type: "bool" }, { name: "amountIn", type: "uint128" }, { name: "amountOutMinimum", type: "uint128" }, { name: "hookData", type: "bytes" }] }], [{ poolKey: key, zeroForOne, amountIn, amountOutMinimum: 1n, hookData: "0x" }]);
  const params = [single, encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [inC, amountIn]), encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [outC, 1n])];
  return encodeFunctionData({ abi: UR_ABI, functionName: "execute", args: ["0x10", [encodeAbiParameters([{ type: "bytes" }, { type: "bytes[]" }], ["0x060c0f", params])], BigInt(Math.floor(Date.now() / 1000) + 86_400)] });
}

async function signWithdraw(to, amount, fee) {
  const nonce = BigInt(Date.now()) * 1000n + BigInt(Math.floor(Math.random() * 1000));
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
  const signature = await wUser.signTypedData({ domain: { name: "ArkhamPad", version: "1", chainId: CHAIN_ID, verifyingContract: ROUTER }, types: WITHDRAW_TYPES, primaryType: "Withdraw", message: { user: userAcc.address, to, amount, fee, nonce, deadline } });
  return { nonce: String(nonce), deadline: String(deadline), signature };
}
// a tiny real PNG, so the launch carries a picture like the site's
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const META = `data:application/json;base64,${Buffer.from(JSON.stringify({ description: "Relayer fork test coin.", x: "arkhampad", website: "example.com" })).toString("base64")}`;

const LIVE_COIN = { 8453: "0xcfe1aeb9cc8b00795194e9878a4fade0cebb60a1", 56: "0x09456868a05eb1fe084603e41a241dc0da626305", 4663: "0x1a087dc194727c474292a84cd68d93b7c11d94f2" }[CHAIN_ID];
// a real coin from another DEX a user reported (Base, Uniswap v4 with a hook): buy and sell must work
// Samur•ai: its main pool is a new Uniswap v4 pool KyberSwap didn't see; a user sold for cents.
// The fair-price guard must refuse such a trade, and pass it once the route is fair.
// BNB Chain: CAKE (deep PancakeSwap pools KyberSwap always routes) proves a full buy + sell with
// BNB's 18-decimal USDC before trading BNB coins from other DEXs opens on the site
const EXTRA_COINS = { 8453: ["0xb20000000000000000000040a5d1876ffd5820c6", "0x7bdd5673c9822463746a33026bac8249b8d3cba3"], 56: ["0x0e09fabb73bd3ade0a17ecc321fd13a19e81ce82"] };
let approvedUsdc = false;
const KYBER = { 8453: "base", 56: "bsc", 4663: "robinhood" }[CHAIN_ID];
const EXT_TYPES = { ExtSwap: [["user", "address"], ["isBuy", "bool"], ["coin", "address"], ["amountIn", "uint256"], ["minOut", "uint256"], ["target", "address"], ["dataHash", "bytes32"], ["fee", "uint256"], ["nonce", "uint256"], ["deadline", "uint256"]].map(([name, type]) => ({ name, type })) };
async function kyber(tokenIn, tokenOut, amountIn, sender, slippage = 300) {
  const head = { "x-client-id": "arkhampad", "content-type": "application/json" };
  let r = null;
  for (let i = 0; i < 4 && !r?.data?.routeSummary; i++) {
    if (i) await new Promise((ok) => setTimeout(ok, 2000));
    const res = await fetch(`https://aggregator-api.kyberswap.com/${KYBER}/api/v1/routes?tokenIn=${tokenIn}&tokenOut=${tokenOut}&amountIn=${amountIn}&gasInclude=true`, { headers: head });
    r = await res.json().catch(() => null);
    if (!r?.data?.routeSummary) console.log(`  · Kyber route try ${i + 1}: ${res.status} ${String(r?.message ?? "").slice(0, 120)}`);
  }
  const sum = r?.data?.routeSummary;
  if (!sum) return null;
  const b = await (await fetch(`https://aggregator-api.kyberswap.com/${KYBER}/api/v1/route/build`, { method: "POST", headers: head, body: JSON.stringify({ routeSummary: sum, sender, recipient: sender, slippageTolerance: slippage, deadline: Math.floor(Date.now() / 1000) + 3600 }) })).json().catch(() => null);
  if (!b?.data?.data) return null;
  return { amountOut: BigInt(sum.amountOut), target: getAddress(b.data.routerAddress), data: b.data.data };
}
async function extSwapCheck(relayer, which) {
  const SWAP = entry.extSwap ? getAddress(entry.extSwap) : null;
  if (!SWAP || !which) { console.log("  · no PadExtSwap on this chain: skipped"); return; }
  const coin = getAddress(which);
  console.log(`  · one-tap trading check for ${coin}`);
  if ((await pub.getCode({ address: coin }))?.length > 2 !== true) { console.log("  · live coin not on this fork yet: skipped"); return; }
  const scale = 10n ** BigInt(DEC - 6);
  const up = (v) => v * scale, down = (v) => v / scale;
  const spendOf = (a) => a - (a * 100n) / 10_000n;
  // the user approves PadExtSwap once (the site does it by permit, or with a small gas top-up on BNB)
  if (!approvedUsdc) { await wUser.writeContract({ address: USDC, abi: ERC20, functionName: "approve", args: [SWAP, maxUint256] }).then(mined); approvedUsdc = true; }
  const fq = await relayer.feeQuote(CHAIN_ID, "extSwap");
  const FEE = BigInt(fq.fee); // site units
  // BUY $10
  const amount = 10_000_000n, amountIn = up(amount);
  const rb = await kyber(USDC, coin, spendOf(amountIn), SWAP);
  if (!rb) { console.log(`  · KyberSwap has no route for our coin on chain ${CHAIN_ID}: one-tap trading of it needs another route (skipped)`); return; }
  const sign = async (m) => wUser.signTypedData({ domain: { name: "ArkhamPad Swap", version: "1", chainId: CHAIN_ID, verifyingContract: SWAP }, types: EXT_TYPES, primaryType: "ExtSwap", message: m });
  const nonce1 = BigInt(Date.now()) * 10n, dl = BigInt(Math.floor(Date.now() / 1000) + 3600);
  const send = async (m, data) => relayer.handle({ chainId: CHAIN_ID, kind: "extSwap", swap: { ...Object.fromEntries(Object.entries(m).map(([k2, v]) => [k2, typeof v === "bigint" ? String(v) : v])), data, signature: await sign(m) } });
  const refused = async (m, data, what, code = "PriceGuard") => {
    const before = [await bal(USDC, userAcc.address), await bal(coin, userAcc.address)];
    const e = await send(m, data).then(() => null, (x) => x);
    assert.ok(e && e.code === code, `${what}: should have been refused with ${code} (${e?.code ?? ""} ${e?.message ?? "it went through"})`);
    assert.deepEqual([await bal(USDC, userAcc.address), await bal(coin, userAcc.address)], before, `${what}: nothing may move`);
    ok(`price guard refused ${what}: "${e.message}"`);
  };
  const price = await priceGuard.refPrice(CHAIN_ID, coin);
  const coinDec = Number(await pub.readContract({ address: coin, abi: [{ type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] }], functionName: "decimals" }));
  console.log(`  · market price (DexScreener/GeckoTerminal) $${price} · KyberSwap buy route gives ${Number(rb.amountOut) / 10 ** coinDec} coins for $${Number(spendOf(amountIn)) / 10 ** DEC} (= $${price ? ((Number(rb.amountOut) / 10 ** coinDec) * price).toFixed(2) : "?"} at market)`);
  // the site signs 98% of the route's quote
  const mb = { user: userAcc.address, isBuy: true, coin, amountIn, minOut: (rb.amountOut * 98n) / 100n, target: rb.target, dataHash: keccak256(rb.data), fee: up(FEE), nonce: nonce1, deadline: dl };
  // a buy that would accept almost nothing is always refused
  await refused({ ...mb, minOut: 1n, nonce: nonce1 + 5n }, rb.data, "a buy with no real minimum");
  if (!priceGuard.judge({ isBuy: true, amountIn, minOut: mb.minOut, fee: mb.fee, coinDec, usdcDec: DEC, price }).ok) {
    // KyberSwap's route is far off the market price (or there is no market price): it must be refused
    await refused(mb, rb.data, "a buy on an unfair route");
    return;
  }
  // a buy only when what it gets can be sold back near the market price
  const sb = await priceGuard.sellBackOk({ chainId: CHAIN_ID, coin, coins: (mb.minOut * 100n) / 98n, coinDec, usdc: USDC, usdcDec: DEC, price });
  console.log(`  · selling those coins back through KyberSwap would return ${(sb.back * 100).toFixed(1)}% of their market value`);
  if (!sb.ok) {
    await refused(mb, rb.data, "a buy of a coin that can't be sold back", "NoSellRoute");
    return;
  }
  const u0 = await bal(USDC, userAcc.address), c0 = await bal(coin, userAcc.address);
  // like the site: when the DEX route can't fill (the pool moved), quote again with a little more room
  const fill = async (m, r, isBuy, amt) => {
    for (let attempt = 0; ; attempt++) {
      try { return await send(m, r.data); } catch (e) {
        if (e.code !== "SwapFailed" || attempt >= 2) throw e;
        console.log(`  · the DEX route couldn't fill (try ${attempt + 1}): quoting again`);
        r = await kyber(isBuy ? USDC : coin, isBuy ? coin : USDC, amt, SWAP, [500, 500][attempt]);
        assert.ok(r, "no route on retry");
        const q = isBuy ? r.amountOut : r.amountOut - (r.amountOut * 100n) / 10_000n - up(FEE);
        m = { ...m, minOut: (q * 98n) / 100n, target: r.target, dataHash: keccak256(r.data), nonce: m.nonce + 10n * BigInt(attempt + 1) };
      }
    }
  };
  const res = await fill(mb, rb, true, spendOf(amountIn));
  assert.equal(res.status, "success", "one-tap buy failed");
  console.log(`  · buy gas used ${(await pub.getTransactionReceipt({ hash: res.hash })).gasUsed}`);
  const got = (await bal(coin, userAcc.address)) - c0;
  assert.ok(got > 0n);
  assert.equal(u0 - (await bal(USDC, userAcc.address)) <= amountIn + up(FEE), true, "user paid more than amount + fee");
  ok(`one-tap BUY of our live coin: $10 -> ${Number(formatUnits(got, 18)).toFixed(0)} coins (paid ${formatUnits(u0 - (await bal(USDC, userAcc.address)), DEC)} USDC incl. fees)`);
  // SELL them back
  await wUser.writeContract({ address: coin, abi: ERC20, functionName: "approve", args: [SWAP, maxUint256] }).then(mined);
  const rs = await kyber(coin, USDC, got, SWAP);
  if (!rs && CHAIN_ID === 56 && coin.toLowerCase() === String(LIVE_COIN).toLowerCase()) { console.log("  · KyberSwap has no BNB sell route for this coin: known, and why trading BNB coins from other DEXs stays off on the site (skipped)"); return; }
  assert.ok(rs, "no sell route");
  const quoted = rs.amountOut - (rs.amountOut * 100n) / 10_000n - up(FEE);
  assert.ok(quoted > 0n);
  const ms = { user: userAcc.address, isBuy: false, coin, amountIn: got, minOut: (quoted * 98n) / 100n, target: rs.target, dataHash: keccak256(rs.data), fee: up(FEE), nonce: nonce1 + 1n, deadline: dl };
  // a sale for almost nothing (what happened to the user) is always refused
  await refused({ ...ms, minOut: 1n, nonce: nonce1 + 6n }, rs.data, "a sale for almost nothing");
  if (!priceGuard.judge({ isBuy: false, amountIn: got, minOut: ms.minOut, fee: ms.fee, coinDec, usdcDec: DEC, price }).ok) {
    await refused(ms, rs.data, "a sale on an unfair route");
    return;
  }
  const u1 = await bal(USDC, userAcc.address);
  const res2 = await fill(ms, rs, false, got);
  if (res2.status !== "success") { const rc = await pub.getTransactionReceipt({ hash: res2.hash }); console.log(`  · sell gas used ${rc.gasUsed} of ${(await pub.getTransaction({ hash: res2.hash })).gas}`); }
  assert.equal(res2.status, "success", "one-tap sell failed");
  const back = (await bal(USDC, userAcc.address)) - u1;
  assert.ok(back >= ms.minOut, "sell paid less than the signed minimum");
  ok(`one-tap SELL back: received $${Number(formatUnits(back, DEC)).toFixed(2)} (site shows $${(Number(down(back)) / 1e6).toFixed(2)})`);
}

async function main() {
  console.log(`Chain ${CHAIN_ID} fork at block ${await pub.getBlockNumber()} · relayer ${relayerAddr} · user ${userAcc.address}`);
  await test.setBalance({ address: relayerAddr, value: parseEther("5") });
  await test.setBalance({ address: userAcc.address, value: parseEther("0.01") }); // only for the one-time USDC approval
  await test.setBalance({ address: trader.address, value: parseEther("10") });
  const one = 10n ** BigInt(DEC);
  // gas on a local copy is far dearer than on the real chain (anvil adds a 1 gwei tip), so network
  // fees here are many dollars: the "network busy" ceiling is lifted and the user gets more test dollars
  const slot = await deal(USDC, userAcc.address, 2000n * one);
  if (slot < 0) { console.log(`SKIPPED: couldn't give the test user ${entry.name} dollars on the fork (the Clanker launch itself is checked by clanker-fork.mjs)`); process.exit(0); }
  ok(`user has $2000 test dollars (balance slot ${slot})`);
  await wUser.writeContract({ address: USDC, abi: ERC20, functionName: "approve", args: [ROUTER, maxUint256] }).then(mined);

  const relayer = makeRelayer();
  assert.ok(relayer, "relayer did not start");
  assert.equal(getAddress(relayer.address), relayerAddr);

  // ---- 1. launch through the relayer, exactly as the site does
  const q = await relayer.feeQuote(CHAIN_ID, "clankerLaunch");
  const fee = BigInt(q.fee) * 10n ** BigInt(DEC - 6); // site units -> chain units
  console.log(`network fee quote $${q.usd.toFixed(4)}`);
  const amount = 10n * one; // a $10 first buy
  const u0 = await bal(USDC, userAcc.address), r0 = await bal(USDC, relayerAddr);
  const ethR0 = await pub.getBalance({ address: relayerAddr });
  const sig = await signWithdraw(relayerAddr, amount, fee);
  const res = await relayer.clankerLaunch({ chainId: CHAIN_ID, user: userAcc.address, launch: { name: "Relayer Fork Coin", symbol: "RFORK", metadataURI: META }, dataUrl: PNG, amount: String(amount), fee: String(fee), ...sig }, "https://railway.example");
  console.log(`launched ${res.coin} key ${res.key} (${res.hash})`);
  const coin = getAddress(res.coin);
  assert.equal(res.status, "success");
  assert.equal(u0 - (await bal(USDC, userAcc.address)), amount + fee); ok("user paid first buy + network fee in USDC, with one signature");
  assert.equal((await bal(USDC, relayerAddr)) - r0, amount + fee); ok("dollars arrived at the relayer");
  const coins = await bal(coin, userAcc.address);
  assert.ok(coins > 0n); ok(`user received ${Number(formatUnits(coins, 18)).toFixed(0)} coins from the first buy`);
  assert.equal(await bal(coin, relayerAddr), 0n);
  const spent = ethR0 - (await pub.getBalance({ address: relayerAddr }));
  console.log(`  · relayer spent ${formatEther(spent)} ${NATIVE} (first buy + gas)`);
  const rc = await pub.getTransactionReceipt({ hash: res.hash });
  const ev = rc.logs.map((l) => { try { return decodeEventLog({ abi: [TOKEN_CREATED], data: l.data, topics: l.topics }); } catch { return null; } }).find(Boolean);
  assert.ok(ev, "no TokenCreated");
  assert.equal(ev.args.tokenImage.startsWith(`${PUBLIC_URL}/img/h-`), true); ok(`picture link inside the coin: ${ev.args.tokenImage.slice(0, 60)}…`);
  const meta = JSON.parse(ev.args.tokenMetadata);
  assert.ok(meta.description.startsWith("Relayer fork test coin.") && meta.description.endsWith("Launched on ArkhamPad"));
  assert.equal(meta.socialMediaUrls[0].url, `https://arkhampad.com/coin/?k=${CHAIN_ID}-${res.key}`);
  assert.ok(meta.socialMediaUrls.some((s) => s.platform === "x" && s.url === "https://x.com/arkhampad")); ok("description, ArkhamPad coin link and X link inside the coin");
  assert.equal(JSON.parse(ev.args.tokenContext).interface, "ArkhamPad");
  assert.equal(getAddress(ev.args.msgSender), relayerAddr); ok("sent by our launcher (the indexer finds it by this)");

  // ---- 2. a launch that fails after the payment: the first buy comes back
  process.env.CLANKER_TEST_REVERT = "1";
  const u1 = await bal(USDC, userAcc.address);
  const sig2 = await signWithdraw(relayerAddr, amount, fee);
  let failed = null;
  try { await relayer.clankerLaunch({ chainId: CHAIN_ID, user: userAcc.address, launch: { name: "Broken Coin", symbol: "BRK", metadataURI: META }, amount: String(amount), fee: String(fee), ...sig2 }, "https://railway.example"); }
  catch (e) { failed = e; }
  delete process.env.CLANKER_TEST_REVERT;
  assert.ok(failed && /refunded/i.test(failed.message), `expected a refund, got: ${failed?.message}`);
  assert.equal(u1 - (await bal(USDC, userAcc.address)), fee); ok(`failed launch refunded: the user lost only the $${(Number(fee) / 10 ** DEC).toFixed(4)} network fee ("${failed.message}")`);

  // ---- 3. a signature for someone else's money or a reused one never works
  let reused = null;
  try { await relayer.clankerLaunch({ chainId: CHAIN_ID, user: userAcc.address, launch: { name: "Again", symbol: "AGN", metadataURI: META }, amount: String(amount), fee: String(fee), ...sig }, "x"); } catch (e) { reused = e; }
  assert.ok(reused, "a used signature launched again"); ok(`a used payment signature is refused ("${reused.message}")`);

  // ---- 4. trading after Clanker's protection, then the creator claims rewards
  await test.increaseTime({ seconds: 180 }); await test.mine({ blocks: 5 });
  const info = await pub.readContract({ address: getAddress(ev.args.locker), abi: LOCKER_ABI, functionName: "tokenRewards", args: [coin] });
  const key = info.poolKey, coinIs0 = getAddress(key.currency0) === coin;
  await wTrader.sendTransaction({ to: k.paired, data: encodeFunctionData({ abi: ERC20, functionName: "deposit" }), value: parseEther("1") }).then(mined);
  await wTrader.writeContract({ address: k.paired, abi: ERC20, functionName: "approve", args: [PERMIT2, maxUint256] }).then(mined);
  await wTrader.writeContract({ address: PERMIT2, abi: PERMIT2_ABI, functionName: "approve", args: [k.paired, UR, 2n ** 160n - 1n, 2n ** 48n - 1n] }).then(mined);
  await wTrader.writeContract({ address: coin, abi: ERC20, functionName: "approve", args: [PERMIT2, maxUint256] }).then(mined);
  await wTrader.writeContract({ address: PERMIT2, abi: PERMIT2_ABI, functionName: "approve", args: [coin, UR, 2n ** 160n - 1n, 2n ** 48n - 1n] }).then(mined);
  const buyIn = parseEther(CHAIN_ID === 56 ? "0.05" : "0.01");
  const probe = await pub.call({ account: trader.address, to: UR, data: swapCall(key, !coinIs0, buyIn) }).then(() => true, () => false);
  if (!probe) NEW_PARAMS = true;
  const from = await pub.getBlockNumber();
  for (let i = 0; i < 3; i++) {
    await wTrader.sendTransaction({ to: UR, data: swapCall(key, !coinIs0, buyIn), gas: 1_500_000n }).then(mined);
    await wTrader.sendTransaction({ to: UR, data: swapCall(key, coinIs0, await bal(coin, trader.address)), gas: 1_500_000n }).then(mined);
  }
  await wTrader.writeContract({ address: getAddress(ev.args.locker), abi: LOCKER_ABI, functionName: "collectRewards", args: [coin], gas: 3_000_000n }).then(mined);
  const before = await relayer.clankerRewards(CHAIN_ID, userAcc.address);
  assert.ok(BigInt(before.amount) > 0n); ok(`creator can claim ${formatEther(BigInt(before.amount))} ${NATIVE} ($${before.usd.toFixed(4)})`);
  const cq = await relayer.feeQuote(CHAIN_ID, "clankerClaim");
  const cfee = BigInt(cq.fee) * 10n ** BigInt(DEC - 6);
  const w0 = await bal(k.paired, userAcc.address), uc = await bal(USDC, userAcc.address);
  const csig = await signWithdraw(userAcc.address, 0n, cfee);
  const claim = await relayer.handle({ chainId: CHAIN_ID, kind: "clankerClaim", user: userAcc.address, fee: String(cfee), ...csig });
  assert.equal(claim.status, "success");
  assert.equal((await bal(k.paired, userAcc.address)) - w0, BigInt(before.amount)); ok("creator's rewards arrived in their wallet");
  assert.equal(uc - (await bal(USDC, userAcc.address)), cfee); ok(`claim's network fee paid in USDC ($${(Number(cfee) / 10 ** DEC).toFixed(4)})`);
  const after = await relayer.clankerRewards(CHAIN_ID, userAcc.address);
  assert.equal(after.amount, "0");

  // ---- 5. the indexer's numbers for these trades
  const usd = Number((await (await fetch(`https://api.coinbase.com/v2/prices/${NATIVE}-USD/spot`)).json()).data.amount);
  const all = await pub.getLogs({ event: SWAP_EV, args: { id: ev.args.poolId }, fromBlock: from, toBlock: "latest" });
  // the indexer skips the locker's own fee-conversion swaps (bookkeeping, not trades)
  const lockers = new Set(lockersOf(CHAIN_ID).map((a) => a.toLowerCase()));
  // ...whether the locker swaps itself (inside a trade) or through the Universal Router (when someone
  // calls collectRewards: that transaction goes to the locker)
  const txTo = new Map();
  for (const s of all) if (!txTo.has(s.transactionHash)) txTo.set(s.transactionHash, String((await pub.getTransaction({ hash: s.transactionHash })).to).toLowerCase());
  for (const s of all) console.log(`  · swap tx ${s.transactionHash.slice(0, 10)} sender ${s.args.sender.slice(0, 10)} tx.to ${txTo.get(s.transactionHash).slice(0, 10)}`);
  const swaps = all.filter((s) => !lockers.has(s.args.sender.toLowerCase()) && !lockers.has(txTo.get(s.transactionHash)));
  console.log(`  · ${all.length} pool swaps: ${swaps.length} trades + ${all.length - swaps.length} locker fee conversions`);
  assert.equal(swaps.length, 6);
  assert.ok(swaps.every((s) => getAddress(s.args.sender) === UR), "a counted trade didn't come through the Universal Router");
  for (const s of swaps.slice(0, 2)) {
    const t = clankerTrade(s.args, coin, k.paired, usd);
    console.log(`  · ${t.isBuy ? "buy " : "sell"} $${t.usdc.toFixed(2)} ${Math.round(t.coins)} coins, fee $${t.fee.toFixed(4)} (${(t.feeRate * 100).toFixed(2)}%), market cap after $${Math.round(t.price * 1e11)}`);
    assert.ok(t.usdc > 0 && t.coins > 0);
    assert.ok(t.price * 1e11 > 3000 && t.price * 1e11 < 50_000, "market cap from the indexer math is off");
    assert.ok(Math.abs(t.feeRate - 0.01) < 0.0001, `fee rate ${t.feeRate}`);
  }
  ok("indexer turns pool swaps into dollar trades (price, market cap, 1% fee)");

  // ---- 6. one-tap trading on ArkhamPad (PadExtSwap + KyberSwap) of our real live coin on this chain,
  // with exactly the site's math (web/lib/ext.ts): dollars in the network's USDC units, 1% fee, network fee
  // coins that fail the quality list can't be bought (the relayer asks the database); selling stays open
  if (entry.extSwap && LIVE_COIN) {
    relayer.setDb({ query: async () => ({ rows: [{ ok: false }] }) }); // "not listed, not ours"
    const fq0 = await relayer.feeQuote(CHAIN_ID, "extSwap");
    const fee0 = String(BigInt(fq0.fee) * 10n ** BigInt(DEC - 6) * 2n); // a real network fee, so only the listing check can refuse it
    const base = { user: userAcc.address, coin: getAddress(LIVE_COIN), amountIn: String(10n ** BigInt(DEC)), minOut: "1", target: getAddress(LIVE_COIN), data: "0x", fee: fee0, nonce: "1", deadline: String(Math.floor(Date.now() / 1000) + 600), signature: "0x" + "11".repeat(65) };
    const eb = await relayer.handle({ chainId: CHAIN_ID, kind: "extSwap", swap: { ...base, isBuy: true } }).then(() => null, (x) => x);
    assert.equal(eb?.code, "NotListed", `an unlisted coin's buy must be refused (${eb?.message ?? "it went through"})`);
    const es = await relayer.handle({ chainId: CHAIN_ID, kind: "extSwap", swap: { ...base, isBuy: false } }).then(() => null, (x) => x);
    assert.notEqual(es?.code, "NotListed", "selling an unlisted coin must stay open");
    relayer.setDb(null);
    ok(`unlisted coins: buying refused ("${eb.message}"), selling open (refused here only by ${es?.code ?? "nothing"})`);
  }
  for (const c of [LIVE_COIN, ...(EXTRA_COINS[CHAIN_ID] ?? [])].filter(Boolean)) await extSwapCheck(relayer, c);

  // ---- 7. the quality list's checks on real coins, with the live free APIs (read-only)
  console.log("\n  quality checks on real coins (GoPlus, DexScreener, KyberSwap):");
  const net = { chainId: CHAIN_ID, usdc: USDC, usdcDec: DEC };
  for (const c of [LIVE_COIN, ...(EXTRA_COINS[CHAIN_ID] ?? [])].filter(Boolean).map((x) => x.toLowerCase())) {
    const dec = Number(await pub.readContract({ address: getAddress(c), abi: [{ type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] }], functionName: "decimals" }));
    const pairs = await quality.ds(`/tokens/v1/${{ 8453: "base", 56: "bsc", 4663: "robinhood" }[CHAIN_ID]}/${c}`).catch((e) => { console.log(`    DexScreener: ${e.message}`); return []; });
    assert.ok(Array.isArray(pairs), "DexScreener answer isn't a list");
    const best = pairs.filter((p) => String(p?.baseToken?.address).toLowerCase() === c).sort((x, y) => (y.liquidity?.usd ?? 0) - (x.liquidity?.usd ?? 0))[0];
    const ageH = best?.pairCreatedAt ? (Date.now() - best.pairCreatedAt) / 3.6e6 : null;
    let s = null;
    if (quality.GOPLUS_CHAINS.includes(CHAIN_ID)) {
      const g = await quality.goplus(CHAIN_ID, [c]).catch((e) => { console.log(`    GoPlus: ${e.message}`); return {}; });
      s = quality.safetyOf(g[c]);
    }
    const r = await quality.routeCheck(net, c, dec).catch((e) => ({ ok: false, err: e.message }));
    console.log(`    ${best?.baseToken?.symbol ?? c.slice(0, 10)}: liquidity $${Math.round(best?.liquidity?.usd ?? 0)}, 24h volume $${Math.round(best?.volume?.h24 ?? 0)}, pool age ${ageH === null ? "?" : ageH.toFixed(1) + " h"}, X/website ${quality.socialsOf(pairs, c)}`);
    if (s) console.log(`      GoPlus: honeypot ${s.honeypot}, taxes ${s.buy_tax}/${s.sell_tax}, owner risk ${s.owner_risk}, top 10 wallets ${s.top10_pct === null ? "?" : (s.top10_pct * 100).toFixed(1) + "%"}, creator ${s.creator_pct}`);
    console.log(`      KyberSwap $50 buy+sell vs market: ${r.err ? r.err : `${(r.fair * 100).toFixed(1)}% of fair -> ${r.ok ? "ok" : "FAILS the route check"}`}`);
  }
  ok("quality checks ran on real coins");

  console.log(`\nALL RELAYER CHECKS PASSED on chain ${CHAIN_ID}`);
  process.exit(0);
}
main().catch((e) => { console.error(`\nFAILED: ${e.stack ?? e}`); process.exit(1); });
