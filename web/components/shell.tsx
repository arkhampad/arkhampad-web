"use client";
import { BrandMark } from "./bits";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { listCoins, recentTrades, useLive, useTradeFeed, type LiveCoin, type LiveTrade } from "@/lib/live";
import { IBell, IChart, IHome, IPlus, ISearch, IUser } from "./icons";
import { LoginModal, FundsModal, WelcomeModal } from "./modals";

type Ctx = { openLogin: () => void; openFunds: (t: "deposit" | "withdraw") => void; toast: (m: string) => void; loggedIn: boolean };
const AppCtx = createContext<Ctx>({ openLogin: () => {}, openFunds: () => {}, toast: () => {}, loggedIn: false });
export const useApp = () => useContext(AppCtx);

export function Logo() {
  return (
    <Link href="/" className="logo" aria-label="ArkhamPad home">
      <BrandMark size={34} />
      <span className="logo-text">ArkhamPad</span>
    </Link>
  );
}

const NAV = [["/", "Discover"], ["/terminal/", "Terminal"], ["/traders/", "Traders"], ["/analytics/", "Analytics"], ["/learn/", "Learn"]] as const;

function Ticker() {
  // Latest testnet trades on ArkhamPad, topped up with what's trending on other DEXs.
  const trades = useLive<LiveTrade[]>(() => recentTrades(10), [], 0);
  const trend = useLive<LiveCoin[]>(() => listCoins("Trending", { limit: 12 }), [], 120_000);
  useTradeFeed(() => trades.reload());
  type Item = { k: string; up: boolean; who?: string; act?: string; amt: string; tick: string; href: string };
  const items: Item[] = [
    ...(trades.data ?? []).map((t) => ({ k: t.id, up: t.up, who: t.who, act: t.act, amt: t.amt, tick: t.tick, href: `/coin/?c=${t.chainId}-${t.coin}` })),
    ...(trend.data ?? []).map((c) => ({ k: c.id, up: c.chg >= 0, amt: `${c.chg >= 0 ? "+" : ""}${c.chg.toFixed(1)}%`, tick: c.tick, href: `/coin/?c=${c.id}` })),
  ];
  if (!items.length) return <div className="ticker" aria-hidden="true" />;
  const list = [...items, ...items];
  return (
    <div className="ticker" aria-label="Live market">
      <div className="ticker-track">
        {list.map((t, i) => (
          <Link key={`${t.k}-${i}`} href={t.href} style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
            <span className="dot" style={{ background: t.up ? "var(--up)" : "var(--down)" }} />
            {t.who ? <><span style={{ color: "var(--text2)" }}>{t.who}</span>{t.act}<span className={t.up ? "up" : "down"}>{t.amt}</span>{t.tick}</> : <><span style={{ color: "var(--text2)" }}>{t.tick}</span><span className={t.up ? "up" : "down"}>{t.amt}</span></>}
          </Link>
        ))}
      </div>
    </div>
  );
}

function isOn(path: string, href: string) {
  if (href === "/") return path === "/" ;
  return path.startsWith(href.replace(/\/$/, ""));
}

export function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname() || "/";
  const [login, setLogin] = useState(false);
  const [funds, setFunds] = useState<null | "deposit" | "withdraw">(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [welcome, setWelcome] = useState(false);
  useEffect(() => {
    try {
      if (!localStorage.getItem("ap_welcome_seen")) setWelcome(true);
    } catch { setWelcome(true); }
  }, []);
  const closeWelcome = () => { setWelcome(false); try { localStorage.setItem("ap_welcome_seen", "1"); } catch { /* storage off */ } };
  const toast = useCallback((m: string) => { setMsg(m); }, []);
  useEffect(() => { if (!msg) return; const t = setTimeout(() => setMsg(null), 2200); return () => clearTimeout(t); }, [msg]);
  const ctx: Ctx = { openLogin: () => setLogin(true), openFunds: (t) => setFunds(t), toast, loggedIn: false };

  return (
    <AppCtx.Provider value={ctx}>
      <a href="https://x.com/Arkhampad" target="_blank" rel="noopener noreferrer" style={{ display: "block", background: "var(--volt)", color: "var(--bg)", textAlign: "center", fontSize: 13, fontWeight: 800, padding: "7px 12px" }}>Testnet live · Mainnet soon · Follow @Arkhampad on X for the latest updates →</a>
      <Ticker />
      <header className="hdr">
        <div className="wrap hdr-in">
          <Logo />
          <nav className="nav" aria-label="Main">
            {NAV.map(([href, label]) => (<Link key={href} href={href} className={isOn(path, href) ? "on" : ""}>{label}</Link>))}
          </nav>
          <label className="search">
            <ISearch size={17} color="var(--faint)" />
            <span className="sr">Search</span>
            <input type="search" placeholder="Search coins, traders or contract address" />
          </label>
          <span style={{ flex: 1 }} className="show-m" />
          <Link href="/alerts/" className="icon-btn" aria-label="Alerts"><IBell size={18} color="var(--text2)" /></Link>
          <Link href="/create/" className="btn volt hide-m">Create coin</Link>
          <button type="button" className="btn white" onClick={() => setLogin(true)}>Log in</button>
        </div>
      </header>
      <main id="main">{children}</main>
      <nav className="bnav show-m" aria-label="Bottom">
        <Link href="/" className={path === "/" ? "on" : ""}><IHome size={22} />Discover</Link>
        <Link href="/terminal/" className={isOn(path, "/terminal/") ? "on" : ""}><IChart size={22} />Terminal</Link>
        <Link href="/create/" aria-label="Create coin" style={{ flex: 1, display: "flex", justifyContent: "center" }}><span className="plus"><IPlus size={24} color="#0A0B10" w={2.6} /></span></Link>
        <Link href="/alerts/" className={isOn(path, "/alerts/") ? "on" : ""}><IBell size={22} />Alerts</Link>
        <Link href="/profile/" className={isOn(path, "/profile/") ? "on" : ""}><IUser size={22} />Profile</Link>
      </nav>
      {welcome && <WelcomeModal onClose={closeWelcome} />}
      {login && <LoginModal onClose={() => setLogin(false)} />}
      {funds && <FundsModal tab={funds} setTab={setFunds} onClose={() => setFunds(null)} />}
      {msg && <div className="toast" role="status">{msg}</div>}
    </AppCtx.Provider>
  );
}
