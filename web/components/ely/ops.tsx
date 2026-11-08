"use client";
// /ops: owner-only switches for the launcher (not linked anywhere). Today: route the platform's fee share
// through the keeper wallet, which keeps a little HYPE for its own gas and forwards the rest to the
// treasury every 30 minutes, so the keeper never needs a manual top-up.
import { useCallback, useEffect, useState } from "react";
import { encodeFunctionData, parseAbi, parseAbiItem, parseEventLogs, type Address, type Hex } from "viem";
import { useWallet } from "@/components/wallet";
import { funnelStats, type FunnelRow } from "@/lib/funnel";
import { ELY_CHAIN, ELY_EXPLORER, ROUTER, ely, waitReceipt } from "@/lib/elytrade";
import { PIONEER } from "@/lib/pioneer";
import { PIONEER_CODE } from "@/lib/pioneer-code";
import { fetchHypeUsd, fetchOurCoinsVolume, fetchTokensByAddress, money, usePoll, type EOurCoin } from "@/lib/ely";

const START_BLOCK = 65000n; // just before the mainnet deploy
const TRADE = parseAbiItem("event Trade(address indexed user, address indexed token, bool isBuy, uint256 hypeAmount, uint256 tokenAmount, uint256 fee)");
const LAUNCHED = parseAbiItem("event Launched(address indexed coin, address indexed creator, address pool, uint256 tokenId, string name, string symbol, string uri, uint256 startMc, uint256 firstBuyIn, uint256 firstBuyOut)");
type Act = { kind: "buy" | "sell" | "launch"; who: Address; token: Address; hype: number; fee: number; block: bigint; tx: Hex; at?: number; label?: string };

/** Logs since the mainnet deploy, read in small windows (nodes refuse big ranges); a failed window is retried smaller. */
async function logsFrom<T>(fn: (from: bigint, to: bigint) => Promise<T[]>): Promise<T[]> {
  const latest = await ely().getBlockNumber();
  const STEP = 9_000n;
  const wins: [bigint, bigint][] = [];
  for (let from = START_BLOCK; from <= latest; from += STEP) wins.push([from, from + STEP - 1n > latest ? latest : from + STEP - 1n]);
  const one = async ([a, b]: [bigint, bigint]): Promise<T[]> => {
    try {
      return await fn(a, b);
    } catch (e) {
      if (b - a < 500n) throw e;
      const mid = a + (b - a) / 2n;
      return [...(await one([a, mid])), ...(await one([mid + 1n, b]))];
    }
  };
  const out: T[] = [];
  for (let i = 0; i < wins.length; i += 4) out.push(...(await Promise.all(wins.slice(i, i + 4).map(one))).flat());
  return out;
}
const FEES = parseAbiItem("event FeesCollected(address indexed coin, uint256 coinToCreator, uint256 coinToTreasury, uint256 nativeToCreator, uint256 nativeToTreasury)");
// version 2 only: a held share that went to ArkhamPad (the coin didn't reach $25K in its first day)
const HELD_TO_TREASURY = parseAbiItem("event HeldToTreasury(address indexed coin, uint256 coinAmount, uint256 nativeAmount)");
const TREASURY_ADDR = "0xd9D46EB26c9D753135683b7736FC2be097e7B099" as Address;
const KEEPER_ADDR = "0x8F7635FABfAd137E16E33ad808DdeC1D26491Af6" as Address;

/** What ArkhamPad earns: wallet balances, fees already collected, and per-coin earnings for coins launched here. */
function Earnings() {
  const usd = usePoll(fetchHypeUsd, 60_000) ?? 0;
  const coins = usePoll(fetchOurCoinsVolume, 60_000);
  const bals = usePoll(async () => {
    const [treasury, keeper] = await Promise.all([ely().getBalance({ address: TREASURY_ADDR }), ely().getBalance({ address: KEEPER_ADDR })]);
    return { treasury: Number(treasury) / 1e18, keeper: Number(keeper) / 1e18 };
  }, 30_000);
  const chain = usePoll(async () => {
    const collected = new Map<string, number>();
    let collectedAll = 0;
    for (const L of [LAUNCHER, LAUNCHER2]) {
      if (!L) continue;
      const logs = await logsFrom((fromBlock, toBlock) => ely().getLogs({ address: L as Address, event: FEES, fromBlock, toBlock }));
      for (const l of logs) {
        const v = Number(l.args.nativeToTreasury ?? 0n) / 1e18;
        collectedAll += v;
        const k = String(l.args.coin).toLowerCase();
        collected.set(k, (collected.get(k) ?? 0) + v);
      }
      if (L === LAUNCHER2) {
        const held = await logsFrom((fromBlock, toBlock) => ely().getLogs({ address: L as Address, event: HELD_TO_TREASURY, fromBlock, toBlock }));
        for (const l of held) {
          const v = Number(l.args.nativeAmount ?? 0n) / 1e18;
          collectedAll += v;
          const k = String(l.args.coin).toLowerCase();
          collected.set(k, (collected.get(k) ?? 0) + v);
        }
      }
    }
    return { collected, collectedAll };
  }, 120_000);
  const list: EOurCoin[] = coins ?? [];
  const vol = list.reduce((s, c) => s + c.vol, 0);
  const ours = vol * 0.007; // 1% pool fee, 70% to ArkhamPad
  const toCreators = vol * 0.003;
  const h = (x: number) => `${x.toFixed(4)} HYPE`;
  const u = (x: number) => (usd ? money(x * usd) : "");
  const cols = "1.4fr .8fr .9fr .9fr .9fr";
  return (
    <section className="e-panel"><div className="e-trade">
      <h3 className="e-ph" style={{ margin: 0 }}>Earnings <span className="dim" style={{ fontSize: 12.5, fontWeight: 600 }}>coins launched on ArkhamPad: 1% fee per trade, 70% ArkhamPad · 30% creator</span></h3>
      <div className="e-prev-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", padding: 0, border: 0 }}>
        <div><span>Treasury wallet</span><b>{bals ? h(bals.treasury) : "…"}</b><small className="dim">{bals ? u(bals.treasury) : ""}</small></div>
        <div><span>Keeper wallet (gas)</span><b>{bals ? h(bals.keeper) : "…"}</b><small className="dim">{bals ? u(bals.keeper) : ""}</small></div>
        <div><span>Earned, all time</span><b>{coins ? h(ours) : "…"}</b><small className="dim">{coins ? u(ours) : ""}</small></div>
        <div><span>Collected so far</span><b>{chain ? h(chain.collectedAll) : "…"}</b><small className="dim">waiting: {chain && coins ? h(Math.max(0, ours - chain.collectedAll)) : "…"}</small></div>
        <div><span>Paid to creators</span><b>{coins ? h(toCreators) : "…"}</b></div>
        <div><span>Volume, our coins</span><b>{coins ? h(vol) : "…"}</b><small className="dim">{coins ? u(vol) : ""}</small></div>
      </div>
      <p className="dim" style={{ fontSize: 12.5, margin: 0 }}>Earned = 0.7% of every trade on our coins. Fees sit in each pool until the keeper collects them (every 30 min); sell-side fees arrive in the coin itself. Router fees on other launchpads' coins are in Site activity.</p>
      <div style={{ display: "grid", gap: 2, fontSize: 13.5 }}>
        <div style={{ display: "grid", gridTemplateColumns: cols, gap: 8, fontWeight: 700 }} className="dim">
          <span>Coin · creator</span><span>Trades</span><span>Volume</span><span>ArkhamPad earned</span><span>Collected</span>
        </div>
        {list.map((c) => (
          <a key={c.address} href={`/t/?a=${c.address}`} style={{ display: "grid", gridTemplateColumns: cols, gap: 8, padding: "8px 0", borderTop: "1px solid var(--e-line)", alignItems: "center" }}>
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}><b>${c.symbol}</b> <span className="dim num">{c.creator ? short(c.creator) : ""}</span></span>
            <span className="num">{c.trades} <span className="dim">({c.buys}/{c.sells})</span></span>
            <span className="num">{c.vol.toFixed(3)}</span>
            <span className="num up">{(c.vol * 0.007).toFixed(4)}{usd ? <span className="dim"> {money(c.vol * 0.007 * usd)}</span> : null}</span>
            <span className="num">{chain ? (chain.collected.get(c.address.toLowerCase()) ?? 0).toFixed(4) : "…"}</span>
          </a>
        ))}
        {coins && !list.length && <p className="dim">No coins yet.</p>}
      </div>
    </div></section>
  );
}

/** Everything people did through ArkhamPad: trades via our router (any wallet, MetaMask too) and launches. */
function Activity() {
  const [rows, setRows] = useState<Act[] | null>(null);
  const [err, setErr] = useState("");
  const load = useCallback(async () => {
    try {
      const acts: Act[] = [];
      if (ROUTER) {
        const t = await logsFrom((fromBlock, toBlock) => ely().getLogs({ address: ROUTER as Address, event: TRADE, fromBlock, toBlock }));
        for (const l of t) acts.push({ kind: l.args.isBuy ? "buy" : "sell", who: l.args.user as Address, token: l.args.token as Address, hype: Number(l.args.hypeAmount) / 1e18, fee: Number(l.args.fee) / 1e18, block: l.blockNumber ?? 0n, tx: l.transactionHash as Hex });
      }
      for (const L of [LAUNCHER, LAUNCHER2]) {
        if (!L) continue;
        const t = await logsFrom((fromBlock, toBlock) => ely().getLogs({ address: L as Address, event: LAUNCHED, fromBlock, toBlock }));
        for (const l of t) acts.push({ kind: "launch", who: l.args.creator as Address, token: l.args.coin as Address, hype: Number(l.args.firstBuyIn) / 1e18, fee: 0, block: l.blockNumber ?? 0n, tx: l.transactionHash as Hex, label: `$${l.args.symbol}` });
      }
      acts.sort((a, b) => Number(b.block - a.block));
      const top = acts.slice(0, 150);
      const blocks = [...new Set(top.map((a) => a.block))];
      const times = new Map<bigint, number>();
      await Promise.all(blocks.map(async (b) => { try { times.set(b, Number((await ely().getBlock({ blockNumber: b })).timestamp)); } catch {} }));
      const names = new Map((await fetchTokensByAddress([...new Set(top.map((a) => a.token.toLowerCase()))]).catch(() => [])).map((t) => [t.address.toLowerCase(), `$${t.symbol}`]));
      for (const a of top) { a.at = times.get(a.block); a.label ??= names.get(a.token.toLowerCase()) ?? short(a.token); }
      (top as Act[] & { all?: Act[] }).all = acts;
      setRows(Object.assign(top, { all: acts }));
      setErr("");
    } catch {
      setErr("Could not read activity from Elysium right now.");
    }
  }, []);
  useEffect(() => { load(); const id = setInterval(load, 60_000); return () => clearInterval(id); }, [load]);
  const all = (rows as (Act[] & { all?: Act[] }) | null)?.all ?? [];
  const trades = all.filter((a) => a.kind !== "launch");
  const day = Date.now() / 1000 - 86400;
  const wallets = new Set(all.map((a) => a.who.toLowerCase()));
  const vol = trades.reduce((s, a) => s + a.hype, 0);
  const fees = trades.reduce((s, a) => s + a.fee, 0);
  return (
    <section className="e-panel"><div className="e-trade">
      <h3 className="e-ph" style={{ margin: 0 }}>Site activity <span className="dim" style={{ fontSize: 12.5, fontWeight: 600 }}>every trade and launch made through ArkhamPad (email, Google or any wallet)</span></h3>
      {err && <div className="e-msg bad">{err}</div>}
      {!rows ? <p className="dim">Loading…</p> : (
        <>
          <div className="e-prev-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))", padding: 0, border: 0 }}>
            <div><span>Wallets</span><b>{wallets.size}</b></div>
            <div><span>Trades</span><b>{trades.length}</b></div>
            <div><span>Launches</span><b>{all.length - trades.length}</b></div>
            <div><span>Volume</span><b>{vol.toFixed(3)} HYPE</b></div>
            <div><span>Router fees</span><b>{fees.toFixed(4)} HYPE</b></div>
            <div><span>Last 24h</span><b>{rows.filter((a) => (a.at ?? 0) > day).length} actions</b></div>
          </div>
          <div style={{ display: "grid", gap: 2, fontSize: 13.5 }}>
            {rows.map((a) => (
              <a key={`${a.tx}-${a.kind}`} href={ELY_EXPLORER ? `${ELY_EXPLORER}/tx/${a.tx}` : undefined} target="_blank" rel="noopener noreferrer" style={{ display: "grid", gridTemplateColumns: "64px 1fr auto", gap: 8, padding: "7px 0", borderTop: "1px solid var(--e-line)" }}>
                <b className={a.kind === "buy" ? "up" : a.kind === "sell" ? "down" : ""}>{a.kind}</b>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.label} · <span className="num dim">{short(a.who)}</span></span>
                <span className="num dim">{a.hype ? `${a.hype.toFixed(4)} HYPE · ` : ""}{a.at ? new Date(a.at * 1000).toLocaleString() : ""}</span>
              </a>
            ))}
            {!rows.length && <p className="dim">Nothing yet.</p>}
          </div>
        </>
      )}
    </div></section>
  );
}

const LAUNCHER = (process.env.NEXT_PUBLIC_ELY_LAUNCHER || "") as Address | "";
// version 2 ("25K" fee rules): same Launched / FeesCollected events; its own settings are below
const LAUNCHER2 = (process.env.NEXT_PUBLIC_ELY_LAUNCHER2 || "") as Address | "";
const KEEPER = "0x8F7635FABfAd137E16E33ad808DdeC1D26491Af6" as Address;
const TREASURY = "0xd9D46EB26c9D753135683b7736FC2be097e7B099" as Address;
const ABI = parseAbi([
  "function owner() view returns (address)",
  "function treasury() view returns (address)",
  "function startMc() view returns (uint256)",
  "function creatorBps() view returns (uint16)",
  "function launchFee() view returns (uint256)",
  "function paused() view returns (bool)",
  "function setSettings(address treasury_, uint256 startMc_, uint16 creatorBps_, uint256 launchFee_, bool paused_)",
]);
type S = { owner: Address; treasury: Address; startMc: bigint; creatorBps: number; launchFee: bigint; paused: boolean };
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

/** One-time: put the Genesis NFT contract on Elysium from the Admin wallet (no keys anywhere). */
function PioneerDeploy({ isOwner }: { isOwner: boolean }) {
  const w = useWallet();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [addr, setAddr] = useState<string | null>(null);
  async function go() {
    if (!w.signer?.sendTx) return w.login();
    setBusy(true);
    setMsg("Confirm in your wallet…");
    try {
      const hash = (await w.signer.sendTx(ELY_CHAIN, { data: PIONEER_CODE as Hex, gas: 8_000_000n })) as Hex;
      setMsg("Waiting for Elysium… (up to 2 minutes)");
      const r = await waitReceipt(hash, 180_000);
      if (r.status === "success" && r.contractAddress) { setAddr(r.contractAddress); setMsg("Deployed. Send this address to Claude:"); }
      else setMsg(`Failed on chain. Transaction: ${hash}`);
    } catch (e) {
      setMsg(/reject|denied|cancel/i.test(String((e as Error)?.message)) ? "Cancelled." : `Failed: ${String((e as Error)?.message ?? e).split("\n")[0].slice(0, 160)}`);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="e-panel"><div className="e-trade">
      <h3 style={{ margin: 0 }}>Genesis NFT</h3>
      {PIONEER ? (
        <p>Live at <b className="num">{PIONEER}</b>. Mint page: <a href="/genesis/" style={{ color: "var(--e-teal)" }}>/genesis</a></p>
      ) : (
        <>
          <p className="dim" style={{ fontSize: 14 }}>10,000 free badges, one per wallet. Press once with the Admin wallet; it costs a little HYPE for gas. Nobody can change the contract afterwards.</p>
          {!w.signedIn ? <button type="button" className="e-go" onClick={w.login}>Log in with the Admin wallet</button>
            : !isOwner ? <p className="e-msg bad">Switch to the Admin wallet first.</p>
            : !addr && <button type="button" className="e-go" disabled={busy} onClick={go}>{busy ? "Deploying…" : "Deploy the Genesis NFT contract"}</button>}
          {msg && <div className="e-msg" role="status">{msg}</div>}
          {addr && <code className="num" style={{ display: "block", padding: 12, borderRadius: 10, background: "var(--e-raise)", userSelect: "all", wordBreak: "break-all", fontSize: 16 }}>{addr}</code>}
        </>
      )}
    </div></section>
  );
}

const STEP_NAMES: Record<string, string> = {
  login: "Logged in", welcome: "Saw the welcome screen", deposit_page: "Opened Deposit", deposit_sent: "Sent a deposit",
  funded: "Has HYPE on Elysium", funded_real: "Has $2+ in HYPE", trade: "Made a trade", create: "Created a coin",
};
/** Where new wallets stop: each step as a count and as a share of everyone who logged in. */
function Funnel() {
  const rows = usePoll(funnelStats, 60_000);
  const [win, setWin] = useState<"total" | "d7" | "d1">("total");
  const top = rows?.find((r) => r.step === "login")?.[win] || 0;
  return (
    <section className="e-panel"><div className="e-trade">
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <h3 className="e-ph" style={{ margin: 0 }}>New wallets: where they stop</h3>
        <div className="e-via" style={{ marginLeft: "auto" }}>
          {([["total", "All"], ["d7", "7 days"], ["d1", "24 h"]] as const).map(([k, l]) => <button key={k} type="button" className={win === k ? "on" : ""} aria-pressed={win === k} onClick={() => setWin(k)}>{l}</button>)}
        </div>
      </div>
      {!rows ? <p className="dim">Loading…</p> : !rows.length ? <p className="dim">No data yet (run db/033_ap_funnel.sql in Supabase).</p> : (
        <div style={{ display: "grid", gap: 8 }}>
          {rows.map((r: FunnelRow) => {
            const n = r[win];
            const pct = top ? Math.round((n / top) * 100) : 0;
            return (
              <div key={r.step} style={{ display: "grid", gap: 4 }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14 }}><span>{STEP_NAMES[r.step] ?? r.step}</span><b className="num">{n}{top ? ` · ${pct}%` : ""}</b></div>
                <div style={{ height: 8, borderRadius: 6, background: "var(--e-raise)", overflow: "hidden" }}><div style={{ width: `${pct}%`, height: "100%", background: "var(--e-teal)" }} /></div>
              </div>
            );
          })}
          <p className="dim" style={{ fontSize: 12.5, margin: 0 }}>Counted from Nov 4, 2026. Wallets that logged in before then are counted once they come back.</p>
        </div>
      )}
    </div></section>
  );
}

const V2_ABI = parseAbi([
  "function owner() view returns (address)",
  "function treasury() view returns (address)",
  "function startMc() view returns (uint256)",
  "function launchFee() view returns (uint256)",
  "function paused() view returns (bool)",
  "function level1Mc() view returns (uint256)",
  "function level2Mc() view returns (uint256)",
  "function keeper() view returns (address)",
  "function coinCount() view returns (uint256)",
  "function setSettings(address treasury, uint256 startMc, uint256 launchFee, bool paused, uint256 level1Mc, uint256 level2Mc)",
]);
/** Version 2 ("25K" fee rules): its levels in HYPE, and one button to re-set them to $25K / $100K at today's HYPE price. */
function V2Settings() {
  const w = useWallet();
  const usd = usePoll(fetchHypeUsd, 60_000) ?? 0;
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [tick, setTick] = useState(0);
  const s = usePoll(async () => {
    if (!LAUNCHER2) return null;
    const c = { address: LAUNCHER2 as Address, abi: V2_ABI } as const;
    const [owner, treasury, startMc, launchFee, paused, l1, l2, keeper, n] = await Promise.all([
      ely().readContract({ ...c, functionName: "owner" }), ely().readContract({ ...c, functionName: "treasury" }), ely().readContract({ ...c, functionName: "startMc" }),
      ely().readContract({ ...c, functionName: "launchFee" }), ely().readContract({ ...c, functionName: "paused" }), ely().readContract({ ...c, functionName: "level1Mc" }),
      ely().readContract({ ...c, functionName: "level2Mc" }), ely().readContract({ ...c, functionName: "keeper" }), ely().readContract({ ...c, functionName: "coinCount" }),
    ]);
    return { owner: owner as Address, treasury: treasury as Address, startMc: startMc as bigint, launchFee: launchFee as bigint, paused: paused as boolean, l1: l1 as bigint, l2: l2 as bigint, keeper: keeper as Address, n: Number(n) };
  }, 60_000, [tick]);
  if (!LAUNCHER2) return null;
  const h = (x: bigint) => Number(x) / 1e18;
  const isOwner = !!s && !!w.address && w.address.toLowerCase() === s.owner.toLowerCase();
  // $25K / $100K in HYPE at today's price, rounded to whole HYPE
  const want1 = usd > 0 ? BigInt(Math.round(25_000 / usd)) * 10n ** 18n : 0n;
  const want2 = usd > 0 ? BigInt(Math.round(100_000 / usd)) * 10n ** 18n : 0n;
  async function reset() {
    if (!s || !w.signer?.sendTx || !want1 || want1 <= s.startMc || want2 <= want1) return;
    setBusy(true);
    setMsg("Confirm in your wallet…");
    try {
      const data = encodeFunctionData({ abi: V2_ABI, functionName: "setSettings", args: [s.treasury, s.startMc, s.launchFee, s.paused, want1, want2] });
      const hash = (await w.signer.sendTx(ELY_CHAIN, { to: LAUNCHER2 as Address, data })) as Hex;
      setMsg("Waiting for Elysium…");
      const r = await waitReceipt(hash, 150_000);
      setMsg(r.status === "success" ? "Done. Coins launched from now on use the new levels." : "Failed on chain.");
      setTick((x) => x + 1);
    } catch (e) {
      setMsg(/reject|denied|cancel/i.test(String((e as Error)?.message)) ? "Cancelled." : "Failed. Make sure the ArkhamPad Admin wallet is connected.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="e-panel"><div className="e-trade">
      <h3 style={{ margin: "0 0 8px", fontSize: 15 }}>Launcher v2 · 25K fee rules</h3>
      {!s ? <p className="dim">Loading…</p> : (
        <>
          <p>{s.n} coins · keeper <b className="num">{short(s.keeper)}</b> · fees to <b className="num">{short(s.treasury)}</b>{s.paused ? " · PAUSED" : ""}</p>
          <p>Level 1 (50%): <b className="num">{h(s.l1).toLocaleString("en-US")} HYPE</b>{usd ? <span className="dim"> ≈ ${(h(s.l1) * usd).toLocaleString("en-US", { maximumFractionDigits: 0 })}</span> : null} · Level 2 (60%): <b className="num">{h(s.l2).toLocaleString("en-US")} HYPE</b>{usd ? <span className="dim"> ≈ ${(h(s.l2) * usd).toLocaleString("en-US", { maximumFractionDigits: 0 })}</span> : null}</p>
          <p className="dim" style={{ fontSize: 14 }}>Each coin keeps the levels it launched with. When HYPE moves a lot, re-set them so new coins aim at $25K / $100K again.</p>
          {w.signedIn && isOwner && usd > 0 && (
            <button type="button" className="e-btn pri" disabled={busy} onClick={reset}>Set to $25K / $100K at today's price ({Number(want1 / 10n ** 18n)} / {Number(want2 / 10n ** 18n)} HYPE)</button>
          )}
          {msg && <p className="e-msg" role="status">{msg}</p>}
        </>
      )}
    </div></section>
  );
}

/** The shared swap router ElyScreener trades through (used when the site env var is not set). */
const SCREENER_ROUTER = "0xB1EEcB952D4853EAFCD219c0060218EAc6F2150a";
type EsOrder = { id: number; plan: string; kind: string; token: string | null; pay_asset: string; usd: number; paid_at: string };
const PLAN_NAMES: Record<string, string> = { profile: "Verified profile", boost12: "Boost 12h", boost24: "Boost 24h", boost72: "Boost 72h", banner1: "Banner 1 day", banner7: "Banner 7 days" };

/** ElyScreener's income: 0.5% router fee on swaps made on elyscreener.com + paid Verified / Boost / Banner orders. */
function ScreenerRevenue() {
  const usd = usePoll(fetchHypeUsd, 60_000) ?? 0;
  const data = usePoll(async () => {
    const rv = await fetch("/api/revenue", { cache: "no-store" }).then((r) => r.json()).catch(() => ({}));
    const hashes = ((rv?.swaps as string[]) ?? []).slice(0, 300);
    const router = (ROUTER || SCREENER_ROUTER).toLowerCase();
    // only the swaps ElyScreener reported: read each transaction's own receipt (light, no chain-wide scan)
    type Row = { tx: string; who: string; buy: boolean; hype: number; fee: number; at?: number };
    const rows: Row[] = [];
    let failed = 0;
    for (let i = 0; i < hashes.length; i += 15) {
      await Promise.all(hashes.slice(i, i + 15).map(async (h) => {
        try {
          const rc = await ely().getTransactionReceipt({ hash: h as Hex });
          if (rc.status !== "success") return;
          const ev = parseEventLogs({ abi: [TRADE], logs: rc.logs.filter((l) => l.address.toLowerCase() === router) })[0];
          if (!ev) return;
          rows.push({ tx: h, who: ev.args.user as string, buy: !!ev.args.isBuy, hype: Number(ev.args.hypeAmount ?? 0n) / 1e18, fee: Number(ev.args.fee ?? 0n) / 1e18, at: Number(rc.blockNumber) });
        } catch { failed++; }
      }));
    }
    rows.sort((x, y) => (y.at ?? 0) - (x.at ?? 0));
    const recent = rows.slice(0, 8);
    await Promise.all(recent.map(async (r) => { try { r.at = Number((await ely().getBlock({ blockNumber: BigInt(r.at ?? 0) })).timestamp); } catch { r.at = undefined; } }));
    return {
      chainOk: failed === 0, sqlOk: Array.isArray(rv?.orders), orders: ((rv?.orders as EsOrder[]) ?? []), pending: Number(rv?.pending ?? 0), known: hashes.length,
      es: { n: rows.length, fee: rows.reduce((x, r) => x + r.fee, 0), vol: rows.reduce((x, r) => x + r.hype, 0) },
      recent,
    };
  }, 120_000);
  const orders = data?.orders ?? [];
  const day = Date.now() - 86400_000;
  const promoAll = orders.reduce((a, o) => a + o.usd, 0);
  const promo24 = orders.filter((o) => Date.parse(o.paid_at) > day).reduce((a, o) => a + o.usd, 0);
  const feeUsd = (data?.es.fee ?? 0) * usd;
  const byPlan = new Map<string, { n: number; usd: number }>();
  for (const o of orders) { const x = byPlan.get(o.plan) ?? { n: 0, usd: 0 }; x.n += 1; x.usd += o.usd; byPlan.set(o.plan, x); }
  return (
    <section className="e-panel"><div className="e-trade">
      <h3 className="e-ph" style={{ margin: 0 }}>ElyScreener income <span className="dim" style={{ fontSize: 12.5, fontWeight: 600 }}>swap fee (0.5%) on swaps made on elyscreener.com + paid promotions</span></h3>
      {!data ? <p className="dim">Loading…</p> : (
        <>
          {!data.sqlOk && <div className="e-msg bad">Promotion numbers are not available yet: run es_031_revenue.sql in Supabase.</div>}
          {!data.chainOk && <div className="e-msg bad">Some swaps could not be read from Elysium right now (the node did not answer). Promotions below are still correct; reload in a minute.</div>}
          <div className="e-prev-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", padding: 0, border: 0 }}>
            <div><span>Total income</span><b>{usd ? money(feeUsd + promoAll) : `${promoAll.toFixed(0)} USD + fees`}</b><small className="dim">fees + promotions</small></div>
            <div><span>Swap fees (0.5%)</span><b>{data.es.fee.toFixed(4)} HYPE</b><small className="dim">{usd ? money(feeUsd) : ""} · {data.es.n} swaps</small></div>
            <div><span>Swap volume</span><b>{data.es.vol.toFixed(2)} HYPE</b><small className="dim">{usd ? money(data.es.vol * usd) : ""}</small></div>
            <div><span>Promotions</span><b>{money(promoAll)}</b><small className="dim">{orders.length} paid · last 24h {money(promo24)}</small></div>
            <div><span>Waiting for payment</span><b>{data.pending}</b><small className="dim">orders not yet confirmed</small></div>
          </div>
          <p className="dim" style={{ fontSize: 12.5, margin: 0 }}>Swap fees go to the ArkhamPad Treasury, promotions to the "elyscreener" wallet. Swaps are counted from the moment the site starts reporting them (run es_031_revenue.sql, then upload the ElyScreener update).</p>
          {byPlan.size > 0 && (
            <div style={{ display: "grid", gap: 2, fontSize: 13.5 }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr auto auto", gap: 8, fontWeight: 700 }} className="dim"><span>Promotion</span><span>Orders</span><span>Income</span></div>
              {[...byPlan.entries()].map(([k, v]) => (
                <div key={k} style={{ display: "grid", gridTemplateColumns: "1fr auto auto", gap: 8, padding: "6px 0", borderTop: "1px solid var(--e-line)" }}><span>{PLAN_NAMES[k] ?? k}</span><span className="num">{v.n}</span><b className="num">{money(v.usd)}</b></div>
              ))}
            </div>
          )}
          {data.recent.length > 0 && (
            <div style={{ display: "grid", gap: 2, fontSize: 13.5 }}>
              <div className="dim" style={{ fontWeight: 700 }}>Latest swaps on ElyScreener</div>
              {data.recent.map((r) => (
                <div key={r.tx} style={{ display: "grid", gridTemplateColumns: "48px 1fr auto", gap: 8, padding: "6px 0", borderTop: "1px solid var(--e-line)" }}>
                  <b className={r.buy ? "up" : "down"}>{r.buy ? "buy" : "sell"}</b>
                  <span className="num dim" style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{short(r.who)} · {r.hype.toFixed(3)} HYPE</span>
                  <span className="num">{r.fee.toFixed(4)} HYPE{r.at ? ` · ${new Date(r.at * 1000).toLocaleString()}` : ""}</span>
                </div>
              ))}
            </div>
          )}
          {orders.length > 0 && (
            <div style={{ display: "grid", gap: 2, fontSize: 13.5 }}>
              <div className="dim" style={{ fontWeight: 700 }}>Latest paid promotions</div>
              {orders.slice(0, 8).map((o) => (
                <div key={o.id} style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 8, padding: "6px 0", borderTop: "1px solid var(--e-line)" }}>
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{PLAN_NAMES[o.plan] ?? o.plan}{o.token ? ` · ${short(o.token)}` : ""}</span>
                  <span className="num"><b>{money(o.usd)}</b> <span className="dim">{o.pay_asset} · {new Date(o.paid_at).toLocaleDateString()}</span></span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div></section>
  );
}

export function OpsPage() {
  const w = useWallet();
  const [s, setS] = useState<S | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    if (!LAUNCHER) return;
    const c = { address: LAUNCHER as Address, abi: ABI } as const;
    const [owner, treasury, startMc, creatorBps, launchFee, paused] = await Promise.all([
      ely().readContract({ ...c, functionName: "owner" }),
      ely().readContract({ ...c, functionName: "treasury" }),
      ely().readContract({ ...c, functionName: "startMc" }),
      ely().readContract({ ...c, functionName: "creatorBps" }),
      ely().readContract({ ...c, functionName: "launchFee" }),
      ely().readContract({ ...c, functionName: "paused" }),
    ]);
    setS({ owner, treasury, startMc, creatorBps: Number(creatorBps), launchFee, paused });
  }, []);
  useEffect(() => { load().catch(() => setMsg("Could not read the launcher.")); }, [load]);

  const isOwner = !!s && !!w.address && w.address.toLowerCase() === s.owner.toLowerCase();
  const routed = !!s && s.treasury.toLowerCase() === KEEPER.toLowerCase();

  // one settings write; anything not given keeps its current value
  async function save(change: Partial<Pick<S, "treasury" | "startMc">>) {
    if (!s || !w.signer?.sendTx) return w.login();
    setBusy(true);
    setMsg("Confirm in your wallet…");
    try {
      const n = { ...s, ...change };
      const data = encodeFunctionData({ abi: ABI, functionName: "setSettings", args: [n.treasury, n.startMc, n.creatorBps, n.launchFee, n.paused] });
      const hash = (await w.signer.sendTx(ELY_CHAIN, { to: LAUNCHER as Address, data })) as Hex;
      setMsg("Waiting for Elysium…");
      const r = await waitReceipt(hash, 150_000);
      setMsg(r.status === "success" ? "Done." : "Failed on chain.");
      await load();
    } catch (e) {
      setMsg(/reject|denied|cancel/i.test(String((e as Error)?.message)) ? "Cancelled." : "Failed. Make sure the ArkhamPad Admin wallet is connected and has a little HYPE on Elysium.");
    } finally {
      setBusy(false);
    }
  }
  const setTreasury = (to: Address) => save({ treasury: to });

  // starting market cap of new coins (whole supply, in HYPE); most Elysium launchpads start around 30 HYPE
  const usd = usePoll(fetchHypeUsd, 60_000) ?? 0;
  const [mcIn, setMcIn] = useState("");
  const mcNow = s ? Number(s.startMc) / 1e18 : 0;
  const mcNew = Number(mcIn.replace(",", "."));
  const mcOk = mcNew >= 5 && mcNew <= 5000;

  return (
    <main className="e-in e-page">
      <section className="e-hero"><div><span className="e-eyebrow">Ops</span><h1>ArkhamPad ops</h1></div></section>
      <Funnel />
      <ScreenerRevenue />
      <Earnings />
      <Activity />
      <V2Settings />
      <section className="e-panel"><div className="e-trade">
        {!LAUNCHER ? <p>Launcher not deployed.</p> : !s ? <p className="dim">Loading…</p> : (
          <>
            <p>Owner: <b className="num">{short(s.owner)}</b> · Fees go to: <b className="num">{short(s.treasury)}</b> {routed ? "(keeper, self-funding)" : s.treasury.toLowerCase() === TREASURY.toLowerCase() ? "(treasury)" : ""}</p>
            <p className="dim" style={{ fontSize: 14 }}>Self-funding: fees land on the keeper ({short(KEEPER)}), which keeps 0.1 HYPE for gas and sends the rest to the treasury ({short(TREASURY)}) every 30 minutes.</p>
            {!w.signedIn ? (
              <button type="button" className="e-go" onClick={w.login}>Log in with the Admin wallet</button>
            ) : !isOwner ? (
              <p className="e-msg bad">Connected {short(w.address || "")}. Switch to the owner wallet ({short(s.owner)}).</p>
            ) : routed ? (
              <button type="button" className="e-go" disabled={busy} onClick={() => setTreasury(TREASURY)}>Send fees straight to the treasury instead</button>
            ) : (
              <button type="button" className="e-go" disabled={busy} onClick={() => setTreasury(KEEPER)}>Turn on self-funding keeper</button>
            )}
            <hr style={{ border: 0, borderTop: "1px solid var(--e-line)", margin: "16px 0" }} />
            <p>New coins start at: <b className="num">{mcNow.toLocaleString("en-US", { maximumFractionDigits: 2 })} HYPE</b>{usd ? <span className="dim"> (≈ ${(mcNow * usd).toLocaleString("en-US", { maximumFractionDigits: 0 })})</span> : null}</p>
            <p className="dim" style={{ fontSize: 14 }}>Market cap of the whole supply when a coin launches. Most Elysium launchpads start around 30 HYPE. Only coins launched after the change are affected.</p>
            {w.signedIn && isOwner && (
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <input inputMode="decimal" placeholder="30" value={mcIn} onChange={(e) => setMcIn(e.target.value.replace(/[^0-9.,]/g, ""))} aria-label="Start market cap in HYPE" style={{ flex: "1 1 120px", padding: "10px 12px", borderRadius: 10, border: "1px solid var(--e-line2)", background: "transparent", color: "inherit", font: "inherit" }} />
                <span className="dim">HYPE{mcOk && usd ? ` ≈ $${(mcNew * usd).toLocaleString("en-US", { maximumFractionDigits: 0 })}` : ""}</span>
                <button type="button" className="e-btn pri" disabled={busy || !mcOk} onClick={() => save({ startMc: BigInt(Math.round(mcNew * 1e6)) * 10n ** 12n })}>Save start value</button>
              </div>
            )}
            {msg && <div className="e-msg" role="status">{msg}</div>}
          </>
        )}
      </div></section>
      <PioneerDeploy isOwner={isOwner} />
    </main>
  );
}
