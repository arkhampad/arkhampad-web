"use client";
// The ArkhamPad airdrop: a promise, no dates or amounts. "Launch a coin, trade, earn the airdrop; the more you
// launch and trade, the bigger it is." The banner sits on Discover; the card on You shows what counts so far,
// in plain words (coins launched, trades, volume), never as "points".
import Link from "next/link";
import { useState } from "react";
import { useT } from "@/lib/i18n";
import { fetchCreated, fetchMyTrades, usePoll } from "@/lib/ely";
import { fetchEarly, inviteLink } from "@/lib/referral";
import { earlyCard } from "@/lib/sharecard";

const XIcon = () => <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M17.8 3h3.1l-6.8 7.7L22 21h-6.2l-4.9-6.3L5.3 21H2.2l7.3-8.3L2 3h6.4l4.4 5.8L17.8 3Zm-1.1 16.2h1.7L7.4 4.7H5.6l11.1 14.5Z" /></svg>;

export function AirdropBanner({ signedIn }: { signedIn: boolean }) {
  const tr = useT();
  return (
    <Link href={signedIn ? "/you/#airdrop" : "/create/"} className="e-airdrop">
      <span className="e-airdrop-ico" aria-hidden="true">🪂</span>
      <span>
        <b>{tr("The ArkhamPad airdrop")}</b>
        <small>{tr("Launch a coin. Trade. The more you launch and trade, the bigger your airdrop.")}</small>
      </span>
      <span className="e-airdrop-go" aria-hidden="true">→</span>
    </Link>
  );
}

export function AirdropCard({ me }: { me: string }) {
  const tr = useT();
  const created = usePoll(() => fetchCreated(me), 60_000, [me]);
  const trades = usePoll(() => fetchMyTrades(me, 2000), 60_000, [me]);
  const n = (v: number) => v.toLocaleString("en-US", { maximumFractionDigits: v < 10 ? 2 : 0 });
  const vol = (trades ?? []).reduce((s, t) => s + (t.hype || 0), 0);
  const early = usePoll(() => fetchEarly(me).catch(() => null), 120_000, [me]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  async function share() {
    if (!early?.rank) return;
    setBusy(true);
    setNote("");
    const text = `I'm #${early.rank} on ArkhamPad, Elysium's launchpad 🪂\n\nearly, before everyone else shows up.\n\n${inviteLink(me)}\n\n#Elysium #HYPE #ArkhamPad`;
    try {
      const blob = await earlyCard({ rank: early.rank, total: early.total, launched: created?.length ?? 0, trades: trades?.length ?? 0, volume: vol, since: early.since });
      const file = blob ? new File([blob], `arkhampad-early-${early.rank}.png`, { type: "image/png" }) : null;
      const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
      if (/iPhone|iPad|Android/i.test(navigator.userAgent) && file && nav.canShare?.({ files: [file], text })) {
        await navigator.share({ files: [file], text });
        return;
      }
      if (blob) {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `arkhampad-early-${early.rank}.png`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 4000);
        setNote(tr("Card downloaded: add it to your post."));
      }
      window.open(`https://x.com/intent/post?text=${encodeURIComponent(text)}`, "_blank", "noopener,noreferrer");
    } catch {
      /* closed the share sheet */
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="e-panel e-airdrop-card" id="airdrop">
      <h3 className="e-ph">🪂 {tr("Your airdrop")}</h3>
      <div className="e-early">
        {early?.rank ? (
          <>
            <div className="e-early-rank"><small>{tr("Early ArkhamPad user")}</small><b className="num">#{early.rank.toLocaleString("en-US")}</b><span>{tr("of {n} people so far", { n: early.total.toLocaleString("en-US") })}</span></div>
            <button type="button" className="e-btn pri e-early-share" onClick={share} disabled={busy}><XIcon />{tr(busy ? "Making your card…" : "Share your rank")}</button>
          </>
        ) : (
          <div className="e-early-rank"><small>{tr("Early ArkhamPad user")}</small><span>{early ? tr("Make your first trade or launch a coin to get your early rank.") : "…"}</span></div>
        )}
        {note && <span className="dim" style={{ fontSize: 13 }}>{note}</span>}
      </div>
      <div className="e-airdrop-row">
        <div><b className="num">{created ? n(created.length) : "—"}</b><span>{tr("coins launched")}</span></div>
        <div><b className="num">{trades ? n(trades.length) : "—"}</b><span>{tr("trades")}</span></div>
        <div><b className="num">{trades ? n(vol) : "—"}</b><span>{tr("HYPE traded")}</span></div>
      </div>
      <p className="e-note" style={{ padding: "0 16px 14px" }}>{tr("Everything you launch and trade on ArkhamPad counts toward the ArkhamPad airdrop, and so does a Genesis badge. The more you do, the bigger your share.")}</p>
    </section>
  );
}
