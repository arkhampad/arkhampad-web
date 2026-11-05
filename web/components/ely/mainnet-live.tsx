"use client";
// Live Elysium numbers for the mainnet article: coins, 24h volume, trades, new coins and the most traded coins.
// Same cached token list the Discover page uses, so it costs the database nothing extra.
import Link from "next/link";
import { fetchHypeUsd, fetchTokens, money, usePoll } from "@/lib/ely";

const num = (n: number) => Math.round(n).toLocaleString("en-US");

export function MainnetLive() {
  const tokens = usePoll(fetchTokens, 60_000);
  const hype = usePoll(fetchHypeUsd, 60_000) || 0;
  const list = tokens || [];
  const vol = list.reduce((s, t) => s + (t.vol24_hype || 0), 0) * hype;
  const trades = list.reduce((s, t) => s + (t.buys24 || 0) + (t.sells24 || 0), 0);
  const fresh = list.filter((t) => t.created_at && Date.now() - Date.parse(t.created_at) < 86400e3).length;
  const top = [...list].sort((a, b) => (b.vol24_hype || 0) - (a.vol24_hype || 0)).slice(0, 5);
  const box = (label: string, v: string, fallback: string) => (
    <div className="e-mn-k"><span>{label}</span><b>{tokens ? v : fallback}</b></div>
  );
  return (
    <section id="live-now" className="e-mn">
      <h2>Elysium mainnet right now (live)</h2>
      <div className="e-mn-g">
        {box("Coins trading", list.length >= 2000 ? "2,000+" : num(list.length), "2,000+")}
        {box("24h volume", hype ? money(vol) : "—", "$10M+")}
        {box("Trades 24h", num(trades), "60,000+")}
        {box("New in 24h", num(fresh), "1,000+")}
      </div>
      <p className="e-mn-n dim"><i />{tokens ? `Live from the Elysium chain · ${new Date().toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}` : "Figures as of November 5, 2026. Loading live data…"}</p>
      {top.length > 0 && (
        <>
          <h3>Most traded Elysium coins in the last 24 hours</h3>
          <div className="e-mn-tw">
            <table className="e-mn-t">
              <thead><tr><th>Coin</th><th className="n">Market cap</th><th className="n">24h volume</th><th className="n">Holders</th></tr></thead>
              <tbody>
                {top.map((t) => (
                  <tr key={t.address}>
                    <td><Link href={`/t/?a=${t.address}`}>${t.symbol}</Link></td>
                    <td className="n">{money((t.mcap_hype || 0) * hype)}</td>
                    <td className="n">{money((t.vol24_hype || 0) * hype)}</td>
                    <td className="n">{num(t.holders || 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p><Link href="/">See every Elysium coin on Discover →</Link> You can buy or sell any of them on ArkhamPad with HYPE or USDC.</p>
        </>
      )}
    </section>
  );
}
