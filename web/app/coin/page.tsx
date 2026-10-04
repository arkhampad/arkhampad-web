"use client";
import Link from "next/link";
import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { getCoin, ownCandles, extCandles, recentTrades, useTradeFeed, usd, short, ago, listCoins, type LiveCoin, type LiveTrade, type Candle } from "@/lib/live";
import { Avatar, Bar, ChainTag } from "@/components/bits";
import { Intervals, LiveChart, TradePanel } from "@/components/trade";
import { ICopy, IShare } from "@/components/icons";
import { useApp } from "@/components/shell";

const IV_SECONDS: Record<string, number> = { "1m": 60, "5m": 300, "15m": 900, "1h": 3600, "4h": 14400, "1d": 86400 };

function Stat({ k, v, cls }: { k: string; v: string; cls?: string }) {
  return <div className="card" style={{ padding: "12px 14px", gap: 4, borderRadius: 14 }}><span className="dim" style={{ fontSize: 12 }}>{k}</span><span className={`mono ${cls || ""}`} style={{ fontWeight: 700, fontSize: 17 }}>{v}</span></div>;
}

type ExtTrade = { id: string; side: "Buy" | "Sell"; usd: string; who: string; at: string };
async function extTrades(c: LiveCoin): Promise<ExtTrade[]> {
  if (!c.network || !c.pool) return [];
  const r = await fetch(`https://api.geckoterminal.com/api/v2/networks/${c.network}/pools/${c.pool}/trades`, { headers: { accept: "application/json" } }).catch(() => null);
  if (!r || !r.ok) return [];
  const j = await r.json();
  return (j?.data ?? []).slice(0, 25).map((t: { id: string; attributes: { kind: string; volume_in_usd: string; tx_from_address: string; block_timestamp: string } }) => ({
    id: t.id, side: t.attributes.kind === "sell" ? "Sell" : "Buy", usd: usd(Number(t.attributes.volume_in_usd)), who: short(t.attributes.tx_from_address || ""), at: t.attributes.block_timestamp,
  }));
}

function CoinView() {
  const q = useSearchParams();
  const id = q.get("c") || "";
  const { toast, openLogin } = useApp();
  const [c, setC] = useState<LiveCoin | null | undefined>(undefined);
  const [iv, setIv] = useState("15m");
  const [candles, setCandles] = useState<Candle[] | null>(null);
  const [own, setOwn] = useState<LiveTrade[] | null>(null);
  const [ext, setExt] = useState<ExtTrade[] | null>(null);

  // Unknown or old links open the top trending coin.
  useEffect(() => {
    let alive = true;
    (async () => {
      let coin = await getCoin(id).catch(() => null);
      if (!coin && !/^\d+-0x/.test(id)) coin = (await listCoins("Trending", { limit: 1 }).catch(() => []))[0] ?? null;
      if (alive) setC(coin);
    })();
    return () => { alive = false; };
  }, [id]);

  const refresh = useCallback(async () => {
    if (!c) return;
    if (c.own) {
      const [fresh, ks, ts] = await Promise.all([getCoin(c.id), ownCandles(c.chainId, c.address, IV_SECONDS[iv]), recentTrades(25, { chainId: c.chainId, address: c.address })]);
      if (fresh) setC(fresh);
      setCandles(ks); setOwn(ts);
    } else {
      const [ks, ts] = await Promise.all([c.network && c.pool ? extCandles(c.network, c.pool, iv).catch(() => []) : Promise.resolve([]), extTrades(c)]);
      setCandles(ks); setExt(ts);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [c?.id, iv]);

  useEffect(() => { setCandles(null); refresh(); const t = setInterval(refresh, c?.own ? 20_000 : 60_000); return () => clearInterval(t); }, [refresh, c?.own]);
  useTradeFeed(() => { if (c?.own) refresh(); }, c?.own ? { chainId: c.chainId, address: c.address } : undefined);

  if (c === undefined) return <div className="wrap page"><div className="skel" style={{ height: 80, borderRadius: 16 }} /><div className="skel" style={{ height: 380, borderRadius: 16 }} /></div>;
  if (c === null) return (
    <div className="wrap page" style={{ alignItems: "center", textAlign: "center", gap: 12 }}>
      <h1 style={{ margin: 0, fontSize: 26 }}>Coin not found</h1>
      <span className="dim">It may be too new or not listed yet.</span>
      <Link href="/" className="btn volt">Back to Discover</Link>
    </div>
  );

  const up = c.chg >= 0;
  const target = (c.startMc ?? 0) * (7500 / 4500);
  return (
    <div className="wrap page" style={{ paddingBottom: 140 }}>
      <Link href="/" className="dim hide-m" style={{ fontSize: 13 }}>← Discover</Link>
      <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
        <Avatar name={c.name} c1={c.c1} c2={c.c2} size={60} img={c.image} />
        <div style={{ flex: "1 1 260px", display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <h1 style={{ margin: 0, fontSize: 28, fontWeight: 900, letterSpacing: -0.8, overflowWrap: "anywhere" }}>{c.name}</h1>
            <span className="mono dim" style={{ fontWeight: 600 }}>{c.tick}</span>
            <span className="pill" style={{ background: "#161922", color: "var(--text2)" }}><ChainTag chain={c.chain} /></span>
            {c.own ? <span className="pill" style={{ background: "rgba(212,255,58,0.12)", color: "var(--volt)" }}>Testnet</span> : <span className="pill" style={{ background: "#161922", color: "var(--muted)" }}>{c.dex ? c.dex.replace(/[-_]/g, " ") : "Other DEX"}</span>}
          </div>
          <div className="mono dim" style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, flexWrap: "wrap" }}>
            {short(c.address)}
            <button type="button" aria-label="Copy contract address" onClick={async () => { try { await navigator.clipboard.writeText(c.address); toast("Contract address copied"); } catch { /* blocked */ } }} style={{ width: 28, height: 28, borderRadius: 7, border: 0, background: "#161922", display: "inline-flex", alignItems: "center", justifyContent: "center" }}><ICopy size={13} color="var(--muted)" /></button>
            {c.own && c.creator ? <>· by {short(c.creator)}</> : null} · {c.age} old
          </div>
        </div>
        <button type="button" className="icon-btn" aria-label="Share" onClick={async () => { try { await navigator.clipboard.writeText(window.location.href); toast("Link copied"); } catch { /* blocked */ } }}><IShare size={16} /></button>
      </div>

      <div className="grid6">
        <Stat k="Price" v={c.price} /><Stat k="Market cap" v={c.mc} /><Stat k="24h" v={`${up ? "+" : ""}${c.chg.toFixed(1)}%`} cls={up ? "up" : "down"} />
        <Stat k="Volume 24h" v={c.vol} /><Stat k={c.own ? "In curve" : "Liquidity"} v={c.liq} /><Stat k={c.own ? "Buyers" : "Trades 24h"} v={c.own ? c.holders : c.trades} />
      </div>

      <div className="row">
        <div className="main-col">
          <div className="panel">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}><span className="mono" style={{ fontWeight: 800, fontSize: 28, letterSpacing: -0.8 }}>{c.price}</span><span className={`mono ${up ? "up" : "down"}`} style={{ fontWeight: 700 }}>{up ? "+" : ""}{c.chg.toFixed(1)}%</span></div>
              <Intervals value={iv} onChange={setIv} />
            </div>
            <LiveChart candles={candles} loading={candles === null} />
          </div>
          <div className="panel">
            <span style={{ fontWeight: 700 }}>Latest trades{c.own ? " · testnet" : ""}</span>
            {c.own ? (
              own === null ? <div className="skel" style={{ height: 120, borderRadius: 12 }} /> : own.length === 0 ? <span className="dim" style={{ fontSize: 13 }}>No trades yet.</span> :
                own.map((t) => (
                  <div key={t.id} className="mono" style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0,1fr))", padding: "10px 0", borderTop: "1px solid #16181F", fontSize: 13, color: "var(--text2)" }}>
                    <span style={{ color: "var(--text)" }}>{t.who}</span><span className={t.up ? "up" : "down"} style={{ fontWeight: 700 }}>{t.up ? "Buy" : "Sell"}</span><span>{t.amt}</span><span style={{ textAlign: "right", color: "var(--faint)" }}>{ago(t.ts)}</span>
                  </div>))
            ) : (
              ext === null ? <div className="skel" style={{ height: 120, borderRadius: 12 }} /> : ext.length === 0 ? <span className="dim" style={{ fontSize: 13 }}>Trades will show here.</span> :
                ext.map((t) => (
                  <div key={t.id} className="mono" style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0,1fr))", padding: "10px 0", borderTop: "1px solid #16181F", fontSize: 13, color: "var(--text2)" }}>
                    <span style={{ color: "var(--text)" }}>{t.who}</span><span className={t.side === "Buy" ? "up" : "down"} style={{ fontWeight: 700 }}>{t.side}</span><span>{t.usd}</span><span style={{ textAlign: "right", color: "var(--faint)" }}>{ago(t.at)}</span>
                  </div>))
            )}
          </div>
        </div>
        <aside className="side-col" style={{ flexBasis: 360 }}>
          {c.own && (
            <div className="card" style={{ gap: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}><span style={{ fontWeight: 700 }}>Graduation</span><span className="mono volt" style={{ fontWeight: 600 }}>{c.phase === 2 ? "Graduated" : `${usd(c.mcNum)} / ${usd(target)}`}</span></div>
              <Bar pct={c.progress} /><span className="dim" style={{ fontSize: 12 }}>At graduation the coin moves to a locked pool forever.</span>
            </div>
          )}
          {!c.own && (
            <div className="card" style={{ gap: 6 }}>
              <span style={{ fontWeight: 700 }}>Trading opens at launch</span>
              <span className="dim" style={{ fontSize: 13, lineHeight: 1.5 }}>This coin trades on another DEX. You will be able to buy and sell it here with USDC when ArkhamPad opens.</span>
            </div>
          )}
          <div className="hide-m"><TradePanel tick={c.tick} price={c.priceNum ?? 0} /></div>
        </aside>
      </div>
      <div className="show-m" style={{ position: "fixed", left: 0, right: 0, bottom: "calc(74px + var(--safe-bottom))", zIndex: 25, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, padding: "10px 16px", background: "rgba(10,11,16,0.97)", borderTop: "1px solid #1B1E25" }}>
        <button type="button" className="btn buy lg" onClick={openLogin}>Buy</button>
        <button type="button" className="btn sell lg" onClick={openLogin}>Sell</button>
      </div>
    </div>
  );
}
export default function CoinPage() { return <Suspense fallback={<div className="wrap page" />}><CoinView /></Suspense>; }
