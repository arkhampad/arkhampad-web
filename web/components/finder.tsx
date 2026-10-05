"use client";
// Ask AI on Discover: type what you want, see the filters AI understood, remove any of them.
import { useEffect, useRef, useState } from "react";
import { findCoins, type LiveCoin } from "@/lib/live";
import { finderChips, ruleFinder, type Finder } from "@/lib/finder";
import { CoinRows, CoinTable } from "./market";
import { ISpark, IX } from "./icons";

const SUGGEST = ["Coins about to graduate", "New Base coins under 1 hour", "Top gainers with locked creators", "Most traded AI coins today"];

export function useFinder() {
  const [filters, setFilters] = useState<Finder | null>(null);
  const [asked, setAsked] = useState("");
  const [thinking, setThinking] = useState(false);
  const [list, setList] = useState<LiveCoin[] | null>(null);
  const [err, setErr] = useState(false);
  const seq = useRef(0);

  const run = async (f: Finder) => {
    const id = ++seq.current;
    setList(null); setErr(false);
    try { const rows = await findCoins(f); if (id === seq.current) setList(rows); }
    catch { if (id === seq.current) { setList([]); setErr(true); } }
  };
  const ask = async (q: string) => {
    const text = q.trim();
    if (text.length < 2) return;
    setAsked(text); setThinking(true); setFilters(null); setList(null);
    let f: Finder;
    try {
      const r = await fetch("/api/discover", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ q: text }) });
      f = r.ok ? ((await r.json()).filters as Finder) : ruleFinder(text);
    } catch { f = ruleFinder(text); }
    setThinking(false); setFilters(f); run(f);
  };
  const remove = (k: keyof Finder) => {
    if (!filters) return;
    const f = { ...filters }; delete f[k];
    if (k === "source" && (f.nearGrad || f.graduated || f.locked)) { delete f.nearGrad; delete f.graduated; delete f.locked; }
    setFilters(f); run(f);
  };
  const clear = () => { seq.current++; setFilters(null); setList(null); setAsked(""); setThinking(false); };
  // keep results fresh while open
  useEffect(() => { if (!filters) return; const t = setInterval(() => run(filters), 30_000); return () => clearInterval(t); }, [filters]); // eslint-disable-line react-hooks/exhaustive-deps
  return { filters, asked, thinking, list, err, ask, remove, clear, active: thinking || !!filters };
}

export function FinderBar({ fx }: { fx: ReturnType<typeof useFinder> }) {
  const [q, setQ] = useState("");
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <form className="ask-field" onSubmit={(e) => { e.preventDefault(); fx.ask(q); }} role="search">
        <ISpark size={18} color="var(--volt-ink)" />
        <label htmlFor="find-q" className="sr">Ask AI to find coins</label>
        <input id="find-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask AI: new Base coins about to graduate…" autoComplete="off" enterKeyHint="search" maxLength={200} />
        {fx.active && <button type="button" className="icon-btn" aria-label="Clear AI search" onClick={() => { setQ(""); fx.clear(); }} style={{ width: 40, height: 40, border: 0, background: "transparent" }}><IX size={15} /></button>}
        <button type="submit" className="btn volt" disabled={fx.thinking || q.trim().length < 2}>{fx.thinking ? "Thinking…" : "Ask AI"}</button>
      </form>
      {!fx.active && (
        <div className="hscroll" style={{ gap: 6 }}>
          {SUGGEST.map((s) => <button key={s} type="button" className="chip sm" onClick={() => { setQ(s); fx.ask(s); }}>{s}</button>)}
        </div>
      )}
    </div>
  );
}

export function FinderResults({ fx }: { fx: ReturnType<typeof useFinder> }) {
  const chips = fx.filters ? finderChips(fx.filters) : [];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }} aria-live="polite">
      {fx.thinking && <div className="skel" style={{ height: 48, borderRadius: 14 }} />}
      {fx.filters && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <span className="dim" style={{ fontSize: 12 }}>Showing coins that match <b style={{ color: "var(--text2)" }}>“{fx.asked}”</b>:</span>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
            {chips.length === 0 && <span className="dim" style={{ fontSize: 13 }}>All coins</span>}
            {chips.map((c) => (
              <span key={c.key} className="fchip">{c.label}<button type="button" aria-label={`Remove ${c.label}`} onClick={() => fx.remove(c.key)}><IX size={10} w={2.6} /></button></span>
            ))}
            <button type="button" className="linkbtn" style={{ marginTop: 0, marginLeft: 4 }} onClick={fx.clear}>Back to all coins</button>
          </div>
        </div>
      )}
      {fx.filters && (fx.list === null ? <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>{[0, 1, 2, 3, 4].map((i) => <div key={i} className="skel" style={{ height: 52, borderRadius: 12 }} />)}</div> : fx.list.length === 0 ? (
        <div className="card" style={{ alignItems: "center", textAlign: "center", padding: 28 }}>
          <span style={{ fontWeight: 700 }}>{fx.err ? "Couldn't search right now" : "No coins match right now"}</span>
          <span className="dim" style={{ fontSize: 13 }}>{fx.err ? "Please try again in a moment." : "Remove a filter above to see more."}</span>
        </div>
      ) : (
        <>
          <div className="hide-m"><CoinTable list={fx.list} /></div>
          <div className="show-m" style={{ margin: "0 -16px" }}><CoinRows list={fx.list} /></div>
        </>
      ))}
    </div>
  );
}
