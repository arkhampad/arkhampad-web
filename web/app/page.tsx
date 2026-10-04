"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { traders } from "@/lib/mock";
import { listCoins, listPromoted, recentTrades, totalCoins, useLive, useTradeFeed, ago, type LiveCoin, type LiveTrade, type Tab } from "@/lib/live";
import { Avatar as Av } from "@/components/bits";
import { Avatar } from "@/components/bits";
import { CoinRows, CoinTable, HotCard } from "@/components/market";
import { IFire, ISpark } from "@/components/icons";
import { ScrollTabs } from "@/components/scrolltabs";
import { useRouter } from "next/navigation";

const TABS: Tab[] = ["Trending", "New", "Gainers", "Top volume", "Losers", "Launched here", "Bonding", "Graduated"];
const CATS = ["All", "AI", "Animals", "Gaming", "Culture", "Base", "Robinhood", "BNB", "Arc"];
const IDEAS = ["Funny animal", "Internet meme", "Robot / AI", "Sports", "Surprise me"];
const PAGE = 50;

function Skeleton({ rows = 8 }: { rows?: number }) {
  return <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>{Array.from({ length: rows }, (_, i) => <div key={i} className="skel" style={{ height: 52, borderRadius: 12 }} />)}</div>;
}

export default function Discover() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("Trending");
  const [cat, setCat] = useState("All");
  const [idea, setIdea] = useState("");
  const [list, setList] = useState<LiveCoin[] | null>(null);
  const [more, setMore] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const chain = cat === "Base" || cat === "Robinhood" || cat === "BNB" || cat === "Arc" ? cat : null;
  const topic = chain || cat === "All" ? null : cat;

  const load = useCallback(async (offset: number) => {
    setBusy(true);
    try {
      const rows = await listCoins(tab, { chain, cat: topic, limit: PAGE, offset });
      setList((cur) => (offset === 0 ? rows : [...(cur ?? []), ...rows]));
      setMore(rows.length === PAGE);
      setErr(null);
    } catch (e) {
      setErr(String((e as Error)?.message || e));
      if (offset === 0) setList([]);
    } finally { setBusy(false); }
  }, [tab, chain, topic]);

  useEffect(() => { setList(null); load(0); }, [load]);
  // keep the first page fresh
  useEffect(() => { const iv = setInterval(() => { if ((list?.length ?? 0) <= PAGE) load(0); }, 20_000); return () => clearInterval(iv); }, [load, list?.length]);

  const hot = useLive(() => listCoins("Trending", { limit: 3 }), [], 30_000);
  const almost = useLive(async () => (await listCoins("Bonding", { limit: 30 })).filter((c) => c.progress >= 50).sort((a, b) => b.progress - a.progress).slice(0, 3), [], 60_000);
  const total = useLive(totalCoins, [], 120_000);
  const promoted = useLive(listPromoted, [], 60_000);
  const [feat, setFeat] = useState<"hot" | "grad">("hot");
  const hasGrad = (almost.data?.length ?? 0) > 0;
  // Hot right now and Almost graduating take turns every 2 minutes.
  useEffect(() => { if (!hasGrad) { setFeat("hot"); return; } const t = setInterval(() => setFeat((f) => (f === "hot" ? "grad" : "hot")), 120_000); return () => clearInterval(t); }, [hasGrad]);
  const featured = feat === "grad" && hasGrad ? almost.data : hot.data;
  const live = useLive<LiveTrade[]>(() => recentTrades(8), [], 0);
  useTradeFeed(() => live.reload());

  const go = (e?: React.FormEvent) => { e?.preventDefault(); router.push(`/create/?idea=${encodeURIComponent(idea)}`); };

  return (
    <div className="wrap page">
      <section style={{ padding: "8px 0 2px", display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", gap: 12 }}>
        <h1 className="hero-h1" style={{ margin: 0, fontSize: "clamp(28px, 4.2vw, 48px)", lineHeight: 1.04, fontWeight: 900, letterSpacing: "-0.035em", maxWidth: 900 }}>
          Create and trade with <span className="grad-text" style={{ background: "linear-gradient(90deg, var(--volt), var(--mint))", WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent" }}>intelligence.</span>
        </h1>
        <p className="h-sub hide-m" style={{ maxWidth: 560, fontSize: 15 }}>Type an idea, get a ready coin. Trade thousands of coins with USDC.</p>
        {total.data ? (
          <span className="pill mono" style={{ border: "1px solid var(--line2)", color: "var(--text2)", fontSize: 13, padding: "6px 12px" }}>
            <span className="dot" style={{ background: "var(--up)", boxShadow: "0 0 0 3px rgba(61,220,151,0.18)" }} />
            <b style={{ color: "var(--text)" }}>{total.data.toLocaleString("en-US")}</b> coins to trade
          </span>
        ) : null}
        <form onSubmit={go} style={{ width: "100%", maxWidth: 720, display: "flex", alignItems: "center", gap: 10, padding: "6px 6px 6px 16px", borderRadius: 16, background: "var(--field)", border: "1px solid var(--line3)", flexWrap: "wrap" }}>
          <ISpark size={20} color="var(--volt-ink)" />
          <label htmlFor="idea" className="sr">Describe your coin</label>
          <input id="idea" value={idea} onChange={(e) => setIdea(e.target.value)} placeholder="Describe your coin… a frog astronaut who only buys the dip" style={{ flex: "1 1 220px", minWidth: 0, height: 42, background: "transparent", border: 0, outline: "none", fontSize: 16 }} />
          <button type="submit" className="btn volt" style={{ height: 44, padding: "0 20px", fontSize: 14, borderRadius: 12 }}>Generate coin</button>
        </form>
        <div className="hide-m" style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
          {IDEAS.map((t) => <button key={t} type="button" className="chip sm" onClick={() => router.push(`/create/?idea=${encodeURIComponent(t)}`)}>{t}</button>)}
        </div>
      </section>

      {promoted.data && promoted.data.length > 0 && (
        <section style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <span className="dim" style={{ fontSize: 12, fontWeight: 700, letterSpacing: 0.4 }}>🚀 PROMOTED</span>
          <div className="hscroll" style={{ gap: 10 }}>
            {promoted.data.map((c) => (
              <Link key={c.id} href={`/coin/?c=${c.id}`} className="card" style={{ flex: "none", flexDirection: "row", alignItems: "center", gap: 10, padding: "10px 14px", borderRadius: 16, minWidth: 220 }}>
                <Av name={c.name} c1={c.c1} c2={c.c2} size={36} img={c.image} />
                <span style={{ display: "flex", flexDirection: "column", minWidth: 0, flex: 1 }}><b style={{ fontSize: 14, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.name}</b><span className="mono dim" style={{ fontSize: 11 }}>{c.tick} · {c.mc}</span></span>
                <span className={`mono ${c.chg >= 0 ? "up" : "down"}`} style={{ fontSize: 12, fontWeight: 700 }}>{c.chg >= 0 ? "+" : ""}{c.chg.toFixed(1)}%</span>
              </Link>
            ))}
          </div>
        </section>
      )}

      <section style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <button type="button" className={`tab${feat === "hot" || !hasGrad ? " on" : ""}`} style={{ height: 40, fontSize: 18, fontWeight: 800, display: "flex", alignItems: "center", gap: 8 }} onClick={() => setFeat("hot")}><IFire size={18} color="var(--burn)" />Hot right now</button>
          {hasGrad && <button type="button" className={`tab${feat === "grad" ? " on" : ""}`} style={{ height: 40, fontSize: 18, fontWeight: 800 }} onClick={() => setFeat("grad")}>🎓 Almost graduating</button>}
        </div>
        {!featured ? <div className="grid3">{[0, 1, 2].map((i) => <div key={i} className="skel" style={{ height: 300, borderRadius: 22 }} />)}</div> : (
          <>
            <div className="grid3 hide-m">{featured.map((c) => <HotCard key={c.id} c={c} grad={feat === "grad" && hasGrad} />)}</div>
            <div className="hscroll show-m" style={{ gap: 12, margin: "0 -16px", padding: "0 16px" }}>{featured.map((c) => <div key={c.id} style={{ flex: "none", width: 280 }}><HotCard c={c} grad={feat === "grad" && hasGrad} /></div>)}</div>
          </>
        )}
      </section>

      <section className="row">
        <div className="main-col">
          <ScrollTabs>{TABS.map((t) => <button key={t} type="button" className={`chip${tab === t ? " on" : ""}`} onClick={() => setTab(t)}>{t}</button>)}</ScrollTabs>
          <ScrollTabs gap={6}>{CATS.map((t) => <button key={t} type="button" className={`chip sm${cat === t ? " on" : ""}`} onClick={() => setCat(t)}>{t}</button>)}</ScrollTabs>
          {(tab === "Launched here" || tab === "Bonding" || tab === "Graduated") && (
            <div className="dim" style={{ fontSize: 13 }}>Coins launched on ArkhamPad. We are on testnet now: these are test coins with test money.</div>
          )}
          {list === null ? <Skeleton /> : list.length === 0 ? (
            <div className="card" style={{ alignItems: "center", textAlign: "center", padding: 28 }}>
              <span style={{ fontWeight: 700 }}>{err ? "Couldn't load coins right now" : chain ? `${chain} coins are loading` : "No coins here yet"}</span>
              <span className="dim" style={{ fontSize: 13 }}>{err ? "Please try again in a moment." : chain ? `New ${chain} coins show up here as soon as they trade.` : "Check another tab, or launch the first one."}</span>
            </div>
          ) : (
            <>
              <div className="hide-m"><CoinTable list={list} /></div>
              <div className="show-m" style={{ margin: "0 -16px" }}><CoinRows list={list} /></div>
            </>
          )}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
            <span className="dim" style={{ fontSize: 13 }}>Coins from other DEXs are shown for discovery. Trading opens at launch.</span>
            {more && list && list.length > 0 && <button type="button" className="btn" disabled={busy} onClick={() => load(list.length)}>{busy ? "Loading…" : "Load more"}</button>}
          </div>
        </div>
        <aside className="side-col">
          <div className="card">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}><span style={{ fontWeight: 700 }}>Live trades <span className="dim" style={{ fontWeight: 500, fontSize: 12 }}>· testnet</span></span><span className="mono up" style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, fontWeight: 600 }}><span className="dot" style={{ background: "var(--up)" }} />Live</span></div>
            {live.data && live.data.length === 0 && <span className="dim" style={{ fontSize: 13 }}>No trades yet.</span>}
            {(live.data ?? []).map((t) => (
              <Link key={t.id} href={`/coin/?c=${t.chainId}-${t.coin}`} className="mono" style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: "var(--muted)" }}><span><span style={{ color: "var(--text)" }}>{t.who}</span> {t.act}</span><span><span className={t.up ? "up" : "down"}>{t.amt}</span> {t.tick} <span style={{ color: "var(--faint)" }}>{ago(t.ts)}</span></span></Link>
            ))}
          </div>
          <div className="card">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}><span style={{ fontWeight: 700 }}>Top traders <span className="dim" style={{ fontWeight: 500, fontSize: 12 }}>· preview</span></span><Link href="/traders/" className="volt" style={{ fontSize: 13 }}>See all</Link></div>
            {traders.slice(0, 4).map((t) => (
              <div key={t.name} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span className="mono dim" style={{ fontSize: 12, width: 14 }}>{t.rank}</span><Avatar name={t.name} c1={t.c1} c2={t.c2} size={32} round />
                <span style={{ flex: 1, fontWeight: 600, fontSize: 14 }}>{t.name}</span>
                <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}><span className="mono up" style={{ fontWeight: 700, fontSize: 13 }}>{t.pnl}</span><span className="mono" style={{ fontSize: 11, color: "var(--faint)" }}>win {t.win}</span></span>
              </div>
            ))}
            <Link href="/traders/" className="btn ghost sm" style={{ height: 40 }}>Follow and copy with one tap</Link>
          </div>
          <div className="card" style={{ background: "var(--volt)", color: "var(--on-volt)", border: 0 }}>
            <span style={{ fontWeight: 800, fontSize: 17 }}>Invite friends, earn on every trade</span>
            <span style={{ fontSize: 13, lineHeight: 1.45 }}>You get a share of our fee on everything your friends trade.</span>
            <Link href="/profile/" className="btn" style={{ alignSelf: "flex-start", height: 38, background: "var(--bg)", color: "var(--text)", border: 0 }}>Get my link</Link>
          </div>
        </aside>
      </section>
    </div>
  );
}
