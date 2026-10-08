"use client";
// Coin page extras: about + links, creator tools, promote, holders.
import { useEffect, useRef, useState } from "react";
import type { Address } from "viem";
import { useApp } from "./shell";
import { useSafety } from "@/lib/safety";
import { useWallet } from "./wallet";
import { NETS, TradeError, collectPoolFees, promote, runBuyback, uploadCoinImage, LIVE } from "@/lib/chain";
import { short, usd, type LiveCoin } from "@/lib/live";

/** Turns what a creator typed (handle, bare domain, full link) into a safe https link. */
function link(kind: "x" | "telegram" | "website", v?: string) {
  if (!v) return null;
  let s = v.trim();
  if (kind === "x") { s = s.replace(/^@/, ""); if (!/[./]/.test(s)) s = `x.com/${s}`; }
  if (kind === "telegram") { s = s.replace(/^@/, ""); if (!/[./]/.test(s)) s = `t.me/${s}`; }
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  try {
    const u = new URL(s);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    if (kind === "x" && !/(^|\.)(x|twitter)\.com$/i.test(u.hostname)) return null;
    if (kind === "telegram" && !/(^|\.)(t\.me|telegram\.me)$/i.test(u.hostname)) return null;
    return u.toString();
  } catch { return null; }
}

export function AboutCard({ c }: { c: LiveCoin }) {
  const a = c.about;
  const x = link("x", a?.x), tg = link("telegram", a?.telegram), web = link("website", a?.website);
  if (!a?.description && !x && !tg && !web) return null;
  return (
    <div className="card" style={{ gap: 10 }}>
      <span style={{ fontWeight: 700 }}>About</span>
      {a?.description && <p style={{ margin: 0, fontSize: 14, lineHeight: 1.55, color: "var(--text2)", whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{a.description}</p>}
      {(x || tg || web) && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {x && <a className="btn sm" href={x} target="_blank" rel="noopener noreferrer nofollow">𝕏 Twitter</a>}
          {tg && <a className="btn sm" href={tg} target="_blank" rel="noopener noreferrer nofollow">Telegram</a>}
          {web && <a className="btn sm" href={web} target="_blank" rel="noopener noreferrer nofollow">Website</a>}
        </div>
      )}
    </div>
  );
}

export function CreatorCard({ c, onImage }: { c: LiveCoin; onImage: (url: string) => void }) {
  const w = useWallet();
  const { toast } = useApp();
  const [busy, setBusy] = useState("");
  const file = useRef<HTMLInputElement>(null);
  const isCreator = !!w.address && !!c.creator && w.address.toLowerCase() === c.creator.toLowerCase();
  const run = async (label: string, fn: () => Promise<unknown>, ok: string) => {
    setBusy(label);
    try { await fn(); toast(ok); } catch (e) { toast(e instanceof TradeError ? e.message : "Something went wrong. Please try again."); } finally { setBusy(""); }
  };
  const burn = c.feeMode === 1;
  const pickImage = async (f: File | undefined) => {
    if (!f || !w.signer) return;
    await run("Uploading…", async () => { const url = await uploadCoinImage(c.chainId, c.address as Address, f, w.signer!); onImage(url); }, "Image updated");
  };
  return (
    <div className="card" style={{ gap: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontWeight: 700 }}>{burn ? "Buyback & burn" : "Creator earnings"}</span>
        <span className="dim mono" style={{ fontSize: 12 }}>by {c.creator ? short(c.creator) : "—"}</span>
      </div>
      <span className="dim" style={{ fontSize: 13, lineHeight: 1.5 }}>
        {burn ? "30% of this coin's pool fees buy the coin back and burn it." : "This coin's creator earns 30% of the pool fee on every trade, in any app."} Fees are collected automatically every 30 minutes.
      </span>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14 }}><span className="dim">{burn ? "Buyback fund so far" : "Earned so far"}</span><b className="mono">{usd(c.creatorFees ?? 0, 2)}</b></div>
      {(burn || isCreator) && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button type="button" className="btn" style={{ flex: 1 }} disabled={!!busy} onClick={() => run("Collecting…", () => collectPoolFees(c.chainId, c.address as Address), "Pool fees collected")}>{busy || "Collect pool fees"}</button>
          {burn && <button type="button" className="btn" style={{ flex: 1 }} disabled={!!busy} onClick={() => run("Burning…", () => runBuyback(c.chainId, c.address as Address), "Bought back and burned")}>Run buyback</button>}
        </div>
      )}
      {isCreator && (
        <>
          <input ref={file} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={(e) => pickImage(e.target.files?.[0])} />
          <button type="button" className="btn ghost sm" disabled={!!busy} onClick={() => file.current?.click()}>{c.image ? "Change coin image" : "Add coin image"}</button>
        </>
      )}
    </div>
  );
}

const PLANS = [{ id: 1 as const, label: "6 hours", price: 10 }, { id: 2 as const, label: "24 hours", price: 20 }, { id: 3 as const, label: "7 days", price: 99 }];

export function PromoteButton({ c }: { c: LiveCoin }) {
  const w = useWallet();
  const { toast } = useApp();
  const [open, setOpen] = useState(false);
  const [plan, setPlan] = useState<1 | 2 | 3>(1);
  const [busy, setBusy] = useState(false);
  // pay on the coin's own network; coins from other DEXs are paid on the first network the user has cash on
  const payOn = c.own ? c.chainId : (NETS.find((n) => (w.usdc[n.id] ?? 0n) > 0n) ?? NETS[0]).id;
  const go = async () => {
    if (!w.signedIn || !w.signer) { w.login(); return; }
    setBusy(true);
    try {
      await promote(payOn, c.address as Address, plan, w.signer, c.chainId);
      await w.refresh();
      toast(`${c.tick} is promoted for ${PLANS.find((p) => p.id === plan)!.label}`);
      setOpen(false);
    } catch (e) { toast(e instanceof TradeError ? e.message : "Something went wrong. Please try again."); } finally { setBusy(false); }
  };
  return (
    <>
      <button type="button" className="btn ghost sm" onClick={() => setOpen(true)}>Promote</button>
      {open && (
        <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
          <div className="modal" role="dialog" aria-modal="true" aria-label={`Promote ${c.tick}`} style={{ gap: 14 }}>
            <span style={{ fontWeight: 900, fontSize: 22 }}>Promote {c.tick}</span>
            <span className="dim" style={{ fontSize: 14, lineHeight: 1.5 }}>Show this coin in the Promoted row at the top of Discover. Anyone can promote any coin.</span>
            <div style={{ display: "flex", gap: 8 }}>
              {PLANS.map((p) => <button key={p.id} type="button" className={`seg${plan === p.id ? " on" : ""}`} style={{ height: 64, flexDirection: "column", gap: 2 }} onClick={() => setPlan(p.id)}><b className="mono">${p.price}</b><span style={{ fontSize: 11 }}>{p.label}</span></button>)}
            </div>
            <button type="button" className="btn volt lg" disabled={busy} onClick={go}>{busy ? "Promoting…" : w.signedIn ? `Promote for $${PLANS.find((p) => p.id === plan)!.price}` : "Log in to promote"}</button>
            <span style={{ fontSize: 11, color: "var(--faint)", textAlign: "center" }}>{LIVE ? "Paid in USDC" : "Testnet · paid with test USDC"}</span>
            <button type="button" className="btn ghost" onClick={() => setOpen(false)}>Close</button>
          </div>
        </div>
      )}
    </>
  );
}

export function HoldersCard({ c }: { c: LiveCoin }) {
  // shares one load with the safety check (balances read on-chain, refreshed after trades)
  const s = useSafety(c);
  const rows = s ? s.holders : null;
  const supply = 1e9;
  return (
    <div className="card" style={{ gap: 8 }}>
      <span style={{ fontWeight: 700 }}>Top holders</span>
      {rows === null ? <div className="skel" style={{ height: 80, borderRadius: 12 }} /> : rows.length === 0 ? <span className="dim" style={{ fontSize: 13 }}>No holders yet.</span> :
        rows.slice(0, 15).map((r, i) => (
          <div key={r.wallet} className="mono" style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: "6px 0", borderTop: i ? "1px solid var(--row)" : 0 }}>
            <span>{i + 1}. {short(r.wallet)}{c.creator && r.wallet === c.creator.toLowerCase() ? <span className="volt" style={{ marginLeft: 6, fontFamily: "var(--sans)", fontWeight: 700, fontSize: 11 }}>creator</span> : null}</span>
            <span className="dim">{((r.amount / supply) * 100).toFixed(2)}%</span>
          </div>
        ))}
      <span style={{ fontSize: 11, color: "var(--faint)" }}>Coins in the locked pool aren&apos;t a person, so they aren&apos;t listed.</span>
    </div>
  );
}
