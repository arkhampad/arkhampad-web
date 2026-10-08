"use client";
import { useLaunchFee } from "@/components/v2";
import Link from "next/link";
import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { Avatar, Spark, useIsMobile } from "@/components/bits";
import { Intervals } from "@/components/trade";
import { TradePanel } from "@/components/tradepanel";
import { IDown, ISearch, IX } from "@/components/icons";
import { ScrollTabs } from "@/components/scrolltabs";
import { getCoin, listCoins, useCoinMarket, useLive, ago, short, shareCoin, prepareCard, type LiveCoin, type Tab } from "@/lib/live";
import { LIVE } from "@/lib/chain";

const TvChart = dynamic(() => import("@/components/tvchart"), { ssr: false, loading: () => <div className="skel" style={{ height: 300, borderRadius: 12 }} /> });
const ExtChart = dynamic(() => import("@/components/extchart"), { ssr: false, loading: () => <div className="skel" style={{ height: 300, borderRadius: 12 }} /> });
const TABS: Tab[] = ["Trending", "New", "Launched here", "Gainers", "Top volume", "Losers"];

function CoinList({ tab, q, sel, onPick }: { tab: Tab; q: string; sel: string | null; onPick: (c: LiveCoin) => void }) {
  const list = useLive(() => listCoins(tab, { limit: 60, q: q || undefined }), [tab, q], 30_000);
  if (!list.data) return <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>{Array.from({ length: 10 }, (_, i) => <div key={i} className="skel" style={{ height: 44, borderRadius: 10 }} />)}</div>;
  if (!list.data.length) return <div className="dim" style={{ fontSize: 13, padding: "10px 6px" }}>No coins found.</div>;
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      {list.data.map((x) => (
        <button key={x.id} type="button" onClick={() => onPick(x)} className={`tl-row${x.id === sel ? " on" : ""}`}>
          <Avatar name={x.name} c1={x.c1} c2={x.c2} size={30} img={x.image} />
          <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 1 }}>
            <span style={{ fontWeight: 700, fontSize: 13, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{x.tick}</span>
            <span className="mono" style={{ fontSize: 11, color: "var(--faint)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{x.mc}</span>
          </span>
          <span style={{ width: 40, flex: "none" }}><Spark vals={x.spark} up={x.chg >= 0} height={18} fill={false} stroke={2} /></span>
          <span className={`mono ${x.chg >= 0 ? "up" : "down"}`} style={{ fontWeight: 700, fontSize: 12, minWidth: 56, textAlign: "right" }}>{x.chg >= 0 ? "+" : ""}{x.chg.toFixed(1)}%</span>
        </button>
      ))}
    </div>
  );
}

function TerminalView() {
  const q = useSearchParams();
  const router = useRouter();
  const mobile = useIsMobile();
  const [tab, setTab] = useState<Tab>("Trending");
  const [search, setSearch] = useState(q.get("q") || "");
  const [qDebounced, setQ] = useState("");
  const [picker, setPicker] = useState(false);
  const [c, setC] = useState<LiveCoin | null>(null);
  const [iv, setIv] = useState("15m");
  const [below, setBelow] = useState<"trades" | "about">("trades");
  // young coins have few trades: start on 1-minute candles so the chart isn't empty
  const youngId = useRef("");
  useEffect(() => { if (c) prepareCard(c); }, [c?.id, c?.mc]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!c || youngId.current === c.id) return;
    youngId.current = c.id;
    const age = c.createdAt ? Date.now() - Date.parse(c.createdAt) : Infinity;
    setIv(c.own && age < 6 * 3600_000 ? "1m" : "15m");
  }, [c]);
  const id = q.get("c");

  useEffect(() => { const t = setTimeout(() => setQ(search), 300); return () => clearTimeout(t); }, [search]);
  // the coin from the link, or the top trending one
  useEffect(() => {
    let alive = true;
    (async () => {
      const coin = (id ? await getCoin(id).catch(() => null) : null) ?? (await listCoins("Trending", { limit: 1 }).catch(() => []))[0] ?? null;
      if (alive) setC(coin);
    })();
    return () => { alive = false; };
  }, [id]);
  // the coin picker is a full screen on phones: no page scroll behind it
  useEffect(() => { if (!picker) return; const prev = document.body.style.overflow; document.body.style.overflow = "hidden"; return () => { document.body.style.overflow = prev; }; }, [picker]);

  const m = useCoinMarket(c, iv, setC);
  const fee = useLaunchFee(c);
  const pick = (x: LiveCoin) => { setPicker(false); router.replace(`/terminal/?c=${x.id}`, { scroll: false }); setC(x); window.scrollTo({ top: 0 }); };

  const side = (
    <>
      <label className="search" style={{ height: 40, flex: "none" }}><ISearch size={15} color="var(--faint)" /><span className="sr">Search</span><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search coin or paste CA" /></label>
      <ScrollTabs gap={4}>{TABS.map((t) => <button key={t} type="button" className={`chip sm${tab === t ? " on" : ""}`} onClick={() => setTab(t)}>{t}</button>)}</ScrollTabs>
      <div className="tl-scroll"><CoinList tab={tab} q={qDebounced} sel={c?.id ?? null} onPick={pick} /></div>
    </>
  );
  const up = (c?.chg ?? 0) >= 0;
  const stats: [string, string, string][] = c ? [["Price", c.price, ""], ["MC", c.mc, ""], ["24h", `${up ? "+" : ""}${c.chg.toFixed(1)}%`, up ? "up" : "down"], ["Vol", c.vol, ""], [c.own ? "In pool" : "Liq", c.liq, ""], ...(c.own && fee.live && fee.fee !== null ? [["Fee now", `${fee.fee.toFixed(1)}%`, "burn"] as [string, string, string]] : [])] : [];

  const trades = (
    <div className="panel trades-few" style={{ padding: 12, gap: 6 }}>
      <span style={{ fontWeight: 700, fontSize: 14 }}>Latest trades{c?.own && !LIVE ? " · testnet" : ""}</span>
      {c?.own ? (
        m.own === null ? <div className="skel" style={{ height: 120, borderRadius: 12 }} /> : m.own.length === 0 ? <span className="dim" style={{ fontSize: 13 }}>No trades yet.</span> :
          m.own.slice(0, 12).map((t) => (
            <div key={t.id} className="mono trade-row">
              <span style={{ color: "var(--text)" }}>{t.who}</span><span className={t.up ? "up" : "down"} style={{ fontWeight: 700 }}>{t.up ? "Buy" : "Sell"}</span><span>{t.amt}</span><span style={{ textAlign: "right", color: "var(--faint)" }}>{ago(t.ts)}</span>
            </div>))
      ) : (
        m.ext === null ? <div className="skel" style={{ height: 120, borderRadius: 12 }} /> : m.ext.length === 0 ? <span className="dim" style={{ fontSize: 13 }}>Trades will show here.</span> :
          m.ext.slice(0, 12).map((t) => (
            <div key={t.id} className="mono trade-row">
              <span style={{ color: "var(--text)" }}>{t.who}</span><span className={t.side === "Buy" ? "up" : "down"} style={{ fontWeight: 700 }}>{t.side}</span><span>{t.usd}</span><span style={{ textAlign: "right", color: "var(--faint)" }}>{ago(t.at)}</span>
            </div>))
      )}
    </div>
  );

  return (
    <div className="term">
      <aside className="panel term-list">{side}</aside>

      <section className="term-main">
        {/* phones: one compact bar that opens the coin switcher */}
        <button type="button" className="term-switch" onClick={() => setPicker(true)} aria-haspopup="dialog">
          {c ? <Avatar name={c.name} c1={c.c1} c2={c.c2} size={30} img={c.image} /> : <span className="skel" style={{ width: 30, height: 30, borderRadius: 9 }} />}
          <span style={{ flex: 1, minWidth: 0, textAlign: "left" }}><b style={{ fontSize: 15 }}>{c?.tick ?? "…"}</b> <span className="mono faint" style={{ fontSize: 11 }}>· switch</span></span>
          <IDown size={14} color="var(--faint)" />
          {c && <span className={`chg ${up ? "u" : "d"}`}>{up ? "+" : ""}{c.chg.toFixed(1)}%</span>}
        </button>

        {!c ? <div className="skel" style={{ height: 64, borderRadius: 14 }} /> : (
          <div className="panel term-head">
            <span className="hide-m" style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
              <Avatar name={c.name} c1={c.c1} c2={c.c2} size={38} img={c.image} />
              <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                <Link href={`/coin/?c=${c.id}`} style={{ fontWeight: 800, fontSize: 16, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.name} <span className="mono dim" style={{ fontWeight: 600, fontSize: 12 }}>{c.tick}</span></Link>
                <span className="mono dim" style={{ fontSize: 11 }}>{c.chain}{c.own && !LIVE ? " testnet" : ""} · {short(c.address)} · {c.age}</span>
              </span>
            </span>
            <span className="term-stats">
              {stats.map(([k, v, cls]) => <span key={k}><i>{k}</i><b className={`mono ${cls}`}>{v}</b></span>)}
            </span>
          </div>
        )}

        <div className="panel" style={{ padding: mobile ? 8 : 12, gap: 8 }}>
          {c?.own && <Intervals value={iv} onChange={setIv} />}
          {c && (c.own ? <TvChart candles={m.candles} supply={1e9} empty="No trades yet for a chart." height={mobile ? 260 : 420} seriesKey={`${c.id}|${iv}`} /> : <ExtChart network={c.network} pool={c.pool} token={c.address} supply={c.priceNum && c.mcNum ? c.mcNum / c.priceNum : null} height={mobile ? 300 : 460} />)}
        </div>

        {c && <div className="show-m"><TradePanel coin={c} onShare={() => shareCoin(c)} /></div>}
        {c && mobile && (
          <div className="seg-tabs" role="tablist">
            <button type="button" role="tab" aria-selected={below === "trades"} className={below === "trades" ? "on" : ""} onClick={() => setBelow("trades")}>Trades</button>
            <button type="button" role="tab" aria-selected={below === "about"} className={below === "about" ? "on" : ""} onClick={() => setBelow("about")}>About</button>
          </div>
        )}
        {(!mobile || below === "trades") && trades}
        {c && mobile && below === "about" && (
          <div className="panel" style={{ padding: 12, gap: 8, fontSize: 13 }}>
            <Link href={`/coin/?c=${c.id}`} className="volt" style={{ fontWeight: 700 }}>Open the full {c.tick} page →</Link>
            <span className="mono dim">{c.chain}{c.own && !LIVE ? " testnet" : ""} · {short(c.address)} · {c.age} old</span>
          </div>
        )}
      </section>

      <aside className="term-trade">
        {c && <TradePanel coin={c} withLimit onShare={() => shareCoin(c)} />}
        {c && !c.own && !LIVE && (
          <div className="card" style={{ gap: 6, padding: 14 }}>
            <span style={{ fontWeight: 700, fontSize: 14 }}>Trading opens on mainnet</span>
            <span className="dim" style={{ fontSize: 13, lineHeight: 1.5 }}>This coin trades on other DEXs. On mainnet you can trade it here with USDC in one tap (1% fee).</span>
          </div>
        )}
      </aside>

      {picker && (
        <div className="term-picker" role="dialog" aria-modal="true" aria-label="Switch coin">
          <div className="term-picker-top"><b>Switch coin</b><button type="button" className="icon-btn" aria-label="Close" onClick={() => setPicker(false)}><IX size={15} /></button></div>
          <div className="term-picker-body">{side}</div>
        </div>
      )}
    </div>
  );
}
export default function TerminalPage() { return <Suspense fallback={<div className="wrap page" />}><TerminalView /></Suspense>; }
