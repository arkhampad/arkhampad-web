"use client";
// ArkhamPad on Elysium: the frame around every page (top bar with menu, search, theme and login,
// live ticker, phone tab bar) and the shared token bits (avatar, launchpad tag).
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { WalletProvider, useWallet } from "@/components/wallet";
import { I18nProvider, LANGS, useI18n, useT } from "@/lib/i18n";
import { fetchTokens, fetchHypeUsd, money, pct, padColor, padOf, PADS, tokenColors, usePoll, type EToken } from "@/lib/ely";

const NAV = [
  { href: "/", label: "Discover", icon: <path d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm3.5 5.5-2 5-5 2 2-5 5-2Z" /> },
  { href: "/create/", label: "Create", icon: <path d="M12 7v10M7 12h10M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z" /> },
  { href: "/bridge/", label: "Bridge", icon: <path d="M7 7h12l-3-3M17 17H5l3 3" /> },
  { href: "/you/", label: "You", icon: <path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 9a7 7 0 0 1 14 0" /> },
];
const Icon = ({ d }: { d: React.ReactNode }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{d}</svg>
);

export function TokenAvatar({ t, size = 36 }: { t: Pick<EToken, "address" | "symbol" | "image">; size?: number }) {
  const [broken, setBroken] = useState(false);
  const [a, b] = tokenColors(t.address);
  const letter = (t.symbol || "?").replace(/[^\p{L}\p{N}]/gu, "").slice(0, 1).toUpperCase() || "?";
  return (
    <span className="e-av" style={{ width: size, height: size, fontSize: size * 0.42, background: `linear-gradient(135deg, ${a}, ${b})` }}>
      {t.image && !broken ? <img src={t.image} alt="" onError={() => setBroken(true)} loading="lazy" /> : letter}
    </span>
  );
}

export function PadTag({ t }: { t: Pick<EToken, "launchpad" | "ours"> }) {
  const name = padOf(t);
  return (
    <span className="e-padtag">
      <i style={{ background: padColor(name) }}>{PADS[name]?.short ?? "•"}</i>
      {name}
    </span>
  );
}

function ThemeButton() {
  const [dark, setDark] = useState(false);
  useEffect(() => setDark(document.documentElement.dataset.theme === "dark"), []);
  const flip = () => {
    const next = dark ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem("ap_theme", next); } catch {}
    setDark(!dark);
  };
  return (
    <button type="button" className="e-btn e-icon" onClick={flip} aria-label={dark ? "Light mode" : "Dark mode"} title={dark ? "Light mode" : "Dark mode"}>
      {dark ? <Icon d={<><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>} /> : <Icon d={<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" />} />}
    </button>
  );
}

function LangButton() {
  const { lang, setLang } = useI18n();
  const [open, setOpen] = useState(false);
  const cur = LANGS.find((l) => l.id === lang) ?? LANGS[0];
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const t = setTimeout(() => document.addEventListener("click", close, { once: true }), 0);
    return () => { clearTimeout(t); document.removeEventListener("click", close); };
  }, [open]);
  return (
    <div className="e-lang">
      <button type="button" className="e-btn e-langbtn" onClick={() => setOpen(!open)} aria-haspopup="menu" aria-expanded={open} aria-label="Language">
        <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.9" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3Z" /></svg>
        <span>{cur.short}</span>
      </button>
      {open && (
        <div className="e-langmenu" role="menu">
          {LANGS.map((l) => (
            <button key={l.id} type="button" role="menuitemradio" aria-checked={l.id === lang} className={l.id === lang ? "on" : ""} onClick={() => { setLang(l.id); setOpen(false); }}>
              <span className="dim">{l.short}</span>{l.name}{l.id === lang && <i aria-hidden="true">✓</i>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Account() {
  const w = useWallet();
  const tr = useT();
  if (!w.signedIn) return <button type="button" className="e-btn pri" onClick={w.login}>{tr("Log in")}</button>;
  return <Link href="/you/" className="e-btn num">{w.address?.slice(0, 5)}…{w.address?.slice(-3)}</Link>;
}

function Ticker() {
  const tokens = usePoll(fetchTokens, 20_000);
  const usd = usePoll(fetchHypeUsd, 30_000) ?? 0;
  const top = (tokens ?? []).slice(0, 16);
  if (!top.length) return <div className="e-ticker"><div className="e-ticker-run" style={{ height: 34 }} /></div>;
  const items = [...top, ...top];
  return (
    <div className="e-ticker" aria-hidden="true">
      <div className="e-ticker-run">
        {items.map((t, i) => (
          <Link key={i} href={`/t/?a=${t.address}`} className="e-tick" tabIndex={-1}>
            <TokenAvatar t={t} size={18} />
            <b>{t.symbol}</b>
            <span className="num muted">{money((t.mcap_hype ?? 0) * usd)}</span>
            <span className={`num ${(t.change24 ?? 0) >= 0 ? "up" : "down"}`}>{pct(t.change24)}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}

function Search() {
  const r = useRouter();
  const tr = useT();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  return (
    <form
      className={`e-search ${open ? "open" : ""}`}
      role="search"
      onClick={() => { if (!open) { setOpen(true); setTimeout(() => input.current?.focus(), 0); } }}
      onSubmit={(e) => {
        e.preventDefault();
        const v = q.trim();
        if (/^0x[0-9a-fA-F]{40}$/.test(v)) r.push(`/t/?a=${v.toLowerCase()}`);
        else r.push(v ? `/?q=${encodeURIComponent(v)}` : "/");
        (document.activeElement as HTMLElement | null)?.blur();
        setOpen(false);
      }}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true" style={{ flex: "none" }}><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
      <input ref={input} onBlur={() => { if (!q.trim()) setOpen(false); }} value={q} onChange={(e) => setQ(e.target.value)} placeholder={tr("Search")} aria-label="Search token name or address" enterKeyHint="search" autoCapitalize="off" autoCorrect="off" spellCheck={false} />
    </form>
  );
}

function Frame({ children }: { children: React.ReactNode }) {
  const path = usePathname() || "/";
  const tr = useT();
  const on = (href: string) => (href === "/" ? path === "/" : path.startsWith(href));
  return (
    <div className="ely">
      <header className="e-top">
        <div className="e-in">
          <Link href="/" className="e-brand" aria-label="ArkhamPad home">
            <img src="/icon-192.png" alt="" width={34} height={34} />
            <span>ArkhamPad</span>
          </Link>
          <nav className="e-links" aria-label="Main">
            {NAV.map((n) => <Link key={n.href} href={n.href} className={`e-link ${on(n.href) ? "on" : ""}`}>{tr(n.label)}</Link>)}
            <Link href="/stats/" className={`e-link ${on("/stats/") ? "on" : ""}`}>{tr("Stats")}</Link>
            <Link href="/learn/" className={`e-link ${on("/learn/") ? "on" : ""}`}>{tr("Learn")}</Link>
          </nav>
          <Search />
          <LangButton />
          <ThemeButton />
          <Account />
        </div>
      </header>
      <Ticker />
      {children}
      <footer className="e-foot">
        <div className="e-in">
          <span>{tr("ArkhamPad · the Elysium launchpad")}</span>
          <nav aria-label="Footer">
            <Link href="/stats/">{tr("Stats")}</Link>
            <Link href="/learn/">{tr("Learn")}</Link>
            <Link href="/learn/what-is-elysium/">{tr("What is Elysium")}</Link>
            <Link href="/learn/create-a-token-on-elysium/">{tr("Create a token")}</Link>
            <Link href="/learn/bridge-hype-to-elysium/">{tr("Bridge HYPE")}</Link>
            <Link href="/testnet/">{tr("Testnet")}</Link>
            <Link href="/terms/">{tr("Terms")}</Link>
            <Link href="/privacy/">{tr("Privacy")}</Link>
            <a href="https://x.com/Arkhampad" target="_blank" rel="noopener noreferrer">X</a>
          </nav>
        </div>
      </footer>
      <nav className="e-bottom" aria-label="Main">
        {NAV.map((n) => (
          <Link key={n.href} href={n.href} className={`e-tabnav ${on(n.href) ? "on" : ""}`}>
            <Icon d={n.icon} />
            {tr(n.label)}
          </Link>
        ))}
      </nav>
    </div>
  );
}

export function ElyShell({ children }: { children: React.ReactNode }) {
  return (
    <I18nProvider>
      <WalletProvider>
        <Frame>{children}</Frame>
      </WalletProvider>
    </I18nProvider>
  );
}
