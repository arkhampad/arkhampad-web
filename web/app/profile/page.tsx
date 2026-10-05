"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { Address } from "viem";
import { Avatar } from "@/components/bits";
import { useApp } from "@/components/shell";
import { useWallet } from "@/components/wallet";
import { OrdersList } from "@/components/orders";
import { PortfolioCard } from "@/components/portfolio";
import { ProfileHead } from "@/components/profilehead";
import { ProfitSheet } from "@/components/profit";
import { positionPnl } from "@/lib/pnl";
import type { Pnl } from "@/lib/share";
import { NETS, fromCoin, onLocalTrade, tokenBalance } from "@/lib/chain";
import { db, fromOwn, usd, short, type LiveCoin } from "@/lib/live";

type Holding = { coin: LiveCoin; amount: number; value: number };

async function loadHoldings(address: string): Promise<{ holdings: Holding[]; created: LiveCoin[] }> {
  const me = address.toLowerCase();
  const [traded, mine] = await Promise.all([
    db().from("trades").select("chain_id,coin").eq("trader", me).limit(500),
    db().from("coin_list").select("*").eq("creator", me).order("created_at", { ascending: false }).limit(50),
  ]);
  const keys = new Map<string, { chain_id: number; coin: string }>();
  for (const t of (traded.data ?? []) as { chain_id: number; coin: string }[]) keys.set(`${t.chain_id}-${t.coin}`, t);
  for (const c of (mine.data ?? []) as { chain_id: number; address: string }[]) keys.set(`${c.chain_id}-${c.address}`, { chain_id: c.chain_id, coin: c.address });
  const addrs = [...new Set([...keys.values()].map((k) => k.coin))];
  const { data: rows } = addrs.length ? await db().from("coin_list").select("*").in("address", addrs) : { data: [] };
  const coins = new Map(((rows ?? []) as Parameters<typeof fromOwn>[0][]).map((r) => [`${r.chain_id}-${r.address}`, fromOwn(r)]));
  const holdings = (await Promise.all([...keys.values()].map(async (k) => {
    const coin = coins.get(`${k.chain_id}-${k.coin}`);
    if (!coin || !NETS.some((n) => n.id === k.chain_id)) return null;
    const bal = await tokenBalance(k.chain_id, k.coin as Address, address as Address).catch(() => 0n);
    const amount = fromCoin(bal);
    return amount > 0 ? { coin, amount, value: amount * (coin.priceNum ?? 0) } : null;
  }))).filter(Boolean) as Holding[];
  holdings.sort((a, b) => b.value - a.value);
  return { holdings, created: ((mine.data ?? []) as Parameters<typeof fromOwn>[0][]).map(fromOwn) };
}

const fmt = (t: number) => (t >= 1e9 ? (t / 1e9).toFixed(2) + "B" : t >= 1e6 ? (t / 1e6).toFixed(2) + "M" : t >= 1e3 ? (t / 1e3).toFixed(1) + "K" : t.toFixed(2));

export default function Profile() {
  const w = useWallet();
  const { openFunds, toast } = useApp();
  const [data, setData] = useState<{ holdings: Holding[]; created: LiveCoin[] } | null>(null);
  const [result, setResult] = useState<Pnl | null>(null);
  const [tab, setTab] = useState<"Holdings" | "Created" | "Orders">("Holdings");
  const load = useCallback(() => { if (w.address) loadHoldings(w.address).then(setData).catch(() => setData({ holdings: [], created: [] })); }, [w.address]);
  useEffect(() => { setData(null); load(); const off = onLocalTrade(() => setTimeout(load, 300)); const iv = setInterval(load, 30_000); return () => { off(); clearInterval(iv); }; }, [load]);

  if (!w.ready) return <div className="wrap page"><div className="skel" style={{ height: 160, borderRadius: 22 }} /></div>;
  if (!w.signedIn || !w.address) return (
    <div className="wrap page" style={{ alignItems: "center", textAlign: "center", gap: 14, paddingTop: 60 }}>
      <h1 className="h-title" style={{ fontSize: 32 }}>Your profile</h1>
      <p className="h-sub">Sign in to see your balance, coins and launches.</p>
      <button type="button" className="btn volt lg" onClick={w.login}>Sign in</button>
    </div>
  );

  const coinsValue = (data?.holdings ?? []).reduce((a, h) => a + h.value, 0);
  const copy = async () => { try { await navigator.clipboard.writeText(w.address as string); toast("Address copied"); } catch { /* blocked */ } };
  return (
    <div className="wrap page" style={{ maxWidth: 1100 }}>
      <ProfileHead />
      <div className="card" style={{ gap: 14, borderRadius: 22 }}>
        <span className="dim" style={{ fontSize: 13 }}>Total balance (testnet)</span>
        <span className="mono" style={{ fontSize: 38, fontWeight: 900, letterSpacing: -1 }}>${(w.totalUsdc + coinsValue).toFixed(2)}</span>
        <div className="grid2 keep" style={{ gap: 10 }}>
          <div className="card" style={{ padding: 12, gap: 2, borderRadius: 14 }}><span className="dim" style={{ fontSize: 12 }}>Cash (USDC)</span><b className="mono">${w.totalUsdc.toFixed(2)}</b></div>
          <div className="card" style={{ padding: 12, gap: 2, borderRadius: 14 }}><span className="dim" style={{ fontSize: 12 }}>Coins</span><b className="mono">${coinsValue.toFixed(2)}</b></div>
        </div>
        <details style={{ fontSize: 12 }}>
          <summary className="dim" style={{ cursor: "pointer" }}>Details by network</summary>
          <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 8 }}>
            {NETS.map((n) => <span key={n.id} className="mono dim" style={{ display: "flex", justifyContent: "space-between" }}><span>{n.name}</span><span>${(Number(w.usdc[n.id] ?? 0n) / 1e6).toFixed(2)}</span></span>)}
          </div>
        </details>
        <div style={{ display: "flex", gap: 10 }}>
          <button type="button" className="btn buy" style={{ flex: 1 }} onClick={() => openFunds("deposit")}>Deposit</button>
          <button type="button" className="btn" style={{ flex: 1 }} onClick={() => openFunds("withdraw")}>Withdraw</button>
        </div>
      </div>
      {data && data.holdings.length > 0 && <PortfolioCard holdings={data.holdings} me={w.address} />}
      <div className="panel">
        <div style={{ display: "flex", gap: 4 }}>{(["Holdings", "Created", "Orders"] as const).map((t) => <button key={t} type="button" className={`tab${tab === t ? " on" : ""}`} onClick={() => setTab(t)}>{t}</button>)}</div>
        {tab === "Orders" ? <OrdersList title="All your orders" /> : !data ? <div className="skel" style={{ height: 120, borderRadius: 12 }} /> : tab === "Holdings" ? (
          data.holdings.length === 0 ? <div className="dim" style={{ padding: 16, fontSize: 14 }}>No coins yet. <Link href="/" className="volt">Find one on Discover</Link> or <Link href="/create/" className="volt">launch your own</Link>.</div> :
            data.holdings.map((h) => (
              <Link key={h.coin.id} href={`/coin/?c=${h.coin.id}`} className="lrow" style={{ borderTop: "1px solid var(--row)" }}>
                <Avatar name={h.coin.name} c1={h.coin.c1} c2={h.coin.c2} size={40} img={h.coin.image} />
                <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}><b>{h.coin.name}</b><span className="mono dim" style={{ fontSize: 12 }}>{fmt(h.amount)} {h.coin.tick} · {h.coin.chain}</span></span>
                <span className="mono" style={{ fontWeight: 700 }}>{usd(h.value)}</span>
              <button type="button" className="btn ghost sm" style={{ marginLeft: 6 }} onClick={async (e) => { e.preventDefault(); e.stopPropagation(); if (!w.address) return; const r = await positionPnl(h.coin.chainId, h.coin.address, w.address, { name: h.coin.name, tick: h.coin.tick, chain: h.coin.chain, image: h.coin.image, c1: h.coin.c1, c2: h.coin.c2, mcNow: h.coin.mcNum ?? 0, heldValue: h.value }); if (r) setResult(r); }}>Result</button></Link>))
        ) : (
          data.created.length === 0 ? <div className="dim" style={{ padding: 16, fontSize: 14 }}>You haven&apos;t launched a coin yet. <Link href="/create/" className="volt">Launch one</Link>.</div> :
            data.created.map((c) => (
              <Link key={c.id} href={`/coin/?c=${c.id}`} className="lrow" style={{ borderTop: "1px solid var(--row)" }}>
                <Avatar name={c.name} c1={c.c1} c2={c.c2} size={40} />
                <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}><b>{c.name}</b><span className="mono dim" style={{ fontSize: 12 }}>{c.tick} · {c.chain} · {c.age}</span></span>
                <span className="mono" style={{ fontWeight: 700 }}>{c.mc}</span>
              </Link>))
        )}
      </div>
      {result && <ProfitSheet p={result} onClose={() => setResult(null)} />}
    </div>
  );
}
