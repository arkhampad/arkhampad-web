// Math for graduated coins' locked Uniswap v4 pools.
import { getAddress, keccak256, encodeAbiParameters, parseAbiParameters } from "viem";

/** Uniswap v4 pool id of a graduated coin's locked pool (same as PadPoolBuilder.poolKeyFor(coin).toId()). */
export function poolIdOf(usdc, coin, guard) {
  const u0 = BigInt(usdc) < BigInt(coin);
  const [c0, c1] = u0 ? [usdc, coin] : [coin, usdc];
  return keccak256(encodeAbiParameters(parseAbiParameters("address,address,uint24,int24,address"), [getAddress(c0), getAddress(c1), 10_000, 200, getAddress(guard)]));
}

/** One pool Swap event -> trade numbers (coins have 18 decimals, the dollar token `dec`). */
export function poolTrade(args, usdcIs0, dec = 6) {
  const du = usdcIs0 ? args.amount0 : args.amount1;
  const dc = usdcIs0 ? args.amount1 : args.amount0;
  const abs = (x) => (x < 0n ? -x : x);
  const sp = Number(args.sqrtPriceX96) / 2 ** 96;
  const ratio = sp * sp; // currency1 per currency0, raw units
  const scale = 10 ** (18 - dec); // coins have 18 decimals, the dollar token `dec`
  const price = usdcIs0 ? scale / ratio : ratio * scale; // dollars per coin
  const usdc = Number(abs(du)) / 10 ** dec;
  return { isBuy: du < 0n, usdc, coins: Number(abs(dc)) / 1e18, fee: usdc * 0.01, price };
}
