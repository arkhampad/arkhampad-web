"use client";
import { useEffect } from "react";
import { IAlert, IX } from "./icons";

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
    <Overlay onClose={onClose} label="Opening soon">
      <div style={{ display: "flex", justifyContent: "flex-end" }}><Close onClose={onClose} /></div>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", gap: 12, marginTop: -18 }}>
        <span className="logo-mark" style={{ width: 44, height: 44, borderRadius: 14 }}><svg width="20" height="20" viewBox="0 0 16 16" fill="none" stroke="#0A0B10" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M3 11 L8 5 L13 11" /></svg></span>
        <h2 style={{ margin: 0, fontSize: 28, fontWeight: 900, letterSpacing: -0.8 }}>Opening soon</h2>
        <p className="muted" style={{ margin: 0, fontSize: 15, lineHeight: 1.55 }}>Our contracts are live on the Base and Robinhood Chain testnets. Sign-ups, launching and trading open in the app very soon.</p>
      </div>
      <a className="btn white lg" href="https://x.com/Arkhampad" target="_blank" rel="noopener noreferrer"><IX size={16} color="#0A0B10" w={2.4} />Follow @Arkhampad for the launch</a>
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
