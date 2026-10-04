// Math for graduated coins' locked Uniswap v4 pools.
import { getAddress, keccak256, encodeAbiParameters, parseAbiParameters } from "viem";

/** Uniswap v4 pool id of a graduated coin's locked pool (same as PadPoolBuilder.poolKeyFor(coin).toId()). */
export function poolIdOf(usdc, coin, guard) {
  const u0 = BigInt(usdc) < BigInt(coin);
  const [c0, c1] = u0 ? [usdc, coin] : [coin, usdc];
  return keccak256(encodeAbiParameters(parseAbiParameters("address,address,uint24,int24,address"), [getAddress(c0), getAddress(c1), 10_000, 200, getAddress(guard)]));
}

/** One pool Swap event -> trade numbers (USDC has 6 decimals, coins 18). */
export function poolTrade(args, usdcIs0) {
  const du = usdcIs0 ? args.amount0 : args.amount1;
  const dc = usdcIs0 ? args.amount1 : args.amount0;
  const abs = (x) => (x < 0n ? -x : x);
  const sp = Number(args.sqrtPriceX96) / 2 ** 96;
  const ratio = sp * sp; // currency1 per currency0, raw units
  const price = usdcIs0 ? 1e12 / ratio : ratio * 1e12; // USDC per coin
  const usdc = Number(abs(du)) / 1e6;
  return { isBuy: du < 0n, usdc, coins: Number(abs(dc)) / 1e18, fee: usdc * 0.01, price };
}
const usd = (x) => Number(x) / 1e6;
const tok = (x) => Number(x) / 1e18;
const lc = (a) => a.toLowerCase();
const log = (...a) => console.log(new Date().toISOString(), ...a);
