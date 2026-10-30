"use client";
// You: your HYPE, the Elysium tokens you hold, coins you created (collect your 30% fee share) and your trades.
import Link from "next/link";
import { useState } from "react";
import { encodeFunctionData, parseAbi, type Address, type Hex } from "viem";
import { useWallet } from "@/components/wallet";
import { useT } from "@/lib/i18n";
import { waitingBalances } from "./bridge";
import { InviteCard } from "./invite";
import { TokenAvatar } from "./shell";
import { ago, fetchCreated, fetchHoldings, fetchHypeUsd, fetchMyTrades, fetchTokensByAddress, money, pct, short, usePoll } from "@/lib/ely";
import { ELY_CHAIN, ely, fromWei, hypeBalance, recentTokens, tokenBalance } from "@/lib/elytrade";

const LAUNCHER = (process.env.NEXT_PUBLIC_ELY_LAUNCHER || "") as Address | "";
const COLLECT = parseAbi(["function collect(address coin) returns (uint256 coinAmount, uint256 nativeAmount)"]);

function Collect({ coin }: { coin: string }) {
  const tr = useT();
  const w = useWallet();
  const [state, setState] = useState<string | null>(null);
  async function go() {
    if (!w.signer?.sendTx || !LAUNCHER) return;
    setState("Collecting…");
    try {
      const hash = await w.signer.sendTx(ELY_CHAIN, { to: LAUNCHER, data: encodeFunctionData({ abi: COLLECT, functionName: "collect", args: [coin as Address] }) });
      const r = await ely().waitForTransactionReceipt({ hash: hash as Hex, timeout: 60_000 });
      setState(r.status === "success" ? "Collected" : "Failed");
    } catch {
      setState("Failed");
    }
    setTimeout(() => setState(null), 3000);
  }
  return <button type="button" className="e-btn" disabled={!!state || !LAUNCHER} onClick={go}>{tr(state ?? "Collect fees")}</button>;
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
  const me = w.address?.toLowerCase() ?? null;
  const usd = usePoll(fetchHypeUsd, 30_000) ?? 0;
  const hype = usePoll(async () => (me ? hypeBalance(me as Address) : null), 5000, [me]);
  // what you hold: the indexer's list plus anything bought or created here just now, read live from the chain
  const holdings = usePoll(async () => {
    if (!me) return null;
    const rows = await fetchHoldings(me).catch(() => []);
    const addrs = [...new Set([...recentTokens(), ...rows.map((r) => r.token)])];
    const toks = await fetchTokensByAddress(addrs);
    const live = await Promise.all(toks.map(async (t) => [t.address, await tokenBalance(t.address as Address, me as Address).catch(() => null)] as const));
    const bal = new Map(live);
    return toks
      .map((t) => {
        const raw = bal.get(t.address) ?? BigInt(rows.find((r) => r.token === t.address)?.amount ?? "0");
        const amount = Number(raw) / 10 ** (t.decimals ?? 18);
        return { t, amount, value: amount * (t.price_hype ?? 0) };
      })
      .filter((x) => x.amount > 0)
      .sort((a, b) => b.value - a.value);
  }, 10_000, [me]);
  const created = usePoll(async () => (me ? fetchCreated(me) : null), 20_000, [me]);
  // money that arrived on Base (USDC) or HyperEVM (HYPE) but hasn't been moved to Elysium yet
  const waiting = usePoll(async () => (me ? waitingBalances(me as Address) : null), 10_000, [me]);
  const trades = usePoll(async () => (me ? fetchMyTrades(me) : null), 10_000, [me]);
  const [copied, setCopied] = useState(false);
  const copy = () => me && navigator.clipboard?.writeText(me).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1400); });

  if (!w.signedIn || !me) {
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
  const byAddr = new Map((holdings ?? []).map((h) => [h.t.address, h.t]));

  return (
    <main className="e-in e-page">
      <section className="e-acct">
        <span className="e-acct-av">{(w.email || me).slice(0, 1).toUpperCase()}</span>
        <div>
          <b>{w.email || tr("Wallet login")}</b>
          <button type="button" className="e-copy" onClick={copy} title={tr("Copy address")}><span className="num">{copied ? tr("Address copied") : short(me)}</span><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h8" /></svg></button>
        </div>
        <button type="button" className="e-copy" onClick={w.logout}>{tr("Log out")}</button>
      </section>

      <section className="e-balance">
        <div className="e-balance-top">
          <span>{tr("Total balance")}</span>
          <b className="num">{hype == null ? "—" : money((hypeNum + tokensHype) * usd + waitUsd)}</b>
          <div className="e-balance-split">
            <span><i style={{ background: "var(--e-tealfill)" }} />{hypeNum.toLocaleString("en-US", { maximumFractionDigits: 4 })} HYPE <em>{money(hypeNum * usd)}</em></span>
            <span><i style={{ background: "#7c5cff" }} />{tr("Tokens")} <em>{money(tokensHype * usd)}</em></span>
            {waitUsd >= 0.01 && <span><i style={{ background: "#ffb43c" }} />{tr("Waiting to move")} <em>{money(waitUsd)}</em></span>}
          </div>
        </div>
        <div className="e-balance-btns">
          <Link href="/bridge/" className="e-btn pri">{tr("Deposit")}</Link>
          <Link href="/bridge/?tab=out" className="e-btn">{tr("Withdraw")}</Link>
          <button type="button" className="e-btn" onClick={copy}>{tr(copied ? "Copied" : "Copy address")}</button>
        </div>
      </section>

      {waitUsd >= 0.5 && (
        <Link href={`/bridge/?tab=${usdcWait >= hypeWait * usd ? "usdc" : "hype"}`} className="e-hint" style={{ fontSize: 15 }}>
          {usdcWait >= hypeWait * usd
            ? tr("You have {n} USDC on Base. Move it to Elysium to start trading.", { n: usdcWait.toFixed(2) })
            : tr("You have {n} HYPE on HyperEVM. Move it to Elysium to start trading.", { n: hypeWait.toFixed(4) })}{" "}
          <b>{tr("Move it now →")}</b>
        </Link>
      )}

      <section className="e-panel">
        <h3 className="e-ph">{tr("Your coins")}</h3>
        {!holdings ? <div style={{ padding: 14 }}><div className="e-skel" style={{ height: 48 }} /></div> : !holdings.length ? <div className="e-empty">{tr("No coins yet.")} <Link href="/" style={{ color: "var(--e-teal)" }}>{tr("Find one on Discover")}</Link> · <Link href="/create/" style={{ color: "var(--e-teal)" }}>{tr("create your own")}</Link></div> : (
          <div className="e-rows">
            {holdings.map(({ t, amount, value }) => (
              <Link key={t.address} href={`/t/?a=${t.address}`} className="e-row e-hold">
                <span className="e-tok"><TokenAvatar t={t} size={36} /><span><span className="l1"><b>{t.name}</b><span className="sym">{t.symbol}</span></span><small>{amount >= 1e6 ? `${(amount / 1e6).toFixed(2)}M` : amount >= 1e3 ? `${(amount / 1e3).toFixed(1)}K` : amount.toFixed(2)} {t.symbol}</small></span></span>
                <span className="r num e-hide-m">{amount >= 1e6 ? `${(amount / 1e6).toFixed(2)}M` : amount >= 1e3 ? `${(amount / 1e3).toFixed(1)}K` : amount.toFixed(2)}</span>
                <span className={`r num e-hide-m ${(t.change24 ?? 0) >= 0 ? "up" : "down"}`}>{pct(t.change24)}</span>
                <span className="r num"><b>{money(value * usd)}</b></span>
              </Link>
            ))}
          </div>
        )}
      </section>

      {!!created?.length && (
        <section className="e-panel">
          <h3 className="e-ph">{tr("Coins you created")}</h3>
          <div className="e-rows">
            {created.map((t) => (
              <div key={t.address} className="e-row e-made">
                <Link href={`/t/?a=${t.address}`} className="e-tok"><TokenAvatar t={t} size={36} /><span><span className="l1"><b>{t.name}</b><span className="sym">{t.symbol}</span></span><small>{tr("{age} old", { age: ago(t.created_at) })} · {money((t.mcap_hype ?? 0) * usd)} {tr("mcap")}</small></span></Link>
                <span className="r num e-hide-m">{money((t.vol24_hype || 0) * usd)} {tr("24h vol")}</span>
                <Collect coin={t.address} />
              </div>
            ))}
          </div>
          <p className="e-note" style={{ padding: "0 16px 14px" }}>{tr("Your 30% of the trading fees is sent to your wallet automatically every 30 minutes, in HYPE and in your coin. You can also collect it now.")}</p>
        </section>
      )}

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
