import { test } from "node:test";
import assert from "node:assert/strict";
import { poolIdOf, poolTrade } from "../poolmath.mjs";

test("pool id matches Solidity PoolKey.toId()", () => {
  // values printed by forge tests with the same keys: v1 (1% fixed fee) and v2 (dynamic fee)
  assert.equal(poolIdOf("0x036CbD53842c5426634e7929541eC2318f3dCF7e", "0x7a3f9b21c4e8d07a5f61b2c93e40d1a8f2b6c91e", "0xFe92db0aF76Eb08B553a3FC6aea9A9F1C5D3a000", 10_000),
    "0x37d69f7bc7eb6baa86e3dc59dd029e3393d3678239babacb31a174f7bac49c52");
  assert.equal(poolIdOf("0x036CbD53842c5426634e7929541eC2318f3dCF7e", "0x7a3f9b21c4e8d07a5f61b2c93e40d1a8f2b6c91e", "0xFE92db0aF76EB08b553a3Fc6aEA9a9f1c5d3A080"),
    "0x797c65b33a4897eee6786348cc1ee6f6cde5839ae099cbacb06f2de89544a573");
  // order of the two tokens doesn't matter to the caller
  assert.equal(poolIdOf("0x036CbD53842c5426634e7929541eC2318f3dCF7e", "0x7a3f9b21c4e8d07a5f61b2c93e40d1a8f2b6c91e", "0xFe92db0aF76Eb08B553a3FC6aea9A9F1C5D3a000"),
    poolIdOf("0x036cbd53842c5426634e7929541ec2318f3dcf7e", "0x7A3f9B21c4E8D07A5f61B2c93E40D1A8f2b6c91e", "0xfe92db0af76eb08b553a3fc6aea9a9f1c5d3a000"));
});

test("fee comes from the swap: 30% launch fee and 2% normal fee", () => {
  const sqrt = BigInt(Math.round(Math.sqrt(1e18 / 1e6 / 0.0000075) * 2 ** 96));
  const early = poolTrade({ amount0: -100_000_000n, amount1: 1n, sqrtPriceX96: sqrt, fee: 300000 }, true);
  assert.equal(early.fee, 30);
  assert.equal(early.feeRate, 0.3);
  const late = poolTrade({ amount0: -100_000_000n, amount1: 1n, sqrtPriceX96: sqrt, fee: 20000 }, true);
  assert.equal(late.fee, 2);
});

const sqrtFor = (coinPerUsdcRaw) => BigInt(Math.round(Math.sqrt(coinPerUsdcRaw) * 2 ** 96));

test("buy, USDC is currency0 (swapper pays USDC: negative)", () => {
  const price = 0.0000075; // USDC per coin -> $7.5K market cap
  const ratio = (1 / price) * 1e18 / 1e6; // coin raw per USDC raw
  const t = poolTrade({ amount0: -10_000_000n, amount1: 1_300_000n * 10n ** 18n, sqrtPriceX96: sqrtFor(ratio) }, true);
  assert.equal(t.isBuy, true);
  assert.equal(t.usdc, 10);
  assert.equal(t.coins, 1_300_000);
  assert.ok(Math.abs(t.price / price - 1) < 1e-9);
});

test("sell, coin is currency0 (swapper receives USDC: positive)", () => {
  const price = 0.0000123;
  const ratio = price * 1e6 / 1e18; // USDC raw per coin raw
  const t = poolTrade({ amount0: -500_000n * 10n ** 18n, amount1: 6_100_000n, sqrtPriceX96: BigInt(Math.round(Math.sqrt(ratio) * 2 ** 96)) }, false);
  assert.equal(t.isBuy, false);
  assert.equal(t.usdc, 6.1);
  assert.equal(t.coins, 500_000);
  assert.ok(Math.abs(t.price / price - 1) < 1e-6);
});

test("BNB: 18-decimal dollar, sell, coin is currency0", () => {
  const price = 0.0000123;
  const ratio = price; // both 18 decimals: dollar raw per coin raw == price
  const t = poolTrade({ amount0: -500_000n * 10n ** 18n, amount1: 6_100_000_000_000_000_000n, sqrtPriceX96: BigInt(Math.round(Math.sqrt(ratio) * 2 ** 96)) }, false, 18);
  assert.equal(t.isBuy, false);
  assert.equal(t.usdc, 6.1);
  assert.ok(Math.abs(t.price / price - 1) < 1e-6);
});
