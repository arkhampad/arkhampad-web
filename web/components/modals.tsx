"use client";
import { useEffect, useMemo, useState } from "react";
import { GoogleIcon, IAlert, ICopy, IScan, IWallet, IX } from "./icons";

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
  const [email, setEmail] = useState("");
  return (
    <Overlay onClose={onClose} label="Log in">
      <div style={{ display: "flex", justifyContent: "flex-end" }}><Close onClose={onClose} /></div>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", gap: 10, marginTop: -18 }}>
        <span className="logo-mark" style={{ width: 44, height: 44, borderRadius: 14 }}><svg width="20" height="20" viewBox="0 0 16 16" fill="none" stroke="#0A0B10" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M3 11 L8 5 L13 11" /></svg></span>
        <h2 style={{ margin: 0, fontSize: 28, fontWeight: 900, letterSpacing: -0.8 }}>Welcome to ArkhamPad</h2>
        <p className="muted" style={{ margin: 0, fontSize: 14 }}>Create and trade with intelligence. No wallet needed.</p>
      </div>
      <button type="button" className="btn white lg"><GoogleIcon />Continue with Google</button>
      <button type="button" className="btn lg"><IX size={16} />Continue with X</button>
      <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 12, color: "var(--faint)" }}><span style={{ flex: 1, height: 1, background: "var(--line2)" }} />or<span style={{ flex: 1, height: 1, background: "var(--line2)" }} /></div>
      <form style={{ display: "flex", gap: 8 }} onSubmit={(e) => e.preventDefault()}>
        <label className="sr" htmlFor="login-email">Email</label>
        <input id="login-email" type="email" className="inp" style={{ height: 54, borderRadius: 15 }} placeholder="you@email.com" value={email} onChange={(e) => setEmail(e.target.value)} />
        <button type="submit" className="btn volt lg" style={{ flex: "none" }}>Continue</button>
      </form>
      <button type="button" className="btn lg"><IWallet size={18} />Connect a wallet</button>
      <p style={{ margin: 0, fontSize: 12, lineHeight: 1.5, color: "var(--faint)", textAlign: "center" }}>By continuing you agree to the <a href="/terms/" className="volt">Terms</a> and <a href="/privacy/" className="volt">Privacy Policy</a>. We never ask for your seed phrase.</p>
    </Overlay>
  );
}

function FakeQR({ seed, size = 140 }: { seed: string; size?: number }) {
  const cells = useMemo(() => {
    const n = 25; let h = 0; for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    const out: [number, number][] = [];
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      if ((i < 8 && j < 8) || (i < 8 && j > n - 9) || (i > n - 9 && j < 8)) continue;
      h = (h * 1103515245 + 12345) >>> 0; if (h % 2) out.push([i, j]);
    }
    return out;
  }, [seed]);
  const c = size / 25;
  const finder = (x: number, y: number) => (<g key={`${x}${y}`}><rect x={x * c} y={y * c} width={7 * c} height={7 * c} fill="#0A0B10" /><rect x={(x + 1) * c} y={(y + 1) * c} width={5 * c} height={5 * c} fill="#fff" /><rect x={(x + 2) * c} y={(y + 2) * c} width={3 * c} height={3 * c} fill="#0A0B10" /></g>);
  return (<svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label="Deposit address QR code"><rect width={size} height={size} fill="#fff" />{cells.map(([i, j]) => <rect key={`${i}-${j}`} x={i * c} y={j * c} width={c} height={c} fill="#0A0B10" />)}{finder(0, 0)}{finder(18, 0)}{finder(0, 18)}</svg>);
}

const NETS = [["Base", "var(--base)"], ["Robinhood", "var(--rh)"], ["Other chain", "var(--dim)"]] as const;
function NetPick({ v, set }: { v: string; set: (s: string) => void }) {
  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      {NETS.map(([n, c]) => (
        <button key={n} type="button" onClick={() => set(n)} className="seg" style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, fontWeight: 700, border: v === n ? `2px solid ${c}` : undefined }}>
          <span className="dot" style={{ width: 9, height: 9, background: c }} />{n}
        </button>
      ))}
    </div>
  );
}

export function FundsModal({ tab, setTab, onClose }: { tab: "deposit" | "withdraw"; setTab: (t: "deposit" | "withdraw") => void; onClose: () => void }) {
  const [net, setNet] = useState("Base");
  const [amt, setAmt] = useState("100");
  const [to, setTo] = useState("");
  const [copied, setCopied] = useState(false);
  const addr = "0x4be1c7a90d2e83f15b6c0a7e9d24f81c3a5b9e02";
  const avail = 248.5;
  const n = Math.max(0, Math.min(avail, Number(amt) || 0));
  const copy = async () => { try { await navigator.clipboard.writeText(addr); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* clipboard blocked */ } };
  return (
    <Overlay onClose={onClose} label={tab === "deposit" ? "Add USDC" : "Withdraw USDC"} wide>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontWeight: 900, fontSize: 22 }}>{tab === "deposit" ? "Add USDC" : "Withdraw USDC"}</span><Close onClose={onClose} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, padding: 4, borderRadius: 14, background: "var(--bg)" }}>
        <button type="button" onClick={() => setTab("deposit")} style={{ height: 42, borderRadius: 11, border: 0, fontWeight: 800, background: tab === "deposit" ? "var(--up)" : "transparent", color: tab === "deposit" ? "#04130C" : "var(--muted)" }}>Deposit</button>
        <button type="button" onClick={() => setTab("withdraw")} style={{ height: 42, borderRadius: 11, border: 0, fontWeight: 800, background: tab === "withdraw" ? "var(--text)" : "transparent", color: tab === "withdraw" ? "var(--bg)" : "var(--muted)" }}>Withdraw</button>
      </div>
      {tab === "deposit" ? (<>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontWeight: 800, fontSize: 18 }}>Send only</span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "5px 12px", borderRadius: 999, background: "var(--usdc)", color: "#fff", font: "800 15px var(--mono)" }}>
            <span style={{ width: 16, height: 16, borderRadius: "50%", border: "2px solid #fff", display: "inline-flex", alignItems: "center", justifyContent: "center", font: "800 9px var(--sans)" }}>$</span>USDC</span>
          <span style={{ fontWeight: 800, fontSize: 18 }}>from</span>
        </div>
        <NetPick v={net} set={setNet} />
        <div style={{ display: "flex", gap: 16, alignItems: "center", padding: 16, borderRadius: 18, background: "var(--bg)", border: "1px solid var(--line2)", flexWrap: "wrap" }}>
          <span style={{ borderRadius: 14, overflow: "hidden", flex: "none", width: 140, height: 140 }}><FakeQR seed={addr + net} /></span>
          <div style={{ flex: "1 1 180px", minWidth: 0, display: "flex", flexDirection: "column", gap: 8 }}>
            <span className="dim" style={{ fontSize: 12 }}>Your deposit address · {net}</span>
            <span className="mono" style={{ fontWeight: 600, fontSize: 14, lineHeight: 1.5, wordBreak: "break-all" }}>{addr}</span>
            <button type="button" className="btn volt sm" style={{ alignSelf: "flex-start" }} onClick={copy}><ICopy size={14} color="#0A0B10" />{copied ? "Copied" : "Copy address"}</button>
          </div>
        </div>
        <div className="warn-note"><IAlert size={16} color="var(--warn)" /><span>Only send <b>USDC</b> on <b>{net === "Other chain" ? "a supported chain" : net}</b> to this address. Other coins or networks can be lost.</span></div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}><span className="dim">Arrives in</span><span>about 1 minute</span></div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", borderRadius: 14, background: "var(--card)", border: "1px solid var(--line)" }}>
          <span className="dot" style={{ width: 8, height: 8, background: "var(--warn)" }} /><span style={{ flex: 1, fontSize: 13, color: "var(--text2)" }}>Waiting for your deposit…</span><span className="mono" style={{ fontSize: 12, color: "var(--faint)" }}>auto-detects</span>
        </div>
      </>) : (<>
        <label htmlFor="wd-amt" style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }} className="dim"><span>Amount</span><span>Available <b className="mono" style={{ color: "var(--text)" }}>${avail.toFixed(2)}</b></span></label>
        <div style={{ display: "flex", alignItems: "center", height: 64, padding: "0 12px 0 16px", borderRadius: 16, background: "var(--bg)", border: "1px solid var(--line3)" }}>
          <span className="mono dim" style={{ fontWeight: 700, fontSize: 28 }}>$</span>
          <input id="wd-amt" inputMode="decimal" value={amt} onChange={(e) => setAmt(e.target.value.replace(/[^0-9.]/g, ""))} style={{ flex: 1, minWidth: 0, background: "transparent", border: 0, outline: "none", font: "700 28px var(--mono)", paddingLeft: 4 }} />
          <button type="button" className="btn sm" style={{ color: "var(--volt)", fontFamily: "var(--mono)" }} onClick={() => setAmt(String(avail))}>MAX</button>
        </div>
        <span className="dim" style={{ fontSize: 13 }}>Send to network</span>
        <NetPick v={net} set={setNet} />
        <label htmlFor="wd-to" className="dim" style={{ fontSize: 13 }}>To address or exchange</label>
        <div style={{ display: "flex", alignItems: "center", gap: 8, height: 56, padding: "0 8px 0 16px", borderRadius: 15, background: "var(--bg)", border: "1px solid var(--line3)" }}>
          <input id="wd-to" placeholder="0x… paste address" value={to} onChange={(e) => setTo(e.target.value.trim())} style={{ flex: 1, minWidth: 0, background: "transparent", border: 0, outline: "none", font: "500 14px var(--mono)" }} />
          <button type="button" className="btn sm" onClick={async () => { try { setTo((await navigator.clipboard.readText()).trim()); } catch { /* blocked */ } }}>Paste</button>
          <button type="button" className="icon-btn" aria-label="Scan QR" style={{ width: 40, height: 40 }}><IScan size={16} /></button>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: 14, borderRadius: 14, background: "var(--card)", border: "1px solid var(--line)", fontSize: 13 }}>
          <div style={{ display: "flex", justifyContent: "space-between" }}><span className="dim">Network fee</span><span className="mono">~$0.02</span></div>
          <div style={{ display: "flex", justifyContent: "space-between" }}><span className="dim">You receive</span><span className="mono" style={{ fontWeight: 800, fontSize: 15 }}>${Math.max(0, n - 0.02).toFixed(2)} USDC</span></div>
        </div>
        <button type="button" className="btn white lg" disabled={!n || !/^0x[a-fA-F0-9]{40}$/.test(to)} style={{ opacity: !n || !/^0x[a-fA-F0-9]{40}$/.test(to) ? 0.5 : 1 }}>Withdraw ${n ? n.toFixed(2) : "0"}</button>
        <span style={{ fontSize: 12, color: "var(--faint)", textAlign: "center" }}>Double-check the address. Withdrawals can&apos;t be reversed.</span>
      </>)}
    </Overlay>
  );
}
