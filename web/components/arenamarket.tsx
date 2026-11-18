"use client";

/**
 * Market reports: the same 24-agent Brain, trained per coin on 15-minute and 1-hour candles of the biggest
 * markets by volume. For each coin it says LONG, SHORT or "no clear edge", names the agents behind the call,
 * and prints how often that same Brain was right on past candles it had not seen. Information only.
 */
import { useEffect, useRef, useState } from "react";
import { fetchPerpCandles } from "@/lib/hl";
import { ArenaBrain } from "@/lib/arenabrain";
import { fetchCtxs, type Ctx } from "@/lib/arenalive";

type Frame = "15m" | "1h";
type Candle = { t: number; o: number; h: number; l: number; c: number; v: number };
type Test = { n: number; ok: number; sn: number; sok: number };
type Row = { coin: string; frame: Frame; p: number; why: { name: string; up: boolean }[]; test: Test; at: number };
const FRAMES: { id: Frame; label: string; ms: number }[] = [{ id: "15m", label: "15 min", ms: 900_000 }, { id: "1h", label: "1 hour", ms: 3_600_000 }];
const STRONG = 0.1;
const TOP = 15;
const KEY = "arena.market.v1";
const AG = ArenaBrain.AGENTS as { id: string; name: string }[];
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

const pct = (v: number) => `${(v * 100).toFixed(0)}%`;
const fmtPx = (v: number) => (v >= 1000 ? v.toLocaleString("en-US", { maximumFractionDigits: 1 }) : v >= 1 ? v.toFixed(3) : Number(v.toPrecision(4)).toString());

export function ArenaMarket() {
  const [frame, setFrame] = useState<Frame>("15m");
  const [mode, setMode] = useState<"spot" | "lev">("spot");
  const [ctx, setCtx] = useState<Ctx[]>([]);
  const [rows, setRows] = useState<Record<string, Row>>({});
  const [prog, setProg] = useState("Loading the biggest markets…");
  const brains = useRef<Record<string, InstanceType<any>>>({});
  const candles = useRef<Record<string, Candle[]>>({});
  const coinsRef = useRef<string[]>([]);

  // saved last results so the page is not empty while it trains
  useEffect(() => {
    try { const raw = localStorage.getItem(KEY); if (raw) { const j = JSON.parse(raw); if (Date.now() - j.t < 3_600_000) setRows(j.rows ?? {}); } } catch {}
  }, []);

  useEffect(() => {
    let dead = false;
    const save = (r: Record<string, Row>) => { try { localStorage.setItem(KEY, JSON.stringify({ t: Date.now(), rows: r })); } catch {} };

    const report = (coin: string, f: Frame, c: Candle[], closedOnly: boolean): Row | null => {
      const b = brains.current[`${coin}|${f}`];
      if (!b) return null;
      const ms = FRAMES.find((x) => x.id === f)!.ms;
      const cl = closedOnly && c.length && c[c.length - 1].t + ms > Date.now() ? c.slice(0, -1) : c;
      if (cl.length < 160) return null;
      const x: number[] = ArenaBrain.features(cl.slice(-151), 1);
      const p: number = b.p(x);
      const why = x.map((v, i) => ({ name: AG[i].name, s: b.w[i] * v })).sort((a, z) => Math.abs(z.s) - Math.abs(a.s)).slice(0, 3).filter((w) => Math.abs(w.s) > 0.01).map((w) => ({ name: w.name, up: w.s > 0 }));
      return { coin, frame: f, p, why, test: b.test, at: Date.now() };
    };

    (async () => {
      let list: Ctx[] = [];
      try { list = (await fetchCtxs()).sort((a, b) => b.vol - a.vol).slice(0, TOP); } catch {}
      if (dead || !list.length) { setProg("Could not load markets, retrying shortly."); return; }
      setCtx(list);
      coinsRef.current = list.map((c) => c.name);
      const total = list.length * FRAMES.length;
      let done = 0;
      // train: walk forward over the history, learn each bar once its answer is known, keep the last 60% as a test
      for (const f of FRAMES) {
        for (const coin of coinsRef.current) {
          if (dead) return;
          setProg(`Training the Brain on ${coin} ${f.label} candles… ${done + 1}/${total}`);
          let c: Candle[] = [];
          for (let t = 0; t < 3 && !c.length; t++) { try { c = await fetchPerpCandles(coin, f.id, 1500); } catch {} if (!c.length) await wait(1200); }
          await wait(350);
          if (c.length < 400) { done++; continue; }
          candles.current[`${coin}|${f.id}`] = c;
          const b = new (ArenaBrain.Brain as any)(AG.length, 0.01, 0.002);
          const test: Test = { n: 0, ok: 0, sn: 0, sok: 0 };
          const warm = 150 + Math.floor((c.length - 150) * 0.4);
          const X: number[][] = [];
          for (let i = 150; i < c.length - 1; i++) {
            X[i] = ArenaBrain.features(c.slice(i - 150, i + 1), 1);
            const j = i - 1;
            if (j >= 150) b.learn(X[j], c[j + 1].c > c[j].c);
            if (i >= warm) {
              const p: number = b.p(X[i]);
              const up = c[i + 1].c > c[i].c;
              test.n++; if ((p > 0.5) === up) test.ok++;
              if (Math.abs(p - 0.5) >= STRONG) { test.sn++; if ((p > 0.5) === up) test.sok++; }
            }
            if (i % 120 === 0) await wait(0);
          }
          b.test = test;
          brains.current[`${coin}|${f.id}`] = b;
          const r = report(coin, f.id, c, false);
          if (r) setRows((old) => { const n = { ...old, [`${coin}|${f.id}`]: r }; save(n); return n; });
          done++;
        }
      }
      setProg("");
    })();

    // keep the calls fresh: new candles every 90 seconds
    const tick = setInterval(async () => {
      if (document.hidden) return;
      for (const f of FRAMES) for (const coin of coinsRef.current) {
        const key = `${coin}|${f.id}`;
        if (!brains.current[key] || dead) continue;
        try {
          const fresh = await fetchPerpCandles(coin, f.id, 8);
          const cur = candles.current[key] ?? [];
          if (!fresh.length || !cur.length) continue;
          candles.current[key] = [...cur.filter((k) => k.t < fresh[0].t), ...fresh];
          // teach the Brain from each newly closed candle: what it saw one candle ago, and what happened next
          const cc = candles.current[key];
          const closedC = cc.length && cc[cc.length - 1].t + f.ms > Date.now() ? cc.slice(0, -1) : cc;
          const bb = brains.current[key];
          if (closedC.length > 160 && bb.lastT !== closedC[closedC.length - 1].t) {
            const prev = closedC.slice(-152, -1);
            bb.learn(ArenaBrain.features(prev, 1), closedC[closedC.length - 1].c > closedC[closedC.length - 2].c);
            bb.lastT = closedC[closedC.length - 1].t;
          }
          const r = report(coin, f.id, candles.current[key], true);
          if (r) setRows((old) => ({ ...old, [key]: r }));
        } catch {}
        await wait(250);
      }
    }, 90_000);
    return () => { dead = true; clearInterval(tick); };
  }, []);

  const list = ctx.length ? ctx : Object.keys(rows).filter((k) => k.endsWith(`|${frame}`)).map((k) => ({ name: k.split("|")[0], px: 0, funding: 0, premium: 0, oi: 0, day: 0, vol: 0 }));
  const shown = list.map((c) => ({ c, r: rows[`${c.name}|${frame}`] })).sort((a, b) => Math.abs((b.r?.p ?? 0.5) - 0.5) - Math.abs((a.r?.p ?? 0.5) - 0.5));
  const f = FRAMES.find((x) => x.id === frame)!;

  return (
    <div className="ar-wrap">
      <div className="ar-head">
        <div>
          <h1>Market reports</h1>
          <p className="dim">The same {AG.length} agents, trained separately on each of the {TOP} biggest markets, now reading {f.label} candles. For every coin you get the Brain&apos;s call, the agents behind it, and how often it was right on past candles it had never seen.</p>
        </div>
      </div>
      <div className="ar-pick">
        <div className="ar-seg" role="tablist" aria-label="Period">
          {FRAMES.map((x) => <button key={x.id} type="button" className={x.id === frame ? "on" : ""} onClick={() => setFrame(x.id)}>{x.label}</button>)}
        </div>
        <div className="ar-seg" role="tablist" aria-label="Market type">
          <button type="button" className={mode === "spot" ? "on" : ""} onClick={() => setMode("spot")}>Spot</button>
          <button type="button" className={mode === "lev" ? "on" : ""} onClick={() => setMode("lev")}>Leverage</button>
        </div>
      </div>
      {prog && <div className="ar-card"><span className="dim">{prog}</span><div className="ar-bar"><i style={{ width: "40%" }} /></div></div>}
      <div className="ar-card">
        <div className="ar-sh"><b>{f.label} calls · strongest first</b><span className="dim">{mode === "spot" ? "Spot: buy or stay out" : "Leverage: long or short"}</span></div>
        <div className="am-list">
          {shown.map(({ c, r }) => {
            const strong = r ? Math.abs(r.p - 0.5) >= STRONG : false;
            const up = r ? r.p >= 0.5 : true;
            const label = !r ? "…" : !strong ? "No clear edge" : mode === "spot" ? (up ? "Lean BUY" : "Stay out") : (up ? "LONG" : "SHORT");
            const t = r?.test;
            return (
              <div key={c.name} className={`am-row ${strong ? (up ? "up" : "down") : ""}`}>
                <div className="am-coin"><b>{c.name}</b>{c.px > 0 && <span className="num dim">${fmtPx(c.px)} <span className={c.day >= 0 ? "up" : "down"}>{c.day >= 0 ? "+" : ""}{(c.day * 100).toFixed(1)}%</span></span>}</div>
                <div className="am-call"><b className={strong ? (up ? "up" : "down") : "dim"}>{label}</b>{r && <span className="num dim">{pct(r.p)} up · {pct(1 - r.p)} down</span>}</div>
                <div className="am-why">{r?.why.length ? r.why.map((w) => <span key={w.name} className={`am-chip ${w.up ? "up" : "down"}`}>{w.up ? "▲" : "▼"} {w.name}</span>) : <span className="dim">—</span>}</div>
                <div className="am-test num">{t && t.n ? <><span>{pct(t.ok / t.n)} right</span><span className="dim">{t.sn ? `${pct(t.sok / t.sn)} when sure (${t.sn})` : "no strong calls"} · {t.n} tests</span></> : <span className="dim">testing…</span>}</div>
              </div>
            );
          })}
        </div>
      </div>
      <div className="ar-card">
        <b>How to read this</b>
        <span className="ar-fine dim">Each Brain was trained on the earlier part of the coin&apos;s history and then judged on the later part it had not seen; that is the &ldquo;right&rdquo; column. Across the biggest markets this lands close to a coin flip, roughly 51 to 54%, and a bit higher when the Brain is sure, on fewer calls. A call is information, not advice. {mode === "lev" ? "Leverage multiplies both gains and losses, and fees plus funding cost more than a small edge is worth, so a thin edge can still lose money." : "Spot has no liquidation, but a thin edge is still small after fees."}</span>
        <span className="ar-fine dim">The Brain keeps learning: every new candle teaches it, and the agents it keeps getting wrong are the ones it trusts less. Prices and candles are Hyperliquid&apos;s public data. Simulation and information only.</span>
      </div>
    </div>
  );
}
