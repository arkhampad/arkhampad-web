"use client";
// Your automatic orders: list, cancel, and a toast when one fills.
import { useCallback, useEffect, useRef, useState } from "react";
import { useApp } from "./shell";
import { useWallet } from "./wallet";
import { TradeError, cancelOrder, myOrders, type Order } from "@/lib/chain";
import { usd } from "@/lib/live";

const LABEL: Record<string, string> = { limit_buy: "Limit buy", take_profit: "Take profit", stop_loss: "Stop loss" };
const listeners = new Set<() => void>();
/** Ask every order list to reload (after placing or cancelling). */
export const refreshOrders = () => listeners.forEach((f) => f());

export function useOrders() {
  const w = useWallet();
  const [orders, setOrders] = useState<Order[] | null>(null);
  const load = useCallback(async () => { if (w.address) setOrders(await myOrders(w.address)); else setOrders([]); }, [w.address]);
  useEffect(() => {
    load();
    listeners.add(load);
    const iv = setInterval(load, 15_000);
    return () => { listeners.delete(load); clearInterval(iv); };
  }, [load]);
  return { orders, reload: load };
}

/** Lives in the shell: tells the user when an order fills, wherever they are on the site. */
export function OrderWatcher() {
  const { orders } = useOrders();
  const { toast } = useApp();
  const w = useWallet();
  const seen = useRef<Map<string, string>>(new Map());
  useEffect(() => {
    if (!orders) return;
    for (const o of orders) {
      const before = seen.current.get(o.id);
      if (before === "open" && o.status !== "open") {
        if (o.status === "filled") { toast(`${LABEL[o.kind]} filled at ${usd(o.trigger_mc)} market cap`); w.refresh(); }
        else if (o.status === "failed") toast(`${LABEL[o.kind]} couldn't fill: ${o.note ?? "please set it again"}`);
      }
      seen.current.set(o.id, o.status);
    }
  }, [orders]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

export function OrdersList({ coin, chainId, title = "Your orders" }: { coin?: string; chainId?: number; title?: string }) {
  const { orders, reload } = useOrders();
  const w = useWallet();
  const { toast } = useApp();
  const [busy, setBusy] = useState("");
  if (!w.signedIn) return null;
  const list = (orders ?? []).filter((o) => (!coin || (o.coin === coin.toLowerCase() && o.chain_id === chainId)) && (coin ? o.status === "open" : true));
  if (coin && list.length === 0) return null;
  const cancel = async (o: Order) => {
    if (!w.signer) return;
    setBusy(o.id);
    try { await cancelOrder(o, w.signer); toast("Order cancelled"); await reload(); }
    catch (e) { toast(e instanceof TradeError ? e.message : "Couldn't cancel the order."); } finally { setBusy(""); }
  };
  return (
    <div className="card" style={{ gap: 8 }}>
      <span style={{ fontWeight: 700 }}>{title}</span>
      {orders === null ? <div className="skel" style={{ height: 60, borderRadius: 12 }} /> : list.length === 0 ? <span className="dim" style={{ fontSize: 13 }}>No orders yet. Use Limit or Auto in the trade panel.</span> :
        list.slice(0, 30).map((o) => (
          <div key={o.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderTop: "1px solid var(--row)" }}>
            <span style={{ flex: 1, display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
              <b style={{ fontSize: 13 }}>{LABEL[o.kind]} <span className="mono dim" style={{ fontWeight: 500 }}>at {usd(o.trigger_mc)} MC</span></b>
              <span className="mono dim" style={{ fontSize: 11 }}>{o.kind === "limit_buy" ? usd(Number(o.amount) / 1e6, 2) : `${(Number(o.amount) / 1e18).toLocaleString("en-US", { maximumFractionDigits: 0 })} coins`} · {o.status}{o.note && o.status !== "open" && o.status !== "filled" ? ` · ${o.note}` : ""}</span>
            </span>
            {o.status === "open" && <button type="button" className="btn ghost sm" disabled={busy === o.id} onClick={() => cancel(o)}>{busy === o.id ? "…" : "Cancel"}</button>}
          </div>
        ))}
    </div>
  );
}
