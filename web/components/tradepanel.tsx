"use client";
// Real buy/sell on ArkhamPad coins (testnet): one tap, no wallet pop-ups, gas paid in USDC.
import { useEffect, useRef, useState } from "react";
import type { Address } from "viem";
import { IBell, IShare } from "./icons";
import { useApp } from "./shell";
import { useWallet } from "./wallet";
import { FEE, buy, fromCoin, fromUsdc, onLocalTrade, placeOrder, poolBuy, poolSell, quoteBuy, quotePool, quoteSell, sell, tokenBalance, toUsdc, TradeError, type OrderKind } from "@/lib/chain";
import { refreshOrders } from "./orders";
import { ProfitSheet } from "./profit";
import { positionPnl } from "@/lib/pnl";
import type { Pnl } from "@/lib/share";
import { extBalance, extNet, extQuote, extTrade, extTradable } from "@/lib/ext";
import { PriceAlertButton } from "./alerts";
import { BuyWarning, useBuyWarning } from "./safety";
import { usd as fmtUsd } from "@/lib/live";
import type { LiveCoin } from "@/lib/live";

const fmtCoins = (t: number) => (!Number.isFinite(t) || t <= 0 ? "0" : t >= 1e9 ? (t / 1e9).toFixed(2) + "B" : t >= 1e6 ? (t / 1e6).toFixed(2) + "M" : t >= 1e3 ? (t / 1e3).toFixed(1) + "K" : t.toFixed(t < 1 ? 4 : 2));

export function TradePanel({ coin, withLimit = false, onShare, initialSide = "buy" }: { coin: LiveCoin; withLimit?: boolean; onShare?: () => void; initialSide?: "buy" | "sell" }) {
  const { toast, openFunds } = useApp(); void withLimit;
  const caution = useBuyWarning(coin);
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
  const [trig, setTrig] = useState(""); // market cap for Limit
  const [tp, setTp] = useState<number | null>(100); // Auto: take profit at +X%
  const [sl, setSl] = useState<number | null>(25); // Auto: stop loss at -Y%
  const phase = coin.phase ?? 0;
  const inPool = coin.own && phase === 2; // graduated: trades in its locked Uniswap pool
  const ext = !coin.own && !!extNet(coin.chainId); // coin from another DEX on a network we can quote
  const extLive = ext && extTradable(coin.chainId); // ...and trade (mainnet)
  const tradable = ext ? extLive : coin.own && (phase === 0 ? !!coin.curve : phase === 2);
  const [extDec, setExtDec] = useState(18);
  const [result, setResult] = useState<Pnl | null>(null);
  const curve = coin.curve as Address | undefined;
  const cash = fromUsdc(w.usdc[coin.chainId] ?? 0n);
  const usd = Number(amt) || 0;
  const sellAmount = (held * BigInt(pct)) / 100n;

  // what this wallet holds of the coin (refreshed after every trade)
  useEffect(() => {
    if (!w.address || (!coin.own && !ext)) { setHeld(0n); return; }
    let alive = true;
    const load = () => (ext ? extBalance(coin.chainId, coin.address as Address, w.address as Address) : tokenBalance(coin.chainId, coin.address as Address, w.address as Address)).then((b) => alive && setHeld(b)).catch(() => {});
    load();
    const off = onLocalTrade((t) => { if (t.coin.toLowerCase() === coin.address.toLowerCase()) load(); });
    return () => { alive = false; off(); };
  }, [w.address, coin.chainId, coin.address, coin.own, ext]);

  // live quote (debounced)
  useEffect(() => {
    if (!tradable && !ext) { setQuote(null); return; }
    const n = ++seq.current;
    const t = setTimeout(async () => {
      try {
        const token = coin.address as Address;
        if (ext) {
          if (side === "buy") { const raw = usd <= 0 ? 0n : await extQuote(coin.chainId, token, "buy", toUsdc(usd)); if (n === seq.current) setQuote(Number(raw) / 10 ** extDec); }
          else { const raw = sellAmount <= 0n ? 0n : await extQuote(coin.chainId, token, "sell", sellAmount); if (n === seq.current) setQuote(Number(raw) / 1e6); }
          return;
        }
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
  }, [side, usd, sellAmount, tradable, ext, extDec, inPool, curve, coin.chainId, coin.address, coin.mcNum]);
  // coins from other DEXs: real decimals for quotes
  useEffect(() => {
    if (!ext) return;
    const n = extNet(coin.chainId);
    if (!n) return;
    import("viem").then(({ createPublicClient, http, parseAbi }) => createPublicClient({ transport: http(n.rpc) }).readContract({ address: coin.address as Address, abi: parseAbi(["function decimals() view returns (uint8)"]), functionName: "decimals" })).then((d) => setExtDec(Number(d))).catch(() => {});
  }, [ext, coin.chainId, coin.address]);

  const go = async () => {
    if (!tradable) return;
    if (!w.signedIn || !w.signer) { w.login(); return; }
    setBusy(true);
    if (ext) {
      try {
        setStep(side === "buy" ? "Buying…" : "Selling…");
        if (side === "buy") { if (usd <= 0) throw new TradeError("Enter an amount."); await extTrade(coin.chainId, coin.address as Address, "buy", toUsdc(usd), w.signer); toast(`Bought ${coin.tick}`); }
        else { if (sellAmount <= 0n) throw new TradeError("You don't hold this coin."); await extTrade(coin.chainId, coin.address as Address, "sell", sellAmount, w.signer); toast(`Sold ${coin.tick}`); }
        await w.refresh();
      } catch (e) { toast(e instanceof TradeError ? e.message : "Couldn't trade. Please try again."); }
      finally { setBusy(false); setStep(""); }
      return;
    }
    if (mode !== "Market") {
      try {
        const base = { chainId: coin.chainId, coin: coin.address as Address, curve: (curve ?? null) as Address | null, pool: inPool };
        const mcNow = coin.mcNum ?? 0;
        if (mode === "Limit") {
          const t = Number(trig.replace(/[^0-9.]/g, ""));
          if (!(t > 0)) throw new TradeError("Enter a market cap.");
          if (side === "buy") {
            if (usd <= 0) throw new TradeError("Enter an amount.");
            if (t >= mcNow) throw new TradeError("For a limit buy, pick a market cap below the current one.");
            setStep("Placing…");
            await placeOrder({ ...base, kind: "limit_buy", triggerMc: t, amount: toUsdc(usd) }, w.signer);
            toast(`Limit buy set: $${usd} when MC hits ${fmtUsd(t)}`);
          } else {
            if (sellAmount <= 0n) throw new TradeError("You don't hold this coin yet.");
            if (t <= mcNow) throw new TradeError("For a limit sell, pick a market cap above the current one.");
            setStep("Placing…");
            await placeOrder({ ...base, kind: "take_profit", triggerMc: t, amount: sellAmount }, w.signer);
            toast(`Limit sell set at ${fmtUsd(t)} MC`);
          }
        } else {
          if (sellAmount <= 0n) throw new TradeError("Buy the coin first, then set take profit / stop loss.");
          if (tp === null && sl === null) throw new TradeError("Pick a take profit or a stop loss.");
          setStep("Placing…");
          const made: string[] = [];
          const each: { kind: OrderKind; mc: number }[] = [];
          if (tp !== null) each.push({ kind: "take_profit", mc: mcNow * (1 + tp / 100) });
          if (sl !== null) each.push({ kind: "stop_loss", mc: mcNow * (1 - sl / 100) });
          for (const o of each) { await placeOrder({ ...base, kind: o.kind, triggerMc: o.mc, amount: sellAmount }, w.signer); made.push(o.kind === "take_profit" ? `TP ${fmtUsd(o.mc)}` : `SL ${fmtUsd(o.mc)}`); }
          toast(`Auto orders set: ${made.join(" · ")}`);
        }
        refreshOrders();
      } catch (e) {
        toast(e instanceof TradeError ? e.message : "Couldn't place the order. Please try again.");
      } finally { setBusy(false); setStep(""); }
      return;
    }
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
        const who = w.address;
        setTimeout(async () => {
          if (!who) return;
          const r = await positionPnl(coin.chainId, coin.address, who, { name: coin.name, tick: coin.tick, chain: coin.chain, image: coin.image, c1: coin.c1, c2: coin.c2, mcNow: coin.mcNum ?? 0 }).catch(() => null);
          if (r && r.pct >= 5) setResult(r);
        }, 3000);
        toast(`Sold for $${((t?.usdc ?? 0) - fromUsdc(FEE)).toFixed(2)}`);
      }
      await w.refresh();
    } catch (e) {
      toast(e instanceof TradeError ? e.message : "Something went wrong. Please try again.");
    } finally {
      setBusy(false); setStep("");
    }
  };

  const modes = ["Market", "Limit", "Auto"];
  const label = ext && !extLive ? "Opens on mainnet" : !coin.own && !ext ? "Opens on mainnet" : phase === 1 ? "Graduating…" : !w.signedIn ? "Log in to trade" : busy ? step
    : mode === "Limit" ? `Set limit ${side === "buy" ? "buy" : "sell"}` : mode === "Auto" ? "Set take profit / stop loss" : `${side === "buy" ? "Buy" : "Sell"} ${coin.tick}`;
  return (
    <div className="card" style={{ borderRadius: 22, borderColor: "var(--line2)", gap: 14 }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, padding: 4, borderRadius: 14, background: "var(--bg)" }}>
        <button type="button" onClick={() => { setSide("buy"); if (mode === "Auto") setMode("Market"); }} style={{ height: 42, borderRadius: 11, border: 0, fontWeight: 800, fontSize: 15, background: side === "buy" ? "var(--up)" : "transparent", color: side === "buy" ? "#04130C" : "var(--muted)" }}>Buy</button>
        <button type="button" onClick={() => setSide("sell")} style={{ height: 42, borderRadius: 11, border: 0, fontWeight: 800, fontSize: 15, background: side === "sell" ? "var(--down)" : "transparent", color: side === "sell" ? "#1A0505" : "var(--muted)" }}>Sell</button>
      </div>
      <div style={{ display: "flex", gap: 16, fontSize: 13, fontWeight: 600 }}>
        {modes.map((m) => <button key={m} type="button" onClick={() => { setMode(m); if (m === "Auto") setSide("sell"); if (m === "Limit" && !trig && coin.mcNum) setTrig(String(Math.round(coin.mcNum * (side === "buy" ? 0.8 : 1.5)))); }} style={{ background: "none", border: 0, padding: "0 0 6px", color: mode === m ? "var(--text)" : "var(--dim)", borderBottom: mode === m ? "2px solid var(--volt)" : "2px solid transparent" }}>{m}</button>)}
      </div>
      {mode === "Limit" && (
        <div className="field">
          <label htmlFor={`trig-${coin.id}`}>{side === "buy" ? "Buy when market cap drops to" : "Sell when market cap reaches"} <span className="dim">(now {coin.mc})</span></label>
          <div style={{ display: "flex", alignItems: "center", height: 48, padding: "0 14px", borderRadius: 12, background: "var(--bg)", border: "1px solid var(--line3)" }}>
            <span className="mono dim" style={{ fontWeight: 700 }}>$</span>
            <input id={`trig-${coin.id}`} inputMode="decimal" value={trig} onChange={(e) => setTrig(e.target.value.replace(/[^0-9.]/g, ""))} style={{ flex: 1, minWidth: 0, background: "transparent", border: 0, outline: "none", font: "700 18px var(--mono)", paddingLeft: 4 }} />
          </div>
          <div style={{ display: "flex", gap: 6 }}>{(side === "buy" ? [-20, -35, -50] : [50, 100, 200]).map((d) => <button key={d} type="button" className="seg mono" style={{ height: 32, minWidth: 0 }} onClick={() => setTrig(String(Math.round((coin.mcNum ?? 0) * (1 + d / 100))))}>{d > 0 ? `+${d}%` : `${d}%`}</button>)}</div>
        </div>
      )}
      {mode === "Auto" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <span className="dim" style={{ fontSize: 13 }}>Take profit</span>
          <div style={{ display: "flex", gap: 6 }}>{[25, 50, 100, 200].map((v) => <button key={v} type="button" className={`seg mono${tp === v ? " on" : ""}`} style={{ height: 36, minWidth: 0 }} onClick={() => setTp(tp === v ? null : v)}>+{v}%</button>)}</div>
          <span className="dim" style={{ fontSize: 13 }}>Stop loss</span>
          <div style={{ display: "flex", gap: 6 }}>{[10, 25, 50].map((v) => <button key={v} type="button" className={`seg mono${sl === v ? " on" : ""}`} style={{ height: 36, minWidth: 0 }} onClick={() => setSl(sl === v ? null : v)}>-{v}%</button>)}</div>
          <span style={{ fontSize: 11, color: "var(--faint)" }}>Sells automatically when the price hits your level, even if you close the site.</span>
        </div>
      )}
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
      {coin.own && side === "buy" && mode !== "Auto" && caution.text && w.signedIn && tradable && <BuyWarning text={caution.text} onAck={caution.ack} />}
      {!(coin.own && side === "buy" && mode !== "Auto" && caution.text && w.signedIn && tradable) && <button type="button" className={`btn lg ${side === "buy" ? "buy" : "sell"}`} onClick={go} disabled={busy || !tradable} aria-busy={busy} style={{ fontSize: 17, opacity: !tradable ? 0.55 : 1 }}>{label}</button>}
      {!coin.own && <span className="dim" style={{ fontSize: 12, textAlign: "center" }}>{extLive ? "Trades through other DEXs at the best price · 1% fee" : ext ? "Live price from other DEXs. Trading these coins here opens on mainnet." : "This coin trades on another DEX. Trading it here opens on mainnet."}</span>}
      {coin.own && phase === 1 && <span className="dim" style={{ fontSize: 12, textAlign: "center" }}>Moving to its locked pool. Trading reopens in a few seconds.</span>}
      {coin.own && <span style={{ fontSize: 11, color: "var(--faint)", textAlign: "center" }}>{inPool ? "Graduated · trades in its locked pool · " : ""}Testnet · test USDC has no value</span>}
      <div style={{ display: "flex", gap: 8 }}>
        <span style={{ flex: 1, display: "flex" }}><PriceAlertButton c={coin} className="btn ghost sm grow" /></span>
        <button type="button" className="btn ghost sm" style={{ flex: 1, height: 40 }} onClick={onShare}><IShare size={15} />Share</button>
      </div>
      {result && <ProfitSheet p={result} onClose={() => setResult(null)} />}
    </div>
  );
}
