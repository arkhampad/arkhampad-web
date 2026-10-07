// Math for ArkhamPad coins' locked Uniswap v4 pools (every coin opens in one at launch).
import { getAddress, keccak256, encodeAbiParameters, parseAbiParameters } from "viem";

/** v4 dynamic-fee flag: the pool's fee is set by the hook on every swap (30% -> 2%). */
export const DYNAMIC_FEE = 0x800000;

/** Uniswap v4 pool id of a coin's locked pool (same as PadPoolBuilder.poolKeyFor(coin).toId()). */
export function poolIdOf(usdc, coin, guard, fee = DYNAMIC_FEE) {
  const u0 = BigInt(usdc) < BigInt(coin);
  const [c0, c1] = u0 ? [usdc, coin] : [coin, usdc];
  return keccak256(encodeAbiParameters(parseAbiParameters("address,address,uint24,int24,address"), [getAddress(c0), getAddress(c1), fee, 200, getAddress(guard)]));
}

/** One pool Swap event -> trade numbers (coins have 18 decimals, the dollar token `dec`).
 * `args.fee` is the fee this swap paid, in millionths (300000 = 30%); the dollar value of
 * the fee is that share of the trade's dollar side. */
export function poolTrade(args, usdcIs0, dec = 6) {
  const du = usdcIs0 ? args.amount0 : args.amount1;
  const dc = usdcIs0 ? args.amount1 : args.amount0;
  const abs = (x) => (x < 0n ? -x : x);
  const sp = Number(args.sqrtPriceX96) / 2 ** 96;
  const ratio = sp * sp; // currency1 per currency0, raw units
  const scale = 10 ** (18 - dec); // coins have 18 decimals, the dollar token `dec`
  const price = usdcIs0 ? scale / ratio : ratio * scale; // dollars per coin
  const usdc = Number(abs(du)) / 10 ** dec;
  const feeRate = args.fee === undefined || args.fee === null ? 0.01 : Number(args.fee) / 1e6;
  return { isBuy: du < 0n, usdc, coins: Number(abs(dc)) / 1e18, fee: usdc * feeRate, feeRate, price };
}
