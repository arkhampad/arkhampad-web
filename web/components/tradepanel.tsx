"use client";
// Real buy/sell on ArkhamPad coins (testnet): one tap, no wallet pop-ups, gas paid in USDC.
import { useEffect, useRef, useState } from "react";
import type { Address } from "viem";
import { IBell, IShare } from "./icons";
import { useApp } from "./shell";
import { useWallet } from "./wallet";
import { FEE, buy, fromCoin, fromUsdc, onLocalTrade, poolBuy, poolSell, quoteBuy, quotePool, quoteSell, sell, tokenBalance, toUsdc, TradeError } from "@/lib/chain";
import type { LiveCoin } from "@/lib/live";

const fmtCoins = (t: number) => (!Number.isFinite(t) || t <= 0 ? "0" : t >= 1e9 ? (t / 1e9).toFixed(2) + "B" : t >= 1e6 ? (t / 1e6).toFixed(2) + "M" : t >= 1e3 ? (t / 1e3).toFixed(1) + "K" : t.toFixed(t < 1 ? 4 : 2));

export function TradePanel({ coin, withLimit = false, onShare, initialSide = "buy" }: { coin: LiveCoin; withLimit?: boolean; onShare?: () => void; initialSide?: "buy" | "sell" }) {
  const { toast, openSoon, openFunds } = useApp();
  const w = useWallet();
  const [side, setSide] = useState<"buy" | "sell">(initialSide);
  const [mode, setMode] = useState("Market");
  const [amt, setAmt] = useState("25");
  const [pct, setPct] = useState(100);
  const [held, setHeld] = useState<bigint>(0n);
  const [quote, setQuote] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState("");
  const seq = useRef(0);
  const phase = coin.phase ?? 0;
  const inPool = coin.own && phase === 2; // graduated: trades in its locked Uniswap pool
  const tradable = coin.own && (phase === 0 ? !!coin.curve : phase === 2);
  const curve = coin.curve as Address | undefined;
  const cash = fromUsdc(w.usdc[coin.chainId] ?? 0n);
  const usd = Number(amt) || 0;
  const sellAmount = (held * BigInt(pct)) / 100n;

  // what this wallet holds of the coin (refreshed after every trade)
  useEffect(() => {
    if (!w.address || !coin.own) { setHeld(0n); return; }
    let alive = true;
    const load = () => tokenBalance(coin.chainId, coin.address as Address, w.address as Address).then((b) => alive && setHeld(b)).catch(() => {});
    load();
    const off = onLocalTrade((t) => { if (t.coin.toLowerCase() === coin.address.toLowerCase()) load(); });
    return () => { alive = false; off(); };
  }, [w.address, coin.chainId, coin.address, coin.own]);

  // live quote (debounced)
  useEffect(() => {
    if (!tradable) { setQuote(null); return; }
    const n = ++seq.current;
    const t = setTimeout(async () => {
      try {
        const token = coin.address as Address;
        if (side === "buy") {
          const raw = usd <= 0 ? 0n : inPool ? await quotePool(coin.chainId, token, true, toUsdc(usd)) : await quoteBuy(coin.chainId, curve as Address, toUsdc(usd));
          if (n === seq.current) setQuote(fromCoin(raw));
        } else {
          const raw = sellAmount <= 0n ? 0n : inPool ? await quotePool(coin.chainId, token, false, sellAmount) : await quoteSell(coin.chainId, curve as Address, sellAmount);
          if (n === seq.current) setQuote(Math.max(0, fromUsdc(raw) - fromUsdc(FEE)));
        }
      } catch { if (n === seq.current) setQuote(null); }
    }, 200);
    return () => clearTimeout(t);
  }, [side, usd, sellAmount, tradable, inPool, curve, coin.chainId, coin.address, coin.mcNum]);

  const go = async () => {
    if (!tradable) return;
    if (!w.signedIn || !w.signer) { w.login(); return; }
    if (mode !== "Market") { openSoon(); return; }
    setBusy(true);
    try {
      if (side === "buy") {
        if (usd <= 0) throw new TradeError("Enter an amount.");
        setStep("Buying…");
        const t = inPool ? await poolBuy(coin.chainId, coin.address as Address, toUsdc(usd), w.signer) : await buy(coin.chainId, curve as Address, coin.address as Address, toUsdc(usd), w.signer);
        toast(`Bought ${fmtCoins(t?.coins ?? 0)} ${coin.tick}`);
      } else {
        if (sellAmount <= 0n) throw new TradeError("You don't hold this coin yet.");
        setStep("Selling…");
        const t = inPool ? await poolSell(coin.chainId, coin.address as Address, sellAmount, w.signer) : await sell(coin.chainId, curve as Address, coin.address as Address, sellAmount, w.signer);
        toast(`Sold for $${((t?.usdc ?? 0) - fromUsdc(FEE)).toFixed(2)}`);
      }
      await w.refresh();
    } catch (e) {
      toast(e instanceof TradeError ? e.message : "Something went wrong. Please try again.");
    } finally {
      setBusy(false); setStep("");
    }
  };

  const modes = withLimit ? ["Market", "Limit", "Auto"] : ["Market", "Auto"];
  const label = !coin.own ? "Opens at launch" : phase === 1 ? "Graduating…" : !w.signedIn ? "Log in to trade" : busy ? step : `${side === "buy" ? "Buy" : "Sell"} ${coin.tick}`;
  return (
    <div className="card" style={{ borderRadius: 22, borderColor: "var(--line2)", gap: 14 }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, padding: 4, borderRadius: 14, background: "var(--bg)" }}>
        <button type="button" onClick={() => setSide("buy")} style={{ height: 42, borderRadius: 11, border: 0, fontWeight: 800, fontSize: 15, background: side === "buy" ? "var(--up)" : "transparent", color: side === "buy" ? "#04130C" : "var(--muted)" }}>Buy</button>
        <button type="button" onClick={() => setSide("sell")} style={{ height: 42, borderRadius: 11, border: 0, fontWeight: 800, fontSize: 15, background: side === "sell" ? "var(--down)" : "transparent", color: side === "sell" ? "#1A0505" : "var(--muted)" }}>Sell</button>
      </div>
      <div style={{ display: "flex", gap: 16, fontSize: 13, fontWeight: 600 }}>
        {modes.map((m) => <button key={m} type="button" onClick={() => setMode(m)} style={{ background: "none", border: 0, padding: "0 0 6px", color: mode === m ? "var(--text)" : "var(--dim)", borderBottom: mode === m ? "2px solid var(--volt)" : "2px solid transparent" }}>{m}{m !== "Market" && <span className="dim" style={{ fontSize: 10, marginLeft: 4 }}>soon</span>}</button>)}
      </div>
      {side === "buy" ? (
        <>
          <label htmlFor={`amt-${coin.id}`} style={{ fontSize: 13, display: "flex", justifyContent: "space-between" }} className="dim"><span>Amount</span><span>Cash <b className="mono" style={{ color: "var(--text)" }}>${cash.toFixed(2)}</b></span></label>
          {coin.own && w.signedIn && cash < 1 && <button type="button" className="btn volt sm" onClick={() => openFunds("deposit")}>Get free test USDC</button>}
          <div style={{ display: "flex", alignItems: "center", height: 60, padding: "0 16px", borderRadius: 14, background: "var(--bg)", border: "1px solid var(--line3)" }}>
            <span className="mono dim" style={{ fontWeight: 700, fontSize: 26 }}>$</span>
            <input id={`amt-${coin.id}`} inputMode="decimal" value={amt} onChange={(e) => setAmt(e.target.value.replace(/[^0-9.]/g, ""))} style={{ flex: 1, minWidth: 0, background: "transparent", border: 0, outline: "none", font: "700 26px var(--mono)", paddingLeft: 4 }} />
            <span className="mono dim" style={{ fontWeight: 600, fontSize: 13 }}>USDC</span>
          </div>
          <div style={{ display: "flex", gap: 6 }}>{[10, 25, 50, 100].map((v) => <button key={v} type="button" className={`seg mono${usd === v ? " on" : ""}`} style={{ height: 38, minWidth: 0 }} onClick={() => setAmt(String(v))}>${v}</button>)}</div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}><span className="dim">You get</span><span className="mono">≈ {quote === null ? "—" : `${fmtCoins(quote)} ${coin.tick}`}</span></div>
        </>
      ) : (
        <>
          <div style={{ fontSize: 13, display: "flex", justifyContent: "space-between" }} className="dim"><span>Sell</span><span>You hold <b className="mono" style={{ color: "var(--text)" }}>{fmtCoins(fromCoin(held))} {coin.tick}</b></span></div>
          <div style={{ display: "flex", gap: 6 }}>{[25, 50, 75, 100].map((v) => <button key={v} type="button" className={`seg mono${pct === v ? " on" : ""}`} style={{ height: 44, minWidth: 0 }} onClick={() => setPct(v)}>{v === 100 ? "All" : `${v}%`}</button>)}</div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}><span className="dim">Selling</span><span className="mono">{fmtCoins(fromCoin(sellAmount))} {coin.tick}</span></div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}><span className="dim">You get</span><span className="mono">≈ {quote === null ? "—" : `$${quote.toFixed(2)}`}</span></div>
        </>
      )}
      <button type="button" className={`btn lg ${side === "buy" ? "buy" : "sell"}`} onClick={go} disabled={busy || !tradable} aria-busy={busy} style={{ fontSize: 17, opacity: !tradable ? 0.55 : 1 }}>{label}</button>
      {!coin.own && <span className="dim" style={{ fontSize: 12, textAlign: "center" }}>This coin trades on another DEX. Trading here opens at launch.</span>}
      {coin.own && phase === 1 && <span className="dim" style={{ fontSize: 12, textAlign: "center" }}>Moving to its locked pool. Trading reopens in a few seconds.</span>}
      {coin.own && <span style={{ fontSize: 11, color: "var(--faint)", textAlign: "center" }}>{inPool ? "Graduated · trades in its locked pool · " : ""}Testnet · test USDC has no value</span>}
      <div style={{ display: "flex", gap: 8 }}>
        <button type="button" className="btn ghost sm" style={{ flex: 1, height: 40 }} onClick={openSoon}><IBell size={15} />Price alert</button>
        <button type="button" className="btn ghost sm" style={{ flex: 1, height: 40 }} onClick={onShare}><IShare size={15} />Share</button>
      </div>
    </div>
  );
}
