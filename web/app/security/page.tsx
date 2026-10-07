import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Security",
  description: "How ArkhamPad's smart contracts protect your funds: locked Uniswap pools from launch, signed trades, fixed-supply coins and limited admin powers.",
  alternates: { canonical: "https://arkhampad.com/security/" },
};

const SUMMARY: [string, string][] = [["Critical", "0"], ["High", "0"], ["Medium", "0"], ["Low (open)", "0"]];

const GUARANTEES: [string, string][] = [
  ["You sign the exact terms", "Every trade, launch and withdrawal is an EIP-712 message with the amount, minimum received, fee and deadline inside it. The relayer that submits it cannot change any of them, and each signature works only once, on one chain."],
  ["No custody between trades", "The router finishes every trade in a single transaction and holds nothing afterwards. Unused money is refunded in the same transaction."],
  ["Liquidity is locked forever", "Every coin opens at launch into a Uniswap v4 pool position held by the contract. There is no function that can withdraw or transfer it."],
  ["Nobody can open a coin's pool early", "A dedicated hook lets only ArkhamPad's pool builder open a coin's pool, at the launch price."],
  ["Anti-sniper launch fee", "The same hook sets the pool fee: 30% at launch, falling to 2% over five minutes. It never changes swap amounts and holds no funds."],
  ["Creator locks are enforced on-chain", "If a creator locks their coins, the coin contract itself blocks every transfer out of their wallet until the lock ends."],
  ["Fixed-supply coins", "Coins launched on ArkhamPad have a fixed supply and no owner controls: nobody can mint more, block sellers or add a tax."],
  ["Limited admin powers", "Admin rights cover settings such as pausing new buys in an emergency. They cannot move user funds or locked liquidity, and selling is never paused."],
  ["A capped fee vault", "Platform fees are held in a vault. The automated key that pays referral rewards can only send rewards, up to a fixed daily limit."],
];

const AREAS = [
  "EIP-712 signatures, nonces and replay protection",
  "Gasless relayer permissions",
  "Pool creation at launch and the single locked position",
  "The launch fee hook (30% to 2% over five minutes)",
  "Pool trading, quotes and callback authorization",
  "Creator token locks",
  "Fees, buyback and treasury accounting",
  "Swaps for coins from other DEXs",
  "Admin and guardian roles",
  "6- and 18-decimal dollar tokens",
];

const FIXED: [string, string, string][] = [
  ["High", "A launch refund could include funds already held by the hub", "Refunds now use only the current transaction's balance change. Regression test added."],
  ["Medium", "Pool callbacks relied on a single caller check", "Callbacks now also require that the contract itself started the operation."],
  ["Medium", "Minimum-output on swaps of fee-on-transfer tokens", "The minimum is now checked against what actually reaches the user's wallet."],
  ["Low", "Tokens sent to contracts by mistake could not be recovered", "Admin-only recovery added for stray tokens."],
  ["Low", "Fee vault could be deployed without a payout key", "Deployment now rejects it; zero-amount payouts also revert."],
];

export default function Page() {
  return (
    <div className="wrap page" style={{ maxWidth: 880, display: "flex", flexDirection: "column", gap: 28 }}>
      <header style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <span className="mono" style={{ fontSize: 12, letterSpacing: 2, color: "var(--faint)" }}>SECURITY</span>
        <h1 className="h-title" style={{ fontSize: "clamp(32px, 5vw, 44px)" }}>How ArkhamPad protects your funds</h1>
        <p style={{ fontSize: 17, color: "var(--note)", maxWidth: 680 }}>The first version of ArkhamPad&apos;s contracts went through two independent security reviews covering every contract, plus an automated scan with 102 detectors. The current version, where every coin opens straight into a locked Uniswap pool, is tested on every change (more than 160 unit, fuzz and real-network fork tests) and is being independently reviewed now. Results will be published here.</p>
      </header>

      <section className="card" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <span style={{ fontWeight: 700 }}>Review result (first version)</span>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10 }}>
          {SUMMARY.map(([k, v]) => (
            <div key={k} style={{ border: "1px solid var(--line)", borderRadius: 10, padding: "12px 14px", display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: 12, color: "var(--faint)" }}>{k}</span>
              <span className="mono" style={{ fontSize: 28, fontWeight: 700, color: "var(--up)" }}>{v}</span>
            </div>
          ))}
        </div>
        <span style={{ fontSize: 13, color: "var(--dim)" }}>Two independent reviews of the first version, October 2026 · current version under review · Solidity 0.8.26, OpenZeppelin 5.1, Uniswap v4 · Automated scan: 0 confirmed issues</span>
      </section>

      <section style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <h2 style={{ fontSize: 22 }}>What the contracts guarantee</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 10 }}>
          {GUARANTEES.map(([h, p]) => (
            <div key={h} className="card" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span style={{ fontWeight: 700 }}>{h}</span>
              <span style={{ fontSize: 14, color: "var(--dim)", lineHeight: 1.55 }}>{p}</span>
            </div>
          ))}
        </div>
      </section>

      <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <h2 style={{ fontSize: 22 }}>What was reviewed</h2>
        <p style={{ color: "var(--dim)" }}>Current contracts: PadCoin, PadHub, PadRouter, PadPoolBuilder, PadLaunchHook, PadPromote, PadExtSwap and PadFeeVault. The reviews focused on:</p>
        <p style={{ color: "var(--dim)", lineHeight: 1.7 }}>{AREAS.join(" · ")}</p>
      </section>

      <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <h2 style={{ fontSize: 22 }}>Issues found and fixed</h2>
        <div style={{ overflowX: "auto" }}>
          <table className="tbl" style={{ minWidth: 560 }}>
            <thead><tr><th style={{ textAlign: "left" }}>Severity</th><th style={{ textAlign: "left" }}>Finding</th><th style={{ textAlign: "left" }}>Resolution</th></tr></thead>
            <tbody>
              {FIXED.map(([s, f, r]) => (
                <tr key={f}><td style={{ textAlign: "left", whiteSpace: "nowrap" }}>{s}</td><td style={{ textAlign: "left" }}>{f}</td><td style={{ textAlign: "left", color: "var(--up)" }}>Fixed. {r}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
        <p style={{ fontSize: 14, color: "var(--dim)" }}>By design, a tiny amount of rounding dust coins is burned when a coin&apos;s pool opens, and the pool&apos;s opening price is rounded to the pool&apos;s price grid, up to about 2% above the target launch price. Both are tested.</p>
      </section>

      <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <h2 style={{ fontSize: 22 }}>Tests</h2>
        <p style={{ color: "var(--dim)" }}>The contracts run more than 160 unit and fuzz tests on every change, plus fork tests against real networks (Base, Robinhood Chain and BNB Chain) covering the full path: launch, the launch fee, trades from our app and from other apps, fee splits, buyback and the pool lock, with both token orderings and 6- and 18-decimal dollars.</p>
      </section>

      <section className="card" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <span style={{ fontWeight: 700 }}>Good to know</span>
        <p style={{ fontSize: 14, color: "var(--dim)", lineHeight: 1.6 }}>Security reviews lower risk but can&apos;t remove it. Meme coins are highly volatile and most lose value. These were independent peer reviews, not an engagement with an audit firm. Only trade what you can afford to lose. Found a problem? Write to <a href="mailto:team@arkhampad.com">team@arkhampad.com</a>.</p>
      </section>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <Link href="/learn/rug-pull-patterns/" className="btn">How to spot a rug pull</Link>
        <Link href="/help/" className="btn ghost">Help centre</Link>
      </div>
    </div>
  );
}
