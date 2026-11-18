"use client";

/**
 * Arena: AI agents call where BTC, ETH and SOL go over the next 30 seconds, 5 minutes or 15 minutes,
 * live, with simulated money. Prices are Hyperliquid's public mid prices. Nothing here touches real
 * funds: it is a scoreboard that shows which kind of strategy is right more often, after fees.
 * You can play the same rounds with a simulated balance.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { info, fetchPerpCandles } from "@/lib/hl";

const ASSETS = ["BTC", "ETH", "SOL"] as const;
type Asset = (typeof ASSETS)[number];
const FRAMES = [{ id: "30s", ms: 30_000, label: "30 sec" }, { id: "5m", ms: 300_000, label: "5 min" }, { id: "15m", ms: 900_000, label: "15 min" }] as const;
type Frame = (typeof FRAMES)[number]["id"];
type Dir = "UP" | "DOWN";
type Pt = { t: number; p: number };

const STAKE = 100; // simulated dollars per agent call
const FEE = 0.04; // taken from winnings, like a prediction market's spread
const START_BAL = 1000;
const LOCK = 0.8; // you can call until 80% of the round has passed

type Agent = { id: string; name: string; tag: string; color: string; read: (s: Pt[], now: number, ms: number) => number };

const at = (s: Pt[], t: number) => { for (let i = s.length - 1; i >= 0; i--) if (s[i].t <= t) return s[i].p; return s[0]?.p ?? 0; };
const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const clamp = (v: number) => Math.max(-1, Math.min(1, v));

function rsi(s: Pt[], n: number) {
  const p = s.slice(-n - 1).map((x) => x.p);
  let g = 0, l = 0;
  for (let i = 1; i < p.length; i++) { const d = p[i] - p[i - 1]; if (d > 0) g += d; else l -= d; }
  return l === 0 ? (g === 0 ? 50 : 100) : 100 - 100 / (1 + g / l);
}

const AGENTS: Agent[] = [
  { id: "momentum", name: "Momentum", tag: "Follows the last move", color: "#C6F01C", read: (s, now, ms) => { const p = s.at(-1)!.p; const b = at(s, now - ms); return clamp(((p - b) / b) * (6000 * 30_000 / ms ** 0.5 / 173)); } },
  { id: "reversion", name: "Reversion", tag: "Bets on a snap back", color: "#4F7CFF", read: (s, now, ms) => { const w = s.filter((x) => x.t >= now - ms * 4).map((x) => x.p); if (w.length < 5) return 0; const m = mean(w); const sd = Math.sqrt(mean(w.map((x) => (x - m) ** 2))) || 1e-9; return clamp(-(w.at(-1)! - m) / (2 * sd)); } },
  { id: "breakout", name: "Breakout", tag: "Rides range breaks", color: "#F08A3C", read: (s, now, ms) => { const w = s.filter((x) => x.t >= now - ms * 5).map((x) => x.p); if (w.length < 5) return 0; const hi = Math.max(...w), lo = Math.min(...w); if (hi === lo) return 0; const pos = (w.at(-1)! - lo) / (hi - lo); return clamp((pos - 0.5) * 2.2); } },
  { id: "trend", name: "Trend", tag: "Fast vs slow average", color: "#9B8CFF", read: (s, now, ms) => { const f = mean(s.filter((x) => x.t >= now - ms).map((x) => x.p)); const sl = mean(s.filter((x) => x.t >= now - ms * 4).map((x) => x.p)); if (!f || !sl) return 0; return clamp(((f - sl) / sl) * 4000); } },
  { id: "rsi", name: "Exhaustion", tag: "Fades overbought and oversold", color: "#F0B90B", read: (s) => clamp(-(rsi(s, 24) - 50) / 30) },
];

/** The "Apex" agent weighs the other five by how well each has been doing for this timeframe. */
const APEX = { id: "apex", name: "Apex", tag: "Blends all five", color: "#2EBD85" };

type Call = { dir: Dir; conf: number };
type Round = { key: string; asset: Asset; frame: Frame; start: number; end: number; open: number; calls: Record<string, Call>; you?: { dir: Dir; stake: number } };
type Done = { id: string; asset: Asset; frame: Frame; end: number; open: number; close: number; up: boolean | null; calls: Record<string, Call>; you?: { dir: Dir; stake: number } };
type Stat = { w: number; l: number; v: number; pnl: number; streak: number };
type Stats = Record<string, Record<string, Stat>>; // [frame][agent]

const blank = (): Stat => ({ w: 0, l: 0, v: 0, pnl: 0, streak: 0 });
const KEY = "arena.v1";

function settle(stat: Stat, win: boolean | null, stake: number) {
  if (win === null) { stat.v++; return; }
  if (win) { stat.w++; stat.pnl += stake * (1 - FEE); stat.streak = stat.streak > 0 ? stat.streak + 1 : 1; }
  else { stat.l++; stat.pnl -= stake; stat.streak = stat.streak < 0 ? stat.streak - 1 : -1; }
}

const money = (v: number, d = 2) => `${v < 0 ? "−" : ""}$${Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d })}`;
const signed = (v: number) => `${v >= 0 ? "+" : "−"}$${Math.abs(v).toFixed(0)}`;
const px = (a: Asset, v: number) => v.toLocaleString("en-US", { minimumFractionDigits: a === "SOL" ? 3 : 1, maximumFractionDigits: a === "SOL" ? 3 : 1 });
const tone = (v: number) => (v > 0 ? "up" : v < 0 ? "down" : "dim");

export function ArenaScreen() {
  const [asset, setAsset] = useState<Asset>("BTC");
  const [frame, setFrame] = useState<Frame>("30s");
  const [, setBeat] = useState(0);
  const [live, setLive] = useState<"loading" | "ok" | "down">("loading");
  const series = useRef<Record<Asset, Pt[]>>({ BTC: [], ETH: [], SOL: [] });
  const rounds = useRef<Map<string, Round>>(new Map());
  const done = useRef<Done[]>([]);
  const stats = useRef<Stats>({});
  const bal = useRef(START_BAL);
  const youStats = useRef<Record<string, Stat>>({});
  const lastOk = useRef(0);

  // saved scoreboard, kept in this browser only
  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) { const j = JSON.parse(raw); stats.current = j.stats ?? {}; bal.current = j.bal ?? START_BAL; youStats.current = j.you ?? {}; done.current = j.done ?? []; }
    } catch {}
    setBeat((b) => b + 1);
  }, []);
  const save = useCallback(() => {
    try { localStorage.setItem(KEY, JSON.stringify({ stats: stats.current, bal: bal.current, you: youStats.current, done: done.current.slice(0, 60) })); } catch {}
  }, []);

  const call = useCallback((a: Asset, f: Frame, ms: number, now: number): Record<string, Call> => {
    const s = series.current[a];
    const out: Record<string, Call> = {};
    const raw: Record<string, number> = {};
    for (const ag of AGENTS) {
      let v = 0;
      try { v = ag.read(s, now, ms); } catch {}
      raw[ag.id] = v;
      out[ag.id] = { dir: v >= 0 ? "UP" : "DOWN", conf: Math.abs(v) };
    }
    // Apex: weigh each agent by its record on this timeframe (equal weight until it has history)
    let tot = 0, wsum = 0;
    for (const ag of AGENTS) {
      const st = stats.current[f]?.[ag.id];
      const n = st ? st.w + st.l : 0;
      const wr = n >= 5 ? st!.w / n : 0.5;
      const w = Math.max(0.05, (wr - 0.4) * 5);
      tot += raw[ag.id] * w; wsum += w;
    }
    const v = wsum ? tot / wsum : 0;
    out[APEX.id] = { dir: v >= 0 ? "UP" : "DOWN", conf: Math.abs(v) };
    return out;
  }, []);

  // one pass per tick: settle finished rounds, open new ones
  const step = useCallback((now: number) => {
    let changed = false;
    for (const a of ASSETS) {
      const s = series.current[a];
      if (s.length < 6) continue;
      const price = s.at(-1)!.p;
      for (const f of FRAMES) {
        const key = `${a}|${f.id}`;
        const r = rounds.current.get(key);
        if (r && now >= r.end) {
          const late = now - r.end > 8_000; // tab was asleep: the close price is not trustworthy
          const close = late ? at(s, r.end) : price;
          const up = late && !s.some((x) => x.t >= r.end - 5000 && x.t <= r.end + 5000) ? null : close === r.open ? null : close > r.open;
          const fs = (stats.current[f.id] ??= {});
          for (const [id, c] of Object.entries(r.calls)) settle((fs[id] ??= blank()), up === null ? null : (c.dir === "UP") === up, STAKE);
          if (r.you) {
            const win = up === null ? null : (r.you.dir === "UP") === up;
            settle((youStats.current[f.id] ??= blank()), win, r.you.stake);
            bal.current += win === null ? 0 : win ? r.you.stake * (1 - FEE) : -r.you.stake;
          }
          done.current.unshift({ id: `${key}|${r.start}`, asset: a, frame: f.id, end: r.end, open: r.open, close, up, calls: r.calls, you: r.you });
          if (done.current.length > 200) done.current.length = 200;
          rounds.current.delete(key);
          changed = true;
        }
        if (!rounds.current.has(key)) {
          const start = Math.floor(now / f.ms) * f.ms;
          rounds.current.set(key, { key, asset: a, frame: f.id, start, end: start + f.ms, open: price, calls: call(a, f.id, f.ms, now) });
          changed = true;
        }
      }
    }
    if (changed) save();
  }, [call, save]);

  // seed history so the agents have something to read on the first round
  useEffect(() => {
    let dead = false;
    (async () => {
      for (const a of ASSETS) {
        try {
          const c = await fetchPerpCandles(a, "1m", 90);
          if (dead) return;
          const pts = c.map((k) => ({ t: k.t + 60_000, p: k.c })).filter((k) => k.t < Date.now() - 2000);
          series.current[a] = [...pts, ...series.current[a].filter((x) => !pts.length || x.t > pts.at(-1)!.t)];
        } catch {}
      }
    })();
    return () => { dead = true; };
  }, []);

  // live prices
  useEffect(() => {
    let dead = false;
    let busy = false;
    const pull = async () => {
      if (busy || document.hidden) return;
      busy = true;
      try {
        const m = await info<Record<string, string>>({ type: "allMids" });
        const now = Date.now();
        for (const a of ASSETS) {
          const p = Number(m[a]);
          if (!Number.isFinite(p) || p <= 0) continue;
          const s = series.current[a];
          s.push({ t: now, p });
          const cut = now - 100 * 60_000;
          while (s.length && s[0].t < cut) s.shift();
        }
        lastOk.current = now;
        if (!dead) { setLive("ok"); step(now); }
      } catch { if (!dead && Date.now() - lastOk.current > 15_000) setLive("down"); }
      busy = false;
    };
    pull();
    const t = setInterval(pull, 1500);
    const b = setInterval(() => setBeat((x) => x + 1), 250);
    const vis = () => { if (!document.hidden) pull(); };
    document.addEventListener("visibilitychange", vis);
    return () => { dead = true; clearInterval(t); clearInterval(b); document.removeEventListener("visibilitychange", vis); };
  }, [step]);

  const now = Date.now();
  const f = FRAMES.find((x) => x.id === frame)!;
  const round = rounds.current.get(`${asset}|${frame}`);
  const s = series.current[asset];
  const price = s.at(-1)?.p ?? 0;
  const move = round && round.open ? ((price - round.open) / round.open) * 100 : 0;
  const left = round ? Math.max(0, round.end - now) : f.ms;
  const frac = round ? Math.min(1, (now - round.start) / f.ms) : 0;
  const locked = !round || frac >= LOCK;

  const place = (dir: Dir, stake: number) => {
    const r = rounds.current.get(`${asset}|${frame}`);
    if (!r || r.you || (Date.now() - r.start) / (r.end - r.start) >= LOCK || bal.current < stake) return;
    r.you = { dir, stake };
    setBeat((x) => x + 1);
  };
  const [stake, setStake] = useState(50);
  const reset = () => { bal.current = START_BAL; youStats.current = {}; stats.current = {}; done.current = []; save(); setBeat((x) => x + 1); };

  const board = useMemo(() => {
    const fs = stats.current[frame] ?? {};
    const rows = [...AGENTS.map((a) => ({ id: a.id, name: a.name, tag: a.tag, color: a.color })), { ...APEX }].map((a) => {
      const st = fs[a.id] ?? blank();
      const n = st.w + st.l;
      return { ...a, st, n, wr: n ? (st.w / n) * 100 : null };
    });
    return rows.sort((x, y) => y.st.pnl - x.st.pnl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frame, now >> 11]);
  const me = youStats.current[frame] ?? blank();
  const meN = me.w + me.l;
  const recent = done.current.filter((d) => d.asset === asset && d.frame === frame).slice(0, 14);

  // chart: last few rounds
  const span = Math.max(f.ms * 3, 120_000);
  const pts = s.filter((x) => x.t >= now - span);
  const W = 640, H = 220, pad = 8;
  const lo = Math.min(...pts.map((x) => x.p), round?.open ?? Infinity), hi = Math.max(...pts.map((x) => x.p), round?.open ?? -Infinity);
  const rng = hi - lo || 1;
  const X = (t: number) => pad + ((t - (now - span)) / span) * (W - pad * 2);
  const Y = (p: number) => H - pad - ((p - lo) / rng) * (H - pad * 2);
  const path = pts.length > 1 ? pts.map((x, i) => `${i ? "L" : "M"}${X(x.t).toFixed(1)},${Y(x.p).toFixed(1)}`).join("") : "";
  const upNow = round ? price >= round.open : true;

  return (
    <>
      <main className="e-in e-page arena">
        <div className="ar-head">
          <div>
            <h1>Arena</h1>
            <p className="dim">AI agents call BTC, ETH and SOL every 30 seconds, 5 minutes and 15 minutes. Live prices, simulated money: see which strategy is actually right, after fees.</p>
          </div>
          <span className={`ar-live ${live}`}>{live === "ok" ? "Live" : live === "loading" ? "Connecting…" : "Price feed down, retrying"}</span>
        </div>

        <div className="ar-pick">
          <div className="ar-seg" role="tablist" aria-label="Asset">
            {ASSETS.map((a) => <button key={a} type="button" className={a === asset ? "on" : ""} onClick={() => setAsset(a)}>{a}</button>)}
          </div>
          <div className="ar-seg" role="tablist" aria-label="Round length">
            {FRAMES.map((x) => <button key={x.id} type="button" className={x.id === frame ? "on" : ""} onClick={() => setFrame(x.id)}>{x.label}</button>)}
          </div>
        </div>

        <div className="ar-grid">
          <section className="ar-card ar-main">
            <div className="ar-price">
              <span className="num ar-big">{price ? `$${px(asset, price)}` : "…"}</span>
              <span className={`num ${tone(move)}`}>{round ? `${move >= 0 ? "+" : ""}${move.toFixed(3)}% this round` : ""}</span>
            </div>
            <div className="ar-chart">
              {path ? (
                <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={`${asset} price, last rounds`}>
                  {round && <line x1={pad} x2={W - pad} y1={Y(round.open)} y2={Y(round.open)} className="ar-open" />}
                  {round && <rect x={X(round.start)} y={0} width={Math.max(0, X(Math.min(now, round.end)) - X(round.start))} height={H} className={upNow ? "ar-band up" : "ar-band down"} />}
                  <path d={path} className={upNow ? "ar-line up" : "ar-line down"} fill="none" />
                  <circle cx={X(pts.at(-1)!.t)} cy={Y(pts.at(-1)!.p)} r="4" className={upNow ? "ar-dot up" : "ar-dot down"} />
                </svg>
              ) : <div className="ar-skel" style={{ height: H }} />}
              {round && <span className="ar-tag num" style={{ top: `${(Y(round.open) / H) * 100}%` }}>open ${px(asset, round.open)}</span>}
            </div>
            <div className="ar-timer">
              <div className="ar-bar"><i style={{ width: `${frac * 100}%` }} /></div>
              <span className="num">{round ? `${Math.floor(left / 60000)}:${String(Math.floor((left % 60000) / 1000)).padStart(2, "0")}` : "—"} left</span>
            </div>

            <div className="ar-you">
              <div className="ar-you-top">
                <b>Your call</b>
                <span className="num dim">Play balance {money(bal.current, 0)}</span>
              </div>
              {round?.you ? (
                <div className={`ar-called ${round.you.dir === "UP" ? "up" : "down"}`}>You called {round.you.dir} for {money(round.you.stake, 0)}. Result when the round ends.</div>
              ) : (
                <>
                  <div className="ar-chips">{[10, 50, 100, 250].map((v) => <button key={v} type="button" className={v === stake ? "on" : ""} onClick={() => setStake(v)} disabled={v > bal.current}>${v}</button>)}</div>
                  <div className="ar-btns">
                    <button type="button" className="ar-btn buy" disabled={locked || bal.current < stake} onClick={() => place("UP", stake)}>Up ▲</button>
                    <button type="button" className="ar-btn sell" disabled={locked || bal.current < stake} onClick={() => place("DOWN", stake)}>Down ▼</button>
                  </div>
                  <span className="dim ar-fine">{locked ? "Calls are closed for this round. Next one starts in a moment." : `Win ${money(stake * (1 - FEE), 0)} if right, lose ${money(stake, 0)} if wrong. Simulated money.`}</span>
                </>
              )}
              {meN > 0 && <span className="dim ar-fine num">You: {me.w}W {me.l}L · {((me.w / meN) * 100).toFixed(0)}% right · <span className={tone(me.pnl)}>{signed(me.pnl)}</span></span>}
            </div>
          </section>

          <section className="ar-card ar-side">
            <div className="ar-sh"><b>Agents this round</b><span className="dim">{asset} · {f.label}</span></div>
            <div className="ar-agents">
              {[...AGENTS, APEX].map((a) => {
                const c = round?.calls[a.id];
                const row = board.find((b) => b.id === a.id);
                const right = round && c ? (c.dir === "UP") === upNow : null;
                return (
                  <div key={a.id} className="ar-agent">
                    <span className="ar-av" style={{ background: a.color }} aria-hidden="true" />
                    <span className="ar-nm"><b>{a.name}</b><small className="dim">{a.tag}</small></span>
                    <span className="ar-call">
                      {c ? <b className={c.dir === "UP" ? "up" : "down"}>{c.dir === "UP" ? "▲ UP" : "▼ DOWN"}</b> : <span className="dim">…</span>}
                      {c && <small className="dim num">{Math.round(40 + c.conf * 55)}% sure</small>}
                    </span>
                    <span className={`ar-state ${right === null ? "" : right ? "up" : "down"}`} title={right ? "Winning now" : "Losing now"}>{right === null ? "" : right ? "●" : "○"}</span>
                    <span className="ar-pnl num"><span className={tone(row?.st.pnl ?? 0)}>{signed(row?.st.pnl ?? 0)}</span></span>
                  </div>
                );
              })}
            </div>
          </section>
        </div>

        <section className="ar-card">
          <div className="ar-sh"><b>Leaderboard · {f.label} rounds</b><span className="dim">$100 per call, after a {FEE * 100}% fee on wins</span></div>
          <div className="ar-tablewrap">
            <table className="ar-table">
              <thead><tr><th>#</th><th>Agent</th><th>Right</th><th>Calls</th><th>Streak</th><th>P&amp;L</th></tr></thead>
              <tbody>
                {board.map((r, i) => (
                  <tr key={r.id}>
                    <td className="dim">{i + 1}</td>
                    <td><span className="ar-av" style={{ background: r.color }} aria-hidden="true" /> <b>{r.name}</b></td>
                    <td className="num">{r.wr === null ? "—" : `${r.wr.toFixed(0)}%`}</td>
                    <td className="num dim">{r.n}</td>
                    <td className={`num ${r.st.streak > 0 ? "up" : r.st.streak < 0 ? "down" : "dim"}`}>{r.st.streak === 0 ? "—" : `${r.st.streak > 0 ? "W" : "L"}${Math.abs(r.st.streak)}`}</td>
                    <td className={`num ${tone(r.st.pnl)}`}>{signed(r.st.pnl)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <span className="dim ar-fine">Scores build while this page is open. Right after fees, anything around 52% or lower is losing money; that is the bar to beat.</span>
        </section>

        <section className="ar-card">
          <div className="ar-sh"><b>Recent rounds</b><span className="dim">{asset} · {f.label}</span></div>
          {recent.length ? (
            <div className="ar-hist">
              {recent.map((d) => (
                <span key={d.id} className={`ar-res ${d.up === null ? "" : d.up ? "up" : "down"}`} title={`${px(asset, d.open)} → ${px(asset, d.close)}`}>
                  {d.up === null ? "flat" : d.up ? "▲" : "▼"} {(((d.close - d.open) / d.open) * 100).toFixed(2)}%
                </span>
              ))}
            </div>
          ) : <span className="dim">Finished rounds show up here.</span>}
          <div className="ar-foot">
            <span className="dim ar-fine">Simulation only. No real money moves on this page, and it is not financial advice. Prices come from Hyperliquid. Scores are saved in this browser.</span>
            <button type="button" className="e-btn" onClick={reset}>Reset scores</button>
          </div>
        </section>
      </main>
    </>
  );
}
