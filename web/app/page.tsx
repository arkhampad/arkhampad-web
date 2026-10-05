"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { listCoins, listPromoted, recentTrades, totalCoins, useLive, useTradeFeed, ago, type LiveCoin, type LiveTrade, type Tab } from "@/lib/live";
import { Avatar as Av } from "@/components/bits";
import { Avatar, sparkUseful } from "@/components/bits";
import { CoinRows, CoinTable, HotCard } from "@/components/market";
import { ScrollTabs } from "@/components/scrolltabs";
import { board, traderColors } from "@/lib/traders";
import { useRouter } from "next/navigation";
import { useWallet } from "@/components/wallet";
import { useApp } from "@/components/shell";
import { FinderBar, FinderResults, useFinder } from "@/components/finder";

const TABS: Tab[] = ["Trending", "New", "Gainers", "Top volume", "Losers", "Launched here", "Bonding", "Graduated"];
const CATS = ["All", "AI", "Animals", "Gaming", "Culture", "Base", "Robinhood", "BNB", "Arc"];
const PAGE = 50;

function Skeleton({ rows = 8 }: { rows?: number }) {
  return <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>{Array.from({ length: rows }, (_, i) => <div key={i} className="skel" style={{ height: 52, borderRadius: 12 }} />)}</div>;
}

export default function Discover() {
  const w = useWallet();
  const { openFunds } = useApp();
  const router = useRouter();
  const fx = useFinder();
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

  // Hot right now: a mixed pool (trending, gainers, active coins launched here), shuffled per
  // visit and rotated, so the same three coins don't sit there all day.
  const pool = useLive(async () => {
    const [tr, ga, own] = await Promise.all([
      listCoins("Trending", { limit: 30 }).catch(() => [] as LiveCoin[]),
      listCoins("Gainers", { limit: 12 }).catch(() => [] as LiveCoin[]),
      listCoins("Launched here", { limit: 20 }).catch(() => [] as LiveCoin[]),
    ]);
    const seen = new Set<string>();
    const all = [...own.filter((c) => (c.volNum ?? 0) > 0), ...tr, ...ga].filter((c) => (seen.has(c.id) ? false : (seen.add(c.id), true)));
    for (let i = all.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [all[i], all[j]] = [all[j], all[i]]; }
    // coins with a picture and a real price line look best up top
    return all.sort((a, b) => Number(!!b.image && sparkUseful(b.spark)) - Number(!!a.image && sparkUseful(a.spark)));
  }, [], 300_000);
  const [hotAt, setHotAt] = useState(0);
  useEffect(() => { const t = setInterval(() => setHotAt((i) => i + 3), 45_000); return () => clearInterval(t); }, []);
  const hotList = pool.data ?? null;
  const hot = { data: hotList && hotList.length ? [0, 1, 2].map((k) => hotList[(hotAt + k) % hotList.length]).filter((c, i, arr) => arr.findIndex((x) => x.id === c.id) === i) : hotList };
  const almost = useLive(async () => (await listCoins("Bonding", { limit: 30 })).filter((c) => c.progress >= 50).sort((a, b) => b.progress - a.progress).slice(0, 3), [], 60_000);
  const total = useLive(totalCoins, [], 120_000);
  const promoted = useLive(listPromoted, [], 60_000);
  const tops = useLive(() => board(7, 10), [], 120_000);
  const hasGrad = (almost.data?.length ?? 0) > 0;
  const live = useLive<LiveTrade[]>(() => recentTrades(8), [], 0);
  useTradeFeed(() => live.reload());

  const go = (e?: React.FormEvent) => { e?.preventDefault(); router.push(`/create/?idea=${encodeURIComponent(idea)}`); };

  return (
    <div className="wrap page">
      {/* phones: a short header; the full hero (with the idea box) is for bigger screens */}
      {/* phones: your balance and Deposit when signed in (app-style), otherwise a short title */}
      <section className="show-m m-bal">
        {w.signedIn ? (
          <>
            <span style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
              <span className="dim" style={{ fontSize: 13 }}>Total balance</span>
              <b className="mono m-bal-v">${Math.floor(w.totalUsdc).toLocaleString("en-US")}<span>.{(w.totalUsdc % 1).toFixed(2).slice(2)}</span></b>
              <span className="dim" style={{ fontSize: 12 }}>Test USDC on Robinhood and Base</span>
            </span>
            <button type="button" className="btn volt" style={{ height: 40, padding: "0 20px" }} onClick={() => openFunds("deposit")}>Deposit</button>
          </>
        ) : (
          <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, letterSpacing: -0.4 }}>Markets</h1>
            <span className="dim" style={{ fontSize: 13 }}>{total.data ? <><b className="mono" style={{ color: "var(--text)" }}>{total.data.toLocaleString("en-US")}</b> tokens on Robinhood, Base and BNB</> : "Tokens on Robinhood, Base and BNB"}</span>
          </span>
        )}
      </section>
      {/* web: a compact terminal-style header row instead of a big marketing hero */}
      <section className="hide-m mk-head">
        <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, letterSpacing: -0.4 }}>Markets</h1>
          <span className="dim" style={{ fontSize: 13 }}>{total.data ? <><b className="mono" style={{ color: "var(--text)" }}>{total.data.toLocaleString("en-US")}</b> tokens · Robinhood, Base, BNB</> : "Robinhood, Base, BNB"}</span>
        </span>
        <form onSubmit={go} className="mk-launch">
          <label htmlFor="idea" className="sr">Describe a new token</label>
          <input id="idea" value={idea} onChange={(e) => setIdea(e.target.value)} placeholder="Launch a token: describe it in one sentence" />
          <button type="submit" className="btn volt" style={{ height: 34, padding: "0 14px", fontSize: 13 }}>Create</button>
        </form>
      </section>

      {promoted.data && promoted.data.length > 0 && (
        <section style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <span className="dim" style={{ fontSize: 12, fontWeight: 700, letterSpacing: 0.4 }}>PROMOTED</span>
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

      <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div className="feat-head"><h2>Hot right now</h2></div>
        {!hot.data ? <div className="feat-row">{[0, 1, 2].map((i) => <div key={i} className="skel" style={{ height: 120, borderRadius: 16, minWidth: 236 }} />)}</div> :
          <div className="feat-row">{hot.data.map((c) => <HotCard key={c.id} c={c} />)}</div>}
      </section>
      {hasGrad && almost.data && (
        <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div className="feat-head"><h2>Almost graduating</h2></div>
          <div className="feat-row">{almost.data.map((c) => <HotCard key={c.id} c={c} grad />)}</div>
        </section>
      )}

      <section className="row">
        <div className="main-col">
          <FinderBar fx={fx} />
          {fx.active ? <FinderResults fx={fx} /> : <>
          <div className="ttabs"><ScrollTabs gap={0}>{TABS.map((t) => <button key={t} type="button" className={`ttab${tab === t ? " on" : ""}`} onClick={() => setTab(t)}>{t}</button>)}</ScrollTabs></div>
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
            <span className="dim" style={{ fontSize: 13 }}>Coins from other DEXs are shown for discovery. Trading them here opens on mainnet.</span>
            {more && list && list.length > 0 && <button type="button" className="btn" disabled={busy} onClick={() => load(list.length)}>{busy ? "Loading…" : "Load more"}</button>}
          </div>
          </>}
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
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}><span style={{ fontWeight: 700 }}>Top traders <span className="dim" style={{ fontWeight: 500, fontSize: 12 }}>· 7d</span></span><Link href="/traders/" className="volt" style={{ fontSize: 13 }}>See all</Link></div>
            {(tops.data ?? []).length === 0 ? <span className="dim" style={{ fontSize: 13 }}>No trades this week yet.</span> : (tops.data ?? []).slice(0, 4).map((t, i) => (
              <Link key={t.trader} href={`/trader/?a=${t.trader}`} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span className="mono dim" style={{ fontSize: 12, width: 14 }}>{i + 1}</span>
                <span className="av" style={{ width: 32, height: 32, borderRadius: "50%", background: `linear-gradient(135deg, ${traderColors(t.trader)[0]}, ${traderColors(t.trader)[1]})`, fontSize: 11 }}>{t.trader.slice(2, 4).toUpperCase()}</span>
                <span className="mono" style={{ flex: 1, fontWeight: 600, fontSize: 13 }}>{t.trader.slice(0, 6)}…{t.trader.slice(-4)}</span>
                <span className={`mono ${t.pnl >= 0 ? "up" : "down"}`} style={{ fontWeight: 700, fontSize: 13 }}>{t.pnl >= 0 ? "+" : "-"}${Math.abs(t.pnl).toFixed(2)}</span>
              </Link>
            ))}
            <Link href="/traders/" className="btn ghost sm" style={{ height: 40 }}>Follow and copy with one tap</Link>
          </div>
          <div className="card invite-card">
            <span style={{ fontWeight: 800, fontSize: 17 }}>Invite friends, earn on every trade</span>
            <span style={{ fontSize: 13, lineHeight: 1.45 }}>You get a share of our fee on everything your friends trade.</span>
            <Link href="/invite/" className="btn ghost sm" style={{ alignSelf: "flex-start", height: 36 }}>Get my link</Link>
          </div>
        </aside>
      </section>
    </div>
  );
}
