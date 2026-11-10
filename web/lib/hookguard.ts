// Hook guard — some coins' pool hooks can take a seller's whole payout (the hook checks a whitelist and keeps
// the output for everyone not on it). Nov 10: KPURR did exactly that to a user. Two layers:
//  1) DENY_HOOKS: known bad hooks, hidden from every list and blocked for trading.
//  2) a code check: a hook whose code contains the isWhitelist(address) selector is treated the same way.
// The code check fails open (a flaky RPC never blocks a normal coin).
import type { Address } from "viem";

export const DENY_HOOKS = new Set(["0x423086612f5ffa9d9532241caffcf03124dfc144"]);
const WL_SELECTORS = ["c683630d"]; // isWhitelist(address)
const memo = new Map<string, Promise<boolean>>();

export const isDeniedHook = (h?: string | null) => !!h && DENY_HOOKS.has(h.toLowerCase());

/** true when the hook can block sellers (denied, or its code asks "is this wallet whitelisted?"). */
export function hookGated(h?: string | null): Promise<boolean> {
  const a = (h || "").toLowerCase();
  if (!a || /^0x0+$/.test(a)) return Promise.resolve(false);
  if (DENY_HOOKS.has(a)) return Promise.resolve(true);
  let p = memo.get(a);
  if (!p) {
    p = import("./elytrade").then(({ ely }) => ely().getCode({ address: a as Address })).then((c) => !!c && WL_SELECTORS.some((s) => c.toLowerCase().includes(s))).catch(() => false);
    memo.set(a, p);
  }
  return p;
}
