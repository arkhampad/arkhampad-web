// Real-network check of ArkhamPad's Clanker launch, on a local copy (anvil fork) of the chain.
// Nothing here touches the real chain. Run by .github/workflows/clanker-fork.yml:
//   anvil --fork-url $RPC  &  CHAIN_ID=8453 node test/clanker-fork.mjs
// It checks, with the exact code the relayer uses:
//   1. the coin is created by Clanker with ArkhamPad's settings (name, admin, context, 1% fee)
//   2. the first market cap is about $4.8K
//   3. the creator's first buy lands in the creator's wallet (not the relayer's)
//   4. anyone can buy and sell the coin on Uniswap v4 (Universal Router), like bots and DEX sites do
//   5. trading rewards are split 50% creator / 50% ArkhamPad, paid in WETH/WBNB, and can be claimed
import assert from "node:assert/strict";
import { createPublicClient, createTestClient, createWalletClient, http, encodeAbiParameters, encodeFunctionData, keccak256, getAddress, maxUint256, parseEther, formatEther, formatUnits } from "viem";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { deployTx, parseCreated, clankerOf, pickLocker, mcAtTick, ARKHAMPAD_TREASURY, START_MC_USD } from "../clanker.mjs";

const CHAIN_ID = Number(process.env.CHAIN_ID || 8453);
const RPC = process.env.ANVIL_URL || "http://127.0.0.1:8545";
const NATIVE = CHAIN_ID === 56 ? "BNB" : "ETH";
// Uniswap's Universal Router and Permit2 (developers.uniswap.org/docs/protocols/v4/deployments)
const UR = getAddress({ 8453: "0x6ff5693b99212da76ad316178a184ab56d299b43", 56: "0x1906c1d672b88cd1b9ac7593301ca990f94eae07", 4663: "0x8876789976decbfcbbbe364623c63652db8c0904" }[CHAIN_ID]);
const PERMIT2 = "0x000000000022D473030F116dDEE9F6B43aC78BA3";

const chain = { id: CHAIN_ID, name: `fork-${CHAIN_ID}`, nativeCurrency: { name: NATIVE, symbol: NATIVE, decimals: 18 }, rpcUrls: { default: { http: [RPC] } } };
const transport = http(RPC, { timeout: 120_000 });
const pub = createPublicClient({ chain, transport });
const test = createTestClient({ chain, transport, mode: "anvil" });
const relayer = privateKeyToAccount(generatePrivateKey());
const trader = privateKeyToAccount(generatePrivateKey());
const user = privateKeyToAccount(generatePrivateKey()).address; // the creator: has no ETH at all
const wRelayer = createWalletClient({ chain, transport, account: relayer });
const wTrader = createWalletClient({ chain, transport, account: trader });

const ERC20 = [
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ type: "address" }, { type: "uint256" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "deposit", stateMutability: "payable", inputs: [], outputs: [] },
  { type: "function", name: "name", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "totalSupply", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
];
const PERMIT2_ABI = [{ type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ type: "address" }, { type: "address" }, { type: "uint160" }, { type: "uint48" }], outputs: [] }];
const UR_ABI = [{ type: "function", name: "execute", stateMutability: "payable", inputs: [{ type: "bytes" }, { type: "bytes[]" }, { type: "uint256" }], outputs: [] }];
const LOCKER_ABI = [
  { type: "function", name: "collectRewards", stateMutability: "nonpayable", inputs: [{ type: "address" }], outputs: [] },
  { type: "function", name: "tokenRewards", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "tuple", components: [
    { name: "token", type: "address" },
    { name: "poolKey", type: "tuple", components: [{ name: "currency0", type: "address" }, { name: "currency1", type: "address" }, { name: "fee", type: "uint24" }, { name: "tickSpacing", type: "int24" }, { name: "hooks", type: "address" }] },
    { name: "positionId", type: "uint256" }, { name: "numPositions", type: "uint256" }, { name: "rewardBps", type: "uint16[]" }, { name: "rewardAdmins", type: "address[]" }, { name: "rewardRecipients", type: "address[]" }] }] },
];
const FEELOCKER_ABI = [
  { type: "function", name: "availableFees", stateMutability: "view", inputs: [{ type: "address" }, { type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "claim", stateMutability: "nonpayable", inputs: [{ type: "address" }, { type: "address" }], outputs: [] },
];
const POOLKEY = { type: "tuple", components: [{ name: "currency0", type: "address" }, { name: "currency1", type: "address" }, { name: "fee", type: "uint24" }, { name: "tickSpacing", type: "int24" }, { name: "hooks", type: "address" }] };

const ok = (m) => console.log(`  ✓ ${m}`);
async function mined(hash) { const rc = await pub.waitForTransactionReceipt({ hash, timeout: 120_000 }); assert.equal(rc.status, "success", `tx failed ${hash}`); return rc; }
const bal = (token, who) => pub.readContract({ address: token, abi: ERC20, functionName: "balanceOf", args: [who] });

async function nativeUsd() {
  for (const u of [`https://api.coinbase.com/v2/prices/${NATIVE}-USD/spot`]) {
    try { const v = Number((await (await fetch(u)).json())?.data?.amount); if (v > 0) return v; } catch { /* next */ }
  }
  throw new Error("no price");
}

/** Universal Router V4_SWAP: exact input on one pool. */
// Newer Universal Router builds add minHopPriceX36 to the single-pool swap (picked by probing).
let NEW_PARAMS = false;
function swapCall(key, zeroForOne, amountIn, minOut, newParams = NEW_PARAMS) {
  const inC = zeroForOne ? key.currency0 : key.currency1, outC = zeroForOne ? key.currency1 : key.currency0;
  const actions = "0x060c0f"; // SWAP_EXACT_IN_SINGLE, SETTLE_ALL, TAKE_ALL
  const params = [
    newParams
      ? encodeAbiParameters([{ type: "tuple", components: [{ name: "poolKey", ...POOLKEY }, { name: "zeroForOne", type: "bool" }, { name: "amountIn", type: "uint128" }, { name: "amountOutMinimum", type: "uint128" }, { name: "minHopPriceX36", type: "uint256" }, { name: "hookData", type: "bytes" }] }],
        [{ poolKey: key, zeroForOne, amountIn, amountOutMinimum: minOut, minHopPriceX36: 0n, hookData: "0x" }])
      : encodeAbiParameters([{ type: "tuple", components: [{ name: "poolKey", ...POOLKEY }, { name: "zeroForOne", type: "bool" }, { name: "amountIn", type: "uint128" }, { name: "amountOutMinimum", type: "uint128" }, { name: "hookData", type: "bytes" }] }],
        [{ poolKey: key, zeroForOne, amountIn, amountOutMinimum: minOut, hookData: "0x" }]),
    encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [inC, amountIn]),
    encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [outC, minOut]),
  ];
  const input = encodeAbiParameters([{ type: "bytes" }, { type: "bytes[]" }], [actions, params]);
  return encodeFunctionData({ abi: UR_ABI, functionName: "execute", args: ["0x10", [input], BigInt(Math.floor(Date.now() / 1000) + 86_400)] });
}

async function main() {
  const k = clankerOf(CHAIN_ID);
  const block = await pub.getBlockNumber();
  console.log(`Chain ${CHAIN_ID} fork at block ${block}`);
  const usd = await nativeUsd();
  console.log(`${NATIVE} = $${usd}`);
  await test.setBalance({ address: relayer.address, value: parseEther("10") });
  await test.setBalance({ address: trader.address, value: parseEther("10") });

  // ---- 1. launch, exactly as the relayer does it: a $5 first buy for the creator
  const devBuyWei = BigInt(Math.round((5 / usd) * 1e18));
  const locker = await pickLocker(pub, CHAIN_ID);
  console.log(`locker ${locker}${locker === k.locker ? " (SDK default)" : " (fallback)"}`);
  const tx = await deployTx({ locker, chainId: CHAIN_ID, name: "Fork Test Coin", symbol: "FORK", image: "https://api.arkhampad.com/img/h-test", description: "A coin made by the ArkhamPad fork test.", coinUrl: `https://arkhampad.com/coin/${CHAIN_ID}/0x0`, user, devBuyWei, nativeUsd: usd });
  const before = await pub.getBalance({ address: relayer.address });
  const gas = await pub.estimateGas({ account: relayer.address, to: tx.to, data: tx.data, value: tx.value });
  console.log(`deploy gas estimate ${gas}`);
  const rc = await mined(await wRelayer.sendTransaction({ to: tx.to, data: tx.data, value: tx.value, gas: (gas * 13n) / 10n }));
  console.log(`deploy gas used ${rc.gasUsed}`);
  const ev = parseCreated(CHAIN_ID, rc.logs, tx.abi);
  assert.ok(ev, "TokenCreated event missing");
  const coin = getAddress(ev.tokenAddress);
  console.log(`coin ${coin}`);
  assert.equal(getAddress(ev.tokenAdmin), getAddress(user)); ok("creator is the coin admin");
  assert.equal(getAddress(ev.msgSender), relayer.address);
  assert.equal(getAddress(ev.locker), locker);
  assert.equal(ev.tokenName, "Fork Test Coin"); assert.equal(ev.tokenSymbol, "FORK");
  assert.equal(await pub.readContract({ address: coin, abi: ERC20, functionName: "name" }), "Fork Test Coin"); ok("name and ticker set");
  assert.equal(await pub.readContract({ address: coin, abi: ERC20, functionName: "totalSupply" }), 100_000_000_000n * 10n ** 18n); ok("supply 100B");
  assert.ok(JSON.parse(ev.tokenContext).interface === "ArkhamPad"); ok("interface = ArkhamPad (shows on Clanker and aggregators)");
  const meta = JSON.parse(ev.tokenMetadata);
  assert.ok(meta.description.endsWith("Launched on ArkhamPad")); assert.equal(meta.socialMediaUrls[0].url, `https://arkhampad.com/coin/${CHAIN_ID}/0x0`); ok("description footer + website link");
  assert.equal(getAddress(ev.pairedToken), k.paired); ok(`paired with ${NATIVE === "BNB" ? "WBNB" : "WETH"}`);
  assert.equal(Number(ev.startingTick), tx.tick);
  const mc = mcAtTick(tx.tick, usd);
  assert.ok(mc > START_MC_USD * 0.95 && mc < START_MC_USD * 1.05, `start MC $${mc}`); ok(`first market cap $${mc.toFixed(0)}`);

  // ---- 2. first buy went to the creator
  const got = await bal(coin, user);
  const expect = (5 / mc) * 1e11; // coins for $5 at the start price (before fee and price impact)
  const gotN = Number(formatUnits(got, 18));
  console.log(`creator got ${gotN.toFixed(0)} coins (no-fee estimate ${expect.toFixed(0)})`);
  assert.ok(gotN > expect * 0.9 && gotN <= expect, "first buy amount off"); ok("creator received the first buy");
  assert.equal(await bal(coin, relayer.address), 0n); ok("relayer kept no coins");
  const spent = before - (await pub.getBalance({ address: relayer.address }));
  console.log(`relayer spent ${formatEther(spent)} ${NATIVE} (first buy ${formatEther(devBuyWei)} + gas)`);
  assert.ok(spent >= devBuyWei && spent < devBuyWei + parseEther("0.01"));

  // ---- 3. rewards set-up: 50/50, creator + ArkhamPad treasury
  const info = await pub.readContract({ address: locker, abi: LOCKER_ABI, functionName: "tokenRewards", args: [coin] });
  assert.deepEqual(info.rewardBps.map(Number), [5000, 5000]);
  assert.deepEqual(info.rewardRecipients.map((a) => getAddress(a)), [getAddress(user), getAddress(ARKHAMPAD_TREASURY)]); ok("rewards 50% creator / 50% ArkhamPad");
  const key = info.poolKey;
  assert.equal(keccak256(encodeAbiParameters([POOLKEY], [key])), ev.poolId); ok(`pool ${ev.poolId}`);
  const coinIs0 = getAddress(key.currency0) === coin;

  // ---- 4. trading right after launch: Clanker's anti-sniper window
  await wTrader.sendTransaction({ to: k.paired, data: encodeFunctionData({ abi: ERC20, functionName: "deposit" }), value: parseEther("1") }).then(mined);
  await wTrader.writeContract({ address: k.paired, abi: ERC20, functionName: "approve", args: [PERMIT2, maxUint256] }).then(mined);
  await wTrader.writeContract({ address: PERMIT2, abi: PERMIT2_ABI, functionName: "approve", args: [k.paired, UR, 2n ** 160n - 1n, 2n ** 48n - 1n] }).then(mined);
  const buyIn = BigInt(Math.round((20 / usd) * 1e18)); // a $20 buy
  const early = await pub.call({ account: trader.address, to: UR, data: swapCall(key, !coinIs0, buyIn, 1n) }).then(() => "went through", (e) => `reverted (${e.shortMessage ?? e.message})`.slice(0, 160));
  console.log(`  · a buy in the launch block: ${early}`);
  // after Clanker's protection (max 2 minutes) trading is normal
  await test.increaseTime({ seconds: 180 }); await test.mine({ blocks: 5 });

  // which swap format does this chain's Universal Router take?
  const probe = async (np) => pub.call({ account: trader.address, to: UR, data: swapCall(key, !coinIs0, buyIn, 1n, np) }).then(() => "ok", (e) => `${e.shortMessage ?? e.message}`.split("\n")[0].slice(0, 140));
  const pOld = await probe(false), pNew = await probe(true);
  console.log(`  · router format: classic ${pOld} | new ${pNew}`);
  assert.ok(pOld === "ok" || pNew === "ok", "no swap format works on this router");
  NEW_PARAMS = pOld !== "ok";
  ok(`Universal Router swap format: ${NEW_PARAMS ? "new (minHopPriceX36)" : "classic"}`);
  const w0 = await bal(k.paired, trader.address);
  await wTrader.sendTransaction({ to: UR, data: swapCall(key, !coinIs0, buyIn, 1n), gas: 1_500_000n }).then(mined);
  const coins = await bal(coin, trader.address);
  assert.ok(coins > 0n); ok(`$20 buy: ${Number(formatUnits(coins, 18)).toFixed(0)} coins`);
  await wTrader.writeContract({ address: coin, abi: ERC20, functionName: "approve", args: [PERMIT2, maxUint256] }).then(mined);
  await wTrader.writeContract({ address: PERMIT2, abi: PERMIT2_ABI, functionName: "approve", args: [coin, UR, 2n ** 160n - 1n, 2n ** 48n - 1n] }).then(mined);
  await wTrader.sendTransaction({ to: UR, data: swapCall(key, coinIs0, coins, 1n), gas: 1_500_000n }).then(mined);
  const w1 = await bal(k.paired, trader.address);
  assert.equal(await bal(coin, trader.address), 0n);
  const lossPct = (Number(w0 - w1) / Number(buyIn)) * 100;
  console.log(`  · round trip cost ${lossPct.toFixed(2)}% (fees 1% + Clanker 0.2% each way, plus price impact)`);
  assert.ok(lossPct > 1.5 && lossPct < 6, "round trip cost off"); ok("sell back works");
  // a few more trades so both sides carry fees
  for (let i = 0; i < 3; i++) {
    await wTrader.sendTransaction({ to: UR, data: swapCall(key, !coinIs0, buyIn, 1n), gas: 1_500_000n }).then(mined);
    const c = await bal(coin, trader.address);
    await wTrader.sendTransaction({ to: UR, data: swapCall(key, coinIs0, c, 1n), gas: 1_500_000n }).then(mined);
  }

  // ---- 5. rewards: collect, check the 50/50 split in WETH/WBNB, claim
  await wTrader.writeContract({ address: locker, abi: LOCKER_ABI, functionName: "collectRewards", args: [coin], gas: 3_000_000n }).then(mined);
  const fu = await pub.readContract({ address: k.feeLocker, abi: FEELOCKER_ABI, functionName: "availableFees", args: [user, k.paired] });
  const ft = await pub.readContract({ address: k.feeLocker, abi: FEELOCKER_ABI, functionName: "availableFees", args: [ARKHAMPAD_TREASURY, k.paired] });
  const fuCoin = await pub.readContract({ address: k.feeLocker, abi: FEELOCKER_ABI, functionName: "availableFees", args: [user, coin] });
  const volUsd = 20 * 2 * 4;
  console.log(`  · rewards: creator ${formatEther(fu)} / ArkhamPad ${formatEther(ft)} ${NATIVE} ($${(Number(formatEther(fu)) * usd).toFixed(3)} each on $${volUsd} volume); creator in coin: ${formatEther(fuCoin)}`);
  assert.ok(fu > 0n && ft > 0n, "no rewards");
  const diff = Number(fu > ft ? fu - ft : ft - fu) / Number(fu);
  assert.ok(diff < 0.01, "rewards not 50/50"); ok("rewards split 50/50");
  assert.equal(fuCoin, 0n); ok(`rewards paid in ${NATIVE === "BNB" ? "WBNB" : "WETH"} only`);
  const perSide = (Number(formatEther(fu)) * usd) / volUsd * 100;
  assert.ok(perSide > 0.35 && perSide < 0.65, `reward rate ${perSide}%`); ok(`each side earns ${perSide.toFixed(2)}% of volume`);
  const ub = await bal(k.paired, user);
  await wTrader.writeContract({ address: k.feeLocker, abi: FEELOCKER_ABI, functionName: "claim", args: [user, k.paired] }).then(mined);
  assert.equal((await bal(k.paired, user)) - ub, fu); ok("creator rewards claimed to the creator's wallet");
  console.log(`\nALL CHECKS PASSED on chain ${CHAIN_ID}`);
}

main().catch((e) => { console.error(`\nFAILED: ${e.stack ?? e}`); process.exit(1); });
