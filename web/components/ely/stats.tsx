"use client";
// Stats: Elysium in numbers (volume, trades, traders, new tokens) and ArkhamPad's own numbers.
// Hand-drawn SVG charts: one series each, one axis, recessive grid, hover tooltips.
import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { TokenAvatar } from "./shell";
import { compact, fetchHypeUsd, fetchStats, money, usePoll, type EStats } from "@/lib/ely";

type Pt = { x: string; y: number; label: string; sub?: string };

function niceMax(v: number) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
}

/** Area (line) or bar chart of one series, with a hover crosshair / highlighted bar and tooltip. */
function Chart({ pts, kind, fmt, height = 240, tick }: { pts: Pt[]; kind: "area" | "bar"; fmt: (v: number) => string; height?: number; tick: (p: Pt, i: number) => string | null }) {
  const box = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const W = 1000;
  const H = height;
  const pad = { l: 4, r: 4, t: 14, b: 26 };
  const max = niceMax(Math.max(...pts.map((p) => p.y), 0) * 1.08);
  const iw = W - pad.l - pad.r;
  const ih = H - pad.t - pad.b;
  const step = iw / Math.max(pts.length, 1);
  const xAt = (i: number) => pad.l + (kind === "bar" ? step * i + step / 2 : (iw * i) / Math.max(pts.length - 1, 1));
  const yAt = (v: number) => pad.t + ih - (v / max) * ih;
  const grid = [0, 0.25, 0.5, 0.75, 1].map((f) => max * f);
  const line = pts.map((p, i) => `${i ? "L" : "M"}${xAt(i).toFixed(1)},${yAt(p.y).toFixed(1)}`).join("");
  const area = `${line}L${xAt(pts.length - 1).toFixed(1)},${pad.t + ih}L${xAt(0).toFixed(1)},${pad.t + ih}Z`;
  const bw = Math.max(2, step - 4);

  function move(e: React.PointerEvent) {
    const r = box.current?.getBoundingClientRect();
    if (!r || !pts.length) return;
    const fx = ((e.clientX - r.left) / Math.max(1, r.width - 58)) * W;
    const i = kind === "bar" ? Math.floor((fx - pad.l) / step) : Math.round(((fx - pad.l) / iw) * (pts.length - 1));
    setHover(Math.max(0, Math.min(pts.length - 1, i)));
  }
  const h = hover != null ? pts[hover] : null;
  const leftPct = hover != null ? (xAt(hover) / W) * 100 : 0;

  return (
    <div className="e-chartbox" ref={box} onPointerMove={move} onPointerDown={move} onPointerLeave={() => setHover(null)} style={{ height }}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="Chart">
        <defs>
          <linearGradient id="eArea" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="var(--e-teal)" stopOpacity="0.28" />
            <stop offset="100%" stopColor="var(--e-teal)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {grid.map((g, i) => <line key={i} x1={pad.l} x2={W - pad.r} y1={yAt(g)} y2={yAt(g)} className="e-gl" vectorEffect="non-scaling-stroke" />)}
        {kind === "area" ? (
          <>
            <path d={area} fill="url(#eArea)" />
            <path d={line} fill="none" stroke="var(--e-teal)" strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
          </>
        ) : (
          pts.map((p, i) => {
            const y = yAt(p.y);
            const hgt = pad.t + ih - y;
            return <path key={i} d={hgt > 0 ? `M${xAt(i) - bw / 2},${pad.t + ih}V${y + Math.min(4, hgt)}q0,-${Math.min(4, hgt)} ${Math.min(4, bw / 2)},-${Math.min(4, hgt)}H${xAt(i) + bw / 2 - Math.min(4, bw / 2)}q${Math.min(4, bw / 2)},0 ${Math.min(4, bw / 2)},${Math.min(4, hgt)}V${pad.t + ih}Z` : ""} className={`e-bar ${hover === i ? "on" : ""}`} />;
          })
        )}
        {kind === "area" && hover != null && <line x1={xAt(hover)} x2={xAt(hover)} y1={pad.t} y2={pad.t + ih} className="e-cross" vectorEffect="non-scaling-stroke" />}
      </svg>
      <div className="e-yax">{grid.slice(1).map((g, i) => <span key={i} style={{ top: `${(yAt(g) / H) * 100}%` }}>{fmt(g)}</span>)}</div>
      <div className="e-xax">{pts.map((p, i) => { const t = tick(p, i); return t ? <span key={i} style={{ left: `calc((100% - 58px) * ${xAt(i) / W})` }}>{t}</span> : null; })}</div>
      {kind === "area" && h && <span className="e-dotp" style={{ left: `calc((100% - 58px) * ${leftPct / 100})`, top: `${(yAt(h.y) / H) * 100}%` }} />}
      {h && (
        <div className="e-tip" style={{ left: `calc((100% - 58px) * ${Math.min(80, Math.max(20, leftPct)) / 100})` }}>
          <b className="num">{fmt(h.y)}</b>
          <span>{h.label}</span>
          {h.sub && <span className="dim">{h.sub}</span>}
        </div>
      )}
    </div>
  );
}

const day = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const hourLabel = (h: string) => new Date(h).toLocaleString("en-US", { weekday: "short", hour: "2-digit", minute: "2-digit" });

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="e-tile">
      <span>{label}</span>
      <b className="num">{value}</b>
      {sub && <small className="dim">{sub}</small>}
    </div>
  );
}

export function StatsPage() {
  const s = usePoll(fetchStats, 60_000);
  const usd = usePoll(fetchHypeUsd, 60_000) ?? 0;
  const [range, setRange] = useState<"30d" | "48h">("30d");

  const volPts = useMemo<Pt[]>(() => {
    if (!s) return [];
    return range === "30d"
      ? s.daily.map((d) => ({ x: d.d, y: d.vol * usd, label: day(d.d), sub: `${d.trades.toLocaleString("en-US")} trades · ${d.traders.toLocaleString("en-US")} traders` }))
      : s.hourly.map((h) => ({ x: h.h, y: h.vol * usd, label: hourLabel(h.h), sub: `${h.trades.toLocaleString("en-US")} trades` }));
  }, [s, usd, range]);

  if (s === null) {
    return <main className="e-in e-page"><div className="e-panel e-empty" style={{ padding: "60px 20px" }}>Stats are being prepared. Check back in a few minutes.</div></main>;
  }
  if (!s) {
    return <main className="e-in e-page"><div className="e-skel" style={{ height: 90 }} /><div className="e-skel" style={{ height: 300 }} /></main>;
  }

  const prev24 = s.daily.length > 1 ? s.daily[s.daily.length - 2].vol : 0;
  const change = prev24 > 0 ? ((s.vol_24h - prev24) / prev24) * 100 : null;
  const share = s.vol_24h > 0 ? (s.ours.vol_24h / s.vol_24h) * 100 : 0;
  const topMax = Math.max(...s.top.map((t) => t.vol_7d), 1);
  const tickDaily = (p: Pt, i: number) => ((s.daily.length - 1 - i) % 7 === 0 ? day(p.x) : null);
  const tickHourly = (p: Pt, i: number) => (i % 12 === 0 ? new Date(p.x).toLocaleString("en-US", { weekday: "short", hour: "numeric" }) : null);

  return (
    <main className="e-in e-page">
      <section className="e-hero">
        <div>
          <span className="e-eyebrow"><i className="e-dot" />Live · updated {new Date(s.updated).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}</span>
          <h1>Elysium in numbers</h1>
          <p>Every trade on every HYPE pair on Elysium, counted by ArkhamPad.</p>
        </div>
      </section>

      <section className="e-tiles">
        <Tile label="24h volume" value={money(s.vol_24h * usd)} sub={change == null ? undefined : `${change >= 0 ? "+" : ""}${change.toFixed(1)}% vs yesterday`} />
        <Tile label="7d volume" value={money(s.vol_7d * usd)} />
        <Tile label="All-time volume" value={money(s.vol_all * usd)} sub={`${compact(s.vol_all)} HYPE`} />
        <Tile label="Trades 24h" value={s.trades_24h.toLocaleString("en-US")} sub={`${compact(s.trades_all)} all time`} />
        <Tile label="Traders 24h" value={s.traders_24h.toLocaleString("en-US")} sub={`${compact(s.traders_all)} all time`} />
        <Tile label="Tokens" value={s.tokens.toLocaleString("en-US")} sub={`${compact(s.holders)} holders`} />
      </section>

      <section className="e-panel e-chartpanel">
        <div className="e-chart-head">
          <div>
            <h2>Trading volume</h2>
            <span className="dim">{range === "30d" ? "Per day, last 30 days" : "Per hour, last 48 hours"} · USD</span>
          </div>
          <div className="e-seg">
            <button type="button" className={range === "30d" ? "on" : ""} onClick={() => setRange("30d")}>30D</button>
            <button type="button" className={range === "48h" ? "on" : ""} onClick={() => setRange("48h")}>48H</button>
          </div>
        </div>
        <Chart pts={volPts} kind="area" fmt={money} height={280} tick={range === "30d" ? tickDaily : tickHourly} />
      </section>

      <div className="e-two">
        <section className="e-panel e-chartpanel">
          <div className="e-chart-head"><div><h2>Trades per day</h2><span className="dim">Last 30 days</span></div></div>
          <Chart pts={s.daily.map((d) => ({ x: d.d, y: d.trades, label: day(d.d), sub: `${d.traders.toLocaleString("en-US")} traders` }))} kind="bar" fmt={(v) => compact(Math.round(v))} height={200} tick={tickDaily} />
        </section>
        <section className="e-panel e-chartpanel">
          <div className="e-chart-head"><div><h2>New tokens per day</h2><span className="dim">Last 30 days</span></div></div>
          <Chart pts={s.daily.map((d) => ({ x: d.d, y: d.new_tokens, label: day(d.d), sub: d.new_ours ? `${d.new_ours} on ArkhamPad` : undefined }))} kind="bar" fmt={(v) => String(Math.round(v))} height={200} tick={tickDaily} />
        </section>
      </div>

      <section className="e-ark">
        <div className="e-ark-head">
          <span className="e-eyebrow" style={{ color: "#3fe3d4" }}>ArkhamPad</span>
          <h2>Coins launched here</h2>
          <p>Liquidity locked forever. 30% of every trading fee goes to the coin&apos;s creator, automatically.</p>
        </div>
        <div className="e-ark-grid">
          <div><span>Coins launched</span><b className="num">{s.ours.coins.toLocaleString("en-US")}</b></div>
          <div><span>Volume, all time</span><b className="num">{money(s.ours.vol_all * usd)}</b></div>
          <div><span>Paid to creators</span><b className="num">{money(s.ours.creator_fees * usd)}</b></div>
          <div className="e-share">
            <span>Share of Elysium volume, 24h</span>
            <b className="num">{share.toFixed(1)}%</b>
            <span className="e-meter"><i style={{ width: `${Math.min(100, share)}%` }} /></span>
          </div>
        </div>
        <Link href="/create/" className="e-btn pri" style={{ alignSelf: "flex-start" }}>Launch a coin</Link>
      </section>

      <section className="e-panel">
        <div className="e-chart-head" style={{ padding: "16px 16px 6px" }}><div><h2>Top tokens this week</h2><span className="dim">By 7-day volume</span></div></div>
        <div className="e-rows">
          {s.top.map((t, i) => (
            <Link key={t.address} href={`/t/?a=${t.address}`} className="e-row e-toprow">
              <span className="dim num">{i + 1}</span>
              <span className="e-tok"><TokenAvatar t={t} size={34} /><span><span className="l1"><b>{t.name}</b><span className="sym">{t.symbol}</span>{t.ours && <span className="e-lock">ArkhamPad</span>}</span></span></span>
              <span className="e-hbar e-hide-m"><i style={{ width: `${(t.vol_7d / topMax) * 100}%` }} /></span>
              <span className="r num e-hide-m">{t.trades_7d.toLocaleString("en-US")} trades</span>
              <span className="r num"><b>{money(t.vol_7d * usd)}</b></span>
            </Link>
          ))}
        </div>
      </section>
    </main>
  );
}
