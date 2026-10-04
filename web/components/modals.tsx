"use client";
import { useEffect } from "react";
import { IAlert, IX } from "./icons";
import { BrandMark } from "./bits";

function Overlay({ onClose, label, children, wide }: { onClose: () => void; label: string; children: React.ReactNode; wide?: boolean }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", k);
    const prev = document.body.style.overflow; document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", k); document.body.style.overflow = prev; };
  }, [onClose]);
  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={label} style={wide ? { maxWidth: 520 } : undefined}>{children}</div>
    </div>
  );
}
const Close = ({ onClose }: { onClose: () => void }) => (
  <button type="button" className="icon-btn" aria-label="Close" onClick={onClose} style={{ width: 40, height: 40, background: "transparent" }}><IX size={15} /></button>
);

export function LoginModal({ onClose }: { onClose: () => void }) {
  return (
    <Overlay onClose={onClose} label="Mainnet soon">
      <div style={{ display: "flex", justifyContent: "flex-end" }}><Close onClose={onClose} /></div>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", gap: 12, marginTop: -18 }}>
        <BrandMark size={52} />
        <span className="pill" style={{ background: "rgba(212,255,58,0.12)", color: "var(--volt-ink)", fontWeight: 800 }}><span className="dot" style={{ background: "var(--volt)" }} />Testnet live</span>
        <h2 style={{ margin: 0, fontSize: 30, fontWeight: 900, letterSpacing: -0.8 }}>Mainnet soon</h2>
        <p className="muted" style={{ margin: 0, fontSize: 15, lineHeight: 1.55 }}>Sign-ups, launching and trading open very soon. Follow us on X and turn on notifications 🔔 so you don&apos;t miss the launch.</p>
      </div>
      <a className="btn white lg" href="https://x.com/Arkhampad" target="_blank" rel="noopener noreferrer"><IX size={16} color="#0A0B10" w={2.4} />Follow @Arkhampad on X</a>
      <button type="button" className="btn lg" onClick={onClose}>Keep exploring</button>
      <p style={{ margin: 0, fontSize: 12, lineHeight: 1.5, color: "var(--faint)", textAlign: "center" }}>We never ask for your seed phrase. Never send funds to an address you got from a DM.</p>
    </Overlay>
  );
}

export function FundsModal({ tab, onClose }: { tab: "deposit" | "withdraw"; setTab: (t: "deposit" | "withdraw") => void; onClose: () => void }) {
  return (
    <Overlay onClose={onClose} label={tab === "deposit" ? "Deposits" : "Withdrawals"}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontWeight: 900, fontSize: 22 }}>{tab === "deposit" ? "Deposits" : "Withdrawals"} open soon</span><Close onClose={onClose} />
      </div>
      <div className="warn-note"><IAlert size={16} color="var(--warn)" /><span>Do not send any funds yet. ArkhamPad has no deposit address until the app opens. Anyone giving you one before then is a scammer.</span></div>
      <p className="muted" style={{ margin: 0, fontSize: 14, lineHeight: 1.55 }}>When the app opens you will deposit and withdraw only USDC, right here.</p>
      <button type="button" className="btn lg" onClick={onClose}>Got it</button>
    </Overlay>
  );
}

export function WelcomeModal({ onClose }: { onClose: () => void }) {
  return (
    <Overlay onClose={onClose} label="Welcome to ArkhamPad">
      <div style={{ display: "flex", justifyContent: "flex-end" }}><Close onClose={onClose} /></div>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", gap: 14, marginTop: -18 }}>
        <BrandMark size={56} />
        <span className="pill" style={{ background: "rgba(212,255,58,0.12)", color: "var(--volt-ink)", fontWeight: 800, fontSize: 13 }}><span className="dot" style={{ background: "var(--volt)" }} />Testnet live</span>
        <h2 style={{ margin: 0, fontSize: 34, fontWeight: 900, letterSpacing: -1, lineHeight: 1.05 }}>Mainnet is coming soon</h2>
        <p className="muted" style={{ margin: 0, fontSize: 15, lineHeight: 1.55 }}>Create a coin with one sentence and trade thousands with USDC. Follow <b style={{ color: "var(--text)" }}>@Arkhampad</b> on X for the latest updates and turn on notifications 🔔 to be first at launch.</p>
      </div>
      <a className="btn white lg" href="https://x.com/Arkhampad" target="_blank" rel="noopener noreferrer" onClick={onClose}><IX size={16} color="#0A0B10" w={2.4} />Follow @Arkhampad on X</a>
      <button type="button" className="btn lg" onClick={onClose}>Explore the preview</button>
    </Overlay>
  );
}
