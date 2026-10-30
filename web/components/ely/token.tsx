"use client";
// Token page (/t/?a=0x…): any Elysium token, from any launchpad. Chart, buy/sell, trades, holders.
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import type { Address } from "viem";
import { useWallet } from "@/components/wallet";
import { TokenAvatar } from "./shell";
import { useT } from "@/lib/i18n";
import { EChart } from "./chart";
import { Burst, Confetti } from "@/components/celebrate";
import { ago, compact, fetchHolders, fetchHypeUsd, fetchToken, fetchTrades, money, pct, short, tinyPrice, usePoll, type EToken } from "@/lib/ely";
import { ELY_EXPLORER, ROUTER, buy, canTrade, fromWei, hypeBalance, quote, sell, toWei, tokenBalance, TradeFail } from "@/lib/elytrade";

const GAS_KEEP = 2_000_000_000_000_000n; // 0.002 HYPE stays for gas on "Max"
const supplyOf = (t: EToken) => Number(BigInt(t.supply || "0")) / 10 ** (t.decimals ?? 18);
const upDown = (v: number | null | undefined) => ((v ?? 0) >= 0 ? "up" : "down");
const amt = (n: number) => (n >= 1e9 ? `${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : n.toLocaleString("en-US", { maximumFractionDigits: n < 1 ? 6 : 2 }));

function Copy({ text, label }: { text: string; label?: string }) {
  const [ok, setOk] = useState(false);
  return (
    <button type="button" className="e-copy" onClick={() => { navigator.clipboard?.writeText(text).then(() => { setOk(true); setTimeout(() => setOk(false), 1400); }).catch(() => {}); }} aria-label={`Copy ${label ?? text}`}>
      <span className="num">{label ?? short(text)}</span>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">{ok ? <path d="m5 12 5 5 9-10" /> : <><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h8" /></>}</svg>
    </button>
  );
}

function TradeBox({ t, usd, side: side0 = "buy", onDone }: { t: EToken; usd: number; side?: "buy" | "sell"; onDone?: () => void }) {
  const tr = useT();
  const w = useWallet();
  const [side, setSide] = useState<"buy" | "sell">(side0);
  const [val, setVal] = useState("");
  const [slip, setSlip] = useState(5);
  const [out, setOut] = useState<bigint | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => setSide(side0), [side0]);
  const dec = t.decimals ?? 18;
  const addr = w.address as Address | null;
  const hype = usePoll(async () => (addr ? hypeBalance(addr) : null), 6000, [addr, tick]);
  const bal = usePoll(async () => (addr ? tokenBalance(t.address as Address, addr) : null), 6000, [addr, t.address, tick]);
  const inWei = toWei(val, side === "buy" ? 18 : dec);
  const tradable = canTrade(t);

  useEffect(() => {
    setOut(null);
    if (!tradable || inWei <= 0n) return;
    let live = true;
    const id = setTimeout(async () => { const q = await quote(t, side === "buy", inWei); if (live) setOut(q); }, 250);
    return () => { live = false; clearTimeout(id); };
  }, [inWei, side, t, tradable]);

  const price = t.price_hype ?? 0;
  const estOut = out !== null ? fromWei(out, side === "buy" ? dec : 18) : price > 0 && inWei > 0n ? (side === "buy" ? fromWei(inWei) / price : fromWei(inWei, dec) * price) : 0;
  const inUsd = side === "buy" ? fromWei(inWei) * usd : fromWei(inWei, dec) * price * usd;
  const sym = t.symbol;
  const short1 = side === "buy" ? hype != null && inWei > hype : bal != null && inWei > bal;

  const quick = side === "buy"
    ? [{ l: "0.1", v: "0.1" }, { l: "0.5", v: "0.5" }, { l: "1", v: "1" }, { l: tr("Max"), v: hype != null ? String(Math.max(0, fromWei(hype > GAS_KEEP ? hype - GAS_KEEP : 0n))) : "" }]
    : [25, 50, 75, 100].map((p) => ({ l: `${p}%`, v: bal != null ? String(fromWei((bal * BigInt(p)) / 100n, dec)) : "" }));

  async function go() {
    if (!w.signedIn || !w.signer) return w.login();
    setMsg(null);
    try {
      const q = out ?? (await quote(t, side === "buy", inWei));
      if (q === null) throw new TradeFail("This token can't be traded here right now.");
      const min = (q * BigInt(100 - slip)) / 100n;
      if (side === "buy") { setBusy(tr("Buying…")); await buy(w.signer, t, inWei, min); }
      else { setBusy(tr("Selling…")); await sell(w.signer, t, inWei, min, (x) => setBusy(tr(x))); }
      setMsg({ ok: true, text: side === "buy" ? tr("Bought {n} {sym}", { n: amt(fromWei(q, dec)), sym }) : tr("Sold for {n} HYPE", { n: fromWei(q).toFixed(4) }) });
      setVal("");
      setTick((x) => x + 1);
      onDone?.();
    } catch (e) {
      setMsg({ ok: false, text: tr(e instanceof TradeFail ? e.message : "Trade failed. Please try again.") });
    } finally {
      setBusy(null);
    }
  }

  let label = tr(side === "buy" ? "Buy {sym}" : "Sell {sym}", { sym });
  let disabled = !!busy;
  if (!w.signedIn) label = tr("Log in to trade");
  else if (!ROUTER) { label = tr("Trading opens soon"); disabled = true; }
  else if (!tradable) { label = tr("Not tradable here yet"); disabled = true; }
  else if (inWei <= 0n) { label = tr("Enter an amount"); disabled = true; }
  else if (short1) { label = tr(side === "buy" ? "Not enough HYPE" : "Not enough {sym}", { sym }); disabled = true; }
  if (busy) label = busy;

  return (
    <div className="e-trade">
      <div className="e-bs">
        <button type="button" className={side === "buy" ? "on buy" : ""} onClick={() => { setSide("buy"); setVal(""); }}>{tr("Buy")}</button>
        <button type="button" className={side === "sell" ? "on sell" : ""} onClick={() => { setSide("sell"); setVal(""); }}>{tr("Sell")}</button>
      </div>
      <label className="e-amt">
        <span className="e-amt-top"><span>{tr(side === "buy" ? "You pay" : "You sell")}</span><span className="dim">{tr("Balance")} {side === "buy" ? (hype != null ? `${fromWei(hype).toFixed(4)} HYPE` : "—") : bal != null ? `${amt(fromWei(bal, dec))} ${sym}` : "—"}</span></span>
        <span className="e-amt-row">
          <input inputMode="decimal" placeholder="0" value={val} onChange={(e) => setVal(e.target.value.replace(/[^0-9.,]/g, ""))} aria-label="Amount" autoComplete="off" />
          <b>{side === "buy" ? "HYPE" : sym}</b>
        </span>
        <span className="dim num" style={{ fontSize: 12.5 }}>≈ {money(inUsd)}</span>
      </label>
      <div className="e-quick">{quick.map((q) => <button key={q.l} type="button" onClick={() => q.v && setVal(q.v.slice(0, 18))} disabled={!q.v}>{q.l}</button>)}</div>
      <div className="e-recv">
        <span className="muted">{tr("You get")}</span>
        <b className="num">{estOut > 0 ? `≈ ${amt(estOut)} ${side === "buy" ? sym : "HYPE"}` : "—"}</b>
      </div>
      <div className="e-slip">
        <span className="dim">{tr("Slippage")}</span>
        <div className="e-seg">{[1, 3, 5, 10].map((s) => <button key={s} type="button" className={slip === s ? "on" : ""} onClick={() => setSlip(s)}>{s}%</button>)}</div>
      </div>
      <button type="button" className={`e-go ${side}`} disabled={disabled && w.signedIn} onClick={go}>{label}</button>
      {msg && <div className={`e-msg ${msg.ok ? "ok" : "bad"}`} role="status">{msg.text}</div>}
      {w.signedIn && hype === 0n && side === "buy" && <Link href="/bridge/" className="e-hint">{tr("No HYPE on Elysium yet.")} <b>{tr("Add HYPE or USDC →")}</b></Link>}
    </div>
  );
}

function Trades({ t, usd }: { t: EToken; usd: number }) {
  const tr = useT();
  const trades = usePoll(() => fetchTrades(t.address, 60), 5000, [t.address]);
  if (!trades) return <div style={{ padding: 14, display: "grid", gap: 8 }}>{Array.from({ length: 6 }, (_, i) => <div key={i} className="e-skel" style={{ height: 40 }} />)}</div>;
  if (!trades.length) return <div className="e-empty">{tr("No trades yet.")}</div>;
  return (
    <div className="e-rows">
      <div className="e-row e-tr h"><span>{tr("Time")}</span><span>{tr("Type")}</span><span className="r">USD</span><span className="r e-hide-m">HYPE</span><span className="r">{t.symbol}</span><span className="r e-hide-m">{tr("Trader")}</span></div>
      {trades.map((x) => {
        const href = ELY_EXPLORER ? `${ELY_EXPLORER}/tx/${x.tx}` : undefined;
        const Cell = href ? "a" : "div";
        return (
          <Cell key={`${x.tx}-${x.log_index}`} className="e-row e-tr" {...(href ? { href, target: "_blank", rel: "noopener noreferrer" } : {})}>
            <span className="dim">{ago(x.at)}</span>
            <span className={x.side === "buy" ? "up" : "down"} style={{ fontWeight: 700 }}>{tr(x.side === "buy" ? "Buy" : "Sell")}</span>
            <span className={`r num ${x.side === "buy" ? "up" : "down"}`}>{money(x.hype * usd)}</span>
            <span className="r num e-hide-m">{x.hype.toFixed(x.hype < 1 ? 4 : 2)}</span>
            <span className="r num">{amt(x.amount)}</span>
            <span className="r num dim e-hide-m">{short(x.trader)}</span>
          </Cell>
        );
      })}
    </div>
  );
}

function Holders({ t }: { t: EToken }) {
  const tr = useT();
  const rows = usePoll(() => fetchHolders(t.address, 30), 20000, [t.address]);
  const sup = supplyOf(t) || 1;
  if (!rows) return <div style={{ padding: 14, display: "grid", gap: 8 }}>{Array.from({ length: 6 }, (_, i) => <div key={i} className="e-skel" style={{ height: 36 }} />)}</div>;
  if (!rows.length) return <div className="e-empty">{tr("Holder list is loading. Check back in a minute.")}</div>;
  const isPool = (h: string) => h === (t.pool || "").toLowerCase() || h === (t.manager || "").toLowerCase();
  return (
    <div className="e-rows">
      {rows.map((h, i) => {
        const p = (Number(h.amount) / 10 ** (t.decimals ?? 18) / sup) * 100;
        return (
          <div key={h.holder} className="e-row e-hr">
            <span className="dim num">{i + 1}</span>
            <span className="num">{short(h.holder)} {isPool(h.holder) && <span className="e-lock">{tr("Pool")}</span>}{h.holder === (t.creator || "").toLowerCase() && <span className="e-lock">{tr("Creator")}</span>}</span>
            <span className="e-hbar"><i style={{ width: `${Math.min(100, p)}%` }} /></span>
            <span className="r num">{p.toFixed(2)}%</span>
          </div>
        );
      })}
    </div>
  );
}

function About({ t }: { t: EToken }) {
  const tr = useT();
  return (
    <div className="e-about">
      {t.description && <p>{t.description}</p>}
      <dl>
        <div><dt>{tr("Contract")}</dt><dd><Copy text={t.address} /></dd></div>
        <div><dt>{tr("Creator")}</dt><dd>{t.creator ? <Copy text={t.creator} /> : "—"}</dd></div>
        <div><dt>{tr("Pool")}</dt><dd>{t.venue === "v4" ? "Uniswap v4" : "Uniswap v3"} · {tr("{n}% fee", { n: (t.fee ?? 0) / 10000 })}</dd></div>
        <div><dt>{tr("Supply")}</dt><dd className="num">{compact(supplyOf(t))}</dd></div>
        <div><dt>{tr("Created")}</dt><dd>{t.created_at ? `${new Date(t.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })} · ${tr("{age} ago", { age: ago(t.created_at) })}` : "—"}</dd></div>
      </dl>
    </div>
  );
}

export function TokenPage() {
  const tr = useT();
  const params = useSearchParams();
  const a = (params.get("a") || "").toLowerCase();
  const valid = /^0x[0-9a-f]{40}$/.test(a);
  const t = usePoll(async () => (valid ? fetchToken(a) : null), 10_000, [a]);
  const usd = usePoll(fetchHypeUsd, 30_000) ?? 0;
  const trades = usePoll(async () => (valid ? fetchTrades(a, 1500) : []), 8000, [a]);
  const [tab, setTab] = useState<"trades" | "holders" | "about">("trades");
  const [sheet, setSheet] = useState<"buy" | "sell" | null>(null);
  const [fresh, setFresh] = useState(params.get("new") === "1");

  useEffect(() => { if (t) document.title = `${t.symbol} · ${money((t.mcap_hype ?? 0) * usd)} · ArkhamPad`; }, [t, usd]);
  useEffect(() => {
    if (!sheet) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [sheet]);

  const stats = useMemo(() => {
    if (!t) return [];
    return [
            { l: tr("Price"), v: tinyPrice((t.price_hype ?? 0) * usd) },
      { l: tr("24h volume"), v: money((t.vol24_hype || 0) * usd) },
      { l: tr("Holders"), v: compact(t.holders || 0) },
      { l: tr("Top 10"), v: t.top10_pct == null ? "—" : `${Math.min(100, t.top10_pct).toFixed(0)}%` },
      { l: tr("24h txns"), v: `${t.buys24 + t.sells24}` },
      { l: tr("Age"), v: ago(t.created_at) },
    ];
  }, [t, usd, tr]);

  if (!valid || t === null) {
    return (
      <main className="e-in e-page">
        <div className="e-panel e-empty" style={{ padding: "60px 20px" }}>
          <h2 style={{ margin: "0 0 8px", color: "var(--e-text)" }}>{tr("Token not found")}</h2>
          <p style={{ margin: "0 0 18px" }}>{tr(valid ? "We haven't seen this token on Elysium yet. New tokens show up within a minute." : "That doesn't look like a token address.")}</p>
          <Link href="/" className="e-btn pri">{tr("Back to Discover")}</Link>
        </div>
      </main>
    );
  }
  if (!t) {
    return (
      <main className="e-in e-page">
        <div className="e-skel" style={{ height: 70 }} />
        <div className="e-skel" style={{ height: 420 }} />
      </main>
    );
  }

  const shareText = `$${t.symbol} on Elysium, ${money((t.mcap_hype ?? 0) * usd)} market cap. Trading it on @Arkhampad`;
  const shareUrl = `https://arkhampad.com/t/?a=${t.address}`;

  return (
    <main className="e-in e-page e-tokpage">
      <div className="e-tgrid">
        <div className="e-tmain">
          <section className="e-thead">
            <TokenAvatar t={t} size={56} />
            <div className="e-tname">
              <h1>{t.name} <span>{t.symbol}</span></h1>
              <div className="e-tmeta">
                <span className="e-chipnet">Elysium</span>
                {t.ours && <span className="e-lock">{tr("LP locked")}</span>}
                <Copy text={t.address} />
              </div>
            </div>
            <div className="e-tprice">
              <b className="num">{money((t.mcap_hype ?? 0) * usd)}</b>
              <span className={`e-pill ${upDown(t.change24)}`}>{pct(t.change24)} {tr("24h")}</span>
            </div>
            <a className="e-btn e-icon e-share" href={`https://x.com/intent/post?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(shareUrl)}`} target="_blank" rel="noopener noreferrer" aria-label="Share on X" title="Share on X">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M17.8 3h3.1l-6.8 7.7L22 21h-6.2l-4.9-6.3L5.3 21H2.2l7.3-8.3L2 3h6.4l4.4 5.8L17.8 3Zm-1.1 16.2h1.7L7.4 4.7H5.6l11.1 14.5Z" /></svg>
            </a>
          </section>

          <section className="e-tstats">
            {stats.map((s) => <div key={s.l}><span>{s.l}</span><b className="num">{s.v}</b></div>)}
          </section>

          <section className="e-panel"><EChart trades={trades} usd={usd} supply={supplyOf(t)} height={420} /></section>

          <section className="e-panel">
            <div className="e-bar" style={{ flexDirection: "row" }}>
              <div className="e-tabs" role="tablist">
                {(["trades", "holders", "about"] as const).map((k) => <button key={k} type="button" role="tab" aria-selected={tab === k} className={`e-tab ${tab === k ? "on" : ""}`} onClick={() => setTab(k)}>{k === "trades" ? tr("Trades") : k === "holders" ? `${tr("Holders")} ${t.holders ? compact(t.holders) : ""}` : tr("About")}</button>)}
              </div>
            </div>
            {tab === "trades" && <Trades t={t} usd={usd} />}
            {tab === "holders" && <Holders t={t} />}
            {tab === "about" && <About t={t} />}
          </section>
        </div>

        <aside className="e-tside">
          <div className="e-panel"><TradeBox t={t} usd={usd} /></div>
        </aside>
      </div>

      <div className="e-mbar">
        <button type="button" className="e-go buy" onClick={() => setSheet("buy")}>{tr("Buy")}</button>
        <button type="button" className="e-go sell" onClick={() => setSheet("sell")}>{tr("Sell")}</button>
      </div>
      {fresh && (
        <div className="e-sheet e-center" role="dialog" aria-modal="true" aria-label="Your coin is live" onClick={(e) => { if (e.target === e.currentTarget) setFresh(false); }}>
          <Burst />
          <Confetti />
          <Confetti />
          <div className="e-sheet-in e-live-card">
            <span className="e-live-ring"><TokenAvatar t={t} size={92} /></span>
            <span className="e-eyebrow"><i className="e-dot" />{tr("Live on Elysium")}</span>
            <h2>{t.name} <span className="dim">${t.symbol}</span></h2>
            <p className="muted">{tr("Your coin is trading now. Share it while it's fresh: the first hour decides most launches. You earn 30% of the fees on every trade.")}</p>
            <div className="e-ca">
              <span className="dim">CA</span>
              <code className="num">{t.address}</code>
              <Copy text={t.address} label={tr("Copy CA")} />
            </div>
            <a className="e-go" style={{ display: "grid", placeItems: "center", textDecoration: "none" }} href={`https://x.com/intent/post?text=${encodeURIComponent(`I just launched $${t.symbol} on Elysium. Liquidity locked forever, trading live now on @Arkhampad\n\nCA: ${t.address}`)}&url=${encodeURIComponent(shareUrl)}`} target="_blank" rel="noopener noreferrer">{tr("Share on X")}</a>
            <div className="e-cta-btns" style={{ justifyContent: "center" }}>
              <Copy text={`$${t.symbol} is live on Elysium\nCA: ${t.address}\n${shareUrl}`} label={tr("Copy for Telegram")} />
              <button type="button" className="e-copy" onClick={() => { setFresh(false); history.replaceState(null, "", `/t/?a=${t.address}`); }}>{tr("Go to my coin")}</button>
            </div>
          </div>
        </div>
      )}
      {sheet && (
        <div className="e-sheet" role="dialog" aria-modal="true" aria-label={`${sheet === "buy" ? "Buy" : "Sell"} ${t.symbol}`} onClick={(e) => { if (e.target === e.currentTarget) setSheet(null); }}>
          <div className="e-sheet-in">
            <div className="e-sheet-h"><span className="e-grab" /><button type="button" className="e-btn e-icon" onClick={() => setSheet(null)} aria-label="Close">✕</button></div>
            <TradeBox t={t} usd={usd} side={sheet} />
          </div>
        </div>
      )}
    </main>
  );
}
