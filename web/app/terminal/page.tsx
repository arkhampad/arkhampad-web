"use client";
import Link from "next/link";
import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { Avatar, Spark } from "@/components/bits";
import { Intervals } from "@/components/trade";
import { TradePanel } from "@/components/tradepanel";
import { IDown, ISearch } from "@/components/icons";
import { ScrollTabs } from "@/components/scrolltabs";
import { getCoin, listCoins, useCoinMarket, useLive, ago, short, shareCoin, prepareCard, type LiveCoin, type Tab } from "@/lib/live";

const TvChart = dynamic(() => import("@/components/tvchart"), { ssr: false, loading: () => <div className="skel" style={{ height: 420, borderRadius: 12 }} /> });
const ExtChart = dynamic(() => import("@/components/extchart"), { ssr: false, loading: () => <div className="skel" style={{ height: 420, borderRadius: 12 }} /> });
const TABS: Tab[] = ["Trending", "New", "Gainers", "Top volume", "Losers", "Launched here", "Bonding", "Graduated"];

function CoinList({ tab, q, sel, onPick }: { tab: Tab; q: string; sel: string | null; onPick: (c: LiveCoin) => void }) {
  const list = useLive(() => listCoins(tab, { limit: 60, q: q || undefined }), [tab, q], 30_000);
  if (!list.data) return <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>{Array.from({ length: 10 }, (_, i) => <div key={i} className="skel" style={{ height: 44, borderRadius: 10 }} />)}</div>;
  if (!list.data.length) return <div className="dim" style={{ fontSize: 13, padding: "10px 6px" }}>No coins found.</div>;
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      {list.data.map((x) => (
        <button key={x.id} type="button" onClick={() => onPick(x)} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 10px", borderRadius: 10, border: 0, background: x.id === sel ? "var(--raise)" : "transparent", textAlign: "left" }}>
          <Avatar name={x.name} c1={x.c1} c2={x.c2} size={30} img={x.image} />
          <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 1 }}><span style={{ fontWeight: 700, fontSize: 13, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{x.tick}</span><span className="mono" style={{ fontSize: 11, color: "var(--faint)" }}>{x.mc}</span></span>
          <span style={{ width: 44 }}><Spark vals={x.spark} up={x.chg >= 0} height={18} fill={false} stroke={2} /></span>
          <span className={`mono ${x.chg >= 0 ? "up" : "down"}`} style={{ fontWeight: 700, fontSize: 12, minWidth: 58, textAlign: "right" }}>{x.chg >= 0 ? "+" : ""}{x.chg.toFixed(1)}%</span>
        </button>
      ))}
    </div>
  );
}

function TerminalView() {
  const q = useSearchParams();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("Trending");
  const [search, setSearch] = useState(q.get("q") || "");
  const [qDebounced, setQ] = useState("");
  const [picker, setPicker] = useState(false);
  const [c, setC] = useState<LiveCoin | null>(null);
  const [iv, setIv] = useState("15m");
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

  const m = useCoinMarket(c, iv, setC);
  const pick = (x: LiveCoin) => { setPicker(false); router.replace(`/terminal/?c=${x.id}`, { scroll: false }); setC(x); window.scrollTo({ top: 0 }); };

  const side = (
    <>
      <label className="search" style={{ height: 38, flex: "none" }}><ISearch size={15} color="var(--faint)" /><span className="sr">Search</span><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search coin or CA" /></label>
      <ScrollTabs gap={2}>{TABS.map((t) => <button key={t} type="button" className={`tab${tab === t ? " on" : ""}`} style={{ height: 30, fontSize: 12, padding: "0 10px", flex: "none" }} onClick={() => setTab(t)}>{t}</button>)}</ScrollTabs>
      <div style={{ maxHeight: "calc(100vh - 230px)", overflowY: "auto", margin: "0 -4px", padding: "0 4px" }}><CoinList tab={tab} q={qDebounced} sel={c?.id ?? null} onPick={pick} /></div>
    </>
  );

  return (
    <div style={{ maxWidth: 1600, margin: "0 auto", padding: "16px 20px 120px", display: "flex", flexWrap: "wrap", gap: 12, alignItems: "flex-start" }}>
      <aside className="panel hide-m" style={{ flex: "1 1 280px", maxWidth: 320, padding: 10, gap: 8, position: "sticky", top: 84 }}>{side}</aside>
      <section style={{ flex: "999 1 560px", minWidth: 0, display: "flex", flexDirection: "column", gap: 12 }}>
        <button type="button" className="show-m" onClick={() => setPicker(!picker)} style={{ display: "flex", alignItems: "center", gap: 10, height: 56, padding: "0 12px", borderRadius: 14, border: "1px solid var(--line2)", background: "var(--field)" }}>
          {c ? <Avatar name={c.name} c1={c.c1} c2={c.c2} size={34} img={c.image} /> : <span className="skel" style={{ width: 34, height: 34, borderRadius: 10 }} />}
          <span style={{ flex: 1, textAlign: "left", display: "flex", flexDirection: "column" }}><span style={{ fontWeight: 800, fontSize: 15 }}>{c?.tick ?? "…"}</span><span className="mono" style={{ fontSize: 11, color: "var(--dim)" }}>Tap to switch coin</span></span><IDown size={16} />
        </button>
        {picker && <div className="panel show-m" style={{ padding: 8, gap: 8 }}>{side}</div>}
        {!c ? <div className="skel" style={{ height: 70, borderRadius: 16 }} /> : (
          <div className="panel" style={{ flexDirection: "row", alignItems: "center", gap: 12, flexWrap: "wrap", padding: "12px 14px" }}>
            <Avatar name={c.name} c1={c.c1} c2={c.c2} size={44} img={c.image} />
            <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
              <Link href={`/coin/?c=${c.id}`} style={{ fontWeight: 900, fontSize: 18 }}>{c.name} <span className="mono dim" style={{ fontWeight: 600, fontSize: 13 }}>{c.tick}</span></Link>
              <span className="mono dim" style={{ fontSize: 12 }}>{c.chain}{c.own ? " testnet" : ""} · {short(c.address)} · {c.age}</span>
            </span>
            <span style={{ flex: 1 }} />
            {[["Price", c.price, ""], ["MC", c.mc, ""], ["24h", `${c.chg >= 0 ? "+" : ""}${c.chg.toFixed(1)}%`, c.chg >= 0 ? "up" : "down"], ["Vol", c.vol, ""], [c.own ? "In curve" : "Liq", c.liq, ""]].map(([k, v, cls]) => (
              <span key={k} className="hide-m" style={{ display: "flex", flexDirection: "column", gap: 2, padding: "0 10px", borderLeft: "1px solid var(--line)" }}><span style={{ fontSize: 11, color: "var(--faint)" }}>{k}</span><span className={`mono ${cls}`} style={{ fontWeight: 700, fontSize: 14 }}>{v}</span></span>
            ))}
            <span className="show-m mono" style={{ fontWeight: 800, fontSize: 22 }}>{c.mc} <span className={c.chg >= 0 ? "up" : "down"} style={{ fontSize: 13 }}>{c.chg >= 0 ? "+" : ""}{c.chg.toFixed(1)}%</span></span>
          </div>
        )}
        <div className="panel" style={{ padding: 12, gap: 8 }}>
          {c?.own && <Intervals value={iv} onChange={setIv} />}
          {c && (c.own ? <TvChart candles={m.candles} supply={1e9} empty="No trades yet for a chart." height={420} seriesKey={`${c.id}|${iv}`} /> : <ExtChart network={c.network} pool={c.pool} height={460} />)}
        </div>
        {c && <div className="show-m" style={{ display: "flex", flexDirection: "column", gap: 12 }}><TradePanel coin={c} onShare={() => shareCoin(c)} /></div>}
        <div className="panel trades-few" style={{ padding: 12, gap: 8 }}>
          <span style={{ fontWeight: 700 }}>Latest trades{c?.own ? " · testnet" : ""}</span>
          {c?.own ? (
            m.own === null ? <div className="skel" style={{ height: 120, borderRadius: 12 }} /> : m.own.length === 0 ? <span className="dim" style={{ fontSize: 13 }}>No trades yet.</span> :
              m.own.slice(0, 12).map((t) => (
                <div key={t.id} className="mono" style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0,1fr))", padding: "9px 0", borderTop: "1px solid var(--line)", fontSize: 13, color: "var(--text2)" }}>
                  <span style={{ color: "var(--text)" }}>{t.who}</span><span className={t.up ? "up" : "down"} style={{ fontWeight: 700 }}>{t.up ? "Buy" : "Sell"}</span><span>{t.amt}</span><span style={{ textAlign: "right", color: "var(--faint)" }}>{ago(t.ts)}</span>
                </div>))
          ) : (
            m.ext === null ? <div className="skel" style={{ height: 120, borderRadius: 12 }} /> : m.ext.length === 0 ? <span className="dim" style={{ fontSize: 13 }}>Trades will show here.</span> :
              m.ext.slice(0, 12).map((t) => (
                <div key={t.id} className="mono" style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0,1fr))", padding: "9px 0", borderTop: "1px solid var(--line)", fontSize: 13, color: "var(--text2)" }}>
                  <span style={{ color: "var(--text)" }}>{t.who}</span><span className={t.side === "Buy" ? "up" : "down"} style={{ fontWeight: 700 }}>{t.side}</span><span>{t.usd}</span><span style={{ textAlign: "right", color: "var(--faint)" }}>{ago(t.at)}</span>
                </div>))
          )}
        </div>
      </section>
      <aside className="hide-m" style={{ flex: "1 1 320px", maxWidth: 380, minWidth: 0, display: "flex", flexDirection: "column", gap: 12, position: "sticky", top: 84 }}>
        {c && <TradePanel coin={c} withLimit onShare={() => shareCoin(c)} />}
        {c && !c.own && (
          <div className="card" style={{ gap: 6, padding: 14 }}>
            <span style={{ fontWeight: 700, fontSize: 14 }}>Trading opens on mainnet</span>
            <span className="dim" style={{ fontSize: 13, lineHeight: 1.5 }}>This coin trades on other DEXs. On mainnet you can trade it here with USDC in one tap (1% fee).</span>
          </div>
        )}
      </aside>
    </div>
  );
}
export default function TerminalPage() { return <Suspense fallback={<div className="wrap page" />}><TerminalView /></Suspense>; }
