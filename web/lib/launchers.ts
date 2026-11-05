"use client";
// ArkhamPad's two launchers on Elysium.
//   version 1 (NEXT_PUBLIC_ELY_LAUNCHER): every coin launched until version 2 went live; creator 30% forever.
//   version 2 (NEXT_PUBLIC_ELY_LAUNCHER2): the "25K" fee rules (contracts-elysium/src/ArkhamV3LauncherV2.sol).
// Until version 2 is deployed (no address), everything runs on version 1 exactly as before.
import { parseAbi, type Address } from "viem";
import { ely } from "./elytrade";

export const LAUNCHER1 = (process.env.NEXT_PUBLIC_ELY_LAUNCHER || "") as Address | "";
export const LAUNCHER2 = (process.env.NEXT_PUBLIC_ELY_LAUNCHER2 || "") as Address | "";
/** Where new coins launch: version 2 once it is deployed, version 1 until then. */
export const CREATE_LAUNCHER = (LAUNCHER2 || LAUNCHER1) as Address | "";
export const V2_LIVE = !!LAUNCHER2;

const COINS = parseAbi(["function coins(address) view returns (uint256 tokenId, address pool, address creator, uint16 creatorBps, bool coinIsToken0)"]);
const STATUS = parseAbi([
  "function status(address coin) view returns (uint8 level, uint16 creatorBps, uint16 heldBps, uint256 marketCapNow, uint256 level1, uint256 level2, uint256 launchedAt, uint256 aboveSince, uint256 heldNative, uint256 heldCoin, bool heldSettled)",
]);

const known = new Map<string, Address>();
/**
 * The launcher a coin belongs to (for "Collect fees"): version 2 if it has the coin, else version 1.
 * Only a definite answer is remembered, so a node hiccup is simply asked again next time.
 */
export async function launcherOf(coin: string): Promise<Address | ""> {
  const k = coin.toLowerCase();
  const hit = known.get(k);
  if (hit) return hit;
  if (LAUNCHER2) {
    try {
      const c = (await ely().readContract({ address: LAUNCHER2, abi: COINS, functionName: "coins", args: [k as Address] })) as readonly [bigint, Address, Address, number, boolean];
      if (c[1] && !/^0x0{40}$/i.test(c[1])) { known.set(k, LAUNCHER2); return LAUNCHER2; }
      if (LAUNCHER1) known.set(k, LAUNCHER1);
    } catch {
      return LAUNCHER1; // couldn't ask: version 1 for now, ask again next time
    }
  }
  return LAUNCHER1;
}

export type FeeStatus = {
  level: 0 | 1 | 2;
  creatorPct: number; // the creator's share of fees right now
  heldPct: number; // part held for the creator right now
  mc: number; // market cap now, HYPE
  level1: number; // HYPE
  level2: number; // HYPE
  launchedAt: number; // ms
  aboveSince: number; // ms, 0 = not above level 1 right now
  heldHype: number; // held for the creator, HYPE
  heldCoin: number; // held for the creator, in the coin
  heldSettled: boolean;
  windowEnds: number; // ms: the end of the first 24 hours
};
export const HOLD_MS = 3600_000;
export const WINDOW_MS = 24 * 3600_000;

/** A version-2 coin's fee status, or null for a version-1 coin (or when version 2 isn't live). */
export async function feeStatus(coin: string): Promise<FeeStatus | null> {
  if (!LAUNCHER2) return null;
  if ((await launcherOf(coin)) !== LAUNCHER2) return null;
  const r = (await ely().readContract({ address: LAUNCHER2, abi: STATUS, functionName: "status", args: [coin as Address] })) as readonly [number, number, number, bigint, bigint, bigint, bigint, bigint, bigint, bigint, boolean];
  const launchedAt = Number(r[6]) * 1000;
  return {
    level: (r[0] === 2 ? 2 : r[0] === 1 ? 1 : 0),
    creatorPct: r[1] / 100,
    heldPct: r[2] / 100,
    mc: Number(r[3]) / 1e18,
    level1: Number(r[4]) / 1e18,
    level2: Number(r[5]) / 1e18,
    launchedAt,
    aboveSince: Number(r[7]) * 1000,
    heldHype: Number(r[8]) / 1e18,
    heldCoin: Number(r[9]) / 1e18,
    heldSettled: r[10],
    windowEnds: launchedAt + WINDOW_MS,
  };
}
