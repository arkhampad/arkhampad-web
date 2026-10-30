"use client";
// /ops: owner-only switches for the launcher (not linked anywhere). Today: route the platform's fee share
// through the keeper wallet, which keeps a little HYPE for its own gas and forwards the rest to the
// treasury every 30 minutes, so the keeper never needs a manual top-up.
import { useCallback, useEffect, useState } from "react";
import { encodeFunctionData, parseAbi, type Address, type Hex } from "viem";
import { useWallet } from "@/components/wallet";
import { ELY_CHAIN, ely } from "@/lib/elytrade";

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
      <section className="e-hero"><div><span className="e-eyebrow">Ops</span><h1>Launcher settings</h1></div></section>
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
