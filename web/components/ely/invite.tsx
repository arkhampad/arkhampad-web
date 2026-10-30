"use client";
// Invite UI: the "Invite & earn" card on You, and a small one-time "confirm your invite" bar.
import { useEffect, useState } from "react";
import { useWallet } from "@/components/wallet";
import { useT } from "@/lib/i18n";
import { fetchHypeUsd, money, usePoll } from "@/lib/ely";
import { REF_RATE_PCT, captureRef, confirmRef, dismissRef, inviteLink, myRefStats, pendingRef } from "@/lib/referral";

export function InviteCard({ me }: { me: string }) {
  const tr = useT();
  const usd = usePoll(fetchHypeUsd, 60_000) ?? 0;
  const stats = usePoll(() => myRefStats(me), 60_000, [me]);
  const link = inviteLink(me);
  const [copied, setCopied] = useState(false);
  const text = `I'm launching and trading coins on Elysium with ArkhamPad. Sign in with email or Google, bring USDC or HYPE, and you're in 👇\n${link}`;
  return (
    <section className="e-panel e-invite">
      <div className="e-trade">
        <h3 className="e-ph" style={{ margin: 0 }}>{tr("Invite & earn")}</h3>
        <p className="e-note" style={{ margin: 0 }}>{tr("Share your link. You earn {p}% of every trade your friends make on ArkhamPad coins, paid in HYPE to your wallet every 30 minutes. Forever.", { p: REF_RATE_PCT })}</p>
        <div className="e-invlink">
          <code className="num">{link.replace("https://", "")}</code>
          <button type="button" className="e-btn pri" onClick={() => navigator.clipboard?.writeText(link).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); })}>{tr(copied ? "Copied" : "Copy link")}</button>
          <a className="e-btn" href={`https://x.com/intent/post?text=${encodeURIComponent(text)}`} target="_blank" rel="noopener noreferrer">{tr("Share on X")}</a>
        </div>
        <div className="e-prev-grid" style={{ padding: 0, border: 0 }}>
          <div><span>{tr("Friends invited")}</span><b>{stats ? stats.invited : "…"}</b></div>
          <div><span>{tr("You earned")}</span><b>{stats ? `${stats.earned.toFixed(4)} HYPE` : "…"}</b>{stats && usd ? <small className="dim">{money(stats.earned * usd)}</small> : null}</div>
          <div><span>{tr("Paid out")}</span><b>{stats ? `${stats.paid.toFixed(4)} HYPE` : "…"}</b></div>
        </div>
      </div>
    </section>
  );
}

/** Shown once after login when this browser arrived through someone's invite link. */
export function InviteConfirm() {
  const tr = useT();
  const w = useWallet();
  const [code, setCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { captureRef(); }, []);
  useEffect(() => { setCode(pendingRef(w.address)); }, [w.address]);
  if (!code || !w.signer || !w.address) return null;
  return (
    <div className="e-invbar" role="status">
      <span>{tr("You were invited to ArkhamPad. Confirm it (free, no gas) so your friend gets rewarded.")}</span>
      <button type="button" className="e-btn pri" disabled={busy} onClick={async () => {
        setBusy(true);
        try { await confirmRef(w.signer!, code); setCode(null); } catch { /* closed */ } finally { setBusy(false); }
      }}>{tr(busy ? "Confirming…" : "Confirm")}</button>
      <button type="button" className="e-btn" onClick={() => { dismissRef(w.address!); setCode(null); }} aria-label="Dismiss">✕</button>
    </div>
  );
}
