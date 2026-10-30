"use client";
// /testnet: a small practice area on Elysium testnet (chain 99801) with free test HYPE. Same contracts
// as the real site, read straight from the chain (no database). Real trading lives on the main pages;
// this page says so at the top and links back.
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createPublicClient, decodeEventLog, encodeFunctionData, fallback, http, parseAbi, parseAbiItem, type Address, type Hex } from "viem";
import { useWallet } from "@/components/wallet";
import { useT } from "@/lib/i18n";
import { fromWei, toWei } from "@/lib/elytrade";

export const TEST_CHAIN = 99801;
export const TEST_RPCS = (process.env.NEXT_PUBLIC_ELY_TEST_RPCS || "https://rpc-elysium-testnet.t.conduit.xyz,https://rpc.elysium-testnet.kinetiq.xyz").split(",").map((u) => u.trim()).filter(Boolean);
const LAUNCHER = (process.env.NEXT_PUBLIC_ELY_TEST_LAUNCHER || "") as Address | "";
const ROUTER = (process.env.NEXT_PUBLIC_ELY_TEST_ROUTER || "") as Address | "";
const WHYPE = (process.env.NEXT_PUBLIC_ELY_TEST_WHYPE || "") as Address | "";
const FROM = BigInt(process.env.NEXT_PUBLIC_ELY_TEST_BLOCK || "0");
const FAUCET = "https://elysium.kinetiq.xyz/testnet-faucet";
const EXPLORER = "https://explorer-elysium-testnet.t.conduit.xyz";
const SUPPLY = 1_000_000_000;
const ZERO = "0x0000000000000000000000000000000000000000" as Address;

const pub = createPublicClient({
  chain: { id: TEST_CHAIN, name: "Elysium Testnet", nativeCurrency: { name: "HYPE", symbol: "HYPE", decimals: 18 }, rpcUrls: { default: { http: TEST_RPCS } } },
  transport: fallback(TEST_RPCS.map((u) => http(u, { batch: { wait: 10 }, timeout: 6000, retryCount: 1 }))),
});

const LAUNCHED = parseAbiItem("event Launched(address indexed coin, address indexed creator, address pool, uint256 tokenId, string name, string symbol, string uri, uint256 startMc, uint256 firstBuyIn, uint256 firstBuyOut)");
const LAUNCH_ABI = parseAbi([
  "function launch(string name, string symbol, string uri, address creator, uint256 minOut) payable returns (address coin, uint256 bought)",
  "function launchFee() view returns (uint256)",
  "event Launched(address indexed coin, address indexed creator, address pool, uint256 tokenId, string name, string symbol, string uri, uint256 startMc, uint256 firstBuyIn, uint256 firstBuyOut)",
]);
const POOL = "(uint8 venue,address target,address token,address hype,bool tokenIs0,uint24 fee,int24 tickSpacing,address hooks)";
const ROUTER_ABI = parseAbi([
  `function buy(${POOL} p, uint256 minOut, uint256 deadline) payable returns (uint256)`,
  `function sell(${POOL} p, uint256 amountIn, uint256 minOut, uint256 deadline) returns (uint256)`,
]);
const ERC20 = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address,address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
]);
const SLOT0 = parseAbi(["function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16, uint16, uint16, uint8, bool)"]);

type Coin = { coin: Address; pool: Address; name: string; symbol: string; image: string | null; mc: number | null; block: bigint };

function imageOf(uri: string): string | null {
  try {
    if (!uri.startsWith("data:application/json;base64,")) return null;
    const j = JSON.parse(decodeURIComponent(escape(atob(uri.slice(29)))));
    return typeof j.image === "string" && /^(data:image\/|https:\/\/)/.test(j.image) ? j.image : null;
  } catch {
    return null;
  }
}

async function readCoins(): Promise<Coin[]> {
  if (!LAUNCHER) return [];
  const latest = await pub.getBlockNumber();
  const out: Coin[] = [];
  const STEP = 50_000n;
  for (let from = FROM; from <= latest; from += STEP) {
    const to = from + STEP - 1n > latest ? latest : from + STEP - 1n;
    const logs = await pub.getLogs({ address: LAUNCHER, event: LAUNCHED, fromBlock: from, toBlock: to });
    for (const l of logs) {
      const a = l.args;
      out.push({ coin: a.coin as Address, pool: a.pool as Address, name: a.name ?? "", symbol: a.symbol ?? "", image: imageOf(a.uri ?? ""), mc: null, block: l.blockNumber ?? 0n });
    }
  }
  out.reverse();
  await Promise.all(out.slice(0, 60).map(async (c) => {
    try {
      const [sqrt] = (await pub.readContract({ address: c.pool, abi: SLOT0, functionName: "slot0" })) as readonly [bigint, ...unknown[]];
      const s = Number(sqrt) / 2 ** 96;
      const p = s * s;
      const tokenIs0 = c.coin.toLowerCase() < WHYPE.toLowerCase();
      const price = tokenIs0 ? p : 1 / p;
      c.mc = Number.isFinite(price) ? price * SUPPLY : null;
    } catch {}
  }));
  return out;
}

const poolArg = (c: Coin) => ({ venue: 3, target: c.pool, token: c.coin, hype: WHYPE as Address, tokenIs0: c.coin.toLowerCase() < WHYPE.toLowerCase(), fee: 10000, tickSpacing: 200, hooks: ZERO });

async function waitOk(hash: Hex) {
  const r = await pub.waitForTransactionReceipt({ hash, timeout: 90_000 });
  if (r.status !== "success") throw new Error("failed on chain");
  return r;
}
const nice = (e: unknown) => {
  const m = String((e as Error)?.message ?? e);
  if (/insufficient funds/i.test(m)) return "Not enough test HYPE. Get some free from the faucet.";
  if (/rejected|denied|cancel/i.test(m)) return "Cancelled.";
  return "Something went wrong. Please try again.";
};

export function TestnetPage() {
  const tr = useT();
  const w = useWallet();
  const me = w.address as Address | null;
  const [coins, setCoins] = useState<Coin[] | null>(null);
  const [err, setErr] = useState("");
  const [bal, setBal] = useState<bigint | null>(null);
  const [sel, setSel] = useState<Coin | null>(null);
  const [held, setHeld] = useState<bigint>(0n);
  const [amt, setAmt] = useState("0.01");
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string; tx?: string } | null>(null);
  const [name, setName] = useState("");
  const [sym, setSym] = useState("");

  const load = useCallback(async () => {
    try {
      setCoins(await readCoins());
      setErr("");
    } catch {
      setErr("Testnet is not answering right now. Try again in a minute.");
      setCoins((c) => c ?? []);
    }
  }, []);
  const loadBal = useCallback(async () => {
    if (!me) return setBal(null);
    try { setBal(await pub.getBalance({ address: me })); } catch {}
  }, [me]);
  useEffect(() => { load(); const id = setInterval(load, 30_000); return () => clearInterval(id); }, [load]);
  useEffect(() => { loadBal(); }, [loadBal]);
  useEffect(() => {
    setHeld(0n);
    if (!sel || !me) return;
    pub.readContract({ address: sel.coin, abi: ERC20, functionName: "balanceOf", args: [me] }).then(setHeld).catch(() => {});
  }, [sel, me]);

  const ready = !!LAUNCHER && !!ROUTER && !!WHYPE;
  const signer = w.signer;

  async function run(label: string, fn: () => Promise<Hex>) {
    if (!w.signedIn || !signer?.sendTx) return w.login();
    setBusy(label);
    setMsg(null);
    try {
      const tx = await fn();
      setMsg({ ok: true, text: "Done.", tx });
      await Promise.all([load(), loadBal()]);
      if (sel && me) pub.readContract({ address: sel.coin, abi: ERC20, functionName: "balanceOf", args: [me] }).then(setHeld).catch(() => {});
    } catch (e) {
      setMsg({ ok: false, text: nice(e) });
    } finally {
      setBusy("");
    }
  }

  const buy = () => sel && run("Buying…", async () => {
    const data = encodeFunctionData({ abi: ROUTER_ABI, functionName: "buy", args: [poolArg(sel), 0n, BigInt(Math.floor(Date.now() / 1000) + 600)] });
    const h = await signer!.sendTx!(TEST_CHAIN, { to: ROUTER as Address, data, value: toWei(amt) });
    await waitOk(h);
    return h;
  });
  const sell = () => sel && run("Selling…", async () => {
    const amount = held;
    if (amount <= 0n) throw new Error("nothing");
    const allowed = await pub.readContract({ address: sel.coin, abi: ERC20, functionName: "allowance", args: [me as Address, ROUTER as Address] });
    if (allowed < amount) {
      setBusy("Approving…");
      await waitOk(await signer!.sendTx!(TEST_CHAIN, { to: sel.coin, data: encodeFunctionData({ abi: ERC20, functionName: "approve", args: [ROUTER as Address, (1n << 256n) - 1n] }) }));
      setBusy("Selling…");
    }
    const data = encodeFunctionData({ abi: ROUTER_ABI, functionName: "sell", args: [poolArg(sel), amount, 0n, BigInt(Math.floor(Date.now() / 1000) + 600)] });
    const h = await signer!.sendTx!(TEST_CHAIN, { to: ROUTER as Address, data });
    await waitOk(h);
    return h;
  });
  const create = () => run("Launching…", async () => {
    const fee = (await pub.readContract({ address: LAUNCHER as Address, abi: LAUNCH_ABI, functionName: "launchFee" }).catch(() => 0n)) as bigint;
    const meta = { name: name.trim(), symbol: sym.trim(), description: "Launched on ArkhamPad testnet", image: "" };
    const uri = `data:application/json;base64,${btoa(unescape(encodeURIComponent(JSON.stringify(meta))))}`;
    const data = encodeFunctionData({ abi: LAUNCH_ABI, functionName: "launch", args: [meta.name, meta.symbol, uri, me as Address, 0n] });
    const h = await signer!.sendTx!(TEST_CHAIN, { to: LAUNCHER as Address, data, value: fee });
    const r = await waitOk(h);
    for (const l of r.logs) {
      try {
        const d = decodeEventLog({ abi: LAUNCH_ABI, data: l.data, topics: l.topics });
        if (d.eventName === "Launched") setName(""), setSym("");
      } catch {}
    }
    return h;
  });

  const list = useMemo(() => coins ?? [], [coins]);

  return (
    <main className="e-in e-page">
      <div className="e-panel" style={{ padding: "14px 16px", display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <span style={{ fontSize: 14 }}>
          <b>{tr("Testnet")}</b> · {tr("Practice with free test HYPE. Nothing here has real value.")}
        </span>
        <Link href="/" className="e-btn pri">{tr("Trade for real on Elysium →")}</Link>
      </div>

      <section className="e-hero">
        <div>
          <span className="e-eyebrow">{tr("Elysium testnet")}</span>
          <h1>{tr("Try ArkhamPad on testnet")}</h1>
          <p>{tr("Launch a coin, buy it and sell it with free test HYPE. Same contracts as the real site.")}</p>
        </div>
      </section>

      <div className="e-bridge">
        <section className="e-panel">
          <div className="e-trade">
            <h3 className="e-ph">{tr("1. Get free test HYPE")}</h3>
            <p className="dim" style={{ fontSize: 14, margin: 0 }}>
              {tr("Balance")}: <b>{bal != null ? `${fromWei(bal).toFixed(4)} test HYPE` : w.signedIn ? "…" : "—"}</b>
            </p>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <a className="e-btn" href={FAUCET} target="_blank" rel="noopener noreferrer">{tr("Open faucet")}</a>
              {me && <button type="button" className="e-btn" onClick={() => navigator.clipboard?.writeText(me)}>{tr("Copy my address")}</button>}
              {!w.signedIn && <button type="button" className="e-btn pri" onClick={w.login}>{tr("Log in")}</button>}
            </div>

            <h3 className="e-ph" style={{ marginTop: 18 }}>{tr("2. Launch a test coin")}</h3>
            <label className="e-field"><span>{tr("Name")}</span><input value={name} maxLength={32} onChange={(e) => setName(e.target.value)} placeholder="Moon Otter" autoComplete="off" /></label>
            <label className="e-field"><span>{tr("Ticker")}</span><input value={sym} maxLength={10} onChange={(e) => setSym(e.target.value.replace(/[^A-Za-z0-9]/g, "").toUpperCase())} placeholder="OTTER" autoComplete="off" /></label>
            <button type="button" className="e-go" disabled={!ready || !!busy || (w.signedIn && (!name.trim() || !sym.trim()))} onClick={create}>
              {tr(!ready ? "Testnet opens soon" : busy === "Launching…" ? busy : !w.signedIn ? "Log in to launch" : "Launch test coin")}
            </button>

            {sel && (
              <>
                <h3 className="e-ph" style={{ marginTop: 18 }}>{tr("3. Trade")} {sel.symbol}</h3>
                <p className="dim" style={{ fontSize: 14, margin: 0 }}>{tr("You hold")}: <b>{fromWei(held).toLocaleString(undefined, { maximumFractionDigits: 0 })} {sel.symbol}</b></p>
                <label className="e-amt">
                  <span className="e-amt-row"><input inputMode="decimal" value={amt} onChange={(e) => setAmt(e.target.value.replace(/[^0-9.,]/g, ""))} aria-label="Amount in test HYPE" /><b>HYPE</b></span>
                </label>
                <div style={{ display: "flex", gap: 8 }}>
                  <button type="button" className="e-go" style={{ flex: 1 }} disabled={!!busy || toWei(amt) <= 0n} onClick={buy}>{tr(busy === "Buying…" ? busy : "Buy")}</button>
                  <button type="button" className="e-go" style={{ flex: 1, filter: "grayscale(.6)" }} disabled={!!busy || held <= 0n} onClick={sell}>{tr(busy === "Selling…" || busy === "Approving…" ? busy : "Sell all")}</button>
                </div>
              </>
            )}
            {msg && (
              <div className={`e-msg ${msg.ok ? "" : "bad"}`} role="status">
                {tr(msg.text)} {msg.tx && <a href={`${EXPLORER}/tx/${msg.tx}`} target="_blank" rel="noopener noreferrer">{tr("View")}</a>}
              </div>
            )}
          </div>
        </section>

        <aside className="e-panel e-bside">
          <h3 className="e-ph">{tr("Test coins")}</h3>
          {err && <div className="e-msg bad">{tr(err)}</div>}
          {coins == null ? (
            <p className="dim">{tr("Loading…")}</p>
          ) : !list.length ? (
            <p className="dim">{tr("No test coins yet. Launch the first one.")}</p>
          ) : (
            <div style={{ display: "grid", gap: 6, maxHeight: 520, overflowY: "auto" }}>
              {list.map((c) => (
                <button key={c.coin} type="button" onClick={() => { setSel(c); setMsg(null); }} className="e-chip" style={{ height: "auto", padding: "8px 10px", borderRadius: 12, justifyContent: "space-between", width: "100%", ...(sel?.coin === c.coin ? { borderColor: "var(--e-text)", color: "var(--e-text)" } : {}) }}>
                  <span style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                    {c.image ? <img src={c.image} alt="" width={26} height={26} style={{ borderRadius: 8 }} /> : <span style={{ width: 26, height: 26, borderRadius: 8, background: "var(--e-raise)", display: "inline-block" }} />}
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{c.name} <i className="dim">{c.symbol}</i></span>
                  </span>
                  <span className="dim">{c.mc != null ? `${c.mc.toFixed(1)} HYPE` : ""}</span>
                </button>
              ))}
            </div>
          )}
        </aside>
      </div>
    </main>
  );
}
