"use client";
// /pioneer: the free ArkhamPad Pioneer mint. Live count, a preview of the next badge (drawn by the
// contract), one-tap mint, then your badge with Share on X.
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useWallet } from "@/components/wallet";
import { useT } from "@/lib/i18n";
import { usePoll } from "@/lib/ely";
import { inviteLink } from "@/lib/referral";
import { MAX_SUPPLY, MintFail, PIONEER, SAMPLES, TIERS, artPng, mintPioneer, pad, pioneerArt, pioneerState, tierOf } from "@/lib/pioneer";

const XIcon = () => <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M17.8 3h3.1l-6.8 7.7L22 21h-6.2l-4.9-6.3L5.3 21H2.2l7.3-8.3L2 3h6.4l4.4 5.8L17.8 3Zm-1.1 16.2h1.7L7.4 4.7H5.6l11.1 14.5Z" /></svg>;
const sample = (id: number) => `/pioneer/sample-${id}.svg`;

function useArt(id: number | null) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let on = true;
    setSrc(null);
    if (id) pioneerArt(id).then((s) => on && setSrc(s));
    return () => { on = false; };
  }, [id]);
  return src;
}

/** Banner for Discover and You. */
export function PioneerBanner() {
  const tr = useT();
  const st = usePoll(() => pioneerState(null).catch(() => null), 30_000);
  const left = st ? MAX_SUPPLY - st.minted : null;
  return (
    <Link href="/pioneer/" className="e-airdrop e-pio-banner">
      <img src={sample(42)} alt="" width={44} height={44} />
      <span>
        <b>{tr("Free mint: ArkhamPad Pioneer")}</b>
        <small>{left != null ? tr("{n} of 10,000 left. One per wallet, free.", { n: left.toLocaleString("en-US") }) : tr("10,000 on-chain badges for the first people on Elysium. Free.")}</small>
      </span>
      <span className="e-airdrop-go" aria-hidden="true">→</span>
    </Link>
  );
}

export function PioneerPage() {
  const tr = useT();
  const w = useWallet();
  const me = w.address?.toLowerCase() ?? null;
  const [tick, setTick] = useState(0);
  const st = usePoll(() => pioneerState(me).catch(() => null), 8000, [me, tick]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [justMinted, setJustMinted] = useState<number | null>(null);
  const mine = justMinted || st?.mine || 0;
  const next = st ? Math.min(st.minted + 1, MAX_SUPPLY) : null;
  const shownId = mine || next;
  const chainArt = useArt(shownId);
  const art = chainArt ?? sample(mine ? 42 : SAMPLES[0]);
  const minted = st?.minted ?? 0;
  const soldOut = minted >= MAX_SUPPLY;
  const going = useRef(false);

  // the latest badges, drawn by the contract
  const [recent, setRecent] = useState<{ id: number; src: string }[]>([]);
  useEffect(() => {
    let on = true;
    (async () => {
      if (!st || !st.minted) return;
      const ids = Array.from({ length: Math.min(6, st.minted) }, (_, i) => st.minted - i);
      const out = await Promise.all(ids.map(async (id) => ({ id, src: (await pioneerArt(id)) ?? "" })));
      if (on) setRecent(out.filter((x) => x.src));
    })();
    return () => { on = false; };
  }, [st?.minted]); // eslint-disable-line react-hooks/exhaustive-deps

  async function mint() {
    if (!w.signedIn || !w.signer) return w.login();
    if (going.current) return;
    going.current = true;
    setBusy(true);
    setMsg(null);
    try {
      const id = await mintPioneer(w.signer);
      setJustMinted(id || null);
      setMsg({ ok: true, text: id ? tr("You're Pioneer #{n}. Welcome to Elysium.", { n: pad(id) }) : tr("Minted. Your badge shows up in a moment.") });
      setTick((x) => x + 1);
    } catch (e) {
      setMsg({ ok: false, text: e instanceof MintFail ? e.message : tr("Mint failed. Please try again.") });
    } finally {
      setBusy(false);
      going.current = false;
    }
  }

  const [note, setNote] = useState("");
  async function share() {
    if (!mine) return;
    setNote("");
    const text = `I'm ArkhamPad Pioneer #${pad(mine)} on Elysium 🌟\n\n10,000 free badges, one per wallet. ${(MAX_SUPPLY - minted).toLocaleString("en-US")} left.\n\nmint yours: ${me ? inviteLink(me).replace("/?r=", "/pioneer/?r=") : "https://arkhampad.com/pioneer/"}\n\n#NFT #Elysium #FreeMint`;
    const blob = chainArt ? await artPng(chainArt) : null;
    const file = blob ? new File([blob], `arkhampad-pioneer-${pad(mine)}.png`, { type: "image/png" }) : null;
    const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
    try {
      if (/iPhone|iPad|Android/i.test(navigator.userAgent) && file && nav.canShare?.({ files: [file], text })) {
        await navigator.share({ files: [file], text });
        return;
      }
    } catch { return; }
    if (blob) {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `arkhampad-pioneer-${pad(mine)}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      setNote(tr("Picture downloaded: add it to your post."));
    }
    window.open(`https://x.com/intent/post?text=${encodeURIComponent(text)}`, "_blank", "noopener,noreferrer");
  }

  const pct = Math.min(100, (minted / MAX_SUPPLY) * 100);
  let label = tr("Mint for free");
  if (!w.signedIn) label = tr("Log in to mint");
  else if (busy) label = tr("Minting…");
  else if (!PIONEER || !st) label = tr("Opening in a moment");
  else if (soldOut) label = tr("All 10,000 minted");

  return (
    <main className="e-in e-page e-pio">
      <section className="e-pio-hero">
        <div className="e-pio-copy">
          <span className="e-eyebrow"><i className="e-dot" />{tr("Free mint · Elysium")}</span>
          <h1>ArkhamPad <span>Pioneer</span></h1>
          <p>{tr("10,000 badges for the first people on Elysium. Free, one per wallet, the art drawn fully on-chain. Every badge is one of a kind.")}</p>

          <div className="e-pio-count">
            <div className="e-pio-bar"><i style={{ width: `${Math.max(pct, minted ? 1.2 : 0)}%` }} /></div>
            <div className="e-pio-nums">
              <b className="num">{minted.toLocaleString("en-US")}</b><span> / 10,000 {tr("minted")}</span>
              <em className="num">{(MAX_SUPPLY - minted).toLocaleString("en-US")} {tr("left")}</em>
            </div>
          </div>

          {mine ? (
            <div className="e-pio-mine">
              <div><small>{tr("Your badge")}</small><b className="num">#{pad(mine)}</b><span>{tr(tierOf(mine))}</span></div>
              <button type="button" className="e-btn pri e-early-share" onClick={share}><XIcon />{tr("Share on X")}</button>
            </div>
          ) : (
            <button type="button" className="e-go e-pio-go" onClick={mint} disabled={busy || (w.signedIn && (!PIONEER || !st || soldOut))}>{label}</button>
          )}
          {msg && <div className={`e-msg ${msg.ok ? "ok" : "bad"}`} role="status">{msg.text}</div>}
          {note && <span className="dim" style={{ fontSize: 13 }}>{note}</span>}
          <p className="e-note">{mine ? tr("It's in your wallet. You can keep it or sell it on any NFT market on Elysium.") : tr("You only pay the network fee, a fraction of a cent. No email list, no catch.")}</p>
        </div>
        <div className="e-pio-art">
          <img src={art} alt={shownId ? `ArkhamPad Pioneer #${pad(shownId)}` : "ArkhamPad Pioneer"} width={560} height={560} />
          {!mine && next && PIONEER ? <span className="e-pio-tag num">{tr("Next up: #{n}", { n: pad(next) })}</span> : null}
        </div>
      </section>

      <section className="e-pio-tiers">
        {TIERS.map((t) => (
          <div key={t.name} style={{ ["--c" as string]: t.color }}>
            <i />
            <b>{tr(t.name)}</b>
            <span className="num">{tr(t.range)}</span>
          </div>
        ))}
      </section>

      <section className="e-panel">
        <h3 className="e-ph">{recent.length ? tr("Just minted") : tr("What they look like")}</h3>
        <div className="e-pio-grid">
          {(recent.length ? recent : SAMPLES.map((id) => ({ id, src: sample(id) }))).map((x) => (
            <figure key={x.id}><img src={x.src} alt={`Pioneer #${pad(x.id)}`} loading="lazy" /><figcaption className="num">#{pad(x.id)}</figcaption></figure>
          ))}
        </div>
      </section>

      <section className="e-panel e-pio-faq">
        <h3 className="e-ph">{tr("How it works")}</h3>
        <ul>
          <li><b>{tr("Free.")}</b> {tr("No price. You only pay Elysium's network fee.")}</li>
          <li><b>{tr("One per wallet.")}</b> {tr("10,000 in total, then minting closes for good.")}</li>
          <li><b>{tr("Fully on-chain.")}</b> {tr("The picture is drawn by the contract itself. No server, nothing can be changed or taken down.")}</li>
          <li><b>{tr("Yours.")}</b> {tr("A standard NFT: hold it, show it, or trade it on any NFT market on Elysium.")}</li>
        </ul>
      </section>
    </main>
  );
}
