"use client";
// First steps for a new wallet. Someone who logs in with an empty wallet gets one clear screen: how to add
// money (USDC from Base/Arbitrum/…, or HYPE from an exchange), their address with a QR code, and a live
// "waiting for your deposit" line that turns into "your money is here" by itself.
// Built-in wallet: HYPE that lands on HyperEVM is moved to Elysium automatically (no tap, no pop-up).
// Also records how far each new wallet gets (lib/funnel), so /ops shows where people drop off.
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { Address, Hex } from "viem";
import { useWallet } from "@/components/wallet";
import { useT } from "@/lib/i18n";
import { usePoll } from "@/lib/ely";
import { balanceChanged, fromWei, hypeBalance } from "@/lib/elytrade";
import { useHoldings } from "@/lib/holdings";
import { funnel } from "@/lib/funnel";
import { Address0, DEPOSIT, GAS_KEEP, HYPEREVM, INBOX, hyperevm, waitingBalances } from "./bridge";

const MIN_MOVE = 2_000_000_000_000_000n; // 0.002 HYPE: smaller amounts aren't worth a bridge transaction
const seenKey = (a: string) => `ap_onb_${a.toLowerCase()}`;
const lockKey = (a: string) => `ap_automove_${a.toLowerCase()}`;
const ss = {
  get: (k: string) => { try { return sessionStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string) => { try { sessionStorage.setItem(k, v); } catch {} },
};
const ls = {
  get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch {} },
};

export function Onboard() {
  const w = useWallet();
  const tr = useT();
  const path = usePathname() || "/";
  const me = (w.signedIn ? w.address : null) as Address | null;
  const hype = usePoll(async () => (me ? hypeBalance(me) : null), 12_000, [me]);
  const coins = useHoldings(me ? me.toLowerCase() : null);
  const waiting = usePoll(async () => (me ? waitingBalances(me) : null), 10_000, [me]);
  const [open, setOpen] = useState(false);
  const [moving, setMoving] = useState<{ ok: boolean | null; text: string } | null>(null);
  const busy = useRef(false);

  useEffect(() => { if (me) funnel(me, "login"); }, [me]);
  useEffect(() => { if (me && hype != null && hype > 0n) funnel(me, "funded"); }, [me, hype]);

  // empty wallet (no HYPE on Elysium and no coins): show the welcome screen once per visit
  const empty = !!me && hype === 0n && coins !== undefined && coins.length === 0;
  useEffect(() => {
    if (!empty || !me) return;
    if (path.startsWith("/bridge") || path.startsWith("/ops") || path.startsWith("/learn")) return;
    if (ss.get(seenKey(me))) return;
    ss.set(seenKey(me), "1");
    setOpen(true);
    funnel(me, "welcome");
  }, [empty, me, path]);

  // built-in wallet: HYPE that arrived on HyperEVM goes on to Elysium by itself
  const onHyperEvm = waiting?.hype ?? 0n;
  const movable = onHyperEvm > GAS_KEEP ? onHyperEvm - GAS_KEEP : 0n;
  useEffect(() => {
    if (!me || !w.signer?.embedded || !w.signer.sendTx || movable < MIN_MOVE || busy.current) return;
    // one move at a time, also across open tabs (a lock that expires after 3 minutes)
    const lock = Number(ls.get(lockKey(me)) || 0);
    if (Date.now() - lock < 180_000) return;
    ls.set(lockKey(me), String(Date.now()));
    busy.current = true;
    const amount = fromWei(movable).toFixed(4);
    setMoving({ ok: null, text: tr("Your {n} HYPE arrived. Moving it to Elysium…", { n: amount }) });
    (async () => {
      try {
        // read again right before sending: the balance may have changed since the last poll
        const bal = await hyperevm.getBalance({ address: me });
        const send = bal > GAS_KEEP ? bal - GAS_KEEP : 0n;
        if (send < MIN_MOVE) throw new Error("nothing to move");
        const hash = await w.signer!.sendTx!(HYPEREVM, { to: INBOX, data: DEPOSIT, value: send });
        const r = await hyperevm.waitForTransactionReceipt({ hash: hash as Hex, timeout: 90_000 });
        if (r.status !== "success") throw new Error("failed");
        funnel(me, "deposit_sent");
        balanceChanged();
        setMoving({ ok: true, text: tr("{n} HYPE is on its way to Elysium. It shows up in about a minute.", { n: fromWei(send).toFixed(4) }) });
      } catch (e) {
        const m = String((e as Error)?.message ?? "");
        ls.set(lockKey(me), "0");
        setMoving(/nothing to move/.test(m) ? null : { ok: false, text: tr("Couldn't move your HYPE to Elysium automatically. Tap Deposit to do it by hand.") });
      } finally {
        busy.current = false;
      }
    })();
  }, [me, movable, w.signer, tr]);

  // the move toast closes itself a while after it finished
  useEffect(() => {
    if (!moving || moving.ok === null) return;
    const t = setTimeout(() => setMoving(null), moving.ok ? 12_000 : 20_000);
    return () => clearTimeout(t);
  }, [moving]);

  // close the welcome screen as soon as money is on Elysium
  useEffect(() => { if (open && hype != null && hype > 0n) setOpen(false); }, [open, hype]);

  if (!me) return null;
  const usdcWaiting = waiting ? Number(waiting.usdc) / 1e6 : 0;
  return (
    <>
      {moving && (
        <div className={`e-onb-toast ${moving.ok === false ? "bad" : moving.ok ? "ok" : ""}`} role="status">
          {moving.ok === null && <span className="e-spin" />}
          <span>{moving.text}</span>
          {moving.ok === false && <Link href="/bridge/?tab=hype" onClick={() => setMoving(null)}>{tr("Deposit")}</Link>}
        </div>
      )}
      {open && <WelcomeSheet me={me} usdcWaiting={usdcWaiting} movable={movable} embedded={!!w.signer?.embedded} onClose={() => setOpen(false)} />}
    </>
  );
}

/** The welcome screen itself (no data fetching here, so it can also be previewed). */
export function WelcomeSheet({ me, usdcWaiting, movable, embedded, onClose }: { me: Address; usdcWaiting: number; movable: bigint; embedded: boolean; onClose: () => void }) {
  const tr = useT();
  return (
        <div className="e-sheet e-center" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
          <div className="e-sheet-in e-onb" role="dialog" aria-modal="true" aria-labelledby="onb-h">
            <div className="e-sheet-h"><button type="button" className="e-btn" onClick={() => onClose()} aria-label={tr("Close")}>✕</button></div>
            <div className="e-onb-body">
              <h2 id="onb-h">{tr("Your wallet is ready")}</h2>
              <p className="muted">{tr("Add money once and you can buy, sell and create coins on Elysium. Pick how you want to pay:")}</p>
              <div className="e-onb-opts">
                <Link href="/bridge/?tab=usdc" className="e-onb-opt" onClick={() => onClose()}>
                  <b>{tr("USDC")}</b>
                  <span>{tr("From Base, Arbitrum, Ethereum, Optimism, Polygon or BNB Chain. Converted to HYPE for you.")}</span>
                </Link>
                <Link href="/bridge/?tab=hype" className="e-onb-opt" onClick={() => onClose()}>
                  <b>{tr("HYPE")}</b>
                  <span>{tr("From Binance, Bybit or any exchange: withdraw HYPE on the HyperEVM network to your address.")}</span>
                </Link>
              </div>
              <Address0 address={me} />
              {usdcWaiting >= 1 ? (
                <Link href="/bridge/?tab=usdc" className="e-go" onClick={() => onClose()}>{tr("Your {n} USDC arrived. Bring it to Elysium →", { n: usdcWaiting.toFixed(2) })}</Link>
              ) : movable >= MIN_MOVE ? (
                <div className="e-arrived"><span className="e-dot" /><div><b className="num">{fromWei(movable).toFixed(4)} HYPE</b> {tr(embedded ? "arrived. Moving it to Elysium for you…" : "arrived on HyperEVM.")}</div></div>
              ) : (
                <div className="e-waiting"><span className="e-spin" /><span>{tr("Waiting for your deposit. This screen updates by itself.")}</span></div>
              )}
              <p className="e-note">{tr("Same address on every network. Only send USDC or HYPE.")}</p>
              <button type="button" className="e-link-btn" onClick={() => onClose()}>{tr("Look around first")}</button>
            </div>
          </div>
        </div>
  );
}
