"use client";
// You: your HYPE, the Elysium tokens you hold, coins you created (collect your 30% fee share) and your trades.
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { encodeFunctionData, parseAbi, type Address, type Hex } from "viem";
import { useWallet } from "@/components/wallet";
import { useT } from "@/lib/i18n";
import { waitingBalances } from "./bridge";
import { InviteCard } from "./invite";
import { AirdropCard } from "./airdrop";
import { PioneerBanner } from "./pioneer";
import { TokenAvatar } from "./shell";
import { ago, fetchCreated, fetchHypeUsd, fetchMyTrades, money, pct, short, usePoll, type EToken } from "@/lib/ely";
import { lastAddress, rememberAddress, shownHype, useElyUsdc, useHoldings } from "@/lib/holdings";
import { ELY_CHAIN, ely, fromWei, hypeBalance, cachedHype, pendingTokens, waitReceipt } from "@/lib/elytrade";
import { HOLD_MS, V2_LIVE, feeStatus, launcherOf } from "@/lib/launchers";

const LAUNCHER = (process.env.NEXT_PUBLIC_ELY_LAUNCHER || "") as Address | "";
// a coin is collected from the launcher that made it (version 1, or version 2 once that is live)
const COLLECT = parseAbi(["function collect(address coin) returns (uint256 coinAmount, uint256 nativeAmount)"]);

function Collect({ coin }: { coin: string }) {
  const tr = useT();
  const w = useWallet();
  const [state, setState] = useState<string | null>(null);
  async function go() {
    if (!w.signer?.sendTx || !LAUNCHER) return;
    setState("Checking…");
    const from = (await launcherOf(coin)) || LAUNCHER;
    // the keeper already sends creator fees every 30 minutes; check first so an empty collect never
    // costs gas or shows "Failed"
    try {
      await ely().simulateContract({ account: w.signer.address, address: from, abi: COLLECT, functionName: "collect", args: [coin as Address] });
    } catch {
      setState("Nothing new yet");
      setTimeout(() => setState(null), 3500);
      return;
    }
    setState("Collecting…");
    try {
      const hash = await w.signer.sendTx(ELY_CHAIN, { to: from, data: encodeFunctionData({ abi: COLLECT, functionName: "collect", args: [coin as Address] }), gas: 300_000n });
      const r = await waitReceipt(hash as Hex, 120_000);
      setState(r.status === "success" ? "Collected" : "Nothing new yet");
    } catch {
      setState("Try again in a minute");
    }
    setTimeout(() => setState(null), 3500);
  }
  return <button type="button" className="e-btn" disabled={!!state || !LAUNCHER} onClick={go}>{tr(state ?? "Collect fees")}</button>;
}

/** "25K" fee rules (version-2 coins only): where the coin stands and what the creator earns. */
function FeeLevel({ coin, usd }: { coin: string; usd: number }) {
  const tr = useT();
  const s = usePoll(async () => feeStatus(coin).catch(() => null), 30_000, [coin]);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(id); }, []);
  if (!s) return null;
  const $ = (hype: number) => (usd ? money(hype * usd) : `${hype.toFixed(1)} HYPE`);
  const left = (ms: number) => { const m = Math.max(0, Math.ceil(ms / 60_000)); return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`; };
  const pctTo1 = Math.max(0, Math.min(100, (s.mc / s.level1) * 100));
  const windowOpen = !s.heldSettled && now < s.windowEnds;
  let line: string;
  if (s.level === 2) line = tr("You earn {p}% of every trade's fee. Your coin is above {a}.", { p: s.creatorPct, a: $(s.level2) });
  else if (s.level === 1) line = tr("You earn {p}% of every trade's fee. Above {a} it's 60%.", { p: s.creatorPct, a: $(s.level2) });
  else if (s.aboveSince > 0 && s.aboveSince + HOLD_MS - now > 60_000) line = tr("Above {a} now: {t} to go until you earn 50%.", { a: $(s.level1), t: left(s.aboveSince + HOLD_MS - now) });
  else if (s.aboveSince > 0) line = tr("Above {a} for an hour: your 50% starts at the next check, in a few minutes.", { a: $(s.level1) });
  else line = tr("You earn {p}%. Get above {a} for 1 hour and you earn 50%.", { p: s.creatorPct, a: $(s.level1) });
  return (
    <div className="e-lvl">
      <div className="e-lvl-t"><b>{line}</b></div>
      {s.level === 0 && <div className="e-lvl-bar" aria-hidden="true"><i style={{ width: `${pctTo1}%` }} /></div>}
      {s.level === 0 && <div className="e-lvl-s dim">{tr("Market cap {m} of {a}", { m: $(s.mc), a: $(s.level1) })}</div>}
      {windowOpen && s.heldHype + s.heldCoin > 0 && (
        <div className="e-lvl-s">{tr("{h} held for you: paid out if your coin makes it within {t}.", { h: $(s.heldHype), t: left(s.windowEnds - now) })}</div>
      )}
    </div>
  );
}

function AddMoneyHelp({ me }: { me: string }) {
  const tr = useT();
  const [how, setHow] = useState<"exchange" | "usdc" | "out">("exchange");
  return (
    <section className="e-panel">
      <div className="e-bar" style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between" }}>
        <h3 style={{ margin: 0, fontSize: 15 }}>{tr("Add or withdraw money")}</h3>
        <div className="e-tabs" role="tablist">
          {([["exchange", "HYPE"], ["usdc", "USDC"], ["out", "Withdraw"]] as const).map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={how === k} className={`e-tab ${how === k ? "on" : ""}`} onClick={() => setHow(k)}>{tr(l)}</button>)}
        </div>
      </div>
      <div className="e-trade">
        {how === "exchange" && (
          <ol className="e-steps big">
            <li>{tr("On your exchange (for example Binance), withdraw HYPE and choose the network HYPE EVM (HyperEVM).")}</li>
            <li>{tr("Paste your address:")} <code className="num">{me}</code></li>
            <li><Link href="/bridge/">{tr("When it arrives, open Bridge and tap Move to Elysium. It lands in about a minute.")}</Link></li>
          </ol>
        )}
        {how === "usdc" && (
          <ol className="e-steps big">
            <li>{tr("Send USDC on Base to your address, plus a little ETH on Base for the network fee.")}</li>
            <li>{tr("Your address:")} <code className="num">{me}</code></li>
            <li><Link href="/bridge/?tab=usdc">{tr("Open Bridge → USDC and tap Convert and bridge. You arrive on Elysium with HYPE.")}</Link></li>
          </ol>
        )}
        {how === "out" && (
          <ol className="e-steps big">
            <li><Link href="/bridge/?tab=out">{tr("Open Bridge → Withdraw, enter the HYPE amount and start the withdrawal.")}</Link></li>
            <li>{tr("Elysium's official bridge holds it for about 5.5 days (a safety period every rollup has).")}</li>
            <li>{tr("Then tap Claim and your HYPE is on HyperEVM, ready to send to an exchange.")}</li>
          </ol>
        )}
      </div>
    </section>
  );
}

export function YouPage() {
  const tr = useT();
  const w = useWallet();
  const live = w.address?.toLowerCase() ?? null;
  // while sign-in is still loading after a refresh, show the last account's numbers instead of a blank page
  const me = live ?? (!w.ready ? lastAddress() : null);
  if (live) rememberAddress(live);
  const usdRead = usePoll(fetchHypeUsd, 30_000);
  const usd = usdRead ?? 0;
  const hype = shownHype(me, usePoll(async () => (me ? hypeBalance(me as Address) : null), 5000, [me]) ?? cachedHype(me));
  // USDC sitting on Elysium itself (from coins that trade in USDC)
  const elyUsdc = useElyUsdc(me);
  // what you hold: shown instantly from this device's last copy, then refreshed (see lib/holdings)
  const holdings = useHoldings(me);
  // coins you launched: the ones launched here a moment ago show at once (the indexer adds them a bit later)
  const createdDb = usePoll(async () => (me ? fetchCreated(me) : null), 20_000, [me]);
  const [createdCache, setCreatedCache] = useState<EToken[] | null>(null);
  useEffect(() => { if (!me) return; try { const v = localStorage.getItem(`ap_made_${me}`); setCreatedCache(v ? (JSON.parse(v) as EToken[]) : null); } catch {} }, [me]);
  useEffect(() => { if (me && createdDb) try { localStorage.setItem(`ap_made_${me}`, JSON.stringify(createdDb.slice(0, 50))); } catch {} }, [me, createdDb]);
  const created = useMemo(() => {
    const base = createdDb ?? createdCache;
    const mine = me ? pendingTokens().filter((t) => (t.creator || "").toLowerCase() === me) : [];
    if (!base && !mine.length) return base;
    const seen = new Set((base ?? []).map((t) => t.address.toLowerCase()));
    return [...mine.filter((t) => !seen.has(t.address.toLowerCase())), ...(base ?? [])];
  }, [createdDb, createdCache, me]);
  // money that arrived on Base (USDC) or HyperEVM (HYPE) but hasn't been moved to Elysium yet
  const waiting = usePoll(async () => (me ? waitingBalances(me as Address) : null), 10_000, [me]);
  const trades = usePoll(async () => (me ? fetchMyTrades(me) : null), 10_000, [me]);
  const [copied, setCopied] = useState(false);
  const [allCoins, setAllCoins] = useState(false);
  const [allMade, setAllMade] = useState(false);
  const FIRST = 3;
  const copy = () => me && navigator.clipboard?.writeText(me).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1400); });

  if (!w.ready && !me) {
    return (
      <main className="e-in e-page">
        <div className="e-skel" style={{ height: 70 }} />
        <div className="e-skel" style={{ height: 180 }} />
        <div className="e-skel" style={{ height: 160 }} />
      </main>
    );
  }
  if (!me || (w.ready && !w.signedIn)) {
    return (
      <main className="e-in e-page">
        <div className="e-panel e-empty" style={{ padding: "60px 20px" }}>
          <h1 style={{ margin: "0 0 8px", fontSize: 28, color: "var(--e-text)" }}>{tr("Your ArkhamPad")}</h1>
          <p style={{ margin: "0 0 18px" }}>{tr("Log in with email, Google or a wallet to see your balance, coins and trades.")}</p>
          <button type="button" className="e-btn pri" onClick={w.login}>{tr("Log in")}</button>
        </div>
      </main>
    );
  }

  const tokensHype = (holdings ?? []).reduce((s, h) => s + h.value, 0);
  const hypeNum = hype != null ? fromWei(hype) : 0;
  const usdcWait = waiting ? Number(waiting.usdc) / 1e6 : 0;
  const hypeWait = waiting ? fromWei(waiting.hype) : 0;
  const waitUsd = usdcWait + hypeWait * usd;
  // about 0.01 HYPE always stays on HyperEVM to pay the bridge fee, so only what's above that can be moved
  const hypeMovable = Math.max(0, hypeWait - 0.0105);
  const moveUsd = usdcWait + hypeMovable * usd;
  const byAddr = new Map((holdings ?? []).map((h) => [h.t.address, h.t]));

  return (
    <main className="e-in e-page">
      <section className="e-acct">
        <span className="e-acct-av">{(w.email || me).slice(0, 1).toUpperCase()}</span>
        <div>
          <b>{w.email || tr("Wallet login")}</b>
          <button type="button" className="e-copy" onClick={copy} title={tr("Copy address")}><span className="num">{copied ? tr("Address copied") : short(me)}</span><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h8" /></svg></button>
        </div>
        {w.exportKey && <button type="button" className="e-copy" onClick={() => w.exportKey?.()}>{tr("Export key")}</button>}
        <button type="button" className="e-copy" onClick={w.logout}>{tr("Log out")}</button>
      </section>

      <section className="e-balance">
        <div className="e-balance-top">
          <span>{tr("Total balance")}</span>
          <b className="num">{hype == null || !usdRead ? "—" : money((hypeNum + tokensHype) * usd + waitUsd + elyUsdc)}</b>
          <div className="e-balance-split">
            <span><i style={{ background: "var(--e-tealfill)" }} />{hypeNum.toLocaleString("en-US", { maximumFractionDigits: 4 })} HYPE <em>{money(hypeNum * usd)}</em></span>
            <span><i style={{ background: "#7c5cff" }} />{tr("Tokens")} <em>{money(tokensHype * usd)}</em></span>
            {elyUsdc >= 0.01 && <span><i style={{ background: "#2775ca" }} />USDC <em>{money(elyUsdc)}</em></span>}
            {waitUsd >= 0.01 && <span><i style={{ background: "#ffb43c" }} />{tr("Waiting to move")} <em>{money(waitUsd)}</em></span>}
          </div>
        </div>
        <div className="e-balance-btns">
          <Link href="/bridge/" className="e-btn pri">{tr("Deposit")}</Link>
          <Link href="/bridge/?tab=out" className="e-btn">{tr("Withdraw")}</Link>
          <button type="button" className="e-btn" onClick={copy}>{tr(copied ? "Copied" : "Copy address")}</button>
        </div>
      </section>

      {moveUsd >= 0.5 && (
        <Link href={`/bridge/?tab=${usdcWait >= hypeMovable * usd ? "usdc" : "hype"}`} className="e-hint" style={{ fontSize: 15 }}>
          {usdcWait >= hypeMovable * usd
            ? tr("You have {n} USDC waiting. Move it to Elysium to start trading.", { n: usdcWait.toFixed(2) })
            : tr("You have {n} HYPE on HyperEVM. Move it to Elysium to start trading.", { n: hypeMovable.toFixed(4) })}{" "}
          <b>{tr("Move it now →")}</b>
        </Link>
      )}

      <section className="e-panel">
        <h3 className="e-ph">{tr("Your coins")}</h3>
        {!holdings ? <div style={{ padding: 14 }}><div className="e-skel" style={{ height: 48 }} /></div> : !holdings.length ? <div className="e-empty">{tr("No coins yet.")} <Link href="/" style={{ color: "var(--e-teal)" }}>{tr("Find one on Discover")}</Link> · <Link href="/create/" style={{ color: "var(--e-teal)" }}>{tr("create your own")}</Link></div> : (
          <div className="e-rows">
            {(allCoins ? holdings : holdings.slice(0, FIRST)).map(({ t, amount, value }) => (
              <Link key={t.address} href={`/t/?a=${t.address}`} className="e-row e-hold">
                <span className="e-tok"><TokenAvatar t={t} size={36} /><span><span className="l1"><b>{t.name}</b><span className="sym">{t.symbol}</span></span><small>{amount >= 1e6 ? `${(amount / 1e6).toFixed(2)}M` : amount >= 1e3 ? `${(amount / 1e3).toFixed(1)}K` : amount.toFixed(2)} {t.symbol}</small></span></span>
                <span className="r num e-hide-m">{amount >= 1e6 ? `${(amount / 1e6).toFixed(2)}M` : amount >= 1e3 ? `${(amount / 1e3).toFixed(1)}K` : amount.toFixed(2)}</span>
                <span className={`r num e-hide-m ${(t.change24 ?? 0) >= 0 ? "up" : "down"}`}>{pct(t.change24)}</span>
                <span className="r num"><b>{money(value * usd)}</b></span>
              </Link>
            ))}
            {holdings.length > FIRST && <button type="button" className="e-more" onClick={() => setAllCoins((v) => !v)}>{allCoins ? tr("Show less") : tr("Show all {n}", { n: holdings.length })}</button>}
          </div>
        )}
      </section>

      {!!created?.length && (
        <section className="e-panel">
          <h3 className="e-ph">{tr("Coins you created")}</h3>
          <div className="e-rows">
            {(allMade ? created : created.slice(0, FIRST)).map((t) => (
              <div key={t.address} className="e-row e-made">
                <Link href={`/t/?a=${t.address}`} className="e-tok"><TokenAvatar t={t} size={36} /><span><span className="l1"><b>{t.name}</b><span className="sym">{t.symbol}</span></span><small>{tr("{age} old", { age: ago(t.created_at) })} · {money((t.mcap_hype ?? 0) * usd)} {tr("mcap")}</small></span></Link>
                <span className="r num e-hide-m">{money((t.vol24_hype || 0) * usd)} {tr("24h vol")}</span>
                <Collect coin={t.address} />
                {V2_LIVE && <FeeLevel coin={t.address} usd={usd} />}
              </div>
            ))}
            {created.length > FIRST && <button type="button" className="e-more" onClick={() => setAllMade((v) => !v)}>{allMade ? tr("Show less") : tr("Show all {n}", { n: created.length })}</button>}
          </div>
          <p className="e-note" style={{ padding: "0 16px 14px" }}>{V2_LIVE ? tr("Your share of the trading fees is sent to your wallet automatically: the HYPE part to your balance, the coin part as small amounts of your coin (they show up under Your coins). Coins launched before the new fee rules keep their 30%. You can also collect it now.") : tr("Your 30% of the trading fees is sent to your wallet automatically every 30 minutes: the HYPE part to your balance, the coin part as small amounts of your coin (they show up under Your coins). You can also collect it now.")}</p>
        </section>
      )}

      <PioneerBanner />

      <AirdropCard me={me} />

      <InviteCard me={me} />

      <AddMoneyHelp me={me} />

      <section className="e-panel">
        <h3 className="e-ph">{tr("Your trades")}</h3>
        {!trades ? <div style={{ padding: 14 }}><div className="e-skel" style={{ height: 40 }} /></div> : !trades.length ? <div className="e-empty">{tr("No trades yet.")}</div> : (
          <div className="e-rows">
            {trades.map((x) => {
              const t = byAddr.get(x.token);
              return (
                <Link key={`${x.tx}-${x.log_index}`} href={`/t/?a=${x.token}`} className="e-row e-tr">
                  <span className="dim">{ago(x.at)}</span>
                  <span className={x.side === "buy" ? "up" : "down"} style={{ fontWeight: 700 }}>{tr(x.side === "buy" ? "Buy" : "Sell")}</span>
                  <span>{t?.symbol ?? short(x.token)}</span>
                  <span className="r num e-hide-m">{x.hype.toFixed(x.hype < 1 ? 4 : 2)} HYPE</span>
                  <span className={`r num ${x.side === "buy" ? "up" : "down"}`}>{money(x.hype * usd)}</span>
                  <span className="e-hide-m" />
                </Link>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}
