"use client";

/**
 * Data: the whole Hyperliquid market at a glance. Totals, the biggest movers, volume, open
 * interest, funding next to Binance and Bybit, and big trades as they happen. Read-only; every
 * row opens its market.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { MarketTabs } from "./markettabs";
import { HL_API, fetchPerpMarkets, info, px, type PerpMarket } from "@/lib/hl";
import { fetchSpotMarkets, type SpotMarket } from "@/lib/hlspot";

const usd = (v: number, d = 2) => `$${v.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d })}`;
const compact = (v: number) => (v >= 1e9 ? `$${(v / 1e9).toFixed(2)}B` : v >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `$${(v / 1e3).toFixed(1)}K` : usd(v, 0));
const pct = (v: number | null, d = 2) => (v === null || !Number.isFinite(v) ? "—" : `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(d)}%`);
const tone = (v: number | null) => (v === null || v === 0 ? "dim" : v > 0 ? "up" : "down");

/** Funding as a yearly rate, so venues paying every hour and every 8 hours compare. */
const yearly = (ratePerPeriod: number, hours: number) => (ratePerPeriod / hours) * 24 * 365 * 100;

type Venue = { rate: number; hours: number } | null;
type Funding = { hl: Venue; bin: Venue; bybit: Venue };
async function fetchFundings(): Promise<Map<string, Funding>> {
  const rows = await info<[string, [string, { fundingRate: string; fundingIntervalHours?: number } | null][]][]>({ type: "predictedFundings" });
  const out = new Map<string, Funding>();
  for (const [coin, venues] of Array.isArray(rows) ? rows : []) {
    const f: Funding = { hl: null, bin: null, bybit: null };
    for (const [name, v] of venues ?? []) {
      if (!v || !Number.isFinite(Number(v.fundingRate))) continue;
      const one = { rate: Number(v.fundingRate), hours: Number(v.fundingIntervalHours) || (name === "HlPerp" ? 1 : 8) };
      if (name === "HlPerp") f.hl = one;
      else if (name === "BinPerp") f.bin = one;
      else if (name === "BybitPerp") f.bybit = one;
    }
    out.set(coin, f);
  }
  return out;
}

type BigTrade = { id: string; coin: string; side: "B" | "A"; px: number; usd: number; time: number };
/** Trades this size or bigger show in the live feed. */
const WHALE_USD = 50_000;
/** Markets the live feed listens to: the busiest ones. */
const FEED_COINS = 20;

type Tab = "gainers" | "losers" | "volume" | "oi" | "funding" | "spot";
const TABS: [Tab, string][] = [
  ["gainers", "Top gainers"],
  ["losers", "Top losers"],
  ["volume", "Volume"],
  ["oi", "Open interest"],
  ["funding", "Funding"],
  ["spot", "Spot"],
];

export function DataScreen() {
  const router = useRouter();
  const [perps, setPerps] = useState<PerpMarket[] | null>(null);
  const [spots, setSpots] = useState<SpotMarket[] | null>(null);
  const [fund, setFund] = useState<Map<string, Funding> | null>(null);
  const [error, setError] = useState(false);
  const [tab, setTab] = useState<Tab>("gainers");
  const [trades, setTrades] = useState<BigTrade[]>([]);
  const [live, setLive] = useState(false);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      const [p, s, f] = await Promise.all([fetchPerpMarkets().catch(() => null), fetchSpotMarkets().catch(() => null), fetchFundings().catch(() => null)]);
      if (!alive) return;
      if (p) setPerps(p);
      if (s) setSpots(s);
      if (f) setFund(f);
      setError(!p && !s);
    };
    void load();
    const t = setInterval(() => document.visibilityState === "visible" && void load(), 10_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  // live big trades on the busiest markets (one socket, reconnects by itself)
  const feedKey = (perps ?? []).slice(0, FEED_COINS).map((m) => m.coin).join(",");
  const seen = useRef(new Set<string>());
  useEffect(() => {
    if (!feedKey) return;
    const coins = feedKey.split(",");
    let ws: WebSocket | null = null;
    let stop = false;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let ping: ReturnType<typeof setInterval> | null = null;
    const open = () => {
      try {
        ws = new WebSocket(HL_API.replace(/^http/, "ws") + "/ws");
      } catch {
        return;
      }
      ws.onopen = () => {
        setLive(true);
        for (const coin of coins) ws?.send(JSON.stringify({ method: "subscribe", subscription: { type: "trades", coin } }));
        ping = setInterval(() => ws?.readyState === 1 && ws.send(JSON.stringify({ method: "ping" })), 30_000);
      };
      ws.onmessage = (ev) => {
        let m: { channel?: string; data?: { coin: string; side: "B" | "A"; px: string; sz: string; time: number; tid: number; hash: string }[] };
        try {
          m = JSON.parse(String(ev.data));
        } catch {
          return;
        }
        if (m.channel !== "trades" || !Array.isArray(m.data)) return;
        const big = m.data
          .map((t) => ({ id: `${t.coin}-${t.tid}`, coin: t.coin, side: t.side, px: Number(t.px), usd: Number(t.px) * Number(t.sz), time: t.time }))
          .filter((t) => {
            if (t.usd < WHALE_USD || seen.current.has(t.id)) return false;
            seen.current.add(t.id);
            return true;
          });
        if (!big.length) return;
        if (seen.current.size > 2000) seen.current = new Set([...seen.current].slice(-500));
        setTrades((prev) => [...big.sort((a, b) => b.time - a.time), ...prev].slice(0, 40));
      };
      ws.onclose = () => {
        setLive(false);
        if (ping) clearInterval(ping);
        if (!stop) retry = setTimeout(open, 3_000);
      };
      ws.onerror = () => ws?.close();
    };
    open();
    return () => {
      stop = true;
      if (retry) clearTimeout(retry);
      if (ping) clearInterval(ping);
      ws?.close();
    };
  }, [feedKey]);

  const totals = useMemo(() => {
    if (!perps) return null;
    const vol = perps.reduce((s, m) => s + m.volume24h, 0);
    const oi = perps.reduce((s, m) => s + m.openInterestUsd, 0);
    const spotVol = (spots ?? []).reduce((s, m) => s + m.volume24h, 0);
    const up = perps.filter((m) => (m.change24h ?? 0) > 0).length;
    return { vol, oi, spotVol, up, all: perps.length };
  }, [perps, spots]);

  const rows = useMemo(() => {
    if (!perps) return [];
    const live = perps.filter((m) => m.volume24h > 100_000);
    if (tab === "gainers") return [...live].sort((a, b) => (b.change24h ?? -1e9) - (a.change24h ?? -1e9)).slice(0, 25);
    if (tab === "losers") return [...live].sort((a, b) => (a.change24h ?? 1e9) - (b.change24h ?? 1e9)).slice(0, 25);
    if (tab === "volume") return perps.slice(0, 25);
    if (tab === "oi") return [...perps].sort((a, b) => b.openInterestUsd - a.openInterestUsd).slice(0, 25);
    if (tab === "funding") return [...live].sort((a, b) => Math.abs(b.funding) - Math.abs(a.funding)).slice(0, 25);
    return [];
  }, [perps, tab]);

  const cards: [string, string, string][] = totals
    ? [
        ["Futures volume 24h", compact(totals.vol), ""],
        ["Open interest", compact(totals.oi), ""],
        ["Spot volume 24h", spots ? compact(totals.spotVol) : "…", ""],
        ["Markets up today", `${totals.up} of ${totals.all}`, totals.up * 2 >= totals.all ? "up" : "down"],
      ]
    : [];

  const goFut = (coin: string) => router.push(`/futures/?c=${encodeURIComponent(coin)}`);
  const goSpot = (base: string) => router.push(`/market/?c=${encodeURIComponent(base)}`);

  return (
    <>
      <MarketTabs at="data" />
      <div className="wrap page" style={{ maxWidth: 1600, paddingTop: 16 }}>
        {error && <div className="warn-note"><span>Can&apos;t reach Hyperliquid right now. Retrying…</span></div>}

        <div className="data-grid">
          {(cards.length ? cards : Array.from({ length: 4 }, () => ["", "", ""] as [string, string, string])).map(([k, v, cls], i) => (
            <div key={k || i} className="card" style={{ gap: 6, padding: 16 }}>
              {k ? (
                <>
                  <span className="dim" style={{ fontSize: 12, fontWeight: 600 }}>{k}</span>
                  <b className={`mono ${cls}`} style={{ fontSize: 22 }}>{v}</b>
                </>
              ) : (
                <div className="skel" style={{ height: 48, borderRadius: 8 }} />
              )}
            </div>
          ))}
        </div>

        <div className="data-split">
          <div className="card" style={{ padding: 14, gap: 10 }}>
            <div className="data-tabs" role="tablist" aria-label="Lists">
              {TABS.map(([k, l]) => (
                <button key={k} type="button" role="tab" aria-selected={tab === k} className={`tab${tab === k ? " on" : ""}`} onClick={() => setTab(k)}>{l}</button>
              ))}
            </div>
            {!perps ? (
              Array.from({ length: 10 }, (_, i) => <div key={i} className="skel" style={{ height: 34, borderRadius: 8 }} />)
            ) : tab === "spot" ? (
              <div className="data-scroll">
                <table className="data-table">
                  <thead><tr><th>Coin</th><th>Price</th><th>24h</th><th>Volume</th><th>Market cap</th></tr></thead>
                  <tbody>
                    {(spots ?? []).slice(0, 25).map((m) => (
                      <tr key={m.pair} className="click" onClick={() => goSpot(m.base)}>
                        <td><b>{m.base}</b></td>
                        <td className="mono">{px(m.mark)}</td>
                        <td className={`mono ${tone(m.change24h)}`}>{pct(m.change24h)}</td>
                        <td className="mono">{compact(m.volume24h)}</td>
                        <td className="mono">{m.marketCap ? compact(m.marketCap) : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : tab === "funding" ? (
              <>
                <span className="dim" style={{ fontSize: 12 }}>Yearly rate. Positive: longs pay shorts. Compared with Binance and Bybit on the same coin.</span>
                <div className="data-scroll">
                  <table className="data-table">
                    <thead><tr><th>Coin</th><th>Hyperliquid</th><th>Binance</th><th>Bybit</th><th>Open interest</th></tr></thead>
                    <tbody>
                      {rows.map((m) => {
                        const f = fund?.get(m.coin);
                        const hl = f?.hl ? yearly(f.hl.rate, f.hl.hours) : yearly(m.funding, 1);
                        const cell = (v: Venue) => (v ? <td className={`mono ${tone(yearly(v.rate, v.hours))}`}>{pct(yearly(v.rate, v.hours), 1)}</td> : <td className="mono dim">—</td>);
                        return (
                          <tr key={m.coin} className="click" onClick={() => goFut(m.coin)}>
                            <td><b>{m.coin}</b></td>
                            <td className={`mono ${tone(hl)}`}>{pct(hl, 1)}</td>
                            {cell(f?.bin ?? null)}
                            {cell(f?.bybit ?? null)}
                            <td className="mono">{compact(m.openInterestUsd)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            ) : (
              <div className="data-scroll">
                <table className="data-table">
                  <thead><tr><th>Coin</th><th>Price</th><th>24h</th><th>Volume</th><th>Open interest</th></tr></thead>
                  <tbody>
                    {rows.map((m) => (
                      <tr key={m.coin} className="click" onClick={() => goFut(m.coin)}>
                        <td><b>{m.coin}</b></td>
                        <td className="mono">{px(m.mark)}</td>
                        <td className={`mono ${tone(m.change24h)}`}>{pct(m.change24h)}</td>
                        <td className="mono">{compact(m.volume24h)}</td>
                        <td className="mono">{compact(m.openInterestUsd)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="card" style={{ padding: 14, gap: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <b style={{ fontSize: 15 }}>Big trades</b>
              <span className="dot" style={{ background: live ? "var(--up)" : "var(--faint)" }} aria-hidden="true" />
              <span className="dim" style={{ fontSize: 12 }}>{live ? "Live" : "Connecting…"} · {compact(WHALE_USD)}+</span>
            </div>
            {trades.length === 0 ? (
              <span className="dim" style={{ fontSize: 13, padding: "6px 2px" }}>Waiting for the next big trade…</span>
            ) : (
              <div className="data-scroll" style={{ maxHeight: 640, overflowY: "auto" }}>
                <table className="data-table">
                  <thead><tr><th>Coin</th><th>Side</th><th>Size</th><th>Price</th><th>Time</th></tr></thead>
                  <tbody>
                    {trades.map((t) => (
                      <tr key={t.id} className="click" onClick={() => goFut(t.coin)}>
                        <td><b>{t.coin}</b></td>
                        <td className={t.side === "B" ? "up" : "down"}>{t.side === "B" ? "Buy" : "Sell"}</td>
                        <td className="mono">{compact(t.usd)}</td>
                        <td className="mono">{px(t.px)}</td>
                        <td className="mono dim">{new Date(t.time).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
        <span className="dim" style={{ fontSize: 11 }}>Market data from Hyperliquid.</span>
      </div>
    </>
  );
}
