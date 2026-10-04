"use client";
import { useState } from "react";
import { ICopy, IX } from "@/components/icons";
import { useApp } from "@/components/shell";
import { useWallet } from "@/components/wallet";
import { NETS, TradeError, accountAction } from "@/lib/chain";
import { usd, useLive } from "@/lib/live";
import { friendsCount, refEarnings } from "@/lib/insights";
import { openX } from "@/lib/share";

export default function Invite() {
  const w = useWallet();
  const { toast } = useApp();
  const me = w.address?.toLowerCase() ?? "";
  const rows = useLive(() => (me ? refEarnings(me) : Promise.resolve([])), [me], 30_000);
  const friends = useLive(() => (me ? friendsCount(me) : Promise.resolve(0)), [me], 60_000);
  const [busy, setBusy] = useState(0);
  const link = me ? `https://arkhampad.com/?ref=${me}` : "";
  const earned = (rows.data ?? []).reduce((a, r) => a + r.earned, 0);
  const paid = (rows.data ?? []).reduce((a, r) => a + r.paid, 0);
  const claim = async (chainId: number) => {
    if (!w.signer) return;
    setBusy(chainId);
    try { const j = await accountAction("ref.claim", { chainId }, w.signer); toast(`Paid ${usd(j.paid, 2)} to your balance`); await w.refresh(); rows.reload?.(); }
    catch (e) { toast(e instanceof TradeError ? e.message : "Couldn't claim right now."); } finally { setBusy(0); }
  };
  if (!w.signedIn) return (
    <div className="wrap page" style={{ alignItems: "center", textAlign: "center", gap: 14, paddingTop: 60, maxWidth: 640 }}>
      <h1 className="h-title" style={{ fontSize: 32 }}>Invite friends, earn on every trade</h1>
      <p className="h-sub">Get 25% of ArkhamPad&apos;s fees on everything your friends trade, for 12 months.</p>
      <button type="button" className="btn volt lg" onClick={w.login}>Log in to get your link</button>
    </div>
  );
  return (
    <div className="wrap page" style={{ maxWidth: 820 }}>
      <h1 className="h-title" style={{ fontSize: 32 }}>Invite & earn</h1>
      <div className="card" style={{ gap: 12, background: "var(--volt)", color: "var(--on-volt)", border: 0 }}>
        <b style={{ fontSize: 18 }}>Your link</b>
        <span className="mono" style={{ fontSize: 13, overflowWrap: "anywhere" }}>{link}</span>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button type="button" className="btn" style={{ background: "#0A0B10", color: "#fff", border: 0, flex: 1 }} onClick={() => { navigator.clipboard?.writeText(link); toast("Link copied"); }}><ICopy size={15} color="#fff" />Copy link</button>
          <button type="button" className="btn" style={{ background: "#fff", color: "#0A0B10", border: 0, flex: 1 }} onClick={() => openX("Launch and trade meme coins with one tap, no wallet setup, no gas. Join me on @Arkhampad 👇", link)}><IX size={14} color="#0A0B10" w={2.4} />Share on X</button>
        </div>
      </div>
      <div className="grid3" style={{ gap: 10 }}>
        <div className="card" style={{ padding: 14, gap: 4 }}><span className="dim" style={{ fontSize: 12 }}>Friends joined</span><b className="mono" style={{ fontSize: 22 }}>{friends.data ?? "—"}</b></div>
        <div className="card" style={{ padding: 14, gap: 4 }}><span className="dim" style={{ fontSize: 12 }}>Earned</span><b className="mono" style={{ fontSize: 22 }}>{usd(earned, 2)}</b></div>
        <div className="card" style={{ padding: 14, gap: 4 }}><span className="dim" style={{ fontSize: 12 }}>Paid out</span><b className="mono" style={{ fontSize: 22 }}>{usd(paid, 2)}</b></div>
      </div>
      <div className="card" style={{ gap: 8 }}>
        <b>Claim</b>
        {(rows.data ?? []).length === 0 ? <span className="dim" style={{ fontSize: 13 }}>Nothing yet. When friends trade, your share shows up here.</span> :
          (rows.data ?? []).map((r) => {
            const due = r.earned - r.paid, n = NETS.find((x) => x.id === r.chain_id);
            return (
              <div key={r.chain_id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 0", borderTop: "1px solid var(--row)" }}>
                <span style={{ flex: 1 }}><b>{n?.name ?? r.chain_id}</b> <span className="dim mono" style={{ fontSize: 12 }}>· {r.friends} trading · {usd(r.volume)} volume</span></span>
                <b className="mono">{usd(Math.max(0, due), 2)}</b>
                <button type="button" className="btn volt sm" disabled={due < 1 || busy === r.chain_id} onClick={() => claim(r.chain_id)}>{busy === r.chain_id ? "…" : due < 1 ? "From $1" : "Claim"}</button>
              </div>
            );
          })}
      </div>
      <div className="card dim" style={{ fontSize: 13, lineHeight: 1.6 }}>
        How it works: friends open your link and log in. For 12 months you get 25% of ArkhamPad&apos;s share of the fees on their trades. Self-invites and fake accounts aren&apos;t paid.
      </div>
    </div>
  );
}
