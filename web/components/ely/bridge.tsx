"use client";
// Bridge: get HYPE onto Elysium. HYPE from HyperEVM through Elysium's official bridge (arrives in about a
// minute), or USDC from Base (converted to HYPE on HyperEVM by Relay, then bridged). Withdrawals go back
// through the official bridge and take about 5.5 days.
import Link from "next/link";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { createPublicClient, encodeFunctionData, fallback, formatUnits, http, parseAbi, type Address, type Hex } from "viem";
import { useWallet } from "@/components/wallet";
import { useT } from "@/lib/i18n";
import { usePoll } from "@/lib/ely";
import { ELY_CHAIN as ELY_CHAIN_ID, balanceChanged, ely, elyRpc, fromWei, toWei } from "@/lib/elytrade";

const HYPEREVM = 999;
const HYPEREVM_RPC = "https://rpc.hyperliquid.xyz/evm";
const BASE = 8453;
const BASE_RPC = process.env.NEXT_PUBLIC_BASE_RPC || "https://mainnet.base.org";
const INBOX = "0xce59f8b65ad41c9dae4c07a0571a39824bd92cff" as Address; // Elysium's official bridge inbox on HyperEVM
const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as Address;
const RELAY = "https://api.relay.link";
const RELAY_KEY = process.env.NEXT_PUBLIC_RELAY_KEY || "";
const GAS_KEEP = 10n ** 16n; // 0.01 HYPE stays on HyperEVM for the bridge transaction's gas

/** Where USDC can come from. Relay converts it to HYPE on HyperEVM; native USDC everywhere (6 decimals) except BNB Chain. */
type Origin = { id: number; name: string; usdc: Address; dec: number; gas: string; rpcs: string[] };
const ORIGINS: Origin[] = [
  { id: 8453, name: "Base", usdc: USDC_BASE, dec: 6, gas: "ETH", rpcs: [BASE_RPC, "https://base.llamarpc.com", "https://base-rpc.publicnode.com"] },
  { id: 42161, name: "Arbitrum", usdc: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", dec: 6, gas: "ETH", rpcs: ["https://arb1.arbitrum.io/rpc", "https://arbitrum-one-rpc.publicnode.com"] },
  { id: 1, name: "Ethereum", usdc: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", dec: 6, gas: "ETH", rpcs: ["https://ethereum-rpc.publicnode.com", "https://eth.llamarpc.com", "https://cloudflare-eth.com"] },
  { id: 10, name: "Optimism", usdc: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85", dec: 6, gas: "ETH", rpcs: ["https://mainnet.optimism.io", "https://optimism-rpc.publicnode.com"] },
  { id: 137, name: "Polygon", usdc: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359", dec: 6, gas: "POL", rpcs: ["https://polygon-rpc.com", "https://polygon-bor-rpc.publicnode.com"] },
  { id: 56, name: "BNB Chain", usdc: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d", dec: 18, gas: "BNB", rpcs: ["https://bsc-dataseed.binance.org", "https://bsc-rpc.publicnode.com"] },
];
const clients = new Map<number, ReturnType<typeof createPublicClient>>();
const originClient = (o: Origin) => {
  let c = clients.get(o.id);
  if (!c) {
    c = createPublicClient({ chain: { id: o.id, name: o.name, nativeCurrency: { name: o.gas, symbol: o.gas, decimals: 18 }, rpcUrls: { default: { http: o.rpcs } } }, transport: fallback(o.rpcs.map((u) => http(u, { timeout: 6000, retryCount: 0 }))) });
    clients.set(o.id, c);
  }
  return c;
};
/** USDC (as dollars) and gas balance on every origin chain, read in parallel. */
async function usdcEverywhere(me: Address) {
  return Promise.all(ORIGINS.map(async (o) => {
    const c = originClient(o);
    const [u, g] = await Promise.all([
      c.readContract({ address: o.usdc, abi: ERC20, functionName: "balanceOf", args: [me] }).catch(() => 0n) as Promise<bigint>,
      c.getBalance({ address: me }).catch(() => 0n),
    ]);
    return { o, usdc: u, gas: g, usd: Number(formatUnits(u, o.dec)) };
  }));
}

const hyperevm = createPublicClient({ chain: { id: HYPEREVM, name: "HyperEVM", nativeCurrency: { name: "HYPE", symbol: "HYPE", decimals: 18 }, rpcUrls: { default: { http: [HYPEREVM_RPC] } } }, transport: fallback([http(HYPEREVM_RPC), http("https://hyperliquid.drpc.org"), http("https://rpc.hypurrscan.io")]) });
const base = createPublicClient({ chain: { id: BASE, name: "Base", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [BASE_RPC] } } }, transport: http(BASE_RPC) });
const ERC20 = parseAbi(["function balanceOf(address) view returns (uint256)"]);
const DEPOSIT = encodeFunctionData({ abi: parseAbi(["function depositEth() payable returns (uint256)"]), functionName: "depositEth" });

/**
 * Money that has arrived but isn't on Elysium yet: USDC on Base and HYPE on HyperEVM at this address.
 * The You page counts it in the total and offers to move it.
 */
export async function waitingBalances(me: Address): Promise<{ usdc: bigint; hype: bigint }> {
  const [all, hype] = await Promise.all([usdcEverywhere(me).catch(() => []), hyperevm.getBalance({ address: me }).catch(() => 0n)]);
  // total USDC on every chain, in 6-decimal units
  const usdc = all.reduce((s, x) => s + BigInt(Math.floor(x.usd * 1e6)), 0n);
  return { usdc, hype };
}

const fmt = (v: bigint | null | undefined, d = 18, p = 4) => (v == null ? "—" : Number(formatUnits(v, d)).toLocaleString("en-US", { maximumFractionDigits: p }));

function Address0({ address }: { address: string }) {
  const tr = useT();
  const [ok, setOk] = useState(false);
  const [qr, setQr] = useState<string | null>(null);
  useEffect(() => {
    import("qrcode").then((Q) => Q.toDataURL(address, { margin: 1, width: 200 })).then(setQr).catch(() => setQr(null));
  }, [address]);
  return (
    <div className="e-addr">
      {qr && <img src={qr} alt="Your address as a QR code" width={120} height={120} />}
      <div>
        <span className="dim">{tr("Your address (same on HyperEVM, Base and Elysium)")}</span>
        <code className="num">{address}</code>
        <button type="button" className="e-btn" onClick={() => navigator.clipboard?.writeText(address).then(() => { setOk(true); setTimeout(() => setOk(false), 1400); })}>{tr(ok ? "Copied" : "Copy address")}</button>
      </div>
    </div>
  );
}

function HypeIn({ me, onSent }: { me: Address; onSent: () => void }) {
  const tr = useT();
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
      setMsg({ ok: true, text: tr("{n} HYPE is on its way. It shows up on Elysium in about a minute.", { n: fmt(sent) }) });
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
          <b>{tr("Send HYPE to your address")}</b>
          <p>{tr("On Binance or another exchange: Withdraw → HYPE, choose the network HYPE EVM (HyperEVM) and paste your address.")}</p>
        </div>
      </div>
      <Address0 address={me} />
      <div className="e-step">
        <span className="e-stepn">2</span>
        <div>
          <b>{tr("Move it to Elysium")}</b>
          <p>{tr("One tap when it arrives. It lands on Elysium in about a minute.")}</p>
        </div>
      </div>
      {arrived ? (
        <div className="e-arrived">
          <span className="e-dot" />
          <div><b className="num">{fmt(bal)} HYPE</b> {tr("arrived on HyperEVM")}</div>
        </div>
      ) : (
        <div className="e-waiting">
          {bal === undefined ? <span className="e-spin" /> : <span className="e-idle" aria-hidden="true">i</span>}
          <span>{bal === undefined ? tr("Checking your HyperEVM balance…") : <>{tr("Your HyperEVM balance")}: <b className="num">{fmt(bal)} HYPE</b>. {tr("Send HYPE to the address above. The button turns on by itself when it arrives.")}</>}</span>
        </div>
      )}
      {custom && (
        <label className="e-amt">
          <span className="e-amt-top"><span>{tr("Amount")}</span><span className="dim">{tr("Max")} {fmt(max)} HYPE</span></span>
          <span className="e-amt-row"><input inputMode="decimal" placeholder="0" value={val} onChange={(e) => setVal(e.target.value.replace(/[^0-9.,]/g, ""))} aria-label="HYPE amount" autoFocus /><b>HYPE</b></span>
        </label>
      )}
      <button type="button" className="e-go" disabled={busy || !arrived || amount <= 0n || amount > max} onClick={go}>
        {busy ? tr("Moving…") : !arrived ? tr("Move to Elysium") : tr("Move {n} HYPE to Elysium", { n: custom ? val || "0" : fmt(max) })}
      </button>
      {arrived && <button type="button" className="e-link-btn" onClick={() => setCustom(!custom)}>{tr(custom ? "Move everything instead" : "Move a different amount")}</button>}
      {msg && <div className={`e-msg ${msg.ok ? "ok" : "bad"}`} role="status">{tr(msg.text)}</div>}
      <p className="e-note">{tr("Uses Elysium's official bridge. About 0.01 HYPE stays on HyperEVM for the network fee.")}</p>
    </div>
  );
}

type RelaySign = { signatureKind: string; domain: Record<string, unknown> & { chainId?: number }; types: Record<string, { name: string; type: string }[]>; primaryType: string; value: Record<string, unknown> };
type RelayPost = { endpoint: string; method?: string; body: unknown };
type RelayStep = { id: string; kind: string; requestId?: string; items: { status: string; data: { to: Address; data: Hex; value?: string; chainId: number; sign?: RelaySign; post?: RelayPost } }[] };
/** True when the quote needs a transaction sent from Base by the user (so the user needs ETH there). */
const needsBaseGas = (steps: RelayStep[]) => steps.some((s) => s.kind === "transaction" && s.items.some((i) => i.status !== "complete"));

function UsdcIn({ me, onSent }: { me: Address; onSent: () => void }) {
  const tr = useT();
  const w = useWallet();
  const all = usePoll(() => usdcEverywhere(me), 8000, [me]);
  const [pick, setPick] = useState<number | null>(null);
  // the chain you picked, else the one where you hold the most USDC, else Base
  const best = all?.slice().sort((x, y) => y.usd - x.usd)[0];
  const cur = all?.find((x) => x.o.id === pick) ?? (best && best.usd >= 1 ? best : all?.[0]);
  const origin = cur?.o ?? ORIGINS[0];
  const usdc = cur?.usdc;
  const eth = cur?.gas;
  const [val, setVal] = useState("");
  const [quote, setQuote] = useState<{ out: bigint; steps: RelayStep[] } | null>(null);
  const [step, setStep] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const amount = toWei(val, origin.dec);

  useEffect(() => {
    setQuote(null);
    if (amount < 10n ** BigInt(origin.dec)) return;
    let live = true;
    const id = setTimeout(async () => {
      try {
        const res = await fetch(`${RELAY}/quote/v2`, {
          method: "POST",
          headers: { "content-type": "application/json", ...(RELAY_KEY ? { "x-api-key": RELAY_KEY } : {}) },
          body: JSON.stringify({ user: me, recipient: me, originChainId: origin.id, destinationChainId: HYPEREVM, originCurrency: origin.usdc, destinationCurrency: "0x0000000000000000000000000000000000000000", amount: amount.toString(), tradeType: "EXACT_INPUT", usePermit: true }),
        });
        const j = await res.json();
        if (live && j?.details?.currencyOut?.amount) setQuote({ out: BigInt(j.details.currencyOut.amount), steps: j.steps });
      } catch {}
    }, 400);
    return () => { live = false; clearTimeout(id); };
  }, [amount, me, origin.id, origin.usdc]);

  async function go() {
    if (!w.signer?.sendTx) return w.login();
    if (!quote) return;
    setMsg(null);
    try {
      const startHype = await hyperevm.getBalance({ address: me });
      let requestId = "";
      for (const s of quote.steps) {
        requestId = s.requestId || requestId;
        for (const it of s.items) {
          if (it.status === "complete") continue;
          if (s.kind === "signature") {
            // gasless: the user only signs; Relay sends it on Base and takes its fee from the USDC
            const sign = it.data.sign, post = it.data.post;
            if (!sign || sign.signatureKind !== "eip712" || !post || !w.signer.signTypedData) throw new Error("unsupported step");
            setStep("Confirm in your wallet…");
            const types = { ...sign.types };
            delete types.EIP712Domain;
            const signature = await w.signer.signTypedData(Number(sign.domain.chainId ?? origin.id), { domain: sign.domain, types, primaryType: sign.primaryType, message: sign.value } as never);
            setStep("Sending USDC…");
            const r = await fetch(`${RELAY}${post.endpoint}?signature=${signature}`, { method: post.method || "POST", headers: { "content-type": "application/json", ...(RELAY_KEY ? { "x-api-key": RELAY_KEY } : {}) }, body: JSON.stringify(post.body) });
            if (!r.ok) throw new Error("relay post failed");
            continue;
          }
          if (s.kind !== "transaction") throw new Error("unsupported step");
          setStep(s.id === "approve" ? "Approving USDC…" : "Sending USDC…");
          const hash = await w.signer.sendTx(it.data.chainId, { to: it.data.to, data: it.data.data, value: it.data.value ? BigInt(it.data.value) : undefined });
          const r = await originClient(origin).waitForTransactionReceipt({ hash: hash as Hex, timeout: 120_000 });
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
      setMsg({ ok: true, text: tr("Done. About {n} HYPE is on its way to Elysium (about a minute).", { n: fmt(send) }) });
      setVal("");
      onSent();
    } catch (e) {
      const m = String((e as Error)?.message ?? "");
      setMsg({ ok: false, text: /reject|denied|cancel/i.test(m) ? "Cancelled." : /timeout/.test(m) ? "Still converting. Your HYPE will be on HyperEVM shortly; you can bridge it from the HYPE tab." : "Something went wrong. If USDC left your wallet, it arrives as HYPE on HyperEVM; bridge it from the HYPE tab." });
    } finally {
      setStep(null);
    }
  }

  // with a gasless (signature) quote nobody needs ETH; only old-style quotes do
  const noGas = !!quote && needsBaseGas(quote.steps) && eth === 0n;
  return (
    <div className="e-trade">
      <ol className="e-steps">
        <li>{tr("Send USDC to your address below from Base, Arbitrum, Ethereum, Optimism, Polygon or BNB Chain. Same address on all of them.")}</li>
        <li>{tr("Convert and bridge here in one go. You arrive on Elysium with HYPE.")}</li>
      </ol>
      <Address0 address={me} />
      <div className="e-via" role="group" aria-label={tr("From")}>
        <span className="dim">{tr("From")}</span>
        {(all ?? ORIGINS.map((o) => ({ o, usd: 0 }))).map((x) => (
          <button key={x.o.id} type="button" aria-pressed={origin.id === x.o.id} className={origin.id === x.o.id ? "on" : ""} onClick={() => { setPick(x.o.id); setVal(""); }}>
            {x.o.name}{x.usd >= 0.01 ? ` · $${x.usd.toFixed(2)}` : ""}
          </button>
        ))}
      </div>
      <label className="e-amt">
        <span className="e-amt-top"><span>{tr("You pay")}</span><span className="dim">{origin.name}: {fmt(usdc, origin.dec, 2)} USDC</span></span>
        <span className="e-amt-row"><input inputMode="decimal" placeholder="0" value={val} onChange={(e) => setVal(e.target.value.replace(/[^0-9.,]/g, ""))} aria-label="USDC amount" /><b>USDC</b></span>
      </label>
      <div className="e-quick">
        {["10", "50", "100"].map((v) => <button key={v} type="button" onClick={() => setVal(v)}>{v}</button>)}
        <button type="button" disabled={!usdc} onClick={() => usdc && setVal(formatUnits(usdc, origin.dec))}>{tr("Max")}</button>
      </div>
      <div className="e-recv"><span className="muted">{tr("You get on Elysium")}</span><b className="num">{quote ? `≈ ${fmt(quote.out)} HYPE` : "—"}</b></div>
      <button type="button" className="e-go" disabled={!!step || !quote || (usdc != null && amount > usdc) || noGas} onClick={go}>
        {step ? tr(step) : noGas ? tr("Add a little {g} on {c} for gas", { g: origin.gas, c: origin.name }) : usdc != null && amount > usdc ? tr("Not enough USDC on {c}", { c: origin.name }) : amount > 0n && amount < 10n ** BigInt(origin.dec) ? tr("Minimum 1 USDC") : tr("Convert and bridge")}
      </button>
      {msg && <div className={`e-msg ${msg.ok ? "ok" : "bad"}`} role="status">{tr(msg.text)}</div>}
      <p className="e-note">{tr("Conversion by Relay, then Elysium's official bridge. Usually under two minutes.")}</p>
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
      const blk = await elyRpc<{ sendCount?: Hex } | null>("eth_getBlockByHash", [blockHash, false]);
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
  const tr = useT();
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
      {spent ? <span className="e-pill up">{tr("Claimed")}</span> : ready ? (
        <button type="button" className="e-btn pri" disabled={busy} onClick={claim}>{tr(busy ? "Claiming…" : "Claim")}</button>
      ) : (
        <span className="e-pill" style={{ background: "var(--e-raise)", color: "var(--e-muted)" }}>{Date.now() > eta ? tr("Finalizing…") : tr("Ready ~{d}", { d: new Date(eta).toLocaleDateString(undefined, { month: "short", day: "numeric" }) })}</span>
      )}
      {err && <div className="e-msg bad" style={{ flexBasis: "100%" }}>{tr(err)}</div>}
    </div>
  );
}

function Withdraw({ me, onSent }: { me: Address; onSent: () => void }) {
  const tr = useT();
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
      setMsg({ ok: true, text: tr("Withdrawal of {n} HYPE started. Claim it here in about 5.5 days.", { n: val }) });
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
      <p className="e-wnote"><b>{tr("Withdrawals take about 5.5 days.")}</b> {tr("Elysium is an optimistic rollup: HYPE leaving it through the official bridge waits out a challenge period, then you claim it on HyperEVM. Your HYPE is safe while it waits.")} <Link href="/learn/elysium-withdrawal-time/">{tr("Why?")}</Link></p>
      <label className="e-amt">
        <span className="e-amt-top"><span>{tr("Withdraw to HyperEVM")}</span><span className="dim">Elysium: {fmt(bal)} HYPE</span></span>
        <span className="e-amt-row"><input inputMode="decimal" placeholder="0" value={val} onChange={(e) => setVal(e.target.value.replace(/[^0-9.,]/g, ""))} aria-label="HYPE amount" /><b>HYPE</b></span>
      </label>
      <div className="e-quick">
        {[25, 50, 75].map((p) => <button key={p} type="button" disabled={!max} onClick={() => setVal(formatUnits((max * BigInt(p)) / 100n, 18))}>{p}%</button>)}
        <button type="button" disabled={!max} onClick={() => setVal(formatUnits(max, 18))}>{tr("Max")}</button>
      </div>
      <label className="e-check"><input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} /> {tr("I understand this takes about 5.5 days and I claim it on HyperEVM afterwards.")}</label>
      <button type="button" className="e-go" disabled={busy || !agree || amount <= 0n || amount > max} onClick={go}>{tr(busy ? "Starting…" : amount > max && amount > 0n ? "Not enough HYPE on Elysium" : "Start withdrawal")}</button>
      {msg && <div className={`e-msg ${msg.ok ? "ok" : "bad"}`} role="status">{tr(msg.text)}</div>}
      {!!list?.length && (
        <div className="e-wdlist">
          <b>{tr("Your withdrawals")}</b>
          {list.map((x) => <WdRow key={x.position.toString()} w={x} confirmed={confirmed ?? null} me={me} onDone={() => setTick((t) => t + 1)} />)}
          <p className="e-note">{tr("Claiming is a transaction on HyperEVM, so keep about 0.001 HYPE there for gas.")}</p>
        </div>
      )}
    </div>
  );
}

/**
 * HYPE that is back on HyperEVM (claimed withdrawals) → USDC on Base, in one tap through Relay. Optional:
 * people who want dollars instead of HYPE.
 */
function CashOut({ me }: { me: Address }) {
  const tr = useT();
  const w = useWallet();
  const bal = usePoll(() => hyperevm.getBalance({ address: me }), 8000, [me]);
  const [step, setStep] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const KEEP = 3n * 10n ** 15n; // 0.003 HYPE stays for the transaction's gas
  const amount = bal != null && bal > KEEP ? bal - KEEP : 0n;
  const [quote, setQuote] = useState<{ out: bigint; steps: RelayStep[] } | null>(null);
  useEffect(() => {
    setQuote(null);
    if (amount < 10n ** 16n) return;
    let live = true;
    (async () => {
      try {
        const res = await fetch(`${RELAY}/quote/v2`, {
          method: "POST",
          headers: { "content-type": "application/json", ...(RELAY_KEY ? { "x-api-key": RELAY_KEY } : {}) },
          body: JSON.stringify({ user: me, recipient: me, originChainId: HYPEREVM, destinationChainId: BASE, originCurrency: "0x0000000000000000000000000000000000000000", destinationCurrency: USDC_BASE, amount: amount.toString(), tradeType: "EXACT_INPUT" }),
        });
        const j = await res.json();
        if (live && j?.details?.currencyOut?.amount) setQuote({ out: BigInt(j.details.currencyOut.amount), steps: j.steps });
      } catch {}
    })();
    return () => { live = false; };
  }, [amount, me]);
  async function go() {
    if (!w.signer?.sendTx || !quote) return;
    setMsg(null);
    try {
      for (const s of quote.steps) {
        if (s.kind !== "transaction") throw new Error("unsupported");
        for (const it of s.items) {
          if (it.status === "complete") continue;
          setStep("Converting to USDC…");
          const hash = await w.signer.sendTx(it.data.chainId, { to: it.data.to, data: it.data.data, value: it.data.value ? BigInt(it.data.value) : undefined });
          const r = await hyperevm.waitForTransactionReceipt({ hash: hash as Hex, timeout: 90_000 });
          if (r.status !== "success") throw new Error("failed");
        }
      }
      setMsg({ ok: true, text: tr("Done. Your USDC arrives on Base in about a minute.") });
    } catch (e) {
      setMsg({ ok: false, text: /reject|denied|cancel/i.test(String((e as Error)?.message)) ? "Cancelled." : "Couldn't convert right now. Your HYPE is still on HyperEVM." });
    } finally {
      setStep(null);
    }
  }
  return (
    <div className="e-trade" style={{ borderTop: "1px solid var(--e-line)" }}>
      <h3 className="e-ph" style={{ margin: 0 }}>{tr("Want USDC instead?")}</h3>
      <p className="e-note" style={{ margin: 0 }}>{tr("After you claim, your HYPE is on HyperEVM. Turn it into USDC on Base in one tap, then send it to any exchange.")}</p>
      <div className="e-recv"><span className="muted">{tr("HYPE on HyperEVM")}</span><b className="num">{fmt(bal)}</b></div>
      <div className="e-recv"><span className="muted">{tr("You get on Base")}</span><b className="num">{quote ? `≈ ${fmt(quote.out, 6, 2)} USDC` : "—"}</b></div>
      <button type="button" className="e-go" disabled={!!step || !quote} onClick={go}>{tr(step ?? (amount < 10n ** 16n ? "Nothing to convert yet" : "Convert to USDC"))}</button>
      {msg && <div className={`e-msg ${msg.ok ? "ok" : "bad"}`} role="status">{tr(msg.text)}</div>}
    </div>
  );
}

export function BridgePage() {
  const tr = useT();
  const w = useWallet();
  const me = w.address as Address | null;
  const q = useSearchParams().get("tab");
  const [mode, setMode] = useState<"in" | "out">(q === "out" ? "out" : "in");
  const [via, setVia] = useState<"hype" | "usdc">(q === "usdc" ? "usdc" : "hype");
  const [tick, setTick] = useState(0);
  const elyBal = usePoll(async () => (me ? ely().getBalance({ address: me }) : null), 5000, [me, tick]);
  const out = mode === "out";
  return (
    <main className="e-in e-page">
      <section className="e-hero">
        <div>
          <span className="e-eyebrow">{tr("Wallet")}</span>
          <h1>{tr(out ? "Withdraw" : "Deposit")}</h1>
          <p>{tr(out ? "Move HYPE from Elysium back to HyperEVM, then send it to an exchange or turn it into USDC." : "Everything on Elysium is paid in HYPE. Send HYPE from an exchange, or USDC from Base, Arbitrum, Ethereum and more, and move it here in one tap.")}</p>
        </div>
        {me && <div className="e-stats" style={{ gridTemplateColumns: "auto" }}><div className="e-stat"><span>{tr("Your HYPE on Elysium")}</span><b>{elyBal == null ? "—" : fromWei(elyBal).toLocaleString("en-US", { maximumFractionDigits: 4 })}</b></div></div>}
      </section>
      <div className="e-bridge">
        <section className="e-panel">
          <div className="e-bar">
            <div className="e-tabs e-mode" role="tablist">
              {([["in", "Deposit"], ["out", "Withdraw"]] as const).map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={mode === k} className={`e-tab ${mode === k ? "on" : ""}`} onClick={() => setMode(k)}>{tr(l)}</button>)}
            </div>
            {!out && (
              <div className="e-via" role="group" aria-label={tr("Pay with")}>
                <span className="dim">{tr("Pay with")}</span>
                {([["hype", "HYPE"], ["usdc", "USDC"]] as const).map(([k, l]) => <button key={k} type="button" aria-pressed={via === k} className={via === k ? "on" : ""} onClick={() => setVia(k)}>{tr(l)}</button>)}
              </div>
            )}
          </div>
          {!me ? (
            <div className="e-trade">
              <p className="e-note" style={{ fontSize: 15 }}>{tr("Log in with email, Google or a wallet to get your Elysium address.")}</p>
              <button type="button" className="e-go" onClick={w.login}>{tr("Log in")}</button>
            </div>
          ) : out ? (
            <>
              <Withdraw me={me} onSent={() => setTick((x) => x + 1)} />
              <CashOut me={me} />
            </>
          ) : via === "hype" ? <HypeIn me={me} onSent={() => setTick((x) => x + 1)} /> : <UsdcIn me={me} onSent={() => setTick((x) => x + 1)} />}
        </section>
        <aside className="e-panel e-bside">
          <h3 className="e-ph">{tr("Good to know")}</h3>
          <ul>
            <li>{tr("Your address is the same on HyperEVM, Base and Elysium.")}</li>
            <li>{tr("Deposits through the official bridge arrive in about a minute.")}</li>
            <li>{tr("Network fees on Elysium are paid in HYPE. Keep a little for gas.")}</li>
            <li>{tr("Withdrawing back to HyperEVM takes about 5.5 days.")}</li>
          </ul>
          <Link href="/learn/bridge-hype-to-elysium/" className="e-more" style={{ display: "grid", placeItems: "center", textDecoration: "none" }}>{tr("Bridge guide")}</Link>
        </aside>
      </div>
    </main>
  );
}
