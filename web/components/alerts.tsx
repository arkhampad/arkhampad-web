"use client";
import { IBell } from "./icons";
// Bell (unread count), price alert creator, and phone/computer push notifications.
import { useCallback, useEffect, useState } from "react";
import type { Address } from "viem";
import { useApp } from "./shell";
import { useWallet } from "./wallet";
import { TradeError, accountAction, inbox, vapidKey, type Note, type PriceAlert } from "@/lib/chain";
import { usd, type LiveCoin } from "@/lib/live";

type Inbox = { notes: Note[]; unread: number; alerts: PriceAlert[] };
const subs = new Set<() => void>();
export const refreshInbox = () => subs.forEach((f) => f());

export function useInbox() {
  const w = useWallet();
  const [data, setData] = useState<Inbox | null>(null);
  const load = useCallback(async () => { if (w.address) setData(await inbox(w.address as Address)); else setData(null); }, [w.address]);
  useEffect(() => { load(); subs.add(load); const iv = setInterval(load, 15_000); return () => { subs.delete(load); clearInterval(iv); }; }, [load]);
  return { data, reload: load };
}

export function PriceAlertButton({ c, className = "btn ghost sm", label = "Price alert" }: { c: LiveCoin; className?: string; label?: string }) {
  const w = useWallet();
  const { toast } = useApp();
  const [open, setOpen] = useState(false);
  const [dir, setDir] = useState<"above" | "below">("above");
  const [mc, setMc] = useState("");
  const [busy, setBusy] = useState(false);
  const now = c.mcNum ?? 0;
  const pick = (pct: number) => { setDir(pct > 0 ? "above" : "below"); setMc(String(Math.round(now * (1 + pct / 100)))); };
  const save = async () => {
    if (!w.signedIn || !w.signer) { w.login(); return; }
    const t = Number(mc);
    if (!(t > 0)) { toast("Enter a market cap."); return; }
    if ((dir === "above" && t <= now) || (dir === "below" && t >= now)) { toast(`That's already ${dir === "above" ? "below" : "above"} the current market cap.`); return; }
    setBusy(true);
    try { await accountAction("alert.add", { chainId: c.chainId, coin: c.address, tick: c.tick, direction: dir, targetMc: t }, w.signer); toast(`Alert set: ${c.tick} ${dir} ${usd(t)}`); setOpen(false); refreshInbox(); }
    catch (e) { toast(e instanceof TradeError ? e.message : "Couldn't set the alert."); } finally { setBusy(false); }
  };
  return (
    <>
      <button type="button" className={className} onClick={() => { setOpen(true); if (!mc && now) pick(50); }}><IBell size={14} />{label}</button>
      {open && (
        <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
          <div className="modal" role="dialog" aria-modal="true" aria-label={`Price alert for ${c.tick}`} style={{ gap: 12 }}>
            <span style={{ fontWeight: 900, fontSize: 22 }}>Alert me about {c.tick}</span>
            <span className="dim" style={{ fontSize: 13 }}>Market cap now: <b className="mono">{c.mc}</b></span>
            <div style={{ display: "flex", gap: 6 }}>{(["above", "below"] as const).map((d) => <button key={d} type="button" className={`seg${dir === d ? " on" : ""}`} onClick={() => setDir(d)}>{d === "above" ? "Goes above" : "Drops below"}</button>)}</div>
            <div style={{ display: "flex", alignItems: "center", height: 50, padding: "0 14px", borderRadius: 12, background: "var(--bg)", border: "1px solid var(--line3)" }}>
              <span className="mono dim" style={{ fontWeight: 700 }}>$</span>
              <input inputMode="decimal" aria-label="Market cap" value={mc} onChange={(e) => setMc(e.target.value.replace(/[^0-9.]/g, ""))} style={{ flex: 1, minWidth: 0, background: "transparent", border: 0, outline: "none", font: "700 18px var(--mono)", paddingLeft: 4 }} />
            </div>
            <div style={{ display: "flex", gap: 6 }}>{[-50, -25, 25, 50, 100].map((p) => <button key={p} type="button" className="seg mono" style={{ height: 34, minWidth: 0 }} onClick={() => pick(p)}>{p > 0 ? `+${p}` : p}%</button>)}</div>
            <button type="button" className="btn volt lg" disabled={busy} onClick={save}>{busy ? "Saving…" : w.signedIn ? "Set alert" : "Log in to set alerts"}</button>
            <span style={{ fontSize: 11, color: "var(--faint)", textAlign: "center" }}>You&apos;ll see it in Alerts and get a push notification if you turn them on.</span>
            <button type="button" className="btn ghost" onClick={() => setOpen(false)}>Close</button>
          </div>
        </div>
      )}
    </>
  );
}

const b64ToBytes = (s: string) => { const p = "=".repeat((4 - (s.length % 4)) % 4); const raw = atob((s + p).replace(/-/g, "+").replace(/_/g, "/")); return Uint8Array.from(raw, (c) => c.charCodeAt(0)); };

/** Turns on push notifications for this device. */
export function PushButton() {
  const w = useWallet();
  const { toast } = useApp();
  const [state, setState] = useState<"unknown" | "on" | "off" | "blocked" | "unsupported" | "install">("unknown");
  useEffect(() => {
    const ios = /iPhone|iPad|iPod/i.test(navigator.userAgent);
    const standalone = window.matchMedia?.("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone;
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) { setState(ios && !standalone ? "install" : "unsupported"); return; }
    if (Notification.permission === "denied") { setState("blocked"); return; }
    navigator.serviceWorker.getRegistration().then(async (r) => setState(r && (await r.pushManager.getSubscription()) ? "on" : "off")).catch(() => setState("off"));
  }, []);
  const turnOn = async () => {
    if (!w.signedIn || !w.signer) { w.login(); return; }
    try {
      const key = await vapidKey();
      if (!key) throw new TradeError("Push notifications aren't set up yet. Alerts in the app still work.");
      const perm = await Notification.requestPermission();
      if (perm !== "granted") { setState(perm === "denied" ? "blocked" : "off"); return; }
      const reg = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;
      const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(key) }));
      const j = sub.toJSON();
      await accountAction("push.subscribe", { subscription: { endpoint: j.endpoint, keys: { p256dh: j.keys?.p256dh, auth: j.keys?.auth } } }, w.signer);
      setState("on");
      toast("Push notifications are on for this device");
    } catch (e) { toast(e instanceof TradeError ? e.message : "Couldn't turn on notifications."); }
  };
  if (state === "on") return <span className="pill" style={{ background: "rgba(61,220,151,0.14)", color: "var(--up)" }}>Push on for this device</span>;
  if (state === "install") return <span className="dim" style={{ fontSize: 13 }}>On iPhone: tap Share → <b>Add to Home Screen</b>, open ArkhamPad from there, then turn on notifications.</span>;
  if (state === "blocked") return <span className="dim" style={{ fontSize: 13 }}>Notifications are blocked in your browser settings for this site.</span>;
  if (state === "unsupported") return <span className="dim" style={{ fontSize: 13 }}>This browser doesn&apos;t support push notifications.</span>;
  return <button type="button" className="btn volt" onClick={turnOn}>Turn on push notifications</button>;
}
