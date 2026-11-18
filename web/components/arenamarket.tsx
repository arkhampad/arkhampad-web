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

  const [open, setOpen] = useState<string>("");
  const [srv, setSrv] = useState<{ n: number; ok: number; l: number; lok: number } | null>(null);
  useEffect(() => {
    let dead = false;
    const K = process.env.NEXT_PUBLIC_SUPABASE_KEY || "sb_publishable_S49UWqqXDzSaRbjBsAfYaA_kjfxyRPB";
    const load = async () => {
      try {
        const r = await fetch("https://yvdudswzmdziwnfurwir.supabase.co/rest/v1/rpc/arena_report", { method: "POST", headers: { apikey: K, authorization: `Bearer ${K}`, "content-type": "application/json" }, body: "{}" });
        const j = await r.json();
        if (!dead && j?.all?.n) setSrv({ n: j.all.n, ok: j.all.ok, l: j.last100?.n ?? 0, lok: j.last100?.ok ?? 0 });
      } catch { /* keep the page working without it */ }
    };
    load();
    const t = setInterval(load, 120_000);
    return () => { dead = true; clearInterval(t); };
  }, []);
  const list = ctx.length ? ctx : Object.keys(rows).filter((k) => k.endsWith(`|${frame}`)).map((k) => ({ name: k.split("|")[0], px: 0, funding: 0, premium: 0, oi: 0, day: 0, vol: 0 }));
  const shown = list.map((c) => ({ c, r: rows[`${c.name}|${frame}`] })).sort((a, b) => Math.abs((b.r?.p ?? 0.5) - 0.5) - Math.abs((a.r?.p ?? 0.5) - 0.5));
  const f = FRAMES.find((x) => x.id === frame)!;
  const word = frame === "15m" ? "15 minutes" : "hour";

  return (
    <div className="ar-wrap">
      <div className="ar-head">
        <div>
          <h1>Will it go up in the next {word}?</h1>
          <p className="dim">{AG.length} agents watch each coin in the background: price, indicators, volume and who is buying or selling. Their Brain turns that into one call per coin. Strongest calls are on top.</p>
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
      {srv && frame === "15m" && (
        <div className="ar-card am-srv">
          <b>Live track record: {pct(srv.ok / srv.n)} right</b>
          <span className="dim"> on {srv.n} real 15-minute calls made and checked by our server, not backtested{srv.l >= 50 ? ` · last ${srv.l}: ${pct(srv.lok / srv.l)}` : ""}. It keeps learning from every miss.</span>
        </div>
      )}
      {prog && <div className="ar-card"><span className="dim">{prog}</span><div className="ar-bar"><i style={{ width: "40%" }} /></div></div>}
      <div className="am-list">
        {shown.map(({ c, r }) => {
          const strong = r ? Math.abs(r.p - 0.5) >= STRONG : false;
          const up = r ? r.p >= 0.5 : true;
          const chance = r ? Math.round((up ? r.p : 1 - r.p) * 100) : 0;
          const head = !r ? "Reading…" : !strong ? "Unclear" : up ? "Likely UP" : "Likely DOWN";
          const sub = !r ? "" : !strong ? "No clear direction. Better to wait." : up ? (mode === "spot" ? "Good time to look at buying" : "Long side looks better") : (mode === "spot" ? "Not a good time to buy" : "Short side looks better");
          const t = r?.test;
          const key = `${c.name}|${frame}`;
          return (
            <button type="button" key={c.name} className={`am-card ${strong ? (up ? "up" : "down") : ""}`} onClick={() => setOpen(open === key ? "" : key)}>
              <div className="am-top">
                <div className="am-coin"><b>{c.name}</b>{c.px > 0 && <span className="num dim">${fmtPx(c.px)}</span>}</div>
                <div className="am-verdict"><b className={strong ? (up ? "up" : "down") : "dim"}>{head}</b>{strong && <span className="num">{chance}% chance</span>}</div>
              </div>
              <div className="am-sub dim">{sub}</div>
              {t && t.n > 0 && <div className="am-track dim">Track record: {pct(t.ok / t.n)} right on {t.n} past candles{t.sn ? ` · ${pct(t.sok / t.sn)} when it was this sure` : ""}</div>}
              {open === key && r && (
                <div className="am-more">
                  <span className="dim">What the agents are saying</span>
                  <div className="am-why">{r.why.length ? r.why.map((w) => <span key={w.name} className={`am-chip ${w.up ? "up" : "down"}`}>{w.up ? "▲" : "▼"} {w.name}</span>) : <span className="dim">Nothing stands out.</span>}</div>
                </div>
              )}
            </button>
          );
        })}
      </div>
      <p className="ar-fine dim">Honest note: nobody predicts the market perfectly. These calls are right a little more than half the time on average, and the track record above is measured on past candles the Brain had not seen. Information only, not advice.{mode === "lev" ? " Leverage multiplies both gains and losses." : ""}</p>
    </div>
  );
}
