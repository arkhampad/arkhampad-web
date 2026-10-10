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
Object.assign(process.env, { CHAINS_FILE: file, FORK_RPC: RPC, RELAYER_KEY: relayerKey, PUBLIC_URL, CLANKER_FLOAT_USD: "0", FEE_MAX_USD: "5", LIMITS_ON: "off" });
const { makeRelayer } = await import("../relayer.mjs");
const { clankerOf, TOKEN_CREATED } = await import("../clanker.mjs");
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

async function main() {
  console.log(`Chain ${CHAIN_ID} fork at block ${await pub.getBlockNumber()} · relayer ${relayerAddr} · user ${userAcc.address}`);
  await test.setBalance({ address: relayerAddr, value: parseEther("5") });
  await test.setBalance({ address: userAcc.address, value: parseEther("0.01") }); // only for the one-time USDC approval
  await test.setBalance({ address: trader.address, value: parseEther("10") });
  const one = 10n ** BigInt(DEC);
  const slot = await deal(USDC, userAcc.address, 100n * one);
  if (slot < 0) { console.log(`SKIPPED: couldn't give the test user ${entry.name} dollars on the fork (the Clanker launch itself is checked by clanker-fork.mjs)`); process.exit(0); }
  ok(`user has $100 test dollars (balance slot ${slot})`);
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
  const swaps = await pub.getLogs({ event: SWAP_EV, args: { id: ev.args.poolId }, fromBlock: from, toBlock: "latest" });
  assert.equal(swaps.length, 6);
  for (const s of swaps.slice(0, 2)) {
    const t = clankerTrade(s.args, coin, k.paired, usd);
    console.log(`  · ${t.isBuy ? "buy " : "sell"} $${t.usdc.toFixed(2)} ${Math.round(t.coins)} coins, fee $${t.fee.toFixed(4)} (${(t.feeRate * 100).toFixed(2)}%), market cap after $${Math.round(t.price * 1e11)}`);
    assert.ok(t.usdc > 0 && t.coins > 0);
    assert.ok(t.price * 1e11 > 3000 && t.price * 1e11 < 50_000, "market cap from the indexer math is off");
    assert.ok(Math.abs(t.feeRate - 0.01) < 0.0001, `fee rate ${t.feeRate}`);
  }
  ok("indexer turns pool swaps into dollar trades (price, market cap, 1% fee)");
  console.log(`\nALL RELAYER CHECKS PASSED on chain ${CHAIN_ID}`);
  process.exit(0);
}
main().catch((e) => { console.error(`\nFAILED: ${e.stack ?? e}`); process.exit(1); });
