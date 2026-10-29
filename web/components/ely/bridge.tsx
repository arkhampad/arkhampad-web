"use client";
// Bridge: get HYPE onto Elysium. HYPE from HyperEVM through Elysium's official bridge (arrives in about a
// minute), or USDC from Base (converted to HYPE on HyperEVM by Relay, then bridged). Withdrawals go back
// through the official bridge and take about 5.5 days.
import Link from "next/link";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { createPublicClient, encodeFunctionData, formatUnits, http, parseAbi, type Address, type Hex } from "viem";
import { useWallet } from "@/components/wallet";
import { usePoll } from "@/lib/ely";
import { ELY_CHAIN as ELY_CHAIN_ID, ELY_RPC, balanceChanged, ely, fromWei, toWei } from "@/lib/elytrade";

const HYPEREVM = 999;
const HYPEREVM_RPC = "https://rpc.hyperliquid.xyz/evm";
const BASE = 8453;
const BASE_RPC = process.env.NEXT_PUBLIC_BASE_RPC || "https://mainnet.base.org";
const INBOX = "0xce59f8b65ad41c9dae4c07a0571a39824bd92cff" as Address; // Elysium's official bridge inbox on HyperEVM
const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as Address;
const RELAY = "https://api.relay.link";
const RELAY_KEY = process.env.NEXT_PUBLIC_RELAY_KEY || "";
const GAS_KEEP = 10n ** 16n; // 0.01 HYPE stays on HyperEVM for the bridge transaction's gas

const hyperevm = createPublicClient({ chain: { id: HYPEREVM, name: "HyperEVM", nativeCurrency: { name: "HYPE", symbol: "HYPE", decimals: 18 }, rpcUrls: { default: { http: [HYPEREVM_RPC] } } }, transport: http(HYPEREVM_RPC) });
const base = createPublicClient({ chain: { id: BASE, name: "Base", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [BASE_RPC] } } }, transport: http(BASE_RPC) });
const ERC20 = parseAbi(["function balanceOf(address) view returns (uint256)"]);
const DEPOSIT = encodeFunctionData({ abi: parseAbi(["function depositEth() payable returns (uint256)"]), functionName: "depositEth" });

const fmt = (v: bigint | null | undefined, d = 18, p = 4) => (v == null ? "—" : Number(formatUnits(v, d)).toLocaleString("en-US", { maximumFractionDigits: p }));

function Address0({ address }: { address: string }) {
  const [ok, setOk] = useState(false);
  const [qr, setQr] = useState<string | null>(null);
  useEffect(() => {
    import("qrcode").then((Q) => Q.toDataURL(address, { margin: 1, width: 200 })).then(setQr).catch(() => setQr(null));
  }, [address]);
  return (
    <div className="e-addr">
      {qr && <img src={qr} alt="Your address as a QR code" width={120} height={120} />}
      <div>
        <span className="dim">Your address (same on HyperEVM, Base and Elysium)</span>
        <code className="num">{address}</code>
        <button type="button" className="e-btn" onClick={() => navigator.clipboard?.writeText(address).then(() => { setOk(true); setTimeout(() => setOk(false), 1400); })}>{ok ? "Copied" : "Copy address"}</button>
      </div>
    </div>
  );
}

function HypeIn({ me, onSent }: { me: Address; onSent: () => void }) {
  const w = useWallet();
  const bal = usePoll(() => hyperevm.getBalance({ address: me }), 5000, [me]);
  const [val, setVal] = useState("");
  const [custom, setCustom] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const max = bal != null && bal > GAS_KEEP ? bal - GAS_KEEP : 0n;
  const amount = custom ? toWei(val) : max;
  const arrived = max > 0n;
  async function go() {
    if (!w.signer?.sendTx) return w.login();
    setBusy(true);
    setMsg(null);
    try {
      const sent = amount;
      const hash = await w.signer.sendTx(HYPEREVM, { to: INBOX, data: DEPOSIT, value: sent });
      const r = await hyperevm.waitForTransactionReceipt({ hash: hash as Hex, timeout: 90_000 });
      if (r.status !== "success") throw new Error("failed");
      setMsg({ ok: true, text: `${fmt(sent)} HYPE is on its way. It shows up on Elysium in about a minute.` });
      setVal("");
      setCustom(false);
      onSent();
      balanceChanged();
    } catch (e) {
      const m = String((e as Error)?.message ?? "");
      setMsg({ ok: false, text: /insufficient/i.test(m) ? "Not enough HYPE on HyperEVM for this amount and the network fee." : /reject|denied|cancel/i.test(m) ? "Cancelled." : "Couldn't move it. Nothing was sent. Please try again." });
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="e-trade">
      <div className="e-step">
        <span className="e-stepn">1</span>
        <div>
          <b>Send HYPE to your address</b>
          <p>On Binance or another exchange: <b>Withdraw → HYPE</b>, choose the network <b>HYPE EVM</b> (HyperEVM) and paste your address.</p>
        </div>
      </div>
      <Address0 address={me} />
      <div className="e-step">
        <span className="e-stepn">2</span>
        <div>
          <b>Move it to Elysium</b>
          <p>One tap when it arrives. It lands on Elysium in about a minute.</p>
        </div>
      </div>
      {arrived ? (
        <div className="e-arrived">
          <span className="e-dot" />
          <div><b className="num">{fmt(bal)} HYPE</b> arrived on HyperEVM</div>
        </div>
      ) : (
        <div className="e-waiting"><span className="e-spin" />Waiting for your HYPE on HyperEVM… this updates by itself.</div>
      )}
      {custom && (
        <label className="e-amt">
          <span className="e-amt-top"><span>Amount</span><span className="dim">Max {fmt(max)} HYPE</span></span>
          <span className="e-amt-row"><input inputMode="decimal" placeholder="0" value={val} onChange={(e) => setVal(e.target.value.replace(/[^0-9.,]/g, ""))} aria-label="HYPE amount" autoFocus /><b>HYPE</b></span>
        </label>
      )}
      <button type="button" className="e-go" disabled={busy || !arrived || amount <= 0n || amount > max} onClick={go}>
        {busy ? "Moving…" : !arrived ? "Move to Elysium" : custom ? `Move ${val || "0"} HYPE to Elysium` : `Move ${fmt(max)} HYPE to Elysium`}
      </button>
      {arrived && <button type="button" className="e-link-btn" onClick={() => setCustom(!custom)}>{custom ? "Move everything instead" : "Move a different amount"}</button>}
      {msg && <div className={`e-msg ${msg.ok ? "ok" : "bad"}`} role="status">{msg.text}</div>}
      <p className="e-note">Uses Elysium&apos;s official bridge. About 0.01 HYPE stays on HyperEVM for the network fee.</p>
    </div>
  );
}

type RelayStep = { id: string; kind: string; requestId?: string; items: { status: string; data: { to: Address; data: Hex; value?: string; chainId: number } }[] };

function UsdcIn({ me, onSent }: { me: Address; onSent: () => void }) {
  const w = useWallet();
  const usdc = usePoll(() => base.readContract({ address: USDC_BASE, abi: ERC20, functionName: "balanceOf", args: [me] }), 6000, [me]);
  const eth = usePoll(() => base.getBalance({ address: me }), 10000, [me]);
  const [val, setVal] = useState("");
  const [quote, setQuote] = useState<{ out: bigint; steps: RelayStep[] } | null>(null);
  const [step, setStep] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const amount = toWei(val, 6);

  useEffect(() => {
    setQuote(null);
    if (amount < 1_000_000n) return;
    let live = true;
    const id = setTimeout(async () => {
      try {
        const res = await fetch(`${RELAY}/quote/v2`, {
          method: "POST",
          headers: { "content-type": "application/json", ...(RELAY_KEY ? { "x-api-key": RELAY_KEY } : {}) },
          body: JSON.stringify({ user: me, recipient: me, originChainId: BASE, destinationChainId: HYPEREVM, originCurrency: USDC_BASE, destinationCurrency: "0x0000000000000000000000000000000000000000", amount: amount.toString(), tradeType: "EXACT_INPUT" }),
        });
        const j = await res.json();
        if (live && j?.details?.currencyOut?.amount) setQuote({ out: BigInt(j.details.currencyOut.amount), steps: j.steps });
      } catch {}
    }, 400);
    return () => { live = false; clearTimeout(id); };
  }, [amount, me]);

  async function go() {
    if (!w.signer?.sendTx) return w.login();
    if (!quote) return;
    setMsg(null);
    try {
      const startHype = await hyperevm.getBalance({ address: me });
      let requestId = "";
      for (const s of quote.steps) {
        if (s.kind !== "transaction") throw new Error("unsupported step");
        requestId = s.requestId || requestId;
        for (const it of s.items) {
          if (it.status === "complete") continue;
          setStep(s.id === "approve" ? "Approving USDC…" : "Sending USDC…");
          const hash = await w.signer.sendTx(it.data.chainId, { to: it.data.to, data: it.data.data, value: it.data.value ? BigInt(it.data.value) : undefined });
          const r = await base.waitForTransactionReceipt({ hash: hash as Hex, timeout: 90_000 });
          if (r.status !== "success") throw new Error("failed");
        }
      }
      setStep("Converting to HYPE…");
      // wait for HYPE to land on HyperEVM (usually seconds)
      let got = 0n;
      for (let i = 0; i < 120; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        const now = await hyperevm.getBalance({ address: me });
        if (now > startHype) { got = now - startHype; break; }
        if (requestId && i % 5 === 4) {
          const st = await fetch(`${RELAY}/intents/status/v3?requestId=${requestId}`).then((r) => r.json()).catch(() => null);
          if (st?.status === "failure" || st?.status === "refund") throw new Error("relay failed");
        }
      }
      if (got === 0n) throw new Error("timeout");
      setStep("Bridging to Elysium…");
      const total = await hyperevm.getBalance({ address: me });
      const send = total > GAS_KEEP ? total - GAS_KEEP : 0n;
      const hash = await w.signer.sendTx(HYPEREVM, { to: INBOX, data: DEPOSIT, value: send });
      await hyperevm.waitForTransactionReceipt({ hash: hash as Hex, timeout: 90_000 });
      setMsg({ ok: true, text: `Done. About ${fmt(send)} HYPE is on its way to Elysium (about a minute).` });
      setVal("");
      onSent();
    } catch (e) {
      const m = String((e as Error)?.message ?? "");
      setMsg({ ok: false, text: /reject|denied|cancel/i.test(m) ? "Cancelled." : /timeout/.test(m) ? "Still converting. Your HYPE will be on HyperEVM shortly; you can bridge it from the HYPE tab." : "Something went wrong. If USDC left your wallet, it arrives as HYPE on HyperEVM; bridge it from the HYPE tab." });
    } finally {
      setStep(null);
    }
  }

  const noGas = eth === 0n;
  return (
    <div className="e-trade">
      <ol className="e-steps">
        <li>Send USDC on <b>Base</b> to your address below, plus a little ETH on Base for the network fee.</li>
        <li>Convert and bridge here in one go. You arrive on Elysium with HYPE.</li>
      </ol>
      <Address0 address={me} />
      <label className="e-amt">
        <span className="e-amt-top"><span>You pay</span><span className="dim">On Base: {fmt(usdc, 6, 2)} USDC</span></span>
        <span className="e-amt-row"><input inputMode="decimal" placeholder="0" value={val} onChange={(e) => setVal(e.target.value.replace(/[^0-9.,]/g, ""))} aria-label="USDC amount" /><b>USDC</b></span>
      </label>
      <div className="e-quick">
        {["10", "50", "100"].map((v) => <button key={v} type="button" onClick={() => setVal(v)}>{v}</button>)}
        <button type="button" disabled={!usdc} onClick={() => usdc && setVal(formatUnits(usdc, 6))}>Max</button>
      </div>
      <div className="e-recv"><span className="muted">You get on Elysium</span><b className="num">{quote ? `≈ ${fmt(quote.out)} HYPE` : "—"}</b></div>
      <button type="button" className="e-go" disabled={!!step || !quote || (usdc != null && amount > usdc) || noGas} onClick={go}>
        {step ?? (noGas ? "Add a little ETH on Base for gas" : usdc != null && amount > usdc ? "Not enough USDC on Base" : amount > 0n && amount < 1_000_000n ? "Minimum 1 USDC" : "Convert and bridge")}
      </button>
      {msg && <div className={`e-msg ${msg.ok ? "ok" : "bad"}`} role="status">{msg.text}</div>}
      <p className="e-note">Conversion by Relay, then Elysium&apos;s official bridge. Usually under two minutes.</p>
    </div>
  );
}

// ---------------------------------------------------------------- withdrawals (Arbitrum Orbit)
const ARBSYS = "0x0000000000000000000000000000000000000064" as Address;
const NODE_IFACE = "0x00000000000000000000000000000000000000c8" as Address;
const ROLLUP = "0x508c173dfe5f737b3493195bf785d71fa76fd217" as Address; // Elysium rollup on HyperEVM
const W_ABI = parseAbi([
  "function withdrawEth(address destination) payable returns (uint256)",
  "event L2ToL1Tx(address caller, address indexed destination, uint256 indexed hash, uint256 indexed position, uint256 arbBlockNum, uint256 ethBlockNum, uint256 timestamp, uint256 callvalue, bytes data)",
  "function constructOutboxProof(uint64 size, uint64 leaf) view returns (bytes32 send, bytes32 root, bytes32[] proof)",
  "function outbox() view returns (address)",
  "function isSpent(uint256 index) view returns (bool)",
  "function executeTransaction(bytes32[] proof, uint256 index, address l2Sender, address to, uint256 l2Block, uint256 l1Block, uint256 l2Timestamp, uint256 value, bytes data)",
  "event SendRootUpdated(bytes32 indexed outputRoot, bytes32 indexed l2BlockHash)",
]);
const CHALLENGE_MS = 132 * 3600 * 1000; // about 5.5 days on Elysium mainnet
const W_GAS_KEEP = 2_000_000_000_000_000n; // 0.002 HYPE stays on Elysium for gas

type Wd = { position: bigint; caller: Address; destination: Address; arbBlockNum: bigint; ethBlockNum: bigint; timestamp: bigint; callvalue: bigint; data: Hex; tx: Hex };

let outboxAddr: Promise<Address> | null = null;
const outbox = () => (outboxAddr ??= hyperevm.readContract({ address: ROLLUP, abi: W_ABI, functionName: "outbox" }) as Promise<Address>);

/** How many L2 -> L1 messages are confirmed (claimable): from the newest SendRootUpdated on the outbox. */
async function confirmedCount(): Promise<bigint> {
  const ob = await outbox();
  const tip = await hyperevm.getBlockNumber();
  const ev = W_ABI.find((x) => x.type === "event" && x.name === "SendRootUpdated")!;
  for (let i = 0n; i < 60n; i++) {
    const to = tip - i * 1000n;
    const from = to - 999n;
    if (to < 0n) break;
    const logs = await hyperevm.getLogs({ address: ob, event: ev as never, fromBlock: from < 0n ? 0n : from, toBlock: to }).catch(() => []);
    const last = logs[logs.length - 1] as unknown as { topics: Hex[] } | undefined;
    if (last) {
      const blockHash = last.topics[2];
      const res = await fetch(ELY_RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getBlockByHash", params: [blockHash, false] }) });
      const blk = ((await res.json()) as { result?: { sendCount?: Hex } }).result;
      return blk?.sendCount ? BigInt(blk.sendCount) : 0n;
    }
  }
  return 0n;
}

async function myWithdrawals(me: Address): Promise<Wd[]> {
  const ev = W_ABI.find((x) => x.type === "event" && x.name === "L2ToL1Tx")!;
  const q = (fromBlock: bigint, toBlock: bigint) => ely().getLogs({ address: ARBSYS, event: ev as never, args: { destination: me } as never, fromBlock, toBlock });
  const tip = await ely().getBlockNumber();
  let logs: unknown[];
  try {
    logs = await q(0n, tip);
  } catch {
    // the node limits the range: ask in slices (newest first, up to ~2.5M blocks back)
    logs = [];
    const STEP = 50_000n;
    const slices: bigint[] = [];
    for (let to = tip; to >= 0n && slices.length < 50; to -= STEP) slices.push(to);
    for (let i = 0; i < slices.length; i += 10) {
      const part = await Promise.all(slices.slice(i, i + 10).map((to) => q(to - STEP + 1n < 0n ? 0n : to - STEP + 1n, to).catch(() => [])));
      for (const p of part.reverse()) logs.unshift(...p);
    }
  }
  return (logs as { args: Omit<Wd, "tx">; transactionHash: Hex }[]).map((l) => ({ ...l.args, tx: l.transactionHash })).sort((a, b) => (b.position > a.position ? 1 : -1));
}

function WdRow({ w: x, confirmed, me, onDone }: { w: Wd; confirmed: bigint | null; me: Address; onDone: () => void }) {
  const wallet = useWallet();
  const spent = usePoll(async () => hyperevm.readContract({ address: await outbox(), abi: W_ABI, functionName: "isSpent", args: [x.position] }) as Promise<boolean>, 30_000, [x.position]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const ready = confirmed != null && x.position < confirmed;
  const eta = Number(x.timestamp) * 1000 + CHALLENGE_MS;
  async function claim() {
    if (!wallet.signer?.sendTx || confirmed == null) return;
    setBusy(true);
    setErr(null);
    try {
      const [, , proof] = (await ely().readContract({ address: NODE_IFACE, abi: W_ABI, functionName: "constructOutboxProof", args: [confirmed, x.position] })) as [Hex, Hex, Hex[]];
      const data = encodeFunctionData({ abi: W_ABI, functionName: "executeTransaction", args: [proof, x.position, x.caller, x.destination, x.arbBlockNum, x.ethBlockNum, x.timestamp, x.callvalue, x.data] });
      const hash = await wallet.signer.sendTx(HYPEREVM, { to: await outbox(), data });
      const r = await hyperevm.waitForTransactionReceipt({ hash: hash as Hex, timeout: 90_000 });
      if (r.status !== "success") throw new Error("failed");
      onDone();
    } catch (e) {
      const m = String((e as Error)?.message ?? "");
      setErr(/insufficient/i.test(m) ? "You need a little HYPE on HyperEVM (about 0.001) to pay for the claim." : /reject|denied|cancel/i.test(m) ? "Cancelled." : "Claim failed. Please try again.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="e-wd">
      <div>
        <b className="num">{fmt(x.callvalue)} HYPE</b>
        <span className="dim">{new Date(Number(x.timestamp) * 1000).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}{x.destination.toLowerCase() !== me.toLowerCase() ? ` · to ${x.destination.slice(0, 6)}…` : ""}</span>
      </div>
      {spent ? <span className="e-pill up">Claimed</span> : ready ? (
        <button type="button" className="e-btn pri" disabled={busy} onClick={claim}>{busy ? "Claiming…" : "Claim"}</button>
      ) : (
        <span className="e-pill" style={{ background: "var(--e-raise)", color: "var(--e-muted)" }}>{Date.now() > eta ? "Finalizing…" : `Ready ~${new Date(eta).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`}</span>
      )}
      {err && <div className="e-msg bad" style={{ flexBasis: "100%" }}>{err}</div>}
    </div>
  );
}

function Withdraw({ me, onSent }: { me: Address; onSent: () => void }) {
  const w = useWallet();
  const [tick, setTick] = useState(0);
  const bal = usePoll(() => ely().getBalance({ address: me }), 5000, [me, tick]);
  const list = usePoll(() => myWithdrawals(me), 20_000, [me, tick]);
  const confirmed = usePoll(() => confirmedCount(), 120_000, [tick]);
  const [val, setVal] = useState("");
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const amount = toWei(val);
  const max = bal != null && bal > W_GAS_KEEP ? bal - W_GAS_KEEP : 0n;
  async function go() {
    if (!w.signer?.sendTx) return w.login();
    setBusy(true);
    setMsg(null);
    try {
      const data = encodeFunctionData({ abi: W_ABI, functionName: "withdrawEth", args: [me] });
      const hash = await w.signer.sendTx(ELY_CHAIN_ID, { to: ARBSYS, data, value: amount });
      const r = await ely().waitForTransactionReceipt({ hash: hash as Hex, timeout: 90_000 });
      if (r.status !== "success") throw new Error("failed");
      setMsg({ ok: true, text: `Withdrawal of ${val} HYPE started. Claim it here in about 5.5 days.` });
      setVal("");
      setAgree(false);
      setTick((t) => t + 1);
      onSent();
    } catch (e) {
      const m = String((e as Error)?.message ?? "");
      setMsg({ ok: false, text: /reject|denied|cancel/i.test(m) ? "Cancelled." : "Withdrawal failed. Nothing was moved. Please try again." });
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="e-trade">
      <p className="e-wnote"><b>Withdrawals take about 5.5 days.</b> Elysium is an optimistic rollup: HYPE leaving it through the official bridge waits out a challenge period, then you claim it on HyperEVM. Your HYPE is safe while it waits. <Link href="/learn/elysium-withdrawal-time/">Why?</Link></p>
      <label className="e-amt">
        <span className="e-amt-top"><span>Withdraw to HyperEVM</span><span className="dim">On Elysium: {fmt(bal)} HYPE</span></span>
        <span className="e-amt-row"><input inputMode="decimal" placeholder="0" value={val} onChange={(e) => setVal(e.target.value.replace(/[^0-9.,]/g, ""))} aria-label="HYPE amount" /><b>HYPE</b></span>
      </label>
      <div className="e-quick">
        {[25, 50, 75].map((p) => <button key={p} type="button" disabled={!max} onClick={() => setVal(formatUnits((max * BigInt(p)) / 100n, 18))}>{p}%</button>)}
        <button type="button" disabled={!max} onClick={() => setVal(formatUnits(max, 18))}>Max</button>
      </div>
      <label className="e-check"><input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} /> I understand this takes about 5.5 days and I claim it on HyperEVM afterwards.</label>
      <button type="button" className="e-go" disabled={busy || !agree || amount <= 0n || amount > max} onClick={go}>{busy ? "Starting…" : amount > max && amount > 0n ? "Not enough HYPE on Elysium" : "Start withdrawal"}</button>
      {msg && <div className={`e-msg ${msg.ok ? "ok" : "bad"}`} role="status">{msg.text}</div>}
      {!!list?.length && (
        <div className="e-wdlist">
          <b>Your withdrawals</b>
          {list.map((x) => <WdRow key={x.position.toString()} w={x} confirmed={confirmed ?? null} me={me} onDone={() => setTick((t) => t + 1)} />)}
          <p className="e-note">Claiming is a transaction on HyperEVM, so keep about 0.001 HYPE there for gas.</p>
        </div>
      )}
    </div>
  );
}

export function BridgePage() {
  const w = useWallet();
  const me = w.address as Address | null;
  const q = useSearchParams().get("tab");
  const [tab, setTab] = useState<"hype" | "usdc" | "out">(q === "usdc" || q === "out" ? q : "hype");
  const [tick, setTick] = useState(0);
  const elyBal = usePoll(async () => (me ? ely().getBalance({ address: me }) : null), 5000, [me, tick]);
  return (
    <main className="e-in e-page">
      <section className="e-hero">
        <div>
          <span className="e-eyebrow">Bridge</span>
          <h1>Add money</h1>
          <p>Everything on Elysium is paid in HYPE. Send HYPE from an exchange, or USDC from Base, and move it here in one tap.</p>
        </div>
        {me && <div className="e-stats" style={{ gridTemplateColumns: "auto" }}><div className="e-stat"><span>Your HYPE on Elysium</span><b>{elyBal == null ? "—" : fromWei(elyBal).toLocaleString("en-US", { maximumFractionDigits: 4 })}</b></div></div>}
      </section>
      <div className="e-bridge">
        <section className="e-panel">
          <div className="e-bar">
            <div className="e-scrollx">
              <div className="e-tabs" role="tablist">
                {([["hype", "HYPE"], ["usdc", "USDC"], ["out", "Withdraw"]] as const).map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={tab === k} className={`e-tab ${tab === k ? "on" : ""}`} onClick={() => setTab(k)}>{l}</button>)}
              </div>
            </div>
          </div>
          {!me ? (
            <div className="e-trade">
              <p className="e-note" style={{ fontSize: 15 }}>Log in with email, Google or a wallet to get your Elysium address.</p>
              <button type="button" className="e-go" onClick={w.login}>Log in</button>
            </div>
          ) : tab === "hype" ? <HypeIn me={me} onSent={() => setTick((x) => x + 1)} /> : tab === "usdc" ? <UsdcIn me={me} onSent={() => setTick((x) => x + 1)} /> : <Withdraw me={me} onSent={() => setTick((x) => x + 1)} />}
        </section>
        <aside className="e-panel e-bside">
          <h3 className="e-ph">Good to know</h3>
          <ul>
            <li>Your address is the same on HyperEVM, Base and Elysium.</li>
            <li>Deposits through the official bridge arrive in about a minute.</li>
            <li>Network fees on Elysium are paid in HYPE. Keep a little for gas.</li>
            <li>Withdrawing back to HyperEVM takes about 5.5 days.</li>
          </ul>
          <Link href="/learn/bridge-hype-to-elysium/" className="e-more" style={{ display: "grid", placeItems: "center", textDecoration: "none" }}>Bridge guide</Link>
        </aside>
      </div>
    </main>
  );
}
