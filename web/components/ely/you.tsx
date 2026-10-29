"use client";
// You: your HYPE, the Elysium tokens you hold, coins you created (collect your 30% fee share) and your trades.
import Link from "next/link";
import { useState } from "react";
import { encodeFunctionData, parseAbi, type Address, type Hex } from "viem";
import { useWallet } from "@/components/wallet";
import { TokenAvatar, PadTag } from "./shell";
import { ago, fetchCreated, fetchHoldings, fetchHypeUsd, fetchMyTrades, fetchTokensByAddress, money, pct, short, usePoll } from "@/lib/ely";
import { ELY_CHAIN, ely, fromWei, hypeBalance } from "@/lib/elytrade";

const LAUNCHER = (process.env.NEXT_PUBLIC_ELY_LAUNCHER || "") as Address | "";
const COLLECT = parseAbi(["function collect(address coin) returns (uint256 coinAmount, uint256 nativeAmount)"]);

function Collect({ coin }: { coin: string }) {
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
  return <button type="button" className="e-btn" disabled={!!state || !LAUNCHER} onClick={go}>{state ?? "Collect fees"}</button>;
}

export function YouPage() {
  const w = useWallet();
  const me = w.address?.toLowerCase() ?? null;
  const usd = usePoll(fetchHypeUsd, 30_000) ?? 0;
  const hype = usePoll(async () => (me ? hypeBalance(me as Address) : null), 6000, [me]);
  const holdings = usePoll(async () => {
    if (!me) return null;
    const rows = await fetchHoldings(me);
    const toks = await fetchTokensByAddress(rows.map((r) => r.token));
    const by = new Map(toks.map((t) => [t.address, t]));
    return rows
      .map((r) => {
        const t = by.get(r.token);
        if (!t) return null;
        const amount = Number(r.amount) / 10 ** (t.decimals ?? 18);
        return { t, amount, value: amount * (t.price_hype ?? 0) };
      })
      .filter((x): x is NonNullable<typeof x> => !!x && x.value > 0)
      .sort((a, b) => b.value - a.value);
  }, 15_000, [me]);
  const created = usePoll(async () => (me ? fetchCreated(me) : null), 30_000, [me]);
  const trades = usePoll(async () => (me ? fetchMyTrades(me) : null), 15_000, [me]);
  const [copied, setCopied] = useState(false);

  if (!w.signedIn || !me) {
    return (
      <main className="e-in e-page">
        <div className="e-panel e-empty" style={{ padding: "60px 20px" }}>
          <h1 style={{ margin: "0 0 8px", fontSize: 28, color: "var(--e-text)" }}>Your ArkhamPad</h1>
          <p style={{ margin: "0 0 18px" }}>Log in with email, Google or a wallet to see your coins, trades and creator fees.</p>
          <button type="button" className="e-btn pri" onClick={w.login}>Log in</button>
        </div>
      </main>
    );
  }

  const tokensHype = (holdings ?? []).reduce((s, h) => s + h.value, 0);
  const hypeNum = hype != null ? fromWei(hype) : 0;
  const byAddr = new Map((holdings ?? []).map((h) => [h.t.address, h.t]));

  return (
    <main className="e-in e-page">
      <section className="e-hero">
        <div>
          <span className="e-eyebrow">You</span>
          <h1>{money((hypeNum + tokensHype) * usd)}</h1>
          <p className="e-me">
            <button type="button" className="e-copy" onClick={() => navigator.clipboard?.writeText(me).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1400); })}>
              <span className="num">{copied ? "Copied" : short(me)}</span>
            </button>
            <button type="button" className="e-copy" onClick={w.logout}>Log out</button>
          </p>
        </div>
        <div className="e-stats">
          <div className="e-stat"><span>HYPE</span><b>{hype == null ? "—" : hypeNum.toLocaleString("en-US", { maximumFractionDigits: 4 })}</b></div>
          <div className="e-stat"><span>In tokens</span><b>{money(tokensHype * usd)}</b></div>
          <div className="e-stat"><span>Coins made</span><b>{created ? created.length : "—"}</b></div>
        </div>
      </section>

      <div className="e-cta" style={{ margin: 0 }}>
        <div><b>Add funds</b><span>Bring HYPE from HyperEVM or USDC from Base. Deposits land in about a minute.</span></div>
        <div className="e-cta-btns"><Link href="/bridge/" className="e-btn pri">Add HYPE or USDC</Link><Link href="/create/" className="e-btn">Create a coin</Link></div>
      </div>

      <section className="e-panel">
        <h3 className="e-ph">Holdings</h3>
        {!holdings ? <div style={{ padding: 14 }}><div className="e-skel" style={{ height: 48 }} /></div> : !holdings.length ? <div className="e-empty">No tokens yet. <Link href="/" style={{ color: "var(--e-teal)" }}>Find one on Discover</Link>.</div> : (
          <div className="e-rows">
            {holdings.map(({ t, amount, value }) => (
              <Link key={t.address} href={`/t/?a=${t.address}`} className="e-row e-hold">
                <span className="e-tok"><TokenAvatar t={t} size={36} /><span><span className="l1"><b>{t.name}</b><span className="sym">{t.symbol}</span></span><small><PadTag t={t} /></small></span></span>
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
          <h3 className="e-ph">Coins you created</h3>
          <div className="e-rows">
            {created.map((t) => (
              <div key={t.address} className="e-row e-made">
                <Link href={`/t/?a=${t.address}`} className="e-tok"><TokenAvatar t={t} size={36} /><span><span className="l1"><b>{t.name}</b><span className="sym">{t.symbol}</span></span><small>{ago(t.created_at)} old · {money((t.mcap_hype ?? 0) * usd)} mcap</small></span></Link>
                <span className="r num e-hide-m">{money((t.vol24_hype || 0) * usd)} 24h vol</span>
                <Collect coin={t.address} />
              </div>
            ))}
          </div>
          <p className="e-note" style={{ padding: "0 16px 14px" }}>Your 30% of the trading fees builds up in the pool. Collect any time; it is sent to your wallet in HYPE and in your coin.</p>
        </section>
      )}

      <section className="e-panel">
        <h3 className="e-ph">Your trades</h3>
        {!trades ? <div style={{ padding: 14 }}><div className="e-skel" style={{ height: 40 }} /></div> : !trades.length ? <div className="e-empty">No trades yet.</div> : (
          <div className="e-rows">
            {trades.map((x) => {
              const t = byAddr.get(x.token);
              return (
                <Link key={`${x.tx}-${x.log_index}`} href={`/t/?a=${x.token}`} className="e-row e-tr">
                  <span className="dim">{ago(x.at)}</span>
                  <span className={x.side === "buy" ? "up" : "down"} style={{ fontWeight: 700 }}>{x.side === "buy" ? "Buy" : "Sell"}</span>
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
