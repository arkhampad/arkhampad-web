"use client";
// /ops: owner-only switches for the launcher (not linked anywhere). Today: route the platform's fee share
// through the keeper wallet, which keeps a little HYPE for its own gas and forwards the rest to the
// treasury every 30 minutes, so the keeper never needs a manual top-up.
import { useCallback, useEffect, useState } from "react";
import { encodeFunctionData, parseAbi, parseAbiItem, parseEventLogs, type Address, type Hex } from "viem";
import { createPublicClient, fallback, http } from "viem";
import { useWallet } from "@/components/wallet";
import { funnelStats, type FunnelRow } from "@/lib/funnel";
import { ELY_CHAIN, ELY_EXPLORER, ROUTER, ely, waitReceipt } from "@/lib/elytrade";
import { PIONEER } from "@/lib/pioneer";
import { PIONEER_CODE } from "@/lib/pioneer-code";
import { fetchHypeUsd, fetchOurCoinsVolume, fetchTokensByAddress, money, usePoll, type EOurCoin } from "@/lib/ely";

/** Run a loader at most once every 30 s, however many panels ask (the overview and the detail panels share one read). */
function memo<T>(fn: () => Promise<T>): () => Promise<T> {
  let at = 0;
  let p: Promise<T> | undefined;
  return () => { if (!p || Date.now() - at > 30_000) { at = Date.now(); p = fn().catch((e) => { at = 0; throw e; }); } return p; };
}
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
  // The public Elysium nodes throttle big scans, so read in small steps, keep the progress in this browser and
  // resume from there on every poll; whatever is known so far is shown right away.
  const chain = usePoll(async () => {
    const KEY = "ops-fees-v1";
    type St = { next: Record<string, string>; coll: Record<string, number> };
    let st: St = { next: {}, coll: {} };
    try { const r = JSON.parse(localStorage.getItem(KEY) || "null"); if (r?.next && r?.coll) st = r; } catch {}
    const latest = await ely().getBlockNumber().catch(() => 0n);
    const STEP = 9_000n;
    let budget = 40; // windows per poll
    const add = (coin: unknown, v: number) => { const k = String(coin).toLowerCase(); st.coll[k] = (st.coll[k] ?? 0) + v; };
    for (const L of [LAUNCHER, LAUNCHER2]) {
      if (!L || latest === 0n) continue;
      let from = BigInt(st.next[L] ?? START_BLOCK.toString());
      while (from <= latest && budget > 0) {
        const to = from + STEP - 1n > latest ? latest : from + STEP - 1n;
        try {
          const logs = await ely().getLogs({ address: L as Address, event: FEES, fromBlock: from, toBlock: to });
          const held = L === LAUNCHER2 ? await ely().getLogs({ address: L as Address, event: HELD_TO_TREASURY, fromBlock: from, toBlock: to }) : [];
          for (const l of logs) add(l.args.coin, Number(l.args.nativeToTreasury ?? 0n) / 1e18);
          for (const l of held) add(l.args.coin, Number(l.args.nativeAmount ?? 0n) / 1e18);
        } catch { budget = 0; break; }
        from = to + 1n; budget--;
        st.next[L] = from.toString();
        try { localStorage.setItem(KEY, JSON.stringify(st)); } catch {}
      }
    }
    const collected = new Map<string, number>(Object.entries(st.coll));
    let collectedAll = 0; for (const v of collected.values()) collectedAll += v;
    return { collected, collectedAll };
  }, 20_000);
  const list: EOurCoin[] = coins ?? [];
  const vol = list.reduce((s, c) => s + c.vol, 0);
  const ours = vol * 0.007; // 1% pool fee, 70% to ArkhamPad
  const toCreators = vol * 0.003;
  const h = (x: number) => `${x.toFixed(4)} HYPE`;
  const u = (x: number) => (usd ? money(x * usd) : "");
  const cols = "minmax(120px,1.4fr) 76px 70px minmax(100px,1fr) 84px";
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
      <div style={{ display: "grid", gap: 2, fontSize: 13.5, overflowX: "auto" }}>
        <div style={{ display: "grid", gridTemplateColumns: cols, gap: 8, fontWeight: 700, minWidth: 540 }} className="dim">
          <span>Coin · creator</span><span>Trades</span><span>Volume</span><span>ArkhamPad earned</span><span>Collected</span>
        </div>
        {list.map((c) => (
          <a key={c.address} href={`/t/?a=${c.address}`} style={{ display: "grid", gridTemplateColumns: cols, gap: 8, minWidth: 540, padding: "8px 0", borderTop: "1px solid var(--e-line)", alignItems: "center" }}>
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

/** ElyScreener income on Robinhood Chain: 0.5% on every ETH swap through our two routers, paid straight to the treasury in ETH. */
const RH_RPC = "https://rpc.mainnet.chain.robinhood.com";
const RH_TREASURY = "0x3523f40db9428e593e10d002d4935e33f3c4e0ab" as Address;
const RH_ROUTERS = ["0xf567815133c4b478c5c3b1ef04eac6114656f822", "0x43c9234bb8be8e4f5aa03d14ee3d12213ef92562"] as Address[];
const RH_TRADE_A = parseAbiItem("event Trade(address indexed user, address indexed token, bool isBuy, uint256 hypeAmount, uint256 tokenAmount, uint256 fee)");
const RH_TRADE_B = parseAbiItem("event Trade(address indexed user, address indexed token, address indexed curve, bool isBuy, uint256 ethAmount, uint256 tokenAmount, uint256 fee)");
let rhClient: ReturnType<typeof createPublicClient> | null = null;
const rh = () => (rhClient ??= createPublicClient({ transport: http(RH_RPC) }));
type RhRow = { tx: string; who: string; token: string; buy: boolean; eth: number; fee: number; block: number; at?: number };

/** Robinhood Chain swaps through our routers (last 7 days); shared by the overview and its own panel. */
const loadRh = memo(async () => {
    const c = rh();
    const [bal, tip] = await Promise.all([c.getBalance({ address: RH_TREASURY }), c.getBlockNumber()]);
    const from0 = tip > 6_000_000n ? tip - 6_000_000n : 0n; // about 7 days at 100 ms blocks
    const STEP = 400_000n;
    const rows: RhRow[] = [];
    let failed = 0;
    const pull = async (router: Address, curve: boolean, a: bigint, b: bigint): Promise<void> => {
      try {
        const logs = await c.getLogs({ address: router, event: (curve ? RH_TRADE_B : RH_TRADE_A) as never, fromBlock: a, toBlock: b });
        for (const l of logs as any[]) {
          const g = l.args ?? {};
          rows.push({ tx: l.transactionHash, who: g.user, token: g.token, buy: !!g.isBuy, eth: Number(curve ? g.ethAmount : g.hypeAmount) / 1e18, fee: Number(g.fee ?? 0n) / 1e18, block: Number(l.blockNumber) });
        }
      } catch { if (b - a < 20_000n) { failed++; return; } const m = a + (b - a) / 2n; await pull(router, curve, a, m); await pull(router, curve, m + 1n, b); }
    };
    for (let a = from0; a <= tip; a += STEP) {
      const b = a + STEP - 1n > tip ? tip : a + STEP - 1n;
      await Promise.all(RH_ROUTERS.map((r, i) => pull(r, i === 1, a, b)));
    }
    rows.sort((x, y) => y.block - x.block);
    const recent = rows.slice(0, 8);
    await Promise.all(recent.map(async (r) => { try { r.at = Number((await c.getBlock({ blockNumber: BigInt(r.block) })).timestamp); } catch {} }));
    return { bal: Number(bal) / 1e18, n: rows.length, fee: rows.reduce((x, r) => x + r.fee, 0), vol: rows.reduce((x, r) => x + r.eth, 0), recent, ok: failed === 0 };
});

function RobinhoodRevenue() {
  const ethUsd = usePoll(async () => {
    try { const r = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd").then((x) => x.json()); return Number(r?.ethereum?.usd ?? 0); } catch { return 0; }
  }, 300_000) ?? 0;
  const data = usePoll(loadRh, 120_000);
  const u = (n: number) => (ethUsd ? money(n * ethUsd) : "");
  return (
    <section className="e-panel"><div className="e-trade">
      <h3 className="e-ph" style={{ margin: 0 }}>Robinhood Chain income <span className="dim" style={{ fontSize: 12.5, fontWeight: 600 }}>0.5% on ETH swaps made on elyscreener.com, paid to the treasury in ETH</span></h3>
      {!data ? <p className="dim">Loading…</p> : (
        <>
          {!data.ok && <div className="e-msg bad">Some of the history could not be read right now (the node did not answer). Reload in a minute.</div>}
          <div className="e-prev-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", padding: 0, border: 0 }}>
            <div><span>Treasury wallet</span><b>{data.bal.toFixed(5)} ETH</b><small className="dim">{u(data.bal)} · {short(RH_TREASURY)}</small></div>
            <div><span>Swap fees (0.5%)</span><b>{data.fee.toFixed(5)} ETH</b><small className="dim">{u(data.fee)} · {data.n} swaps · last 7 days</small></div>
            <div><span>Swap volume</span><b>{data.vol.toFixed(4)} ETH</b><small className="dim">{u(data.vol)}</small></div>
          </div>
          <p className="dim" style={{ fontSize: 12.5, margin: 0 }}>Coins that use the sasa hook trade with USDC through the sasa router, their fee goes to sasa and is not counted here.</p>
          {data.recent.length > 0 && (
            <div style={{ display: "grid", gap: 2, fontSize: 13.5 }}>
              <div className="dim" style={{ fontWeight: 700 }}>Latest swaps</div>
              {data.recent.map((r) => (
                <div key={r.tx + r.block} style={{ display: "flex", flexWrap: "wrap", gap: "2px 10px", padding: "6px 0", borderTop: "1px solid var(--e-line)" }}>
                  <b className={r.buy ? "up" : "down"}>{r.buy ? "buy" : "sell"}</b>
                  <span className="num dim" style={{ flex: "1 1 150px", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{short(r.who)} · {r.eth.toFixed(5)} ETH</span>
                  <span className="num">{r.fee.toFixed(6)} ETH{r.at ? ` · ${new Date(r.at * 1000).toLocaleString()}` : ""}</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div></section>
  );
}

/** The shared swap router ElyScreener trades through (used when the site env var is not set). */
const SCREENER_ROUTER = "0xB1EEcB952D4853EAFCD219c0060218EAc6F2150a";
type EsOrder = { id: number; plan: string; kind: string; token: string | null; pay_asset: string; usd: number; paid_at: string };
const PLAN_NAMES: Record<string, string> = { profile: "Verified profile", boost12: "Boost 12h", boost24: "Boost 24h", boost72: "Boost 72h", banner1: "Banner 1 day", banner7: "Banner 7 days" };

/** Elysium swaps made on elyscreener.com (hashes the site reported, read from their receipts) and paid promotions. */
const loadEly = memo(async () => {
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
});

/** ElyScreener's income: 0.5% router fee on swaps made on elyscreener.com + paid Verified / Boost / Banner orders. */
function ScreenerRevenue() {
  const usd = usePoll(fetchHypeUsd, 60_000) ?? 0;
  const data = usePoll(loadEly, 120_000);
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
                <div key={r.tx} style={{ display: "flex", flexWrap: "wrap", gap: "2px 10px", padding: "6px 0", borderTop: "1px solid var(--e-line)" }}>
                  <b className={r.buy ? "up" : "down"}>{r.buy ? "buy" : "sell"}</b>
                  <span className="num dim" style={{ flex: "1 1 150px", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{short(r.who)} · {r.hype.toFixed(3)} HYPE</span>
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


/* ---------------------------------------------------------------------------------------------------------------------------
 * ElyScreener overview: every chain on one screen. Coins listed, what traded in the last 24h, how many swaps were made through
 * our routers on elyscreener.com and what the 0.5% fee brought in, in the chain's own coin and in dollars.
 * ------------------------------------------------------------------------------------------------------------------------- */
const SB_REST = "https://yvdudswzmdziwnfurwir.supabase.co/rest/v1";
const SB_KEY_PUB = "sb_publishable_S49UWqqXDzSaRbjBsAfYaA_kjfxyRPB";
const sbHead = { apikey: SB_KEY_PUB, authorization: `Bearer ${SB_KEY_PUB}` };
/** exact row count of a table query (PostgREST: Content-Range "0-0/1234") */
async function sbCount(path: string): Promise<number | null> {
  try {
    const r = await fetch(`${SB_REST}/${path}`, { headers: { ...sbHead, prefer: "count=exact", range: "0-0" } });
    const n = Number((r.headers.get("content-range") ?? "").split("/")[1]);
    return Number.isFinite(n) ? n : null;
  } catch { return null; }
}
async function sbRows<T>(path: string): Promise<T[]> {
  try { const r = await fetch(`${SB_REST}/${path}`, { headers: sbHead }); const j = await r.json(); return Array.isArray(j) ? (j as T[]) : []; } catch { return []; }
}
const TRADE_N = parseAbiItem("event Trade(address indexed user, address indexed token, bool isBuy, uint256 hypeAmount, uint256 tokenAmount, uint256 fee)");
const TREASURY_ABI = parseAbi(["function treasury() view returns (address)"]);
type XChain = { key: string; name: string; native: string; cg: string; pfx: string; rpc: string[]; router: Address; back: bigint; step: bigint; days: number };
// BNB Chain and Base: our router is new, so the last few days of its Trade events are everything it ever did
const X_CHAINS: XChain[] = [
  { key: "bnb", name: "BNB Chain", native: "BNB", cg: "binancecoin", pfx: "bnb_", rpc: ["https://bsc-dataseed.bnbchain.org", "https://bsc-rpc.publicnode.com", "https://bsc-dataseed1.defibit.io", "https://1rpc.io/bnb"], router: "0x962856ee534d217529E70478651751d2CC02EcbB", back: 150_000n, step: 5_000n, days: 5 },
  { key: "base", name: "Base", native: "ETH", cg: "ethereum", pfx: "base_", rpc: ["https://mainnet.base.org", "https://base-rpc.publicnode.com", "https://base.llamarpc.com"], router: "0xbfdf97855cae452339811a74789bd167238c7a4a", back: 260_000n, step: 20_000n, days: 6 },
];
const xMemo = new Map<string, () => Promise<{ n: number; fee: number; vol: number; ok: boolean; treasury: string | null }>>();
function loadX(c: XChain) {
  if (!xMemo.has(c.key)) xMemo.set(c.key, memo(async () => {
    const client = createPublicClient({ transport: fallback(c.rpc.map((u) => http(u, { timeout: 12_000 })), { rank: false }) });
    const tip = await client.getBlockNumber();
    const from0 = tip > c.back ? tip - c.back : 0n;
    let n = 0, fee = 0, vol = 0, failed = 0;
    const pull = async (a: bigint, b: bigint): Promise<void> => {
      try {
        const logs = await client.getLogs({ address: c.router, event: TRADE_N, fromBlock: a, toBlock: b });
        for (const l of logs) { n++; fee += Number(l.args.fee ?? 0n) / 1e18; vol += Number(l.args.hypeAmount ?? 0n) / 1e18; }
      } catch { if (b - a < 500n) { failed++; return; } const m = a + (b - a) / 2n; await pull(a, m); await pull(m + 1n, b); }
    };
    for (let a = from0; a <= tip; a += c.step) await pull(a, a + c.step - 1n > tip ? tip : a + c.step - 1n);
    const treasury = await client.readContract({ address: c.router, abi: TREASURY_ABI, functionName: "treasury" }).catch(() => null);
    return { n, fee, vol, ok: failed === 0, treasury: treasury as string | null };
  }));
  return xMemo.get(c.key)!;
}

type Row = { key: string; name: string; native: string; coins: number | null; traded: number | null; vol24: number; swaps: number | null; fee: number | null; swapVol: number | null; usd: number; period: string; ok: boolean; note?: string };

// every other chain trades through the best-price route (fee paid straight to the ElyScreener wallet in the coin of that chain); the site reports each swap in dollars
const OTHER = [
  { key: "sol", name: "Solana", pfx: "sol_" }, { key: "eth", name: "Ethereum", pfx: "eth_" }, { key: "arb", name: "Arbitrum", pfx: "arb_" }, { key: "pol", name: "Polygon", pfx: "pol_" }, { key: "op", name: "Optimism", pfx: "op_" },
  { key: "avax", name: "Avalanche", pfx: "avax_" }, { key: "linea", name: "Linea", pfx: "linea_" }, { key: "sonic", name: "Sonic", pfx: "sonic_" }, { key: "bera", name: "Berachain", pfx: "bera_" }, { key: "uni", name: "Unichain", pfx: "uni_" },
  { key: "mon", name: "Monad", pfx: "mon_" }, { key: "arc", name: "Arc", pfx: "arc_" }, { key: "hyp", name: "HyperEVM", pfx: "hyp_" },
];
type XSum = { chains: { chain: string; n: number; vol: number }[]; recent: { chain: string; tx: string; usd: number; side: string; at: string }[] };
function ChainsOverview() {
  const prices = usePoll(async () => {
    try { const r = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=ethereum,binancecoin&vs_currencies=usd").then((x) => x.json()); return { ETH: Number(r?.ethereum?.usd ?? 0), BNB: Number(r?.binancecoin?.usd ?? 0) }; } catch { return { ETH: 0, BNB: 0 }; }
  }, 300_000);
  const hypeUsd = usePoll(fetchHypeUsd, 60_000) ?? 0;
  const base = usePoll(async () => {
    const defs: { key: string; pfx: string }[] = [{ key: "elysium", pfx: "ely_" }, { key: "rh", pfx: "rh_" }, { key: "bnb", pfx: "bnb_" }, { key: "base", pfx: "base_" }, ...OTHER.map((o) => ({ key: o.key, pfx: o.pfx }))];
    return Promise.all(defs.map(async (d) => {
      const [coins, traded, vols] = await Promise.all([
        sbCount(`${d.pfx}tokens?select=address`),
        sbCount(`${d.pfx}tokens?select=address&or=(buys24.gt.0,sells24.gt.0)`),
        sbRows<{ vol24_hype: number | null; mcap_hype: number | null; mcap_usd: number | null; holders: number | null; launchpad: string | null }>(`${d.pfx}tokens?select=vol24_hype,mcap_hype,mcap_usd,holders,launchpad&vol24_hype=gt.0&limit=5000`),
      ]);
      return { key: d.key, coins, traded, vols };
    }));
  }, 120_000);
  const ely = usePoll(loadEly, 120_000);
  const rhd = usePoll(loadRh, 120_000);
  const bnb = usePoll(loadX(X_CHAINS[0]), 120_000);
  const bse = usePoll(loadX(X_CHAINS[1]), 120_000);
  const xs = usePoll(async () => { try { const r = await fetch(`${SB_REST}/rpc/es_xswaps_summary`, { method: "POST", headers: { ...sbHead, "content-type": "application/json" }, body: "{}" }); const j = await r.json(); return (j?.chains ? j : { chains: [], recent: [] }) as XSum; } catch { return { chains: [], recent: [] } as XSum; } }, 120_000);
  const px = { HYPE: hypeUsd, ETH: prices?.ETH ?? 0, BNB: prices?.BNB ?? 0 } as Record<string, number>;
  const b = (k: string) => base?.find((x) => x.key === k);
  // like the lists on the site: a coin under $1K market cap counts no volume, and volume above 20x market cap is wash trading
  const EXT_PADS_OPS = ["Uniswap v3", "Aerodrome", "Uniswap v4", "Clanker"];
  const vol24Of = (k: string, native: string) => { const usd = px[native] || 0; if (!usd) return 0; return (b(k)?.vols ?? []).reduce((a, r) => { const mc = Number(r.mcap_usd ?? Number(r.mcap_hype ?? 0) * usd), v = Number(r.vol24_hype ?? 0) * usd; const fake = !EXT_PADS_OPS.includes(String(r.launchpad)) && Number(r.holders ?? 0) < 10 && mc > 100_000; return mc >= 1000 && !fake ? a + Math.min(v, 20 * mc) / usd : a; }, 0); };
  const rows: Row[] = [
    { key: "elysium", name: "Elysium", native: "HYPE", coins: b("elysium")?.coins ?? null, traded: b("elysium")?.traded ?? null, vol24: vol24Of("elysium", "HYPE"), swaps: ely ? ely.es.n : null, fee: ely ? ely.es.fee : null, swapVol: ely ? ely.es.vol : null, usd: px.HYPE, period: "all time", ok: ely ? ely.chainOk : true },
    { key: "rh", name: "Robinhood Chain", native: "ETH", coins: b("rh")?.coins ?? null, traded: b("rh")?.traded ?? null, vol24: vol24Of("rh", "ETH"), swaps: rhd ? rhd.n : null, fee: rhd ? rhd.fee : null, swapVol: rhd ? rhd.vol : null, usd: px.ETH, period: "last 7 days", ok: rhd ? rhd.ok : true },
    { key: "bnb", name: "BNB Chain", native: "BNB", coins: b("bnb")?.coins ?? null, traded: b("bnb")?.traded ?? null, vol24: vol24Of("bnb", "BNB"), swaps: bnb ? bnb.n : null, fee: bnb ? bnb.fee : null, swapVol: bnb ? bnb.vol : null, usd: px.BNB, period: `last ${X_CHAINS[0].days} days`, ok: bnb ? bnb.ok : true },
    { key: "base", name: "Base", native: "ETH", coins: b("base")?.coins ?? null, traded: b("base")?.traded ?? null, vol24: vol24Of("base", "ETH"), swaps: bse ? bse.n : null, fee: bse ? bse.fee : null, swapVol: bse ? bse.vol : null, usd: px.ETH, period: `last ${X_CHAINS[1].days} days`, ok: bse ? bse.ok : true },
    ...OTHER.map((o): Row => { const x = xs?.chains.find((c) => c.chain === o.key); const vol = Number(x?.vol ?? 0); return { key: o.key, name: o.name, native: "USD", coins: b(o.key)?.coins ?? null, traded: b(o.key)?.traded ?? null, vol24: 0, swaps: xs ? Number(x?.n ?? 0) : null, fee: xs ? (o.key === "sol" ? 0 : vol * 0.005) : null, swapVol: xs ? vol : null, usd: 1, period: "all time, sizes reported by the site", ok: true, note: o.key === "sol" ? "Jupiter · no fee yet (needs the ElyScreener Solana wallet address)" : undefined }; }),
  ];
  const loaded = !!base && !!ely && !!rhd && !!bnb && !!bse;
  const totalCoins = rows.reduce((a, r) => a + (r.coins ?? 0), 0);
  const totalSwaps = rows.reduce((a, r) => a + (r.swaps ?? 0), 0);
  const feeUsd = (r: Row) => (r.fee ?? 0) * r.usd;
  const swapFees = rows.reduce((a, r) => a + feeUsd(r), 0);
  const promo = ((ely?.orders ?? []) as EsOrder[]).reduce((a, o) => a + o.usd, 0);
  const active = rows.filter((r) => (r.swaps ?? 0) > 0);
  const nf = (n: number, d = 4) => n.toLocaleString("en-US", { maximumFractionDigits: n >= 100 ? 1 : d });
  return (
    <section className="e-panel"><div className="e-trade">
      <h3 className="e-ph" style={{ margin: 0 }}>ElyScreener overview <span className="dim" style={{ fontSize: 12.5, fontWeight: 600 }}>all chains in one place</span></h3>
      {!loaded ? <p className="dim">Loading every chain…</p> : null}
      <div className="e-prev-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", padding: 0, border: 0 }}>
        <div><span>Total income</span><b>{money(swapFees + promo)}</b><small className="dim" style={{ display: "block" }}>swap fees + promotions</small></div>
        <div><span>Swap fees (0.5%)</span><b>{money(swapFees)}</b><small className="dim" style={{ display: "block" }}>{totalSwaps} swaps made on the site</small></div>
        <div><span>Promotions</span><b>{money(promo)}</b><small className="dim" style={{ display: "block" }}>Verified, Boost, Banner</small></div>
        <div><span>Coins listed</span><b>{totalCoins.toLocaleString("en-US")}</b><small className="dim" style={{ display: "block" }}>on {rows.length} chains</small></div>
        <div><span>Chains with swaps</span><b>{active.length} of {rows.length}</b><small className="dim" style={{ display: "block" }}>{active.length ? active.map((r) => r.name).join(", ") : "none yet"}</small></div>
      </div>
      <div style={{ display: "grid", gap: 10 }}>
        {rows.map((r) => (
          <div key={r.key} style={{ border: "1px solid var(--e-line)", borderRadius: 12, padding: "12px 14px", display: "grid", gap: 8 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap", alignItems: "baseline" }}>
              <b style={{ fontSize: 16 }}>{r.name}</b>
              <span className="dim" style={{ fontSize: 12.5 }}>paid in {r.native} · swaps counted {r.period}</span>
            </div>
            <div className="e-prev-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", padding: 0, border: 0 }}>
              <div><span>Coins listed</span><b>{r.coins == null ? "…" : r.coins.toLocaleString("en-US")}</b><small className="dim" style={{ display: "block" }}>{r.traded == null ? "" : `${r.traded.toLocaleString("en-US")} traded in 24h`}</small></div>
              <div><span>24h volume</span><b>{r.vol24 ? `${nf(r.vol24, 2)} ${r.native}` : "—"}</b><small className="dim" style={{ display: "block" }}>{r.vol24 && r.usd ? money(r.vol24 * r.usd) : "all coins on the chain"}</small></div>
              <div><span>Site swaps</span><b>{r.swaps == null ? "…" : r.swaps}</b><small className="dim" style={{ display: "block" }}>{r.swapVol ? `${nf(r.swapVol, 3)} ${r.native} traded` : "buy / sell on elyscreener.com"}</small></div>
              <div><span>Fees earned</span><b>{r.fee == null ? "…" : `${nf(r.fee, 5)} ${r.native}`}</b><small className="dim" style={{ display: "block" }}>{r.fee && r.usd ? money(feeUsd(r)) : r.swaps === 0 ? "no swaps yet" : ""}</small></div>
            </div>
            {r.note && <span className="dim" style={{ fontSize: 12.5 }}>{r.note}</span>}
            {!r.ok && <span className="dim" style={{ fontSize: 12.5 }}>Part of this chain's history could not be read right now. Reload in a minute.</span>}
          </div>
        ))}
      </div>
      <p className="dim" style={{ fontSize: 12.5, margin: 0 }}>Coins listed counts every coin the site knows on that chain. Fees are the 0.5% our router takes on swaps made on elyscreener.com; trades made on other sites do not count. Four.Meme coins on BNB Chain are traded directly on Four.Meme, so they bring no fee. Numbers refresh every two minutes.</p>
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
      <ChainsOverview />
      <Funnel />
      <ScreenerRevenue />
      <RobinhoodRevenue />
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
