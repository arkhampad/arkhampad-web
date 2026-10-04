"use client";
// Follow buttons, one-tap copy, and live "a trader you follow just bought" alerts.
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { Address } from "viem";
import { useApp } from "./shell";
import { useWallet } from "./wallet";
import { TradeError, buy, poolBuy, setFollow, toUsdc } from "@/lib/chain";
import { db, getCoin, short } from "@/lib/live";
import { copyAmount, setFollowingCache, useFollowing } from "@/lib/traders";

export function FollowButton({ trader, big = false }: { trader: string; big?: boolean }) {
  const w = useWallet();
  const { toast } = useApp();
  const { following } = useFollowing(w.address);
  const [busy, setBusy] = useState(false);
  const on = following.includes(trader.toLowerCase());
  if (w.address && w.address.toLowerCase() === trader.toLowerCase()) return null;
  const go = async () => {
    if (!w.signedIn || !w.signer || !w.address) { w.login(); return; }
    setBusy(true);
    try {
      await setFollow(trader as Address, !on, w.signer);
      setFollowingCache(w.address, on ? following.filter((t) => t !== trader.toLowerCase()) : [...following, trader.toLowerCase()]);
      toast(on ? "Unfollowed" : "Following. You'll get an alert when they buy.");
    } catch (e) { toast(e instanceof TradeError ? e.message : "Couldn't update. Please try again."); } finally { setBusy(false); }
  };
  return <button type="button" className={`btn ${on ? "ghost" : "outline-volt"} ${big ? "" : "sm"}`} disabled={busy} onClick={go}>{busy ? "…" : on ? "Following" : "Follow"}</button>;
}

/** Buys the same coin a trader just bought, with the user's copy amount. */
export async function copyBuy(chainId: number, coin: string, amount: number, signer: NonNullable<ReturnType<typeof useWallet>["signer"]>) {
  const c = await getCoin(`${chainId}-${coin}`);
  if (!c || !c.own) throw new TradeError("This coin can't be traded here yet.");
  if ((c.phase ?? 0) === 1) throw new TradeError("This coin is graduating, try again in a few seconds.");
  return (c.phase ?? 0) === 2 ? poolBuy(chainId, coin as Address, toUsdc(amount), signer) : buy(chainId, c.curve as Address, coin as Address, toUsdc(amount), signer);
}

export function CopyButton({ chainId, coin, tick }: { chainId: number; coin: string; tick: string }) {
  const w = useWallet();
  const { toast } = useApp();
  const [busy, setBusy] = useState(false);
  const amt = copyAmount();
  const go = async () => {
    if (!w.signedIn || !w.signer) { w.login(); return; }
    setBusy(true);
    try { await copyBuy(chainId, coin, amt, w.signer); toast(`Copied: bought $${amt} of ${tick}`); await w.refresh(); }
    catch (e) { toast(e instanceof TradeError ? e.message : "Couldn't copy. Please try again."); } finally { setBusy(false); }
  };
  return <button type="button" className="btn volt sm" disabled={busy} onClick={go}>{busy ? "Buying…" : `Copy $${amt}`}</button>;
}

type Alert = { id: string; trader: string; chainId: number; coin: string; tick: string; usdc: number };

/** Lives in the shell: pops up when someone you follow buys, with a one-tap Copy. */
export function CopyAlerts() {
  const w = useWallet();
  const { following } = useFollowing(w.address);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const ref = useRef(following);
  ref.current = following;
  useEffect(() => {
    if (!w.address) return;
    const ch = db().channel(`copy-${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "trades" }, async (p) => {
        const t = p.new as { chain_id: number; tx_hash: string; log_index: number; coin: string; trader: string; is_buy: boolean; usdc: number };
        if (!t.is_buy || !ref.current.includes(t.trader)) return;
        const { data } = await db().from("coins").select("symbol").eq("chain_id", t.chain_id).eq("address", t.coin).maybeSingle();
        const a: Alert = { id: `${t.chain_id}-${t.tx_hash}-${t.log_index}`, trader: t.trader, chainId: t.chain_id, coin: t.coin, tick: (data as { symbol?: string } | null)?.symbol ?? "coin", usdc: Number(t.usdc) };
        setAlerts((l) => [a, ...l.filter((x) => x.id !== a.id)].slice(0, 3));
        setTimeout(() => setAlerts((l) => l.filter((x) => x.id !== a.id)), 30_000);
      })
      .subscribe();
    return () => { db().removeChannel(ch); };
  }, [w.address]);
  if (!alerts.length) return null;
  return (
    <div style={{ position: "fixed", right: 16, bottom: "calc(96px + var(--safe-bottom))", zIndex: 60, display: "flex", flexDirection: "column", gap: 8, maxWidth: "min(360px, calc(100vw - 32px))" }}>
      {alerts.map((a) => (
        <div key={a.id} className="card" role="status" style={{ padding: 12, gap: 8, boxShadow: "0 12px 40px var(--shadow)", borderColor: "var(--line3)" }}>
          <span style={{ fontSize: 13 }}><Link href={`/trader/?a=${a.trader}`} className="mono" style={{ fontWeight: 700 }}>{short(a.trader)}</Link> bought <b className="mono">${a.usdc.toFixed(2)}</b> of <Link href={`/coin/?c=${a.chainId}-${a.coin}`} style={{ fontWeight: 700 }}>{a.tick}</Link></span>
          <div style={{ display: "flex", gap: 8 }}>
            <CopyButton chainId={a.chainId} coin={a.coin} tick={a.tick} />
            <button type="button" className="btn ghost sm" onClick={() => setAlerts((l) => l.filter((x) => x.id !== a.id))}>Skip</button>
          </div>
        </div>
      ))}
    </div>
  );
}
