// Read-only look at REAL Clanker coins on a chain (nothing is sent, nothing is spent):
// takes coins Clanker launched a few hours ago and asks DexScreener, GeckoTerminal and the
// KyberSwap aggregator about each one. Answers: do screeners list Clanker coins on this chain,
// and can ArkhamPad's one-tap trading (KyberSwap route from USDC) reach them?
//   CHAIN_ID=8453 RPC=... node test/clanker-probe.mjs
import { createPublicClient, http } from "viem";
import { clankerOf, TOKEN_CREATED } from "../clanker.mjs";

const CHAIN_ID = Number(process.env.CHAIN_ID || 8453);
const RPC = String(process.env.RPC || "").split(",")[0].trim();
const SLUG = { 8453: { dex: "base", gt: "base", kyber: "base" }, 56: { dex: "bsc", gt: "bsc", kyber: "bsc" }, 4663: { dex: "robinhood", gt: "robinhood", kyber: "robinhood" } }[CHAIN_ID];
const USDC = { 8453: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", 56: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d", 4663: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168" }[CHAIN_ID];
const USDC_DEC = CHAIN_ID === 56 ? 18 : 6;
const pub = createPublicClient({ transport: http(RPC, { timeout: 30_000, retryCount: 2 }) });
const k = clankerOf(CHAIN_ID);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const getJson = async (url, headers = {}) => { try { const r = await fetch(url, { headers, signal: AbortSignal.timeout(15_000) }); return { status: r.status, j: await r.json().catch(() => null) }; } catch (e) { return { status: 0, j: null, err: e.message }; } };

async function blockAt(secondsAgo) {
  const tip = await pub.getBlock();
  const old = await pub.getBlock({ blockNumber: tip.number - 10_000n });
  const per = Number(tip.timestamp - old.timestamp) / 10_000; // seconds per block
  return { tip: tip.number, at: tip.number - BigInt(Math.round(secondsAgo / per)), per };
}

async function main() {
  console.log(`Chain ${CHAIN_ID} · Clanker factory ${k.factory}`);
  const { at, per } = await blockAt(3 * 3600); // coins from ~3 hours ago and earlier
  console.log(`block time ~${per.toFixed(2)}s, looking back from block ${at}`);
  const found = [];
  let to = at;
  const STEP = 500n;
  for (let i = 0; i < 400 && found.length < 12; i++) {
    const from = to - STEP + 1n;
    const logs = await pub.getLogs({ address: k.factory, event: TOKEN_CREATED, fromBlock: from, toBlock: to }).catch((e) => { console.log(`  getLogs ${from}-${to}: ${e.shortMessage ?? e.message}`); return []; });
    for (const l of logs) found.push({ token: l.args.tokenAddress, name: l.args.tokenName, paired: l.args.pairedToken, ctx: l.args.tokenContext, block: l.blockNumber });
    to = from - 1n;
  }
  console.log(`found ${found.length} Clanker v4 coins`);
  let dexYes = 0, gtYes = 0, kyberYes = 0, wethPaired = 0;
  for (const f of found.slice(0, 12)) {
    const isWeth = f.paired.toLowerCase() === k.paired.toLowerCase();
    if (isWeth) wethPaired++;
    let iface = ""; try { iface = JSON.parse(f.ctx).interface ?? ""; } catch { /* */ }
    const dex = await getJson(`https://api.dexscreener.com/latest/dex/tokens/${f.token}`);
    const pairs = (dex.j?.pairs ?? []).filter((p) => p.chainId === SLUG.dex);
    const gt = await getJson(`https://api.geckoterminal.com/api/v2/networks/${SLUG.gt}/tokens/${f.token}/pools`);
    const gtPools = gt.j?.data?.length ?? 0;
    const amt = 10n * 10n ** BigInt(USDC_DEC); // $10
    const ky = await getJson(`https://aggregator-api.kyberswap.com/${SLUG.kyber}/api/v1/routes?tokenIn=${USDC}&tokenOut=${f.token}&amountIn=${amt}`, { "x-client-id": "arkhampad" });
    const route = ky.j?.data?.routeSummary;
    const exchanges = route ? [...new Set((route.route ?? []).flat().map((h) => h.exchange))].join("+") : "";
    if (pairs.length) dexYes++;
    if (gtPools) gtYes++;
    if (route && BigInt(route.amountOut || "0") > 0n) kyberYes++;
    console.log(`- ${f.name.slice(0, 24).padEnd(24)} ${f.token} paired=${isWeth ? "WETH" : f.paired.slice(0, 8)} via=${iface.slice(0, 14) || "?"} | DexScreener ${pairs.length ? `yes (${pairs[0].dexId}, liq $${Math.round(pairs[0].liquidity?.usd ?? 0)})` : `no (${dex.status})`} | Gecko ${gtPools ? "yes" : `no (${gt.status})`} | Kyber ${route ? `yes ${exchanges}` : `no (${ky.status} ${ky.j?.message ?? ""})`}`);
    await sleep(400);
  }
  const n = Math.min(found.length, 12);
  console.log(`\nSUMMARY chain ${CHAIN_ID}: of ${n} Clanker coins: DexScreener ${dexYes}/${n}, GeckoTerminal ${gtYes}/${n}, KyberSwap route ${kyberYes}/${n}, paired with WETH/WBNB ${wethPaired}/${n}`);
}
main().catch((e) => { console.error(`FAILED: ${e.stack ?? e}`); process.exit(1); });
