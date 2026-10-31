"use client";
// Invites: arkhampad.com/?r=CODE. The first code a visitor arrives with is remembered in this browser;
// after they log in they confirm it once with a free signature (no gas), and the keeper then pays the
// inviter 0.14% of every trade they make on ArkhamPad coins (20% of ArkhamPad's share).
import type { Signer } from "./chain";

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://yvdudswzmdziwnfurwir.supabase.co";
const SB_KEY = process.env.NEXT_PUBLIC_SUPABASE_KEY || "sb_publishable_S49UWqqXDzSaRbjBsAfYaA_kjfxyRPB";
export const REF_RATE_PCT = 0.14;

async function rpc<T>(fn: string, body: Record<string, unknown>): Promise<T> {
  const r = await fetch(`${SB_URL}/rest/v1/rpc/${fn}`, { method: "POST", headers: { apikey: SB_KEY, authorization: `Bearer ${SB_KEY}`, "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`${fn} ${r.status}`);
  return (await r.json()) as T;
}

export const codeOf = (addr: string) => addr.toLowerCase().slice(2, 10);
export const inviteLink = (addr: string) => `https://arkhampad.com/?r=${codeOf(addr)}`;

/** Remember the first invite code seen in the address bar (first touch wins). */
export function captureRef() {
  try {
    const c = new URLSearchParams(location.search).get("r")?.toLowerCase();
    if (c && /^[0-9a-f]{8}$/.test(c) && !localStorage.getItem("ap_ref")) localStorage.setItem("ap_ref", c);
  } catch {}
}
/** The invite this browser came with that the signed-in wallet hasn't confirmed yet (null if none). */
export function pendingRef(addr: string | null): string | null {
  if (!addr) return null;
  try {
    const c = localStorage.getItem("ap_ref");
    if (!c || c === codeOf(addr)) return null;
    if (localStorage.getItem(`ap_ref_done_${addr.toLowerCase()}`)) return null;
    return c;
  } catch {
    return null;
  }
}
export function dismissRef(addr: string) {
  try { localStorage.setItem(`ap_ref_done_${addr.toLowerCase()}`, "skip"); } catch {}
}

/** Confirm the invite with a free signature, then hand it to the database. */
export async function confirmRef(signer: Signer, code: string) {
  const user = signer.address.toLowerCase();
  const sig = await signer.signTypedData(99901, {
    domain: { name: "ArkhamPad", version: "1", chainId: 99901 },
    types: { Invite: [{ name: "user", type: "address" }, { name: "code", type: "string" }] },
    primaryType: "Invite",
    message: { user, code },
  });
  await rpc<boolean>("ely_ref_claim", { p_user: user, p_code: code, p_sig: sig });
  try { localStorage.setItem(`ap_ref_done_${user}`, "1"); } catch {}
}

export type RefStats = { invited: number; volume: number; earned: number; paid: number };
export async function myRefStats(addr: string): Promise<RefStats> {
  await rpc<string>("ely_ref_code", { p_addr: addr.toLowerCase() }).catch(() => null);
  return rpc<RefStats>("ely_ref_stats", { p_addr: addr.toLowerCase() });
}

/** Your early rank on ArkhamPad (db/031_ely_early.sql): null rank = no trade or launch yet. */
export type Early = { rank: number | null; total: number; since: string | null };
export const fetchEarly = (addr: string) => rpc<Early>("ely_early", { p_addr: addr.toLowerCase() });
