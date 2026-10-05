"use client";
// AI safety check, creator lock countdown and the pre-buy warning (coins launched on ArkhamPad).
import { useEffect, useState } from "react";
import type { LiveCoin } from "@/lib/live";
import { aiLine, useSafety, type Safety } from "@/lib/safety";
import { IAlert, ICheck, ILock, IShield, ISpark } from "./icons";

const LV = [
  { label: "Low risk", col: "var(--up)", bg: "rgba(61,220,151,0.14)" },
  { label: "Medium risk", col: "var(--warn)", bg: "rgba(255,180,60,0.14)" },
  { label: "High risk", col: "var(--down)", bg: "rgba(255,107,107,0.14)" },
];

export function SafetyCard({ c }: { c: LiveCoin }) {
  const s = useSafety(c);
  const [line, setLine] = useState<string | null>(null);
  useEffect(() => { setLine(null); if (!s) return; let alive = true; aiLine(c.id, s).then((t) => { if (alive) setLine(t); }); return () => { alive = false; }; }, [c.id, s]);
  if (!s) return <div className="skel" style={{ height: 230, borderRadius: 20 }} aria-label="Loading safety check" />;
  const lv = LV[s.level];
  return (
    <section className="card safety" aria-label="AI safety check">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <span style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 700 }}><IShield size={18} color={lv.col} />AI safety check</span>
        <span className="pill mono" style={{ background: lv.bg, color: lv.col, fontWeight: 700 }}>{lv.label}</span>
      </div>
      <div className="risk-bar" aria-hidden="true">{[0, 1, 2].map((i) => <span key={i} style={{ background: i <= s.level ? lv.col : "var(--raise2)" }} />)}</div>
      <div className="ai-note"><ISpark size={16} color="var(--volt-ink)" style={{ flex: "none", marginTop: 2 }} /><span>{line ?? s.summary}</span></div>
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        {s.checks.map((k) => (
          <div key={k.label} className="chk">
            <i className={k.ok}>{k.ok === "ok" ? <ICheck size={13} w={2.6} /> : <IAlert size={13} w={2.4} />}</i>
            <span>{k.label}</span><b>{k.value}</b>
          </div>
        ))}
      </div>
      <span style={{ fontSize: 11, color: "var(--faint)" }}>From on-chain data, updated every minute. Information only, not financial advice.</span>
    </section>
  );
}

function useCountdown(until: number | null) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { if (!until || until <= Date.now()) return; const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, [until]);
  return until ? Math.max(0, Math.floor((until - now) / 1000)) : 0;
}

export function LockCard({ c }: { c: LiveCoin }) {
  const s = useSafety(c);
  const unlockAt = s?.unlockAt ?? (c.lockSeconds && c.createdAt ? Date.parse(c.createdAt) + c.lockSeconds * 1000 : null);
  const left = useCountdown(unlockAt);
  if (!c.own) return null;
  const locked = left > 0;
  const h = Math.floor(left / 3600), m = Math.floor((left % 3600) / 60), x = left % 60;
  const two = (n: number) => String(n).padStart(2, "0");
  return (
    <div className={`lockcard${locked ? " on" : ""}`}>
      <span className="ic"><ILock size={18} color={locked ? "#0A0B10" : "var(--muted)"} w={2.4} /></span>
      <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
        <b style={{ fontSize: 14 }}>{locked ? "Creator coins locked" : c.lockSeconds ? "Creator lock ended" : "No creator lock"}</b>
        <span className="muted" style={{ fontSize: 12 }}>{locked ? "The creator can't sell until the timer ends" : c.lockSeconds ? "The creator can sell their coins now" : "The creator can sell at any time"}</span>
      </span>
      {locked && (
        <span className="cd mono" role="timer" aria-label={`Unlocks in ${h} hours ${m} minutes`}>
          <span><b>{two(h)}</b><small>h</small></span><span><b>{two(m)}</b><small>m</small></span><span><b>{two(x)}</b><small>s</small></span>
        </span>
      )}
    </div>
  );
}

const seen = new Set<string>();
const seenKey = (id: string) => `ap_warn_${id}`;
function wasSeen(id: string) { if (seen.has(id)) return true; try { return sessionStorage.getItem(seenKey(id)) === "1"; } catch { return false; } }

/** Shown once per coin per visit, above the Buy button. Informs, never blocks. */
export function useBuyWarning(c: LiveCoin): { text: string | null; ack: () => void; safety: Safety | null } {
  const s = useSafety(c);
  const [, force] = useState(0);
  const text = s?.warn && !wasSeen(c.id) ? s.warn : null;
  const ack = () => { seen.add(c.id); try { sessionStorage.setItem(seenKey(c.id), "1"); } catch { /* storage off */ } force((n) => n + 1); };
  return { text, ack, safety: s };
}

export function BuyWarning({ text, onAck }: { text: string; onAck: () => void }) {
  return (
    <div className="warnbox" role="alert">
      <IAlert size={18} color="var(--warn)" w={2.4} style={{ flex: "none", marginTop: 1 }} />
      <span style={{ flex: 1 }}><b>Heads up.</b> {text}<br /><button type="button" className="linkbtn" onClick={onAck}>Got it, show buy</button></span>
    </div>
  );
}
