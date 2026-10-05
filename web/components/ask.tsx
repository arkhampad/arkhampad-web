"use client";
// Ask box for Learn and Help: instant matches while you type, and an AI answer
// (from ArkhamPad's own guides only) when you press Ask AI.
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { search, type Hit } from "@/lib/search";
import { ISpark } from "./icons";

type Answer = { answer: string | null; sources: { title: string; url: string }[]; ai: boolean };

export function AskBox({ placeholder = "Ask anything, e.g. how do I withdraw to my exchange?", id = "ask" }: { placeholder?: string; id?: string }) {
  const [q, setQ] = useState("");
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<Answer | null>(null);
  const [err, setErr] = useState("");
  const asked = useRef("");

  // instant results follow the text with a short pause, so typing stays smooth
  useEffect(() => { const t = setTimeout(() => setTyped(q), 120); return () => clearTimeout(t); }, [q]);
  const hits: Hit[] = useMemo(() => (typed.trim().length >= 3 ? search(typed, 5) : []), [typed]);

  const ask = async () => {
    const text = q.trim();
    if (text.length < 3 || busy) return;
    asked.current = text; setBusy(true); setErr(""); setRes(null);
    try {
      const r = await fetch("/api/ask", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ q: text }) });
      if (!r.ok) throw new Error();
      setRes((await r.json()) as Answer);
    } catch {
      setErr("AI couldn't answer right now. The guides below match your question.");
    } finally { setBusy(false); }
  };

  const showHits = !busy && !res?.answer && hits.length > 0;
  return (
    <div style={{ width: "100%", maxWidth: 720, display: "flex", flexDirection: "column", gap: 10, textAlign: "left" }}>
      <form onSubmit={(e) => { e.preventDefault(); ask(); }} className="ask-field">
        <ISpark size={18} color="var(--volt-ink)" />
        <label htmlFor={id} className="sr">Ask a question</label>
        <input id={id} value={q} onChange={(e) => { setQ(e.target.value); if (res) setRes(null); setErr(""); }} placeholder={placeholder} autoComplete="off" enterKeyHint="send" maxLength={300} />
        <button type="submit" className="btn volt" disabled={busy || q.trim().length < 3}>{busy ? "Thinking…" : "Ask AI"}</button>
      </form>
      <div aria-live="polite" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {busy && <div className="skel" style={{ height: 74, borderRadius: 16 }} />}
        {res?.answer && (
          <div className="ai-note" style={{ flexDirection: "column", gap: 10 }}>
            <span style={{ display: "flex", gap: 10, alignItems: "flex-start" }}><ISpark size={16} color="var(--volt-ink)" style={{ flex: "none", marginTop: 2 }} /><span style={{ fontSize: 15, lineHeight: 1.6 }}>{res.answer}</span></span>
            {res.sources.length > 0 && (
              <span style={{ display: "flex", flexWrap: "wrap", gap: 6, paddingLeft: 26 }}>
                {res.sources.map((s) => <Link key={s.url + s.title} href={s.url} className="pill" style={{ background: "var(--raise)", color: "var(--text2)", fontWeight: 600 }}>{s.title}</Link>)}
              </span>
            )}
            <span style={{ paddingLeft: 26, fontSize: 12, color: "var(--faint)" }}>AI answer from ArkhamPad guides. Not financial advice.</span>
          </div>
        )}
        {(err || (res && !res.answer)) && <span className="dim" style={{ fontSize: 13 }}>{err || "We couldn't write an answer, but these guides should help."}</span>}
        {showHits && (
          <div className="card" style={{ padding: 6, gap: 0, borderRadius: 16 }}>
            {hits.map((h) => (
              <Link key={h.url + h.title} href={h.url} className="ask-hit">
                <span className="pill" style={{ background: h.kind === "help" ? "rgba(92,255,176,0.12)" : "rgba(212,255,58,0.12)", color: h.kind === "help" ? "var(--up)" : "var(--volt-ink)", fontWeight: 700, flex: "none" }}>{h.kind === "help" ? "Help" : "Guide"}</span>
                <span style={{ fontWeight: 600, fontSize: 14, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{h.title}</span>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
