"use client";

/**
 * Spot: buy and hold coins on Hyperliquid (no leverage) from the same trading balance as futures.
 * Coin list, live chart, order book, buy / sell (market or limit), the coins held with their
 * value, open orders and history. Trading itself is in lib/hltrade.ts (spotBuy / spotSell).
 */
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useWallet } from "./wallet";
import { Intervals } from "./trade";
import { IDown, ISearch, IX, IAlert } from "./icons";
import { useIsMobile } from "./bits";
import { Balance, Book, FundsSheet } from "./futures";
import { MarketTabs } from "./markettabs";
import { INTERVALS, fetchBook, fetchPerpAccount, fetchPerpCandles, info, px, sizeString, type BookLevel, type Interval, type PerpAccount } from "@/lib/hl";
import { BUILDER_FEE } from "@/lib/hl";
import {
  SPOT_MIN_NOTIONAL,
  combineCash,
  fetchAccountMode,
  fetchSpotBalances,
  fetchSpotFills,
  fetchSpotMarkets,
  holdingOf,
  usdcOf,
  type SpotBalance,
  type SpotFill,
  type SpotMarket,
} from "@/lib/hlspot";
import { makeFuturesTrade } from "@/lib/hltrade";

const TvChart = dynamic(() => import("./tvchart"), { ssr: false, loading: () => <div className="skel" style={{ height: 380, borderRadius: 12 }} /> });

/** Hyperliquid's spot taker fee at the base tier (about; it falls with volume). */
const HL_SPOT_FEE = 0.0007;
const usd = (v: number, d = 2) => `$${v.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d })}`;
const pct = (v: number | null, d = 2) => (v === null ? "—" : `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(d)}%`);
const tone = (v: number | null) => (v === null || v === 0 ? "dim" : v > 0 ? "up" : "down");
const compact = (v: number) => (v >= 1e9 ? `$${(v / 1e9).toFixed(2)}B` : v >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `$${(v / 1e3).toFixed(1)}K` : usd(v, 0));
const coinsText = (v: number) => v.toLocaleString("en-US", { maximumFractionDigits: v >= 1000 ? 2 : 6 });

const SPOT_BLURB = "Buy HYPE, UBTC, PURR and every other coin on Hyperliquid spot. You own them outright.";

type SpotOrder = { pair: string; oid: number; side: "B" | "A"; limitPx: number; size: number };

export function SpotScreen() {
  const w = useWallet();
  const q = useSearchParams();
  const router = useRouter();
  const mobile = useIsMobile();
  const [markets, setMarkets] = useState<SpotMarket[] | null>(null);
  const [want, setWant] = useState((q.get("c") || "HYPE").trim());
  const [iv, setIv] = useState<Interval>("15m");
  const [candles, setCandles] = useState<{ t: number; o: number; h: number; l: number; c: number; v: number }[] | null>(null);
  const [book, setBook] = useState<{ bids: BookLevel[]; asks: BookLevel[] } | null>(null);
  const [perp, setPerp] = useState<PerpAccount | null>(null);
  const [balances, setBalances] = useState<SpotBalance[] | null>(null);
  const [mode, setMode] = useState<"standard" | "unified" | "portfolio" | null>(null);
  const [orders, setOrders] = useState<SpotOrder[]>([]);
  const [fills, setFills] = useState<SpotFill[]>([]);
  const [error, setError] = useState(false);
  const [search, setSearch] = useState("");
  const [picker, setPicker] = useState(false);
  const [funds, setFunds] = useState<"add" | "withdraw" | null>(null);
  const user = w.address ?? null;

  // every spot coin, refreshed every 5 s while the page is open
  useEffect(() => {
    let alive = true;
    const load = () => fetchSpotMarkets().then((m) => alive && (setMarkets(m), setError(false))).catch(() => alive && setError(true));
    void load();
    const t = setInterval(() => document.visibilityState === "visible" && void load(), 5_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  // the coin asked for (by ticker, or a pair name), else the busiest
  const market = useMemo(() => {
    if (!markets) return null;
    const w0 = want.toUpperCase();
    return markets.find((m) => m.base.toUpperCase() === w0) ?? markets.find((m) => m.pair === want) ?? markets[0] ?? null;
  }, [markets, want]);
  const pair = market?.pair ?? null;

  useEffect(() => {
    if (!pair) return;
    let alive = true;
    setCandles(null);
    const loadC = () => fetchPerpCandles(pair, iv).then((c) => alive && setCandles(c)).catch(() => {});
    void loadC();
    const t = setInterval(() => document.visibilityState === "visible" && void loadC(), 5_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [pair, iv]);
  useEffect(() => {
    if (!pair) return;
    let alive = true;
    setBook(null);
    const loadB = () => fetchBook(pair).then((b) => alive && setBook(b)).catch(() => {});
    void loadB();
    const t = setInterval(() => document.visibilityState === "visible" && void loadB(), 2_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [pair]);

  // the user's balance, coins, orders, trades; answers for an earlier wallet are dropped
  const userRef = useRef(user);
  userRef.current = user;
  const loadMine = useCallback(async () => {
    if (!user) return;
    const [a, b, m, o, f] = await Promise.all([
      fetchPerpAccount(user).catch(() => null),
      fetchSpotBalances(user).catch(() => null),
      fetchAccountMode(user).catch(() => null),
      info<{ coin: string; oid: number; side: "B" | "A"; limitPx: string; sz: string }[]>({ type: "frontendOpenOrders", user: user.toLowerCase() }).catch(() => null),
      fetchSpotFills(user).catch(() => null),
    ]);
    if (userRef.current !== user) return;
    if (a) setPerp(a);
    if (b) setBalances(b);
    if (m) setMode(m);
    if (o) setOrders(o.filter((x) => x.coin.startsWith("@") || x.coin.includes("/")).map((x) => ({ pair: x.coin, oid: x.oid, side: x.side, limitPx: Number(x.limitPx), size: Number(x.sz) })));
    if (f) setFills(f);
  }, [user]);
  useEffect(() => {
    setPerp(null);
    setBalances(null);
    setMode(null);
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

  const cash = combineCash(perp, balances, mode);
  // the shape the shared balance card and money sheet read
  const account: PerpAccount | null = cash && perp ? { ...perp, accountValue: cash.value, withdrawable: cash.available } : null;
  const held = holdingOf(balances ?? [], market);

  const pick = (m: SpotMarket) => {
    setWant(m.base);
    setPicker(false);
    router.replace(`/market/?c=${encodeURIComponent(m.base)}`, { scroll: false });
  };
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
        <span className="sr">Search coins</span>
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search coins" />
      </label>
      <div className="tl-scroll">
        {!markets ? (
          Array.from({ length: 12 }, (_, i) => <div key={i} className="skel" style={{ height: 44, borderRadius: 10, marginBottom: 6 }} />)
        ) : (
          markets
            .filter((m) => {
              const s = search.trim().toLowerCase();
              return !s || m.base.toLowerCase().includes(s) || (m.fullName ?? "").toLowerCase().includes(s);
            })
            .slice(0, 150)
            .map((m) => (
              <button key={m.pair} type="button" onClick={() => pick(m)} className={`tl-row${m.pair === pair ? " on" : ""}`} style={{ width: "100%" }}>
                <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 1 }}>
                  <span style={{ fontWeight: 700, fontSize: 13 }}>
                    {m.base}
                    <span className="mono" style={{ fontSize: 10, color: "var(--faint)" }}>/USDC</span>
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
        ["Market cap", market.marketCap ? compact(market.marketCap) : "—", ""],
      ]
    : [];
  const name = market ? `${market.base}/USDC` : "…";

  return (
    <>
      <MarketTabs at="spot" />
      <div className="term">
        <aside className="panel term-list">{list}</aside>

        <section className="term-main">
          <button type="button" className="term-switch" onClick={() => setPicker(true)} aria-haspopup="dialog">
            <span style={{ flex: 1, minWidth: 0, textAlign: "left" }}>
              <b style={{ fontSize: 15 }}>{name}</b> <span className="mono" style={{ fontSize: 11, color: "var(--faint)" }}>· switch</span>
            </span>
            <IDown size={14} color="var(--faint)" />
            {market && <span className={`chg ${(market.change24h ?? 0) >= 0 ? "u" : "d"}`}>{pct(market.change24h, 1)}</span>}
          </button>

          {error && !markets && (
            <div className="warn-note">
              <IAlert size={16} color="var(--warn)" />
              <span>Can&apos;t reach the spot markets right now. Retrying…</span>
            </div>
          )}

          <div className="panel term-head">
            <span className="hide-m" style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
              <b style={{ fontSize: 18 }}>{name}</b>
              <span className="mono dim" style={{ fontSize: 11 }}>Spot{market?.fullName ? ` · ${market.fullName}` : ""}</span>
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
            <TvChart candles={candles} supply={null} empty="Loading the chart…" height={mobile ? 280 : 430} seriesKey={`${pair}|${iv}`} />
            <span className="dim" style={{ fontSize: 11 }}>Powered by Hyperliquid</span>
          </div>

          {mobile && <Balance account={account} signedIn={!!user} allowed onFunds={setFunds} onLogin={w.login} blurb={SPOT_BLURB} />}
          {mobile && <SpotOrderPanel market={market} cash={cash?.available ?? 0} held={held?.free ?? 0} loaded={!!cash} trade={trade} onFunds={setFunds} />}

          <MySpot balances={balances} markets={markets} orders={orders} fills={fills} trade={trade} signedIn={!!user} onPick={pick} />
        </section>

        <aside className="term-trade">
          <Balance account={account} signedIn={!!user} allowed onFunds={setFunds} onLogin={w.login} blurb={SPOT_BLURB} />
          {!mobile && <SpotOrderPanel market={market} cash={cash?.available ?? 0} held={held?.free ?? 0} loaded={!!cash} trade={trade} onFunds={setFunds} />}
          <Book book={book} market={market ? { mark: market.mark, coin: market.base } : null} />
        </aside>

        {picker && (
          <div className="term-picker" role="dialog" aria-modal="true" aria-label="Switch coin">
            <div className="term-picker-top">
              <b>Switch coin</b>
              <button type="button" className="icon-btn" aria-label="Close" onClick={() => setPicker(false)}>
                <IX size={15} />
              </button>
            </div>
            <div className="term-picker-body">{list}</div>
          </div>
        )}
        {funds && <FundsSheet mode={funds} setMode={setFunds} account={account} cash={w.totalUsdc} trade={trade} onClose={() => setFunds(null)} />}
      </div>
    </>
  );
}

// ------------------------------------------------------------------ buy / sell

function SpotOrderPanel({ market, cash, held, loaded, trade, onFunds }: { market: SpotMarket | null; cash: number; held: number; loaded: boolean; trade: ReturnType<typeof makeFuturesTrade>; onFunds: (m: "add" | "withdraw") => void }) {
  const w = useWallet();
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [kind, setKind] = useState<"market" | "limit">("market");
  const [amount, setAmount] = useState("");
  const [part, setPart] = useState(1);
  const [limitPx, setLimitPx] = useState("");
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => {
    setLimitPx("");
    setAmount("");
    setPart(1);
    setMsg(null);
  }, [market?.pair]);

  const buy = side === "buy";
  const at = kind === "limit" && Number(limitPx) > 0 ? Number(limitPx) : market?.mark ?? 0;
  const usdIn = Number(amount);
  const coinsOut = buy && at > 0 && usdIn > 0 && market ? Number(sizeString(usdIn / at, market.szDecimals)) : 0;
  const sellCoins = !buy && market ? Number(sizeString(held * part, market.szDecimals)) : 0;
  const sellUsd = sellCoins * at;
  const fee = (buy ? usdIn : sellUsd) * (HL_SPOT_FEE + BUILDER_FEE);

  const why = !market
    ? "Loading…"
    : kind === "limit" && !(Number(limitPx) > 0)
      ? "Enter a limit price."
      : buy
        ? !(usdIn > 0)
          ? "Enter an amount."
          : usdIn < SPOT_MIN_NOTIONAL
            ? `The smallest order is $${SPOT_MIN_NOTIONAL}.`
            : loaded && usdIn * 1.002 > cash + 1e-9
              ? "Not enough in your trading balance. Add money first."
              : null
        : !(held > 0)
          ? `You don't have ${market.base} to sell.`
          : sellUsd < SPOT_MIN_NOTIONAL
            ? `The smallest order is $${SPOT_MIN_NOTIONAL}.`
            : null;

  const go = async () => {
    if (!market) return;
    setMsg(null);
    if (!w.signer) return w.login();
    if (why) return setMsg({ ok: false, text: why });
    setBusy(true);
    try {
      const lp = kind === "limit" ? Number(limitPx) : null;
      if (buy) {
        const r = await trade.spotBuy(market, usdIn, lp, setStep);
        setMsg({ ok: true, text: r.resting ? `Buy order placed at ${px(lp)}.` : `Bought ${coinsText(r.coins)} ${market.base}${r.avgPx ? ` at ${px(r.avgPx)}` : ""}.` });
        setAmount("");
      } else {
        const r = await trade.spotSell(market, part, lp, setStep);
        setMsg({ ok: true, text: r.resting ? `Sell order placed at ${px(lp)}.` : `Sold for about ${usd(r.usd)}.` });
      }
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
      setStep(null);
    }
  };

  return (
    <div className="card" style={{ gap: 12, padding: 14 }}>
      <div className="seg-tabs" role="group" aria-label="Buy or sell">
        <button type="button" className={buy ? "on" : ""} onClick={() => setSide("buy")} style={buy ? { background: "var(--up)", color: "#04130C" } : undefined}>Buy</button>
        <button type="button" className={!buy ? "on" : ""} onClick={() => setSide("sell")} style={!buy ? { background: "var(--down)", color: "#1A0505" } : undefined}>Sell</button>
      </div>
      <div style={{ display: "flex", gap: 4 }}>
        {(["market", "limit"] as const).map((k) => (
          <button key={k} type="button" className={`tab${kind === k ? " on" : ""}`} onClick={() => setKind(k)}>{k === "market" ? "Market" : "Limit"}</button>
        ))}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
        <span className="dim">{buy ? "Available" : `You have`}</span>
        <span className="mono">{!w.signer ? "—" : !loaded ? "…" : buy ? usd(cash) : `${coinsText(held)} ${market?.base ?? ""}`}</span>
      </div>
      {kind === "limit" && (
        <div className="field">
          <label htmlFor="sp-limit">Limit price</label>
          <input id="sp-limit" className="inp mono" inputMode="decimal" placeholder={market ? px(market.mark) : "0"} value={limitPx} onChange={(e) => setLimitPx(e.target.value.replace(/[^0-9.]/g, ""))} />
        </div>
      )}
      {buy ? (
        <div className="field">
          <label htmlFor="sp-amt">Amount (USDC)</label>
          <input id="sp-amt" className="inp mono" inputMode="decimal" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} />
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 6 }}>
            {[0.1, 0.25, 0.5, 1].map((f) => (
              <button key={f} type="button" className="btn sm" style={{ height: 32 }} onClick={() => setAmount((Math.floor(cash * f * (f === 1 ? 0.995 : 1) * 100) / 100).toFixed(2))} disabled={!cash}>
                {f === 1 ? "Max" : `${f * 100}%`}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="field">
          <span style={{ fontSize: 12, fontWeight: 600 }}>How much to sell</span>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 6 }}>
            {[0.25, 0.5, 0.75, 1].map((f) => (
              <button key={f} type="button" className={`btn sm${part === f ? " volt" : ""}`} style={{ height: 34 }} onClick={() => setPart(f)} disabled={!held}>
                {f === 1 ? "All" : `${f * 100}%`}
              </button>
            ))}
          </div>
        </div>
      )}
      {market && (buy ? usdIn > 0 : sellCoins > 0) && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 12, borderTop: "1px solid var(--line)", paddingTop: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span className="dim">{buy ? "You get about" : "You sell"}</span>
            <span className="mono">{buy ? `${coinsText(coinsOut)} ${market.base}` : `${coinsText(sellCoins)} ${market.base}`}</span>
          </div>
          {!buy && (
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span className="dim">You get about</span>
              <span className="mono">{usd(sellUsd)}</span>
            </div>
          )}
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span className="dim">Fee</span>
            <span className="mono">{usd(fee)} ({((HL_SPOT_FEE + BUILDER_FEE) * 100).toFixed(2)}%)</span>
          </div>
        </div>
      )}
      {!w.signer ? (
        <button type="button" className="btn volt lg" onClick={w.login}>Sign in to trade</button>
      ) : loaded && buy && cash < 1 && !busy ? (
        <button type="button" className="btn volt lg" onClick={() => onFunds("add")}>Add money to start</button>
      ) : (
        <button type="button" className={`btn lg ${buy ? "buy" : "sell"}`} disabled={busy || !market} onClick={go}>
          {busy ? step ?? "Working…" : `${buy ? "Buy" : "Sell"} ${market?.base ?? ""}`}
        </button>
      )}
      {msg && <div role="status" style={{ fontSize: 13, fontWeight: 600, color: msg.ok ? "var(--up)" : "var(--down)", textAlign: "center" }}>{msg.text}</div>}
      <span className="dim" style={{ fontSize: 11, textAlign: "center", lineHeight: 1.5 }}>You own the coins outright, no leverage. Orders run on Hyperliquid.</span>
    </div>
  );
}

// ------------------------------------------------------------------ coins held, orders, history

function MySpot({ balances, markets, orders, fills, trade, signedIn, onPick }: { balances: SpotBalance[] | null; markets: SpotMarket[] | null; orders: SpotOrder[]; fills: SpotFill[]; trade: ReturnType<typeof makeFuturesTrade>; signedIn: boolean; onPick: (m: SpotMarket) => void }) {
  const [tab, setTab] = useState<"coins" | "orders" | "history">("coins");
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const byBase = new Map((markets ?? []).map((m) => [m.base, m]));
  const byPair = new Map((markets ?? []).map((m) => [m.pair, m]));
  const coins = (balances ?? [])
    .filter((b) => b.coin !== "USDC")
    .map((b) => {
      const m = byBase.get(b.coin) ?? null;
      const value = m ? b.total * m.mark : null;
      const pnl = value !== null && b.entryNtl > 0 ? value - b.entryNtl : null;
      return { b, m, value, pnl };
    })
    .sort((x, y) => (y.value ?? 0) - (x.value ?? 0));
  const spotUsdc = usdcOf(balances ?? []);

  const sellAll = async (m: SpotMarket) => {
    setBusy(`sell-${m.pair}`);
    setMsg(null);
    try {
      const r = await trade.spotSell(m, 1, null, () => {});
      setMsg({ ok: true, text: `Sold ${m.base} for about ${usd(r.usd)}.` });
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy("");
    }
  };
  const cancel = async (o: SpotOrder) => {
    const m = byPair.get(o.pair);
    if (!m) return;
    setBusy(`c-${o.oid}`);
    setMsg(null);
    try {
      await trade.spotCancel(m, o.oid);
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy("");
    }
  };

  return (
    <div className="panel" style={{ padding: 12, gap: 10 }}>
      <div style={{ display: "flex", gap: 4 }}>
        {([["coins", `Your coins${coins.length ? ` (${coins.length})` : ""}`], ["orders", `Orders${orders.length ? ` (${orders.length})` : ""}`], ["history", "History"]] as const).map(([k, l]) => (
          <button key={k} type="button" className={`tab${tab === k ? " on" : ""}`} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>
      {msg && <div role="status" style={{ fontSize: 13, fontWeight: 600, color: msg.ok ? "var(--up)" : "var(--down)" }}>{msg.text}</div>}
      {!signedIn ? (
        <span className="dim" style={{ fontSize: 13, padding: "8px 2px" }}>Sign in to see your coins.</span>
      ) : tab === "coins" ? (
        coins.length === 0 ? (
          <span className="dim" style={{ fontSize: 13, padding: "8px 2px" }}>
            No coins yet.{spotUsdc && spotUsdc.total > 0.01 ? ` ${usd(spotUsdc.total)} in spot dollars, ready to use.` : ""}
          </span>
        ) : (
          <div className="data-scroll">
            <table className="data-table">
              <thead>
                <tr><th>Coin</th><th>Amount</th><th>Value</th><th>Profit</th><th /></tr>
              </thead>
              <tbody>
                {coins.map(({ b, m, value, pnl }) => (
                  <tr key={b.coin} className={m ? "click" : ""} onClick={() => m && onPick(m)}>
                    <td><b>{b.coin}</b></td>
                    <td className="mono">{coinsText(b.total)}</td>
                    <td className="mono">{value === null ? "—" : usd(value)}</td>
                    <td className={`mono ${tone(pnl)}`}>{pnl === null ? "—" : `${pnl >= 0 ? "+" : "−"}${usd(Math.abs(pnl))}`}</td>
                    <td>
                      {m && (
                        <button type="button" className="btn sm sell" disabled={!!busy || b.free <= 0} onClick={(e) => (e.stopPropagation(), void sellAll(m))}>
                          {busy === `sell-${m.pair}` ? "Selling…" : "Sell all"}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : tab === "orders" ? (
        orders.length === 0 ? (
          <span className="dim" style={{ fontSize: 13, padding: "8px 2px" }}>No open orders.</span>
        ) : (
          <div className="data-scroll">
            <table className="data-table">
              <thead><tr><th>Coin</th><th>Side</th><th>Price</th><th>Amount</th><th /></tr></thead>
              <tbody>
                {orders.map((o) => (
                  <tr key={o.oid}>
                    <td><b>{byPair.get(o.pair)?.base ?? o.pair}</b></td>
                    <td className={o.side === "B" ? "up" : "down"}>{o.side === "B" ? "Buy" : "Sell"}</td>
                    <td className="mono">{px(o.limitPx)}</td>
                    <td className="mono">{coinsText(o.size)}</td>
                    <td><button type="button" className="btn sm" disabled={!!busy} onClick={() => void cancel(o)}>{busy === `c-${o.oid}` ? "…" : "Cancel"}</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : fills.length === 0 ? (
        <span className="dim" style={{ fontSize: 13, padding: "8px 2px" }}>No spot trades yet.</span>
      ) : (
        <div className="data-scroll">
          <table className="data-table">
            <thead><tr><th>Coin</th><th>Side</th><th>Price</th><th>Amount</th><th>When</th></tr></thead>
            <tbody>
              {fills.map((f) => (
                <tr key={`${f.hash}-${f.tid}`}>
                  <td><b>{byPair.get(f.pair)?.base ?? f.pair}</b></td>
                  <td className={f.side === "B" ? "up" : "down"}>{f.side === "B" ? "Buy" : "Sell"}</td>
                  <td className="mono">{px(f.px)}</td>
                  <td className="mono">{coinsText(f.sz)}</td>
                  <td className="mono dim">{new Date(f.time).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
