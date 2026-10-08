"use client";
import { StatusBar } from "./v2";
import { BrandMark } from "./bits";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { useProfile } from "@/lib/profiles";
import { traderColors } from "@/lib/traders";
import { listCoins, recentTrades, useLive, useTradeFeed, type LiveCoin, type LiveTrade } from "@/lib/live";
import { IBell, IChart, IHome, IPlus, ISearch, IUser } from "./icons";
import { FundsModal, WelcomeModal } from "./modals";
import { WalletProvider, useWallet } from "./wallet";
import { OrderWatcher } from "./orders";
import { CopyAlerts } from "./social";
import { useInbox } from "./alerts";
import { RefLinker } from "./community";
import { useRouter } from "next/navigation";
import { findByAddress } from "@/lib/live";
import { NETS, LIVE, NET_NAMES } from "@/lib/chain";

type Ctx = { openLogin: () => void; openFunds: (t: "deposit" | "withdraw") => void; toast: (m: string) => void; loggedIn: boolean };
const AppCtx = createContext<Ctx>({ openLogin: () => {}, openFunds: () => {}, toast: () => {}, loggedIn: false });
// a mainnet network in the list (Robinhood Chain, Base or BNB) -> the top strip says we are live

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

function Bell() {
  const w = useWallet();
  const { data } = useInbox();
  const n = w.signedIn ? data?.unread ?? 0 : 0;
  return (
    <Link href="/alerts/" className="icon-btn" aria-label={n ? `Alerts, ${n} new` : "Alerts"} style={{ position: "relative" }}>
      <IBell size={18} color="var(--text2)" />
      {n > 0 && <span className="mono" style={{ position: "absolute", top: -4, right: -4, minWidth: 18, height: 18, padding: "0 5px", borderRadius: 9, background: "var(--down)", color: "#fff", fontSize: 10, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center" }}>{n > 99 ? "99+" : n}</span>}
    </Link>
  );
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
    <button type="button" className="icon-btn theme-btn" aria-label={light ? "Switch to dark mode" : "Switch to light mode"} title={light ? "Dark mode" : "Light mode"} onClick={flip}>
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

function Footer() {
  return (
    <footer className="foot">
      <div className="wrap foot-in">
        <span style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontWeight: 800, fontSize: 14 }}>ArkhamPad</span>
          <span style={{ fontSize: 12, color: "var(--faint)", maxWidth: 420, lineHeight: 1.5 }}>Meme coins are very risky. Nothing on ArkhamPad is financial advice.</span>
          <span style={{ fontSize: 12, color: "var(--text2)", maxWidth: 420, lineHeight: 1.5, fontWeight: 600 }}>ArkhamPad has no official token yet. Any coin using the ArkhamPad or Arkham name is not ours. Official news comes only from @Arkhampad.</span>
        </span>
        <nav aria-label="Footer">
          <Link href="/learn/">Learn</Link>
          <Link href="/help/">Help</Link>
          <Link href="/help/#fees">Fees</Link>
          <Link href="/security/">Security</Link>
          <a href="/tokens.json">Token list</a>
          <Link href="/terms/">Terms</Link>
          <Link href="/privacy/">Privacy</Link>
          <a href="https://x.com/Arkhampad" target="_blank" rel="noopener noreferrer">X</a>
          <a href="mailto:team@arkhampad.com">team@arkhampad.com</a>
        </nav>
      </div>
    </footer>
  );
}

export function Shell({ children }: { children: React.ReactNode }) {
  return <WalletProvider><ShellInner>{children}</ShellInner></WalletProvider>;
}

function Account({ openFunds }: { openFunds: (t: "deposit" | "withdraw") => void }) {
  const w = useWallet();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLSpanElement>(null);
  // closes when you tap anywhere else, press Escape or move to another page
  useEffect(() => {
    if (!open) return;
    const away = (e: Event) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("pointerdown", away); document.removeEventListener("keydown", key); };
  }, [open]);
  const path = usePathname();
  useEffect(() => { setOpen(false); }, [path]);
  const me = useProfile(w.address);
  // "Log in" shows at once; sign-in opens as soon as it has loaded
  if (!w.signedIn) return <button type="button" className="btn white" onClick={w.login}>Log in</button>;
  return (
    <span ref={box} style={{ position: "relative", display: "flex", gap: 8 }}>
      {w.totalUsdc < 1
        ? <button type="button" className="btn volt" onClick={() => openFunds("deposit")} style={{ height: 44, padding: "0 14px" }}>{LIVE ? "Add USDC" : "Get test USDC"}</button>
        : <button type="button" className="bal" onClick={() => openFunds("deposit")} aria-label="Balance and deposit">${w.totalUsdc.toFixed(2)}<span className="hide-m" style={{ color: "var(--volt-ink)", fontFamily: "var(--sans)", fontSize: 13 }}>+ Deposit</span></button>}
      <button type="button" className="icon-btn acct-btn" aria-label="Account menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        {me?.avatar ? <img src={me.avatar} alt="" /> : <span className="acct-av" style={{ background: `linear-gradient(135deg, ${traderColors(w.address ?? "0x00")[0]}, ${traderColors(w.address ?? "0x00")[1]})` }}>{(me?.name || w.address?.slice(2, 4) || "").slice(0, 2).toUpperCase()}</span>}
      </button>
      {open && (
        <span className="card" role="menu" style={{ position: "absolute", right: 0, top: 52, zIndex: 40, width: 230, padding: 8, gap: 2 }}>
          <span style={{ display: "flex", flexDirection: "column", padding: "6px 10px" }}>{me?.name && <b style={{ fontSize: 14 }}>{me.name}</b>}<span className="mono dim" style={{ fontSize: 11 }}>{w.address?.slice(0, 6)}…{w.address?.slice(-4)}</span></span>
          <Link href="/profile/" className="tab" style={{ display: "flex", alignItems: "center" }} onClick={() => setOpen(false)}>Profile</Link>
          <button type="button" className="tab" style={{ textAlign: "left" }} onClick={() => { setOpen(false); openFunds("deposit"); }}>Deposit</button>
          <button type="button" className="tab" style={{ textAlign: "left" }} onClick={() => { setOpen(false); openFunds("withdraw"); }}>Withdraw</button>
          <Link href="/invite/" className="tab" style={{ textAlign: "left" }} onClick={() => setOpen(false)}>Invite & earn</Link>
          <Link href="/help/" className="tab" style={{ textAlign: "left" }} onClick={() => setOpen(false)}>Help</Link>
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
  const ctx: Ctx = { openLogin: w.login, openFunds: (t) => (w.signedIn ? setFunds(t) : w.login()), toast, loggedIn: w.signedIn };

  return (
    <AppCtx.Provider value={ctx}>
      <a className="testnet-strip" href="https://x.com/Arkhampad" target="_blank" rel="noopener noreferrer" style={{ display: "block", background: "var(--volt)", color: "var(--on-volt)", textAlign: "center", fontSize: 13, fontWeight: 800, padding: "7px 12px" }}>{LIVE ? <><span className="hide-m">Live on {NET_NAMES} · Follow @Arkhampad →</span><span className="show-m">Live on {NET_NAMES} · Follow @Arkhampad →</span></> : <><span className="hide-m">Testnet is open: trade with free test USDC · Mainnet soon · Follow @Arkhampad →</span><span className="show-m">Testnet open · free test USDC · Follow @Arkhampad →</span></>}</a>
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
          <Bell />
          <Link href="/create/" className="btn volt hide-m">Create coin</Link>
          <Account openFunds={(t) => setFunds(t)} />
        </div>
      </header>
      <main id="main">{children}</main>
      {!isOn(path, "/terminal/") && <Footer />}
      <StatusBar />
      <nav className="bnav show-m" aria-label="Bottom">
        <Link href="/" className={path === "/" ? "on" : ""}><IHome size={22} />Discover</Link>
        <Link href="/terminal/" className={isOn(path, "/terminal/") ? "on" : ""}><IChart size={22} />Terminal</Link>
        <Link href="/create/" className={`bnav-create${isOn(path, "/create/") ? " on" : ""}`}><span className="plus"><IPlus size={22} color="currentColor" w={1.8} /></span>Create</Link>
        <Link href="/alerts/" className={isOn(path, "/alerts/") ? "on" : ""}><IBell size={22} />Alerts</Link>
        <Link href="/profile/" className={isOn(path, "/profile/") ? "on" : ""}><IUser size={22} />Profile</Link>
      </nav>
      {welcome && <WelcomeModal onClose={closeWelcome} />}
      {funds && <FundsModal tab={funds} setTab={setFunds} onClose={() => setFunds(null)} />}
      {w.signedIn && <OrderWatcher />}
      {w.signedIn && <CopyAlerts />}
      <RefLinker />
      {msg && <div className="toast" role="status">{msg}</div>}
    </AppCtx.Provider>
  );
}
