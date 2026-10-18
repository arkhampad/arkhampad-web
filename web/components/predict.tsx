"use client";

/**
 * Predict: price rounds on Hyperliquid (HIP-4). "Will BTC be above $105,000 at 19:45?": buy Above
 * or Below from the trading balance; a winning share pays $1, a losing one $0, paid automatically.
 * Shares can be sold any time before the round ends. Trading is in lib/hltrade.ts, data in
 * lib/hlpredict.ts.
 */
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useWallet } from "./wallet";
import { Intervals } from "./trade";
import { IDown, IX, IAlert } from "./icons";
import { useIsMobile } from "./bits";
import { Balance, Book, FundsSheet } from "./futures";
import { MarketTabs } from "./markettabs";
import { INTERVALS, SPOT_BUILDER_FEE, fetchBook, fetchPerpAccount, fetchPerpCandles, futuresAllowedHere, px as pxText, type BookLevel, type Interval, type PerpAccount } from "@/lib/hl";
import { combineCash, fetchAccountMode, fetchSpotBalances, type SpotBalance } from "@/lib/hlspot";
import { fetchStockCash } from "@/lib/hlstocks";
import { makeFuturesTrade } from "@/lib/hltrade";
import {
  PREDICT_MIN_NOTIONAL,
  cents,
  chance,
  clock,
  fetchPredictFills,
  fetchPredictHoldings,
  fetchPredictMarkets,
  fetchPredictOrders,
  fetchPredictResult,
  sharesFor,
  type PredictFill,
  type PredictHolding,
  type PredictMarket,
  type PredictOrder,
  type PredictResult,
  type PredictSide,
} from "@/lib/hlpredict";

const TvChart = dynamic(() => import("./tvchart"), { ssr: false, loading: () => <div className="skel" style={{ height: 320, borderRadius: 12 }} /> });

const usd = (v: number, d = 2) => `$${v.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d })}`;
const signedUsd = (v: number) => `${v >= 0 ? "+" : "−"}${usd(Math.abs(v))}`;
const tone = (v: number | null) => (v === null || v === 0 ? "dim" : v > 0 ? "up" : "down");
const hhmm = (ms: number | null) => (ms === null ? "" : new Date(ms).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }));
const whenText = (ms: number | null) => (ms === null ? "" : new Date(ms).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }));
const BLURB = "Call where crypto prices go in the next minutes, hours or day. A right call pays $1 a share. Runs on Hyperliquid.";
/** Ended rounds stay listed this long (with their result). */
const KEEP_ENDED_MS = 30 * 60_000;

type Trade = ReturnType<typeof makeFuturesTrade>;

/** "Above won" / "Yes won", from how the market settled. */
const winnerOf = (m: PredictMarket | null, r: PredictResult) => {
  const yesWon = r.fraction >= 0.5;
  return m ? (yesWon ? m.yes.name : m.no.name) : yesWon ? "Yes" : "No";
};

export function PredictScreen() {
  const w = useWallet();
  const q = useSearchParams();
  const router = useRouter();
  const mobile = useIsMobile();
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [markets, setMarkets] = useState<PredictMarket[] | null>(null);
  const [want, setWant] = useState(Number(q.get("m") ?? NaN));
  const [error, setError] = useState(false);
  const [filter, setFilter] = useState("All");
  const [picker, setPicker] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [chartSide, setChartSide] = useState<0 | 1>(0);
  const [iv, setIv] = useState<Interval>("1m");
  const [candles, setCandles] = useState<{ t: number; o: number; h: number; l: number; c: number; v: number }[] | null>(null);
  const [book, setBook] = useState<{ bids: BookLevel[]; asks: BookLevel[] } | null>(null);
  const [perp, setPerp] = useState<PerpAccount | null>(null);
  const [balances, setBalances] = useState<SpotBalance[] | null>(null);
  const [mode, setMode] = useState<"standard" | "unified" | "portfolio" | null>(null);
  const [stockCash, setStockCash] = useState<{ value: number; available: number } | null>(null);
  const [holdings, setHoldings] = useState<PredictHolding[]>([]);
  const [orders, setOrders] = useState<PredictOrder[]>([]);
  const [fills, setFills] = useState<PredictFill[]>([]);
  const [funds, setFunds] = useState<"add" | "withdraw" | null>(null);
  const [results, setResults] = useState<Map<number, PredictResult>>(() => new Map());
  const user = w.address ?? null;

  useEffect(() => {
    let alive = true;
    void futuresAllowedHere().then((ok) => alive && setAllowed(ok));
    const t = setInterval(() => setNow(Date.now()), 1_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  // rounds settle and vanish from Hyperliquid's list: ones seen here stay a while with their result
  const seen = useRef(new Map<number, PredictMarket>());
  useEffect(() => {
    let alive = true;
    const load = () =>
      fetchPredictMarkets()
        .then((list) => {
          if (!alive) return;
          const t = Date.now();
          const ids = new Set(list.map((m) => m.outcome));
          for (const m of list) seen.current.set(m.outcome, m);
          for (const [id, m] of seen.current) if (!ids.has(id) && (m.expiry === null || m.expiry < t - KEEP_ENDED_MS)) seen.current.delete(id);
          const gone = [...seen.current.values()].filter((m) => !ids.has(m.outcome));
          setMarkets([...list, ...gone].sort((a, b) => (a.expiry ?? Infinity) - (b.expiry ?? Infinity) || a.outcome - b.outcome));
          setError(false);
        })
        .catch(() => alive && setError(true));
    void load();
    const t = setInterval(() => document.visibilityState === "visible" && void load(), 3_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  const live = useMemo(() => (markets ?? []).filter((m) => m.expiry === null || m.expiry > now - KEEP_ENDED_MS), [markets, now]);
  const market = useMemo(() => live.find((m) => m.outcome === want) ?? live.find((m) => m.expiry === null || m.expiry > now) ?? live[0] ?? null, [live, want, now]);
  const periods = useMemo(() => {
    const seenP = new Map<string, number>();
    for (const m of live) if (m.periodLabel) seenP.set(m.periodLabel, m.periodMs ?? 0);
    return [...seenP.entries()].sort((a, b) => a[1] - b[1]).map(([k]) => k);
  }, [live]);
  const side = market ? (chartSide === 0 ? market.yes : market.no) : null;

  // results of ended rounds (the open one and any in the list), asked until known
  const endedIds = live.filter((m) => m.expiry !== null && m.expiry <= now && !results.has(m.outcome)).map((m) => m.outcome);
  const heldSettled = holdings.filter((h) => h.settled && !results.has(h.outcome)).map((h) => h.outcome);
  const askKey = [...new Set([...endedIds, ...heldSettled])].slice(0, 12).join(",");
  useEffect(() => {
    if (!askKey) return;
    let alive = true;
    const ask = () =>
      Promise.all(askKey.split(",").map((id) => fetchPredictResult(Number(id)))).then((rs) => {
        if (!alive) return;
        const got = rs.filter((r): r is PredictResult => !!r);
        if (got.length) setResults((prev) => new Map([...prev, ...got.map((r) => [r.outcome, r] as const)]));
      });
    void ask();
    const t = setInterval(() => void ask(), 5_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [askKey]);

  useEffect(() => {
    if (!side) return;
    let alive = true;
    setCandles(null);
    const loadC = () => fetchPerpCandles(side.coin, iv).then((c) => alive && setCandles(c)).catch(() => alive && setCandles([]));
    void loadC();
    const t = setInterval(() => document.visibilityState === "visible" && void loadC(), 10_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [side?.coin, iv]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!side) return;
    let alive = true;
    setBook(null);
    const loadB = () => fetchBook(side.coin).then((b) => alive && setBook(b)).catch(() => {});
    void loadB();
    const t = setInterval(() => document.visibilityState === "visible" && void loadB(), 2_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [side?.coin]); // eslint-disable-line react-hooks/exhaustive-deps

  const userRef = useRef(user);
  userRef.current = user;
  const loadMine = useCallback(async () => {
    if (!user) return;
    const [a, b, m, h, o, f, sc] = await Promise.all([
      fetchPerpAccount(user).catch(() => null),
      fetchSpotBalances(user).catch(() => null),
      fetchAccountMode(user).catch(() => null),
      fetchPredictHoldings(user).catch(() => null),
      fetchPredictOrders(user).catch(() => null),
      fetchPredictFills(user).catch(() => null),
      fetchStockCash(user).catch(() => null),
    ]);
    if (userRef.current !== user) return;
    if (a) setPerp(a);
    if (b) setBalances(b);
    if (m) setMode(m);
    if (h) setHoldings(h);
    if (o) setOrders(o);
    if (f) setFills(f);
    if (sc) setStockCash(sc);
  }, [user]);
  useEffect(() => {
    setPerp(null);
    setBalances(null);
    setMode(null);
    setHoldings([]);
    setOrders([]);
    setFills([]);
    setStockCash(null);
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
  const account: PerpAccount | null = cash && perp ? { ...perp, accountValue: cash.value + (stockCash?.value ?? 0), withdrawable: cash.available } : null;

  const pick = (m: PredictMarket) => {
    setWant(m.outcome);
    setPicker(false);
    router.replace(`/predict/?m=${m.outcome}`, { scroll: false });
  };
  useEffect(() => {
    if (!picker) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [picker]);

  const shown = live.filter((m) => filter === "All" || m.periodLabel === filter);
  const status = (m: PredictMarket) => {
    if (m.expiry === null) return m.periodLabel ?? "";
    if (m.expiry > now) return `${m.periodLabel ? `${m.periodLabel} · ` : ""}${clock(m.expiry, now)} left`;
    const r = results.get(m.outcome);
    return r ? `${winnerOf(m, r)} won` : "Ended · settling";
  };
  const list = (
    <>
      {periods.length > 1 && (
        <div className="cat-chips" role="group" aria-label="Round length">
          {["All", ...periods].map((k) => (
            <button key={k} type="button" className={`tab${filter === k ? " on" : ""}`} onClick={() => setFilter(k)}>{k}</button>
          ))}
        </div>
      )}
      <div className="tl-scroll">
        {!markets ? (
          Array.from({ length: 8 }, (_, i) => <div key={i} className="skel" style={{ height: 64, borderRadius: 10, marginBottom: 6 }} />)
        ) : shown.length === 0 ? (
          <span className="dim" style={{ fontSize: 13, padding: 8 }}>No open rounds right now. New ones open all the time.</span>
        ) : (
          shown.map((m) => {
            const ended = m.expiry !== null && m.expiry <= now;
            const r = results.get(m.outcome);
            return (
              <button key={m.outcome} type="button" onClick={() => pick(m)} className={`tl-row pm-row${m.outcome === market?.outcome ? " on" : ""}`} style={{ width: "100%" }}>
                <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2, textAlign: "left" }}>
                  <span style={{ fontWeight: 700, fontSize: 13, lineHeight: 1.3 }}>{m.title}{m.expiry ? ` at ${hhmm(m.expiry)}` : ""}</span>
                  <span className="mono" style={{ fontSize: 11, color: ended ? (r ? "var(--text2)" : "var(--warn)") : "var(--faint)" }}>{status(m)}</span>
                </span>
                {!ended && (
                  <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2 }}>
                    <b className="mono up" style={{ fontSize: 14 }}>{chance(m.yes.mid)}</b>
                    <span className="mono dim" style={{ fontSize: 10 }}>{m.yes.name}</span>
                  </span>
                )}
              </button>
            );
          })
        )}
      </div>
    </>
  );

  const ended = !!market && market.expiry !== null && market.expiry <= now;
  const result = market ? results.get(market.outcome) ?? null : null;
  const next = market && ended ? live.find((m) => m.outcome !== market.outcome && m.underlying === market.underlying && m.periodLabel === market.periodLabel && (m.expiry ?? 0) > now) ?? null : null;
  const blocked = allowed === false && (
    <div className="card" style={{ gap: 6, padding: 14 }}>
      <span style={{ fontWeight: 700, fontSize: 14 }}>Predictions aren&apos;t available where you are</span>
      <span className="dim" style={{ fontSize: 13, lineHeight: 1.5 }}>Rounds and odds stay open to everyone.</span>
    </div>
  );
  const panel = market && allowed !== false && <PredictPanel market={market} ended={ended} cash={cash?.available ?? 0} loaded={!!cash} holdings={holdings} trade={trade} allowed={allowed} onFunds={setFunds} onSide={setChartSide} />;

  return (
    <>
      <MarketTabs at="predict" />
      <div className="term">
        <aside className="panel term-list">{list}</aside>

        <section className="term-main">
          <button type="button" className="term-switch" onClick={() => setPicker(true)} aria-haspopup="dialog">
            <span style={{ flex: 1, minWidth: 0, textAlign: "left" }}>
              <b style={{ fontSize: 15 }}>{market?.title ?? "…"}</b> <span className="mono" style={{ fontSize: 11, color: "var(--faint)" }}>· switch</span>
            </span>
            <IDown size={14} color="var(--faint)" />
            {market && !ended && <span className="chg u">{clock(market.expiry, now)}</span>}
          </button>

          {error && !markets && (
            <div className="warn-note">
              <IAlert size={16} color="var(--warn)" />
              <span>Can&apos;t reach the prediction markets right now. Retrying…</span>
            </div>
          )}

          {market && <RoundCard market={market} now={now} ended={ended} result={result} next={next} onNext={pick} />}

          <div className="panel" style={{ padding: mobile ? 8 : 12, gap: 8 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <div style={{ display: "flex", gap: 4 }}>
                {market && ([0, 1] as const).map((s) => (
                  <button key={s} type="button" className={`tab${chartSide === s ? " on" : ""}`} onClick={() => setChartSide(s)}>
                    {s === 0 ? market.yes.name : market.no.name} odds
                  </button>
                ))}
              </div>
              <Intervals value={iv} onChange={(v) => (INTERVALS as readonly string[]).includes(v) && setIv(v as Interval)} />
            </div>
            <TvChart candles={candles} supply={null} empty={candles && !candles.length ? "No trades yet in this round." : "Loading the chart…"} height={mobile ? 220 : 300} seriesKey={`${side?.coin}|${iv}`} />
            <span className="dim" style={{ fontSize: 11 }}>Price of a share = the market&apos;s odds (0.47 = 47%). Powered by Hyperliquid</span>
          </div>

          {mobile && <Balance account={account} signedIn={!!user} allowed={allowed} onFunds={setFunds} onLogin={w.login} blurb={BLURB} />}
          {mobile && panel}
          {mobile && blocked}

          {market && (
            <div className="panel" style={{ padding: 14, gap: 6 }}>
              <b style={{ fontSize: 14 }}>How it works</b>
              <span className="dim" style={{ fontSize: 13, lineHeight: 1.6 }}>{rulesOf(market)}</span>
            </div>
          )}

          <MyPredictions markets={markets} holdings={holdings} orders={orders} fills={fills} results={results} trade={trade} signedIn={!!user} onPick={pick} />
        </section>

        <aside className="term-trade">
          <Balance account={account} signedIn={!!user} allowed={allowed} onFunds={setFunds} onLogin={w.login} blurb={BLURB} />
          {!mobile && panel}
          {!mobile && blocked}
          <Book book={book} market={side ? { mark: side.mid ?? 0, coin: side.name } : null} />
        </aside>

        {picker && (
          <div className="term-picker" role="dialog" aria-modal="true" aria-label="Switch round">
            <div className="term-picker-top">
              <b>Switch round</b>
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

// ------------------------------------------------------------------ the round: question, target vs now, clock

function RoundCard({ market: m, now, ended, result, next, onNext }: { market: PredictMarket; now: number; ended: boolean; result: PredictResult | null; next: PredictMarket | null; onNext: (m: PredictMarket) => void }) {
  const gap = m.priceMarket && m.now !== null && m.target !== null ? m.now - m.target : null;
  const progress = m.start !== null && m.expiry !== null ? Math.min(1, Math.max(0, (now - m.start) / (m.expiry - m.start))) : null;
  const question = m.priceMarket && m.underlying && m.target ? `Will ${m.underlying} be above ${usd(m.target, m.target >= 100 ? 0 : 2)}${m.expiry ? ` at ${hhmm(m.expiry)}` : ""}?` : m.name;
  return (
    <div className="panel" style={{ padding: 14, gap: 12 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <span className="mono dim" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.6 }}>
          {[m.periodLabel ? `${m.periodLabel} round` : null, m.underlying].filter(Boolean).join(" · ")}
        </span>
        <b style={{ fontSize: 19, lineHeight: 1.3 }}>{question}</b>
      </div>

      {ended ? (
        <div className={`pm-result${result ? "" : " wait"}`} role="status">
          {result ? (
            <>
              <b>{winnerOf(m, result)} won</b>
              <span>Winning shares paid $1 each, automatically.</span>
            </>
          ) : (
            <>
              <b>Round ended</b>
              <span>Hyperliquid is settling it. The result shows here in a moment.</span>
            </>
          )}
          {next && (
            <button type="button" className="btn sm volt" onClick={() => onNext(next)} style={{ marginTop: 6, alignSelf: "flex-start" }}>
              Next round: ends {hhmm(next.expiry)} →
            </button>
          )}
        </div>
      ) : (
        <div className="pm-stats">
          {m.priceMarket && m.target !== null && (
            <span>
              <i>Price to beat</i>
              <b className="mono">${pxText(m.target)}</b>
            </span>
          )}
          {m.priceMarket && (
            <span>
              <i>{m.underlying} now</i>
              <b className={`mono ${gap === null ? "" : gap >= 0 ? "up" : "down"}`}>${pxText(m.now)}</b>
              {gap !== null && <em className={gap >= 0 ? "up" : "down"}>{gap >= 0 ? "▲" : "▼"} ${pxText(Math.abs(gap))} {gap >= 0 ? "above" : "below"}</em>}
            </span>
          )}
          <span>
            <i>Time left</i>
            <b className="mono pm-clock">{clock(m.expiry, now)}</b>
            {m.expiry && <em>ends {hhmm(m.expiry)}</em>}
          </span>
        </div>
      )}

      {!ended && progress !== null && (
        <div className="pm-time" aria-label={`${Math.round(progress * 100)}% of the round gone`}>
          <span style={{ width: `${progress * 100}%` }} />
        </div>
      )}

      {!ended && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, fontWeight: 700 }}>
            <span className="up">{m.yes.name} {chance(m.yes.mid)}</span>
            <span className="down">{chance(m.no.mid)} {m.no.name}</span>
          </div>
          <div className="pm-bar" aria-hidden="true"><span style={{ width: `${Math.round((m.yes.mid ?? 0.5) * 100)}%` }} /></div>
        </div>
      )}
    </div>
  );
}

/** The rule in plain words, from the market's own fields. */
function rulesOf(m: PredictMarket): string {
  if (m.priceMarket && m.underlying && m.target && m.expiry)
    return `Pick ${m.yes.name} if you think ${m.underlying} will be above $${m.target.toLocaleString("en-US")} at ${whenText(m.expiry)} (your time), ${m.no.name} if not. It settles on Hyperliquid's own ${m.underlying} price. Each winning share pays $1 and each losing share $0, paid automatically. You can sell your shares any time before the end.`;
  return `${m.name}. ${m.description}`.trim();
}

// ------------------------------------------------------------------ buy / sell

function PredictPanel({ market, ended, cash, loaded, holdings, trade, allowed, onFunds, onSide }: { market: PredictMarket; ended: boolean; cash: number; loaded: boolean; holdings: PredictHolding[]; trade: Trade; allowed: boolean | null; onFunds: (m: "add" | "withdraw") => void; onSide: (s: 0 | 1) => void }) {
  const w = useWallet();
  const [pickSide, setPickSide] = useState<0 | 1>(0);
  const [act, setAct] = useState<"buy" | "sell">("buy");
  const [kind, setKind] = useState<"market" | "limit">("market");
  const [amount, setAmount] = useState("");
  const [part, setPart] = useState(1);
  const [limit, setLimit] = useState("");
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => {
    setAmount("");
    setLimit("");
    setPart(1);
    setMsg(null);
  }, [market.outcome]);
  const s: PredictSide = pickSide === 0 ? market.yes : market.no;
  const choose = (v: 0 | 1) => {
    setPickSide(v);
    onSide(v);
  };

  const held = holdings.find((h) => !h.settled && h.enc === s.enc)?.free ?? 0;
  // limit prices are typed in cents (47 = 47¢)
  const limitPx = kind === "limit" && Number(limit) > 0 ? Number(limit) / 100 : null;
  const px = limitPx ?? s.mid;
  const usdIn = Number(amount);
  const buy = act === "buy";
  const shares = buy && px ? sharesFor(usdIn, px) : Math.floor(held * part);
  const cost = shares * (px ?? 0);
  const why = ended
    ? "This round has ended."
    : !px
      ? "No price yet: use a limit order."
      : limitPx !== null && (limitPx < 0.001 || limitPx > 0.999)
        ? "A limit price is between 0.1¢ and 99.9¢."
        : buy
          ? !(usdIn > 0)
            ? "Enter an amount."
            : cost < PREDICT_MIN_NOTIONAL
              ? `The smallest order is $${PREDICT_MIN_NOTIONAL}.`
              : loaded && cost > cash + 1e-9
                ? "Not enough in your trading balance. Add money first."
                : null
          : !(held > 0)
            ? `You don't have ${s.name} shares in this round.`
            : cost < PREDICT_MIN_NOTIONAL
              ? `The smallest order is $${PREDICT_MIN_NOTIONAL}.`
              : null;

  const go = async () => {
    setMsg(null);
    if (!w.signer) return w.login();
    if (why) return setMsg({ ok: false, text: why });
    setBusy(true);
    try {
      if (buy) {
        const r = await trade.predictBuy(s, usdIn, limitPx, setStep);
        setMsg({ ok: true, text: r.resting ? `Order placed: ${r.shares} ${s.name} at ${cents(limitPx)}.` : `You're in: ${r.shares} ${s.name} shares${r.avgPx ? ` at ${cents(r.avgPx)}` : ""}.` });
        setAmount("");
      } else {
        const r = await trade.predictSell(s, part, limitPx, setStep);
        setMsg({ ok: true, text: r.resting ? `Sell order placed at ${cents(limitPx)}.` : `Sold for about ${usd(r.usd)}.` });
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
        {(["buy", "sell"] as const).map((a) => (
          <button key={a} type="button" className={act === a ? "on" : ""} onClick={() => setAct(a)}>{a === "buy" ? "Buy" : "Sell"}</button>
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        {([0, 1] as const).map((v) => {
          const sd = v === 0 ? market.yes : market.no;
          const on = pickSide === v;
          return (
            <button key={v} type="button" className={`pm-side ${v === 0 ? "yes" : "no"}${on ? " on" : ""}`} onClick={() => choose(v)} aria-pressed={on}>
              <span>{v === 0 ? "▲ " : "▼ "}{sd.name}</span>
              <b className="mono">{cents(sd.mid)}</b>
              <small>{chance(sd.mid)} chance</small>
            </button>
          );
        })}
      </div>
      <div style={{ display: "flex", gap: 4 }}>
        {(["market", "limit"] as const).map((k) => (
          <button key={k} type="button" className={`tab${kind === k ? " on" : ""}`} onClick={() => setKind(k)}>{k === "market" ? "Market" : "Limit"}</button>
        ))}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
        <span className="dim">{buy ? "Available" : "You have"}</span>
        <span className="mono">{!w.signer ? "—" : buy ? (loaded ? usd(cash) : "…") : `${held.toLocaleString("en-US")} ${s.name}`}</span>
      </div>
      {kind === "limit" && (
        <div className="field">
          <label htmlFor="pm-limit">Limit price (¢)</label>
          <input id="pm-limit" className="inp mono" inputMode="decimal" placeholder={s.mid ? (s.mid * 100).toFixed(1) : "50"} value={limit} onChange={(e) => setLimit(e.target.value.replace(/[^0-9.]/g, ""))} />
        </div>
      )}
      {buy ? (
        <div className="field">
          <label htmlFor="pm-amt">Amount (USDC)</label>
          <input id="pm-amt" className="inp mono" inputMode="decimal" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} />
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 6 }}>
            {[10, 25, 50, 100].map((v) => (
              <button key={v} type="button" className="btn sm" style={{ height: 32 }} onClick={() => setAmount(String(v))}>${v}</button>
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
      {shares > 0 && px && (
        buy ? (
          <div className="pm-payout">
            <div><span>If {s.name} wins you get</span><b className="mono up">{usd(shares)}</b></div>
            <div className="dim"><span>{shares.toLocaleString("en-US")} shares × $1 · you pay {usd(cost)}</span><span className="mono up">{signedUsd(shares - cost)}</span></div>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 12, borderTop: "1px solid var(--line)", paddingTop: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between" }}><span className="dim">You sell</span><span className="mono">{shares.toLocaleString("en-US")} {s.name} at {cents(px)}</span></div>
            <div style={{ display: "flex", justifyContent: "space-between" }}><span className="dim">You get about</span><span className="mono">{usd(cost * (1 - SPOT_BUILDER_FEE))}</span></div>
            <div style={{ display: "flex", justifyContent: "space-between" }}><span className="dim">ArkhamPad fee</span><span className="mono">{usd(cost * SPOT_BUILDER_FEE)} ({(SPOT_BUILDER_FEE * 100).toFixed(1)}%)</span></div>
          </div>
        )
      )}
      {ended ? (
        <button type="button" className="btn lg" disabled>Round ended</button>
      ) : !w.signer ? (
        <button type="button" className="btn volt lg" onClick={w.login}>Sign in to predict</button>
      ) : loaded && buy && cash < 1 && !busy ? (
        <button type="button" className="btn volt lg" onClick={() => onFunds("add")}>Add money to start</button>
      ) : (
        <button type="button" className={`btn lg ${pickSide === 0 ? "buy" : "sell"}`} disabled={busy || ended || allowed === null} onClick={go}>
          {busy ? step ?? "Working…" : ended ? "Round ended" : `${buy ? "Buy" : "Sell"} ${s.name}`}
        </button>
      )}
      {msg && <div role="status" style={{ fontSize: 13, fontWeight: 600, color: msg.ok ? "var(--up)" : "var(--down)", textAlign: "center" }}>{msg.text}</div>}
      <span className="dim" style={{ fontSize: 11, textAlign: "center", lineHeight: 1.5 }}>No leverage: the most you can lose is what you put in. No fee to buy.</span>
    </div>
  );
}

// ------------------------------------------------------------------ the user's shares, orders, history

function MyPredictions({ markets, holdings, orders, fills, results, trade, signedIn, onPick }: { markets: PredictMarket[] | null; holdings: PredictHolding[]; orders: PredictOrder[]; fills: PredictFill[]; results: Map<number, PredictResult>; trade: Trade; signedIn: boolean; onPick: (m: PredictMarket) => void }) {
  const [tab, setTab] = useState<"shares" | "orders" | "history">("shares");
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const byOutcome = new Map((markets ?? []).map((m) => [m.outcome, m]));
  const sideOf = (enc: number) => {
    const m = byOutcome.get(Math.floor(enc / 10)) ?? null;
    const sd = m ? (enc % 10 === 0 ? m.yes : m.no) : null;
    return { m, sd };
  };
  const rows = holdings.map((h) => {
    const { m, sd } = h.settled ? { m: byOutcome.get(h.outcome) ?? null, sd: null } : sideOf(h.enc);
    const value = sd?.mid != null ? h.shares * sd.mid : null;
    const pnl = value !== null && h.cost > 0 ? value - h.cost : null;
    return { h, m, sd, value, pnl, result: h.settled ? results.get(h.outcome) ?? null : null };
  });
  const run = async (key: string, fn: () => Promise<unknown>, ok: string) => {
    setBusy(key);
    setMsg(null);
    try {
      await fn();
      setMsg({ ok: true, text: ok });
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy("");
    }
  };
  if (!signedIn) return null;
  return (
    <div className="panel" style={{ padding: 12, gap: 10 }}>
      <div style={{ display: "flex", gap: 4 }}>
        {([["shares", `Your shares${rows.length ? ` (${rows.length})` : ""}`], ["orders", `Orders${orders.length ? ` (${orders.length})` : ""}`], ["history", "History"]] as const).map(([k, l]) => (
          <button key={k} type="button" className={`tab${tab === k ? " on" : ""}`} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>
      {msg && <div role="status" style={{ fontSize: 13, fontWeight: 600, color: msg.ok ? "var(--up)" : "var(--down)" }}>{msg.text}</div>}
      {tab === "shares" ? (
        rows.length === 0 ? (
          <span className="dim" style={{ fontSize: 13, padding: "8px 2px" }}>No predictions yet.</span>
        ) : (
          <div className="data-scroll">
            <table className="data-table">
              <thead><tr><th>Round</th><th>Side</th><th>Shares</th><th>Value</th><th>Profit</th><th /></tr></thead>
              <tbody>
                {rows.map(({ h, m, sd, value, pnl, result }) => (
                  <tr key={h.coin} className={m ? "click" : ""} onClick={() => m && onPick(m)}>
                    <td><b>{m ? `${m.title}${m.expiry ? ` at ${hhmm(m.expiry)}` : ""}` : result?.name ?? `Round ${h.outcome}`}</b></td>
                    <td className={h.settled ? "dim" : h.side === 0 ? "up" : "down"}>{h.settled ? (result ? `Settled · ${winnerOf(m, result)} won` : "Settled") : sd?.name ?? (h.side === 0 ? "Yes" : "No")}</td>
                    <td className="mono">{h.shares.toLocaleString("en-US")}</td>
                    <td className="mono">{value === null ? "—" : usd(value)}</td>
                    <td className={`mono ${tone(pnl)}`}>{pnl === null ? "—" : signedUsd(pnl)}</td>
                    <td>
                      {!h.settled && sd && (
                        <button type="button" className="btn sm sell" disabled={!!busy || h.free <= 0} onClick={(e) => (e.stopPropagation(), void run(`s${h.coin}`, () => trade.predictSell(sd, 1, null, () => {}), `Sold your ${sd.name} shares.`))}>
                          {busy === `s${h.coin}` ? "Selling…" : "Sell all"}
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
              <thead><tr><th>Round</th><th>Order</th><th>Price</th><th>Shares</th><th /></tr></thead>
              <tbody>
                {orders.map((o) => {
                  const { m, sd } = sideOf(o.enc);
                  return (
                    <tr key={o.oid}>
                      <td><b>{m?.title ?? o.coin}</b></td>
                      <td className={o.side === "B" ? "up" : "down"}>{o.side === "B" ? "Buy" : "Sell"} {sd?.name ?? ""}</td>
                      <td className="mono">{cents(o.limitPx)}</td>
                      <td className="mono">{o.size.toLocaleString("en-US")}</td>
                      <td><button type="button" className="btn sm" disabled={!!busy} onClick={() => void run(`c${o.oid}`, () => trade.predictCancel(100_000_000 + o.enc, o.oid), "Order cancelled.")}>{busy === `c${o.oid}` ? "…" : "Cancel"}</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )
      ) : fills.length === 0 ? (
        <span className="dim" style={{ fontSize: 13, padding: "8px 2px" }}>No trades yet.</span>
      ) : (
        <div className="data-scroll">
          <table className="data-table">
            <thead><tr><th>Round</th><th>Trade</th><th>Price</th><th>Shares</th><th>When</th></tr></thead>
            <tbody>
              {fills.map((f) => {
                const { m, sd } = sideOf(f.enc);
                return (
                  <tr key={`${f.hash}-${f.tid}`}>
                    <td><b>{m?.title ?? f.coin}</b></td>
                    <td className={f.side === "B" ? "up" : "down"}>{f.side === "B" ? "Buy" : "Sell"} {sd?.name ?? ""}</td>
                    <td className="mono">{cents(f.px)}</td>
                    <td className="mono">{f.sz.toLocaleString("en-US")}</td>
                    <td className="mono dim">{whenText(f.time)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
