"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { PushButton, refreshInbox, useInbox } from "@/components/alerts";
import { useApp } from "@/components/shell";
import { useWallet } from "@/components/wallet";
import { TradeError, accountAction } from "@/lib/chain";
import { ago, usd } from "@/lib/live";

const ICON: Record<string, string> = { price: "P", order: "O", follow: "F", graduated: "G" };

export default function Alerts() {
  const w = useWallet();
  const { toast } = useApp();
  const { data, reload } = useInbox();
  const [tab, setTab] = useState<"All" | "Price" | "Traders" | "Orders">("All");
  // opening the page marks everything as read
  useEffect(() => {
    if (!w.signer || !data || data.unread === 0) return;
    accountAction("notes.read", {}, w.signer).then(() => refreshInbox()).catch(() => {});
  }, [w.signer, data?.unread]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!w.signedIn) return (
    <div className="wrap page" style={{ alignItems: "center", textAlign: "center", gap: 14, paddingTop: 60 }}>
      <h1 className="h-title" style={{ fontSize: 32 }}>Alerts</h1>
      <p className="h-sub">Price alerts, trades from people you follow, and your orders, in one place.</p>
      <button type="button" className="btn volt lg" onClick={w.login}>Log in</button>
    </div>
  );
  const kind = { All: null, Price: "price", Traders: "follow", Orders: "order" }[tab];
  const notes = (data?.notes ?? []).filter((n) => !kind || n.kind === kind || (kind === "order" && n.kind === "graduated"));
  const open = (data?.alerts ?? []).filter((a) => a.status === "open");
  const del = async (id: string) => {
    if (!w.signer) return;
    try { await accountAction("alert.delete", { id }, w.signer); toast("Alert removed"); reload(); } catch (e) { toast(e instanceof TradeError ? e.message : "Couldn't remove it."); }
  };
  return (
    <div className="wrap page" style={{ maxWidth: 820 }}>
      <h1 className="h-title" style={{ fontSize: 32 }}>Alerts</h1>
      <div className="card" style={{ gap: 10 }}>
        <b>Get alerts on your phone and computer</b>
        <span className="dim" style={{ fontSize: 13 }}>Even when ArkhamPad is closed.</span>
        <PushButton />
      </div>
      <div className="card" style={{ gap: 8 }}>
        <b>Your price alerts</b>
        {open.length === 0 ? <span className="dim" style={{ fontSize: 13 }}>No price alerts. Open any coin and tap Price alert.</span> :
          open.map((a) => (
            <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 0", borderTop: "1px solid var(--row)" }}>
              <Link href={`/coin/?c=${a.chain_id}-${a.coin}`} style={{ flex: 1, fontSize: 14 }}><b>{a.tick}</b> <span className="dim">{a.direction === "above" ? "goes above" : "drops below"}</span> <b className="mono">{usd(a.target_mc)}</b></Link>
              <button type="button" className="btn ghost sm" onClick={() => del(a.id)}>Remove</button>
            </div>
          ))}
      </div>
      <div style={{ display: "flex", gap: 6 }}>{(["All", "Price", "Traders", "Orders"] as const).map((t) => <button key={t} type="button" className={`chip sm${tab === t ? " on" : ""}`} onClick={() => setTab(t)}>{t}</button>)}</div>
      {data === null ? <div className="skel" style={{ height: 200, borderRadius: 16 }} /> : notes.length === 0 ? <div className="card dim" style={{ fontSize: 14, alignItems: "center", padding: 28 }}>Nothing here yet.</div> :
        <div className="panel" style={{ gap: 0, padding: 0 }}>
          {notes.map((n, i) => (
            <Link key={n.id} href={n.url} style={{ display: "flex", gap: 12, padding: "12px 14px", borderTop: i ? "1px solid var(--row)" : 0, background: n.read ? "transparent" : "var(--raise)" }}>
              <span className="note-ic mono" aria-hidden="true">{ICON[n.kind] ?? "N"}</span>
              <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}><b style={{ fontSize: 14 }}>{n.title}</b><span className="dim" style={{ fontSize: 13 }}>{n.body}</span></span>
              <span className="mono dim" style={{ fontSize: 11 }}>{ago(n.created_at)}</span>
            </Link>
          ))}
        </div>}
    </div>
  );
}
