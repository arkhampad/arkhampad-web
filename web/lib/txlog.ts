"use client";
// Transaction recovery: every trade sent from this browser is written down (hash, what it was, when), so a
// trade whose page was closed, reloaded or timed out never leaves the user guessing. The coin page shows the
// unresolved ones with their real status read from the chain: still on its way, went through, or failed.
// A trade that never got a hash was never sent: the trade box says so plainly ("nothing left your wallet").
import { useEffect, useState } from "react";
import type { Hex } from "viem";
import { elyRpc } from "./elytrade";

export type TxEntry = { hash: string; label: string; token: string; at: number; state: "pending" | "ok" | "failed"; seen?: boolean };
const key = (me: string) => `ap_txlog_${me.toLowerCase()}`;
const EV = "ap:txlog";

function read(me: string): TxEntry[] {
  try { const v = localStorage.getItem(key(me)); return v ? (JSON.parse(v) as TxEntry[]) : []; } catch { return []; }
}
function write(me: string, list: TxEntry[]) {
  try { localStorage.setItem(key(me), JSON.stringify(list.slice(0, 20))); } catch {}
  try { window.dispatchEvent(new CustomEvent(EV, { detail: me.toLowerCase() })); } catch {}
}

/** A trade the network has accepted: remember it until its result is known. */
export function logTx(me: string | null | undefined, e: { hash: string; label: string; token: string }) {
  if (!me) return;
  const list = read(me).filter((x) => x.hash !== e.hash);
  write(me, [{ ...e, at: Date.now(), state: "pending" }, ...list]);
}
export function setTxState(me: string | null | undefined, hash: string, state: TxEntry["state"]) {
  if (!me) return;
  write(me, read(me).map((x) => (x.hash === hash ? { ...x, state } : x)));
}
export function dismissTx(me: string, hash: string) {
  write(me, read(me).map((x) => (x.hash === hash ? { ...x, seen: true } : x)));
}

/** Asks the chain what happened to one transaction. */
export async function txStatus(hash: string): Promise<TxEntry["state"]> {
  const r = await elyRpc<{ status?: string } | null>("eth_getTransactionReceipt", [hash as Hex]).catch(() => null);
  if (!r) return "pending";
  return r.status === "0x1" ? "ok" : "failed";
}

/** Unresolved or just-resolved trades of this wallet (optionally only one coin), re-checked every 8 s. */
export function useTxLog(me: string | null | undefined, token?: string) {
  const [list, setList] = useState<TxEntry[]>([]);
  useEffect(() => {
    if (!me) { setList([]); return; }
    const k = me.toLowerCase();
    const load = () => setList(read(k).filter((x) => !x.seen && (!token || x.token === token.toLowerCase()) && Date.now() - x.at < 24 * 3600e3));
    load();
    const on = (e: Event) => { if ((e as CustomEvent).detail === k) load(); };
    window.addEventListener(EV, on);
    let alive = true;
    const check = async () => {
      for (const x of read(k).filter((y) => y.state === "pending" && Date.now() - y.at < 24 * 3600e3)) {
        const s = await txStatus(x.hash);
        if (!alive) return;
        if (s !== "pending") setTxState(k, x.hash, s);
      }
    };
    check();
    const id = setInterval(check, 8000);
    return () => { alive = false; clearInterval(id); window.removeEventListener(EV, on); };
  }, [me, token]);
  return list;
}

export const EXPLORER_TX = (hash: string) => {
  const base = process.env.NEXT_PUBLIC_ELY_EXPLORER || "";
  return base ? `${base}/tx/${hash}` : `https://elysium.kinetiq.xyz/explorer/transaction/${hash}`;
};
