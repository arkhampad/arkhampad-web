"use client";

/**
 * Arena: 24 small AI agents (price, indicators, volume, flow, structure) each call BTC, ETH and SOL up or
 * down for the next 30 seconds, 5 minutes or 15 minutes. A "Brain" learns, round after round, which agents
 * to trust and turns them into one probability. Everything is scored live with simulated money, and every
 * call is kept so you can see which agent is right and which is wrong. Prices: Hyperliquid public data.
 * Nothing here touches real funds.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { info, fetchPerpCandles } from "@/lib/hl";
import { ArenaBrain } from "@/lib/arenabrain";
import { LIVE_AGENTS, fetchCtxs, fetchImbalance, liveScores, type LiveCtx } from "@/lib/arenalive";
import { ArenaMarket } from "./arenamarket";

const ASSETS = ["BTC", "ETH", "SOL"] as const;
type Asset = (typeof ASSETS)[number];
const FRAMES = [{ id: "30s", ms: 30_000, label: "30 sec", h: 1 }, { id: "5m", ms: 300_000, label: "5 min", h: 5 }, { id: "15m", ms: 900_000, label: "15 min", h: 15 }] as const;
type Frame = (typeof FRAMES)[number]["id"];
type Dir = "UP" | "DOWN";
type Pt = { t: number; p: number };
type Candle = { t: number; o: number; h: number; l: number; c: number; v: number };

const STAKE = 100; // simulated dollars per call
const FEE = 0.04; // taken from winnings, like a prediction market's spread
const START_BAL = 1000;
const LOCK = 0.8; // you can call until 80% of the round has passed
const SIGNAL = 0.1; // the Brain only says "signal" when it is at least 60% sure
const CAND = ArenaBrain.AGENTS as { id: string; name: string; group: string }[];
const AG: { id: string; name: string; group: string }[] = [...CAND, ...LIVE_AGENTS];
const N = AG.length;
const NL = LIVE_AGENTS.length;
const BRAIN = { id: "brain", name: "Brain", group: "All agents" };
const BRAIN_SIG = { id: "brainSig", name: "Brain, strong signals only", group: "All agents" };
const NAME: Record<string, string> = Object.fromEntries([...AG, BRAIN, BRAIN_SIG].map((a) => [a.id, a.name]));

type Call = { dir: Dir; conf: number };
type Round = { key: string; asset: Asset; frame: Frame; start: number; end: number; open: number; x: number[]; p: number; calls: Record<string, Call>; you?: { dir: Dir; stake: number } };
type Done = { id: string; asset: Asset; frame: Frame; end: number; open: number; close: number; up: boolean | null; p: number; calls: Record<string, Call>; you?: { dir: Dir; stake: number } };
type Stat = { w: number; l: number; v: number; pnl: number; streak: number };
type Stats = Record<string, Record<string, Stat>>; // [frame][agent]

const blank = (): Stat => ({ w: 0, l: 0, v: 0, pnl: 0, streak: 0 });
const KEY = "arena.v2";

function settle(stat: Stat, win: boolean | null, stake: number) {
  if (win === null) { stat.v++; return; }
  if (win) { stat.w++; stat.pnl += stake * (1 - FEE); stat.streak = stat.streak > 0 ? stat.streak + 1 : 1; }
  else { stat.l++; stat.pnl -= stake; stat.streak = stat.streak < 0 ? stat.streak - 1 : -1; }
}

const money = (v: number, d = 2) => `${v < 0 ? "−" : ""}$${Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d })}`;
const signed = (v: number) => `${v >= 0 ? "+" : "−"}$${Math.abs(v).toFixed(0)}`;
const px = (a: Asset, v: number) => v.toLocaleString("en-US", { minimumFractionDigits: a === "SOL" ? 3 : 1, maximumFractionDigits: a === "SOL" ? 3 : 1 });
const tone = (v: number) => (v > 0 ? "up" : v < 0 ? "down" : "dim");
const at = (s: Pt[], t: number) => { for (let i = s.length - 1; i >= 0; i--) if (s[i].t <= t) return s[i].p; return s[0]?.p ?? 0; };

function ArenaRounds() {
  const [asset, setAsset] = useState<Asset>("BTC");
  const [frame, setFrame] = useState<Frame>("30s");
  const [, setBeat] = useState(0);
  const [live, setLive] = useState<"loading" | "ok" | "down">("loading");
  const [trained, setTrained] = useState(0);
  const [showAll, setShowAll] = useState(false);
  const series = useRef<Record<Asset, Pt[]>>({ BTC: [], ETH: [], SOL: [] });
  const candles = useRef<Record<Asset, Candle[]>>({ BTC: [], ETH: [], SOL: [] });
  const brains = useRef<Record<string, any>>({});
  const rounds = useRef<Map<string, Round>>(new Map());
  const done = useRef<Done[]>([]);
  const stats = useRef<Stats>({});
  const bal = useRef(START_BAL);
  const youStats = useRef<Record<string, Stat>>({});
  const lastOk = useRef(0);
  const liveRef = useRef<Record<string, LiveCtx>>({});

  const brainFor = (a: Asset, f: Frame) => (brains.current[`${a}|${f}`] ??= new (ArenaBrain.Brain as any)(N, 0.01, 0.002));

  // saved scoreboard and what the Brain has learned, kept in this browser only
  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const j = JSON.parse(raw);
        stats.current = j.stats ?? {}; bal.current = j.bal ?? START_BAL; youStats.current = j.you ?? {}; done.current = j.done ?? [];
      }
    } catch {}
    setBeat((b) => b + 1);
  }, []);
  const save = useCallback(() => {
    try { localStorage.setItem(KEY, JSON.stringify({ stats: stats.current, bal: bal.current, you: youStats.current, done: done.current.slice(0, 80) })); } catch {}
  }, []);

  // closed candles only: the forming one has partial volume
  const closed = (a: Asset, now: number) => {
    const c = candles.current[a];
    return c.length && c[c.length - 1].t + 60_000 > now ? c.slice(0, -1) : c;
  };

  const predict = useCallback((a: Asset, f: Frame, h: number, now: number) => {
    const c = closed(a, now).slice(-151);
    if (c.length < 100) return null;
    const x: number[] = [...ArenaBrain.features(c, h), ...liveScores(liveRef.current[a])];
    const p: number = brainFor(a, f).p(x);
    const calls: Record<string, Call> = {};
    AG.forEach((ag, i) => { calls[ag.id] = { dir: x[i] >= 0 ? "UP" : "DOWN", conf: Math.min(1, Math.abs(x[i])) }; });
    calls[BRAIN.id] = { dir: p >= 0.5 ? "UP" : "DOWN", conf: Math.abs(p - 0.5) * 2 };
    if (Math.abs(p - 0.5) >= SIGNAL) calls[BRAIN_SIG.id] = calls[BRAIN.id];
    return { x, p, calls };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // one pass per tick: settle finished rounds (and teach the Brain), open new ones
  const step = useCallback((now: number) => {
    let changed = false;
    for (const a of ASSETS) {
      const s = series.current[a];
      if (s.length < 3) continue;
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
          if (up !== null) brainFor(a, f.id).learn(r.x, up);
          if (r.you) {
            const win = up === null ? null : (r.you.dir === "UP") === up;
            settle((youStats.current[f.id] ??= blank()), win, r.you.stake);
            bal.current += win === null ? 0 : win ? r.you.stake * (1 - FEE) : -r.you.stake;
          }
          done.current.unshift({ id: `${key}|${r.start}`, asset: a, frame: f.id, end: r.end, open: r.open, close, up, p: r.p, calls: r.calls, you: r.you });
          if (done.current.length > 200) done.current.length = 200;
          rounds.current.delete(key);
          changed = true;
        }
        if (!rounds.current.has(key)) {
          const pr = predict(a, f.id, f.h, now);
          if (!pr) continue;
          const start = Math.floor(now / f.ms) * f.ms;
          rounds.current.set(key, { key, asset: a, frame: f.id, start, end: start + f.ms, open: price, ...pr });
          changed = true;
        }
      }
    }
    if (changed) save();
  }, [predict, save]);

  // history: a day of 1-minute candles to read, and to teach the Brain before the first round
  useEffect(() => {
    let dead = false;
    (async () => {
      for (const a of ASSETS) {
        try {
          const c = await fetchPerpCandles(a, "1m", 1600);
          if (dead) return;
          candles.current[a] = c;
          const pts = c.slice(-90).map((k) => ({ t: k.t + 60_000, p: k.c })).filter((k) => k.t < Date.now() - 2000);
          series.current[a] = [...pts, ...series.current[a].filter((x) => !pts.length || x.t > pts.at(-1)!.t)];
          // walk forward over the day: predict each minute, learn once its answer is known
          for (const f of FRAMES) {
            const b = brainFor(a, f.id);
            const X: number[][] = [];
            for (let i = 150; i < c.length - f.h; i++) {
              X[i] = [...ArenaBrain.features(c.slice(i - 150, i + 1), f.h), ...new Array(NL).fill(0)];
              const j = i - f.h;
              if (j >= 150) b.learn(X[j], c[j + f.h].c > c[j].c);
              if (i % 150 === 0) await new Promise((r) => setTimeout(r, 0));
              if (dead) return;
            }
          }
        } catch {}
        setTrained((n) => n + 1);
      }
    })();
    return () => { dead = true; };
  }, []);

  // order book, funding, premium and open interest, every 10 seconds
  useEffect(() => {
    let dead = false;
    const pull = async () => {
      if (document.hidden) return;
      try {
        const ctx = await fetchCtxs();
        for (const a of ASSETS) {
          const c = ctx.find((x) => x.name === a);
          if (!c) continue;
          let book = liveRef.current[a]?.book ?? 0;
          try { book = await fetchImbalance(a); } catch {}
          const old = liveRef.current[a];
          const keep = old && Date.now() - old.t > 45_000 ? old : undefined; // compare with about a minute ago
          liveRef.current[a] = { book, fund: c.funding, prem: c.premium, oi: c.oi, oiPrev: keep?.oi ?? old?.oiPrev ?? c.oi, px: c.px, pxPrev: keep?.px ?? old?.pxPrev ?? c.px, day: c.day, vol: c.vol, t: keep ? Date.now() : (old?.t ?? Date.now()) };
        }
      } catch {}
      if (dead) return;
    };
    pull();
    const t = setInterval(pull, 10_000);
    return () => { dead = true; clearInterval(t); };
  }, []);

  // live prices, and the newest candles every 15 seconds
  useEffect(() => {
    let dead = false;
    let busy = false;
    let cbusy = false;
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
    const fresh = async () => {
      if (cbusy || document.hidden) return;
      cbusy = true;
      for (const a of ASSETS) {
        try {
          const c = await fetchPerpCandles(a, "1m", 6);
          const cur = candles.current[a];
          if (!cur.length || !c.length) continue;
          const keep = cur.filter((k) => k.t < c[0].t);
          candles.current[a] = [...keep, ...c];
        } catch {}
      }
      cbusy = false;
    };
    pull();
    const t = setInterval(pull, 1500);
    const cf = setInterval(fresh, 15_000);
    const b = setInterval(() => setBeat((x) => x + 1), 250);
    const vis = () => { if (!document.hidden) { pull(); fresh(); } };
    document.addEventListener("visibilitychange", vis);
    return () => { dead = true; clearInterval(t); clearInterval(cf); clearInterval(b); document.removeEventListener("visibilitychange", vis); };
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
  const brainCall = round?.calls[BRAIN.id];
  const pUp = round ? round.p : 0.5;
  const strong = round ? Math.abs(round.p - 0.5) >= SIGNAL : false;

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
    return [...AG, BRAIN, BRAIN_SIG].map((a) => {
      const st = fs[a.id] ?? blank();
      const n = st.w + st.l;
      return { id: a.id, name: a.name, group: a.group, st, n, wr: n ? (st.w / n) * 100 : null };
    }).sort((x, y) => (y.wr ?? -1) - (x.wr ?? -1) || y.st.pnl - x.st.pnl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frame, now >> 11]);
  const brainRow = board.find((b) => b.id === "brain")!;
  const sigRow = board.find((b) => b.id === "brainSig")!;
  const me = youStats.current[frame] ?? blank();
  const meN = me.w + me.l;
  const recent = done.current.filter((d) => d.asset === asset && d.frame === frame).slice(0, 14);
  // who got the last rounds wrong: the error log
  const misses = useMemo(() => {
    const m: Record<string, { bad: number; n: number }> = {};
    done.current.filter((d) => d.frame === frame && d.up !== null).slice(0, 60).forEach((d) => {
      for (const ag of AG) { const c = d.calls[ag.id]; if (!c) continue; const e = (m[ag.id] ??= { bad: 0, n: 0 }); e.n++; if ((c.dir === "UP") !== d.up) e.bad++; }
    });
    return Object.entries(m).filter(([, v]) => v.n >= 8).map(([id, v]) => ({ id, rate: (v.bad / v.n) * 100, n: v.n })).sort((a, b) => b.rate - a.rate).slice(0, 4);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frame, now >> 13]);

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
  const groups = ["Price", "Indicators", "Volume", "Flow", "Structure", "Live"];

  return (
    <div className="ar-wrap">
      <div className="ar-head">
        <div>
          <h1>Arena</h1>
          <p className="dim">{N} AI agents watch BTC, ETH and SOL: price, indicators, volume and buyer pressure. A Brain learns which agents to trust and turns them into one call. Live prices, simulated money, every call recorded.</p>
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
          <div className="ar-sh"><b>The Brain</b><span className="dim">{asset} · {f.label}</span></div>
          <div className={`ar-brain ${strong ? "strong" : ""}`}>
            <div className="ar-pct num"><span className="up">{Math.round(pUp * 100)}% up</span><span className="down">{Math.round((1 - pUp) * 100)}% down</span></div>
            <div className="ar-meter"><i style={{ width: `${pUp * 100}%` }} /><b style={{ left: "50%" }} /></div>
            <div className="ar-verdict">
              {!round ? <span className="dim">{trained < 3 ? `Learning from the last day of prices… ${trained}/3` : "Waiting for the next round…"}</span>
                : strong ? <b className={brainCall?.dir === "UP" ? "up" : "down"}>{brainCall?.dir === "UP" ? "▲ Signal: UP" : "▼ Signal: DOWN"}</b>
                : <b className="dim">No clear edge: wait</b>}
            </div>
            <span className="ar-fine dim">The Brain only calls a signal when it is at least 60% sure. Most of the time the honest answer is &ldquo;no clear edge&rdquo;.</span>
          </div>
          <div className="ar-bt">
            <span className="ar-fine"><b>Live record ({f.label}):</b> Brain {brainRow.wr === null ? "no rounds yet" : `${brainRow.wr.toFixed(0)}% right over ${brainRow.n} rounds`}{sigRow.n > 0 ? ` · strong signals ${sigRow.wr!.toFixed(0)}% over ${sigRow.n}` : ""}.</span>
            <span className="ar-fine dim">Test on 3.5 days of real 1-minute prices: about 51 to 54% right overall on BTC, ETH and SOL. Short-term crypto direction is close to a coin flip, so treat any score here as a lesson, not a promise.</span>
          </div>
          {misses.length > 0 && (
            <div className="ar-miss">
              <b>Most wrong lately</b>
              {misses.map((m) => <span key={m.id} className="ar-fine"><span className="down">{m.rate.toFixed(0)}% wrong</span> · {NAME[m.id]} <span className="dim">({m.n} rounds)</span></span>)}
            </div>
          )}
        </section>
      </div>

      <section className="ar-card">
        <div className="ar-sh"><b>All {N} agents this round</b><span className="dim">{asset} · {f.label}</span></div>
        <div className="ar-agrid">
          {groups.map((g) => (
            <div key={g} className="ar-grp">
              <span className="ar-gname dim">{g}</span>
              {AG.filter((a) => a.group === g).map((a) => {
                const c = round?.calls[a.id];
                const right = round && c ? (c.dir === "UP") === upNow : null;
                return (
                  <div key={a.id} className="ar-ag">
                    <span className="ar-nm">{a.name}</span>
                    {c ? <b className={`${c.dir === "UP" ? "up" : "down"} num`}>{c.dir === "UP" ? "▲" : "▼"} {Math.round(50 + c.conf * 45)}%</b> : <span className="dim">…</span>}
                    <span className={`ar-state ${right === null ? "" : right ? "up" : "down"}`} aria-hidden="true">{right === null ? "" : right ? "●" : "○"}</span>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </section>

      <section className="ar-card">
        <div className="ar-sh"><b>Scoreboard · {f.label} rounds</b><span className="dim">$100 per call, after a {FEE * 100}% fee on wins</span></div>
        <div className="ar-tablewrap" style={{ maxHeight: showAll ? "none" : 330 }}>
          <table className="ar-table">
            <thead><tr><th>#</th><th>Agent</th><th>Right</th><th>Calls</th><th>Streak</th><th>P&amp;L</th></tr></thead>
            <tbody>
              {board.slice(0, showAll ? board.length : 8).map((r, i) => (
                <tr key={r.id} className={r.id.startsWith("brain") ? "ar-me" : ""}>
                  <td className="dim">{i + 1}</td>
                  <td><b>{r.name}</b></td>
                  <td className="num">{r.wr === null ? "—" : `${r.wr.toFixed(0)}%`}</td>
                  <td className="num dim">{r.n}</td>
                  <td className={`num ${r.st.streak > 0 ? "up" : r.st.streak < 0 ? "down" : "dim"}`}>{r.st.streak === 0 ? "—" : `${r.st.streak > 0 ? "W" : "L"}${Math.abs(r.st.streak)}`}</td>
                  <td className={`num ${tone(r.st.pnl)}`}>{signed(r.st.pnl)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <button type="button" className="e-btn" onClick={() => setShowAll(!showAll)}>{showAll ? "Show top 8" : `Show all ${board.length}`}</button>
        <span className="dim ar-fine">Scores build while this page is open and are saved in this browser. After fees, anything near 52% or lower loses money; that is the bar to beat.</span>
      </section>

      <section className="ar-card">
        <div className="ar-sh"><b>Recent rounds</b><span className="dim">{asset} · {f.label}</span></div>
        {recent.length ? (
          <div className="ar-hist">
            {recent.map((d) => (
              <span key={d.id} className={`ar-res ${d.up === null ? "" : d.up ? "up" : "down"}`} title={`${px(asset, d.open)} → ${px(asset, d.close)} · Brain said ${Math.round(d.p * 100)}% up`}>
                {d.up === null ? "flat" : d.up ? "▲" : "▼"} {(((d.close - d.open) / d.open) * 100).toFixed(2)}%
              </span>
            ))}
          </div>
        ) : <span className="dim">Finished rounds show up here.</span>}
        <div className="ar-foot">
          <span className="dim ar-fine">Simulation only. No real money moves on this page, and it is not financial advice. Prices come from Hyperliquid.</span>
          <button type="button" className="e-btn" onClick={reset}>Reset scores</button>
        </div>
      </section>
    </div>
  );
}

/** Two views: the live rounds game, and the market reports for the biggest coins. */
export function ArenaScreen() {
  const [tab, setTab] = useState<"rounds" | "market">("market");
  useEffect(() => { try { if (location.hash === "#rounds") setTab("rounds"); } catch {} }, []);
  const go = (t: "rounds" | "market") => { setTab(t); try { history.replaceState(null, "", t === "market" ? "#market" : "#rounds"); } catch {} };
  return (
    <main className="e-in e-page arena">
      <div className="ar-seg ar-tabs" role="tablist" aria-label="Arena view">
        <button type="button" role="tab" aria-selected={tab === "market"} className={tab === "market" ? "on" : ""} onClick={() => go("market")}>Signals</button>
        <button type="button" role="tab" aria-selected={tab === "rounds"} className={tab === "rounds" ? "on" : ""} onClick={() => go("rounds")}>Practice game</button>
      </div>
      {tab === "rounds" ? <ArenaRounds /> : <ArenaMarket />}
    </main>
  );
}
