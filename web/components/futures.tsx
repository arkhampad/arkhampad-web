"use client";

/**
 * Futures: leverage trading on Hyperliquid in ArkhamPad's own screen. Market list, live chart,
 * order panel (long / short, leverage, amount, TP/SL), the futures balance with Add / Withdraw,
 * and the user's positions, orders and history. Trading itself is in lib/hltrade.ts.
 */
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useWallet } from "./wallet";
import { Intervals } from "./trade";
import { IDown, ISearch, IX, IAlert } from "./icons";
import { useIsMobile } from "./bits";
import {
  BUILDER_FEE,
  DEFAULT_LEV,
  HL_TAKER_FEE,
  INTERVALS,
  fetchBook,
  fetchPerpAccount,
  fetchPerpCandles,
  fetchPerpFills,
  fetchPerpMarkets,
  fetchPerpOrders,
  futuresAllowedHere,
  planOrder,
  px,
  sizeString,
  type BookLevel,
  type Interval,
  type PerpAccount,
  type PerpFill,
  type PerpMarket,
  type PerpOrder,
  type PerpPosition,
} from "@/lib/hl";
import { HL_WITHDRAW_FEE, MIN_MOVE, makeFuturesTrade } from "@/lib/hltrade";

const TvChart = dynamic(() => import("./tvchart"), { ssr: false, loading: () => <div className="skel" style={{ height: 380, borderRadius: 12 }} /> });

const usd = (v: number, d = 2) => `$${v.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d })}`;
const signedUsd = (v: number) => `${v >= 0 ? "+" : "−"}${usd(Math.abs(v))}`;
const pct = (v: number | null, d = 2) => (v === null ? "—" : `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(d)}%`);
const tone = (v: number | null) => (v === null || v === 0 ? "dim" : v > 0 ? "up" : "down");
const compact = (v: number) => (v >= 1e9 ? `$${(v / 1e9).toFixed(2)}B` : v >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `$${(v / 1e3).toFixed(1)}K` : usd(v, 0));

export function FuturesScreen() {
  const w = useWallet();
  const q = useSearchParams();
  const router = useRouter();
  const mobile = useIsMobile();
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [markets, setMarkets] = useState<PerpMarket[] | null>(null);
  const [coin, setCoin] = useState((q.get("c") || "BTC").trim());
  const [iv, setIv] = useState<Interval>("15m");
  const [candles, setCandles] = useState<{ t: number; o: number; h: number; l: number; c: number; v: number }[] | null>(null);
  const [book, setBook] = useState<{ bids: BookLevel[]; asks: BookLevel[] } | null>(null);
  const [account, setAccount] = useState<PerpAccount | null>(null);
  const [orders, setOrders] = useState<PerpOrder[]>([]);
  const [fills, setFills] = useState<PerpFill[]>([]);
  const [error, setError] = useState(false);
  const [search, setSearch] = useState("");
  const [picker, setPicker] = useState(false);
  const [funds, setFunds] = useState<"add" | "withdraw" | null>(null);
  const user = w.address ?? null;

  useEffect(() => {
    let alive = true;
    void futuresAllowedHere().then((ok) => alive && setAllowed(ok));
    return () => {
      alive = false;
    };
  }, []);

  // every market, refreshed every 5 s while the page is open
  useEffect(() => {
    let alive = true;
    const load = () => fetchPerpMarkets().then((m) => alive && (setMarkets(m), setError(false))).catch(() => alive && setError(true));
    void load();
    const t = setInterval(() => document.visibilityState === "visible" && void load(), 5_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  // chart and order book of the open market
  useEffect(() => {
    let alive = true;
    setCandles(null);
    const loadC = () => fetchPerpCandles(coin, iv).then((c) => alive && setCandles(c)).catch(() => {});
    void loadC();
    const t = setInterval(() => document.visibilityState === "visible" && void loadC(), 5_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [coin, iv]);
  useEffect(() => {
    let alive = true;
    setBook(null);
    const loadB = () => fetchBook(coin).then((b) => alive && setBook(b)).catch(() => {});
    void loadB();
    const t = setInterval(() => document.visibilityState === "visible" && void loadB(), 2_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [coin]);

  // the user's account; answers for an earlier wallet are dropped
  const userRef = useRef(user);
  userRef.current = user;
  const loadMine = useCallback(async () => {
    if (!user) return;
    const [a, o, f] = await Promise.all([fetchPerpAccount(user).catch(() => null), fetchPerpOrders(user).catch(() => null), fetchPerpFills(user).catch(() => null)]);
    if (userRef.current !== user) return;
    if (a) setAccount(a);
    if (o) setOrders(o);
    if (f) setFills(f);
  }, [user]);
  useEffect(() => {
    setAccount(null);
    setOrders([]);
    setFills([]);
    if (!user) return;
    void loadMine();
    const t = setInterval(() => document.visibilityState === "visible" && void loadMine(), 5_000);
    return () => clearInterval(t);
  }, [user, loadMine]);

  const after = useCallback(async () => {
    await loadMine();
    void w.refresh();
  }, [loadMine, w]);
  const trade = useMemo(() => makeFuturesTrade(w.signer, after), [w.signer, after]);

  const market = markets?.find((m) => m.coin === coin) ?? null;
  const pick = (c: string) => {
    setCoin(c);
    setPicker(false);
    router.replace(`/futures/?c=${encodeURIComponent(c)}`, { scroll: false });
  };
  // the coin picker is a full screen on phones: no page scroll behind it
  useEffect(() => {
    if (!picker) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [picker]);

  const list = (
    <>
      <label className="search" style={{ height: 40, flex: "none" }}>
        <ISearch size={15} color="var(--faint)" />
        <span className="sr">Search markets</span>
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search markets" />
      </label>
      <div className="tl-scroll">
        {!markets ? (
          Array.from({ length: 12 }, (_, i) => <div key={i} className="skel" style={{ height: 44, borderRadius: 10, marginBottom: 6 }} />)
        ) : (
          markets
            .filter((m) => !search.trim() || m.coin.toLowerCase().includes(search.trim().toLowerCase()))
            .slice(0, 150)
            .map((m) => (
              <button key={m.coin} type="button" onClick={() => pick(m.coin)} className={`tl-row${m.coin === coin ? " on" : ""}`} style={{ width: "100%" }}>
                <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 1 }}>
                  <span style={{ fontWeight: 700, fontSize: 13 }}>
                    {m.coin}-USD <span className="mono" style={{ fontSize: 10, color: "var(--faint)" }}>{m.maxLev}x</span>
                  </span>
                  <span className="mono" style={{ fontSize: 11, color: "var(--faint)" }}>Vol {compact(m.volume24h)}</span>
                </span>
                <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 1 }}>
                  <span className="mono" style={{ fontSize: 12, fontWeight: 600 }}>{px(m.mark)}</span>
                  <span className={`mono ${tone(m.change24h)}`} style={{ fontSize: 11, fontWeight: 700 }}>{pct(m.change24h)}</span>
                </span>
              </button>
            ))
        )}
      </div>
    </>
  );

  const stats: [string, string, string][] = market
    ? [
        ["Price", px(market.mark), ""],
        ["24h", pct(market.change24h), tone(market.change24h)],
        ["24h volume", compact(market.volume24h), ""],
        ["Open interest", compact(market.openInterestUsd), ""],
        ["Funding / 1h", `${(market.funding * 100).toFixed(4)}%`, market.funding >= 0 ? "volt" : "down"],
      ]
    : [];

  return (
    <div className="term">
      <aside className="panel term-list">{list}</aside>

      <section className="term-main">
        <button type="button" className="term-switch" onClick={() => setPicker(true)} aria-haspopup="dialog">
          <span style={{ flex: 1, minWidth: 0, textAlign: "left" }}>
            <b style={{ fontSize: 15 }}>{coin}-USD</b> <span className="mono" style={{ fontSize: 11, color: "var(--faint)" }}>· switch</span>
          </span>
          <IDown size={14} color="var(--faint)" />
          {market && <span className={`chg ${(market.change24h ?? 0) >= 0 ? "u" : "d"}`}>{pct(market.change24h, 1)}</span>}
        </button>

        {error && !markets && (
          <div className="warn-note">
            <IAlert size={16} color="var(--warn)" />
            <span>Can&apos;t reach the futures markets right now. Retrying…</span>
          </div>
        )}

        <div className="panel term-head">
          <span className="hide-m" style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
            <b style={{ fontSize: 18 }}>{coin}-USD</b>
            <span className="mono dim" style={{ fontSize: 11 }}>Futures · up to {market?.maxLev ?? "…"}x</span>
          </span>
          <span className="term-stats">
            {stats.map(([k, v, cls]) => (
              <span key={k}>
                <i>{k}</i>
                <b className={`mono ${cls}`}>{v}</b>
              </span>
            ))}
          </span>
        </div>

        <div className="panel" style={{ padding: mobile ? 8 : 12, gap: 8 }}>
          <Intervals value={iv} onChange={(v) => (INTERVALS as readonly string[]).includes(v) && setIv(v as Interval)} />
          <TvChart candles={candles} supply={null} empty="Loading the chart…" height={mobile ? 280 : 430} seriesKey={`${coin}|${iv}`} />
          <span className="dim" style={{ fontSize: 11 }}>Powered by Hyperliquid</span>
        </div>

        {mobile && <Balance account={account} signedIn={!!user} allowed={allowed} onFunds={setFunds} onLogin={w.login} />}
        {mobile && allowed !== false && (
          <OrderPanel market={market} account={account} allowed={allowed} trade={trade} onFunds={setFunds} />
        )}
        {mobile && allowed === false && (
          <div className="card" style={{ gap: 6, padding: 14 }}>
            <span style={{ fontWeight: 700, fontSize: 14 }}>Futures aren&apos;t available where you are</span>
            <span className="dim" style={{ fontSize: 13, lineHeight: 1.5 }}>Leverage trading isn&apos;t offered in your country. Charts and prices stay open to everyone.</span>
          </div>
        )}

        <Mine account={account} orders={orders} fills={fills} markets={markets} trade={trade} signedIn={!!user} onPick={pick} />
      </section>

      <aside className="term-trade">
        <Balance account={account} signedIn={!!user} allowed={allowed} onFunds={setFunds} onLogin={w.login} />
        {!mobile && allowed !== false && <OrderPanel market={market} account={account} allowed={allowed} trade={trade} onFunds={setFunds} />}
        {allowed === false && (
          <div className="card" style={{ gap: 6, padding: 14 }}>
            <span style={{ fontWeight: 700, fontSize: 14 }}>Futures aren&apos;t available where you are</span>
            <span className="dim" style={{ fontSize: 13, lineHeight: 1.5 }}>Leverage trading isn&apos;t offered in your country. Charts and prices stay open to everyone.</span>
          </div>
        )}
        <Book book={book} market={market} />
      </aside>

      {picker && (
        <div className="term-picker" role="dialog" aria-modal="true" aria-label="Switch market">
          <div className="term-picker-top">
            <b>Switch market</b>
            <button type="button" className="icon-btn" aria-label="Close" onClick={() => setPicker(false)}>
              <IX size={15} />
            </button>
          </div>
          <div className="term-picker-body">{list}</div>
        </div>
      )}
      {funds && <FundsSheet mode={funds} setMode={setFunds} account={account} cash={w.totalUsdc} trade={trade} onClose={() => setFunds(null)} />}
    </div>
  );
}

// ------------------------------------------------------------------ balance

function Balance({ account, signedIn, allowed, onFunds, onLogin }: { account: PerpAccount | null; signedIn: boolean; allowed: boolean | null; onFunds: (m: "add" | "withdraw") => void; onLogin: () => void }) {
  if (!signedIn) {
    return (
      <div className="card" style={{ gap: 10, padding: 14 }}>
        <span style={{ fontWeight: 700 }}>Trade futures with your ArkhamPad cash</span>
        <span className="dim" style={{ fontSize: 13, lineHeight: 1.5 }}>Up to 20x on BTC, ETH, SOL and hundreds more. Orders run on Hyperliquid.</span>
        <button type="button" className="btn volt" onClick={onLogin}>Sign in</button>
      </div>
    );
  }
  return (
    <div className="card" style={{ gap: 10, padding: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <span className="dim" style={{ fontSize: 12 }}>Futures balance</span>
        <b className="mono" style={{ fontSize: 18 }}>{account ? usd(account.accountValue) : "…"}</b>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
        <span className="dim">Available</span>
        <span className="mono">{account ? usd(account.withdrawable) : "…"}</span>
      </div>
      {allowed !== false && (
        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" className="btn sm volt grow" onClick={() => onFunds("add")}>Add</button>
          <button type="button" className="btn sm grow" onClick={() => onFunds("withdraw")} disabled={!account || account.withdrawable < MIN_MOVE}>Withdraw</button>
        </div>
      )}
    </div>
  );
}

function FundsSheet({ mode, setMode, account, cash, trade, onClose }: { mode: "add" | "withdraw"; setMode: (m: "add" | "withdraw") => void; account: PerpAccount | null; cash: number; trade: ReturnType<typeof makeFuturesTrade>; onClose: () => void }) {
  const [amt, setAmt] = useState("");
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && !busy && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [busy, onClose]);
  // moving from cash costs a little (Relay); keep room for it
  const max = mode === "add" ? Math.max(0, Math.floor((cash * 0.985 - 0.1) * 100) / 100) : Math.max(0, Math.floor((account?.withdrawable ?? 0) * 100) / 100);
  const v = Number(amt);
  const go = async () => {
    setMsg(null);
    if (!(v >= MIN_MOVE)) return setMsg({ ok: false, text: `The smallest amount is $${MIN_MOVE}.` });
    if (mode === "add" && cash < MIN_MOVE) return setMsg({ ok: false, text: "Your cash is under $5. Deposit USDC to your ArkhamPad account first." });
    if (v > max + 1e-9) return setMsg({ ok: false, text: `You can move up to ${usd(max)}.` });
    setBusy(true);
    try {
      if (mode === "add") {
        await trade.deposit(v, setStep);
        setMsg({ ok: true, text: `${usd(v)} added to futures.` });
      } else {
        await trade.withdraw(v, setStep);
        setMsg({ ok: true, text: `${usd(v - HL_WITHDRAW_FEE)} is on its way to your cash (a few minutes).` });
      }
      setAmt("");
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
      setStep(null);
    }
  };
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={mode === "add" ? "Add to futures" : "Withdraw from futures"}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ display: "flex", gap: 4 }}>
            {(["add", "withdraw"] as const).map((t) => (
              <button key={t} type="button" className={`tab${mode === t ? " on" : ""}`} onClick={() => !busy && (setMode(t), setMsg(null), setAmt(""))} style={{ fontSize: 15 }}>
                {t === "add" ? "Add to futures" : "Withdraw"}
              </button>
            ))}
          </div>
          <button type="button" className="icon-btn" aria-label="Close" onClick={() => !busy && onClose()} style={{ width: 40, height: 40, background: "transparent" }}>
            <IX size={15} />
          </button>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
          <span className="dim">{mode === "add" ? "Your cash" : "Available in futures"}</span>
          <b className="mono">{usd(mode === "add" ? cash : account?.withdrawable ?? 0)}</b>
        </div>
        <div className="field">
          <label htmlFor="fx-amt">Amount (USDC)</label>
          <div style={{ display: "flex", gap: 6 }}>
            <input id="fx-amt" className="inp mono" inputMode="decimal" placeholder="0.00" value={amt} onChange={(e) => setAmt(e.target.value.replace(/[^0-9.]/g, ""))} />
            <button type="button" className="btn sm" style={{ height: 46 }} onClick={() => setAmt(max.toFixed(2))}>Max</button>
          </div>
        </div>
        <span className="dim" style={{ fontSize: 12, lineHeight: 1.5 }}>
          {mode === "add"
            ? "Moves your ArkhamPad cash into your futures balance on Hyperliquid. Usually under a minute."
            : `Hyperliquid takes a $${HL_WITHDRAW_FEE} fee. The rest comes back to your ArkhamPad cash in a few minutes.`}
        </span>
        <button type="button" className="btn volt lg" disabled={busy} onClick={go}>{busy ? step ?? "Working…" : mode === "add" ? "Add to futures" : "Withdraw"}</button>
        {msg && <div role="status" style={{ fontSize: 13, fontWeight: 600, color: msg.ok ? "var(--up)" : "var(--down)", textAlign: "center" }}>{msg.text}</div>}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ order panel

function OrderPanel({ market, account, allowed, trade, onFunds }: { market: PerpMarket | null; account: PerpAccount | null; allowed: boolean | null; trade: ReturnType<typeof makeFuturesTrade>; onFunds: (m: "add" | "withdraw") => void }) {
  const w = useWallet();
  const [side, setSide] = useState<"long" | "short">("long");
  const [kind, setKind] = useState<"market" | "limit">("market");
  const [margin, setMargin] = useState("");
  const [lev, setLev] = useState(DEFAULT_LEV);
  const [limitPx, setLimitPx] = useState("");
  const [tpsl, setTpsl] = useState(false);
  const [tp, setTp] = useState("");
  const [sl, setSl] = useState("");
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => {
    if (market && lev > market.maxLev) setLev(market.maxLev);
  }, [market, lev]);
  useEffect(() => {
    setLimitPx("");
    setTp("");
    setSl("");
    setMsg(null);
  }, [market?.coin]);

  const available = account?.withdrawable ?? 0;
  const entry = kind === "limit" ? Number(limitPx) : market?.mark ?? 0;
  const plan = market ? planOrder(market, side, Number(margin), lev, available, entry > 0 ? entry : market.mark) : null;
  const long = side === "long";
  const tpN = tpsl && tp ? Number(tp) : null;
  const slN = tpsl && sl ? Number(sl) : null;

  const go = async () => {
    if (!market || !plan) return;
    setMsg(null);
    if (!w.signer) return w.login();
    if (!plan.ok) return setMsg({ ok: false, text: plan.why ?? "Check the order." });
    if (kind === "limit" && !(Number(limitPx) > 0)) return setMsg({ ok: false, text: "Enter a limit price." });
    const ref = entry > 0 ? entry : market.mark;
    if (tpN && (long ? tpN <= ref : tpN >= ref)) return setMsg({ ok: false, text: `Take profit must be ${long ? "above" : "below"} the entry price.` });
    if (slN && (long ? slN >= ref : slN <= ref)) return setMsg({ ok: false, text: `Stop loss must be ${long ? "below" : "above"} the entry price.` });
    setBusy(true);
    try {
      const r = await trade.open({ market, side, margin: Number(margin), lev, coins: plan.coins, tp: tpN, sl: slN, limitPx: kind === "limit" ? Number(limitPx) : null }, setStep);
      setMsg({ ok: true, text: r.resting ? `Limit order placed at ${px(Number(limitPx))}.` : `${long ? "Long" : "Short"} ${market.coin} opened${r.avgPx ? ` at ${px(r.avgPx)}` : ""}.` });
      setMargin("");
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
      setStep(null);
    }
  };

  return (
    <div className="card" style={{ gap: 12, padding: 14 }}>
      <div className="seg-tabs" role="group" aria-label="Long or short">
        <button type="button" className={long ? "on" : ""} onClick={() => setSide("long")} style={long ? { background: "var(--up)", color: "#04130C" } : undefined}>Long</button>
        <button type="button" className={!long ? "on" : ""} onClick={() => setSide("short")} style={!long ? { background: "var(--down)", color: "#1A0505" } : undefined}>Short</button>
      </div>
      <div style={{ display: "flex", gap: 4 }}>
        {(["market", "limit"] as const).map((k) => (
          <button key={k} type="button" className={`tab${kind === k ? " on" : ""}`} onClick={() => setKind(k)}>{k === "market" ? "Market" : "Limit"}</button>
        ))}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
        <span className="dim">Available</span>
        <span className="mono">{w.signer ? (account ? usd(available) : "…") : "—"}</span>
      </div>
      {kind === "limit" && (
        <div className="field">
          <label htmlFor="fx-limit">Limit price</label>
          <input id="fx-limit" className="inp mono" inputMode="decimal" placeholder={market ? px(market.mark) : "0"} value={limitPx} onChange={(e) => setLimitPx(e.target.value.replace(/[^0-9.]/g, ""))} />
        </div>
      )}
      <div className="field">
        <label htmlFor="fx-margin">Amount (USDC)</label>
        <input id="fx-margin" className="inp mono" inputMode="decimal" placeholder="0.00" value={margin} onChange={(e) => setMargin(e.target.value.replace(/[^0-9.]/g, ""))} />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 6 }}>
          {[0.1, 0.25, 0.5, 1].map((f) => (
            <button key={f} type="button" className="btn sm" style={{ height: 32 }} onClick={() => setMargin((Math.floor(available * f * (f === 1 ? 0.995 : 1) * 100) / 100).toFixed(2))} disabled={!available}>
              {f === 1 ? "Max" : `${f * 100}%`}
            </button>
          ))}
        </div>
      </div>
      <div className="field">
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <label htmlFor="fx-lev">Leverage</label>
          <b className="mono" style={{ fontSize: 13 }}>{lev}x</b>
        </div>
        <input id="fx-lev" type="range" min={1} max={market?.maxLev ?? 20} value={lev} onChange={(e) => setLev(Number(e.target.value))} style={{ width: "100%", accentColor: "var(--volt)" }} />
      </div>
      <label style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13 }}>
        <input type="checkbox" checked={tpsl} onChange={(e) => setTpsl(e.target.checked)} style={{ width: 18, height: 18, accentColor: "var(--volt)" }} />
        Take profit / Stop loss
      </label>
      {tpsl && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8 }}>
          <div className="field">
            <label htmlFor="fx-tp">Take profit price</label>
            <input id="fx-tp" className="inp mono" inputMode="decimal" placeholder="—" value={tp} onChange={(e) => setTp(e.target.value.replace(/[^0-9.]/g, ""))} />
          </div>
          <div className="field">
            <label htmlFor="fx-sl">Stop loss price</label>
            <input id="fx-sl" className="inp mono" inputMode="decimal" placeholder="—" value={sl} onChange={(e) => setSl(e.target.value.replace(/[^0-9.]/g, ""))} />
          </div>
        </div>
      )}
      {plan && Number(margin) > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 12, borderTop: "1px solid var(--line)", paddingTop: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between" }}><span className="dim">Position</span><span className="mono">{usd(plan.notional)} · {plan.coins} {market?.coin}</span></div>
          <div style={{ display: "flex", justifyContent: "space-between" }}><span className="dim">Liquidation price</span><span className="mono">{px(plan.liq)}</span></div>
          <div style={{ display: "flex", justifyContent: "space-between" }}><span className="dim">Fee</span><span className="mono">{usd(plan.fees)} ({((HL_TAKER_FEE + BUILDER_FEE) * 100).toFixed(3)}%)</span></div>
        </div>
      )}
      {!w.signer ? (
        <button type="button" className="btn volt lg" onClick={w.login}>Sign in to trade</button>
      ) : account && account.accountValue < 1 && !busy ? (
        <button type="button" className="btn volt lg" onClick={() => onFunds("add")}>Add money to start</button>
      ) : (
        <button type="button" className={`btn lg ${long ? "buy" : "sell"}`} disabled={busy || !market || allowed === null} onClick={go}>
          {busy ? step ?? "Working…" : `${long ? "Long" : "Short"} ${market?.coin ?? ""}`}
        </button>
      )}
      {msg && <div role="status" style={{ fontSize: 13, fontWeight: 600, color: msg.ok ? "var(--up)" : "var(--down)", textAlign: "center" }}>{msg.text}</div>}
      <span className="dim" style={{ fontSize: 11, textAlign: "center", lineHeight: 1.5 }}>Leverage can lose your whole position. Orders run on Hyperliquid.</span>
    </div>
  );
}

// ------------------------------------------------------------------ order book

function Book({ book, market }: { book: { bids: BookLevel[]; asks: BookLevel[] } | null; market: PerpMarket | null }) {
  const asks = (book?.asks ?? []).slice(0, 8).reverse();
  const bids = (book?.bids ?? []).slice(0, 8);
  const maxSz = Math.max(1e-12, ...asks.map((a) => a.sz), ...bids.map((b) => b.sz));
  const row = (l: BookLevel, up: boolean, i: number) => (
    <div key={`${up ? "b" : "a"}${i}`} className="mono" style={{ position: "relative", display: "flex", justifyContent: "space-between", padding: "3px 4px", fontSize: 12 }}>
      <span aria-hidden="true" style={{ position: "absolute", top: 0, bottom: 0, right: 0, width: `${Math.min(100, (l.sz / maxSz) * 100)}%`, background: up ? "var(--up)" : "var(--down)", opacity: 0.12, borderRadius: 3 }} />
      <span style={{ position: "relative", color: up ? "var(--up)" : "var(--down)" }}>{px(l.px)}</span>
      <span style={{ position: "relative" }}>{l.sz.toLocaleString("en-US", { maximumFractionDigits: 4 })}</span>
    </div>
  );
  const spread = book && book.asks[0] && book.bids[0] ? book.asks[0].px - book.bids[0].px : null;
  return (
    <div className="panel" style={{ padding: 12, gap: 2 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 700, fontSize: 14, marginBottom: 6 }}>
        <span>Order book</span>
        <span className="mono dim" style={{ fontSize: 11, fontWeight: 400 }}>{market?.coin ?? ""}</span>
      </div>
      {!book ? (
        <div className="skel" style={{ height: 300, borderRadius: 10 }} />
      ) : (
        <>
          {asks.map((a, i) => row(a, false, i))}
          <div className="mono" style={{ display: "flex", justifyContent: "space-between", padding: "8px 4px", fontWeight: 700 }}>
            <span>{px(market?.mark)}</span>
            <span className="dim" style={{ fontSize: 11, fontWeight: 400 }}>{spread !== null ? `spread ${px(spread)}` : ""}</span>
          </div>
          {bids.map((b, i) => row(b, true, i))}
        </>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ positions, orders, history

function Mine({ account, orders, fills, markets, trade, signedIn, onPick }: { account: PerpAccount | null; orders: PerpOrder[]; fills: PerpFill[]; markets: PerpMarket[] | null; trade: ReturnType<typeof makeFuturesTrade>; signedIn: boolean; onPick: (c: string) => void }) {
  const [tab, setTab] = useState<"positions" | "orders" | "history">("positions");
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [edit, setEdit] = useState<PerpPosition | null>(null);
  const mk = (c: string) => markets?.find((m) => m.coin === c) ?? null;
  const act = async (key: string, fn: () => Promise<void>, done: string) => {
    setBusy(key);
    setMsg(null);
    try {
      await fn();
      setMsg({ ok: true, text: done });
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy("");
    }
  };
  const positions = account?.positions ?? [];
  if (!signedIn) return null;
  return (
    <div className="panel" style={{ padding: 12, gap: 8 }}>
      <div style={{ display: "flex", gap: 4 }}>
        {(["positions", "orders", "history"] as const).map((t) => (
          <button key={t} type="button" className={`tab${tab === t ? " on" : ""}`} onClick={() => setTab(t)}>
            {t === "positions" ? `Positions (${positions.length})` : t === "orders" ? `Orders (${orders.length})` : "History"}
          </button>
        ))}
      </div>
      {msg && <div role="status" style={{ fontSize: 13, fontWeight: 600, color: msg.ok ? "var(--up)" : "var(--down)" }}>{msg.text}</div>}
      <div className="tbl-box">
        {tab === "positions" &&
          (positions.length === 0 ? (
            <div className="dim" style={{ padding: 16, fontSize: 13 }}>No open positions.</div>
          ) : (
            <table className="tbl">
              <thead><tr><th>MARKET</th><th>SIZE</th><th>ENTRY</th><th>MARK</th><th>LIQ.</th><th>PNL</th><th>TP / SL</th><th></th></tr></thead>
              <tbody>
                {positions.map((p) => {
                  const m = mk(p.coin);
                  const tps = orders.filter((o) => o.coin === p.coin && o.tpsl);
                  const tpPx = tps.find((o) => o.tpsl === "tp")?.triggerPx ?? null;
                  const slPx = tps.find((o) => o.tpsl === "sl")?.triggerPx ?? null;
                  return (
                    <tr key={p.coin}>
                      <td><button type="button" className="linkbtn" onClick={() => onPick(p.coin)} style={{ fontWeight: 700 }}><span className={p.side === "long" ? "up" : "down"}>{p.side === "long" ? "Long" : "Short"}</span> {p.coin} {p.lev}x</button></td>
                      <td>{Math.abs(p.size)} ({usd(p.value)})</td>
                      <td>{px(p.entry)}</td>
                      <td>{px(m?.mark)}</td>
                      <td>{px(p.liq)}</td>
                      <td className={tone(p.pnl)}>{signedUsd(p.pnl)} ({pct(p.roe, 1)})</td>
                      <td><button type="button" className="linkbtn" onClick={() => setEdit(p)}>{tpPx ? px(tpPx) : "—"} / {slPx ? px(slPx) : "—"}</button></td>
                      <td>
                        <span style={{ display: "inline-flex", gap: 6 }}>
                          <button type="button" className="btn sm" disabled={!!busy} onClick={() => act(`h${p.coin}`, () => trade.close(p, m, 0.5), `Closed half of ${p.coin}.`)}>50%</button>
                          <button type="button" className="btn sm" disabled={!!busy} onClick={() => act(`c${p.coin}`, () => trade.close(p, m), `${p.coin} closed.`)}>{busy === `c${p.coin}` ? "…" : "Close"}</button>
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ))}
        {tab === "orders" &&
          (orders.length === 0 ? (
            <div className="dim" style={{ padding: 16, fontSize: 13 }}>No open orders.</div>
          ) : (
            <table className="tbl">
              <thead><tr><th>MARKET</th><th>TYPE</th><th>SIDE</th><th>PRICE</th><th>SIZE</th><th></th></tr></thead>
              <tbody>
                {orders.map((o) => (
                  <tr key={o.oid}>
                    <td>{o.coin}</td>
                    <td>{o.type}</td>
                    <td className={o.side === "B" ? "up" : "down"}>{o.side === "B" ? "Buy" : "Sell"}</td>
                    <td>{px(o.triggerPx ?? o.limitPx)}</td>
                    <td>{o.size || "All"}</td>
                    <td><button type="button" className="btn sm" disabled={!!busy} onClick={() => act(`o${o.oid}`, () => trade.cancel(o, mk(o.coin)), "Order cancelled.")}>Cancel</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          ))}
        {tab === "history" &&
          (fills.length === 0 ? (
            <div className="dim" style={{ padding: 16, fontSize: 13 }}>No trades yet.</div>
          ) : (
            <table className="tbl">
              <thead><tr><th>TIME</th><th>MARKET</th><th>TRADE</th><th>PRICE</th><th>SIZE</th><th>PNL</th><th>FEE</th></tr></thead>
              <tbody>
                {fills.map((f) => (
                  <tr key={`${f.hash}${f.tid}`}>
                    <td>{new Date(f.time).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</td>
                    <td>{f.coin}</td>
                    <td>{f.dir}</td>
                    <td>{px(f.px)}</td>
                    <td>{f.sz}</td>
                    <td className={tone(f.pnl)}>{f.pnl ? signedUsd(f.pnl) : "—"}</td>
                    <td>{usd(f.fee, 4)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ))}
      </div>
      {edit && <TpslSheet p={edit} market={mk(edit.coin)} orders={orders} trade={trade} onClose={() => setEdit(null)} />}
    </div>
  );
}

function TpslSheet({ p, market, orders, trade, onClose }: { p: PerpPosition; market: PerpMarket | null; orders: PerpOrder[]; trade: ReturnType<typeof makeFuturesTrade>; onClose: () => void }) {
  const cur = orders.filter((o) => o.coin === p.coin && o.tpsl);
  const [tp, setTp] = useState(String(cur.find((o) => o.tpsl === "tp")?.triggerPx ?? ""));
  const [sl, setSl] = useState(String(cur.find((o) => o.tpsl === "sl")?.triggerPx ?? ""));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const save = async () => {
    setBusy(true);
    setErr("");
    try {
      await trade.setTpsl(p, market, { tp: Number(tp) > 0 ? Number(tp) : null, sl: Number(sl) > 0 ? Number(sl) : null }, orders);
      onClose();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={`Take profit and stop loss for ${p.coin}`}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <b style={{ fontSize: 18 }}>TP / SL · {p.side === "long" ? "Long" : "Short"} {p.coin}</b>
          <button type="button" className="icon-btn" aria-label="Close" onClick={() => !busy && onClose()} style={{ width: 40, height: 40, background: "transparent" }}><IX size={15} /></button>
        </div>
        <span className="dim mono" style={{ fontSize: 12 }}>Entry {px(p.entry)} · Mark {px(market?.mark)} · Liq. {px(p.liq)}</span>
        <div className="field"><label htmlFor="ts-tp">Take profit price</label><input id="ts-tp" className="inp mono" inputMode="decimal" value={tp} onChange={(e) => setTp(e.target.value.replace(/[^0-9.]/g, ""))} placeholder="Empty: none" /></div>
        <div className="field"><label htmlFor="ts-sl">Stop loss price</label><input id="ts-sl" className="inp mono" inputMode="decimal" value={sl} onChange={(e) => setSl(e.target.value.replace(/[^0-9.]/g, ""))} placeholder="Empty: none" /></div>
        <button type="button" className="btn volt lg" disabled={busy} onClick={save}>{busy ? "Saving…" : "Save"}</button>
        {err && <div role="status" style={{ fontSize: 13, fontWeight: 600, color: "var(--down)", textAlign: "center" }}>{err}</div>}
        <span className="dim" style={{ fontSize: 12 }}>Size {sizeString(Math.abs(p.size), market?.szDecimals ?? 4)} {p.coin}: the whole position closes at either price.</span>
      </div>
    </div>
  );
}
