// ArkhamPad coins launched through Clanker v4 (Base, BNB, Robinhood).
// The coin is a normal Clanker token paired with the chain's own coin (WETH / WBNB), so
// DexScreener, GMGN and trading bots see it the moment it is created.
//
// Everything Clanker-specific is built by the official clanker-sdk (pinned version), so the
// contract addresses and the encoding are exactly what Clanker itself uses.
// Our choices: 1% trading fee, rewards 50% creator / 50% ArkhamPad paid in WETH/WBNB,
// first market cap about $4.8K, the creator's first buy goes to the creator.
import { decodeEventLog, encodeFunctionData, getAddress } from "viem";
import { Clanker } from "clanker-sdk/v4";
import { clankerConfigFor, WETH_ADDRESSES } from "clanker-sdk";

export const CLANKER_CHAINS = [8453, 56, 4663];
export const START_MC_USD = 4800;
export const FEE_BPS = 100; // 1% on each side of the pool
export const SUPPLY = 100_000_000_000n * 10n ** 18n;
const TICK_SPACING = 200;
const TICK_TOP = -120000; // Clanker's standard position top (about $1.5B at ETH $3-4K)
export const ARKHAMPAD_ADMIN = "0xfae9d1aBac2a9fd4Ab68af9fF346eA871E819158";
export const ARKHAMPAD_TREASURY = "0xd9D46EB26c9D753135683b7736FC2be097e7B099";

export function clankerOf(chainId) {
  const c = clankerConfigFor(Number(chainId), "clanker_v4");
  if (!c?.related) throw new Error(`Clanker is not available on chain ${chainId}`);
  return { factory: getAddress(c.address), locker: getAddress(c.related.locker), feeLocker: getAddress(c.related.feeLocker), devbuy: getAddress(c.related.devbuy), hook: getAddress(c.related.feeStaticHookV2 || c.related.feeStaticHook), paired: getAddress(WETH_ADDRESSES[Number(chainId)]) };
}

/**
 * Pool starting tick for a first market cap of `mcUsd` (whole supply), as if the coin were token0.
 * Price of one coin in WETH = 1.0001^tick; supply is 100B coins.
 */
export function startTick(nativeUsd, mcUsd = START_MC_USD) {
  if (!(nativeUsd > 0)) throw new Error("native price missing");
  const p = mcUsd / nativeUsd / 1e11;
  const t = Math.round(Math.log(p) / Math.log(1.0001) / TICK_SPACING) * TICK_SPACING;
  if (t >= TICK_TOP || t < -887200) throw new Error("bad starting tick");
  return t;
}

/** Market cap in dollars at a tick (coin-as-token0 convention). */
export const mcAtTick = (tick, nativeUsd) => Math.pow(1.0001, tick) * 1e11 * nativeUsd;

const clean = (s, max) => String(s ?? "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, max);

/**
 * The Clanker deployToken transaction for one ArkhamPad coin.
 * @returns {{ to, data, value, abi, args, tick }}
 */
export async function deployTx({ chainId, name, symbol, image, description, coinUrl, user, devBuyWei, nativeUsd, treasury = ARKHAMPAD_TREASURY, admin = ARKHAMPAD_ADMIN }) {
  chainId = Number(chainId);
  if (!CLANKER_CHAINS.includes(chainId)) throw new Error(`Clanker launches are not open on chain ${chainId}`);
  const k = clankerOf(chainId);
  const tick = startTick(nativeUsd);
  const owner = getAddress(user);
  const desc = clean(description, 900);
  const sdk = new Clanker();
  const tx = await sdk.getDeployTransaction({
    chainId,
    name: clean(name, 32),
    symbol: clean(symbol, 10),
    image: String(image ?? ""),
    tokenAdmin: owner,
    metadata: {
      description: `${desc}${desc ? "\n\n" : ""}Launched on ArkhamPad`,
      socialMediaUrls: coinUrl ? [{ platform: "website", url: String(coinUrl) }] : [],
    },
    context: { interface: "ArkhamPad", platform: "ArkhamPad", messageId: String(coinUrl ?? ""), id: owner },
    pool: { pairedToken: "WETH", tickIfToken0IsClanker: tick, tickSpacing: TICK_SPACING, positions: [{ tickLower: tick, tickUpper: TICK_TOP, positionBps: 10_000 }] },
    fees: { type: "static", clankerFee: FEE_BPS, pairedFee: FEE_BPS },
    rewards: { recipients: [
      { admin: owner, recipient: owner, bps: 5_000, token: "Paired" },
      { admin: getAddress(admin), recipient: getAddress(treasury), bps: 5_000, token: "Paired" },
    ] },
    // placeholder amount: replaced below by the exact wei (the SDK multiplies a float by 1e18)
    ...(devBuyWei > 0n ? { devBuy: { ethAmount: 1, recipient: owner } } : {}),
  });
  const cfg = tx.args[0];
  // exact first-buy amount, in wei
  if (devBuyWei > 0n) {
    const ext = cfg.extensionConfigs.find((e) => getAddress(e.extension) === k.devbuy);
    if (!ext || cfg.extensionConfigs.length !== 1) throw new Error("devBuy extension missing");
    ext.msgValue = devBuyWei;
  }
  const value = devBuyWei > 0n ? devBuyWei : 0n;
  // safety: everything must point at Clanker's own contracts for this chain
  if (getAddress(tx.address) !== k.factory || getAddress(cfg.lockerConfig.locker) !== k.locker || getAddress(cfg.poolConfig.hook) !== k.hook || getAddress(cfg.poolConfig.pairedToken) !== k.paired) throw new Error("Clanker config mismatch");
  const data = encodeFunctionData({ abi: tx.abi, functionName: "deployToken", args: [cfg] });
  return { to: k.factory, data, value, abi: tx.abi, args: [cfg], tick };
}

/** Reads the TokenCreated event from a deploy receipt. */
export function parseCreated(chainId, logs, abi) {
  const k = clankerOf(chainId);
  for (const l of logs) {
    if (getAddress(l.address) !== k.factory) continue;
    try {
      const ev = decodeEventLog({ abi, data: l.data, topics: l.topics });
      if (ev.eventName === "TokenCreated") return ev.args;
    } catch { /* other event */ }
  }
  return null;
}
