"use client";
// Scout — the face of the Smart Money Radar. The signal meter + wallet list on a coin page, the small
// badge on Discover cards, the robot tab in the phone bottom bar, and the live "spotted smart money"
// toast. All of it reads the shared radar in lib/scout (no extra fetching, no paid data).
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useT } from "@/lib/i18n";
import { ago, money, short, type EToken } from "@/lib/ely";
import { signalLabel, trackTag, useCoinScout, useRadar, type ScoutCoin, type ScoutSignal } from "@/lib/scout";

/** The Scout robot image. `flash` lights the eyes (brightness + teal glow) when a strong signal is live. */
export function ScoutRobot({ size = 28, flash = false, still = false, className = "" }: { size?: number; flash?: boolean; still?: boolean; className?: string }) {
  return (
    <img
      src={still ? "/scout-still.jpg" : "/scout.gif"}
      alt="Scout"
      width={size}
      height={size}
      loading="lazy"
      className={`scout-robot ${flash ? "scout-flash" : ""} ${className}`}
      style={{ width: size, height: size }}
    />
  );
}

/** A small radar glyph for badges (cheap inline SVG, no image weight). */
function RadarGlyph({ size = 13 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 12 19 6" /><path d="M12 3a9 9 0 1 0 9 9" /><path d="M12 8a4 4 0 1 0 4 4" /><circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** Three-segment meter: none / building / strong. */
export function ScoutMeter({ signal }: { signal: ScoutSignal }) {
  const lit = signal === "strong" ? 3 : signal === "building" ? 2 : 1;
  return (
    <span className={`scout-meter s-${signal}`} aria-label={signalLabel(signal)}>
      {[0, 1, 2].map((i) => <i key={i} className={i < lit ? "on" : ""} />)}
    </span>
  );
}

/** Discover badge: shows only when a coin has a live smart-money signal. */
export function ScoutBadge({ address }: { address: string }) {
  const radar = useRadar();
  const sc = radar?.byAddr.get(address.toLowerCase());
  if (!sc || sc.signal === "none") return null;
  const count = sc.smartCount || sc.notableCount || sc.recentCount;
  return (
    <span className={`scout-badge s-${sc.signal}`} title={signalLabel(sc.signal)}>
      <RadarGlyph size={12} />
      {count > 0 && <b>{count}</b>}
    </span>
  );
}

function EventRow({ e }: { e: ScoutCoin["events"][number] }) {
  const tag = trackTag(e);
  return (
    <li className="scout-ev">
      <span className="scout-ev-w">
        <b className="num">{short(e.wallet)}</b>
        {e.smart && <span className="scout-tag smart">smart</span>}
        {!e.smart && e.notable && <span className="scout-tag whale">whale</span>}
      </span>
      <span className="scout-ev-m">
        {tag && <small className="dim">{tag}</small>}
        <span className="scout-ev-b">
          <span className="num up">+{money(e.usd)}</span>
          <small className="dim">{ago(e.lastTs)}</small>
        </span>
      </span>
    </li>
  );
}

/** The Scout panel on the coin page. */
export function ScoutPanel({ token }: { token: EToken }) {
  const tr = useT();
  const sc = useCoinScout(token);
  const signal = sc?.signal ?? "none";
  return (
    <section className="e-panel scout-panel">
      <div className="scout-head">
        <ScoutRobot size={34} still flash={signal === "strong"} />
        <div className="scout-head-t">
          <b>{tr("Smart Money Radar")}</b>
          <small className="dim">{tr("Scout watches who's buying")}</small>
        </div>
        <ScoutMeter signal={signal} />
      </div>

      <div className="scout-sum">
        <span className={`scout-sig s-${signal}`}>{tr(signalLabel(signal))}</span>
        <span className="dim">
          {tr("{s} smart in · {m} bought in the last 10 min", { s: sc?.smartCount ?? 0, m: sc?.recentCount ?? 0 })}
        </span>
      </div>

      {sc && sc.events.length > 0 ? (
        <ul className="scout-evs">{sc.events.map((e) => <EventRow key={e.wallet} e={e} />)}</ul>
      ) : (
        <div className="scout-empty dim">{tr("No smart-money moves on this coin yet.")}</div>
      )}

      <div className="scout-foot dim">{tr("Signal, not advice. Scout reads on-chain buys — always do your own research.")}</div>
    </section>
  );
}

/** The robot tab in the phone bottom bar. Image (not text); eyes flash when a strong signal is live. */
export function ScoutTab({ active }: { active: boolean }) {
  const tr = useT();
  const radar = useRadar();
  return (
    <Link href="/radar/" className={`e-tabnav scout-tab ${active ? "on" : ""}`} aria-label={tr("Scout Radar")}>
      <ScoutRobot size={26} flash={!!radar?.hasStrong} />
      {tr("Scout")}
    </Link>
  );
}

/** Live toast: slides up when a NEW strong signal appears. Throttled and deduped so it never spams. */
export function ScoutToast() {
  const tr = useT();
  const radar = useRadar();
  const [show, setShow] = useState<ScoutCoin | null>(null);
  const seen = useRef<Set<string>>(new Set());
  const lastAt = useRef(0);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!radar) return;
    const now = Date.now();
    if (now - lastAt.current < 60_000) return; // at most one toast a minute
    const fresh = radar.top.find((c) => c.signal === "strong" && !seen.current.has(c.address));
    if (!fresh) return;
    seen.current.add(fresh.address);
    lastAt.current = now;
    setShow(fresh);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setShow(null), 12_000);
  }, [radar]);

  useEffect(() => () => { if (hideTimer.current) clearTimeout(hideTimer.current); }, []);

  if (!show) return null;
  const t = show.token;
  return (
    <div className="scout-toast" role="status">
      <ScoutRobot size={34} flash />
      <Link href={`/t/?a=${t.address}`} className="scout-toast-b" onClick={() => setShow(null)}>
        <b>{tr("Scout spotted smart money")}</b>
        <span className="dim">
          {tr("${sym} · {s} smart, {m} in last 10m", { sym: t.symbol, s: show.smartCount, m: show.recentCount })}
        </span>
      </Link>
      <button type="button" className="scout-toast-x" aria-label={tr("Dismiss")} onClick={() => setShow(null)}>✕</button>
    </div>
  );
}
