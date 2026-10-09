"use client";
import { useEffect, useState } from "react";
import { getAddress, isAddress, type Address } from "viem";
import { NETS, faucet, toUsdc, withdraw, LIVE, NET_NAMES, HOME_CHAIN } from "@/lib/chain";
import { useWallet } from "./wallet";
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

export function FundsModal({ tab, setTab, onClose }: { tab: "deposit" | "withdraw"; setTab: (t: "deposit" | "withdraw") => void; onClose: () => void }) {
  const w = useWallet();
  // Live: one USDC balance, deposits and withdrawals on the home chain (Base) only; cash on other
  // chains is moved over automatically when needed. Testnet: the faucet network opens first.
  const shown = LIVE ? NETS.filter((x) => x.id === HOME_CHAIN) : NETS;
  const [net, setNet] = useState(LIVE ? HOME_CHAIN : (NETS.find((x) => x.faucet) ?? NETS[0]).id);
  const [qr, setQr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [amt, setAmt] = useState("");
  const [to, setTo] = useState("");
  const n = NETS.find((x) => x.id === net) ?? NETS[0];
  const bal = LIVE ? w.totalUsdc : Number(w.usdc[net] ?? 0n) / 1e6;
  const homeBal = Number(w.usdc[net] ?? 0n) / 1e6;
  // cash that has to come over from another network first costs a little to move
  const maxOut = homeBal >= bal - 0.01 ? bal - 0.01 : bal * 0.99 - 0.05;
  useEffect(() => {
    if (!w.address) return;
    import("qrcode").then((Q) => Q.toDataURL(w.address as string, { margin: 1, width: 220, color: { dark: "#0A0B10", light: "#FFFFFF" } })).then(setQr).catch(() => setQr(null));
  }, [w.address]);
  if (!w.signedIn || !w.address) {
    return (
      <Overlay onClose={onClose} label="Sign in">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}><span style={{ fontWeight: 900, fontSize: 22 }}>Sign in first</span><Close onClose={onClose} /></div>
        <button type="button" className="btn volt lg" onClick={() => { onClose(); w.login(); }}>Sign in</button>
      </Overlay>
    );
  }
  const copy = async () => { try { await navigator.clipboard.writeText(w.address as string); setMsg({ ok: true, text: "Address copied" }); } catch { /* blocked */ } };
  const getTest = async () => {
    setBusy(true); setMsg(null);
    try { await faucet(net, w.address as Address); await w.refresh(); setMsg({ ok: true, text: "100 test USDC added" }); }
    catch (e) { setMsg({ ok: false, text: (e as Error).message }); } finally { setBusy(false); }
  };
  const send = async () => {
    setMsg(null);
    const v = Number(amt);
    if (!Number.isFinite(v) || v <= 0) return setMsg({ ok: false, text: "Enter an amount." });
    if (!isAddress(to.trim())) return setMsg({ ok: false, text: "Enter a valid wallet address (0x…)." });
    if (to.trim().toLowerCase() === (w.address as string).toLowerCase()) return setMsg({ ok: false, text: "That's your own ArkhamPad address." });
    if (!w.signer) return;
    setBusy(true);
    try { await withdraw(net, getAddress(to.trim()), toUsdc(v), w.signer); await w.refresh(); setAmt(""); setMsg({ ok: true, text: `Sent $${v.toFixed(2)} ${n.dollar ?? "USDC"}` }); }
    catch (e) { setMsg({ ok: false, text: (e as Error).message }); } finally { setBusy(false); }
  };
  return (
    <Overlay onClose={onClose} label={tab === "deposit" ? "Deposit" : "Withdraw"}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "flex", gap: 4 }}>{(["deposit", "withdraw"] as const).map((t) => <button key={t} type="button" className={`tab${tab === t ? " on" : ""}`} onClick={() => { setTab(t); setMsg(null); }} style={{ fontSize: 15 }}>{t === "deposit" ? "Deposit" : "Withdraw"}</button>)}</div>
        <Close onClose={onClose} />
      </div>
      <div style={{ display: "flex", gap: 6 }}>{shown.map((x) => <button key={x.id} type="button" className={`seg${net === x.id ? " on" : ""}`} onClick={() => { setNet(x.id); setMsg(null); }}>{x.name}</button>)}</div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}><span className="dim">{LIVE ? "Cash (USDC)" : `${n.dollar ?? "USDC"} on ${n.short}`}</span><b className="mono">${bal.toFixed(2)}</b></div>
      {tab === "deposit" ? (
        <>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
            {qr ? <img src={qr} alt="Your deposit address as a QR code" width={180} height={180} style={{ borderRadius: 14, background: "#fff" }} /> : <div className="skel" style={{ width: 180, height: 180, borderRadius: 14 }} />}
            <span className="mono" style={{ fontSize: 13, wordBreak: "break-all", textAlign: "center" }}>{w.address}</span>
            <button type="button" className="btn sm" onClick={copy}>Copy address</button>
          </div>
          <div className="warn-note"><IAlert size={16} color="var(--warn)" /><span>Send only <b>{n.dollar ?? "USDC"}</b> on <b>{n.name}</b> to this address.{LIVE ? " Other tokens or networks can be lost." : " This is a test network: test USDC has no value."}</span></div>
          {n.faucet ? <button type="button" className="btn volt lg" disabled={busy} onClick={getTest}>{busy ? "Sending…" : "Get 100 test USDC"}</button>
            : n.faucetUrl ? <a className="btn volt lg" href={n.faucetUrl} target="_blank" rel="noopener noreferrer">Get test USDC from Circle ↗</a> : null}
          {!n.faucet && n.faucetUrl && <span className="dim" style={{ fontSize: 12, textAlign: "center" }}>On the Circle page pick <b>{n.name}</b>, paste your address above, and request USDC.</span>}
        </>
      ) : (
        <>
          <div className="field"><label htmlFor="wd-to">Send to (wallet or exchange address on {n.name})</label><input id="wd-to" className="inp mono" placeholder="0x…" value={to} onChange={(e) => setTo(e.target.value)} autoComplete="off" spellCheck={false} /></div>
          <div className="field"><label htmlFor="wd-amt">Amount ({n.dollar ?? "USDC"})</label>
            <div style={{ display: "flex", gap: 6 }}><input id="wd-amt" className="inp mono" inputMode="decimal" placeholder="0.00" value={amt} onChange={(e) => setAmt(e.target.value.replace(/[^0-9.]/g, ""))} /><button type="button" className="btn sm" style={{ height: 46 }} onClick={() => setAmt(Math.max(0, maxOut).toFixed(2))}>Max</button></div>
          </div>
          <button type="button" className="btn volt lg" disabled={busy} onClick={send}>{busy ? "Sending…" : "Withdraw"}</button>
        </>
      )}
      {msg && <div role="status" style={{ fontSize: 13, fontWeight: 600, color: msg.ok ? "var(--up)" : "var(--down)", textAlign: "center" }}>{msg.text}</div>}
    </Overlay>
  );
}

export function WelcomeModal({ onClose }: { onClose: () => void }) {
  return (
    <Overlay onClose={onClose} label="Welcome to ArkhamPad">
      <div style={{ display: "flex", justifyContent: "flex-end" }}><Close onClose={onClose} /></div>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", gap: 14, marginTop: -18 }}>
        <BrandMark size={56} />
        <span className="pill" style={{ background: "rgba(212,255,58,0.12)", color: "var(--volt-ink)", fontWeight: 800, fontSize: 13 }}><span className="dot" style={{ background: "var(--volt)" }} />{LIVE ? `Live on ${NET_NAMES}` : "Testnet live"}</span>
        <h2 style={{ margin: 0, fontSize: 34, fontWeight: 900, letterSpacing: -1, lineHeight: 1.05 }}>{LIVE ? "ArkhamPad is live" : "Testnet is open"}</h2>
        {LIVE
          ? <p className="muted" style={{ margin: 0, fontSize: 15, lineHeight: 1.55 }}>Launch a coin in seconds. It opens straight into a locked Uniswap pool and shows on DexScreener right away. Follow <b style={{ color: "var(--text)" }}>@Arkhampad</b> on X for new launches.</p>
          : <p className="muted" style={{ margin: 0, fontSize: 15, lineHeight: 1.55 }}>Sign in, get free test USDC and try launching and trading coins with no risk. Mainnet is coming soon: follow <b style={{ color: "var(--text)" }}>@Arkhampad</b> on X so you don&apos;t miss it.</p>}
      </div>
      <a className="btn white lg" href="https://x.com/Arkhampad" target="_blank" rel="noopener noreferrer" onClick={onClose}><IX size={16} color="#0A0B10" w={2.4} />Follow @Arkhampad on X</a>
      <button type="button" className="btn lg" onClick={onClose}>Start exploring</button>
    </Overlay>
  );
}
