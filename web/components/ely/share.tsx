"use client";
// Share a coin: on phones the share sheet gets the card image and the text together (pick X and both go
// in the post). On computers the card is downloaded and X opens with the text ready, so the card can be
// attached in one click.
import { useState } from "react";
import { useT } from "@/lib/i18n";
import type { EToken } from "@/lib/ely";
import { shareCard, shareText, type CoinLinks } from "@/lib/sharecard";

const XIcon = () => <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M17.8 3h3.1l-6.8 7.7L22 21h-6.2l-4.9-6.3L5.3 21H2.2l7.3-8.3L2 3h6.4l4.4 5.8L17.8 3Zm-1.1 16.2h1.7L7.4 4.7H5.6l11.1 14.5Z" /></svg>;

export function ShareButton({ t, links, mcap, fresh, big }: { t: EToken; links: CoinLinks; mcap: string; fresh?: boolean; big?: boolean }) {
  const tr = useT();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  async function go() {
    setBusy(true);
    setNote("");
    const text = shareText(t, links, fresh);
    try {
      const blob = await shareCard(t, mcap);
      const file = blob ? new File([blob], `${t.symbol}-arkhampad.png`, { type: "image/png" }) : null;
      const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
      const mobile = /iPhone|iPad|Android/i.test(navigator.userAgent);
      if (mobile && file && nav.canShare?.({ files: [file], text })) {
        await navigator.share({ files: [file], text });
        return;
      }
      if (blob) {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `${t.symbol}-arkhampad.png`;
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
  if (big) {
    return (
      <>
        <button type="button" className="e-go" onClick={go} disabled={busy} style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10 }}><XIcon />{tr(busy ? "Making your card…" : "Share on X")}</button>
        {note && <span className="dim" style={{ fontSize: 13 }}>{note}</span>}
      </>
    );
  }
  return (
    <button type="button" className="e-btn e-icon e-share" onClick={go} disabled={busy} aria-label="Share on X" title={note || "Share on X"}>
      <XIcon />
    </button>
  );
}
