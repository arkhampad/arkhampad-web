// Read-only: finds the deep USDC <-> ETH/BNB pools on a chain for ArkhamPad's own Clanker route
// (nothing is sent, nothing is spent). Prints, per candidate pool: does it exist, its price,
// and how many dollars move its price by 1% (depth). Also prints the pools KyberSwap itself
// uses for USDC <-> WETH, and our live Clanker coin's pool key.
import { createPublicClient, http, encodeAbiParameters, keccak256, getAddress, hexToBigInt, parseAbi } from "viem";
import { clankerOf, lockersOf } from "../clanker.mjs";

const POOLKEY = [{ type: "address" }, { type: "address" }, { type: "uint24" }, { type: "int24" }, { type: "address" }];
const PM = { 8453: "0x498581fF718922c3f8e6A244956aF099B2652b2b", 56: "0x28e2Ea090877bF75740558f6BFB36A5ffeE9e9dF", 4663: "0x8366a39CC670B4001A1121B8F6A443A643e40951" };
const USDC = { 8453: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", 56: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d", 4663: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168" };
const V3 = { 8453: { uniswap: "0x33128a8fC17869897dcE68Ed026d694621f6FDfD" }, 56: { uniswap: "0xdB1d10011AD0Ff90774D0C6Bb92e5C5c8b4461F7", pancake: "0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865" }, 4663: {} };
const LIVE = { 8453: "0xcfe1aeb9cc8b00795194e9878a4fade0cebb60a1", 56: "0x09456868a05eb1fe084603e41a241dc0da626305", 4663: "0x1a087dc194727c474292a84cd68d93b7c11d94f2" };
const SLUG = { 8453: "base", 56: "bsc", 4663: "robinhood" };
const LOCKER_ABI = [{ type: "function", name: "tokenRewards", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "tuple", components: [
  { name: "token", type: "address" }, { name: "poolKey", type: "tuple", components: [{ name: "currency0", type: "address" }, { name: "currency1", type: "address" }, { name: "fee", type: "uint24" }, { name: "tickSpacing", type: "int24" }, { name: "hooks", type: "address" }] },
  { name: "positionId", type: "uint256" }, { name: "numPositions", type: "uint256" }, { name: "rewardBps", type: "uint16[]" }, { name: "rewardAdmins", type: "address[]" }, { name: "rewardRecipients", type: "address[]" }] }] }];
const EXT = parseAbi(["function extsload(bytes32) view returns (bytes32)"]);
const ERC = parseAbi(["function decimals() view returns (uint8)", "function balanceOf(address) view returns (uint256)"]);
const V3F = parseAbi(["function getPool(address,address,uint24) view returns (address)"]);
const V3P = parseAbi(["function liquidity() view returns (uint128)", "function slot0() view returns (uint160,int24,uint16,uint16,uint16,uint32,bool)"]);

export async function routeProbe(chainId, rpc) {
  const pub = createPublicClient({ transport: http(rpc, { timeout: 30_000, retryCount: 2 }) });
  const k = clankerOf(chainId);
  const usdc = getAddress(USDC[chainId]), weth = k.paired, pm = getAddress(PM[chainId]);
  const usdcDec = Number(await pub.readContract({ address: usdc, abi: ERC, functionName: "decimals" }));
  console.log(`\n=== route probe chain ${chainId}: USDC ${usdc} (${usdcDec} dec) · wrapped native ${weth} · PoolManager ${pm}`);
  // ---- Uniswap v4 pools (no hook) for native/USDC and wrapped/USDC
  for (const [label, other] of [["native", "0x0000000000000000000000000000000000000000"], ["wrapped", weth]]) {
    for (const [fee, ts] of [[100, 1], [500, 10], [3000, 60], [10000, 200]]) {
      const [c0, c1] = BigInt(other) < BigInt(usdc) ? [other, usdc] : [usdc, other];
      const id = keccak256(encodeAbiParameters(POOLKEY, [c0, c1, fee, ts, "0x0000000000000000000000000000000000000000"]));
      const slot = hexToBigInt(keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "uint256" }], [id, 6n])));
      const s0 = hexToBigInt(await pub.readContract({ address: pm, abi: EXT, functionName: "extsload", args: [`0x${slot.toString(16).padStart(64, "0")}`] }));
      const sqrtP = s0 & ((1n << 160n) - 1n);
      if (sqrtP === 0n) { console.log(`  v4 ${label}/USDC fee ${fee}: none`); continue; }
      const L = hexToBigInt(await pub.readContract({ address: pm, abi: EXT, functionName: "extsload", args: [`0x${(slot + 3n).toString(16).padStart(64, "0")}`] })) & ((1n << 128n) - 1n);
      const sp = Number(sqrtP) / 2 ** 96; // sqrt(token1/token0) in raw units
      const usdcIs1 = c1 === usdc;
      const ethUsd = usdcIs1 ? sp * sp * 10 ** (18 - usdcDec) : (1 / (sp * sp)) * 10 ** (18 - usdcDec);
      const depth = usdcIs1 ? (Number(L) * sp * 0.005) / 10 ** usdcDec : (Number(L) / sp * 0.005) / 10 ** usdcDec;
      console.log(`  v4 ${label}/USDC fee ${fee}: price $${ethUsd.toFixed(2)} · ~$${Math.round(depth)} moves it 1% · id ${id}`);
    }
  }
  // ---- Uniswap v3 / PancakeSwap v3 pools for wrapped/USDC
  for (const [name, f] of Object.entries(V3[chainId] ?? {})) {
    for (const fee of [100, 500, 2500, 3000, 10000]) {
      const pool = await pub.readContract({ address: f, abi: V3F, functionName: "getPool", args: [usdc, weth, fee] }).catch(() => null);
      if (!pool || BigInt(pool) === 0n) continue;
      const [ub, wb] = await Promise.all([pub.readContract({ address: usdc, abi: ERC, functionName: "balanceOf", args: [pool] }), pub.readContract({ address: weth, abi: ERC, functionName: "balanceOf", args: [pool] })]);
      console.log(`  v3 ${name} wrapped/USDC fee ${fee}: ${pool} · holds $${Math.round(Number(ub) / 10 ** usdcDec)} USDC + ${(Number(wb) / 1e18).toFixed(2)} wrapped`);
    }
  }
  // ---- the pools KyberSwap itself uses for USDC <-> wrapped native
  for (const [a, b, amt, what] of [[usdc, weth, 100n * 10n ** BigInt(usdcDec), "$100 USDC -> wrapped"], [weth, usdc, 10n ** 16n, "0.01 wrapped -> USDC"]]) {
    const r = await fetch(`https://aggregator-api.kyberswap.com/${SLUG[chainId]}/api/v1/routes?tokenIn=${a}&tokenOut=${b}&amountIn=${amt}&excludeRFQSources=true`, { headers: { "x-client-id": "arkhampad" } }).then((x) => x.json()).catch(() => null);
    const s = r?.data?.routeSummary;
    if (!s) { console.log(`  KyberSwap ${what}: no route (${r?.message ?? "?"})`); continue; }
    console.log(`  KyberSwap ${what}: out ${s.amountOut}`);
    for (const path of s.route ?? []) for (const h of path) console.log(`    hop ${h.exchange} pool ${h.pool} ${h.tokenIn.slice(0, 8)} -> ${h.tokenOut.slice(0, 8)} swapAmount ${h.swapAmount}`);
  }
  // ---- our live Clanker coin's pool key (read from the Clanker locker)
  const coin = getAddress(LIVE[chainId]);
  for (const locker of lockersOf(chainId)) {
    const info = await pub.readContract({ address: locker, abi: LOCKER_ABI, functionName: "tokenRewards", args: [coin] }).catch(() => null);
    if (!info || getAddress(info.token) !== coin) continue;
    const kk = info.poolKey;
    console.log(`  live coin ${coin} locker ${locker} key c0 ${kk.currency0} c1 ${kk.currency1} fee ${kk.fee} ts ${kk.tickSpacing} hooks ${kk.hooks}`);
    break;
  }
}
