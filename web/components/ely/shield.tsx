"use client";
// Shield — the anti-rug safety panel and dev-reputation card on the coin page, plus the tiny dev flag
// on Discover cards. All verdicts come from lib/shield (data-only, no AI, no paid sources).
import Link from "next/link";
import { useT } from "@/lib/i18n";
import { short, tokenColors, type EToken } from "@/lib/ely";
import { devRecordLine, type DevRecord, type DevRep, type Shield, type ShieldCheck } from "@/lib/shield";

const DOT: Record<ShieldCheck["ok"], string> = { ok: "ok", warn: "warn", bad: "bad", unknown: "unk" };
const verdictKey = (l: Shield["level"]) => (l === "green" ? "Looks clean" : l === "amber" ? "Some risks" : "High risk");

function RepBadge({ rep }: { rep: DevRep }) {
  const tr = useT();
  if (rep === "trusted") return <span className="dev-badge trusted">{tr("Trusted")}</span>;
  if (rep === "risky") return <span className="dev-badge risky">⚠ {tr("Risky")}</span>;
  if (rep === "new") return <span className="dev-badge new">{tr("New dev")}</span>;
  return <span className="dev-badge normal">{tr("Active dev")}</span>;
}

/** Small ✓ / ⚠ next to a coin on Discover. Nothing for an ordinary or new dev (keeps cards uncluttered). */
export function DevFlag({ rep }: { rep: DevRep | undefined }) {
  const tr = useT();
  if (rep === "risky") return <span className="dev-flag risky" title={tr("This dev has coins that went to zero")}>⚠</span>;
  if (rep === "trusted") return <span className="dev-flag trusted" title={tr("Trusted dev: a track record of coins that lasted")}>✓</span>;
  return null;
}

function DevCard({ token, dev }: { token: EToken; dev: DevRecord | null }) {
  const tr = useT();
  const addr = token.creator;
  if (!addr) return null;
  const [c1, c2] = tokenColors(addr);
  return (
    <Link href={`/dev/?a=${addr}`} className="dev-card">
      <span className="dev-av" style={{ background: `linear-gradient(135deg, ${c1}, ${c2})` }}>{addr.slice(2, 4).toUpperCase()}</span>
      <span className="dev-main">
        <span className="dev-top"><b className="num">{short(addr)}</b>{dev && <RepBadge rep={dev.rep} />}</span>
        <small className="dim">{dev ? devRecordLine(dev) : tr("Loading dev history…")}</small>
      </span>
      <span className="dev-go" aria-hidden="true">›</span>
    </Link>
  );
}

/** The safety verdict + dev card, shown right beside the Buy action on the coin page. */
export function ShieldPanel({ token, shield, dev }: { token: EToken; shield: Shield | null; dev: DevRecord | null }) {
  const tr = useT();
  const level = shield?.level ?? "amber";
  return (
    <section className="e-panel shield-panel">
      <div className={`shield-head s-${level}`}>
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3l7 3v5c0 4.3-2.9 7.6-7 9-4.1-1.4-7-4.7-7-9V6l7-3Z" /><path d="m9 12 2 2 4-4" /></svg>
        <b>{tr("Shield")}</b>
        <span className={`shield-verdict s-${level}`}>{tr(verdictKey(level))}</span>
      </div>

      {shield && shield.flags.length > 0 && (
        <div className="shield-flags">{shield.flags.slice(0, 4).map((f) => <span key={f} className="shield-flag">{tr(f)}</span>)}</div>
      )}

      <ul className="shield-checks">
        {(shield?.checks ?? []).map((c) => (
          <li key={c.label}>
            <i className={`shield-dot ${DOT[c.ok]}`} aria-hidden="true" />
            <span>{tr(c.label)}</span>
            <b className="num">{c.value && tr(c.value)}</b>
          </li>
        ))}
        {!shield && <li className="dim" style={{ padding: "4px 0" }}>{tr("Checking…")}</li>}
      </ul>

      <DevCard token={token} dev={dev} />
      <div className="shield-foot dim">{tr("On-chain history, not advice. Do your own research before buying.")}</div>
    </section>
  );
}
