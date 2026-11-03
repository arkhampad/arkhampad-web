"use client";
// Discover: every token on Elysium, from every launchpad. Hot strip, the full list (Trending / New /
// Top / Gainers / Losers, search) and live trades (side panel on wide screens, a tab on phones).
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { RingAvatar, TokenAvatar } from "./shell";
import { useT } from "@/lib/i18n";
import { ago, compact, fetchHypeUsd, fetchLiveTrades, fetchStats, fetchTokens, fetchTrades, money, pct, short, tinyPrice, usePoll, type EToken, type ETrade , useTokens } from "@/lib/ely";
import { pendingTokens } from "@/lib/elytrade";
import { AirdropBanner } from "./airdrop";
import { PioneerBanner } from "./pioneer";
import { ScoutBadge } from "./scout";
import { DevFlag } from "./shield";
import { devRepsFromTokens, type DevRep } from "@/lib/shield";

type Sort = "trending" | "new" | "top" | "gainers" | "losers" | "ours" | "live";
const SORTS: { id: Sort; label: string; icon?: string; narrow?: boolean }[] = [
  { id: "trending", label: "Trending", icon: "🔥" },
  { id: "new", label: "New", icon: "✨" },
  { id: "gainers", label: "Gainers", icon: "📈" },
  { id: "ours", label: "On ArkhamPad" },
  { id: "top", label: "Top" },
  { id: "losers", label: "Losers" },
  { id: "live", label: "Live", narrow: true },
];

export type Win = "5m" | "1h" | "6h" | "24h";
const WINS: Win[] = ["5m", "1h", "6h", "24h"];
/** Price change over the chosen window (24h when the short windows aren't in the database yet). */
const chg = (t: EToken, w: Win) => (w === "5m" ? t.change5m : w === "1h" ? t.change1h : w === "6h" ? t.change6h : undefined) ?? t.change24;
const volOf = (t: EToken, w: Win) => (w === "5m" ? t.vol5m_hype : w === "1h" ? t.vol1h_hype : w === "6h" ? t.vol6h_hype : undefined) ?? t.vol24_hype ?? 0;
const MIN_VOL: Record<Win, number> = { "5m": 0.2, "1h": 1, "6h": 2, "24h": 5 };

/** Trending: real money moving now, more buys than sells, not only one old whale. */
function trendScore(t: EToken) {
  const vol = t.vol24_hype || 0;
  const tx = (t.buys24 || 0) + (t.sells24 || 0);
  const buyShare = tx ? (t.buys24 || 0) / tx : 0.5;
  const fresh = t.last_trade_at ? Math.max(0.2, 1 - (Date.now() - Date.parse(t.last_trade_at)) / 86_400_000) : 0.2;
  return Math.log10(1 + vol) * 2 + Math.log10(1 + tx) + buyShare + fresh;
}
function sortTokens(list: EToken[], sort: Sort, w: Win) {
  const l = list.slice();
  if (w !== "24h" && sort !== "new" && sort !== "top" && sort !== "ours") {
    if (sort === "gainers") return l.filter((t) => volOf(t, w) >= MIN_VOL[w] && (chg(t, w) ?? 0) > 0).sort((a, b) => (chg(b, w) ?? -1e9) - (chg(a, w) ?? -1e9));
    if (sort === "losers") return l.filter((t) => volOf(t, w) >= MIN_VOL[w] && (chg(t, w) ?? 0) < 0).sort((a, b) => (chg(a, w) ?? 1e9) - (chg(b, w) ?? 1e9));
    return l.filter((t) => volOf(t, w) > 0).sort((a, b) => volOf(b, w) - volOf(a, w));
  }
  if (sort === "ours") return l.filter((t) => t.ours).sort((a, b) => (b.vol24_hype || 0) - (a.vol24_hype || 0) || Date.parse(b.created_at || "0") - Date.parse(a.created_at || "0"));
  if (sort === "new") return l.sort((a, b) => Date.parse(b.created_at || "0") - Date.parse(a.created_at || "0"));
  // Top: only coins people actually trade (spam tokens with a made-up price and no trades stay out)
  if (sort === "top") return l.filter((t) => (t.vol24_hype || 0) > 0 && (t.holders || 0) >= 5 && Date.parse(t.created_at || "") > Date.parse("2025-01-01")).sort((a, b) => (b.mcap_hype || 0) - (a.mcap_hype || 0));
  if (sort === "gainers") return l.filter((t) => (t.vol24_hype || 0) >= 5 && (t.change24 ?? 0) > 0).sort((a, b) => (b.change24 ?? -1e9) - (a.change24 ?? -1e9));
  if (sort === "losers") return l.filter((t) => (t.vol24_hype || 0) >= 5 && (t.change24 ?? 0) < 0).sort((a, b) => (a.change24 ?? 1e9) - (b.change24 ?? 1e9));
  return l.filter((t) => (t.vol24_hype || 0) > 0).sort((a, b) => trendScore(b) - trendScore(a));
}
const upDown = (v: number | null | undefined) => ((v ?? 0) >= 0 ? "up" : "down");

function Hot({ tokens, usd }: { tokens: EToken[]; usd: number }) {
  const tr = useT();
  const top = tokens.slice().sort((a, b) => (b.vol24_hype || 0) - (a.vol24_hype || 0)).slice(0, 10);
  return (
    <section>
      <div className="e-sec-h"><h2>{tr("Hot right now")}</h2><span className="dim" style={{ fontSize: 12.5 }}>{tr("by 24h volume")}</span></div>
      <div className="e-hot">
        {!tokens.length && <div className="e-hot-run">{Array.from({ length: 5 }, (_, i) => <div key={i} className="e-hc e-skel" style={{ height: 150 }} />)}</div>}
        {!!top.length && (
          <div className="e-hot-run on" style={{ ["--n" as string]: top.length }}>
            {[...top, ...top].map((t, j) => {
              const i = j % top.length;
              const tx = (t.buys24 || 0) + (t.sells24 || 0);
              const buys = tx ? Math.round(((t.buys24 || 0) / tx) * 100) : 50;
              return (
                <Link key={j} href={`/t/?a=${t.address}`} className="e-hc" aria-hidden={j >= top.length ? true : undefined} tabIndex={j >= top.length ? -1 : undefined}>
                  <div className="e-hc-top">
                    <TokenAvatar t={t} size={40} />
                    <div>
                      <b>{t.name}</b>
                      <small>{t.symbol} · {tr("{age} old", { age: ago(t.created_at) })}</small>
                    </div>
                    <span className="e-hc-rank">#{i + 1}</span>
                  </div>
                  <div className="e-hc-mid">
                    <strong>{money((t.mcap_hype ?? 0) * usd)}</strong>
                    <span className={`e-pill ${upDown(t.change24)}`}>{pct(t.change24)}</span>
                  </div>
                  <div className="e-press">
                    <span>{tr("Buys {p}% · {v} vol", { p: buys, v: money((t.vol24_hype || 0) * usd) })}</span>
                    <span className="e-press-bar"><i style={{ width: `${buys}%` }} /></span>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}


/** Coins we launched ourselves while testing: real and tradable, but never featured on the board. */
const HIDE = new Set((process.env.NEXT_PUBLIC_ELY_HIDE || "0x5031015cee9dac6a30ebc63336194d5df13e981a,0xb1493ce70b1436744a90df0e687f05d7cbef21c8").toLowerCase().split(",").map((x) => x.trim()));

/** Our own team's wallets: coins they launch anywhere (e.g. on Ascend) also show on the board. */
const TEAM = new Set((process.env.NEXT_PUBLIC_ELY_TEAM_CREATORS || "").toLowerCase().split(",").map((x) => x.trim()).filter(Boolean));

/** The ArkhamPad board: the newest coins launched here, first thing on Discover, so fresh launches get seen. */
function Board({ tokens, usd }: { tokens: EToken[]; usd: number }) {
  const tr = useT();
  const row = useRef<HTMLDivElement>(null);
  // on a computer: hold the mouse and drag the row sideways (a drag doesn't open the coin)
  useEffect(() => {
    const el = row.current;
    if (!el) return;
    let down = false, x0 = 0, s0 = 0, moved = false;
    const start = (e: PointerEvent) => { if (e.pointerType !== "mouse") return; down = true; moved = false; x0 = e.clientX; s0 = el.scrollLeft; el.classList.add("drag"); };
    const move = (e: PointerEvent) => { if (!down) return; const dx = e.clientX - x0; if (Math.abs(dx) > 5) moved = true; el.scrollLeft = s0 - dx; };
    const end = () => { if (!down) return; down = false; el.classList.remove("drag"); };
    const click = (e: MouseEvent) => { if (moved) { e.preventDefault(); e.stopPropagation(); moved = false; } };
    const noDrag = (e: DragEvent) => e.preventDefault();
    el.addEventListener("pointerdown", start);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    el.addEventListener("click", click, true);
    el.addEventListener("dragstart", noDrag);
    return () => { el.removeEventListener("pointerdown", start); window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", end); el.removeEventListener("click", click, true); el.removeEventListener("dragstart", noDrag); };
  }, []);
  const known = new Set(tokens.map((t) => t.address.toLowerCase()));
  const devReps = useMemo(() => devRepsFromTokens(tokens, usd), [tokens, usd]);
  const ours = [...tokens, ...pendingTokens().filter((t) => !known.has(t.address.toLowerCase()))].filter((t) => (t.ours || TEAM.has((t.creator || "").toLowerCase())) && !HIDE.has(t.address.toLowerCase())).sort((a, b) => Date.parse(b.created_at || "0") - Date.parse(a.created_at || "0")).slice(0, 12);
  return (
    <section className="e-board">
      <div className="e-sec-h">
        <h2><span className="e-board-dot" />{tr("Fresh on ArkhamPad")}</h2>
        <Link href="/create/" className="e-board-cta">{tr("Launch yours →")}</Link>
      </div>
      <div className="e-board-wrap">
      <button type="button" className="e-board-arrow l" aria-label="Back" onClick={() => row.current?.scrollBy({ left: -row.current.clientWidth * 0.8, behavior: "smooth" })}>‹</button>
      <button type="button" className="e-board-arrow r" aria-label="More" onClick={() => row.current?.scrollBy({ left: row.current.clientWidth * 0.8, behavior: "smooth" })}>›</button>
      <div className="e-board-row" ref={row}>
        {ours.map((t) => {
          const fresh = Date.now() - Date.parse(t.created_at || "0") < 3_600_000;
          return (
            <Link key={t.address} href={`/t/?a=${t.address}`} className="e-hc e-bc">
              <div className="e-hc-top">
                <TokenAvatar t={t} size={40} />
                <div>
                  <b>{t.name} <DevFlag rep={devReps.get((t.creator || "").toLowerCase())} /></b>
                  <small>{t.symbol} · {tr("{age} old", { age: ago(t.created_at) })}</small>
                </div>
                <span className="e-bc-badges">{fresh && <span className="e-new">{tr("NEW")}</span>}<ScoutBadge address={t.address} /></span>
              </div>
              <div className="e-hc-mid">
                <strong>{money((t.mcap_hype ?? 0) * usd)}</strong>
                <span className={`e-pill ${upDown(t.change24)}`}>{pct(t.change24)}</span>
              </div>
              <small className="dim" style={{ fontSize: 12 }}>{tr("by {who}", { who: short(t.creator) })} · {tr("{n} holders", { n: compact(t.holders || 0) })}</small>
            </Link>
          );
        })}
        {ours.length < 3 && (
          <Link href="/create/" className="e-hc e-bc e-bc-empty">
            <span className="e-spark" aria-hidden="true">✦</span>
            <b>{tr(ours.length ? "Your coin here next" : "Be the first coin on the board")}</b>
            <small className="dim">{tr("Launch in 30 seconds. Snipers watch new pools, so first buyers often come within minutes.")}</small>
          </Link>
        )}
      </div>
      </div>
    </section>
  );
}

/** Spotlight: the top-10 coins by 24h volume take turns (one a minute) in a big card with a live chart and one-tap buys. */
function Spotlight({ tokens, usd }: { tokens: EToken[]; usd: number }) {
  const tr = useT();
  const top = useMemo(() => tokens.filter((t) => (t.vol24_hype || 0) > 0 && !HIDE.has(t.address.toLowerCase())).sort((a, b) => (b.vol24_hype || 0) - (a.vol24_hype || 0)).slice(0, 10), [tokens]);
  const [i, setI] = useState(0);
  // one a minute; a swipe restarts the minute
  useEffect(() => { const id = setTimeout(() => setI((x) => x + 1), 60_000); return () => clearTimeout(id); }, [i]);
  const n = top.length; const idx = n ? ((i % n) + n) % n : 0;
  const t = n ? top[idx] : null;
  const sw = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const onDown = (e: React.PointerEvent) => { sw.current = { x: e.clientX, y: e.clientY, moved: false }; };
  const onUp = (e: React.PointerEvent) => { const s0 = sw.current; if (!s0) return; const dx = e.clientX - s0.x, dy = e.clientY - s0.y; if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy) * 1.2) { s0.moved = true; setI((x) => x + (dx < 0 ? 1 : -1)); } };
  const onClickCap = (e: React.MouseEvent) => { if (sw.current?.moved) { e.preventDefault(); e.stopPropagation(); sw.current = null; } };
  const trades = usePoll(async () => (t ? fetchTrades(t.address, 300) : null), 30_000, [t?.address]);
  if (!t) return <div className="e-spot e-skel" style={{ height: 186 }} />;
  const supply = t.supply ? Number(t.supply) / 10 ** (t.decimals ?? 18) : 0;
  const pts = (trades ?? []).filter((x) => (x.price_hype ?? 0) > 0).map((x) => ({ p: x.price_hype as number })).reverse();
  let path = "";
  if (pts.length > 2) {
    const ys = pts.map((x) => x.p); const lo = Math.min(...ys), hi = Math.max(...ys); const span = hi - lo || hi || 1;
    path = pts.map((x, k) => `${((k / (pts.length - 1)) * 300).toFixed(1)},${(70 - ((x.p - lo) / span) * 62).toFixed(1)}`).join(" ");
  }
  const up = (t.change24 ?? 0) >= 0;
  const mc = (t.mcap_hype ?? (supply * (t.price_hype ?? 0))) * usd;
  return (
    <section className="e-spot" onPointerDown={onDown} onPointerUp={onUp} onClickCapture={onClickCap}>
      <span className="e-spot-rank">#{idx + 1} {tr("by volume")}</span>
      <Link href={`/t/?a=${t.address}`} className="e-spot-h">
        <TokenAvatar t={t} size={42} />
        <span className="nm"><b>{t.name}</b><small>#{idx + 1} {tr("by volume")} · {compact(t.holders || 0)} {tr("holders")}</small></span>
        <span className="mc"><b>{money(mc)}</b><small style={{ color: up ? "#3fe3d4" : "#ff6b6b" }}>{pct(t.change24)} 24h</small></span>
      </Link>
      <svg viewBox="0 0 300 74" preserveAspectRatio="none" aria-hidden="true">{path && <polyline fill="none" stroke={up ? "#3fe3d4" : "#ff6b6b"} strokeWidth="2.4" strokeLinejoin="round" points={path} />}</svg>
      <div>
        <div className="e-spot-btns">
          <Link href={`/t/?a=${t.address}&buy=0.1`} className="g">{tr("Buy")} 0.1</Link>
          <Link href={`/t/?a=${t.address}&buy=0.5`} className="g">{tr("Buy")} 0.5</Link>
          <Link href={`/t/?a=${t.address}`}>{tr("Chart")} →</Link>
        </div>
        <div className="e-spot-dots">{top.map((_, k) => <i key={k} className={k === idx ? "on" : ""} onClick={() => setI(k)} />)}</div>
      </div>
    </section>
  );
}

function TradeItem({ x, t, usd }: { x: ETrade; t?: EToken; usd: number }) {
  const tr = useT();
  return (
    <li>
      {t ? <TokenAvatar t={t} size={30} /> : <span />}
      <Link href={`/t/?a=${x.token}`} className="who">
        <b>{t?.symbol ?? short(x.token)}</b>
        <span className="dim">{tr(x.side === "buy" ? "Bought by {who}" : "Sold by {who}", { who: x.trader ? short(x.trader) : "—" })} · {ago(x.at)}</span>
      </Link>
      <span className={`amt num ${x.side === "buy" ? "up" : "down"}`}>
        {x.side === "buy" ? "+" : "−"}{money(x.hype * usd)}
        <span className="dim" style={{ display: "block", fontSize: 11.5 }}>{x.hype.toFixed(x.hype < 1 ? 3 : 2)} HYPE</span>
      </span>
    </li>
  );
}
function TradeList({ byAddr, usd, n = 24 }: { byAddr: Map<string, EToken>; usd: number; n?: number }) {
  const trades = usePoll(() => fetchLiveTrades(n), 6000);
  return (
    <ul>
      {(trades ?? []).map((x) => <TradeItem key={`${x.tx}-${x.log_index}`} x={x} t={byAddr.get(x.token)} usd={usd} />)}
      {!trades && Array.from({ length: 8 }, (_, i) => <li key={i}><span className="e-skel" style={{ width: 30, height: 30, borderRadius: 999 }} /><span className="e-skel" style={{ height: 30 }} /><span /></li>)}
    </ul>
  );
}

function Row({ t, i, usd, w, rep }: { t: EToken; i: number; usd: number; w: Win; rep?: DevRep }) {
  const c = chg(t, w);
  const tr = useT();
  const mc = money((t.mcap_hype ?? 0) * usd);
  return (
    <Link href={`/t/?a=${t.address}`} className="e-row">
      <span className="dim num e-hide-m">{i + 1}</span>
      <span className="e-tok">
        <RingAvatar t={t} size={34} />
        <span>
          <span className="l1"><b>{t.name}</b><span className="sym">{t.symbol}</span><DevFlag rep={rep} />{t.ours && <span className="e-lock">LP locked</span>}<ScoutBadge address={t.address} /></span>
          <small>
            <span className="e-hide-m">{tr("by {who}", { who: short(t.creator) })} · {tr("{age} old", { age: ago(t.created_at) })}</span>
            <span className="e-only-m-inline">{tr("{age} old", { age: ago(t.created_at) })} · {tr("{n} holders", { n: compact(t.holders || 0) })}</span>
          </small>
        </span>
      </span>
      <span className={`r num e-hide-m ${upDown(c)}`}>{pct(c)}</span>
      <span className="r num e-hide-m">{money(volOf(t, w) * usd)}</span>
      <span className="r num e-hide-t e-hide-m"><span className="up">{t.buys24}</span><span className="dim"> / </span><span className="down">{t.sells24}</span></span>
      <span className="r num e-hide-m">{compact(t.holders || 0)}</span>
      <span className="r num muted e-hide-t e-hide-m">{t.top10_pct == null ? "—" : `${Math.min(100, t.top10_pct).toFixed(0)}%`}</span>
      <span className="r num e-hide-m"><b>{mc}</b></span>
      <span className="e-mc"><span className="e-mc-px"><b>{mc}</b><small>{tinyPrice((t.price_hype ?? 0) * usd)}</small></span><span className={`e-pill fill ${upDown(c)}`}>{pct(c)}</span></span>
    </Link>
  );
}

export function Discover() {
  const tr = useT();
  const params = useSearchParams();
  const r = useRouter();
  const tokens = useTokens(30_000);
  // the list holds at most 1,000 coins (the busiest); the real total comes from the stats
  const stats = usePoll(() => fetchStats().catch(() => null), 300_000);
  const usd = usePoll(fetchHypeUsd, 30_000) ?? 0;
  const [sort, setSort] = useState<Sort>("trending");
  const [win, setWin] = useState<Win>("24h");
  const [shown, setShown] = useState(50);
  const q = (params.get("q") || "").trim().toLowerCase();

  const list = useMemo(() => {
    let l = tokens ?? [];
    if (q) l = l.filter((t) => t.name.toLowerCase().includes(q) || t.symbol.toLowerCase().includes(q) || t.address === q);
    return sortTokens(l, sort, win);
  }, [tokens, sort, q, win]);

  const byAddr = useMemo(() => new Map((tokens ?? []).map((t) => [t.address, t])), [tokens]);
  const devReps = useMemo(() => devRepsFromTokens(tokens ?? [], usd), [tokens, usd]);
  const vol = (tokens ?? []).reduce((s, t) => s + (t.vol24_hype || 0), 0);

  return (
    <main className="e-in e-page">
      <Spotlight tokens={tokens ?? []} usd={usd} />

      <div className="e-promos">
        <PioneerBanner />
        <AirdropBanner />
      </div>
      <Board tokens={tokens ?? []} usd={usd} />

      <div className="e-wrap">
        <section className="e-panel">
          <div className="e-bar">
            <div className="e-scrollx">
              <div className="e-tabs" role="tablist">
                {SORTS.map((s) => (
                  <button key={s.id} type="button" role="tab" aria-selected={sort === s.id} className={`e-tab ${sort === s.id ? "on" : ""} ${s.narrow ? "e-narrow" : ""}`} onClick={() => { setSort(s.id); setShown(50); }}>{s.icon ? `${s.icon} ` : ""}{tr(s.label)}</button>
                ))}
              </div>
            </div>
            {sort !== "live" && sort !== "new" && (
              <div className="e-wins" role="group" aria-label={tr("Time")}>
                {WINS.map((x) => <button key={x} type="button" className={win === x ? "on" : ""} aria-pressed={win === x} onClick={() => { setWin(x); setShown(50); }}>{x}</button>)}
              </div>
            )}
            {q && sort !== "live" && (
              <div className="e-scrollx" style={{ alignItems: "center" }}>
                <span className="muted" style={{ fontSize: 13.5, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{tr("Results for “{q}”", { q })}</span>
                <button type="button" className="e-chip" onClick={() => r.push("/")}>{tr("Clear")}</button>
              </div>
            )}
          </div>

          {sort === "live" ? (
            <div className="e-feed"><TradeList byAddr={byAddr} usd={usd} n={30} /></div>
          ) : (
            <>
              <div className="e-row h">
                <span className="e-hide-m">#</span>
                <span>{tr("Token")}</span>
                <span className="r e-hide-m">{win}</span>
                <span className="r e-hide-m">{tr("Volume")}</span>
                <span className="r e-hide-t e-hide-m">{tr("Txns")}</span>
                <span className="r e-hide-m">{tr("Holders")}</span>
                <span className="r e-hide-t e-hide-m">{tr("Top 10")}</span>
                <span className="r e-hide-m">{tr("Mkt cap")}</span>
              </div>
              <div className="e-rows">
                {list.slice(0, shown).map((t, i) => <Row key={t.address} t={t} i={i} usd={usd} w={win} rep={devReps.get((t.creator || "").toLowerCase())} />)}
              </div>
              {!tokens && <div style={{ padding: 14, display: "grid", gap: 10 }}>{Array.from({ length: 8 }, (_, i) => <div key={i} className="e-skel" style={{ height: 48 }} />)}</div>}
              {tokens && !list.length && <div className="e-empty">{tr("No tokens here yet.")}</div>}
              {list.length > shown && <button type="button" className="e-more" onClick={() => setShown((s) => s + 50)}>{tr("Show more")}</button>}
            </>
          )}
        </section>
        <aside className="e-panel e-feed">
          <h3>{tr("Live trades")} <span className="e-eyebrow" style={{ fontSize: 12 }}><i className="e-dot" />{tr("live")}</span></h3>
          <TradeList byAddr={byAddr} usd={usd} />
        </aside>
      </div>
    </main>
  );
}
