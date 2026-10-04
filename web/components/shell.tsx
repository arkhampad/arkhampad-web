"use client";
import { BrandMark } from "./bits";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { listCoins, recentTrades, useLive, useTradeFeed, type LiveCoin, type LiveTrade } from "@/lib/live";
import { IBell, IChart, IHome, IPlus, ISearch, IUser } from "./icons";
import { SoonModal, FundsModal, WelcomeModal } from "./modals";
import { WalletProvider, useWallet } from "./wallet";
import { Celebrate } from "./celebrate";
import { useRouter } from "next/navigation";
import { findByAddress } from "@/lib/live";

type Ctx = { openLogin: () => void; openSoon: () => void; openFunds: (t: "deposit" | "withdraw") => void; toast: (m: string) => void; loggedIn: boolean };
const AppCtx = createContext<Ctx>({ openLogin: () => {}, openSoon: () => {}, openFunds: () => {}, toast: () => {}, loggedIn: false });
export const useApp = () => useContext(AppCtx);

export function Logo() {
  return (
    <Link href="/" className="logo" aria-label="ArkhamPad home">
      <BrandMark size={34} />
      <span className="logo-text">ArkhamPad</span>
    </Link>
  );
}

function HeaderSearch() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const go = async (text: string) => {
    const t = text.trim();
    if (!t) return;
    if (/^0x[0-9a-fA-F]{40}$/.test(t)) {
      setBusy(true);
      const c = await findByAddress(t).catch(() => null);
      setBusy(false);
      if (c) { router.push(`/coin/?c=${c.id}`); setQ(""); return; }
    }
    router.push(`/terminal/?q=${encodeURIComponent(t)}`);
  };
  return (
    <form className="search" role="search" onSubmit={(e) => { e.preventDefault(); go(q); }}>
      <ISearch size={17} color="var(--faint)" />
      <label className="sr" htmlFor="hdr-search">Search</label>
      <input id="hdr-search" type="search" value={q} onChange={(e) => setQ(e.target.value)} onPaste={(e) => { const t = e.clipboardData.getData("text"); if (/^\s*0x[0-9a-fA-F]{40}\s*$/.test(t)) { e.preventDefault(); setQ(t.trim()); go(t); } }} placeholder={busy ? "Finding coin…" : "Search coins or paste a contract address"} />
    </form>
  );
}

function toggleTheme() {
  const next = document.documentElement.dataset.theme === "light" ? "dark" : "light";
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem("ap_theme", next); } catch { /* storage off */ }
}

function ThemeButton() {
  const [light, setLight] = useState(false);
  useEffect(() => { setLight(document.documentElement.dataset.theme === "light"); }, []);
  const flip = () => {
    const next = light ? "dark" : "light";
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem("ap_theme", next); } catch { /* storage off */ }
    setLight(!light);
  };
  return (
    <button type="button" className="icon-btn theme-btn hide-m" aria-label={light ? "Switch to dark mode" : "Switch to light mode"} title={light ? "Dark mode" : "Light mode"} onClick={flip}>
      {light ? (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--text2)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" /></svg>
      ) : (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--text2)" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="4.2" /><path d="M12 2v2.2M12 19.8V22M4.9 4.9l1.6 1.6M17.5 17.5l1.6 1.6M2 12h2.2M19.8 12H22M4.9 19.1l1.6-1.6M17.5 6.5l1.6-1.6" /></svg>
      )}
    </button>
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
  return <WalletProvider><ShellInner>{children}</ShellInner></WalletProvider>;
}

function Account({ openFunds }: { openFunds: (t: "deposit" | "withdraw") => void }) {
  const w = useWallet();
  const [open, setOpen] = useState(false);
  // "Log in" shows at once; sign-in opens as soon as it has loaded
  if (!w.signedIn) return <button type="button" className="btn white" onClick={w.login}>Log in</button>;
  return (
    <span style={{ position: "relative", display: "flex", gap: 8 }}>
      {w.totalUsdc < 1
        ? <button type="button" className="btn volt" onClick={() => openFunds("deposit")} style={{ height: 44, padding: "0 14px" }}>Get test USDC</button>
        : <button type="button" className="bal" onClick={() => openFunds("deposit")} aria-label="Balance and deposit">${w.totalUsdc.toFixed(2)}<span className="hide-m" style={{ color: "var(--volt-ink)", fontFamily: "var(--sans)", fontSize: 13 }}>+ Deposit</span></button>}
      <button type="button" className="icon-btn" aria-label="Account" aria-expanded={open} onClick={() => setOpen(!open)}><IUser size={18} color="var(--text2)" /></button>
      {open && (
        <span className="card" role="menu" style={{ position: "absolute", right: 0, top: 52, zIndex: 40, width: 230, padding: 8, gap: 2 }} onMouseLeave={() => setOpen(false)}>
          <span className="mono dim" style={{ fontSize: 11, padding: "6px 10px" }}>{w.address?.slice(0, 6)}…{w.address?.slice(-4)}</span>
          <Link href="/profile/" className="tab" style={{ display: "flex", alignItems: "center" }} onClick={() => setOpen(false)}>Profile</Link>
          <button type="button" className="tab" style={{ textAlign: "left" }} onClick={() => { setOpen(false); openFunds("deposit"); }}>Deposit</button>
          <button type="button" className="tab" style={{ textAlign: "left" }} onClick={() => { setOpen(false); openFunds("withdraw"); }}>Withdraw</button>
          <button type="button" className="tab show-m" style={{ textAlign: "left" }} onClick={() => { setOpen(false); toggleTheme(); }}>Light / dark mode</button>
          <button type="button" className="tab" style={{ textAlign: "left", color: "var(--down)" }} onClick={() => { setOpen(false); w.logout(); }}>Log out</button>
        </span>
      )}
    </span>
  );
}

function ShellInner({ children }: { children: React.ReactNode }) {
  const path = usePathname() || "/";
  const w = useWallet();
  const [soon, setSoon] = useState(false);
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
  const ctx: Ctx = { openLogin: w.login, openSoon: () => setSoon(true), openFunds: (t) => (w.signedIn ? setFunds(t) : w.login()), toast, loggedIn: w.signedIn };

  return (
    <AppCtx.Provider value={ctx}>
      <a href="https://x.com/Arkhampad" target="_blank" rel="noopener noreferrer" style={{ display: "block", background: "var(--volt)", color: "var(--on-volt)", textAlign: "center", fontSize: 13, fontWeight: 800, padding: "7px 12px" }}><span className="hide-m">Testnet is open: trade with free test USDC · Mainnet soon · Follow @Arkhampad →</span><span className="show-m">Testnet open · free test USDC · Follow @Arkhampad →</span></a>
      <Ticker />
      <header className="hdr">
        <div className="wrap hdr-in">
          <Logo />
          <nav className="nav" aria-label="Main">
            {NAV.map(([href, label]) => (<Link key={href} href={href} className={isOn(path, href) ? "on" : ""}>{label}</Link>))}
          </nav>
          <HeaderSearch />
          <span style={{ flex: 1 }} className="show-m" />
          <ThemeButton />
          <Link href="/alerts/" className="icon-btn" aria-label="Alerts"><IBell size={18} color="var(--text2)" /></Link>
          <Link href="/create/" className="btn volt hide-m">Create coin</Link>
          <Account openFunds={(t) => setFunds(t)} />
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
      {soon && <SoonModal onClose={() => setSoon(false)} />}
      {funds && <FundsModal tab={funds} setTab={setFunds} onClose={() => setFunds(null)} />}
      <Celebrate toast={toast} />
      {msg && <div className="toast" role="status">{msg}</div>}
    </AppCtx.Provider>
  );
}
