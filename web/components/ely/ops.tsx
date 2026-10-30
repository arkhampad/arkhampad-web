"use client";
// /ops: owner-only switches for the launcher (not linked anywhere). Today: route the platform's fee share
// through the keeper wallet, which keeps a little HYPE for its own gas and forwards the rest to the
// treasury every 30 minutes, so the keeper never needs a manual top-up.
import { useCallback, useEffect, useState } from "react";
import { encodeFunctionData, parseAbi, parseAbiItem, type Address, type Hex } from "viem";
import { useWallet } from "@/components/wallet";
import { ELY_CHAIN, ELY_EXPLORER, ROUTER, ely } from "@/lib/elytrade";
import { fetchTokensByAddress } from "@/lib/ely";

const START_BLOCK = 65000n; // just before the mainnet deploy
const TRADE = parseAbiItem("event Trade(address indexed user, address indexed token, bool isBuy, uint256 hypeAmount, uint256 tokenAmount, uint256 fee)");
const LAUNCHED = parseAbiItem("event Launched(address indexed coin, address indexed creator, address pool, uint256 tokenId, string name, string symbol, string uri, uint256 startMc, uint256 firstBuyIn, uint256 firstBuyOut)");
type Act = { kind: "buy" | "sell" | "launch"; who: Address; token: Address; hype: number; fee: number; block: bigint; tx: Hex; at?: number; label?: string };

async function logsFrom<T>(fn: (from: bigint, to: bigint) => Promise<T[]>): Promise<T[]> {
  const latest = await ely().getBlockNumber();
  const out: T[] = [];
  for (let from = START_BLOCK; from <= latest; from += 50_000n) {
    const to = from + 49_999n > latest ? latest : from + 49_999n;
    out.push(...(await fn(from, to)));
  }
  return out;
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
      if (LAUNCHER) {
        const t = await logsFrom((fromBlock, toBlock) => ely().getLogs({ address: LAUNCHER as Address, event: LAUNCHED, fromBlock, toBlock }));
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

  async function setTreasury(to: Address) {
    if (!s || !w.signer?.sendTx) return w.login();
    setBusy(true);
    setMsg("Confirm in your wallet…");
    try {
      const data = encodeFunctionData({ abi: ABI, functionName: "setSettings", args: [to, s.startMc, s.creatorBps, s.launchFee, s.paused] });
      const hash = (await w.signer.sendTx(ELY_CHAIN, { to: LAUNCHER as Address, data })) as Hex;
      setMsg("Waiting for Elysium…");
      const r = await ely().waitForTransactionReceipt({ hash, timeout: 90_000 });
      setMsg(r.status === "success" ? "Done." : "Failed on chain.");
      await load();
    } catch (e) {
      setMsg(/reject|denied|cancel/i.test(String((e as Error)?.message)) ? "Cancelled." : "Failed. Make sure the ArkhamPad Admin wallet is connected and has a little HYPE on Elysium.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="e-in e-page">
      <section className="e-hero"><div><span className="e-eyebrow">Ops</span><h1>ArkhamPad ops</h1></div></section>
      <Activity />
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
            {msg && <div className="e-msg" role="status">{msg}</div>}
          </>
        )}
      </div></section>
    </main>
  );
}
