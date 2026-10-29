"use client";
// Sign-in (Privy) and the user's wallet + USDC balances, shared by the whole site.
import dynamic from "next/dynamic";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { Address, Hex } from "viem";
import { NETS, onLocalTrade, usdcBalance, type Signer, type TypedData, sendWithAccount } from "@/lib/chain";
import type { AuthState } from "./privy-root";

export const PRIVY_APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID || "cmus4w0sd00h00cjst76oq5h6";
// Test builds only (never set on the live site): sign with a local key instead of Privy.
const DEV_PK = process.env.NEXT_PUBLIC_DEV_PK as Hex | undefined;

type WalletCtx = {
  ready: boolean;
  signedIn: boolean;
  address: Address | null;
  /** The email (or Google email) used to log in, when there is one. */
  email?: string | null;
  login: () => void;
  logout: () => void;
  signer: Signer | null;
  usdc: Record<number, bigint>; // per network
  totalUsdc: number;
  refresh: () => Promise<void>;
  /** Shows a known balance change at once (site units), until the chain confirms it. */
  adjust: (chainId: number, delta: bigint) => void;
};
const Ctx = createContext<WalletCtx>({ ready: false, signedIn: false, address: null, login: () => {}, logout: () => {}, signer: null, usdc: {}, totalUsdc: 0, refresh: async () => {}, adjust: () => {} });
export const useWallet = () => useContext(Ctx);

type Pending = { delta: bigint; base: bigint | undefined; until: number };

function useBalances(address: Address | null) {
  const [chainUsdc, setUsdc] = useState<Record<number, bigint>>({});
  // A trade made here changes the balance on screen at once; the chain's own number replaces it
  // as soon as a read shows the change (public nodes can lag a block or two), or after 20 s.
  const [pending, setPending] = useState<Record<number, Pending>>({});
  const latest = useRef<Record<number, bigint>>({});
  const seq = useRef(0);
  const refresh = useCallback(async () => {
    if (!address) { setUsdc({}); latest.current = {}; return; }
    const n = ++seq.current;
    const rows = await Promise.all(NETS.map(async (x) => [x.id, await usdcBalance(x.id, address).catch(() => null)] as const));
    if (n !== seq.current) return;
    const next = { ...latest.current };
    for (const [id, v] of rows) if (v !== null) next[id] = v;
    latest.current = next;
    setUsdc(next);
    setPending((cur) => {
      let changed = false;
      const out: Record<number, Pending> = {};
      for (const [k, p] of Object.entries(cur)) {
        const id = Number(k);
        if (Date.now() > p.until || (next[id] !== undefined && next[id] !== p.base)) { changed = true; continue; }
        out[id] = p;
      }
      return changed ? out : cur;
    });
  }, [address]);
  const adjust = useCallback((chainId: number, delta: bigint) => {
    setPending((cur) => {
      const p = cur[chainId];
      return { ...cur, [chainId]: { delta: (p?.delta ?? 0n) + delta, base: p ? p.base : latest.current[chainId], until: Date.now() + 20_000 } };
    });
    // look again soon: the chain usually confirms within a few seconds
    for (const ms of [1500, 4000, 8000]) setTimeout(() => { refresh(); }, ms);
  }, [refresh]);
  useEffect(() => {
    refresh();
    // every 5 s while the page is on screen (deposits from outside show up on their own), 30 s in the background
    let last = 0;
    const iv = setInterval(() => {
      const every = typeof document !== "undefined" && document.visibilityState === "visible" ? 5_000 : 30_000;
      if (Date.now() - last >= every) { last = Date.now(); refresh(); }
    }, 1_000);
    const onShow = () => { if (document.visibilityState === "visible") { last = Date.now(); refresh(); } };
    document.addEventListener("visibilitychange", onShow);
    const off = onLocalTrade((t) => { adjust(t.chainId, BigInt(Math.round((t.isBuy ? -t.usdc : t.usdc) * 1e6))); });
    return () => { clearInterval(iv); off(); document.removeEventListener("visibilitychange", onShow); };
  }, [refresh, adjust]);
  const usdc = useMemo(() => {
    const out = { ...chainUsdc };
    for (const [k, p] of Object.entries(pending)) { const id = Number(k); const v = (out[id] ?? 0n) + p.delta; out[id] = v < 0n ? 0n : v; }
    return out;
  }, [chainUsdc, pending]);
  const totalUsdc = Object.values(usdc).reduce((a, b) => a + Number(b) / 1e6, 0);
  return { usdc, totalUsdc, refresh, adjust };
}

function Provide({ value, children }: { value: Omit<WalletCtx, "usdc" | "totalUsdc" | "refresh" | "adjust">; children: React.ReactNode }) {
  const b = useBalances(value.address);
  const v = useMemo(() => ({ ...value, ...b }), [value, b]);
  return <Ctx.Provider value={v}>{children}</Ctx.Provider>;
}

const PrivyRoot = dynamic(() => import("./privy-root"), { ssr: false });

function LazyPrivy({ children }: { children: React.ReactNode }) {
  const [auth, setAuth] = useState<AuthState>({ ready: false, address: null, signer: null, login: () => {}, logout: () => {} });
  const [load, setLoad] = useState(false);
  const [wantLogin, setWantLogin] = useState(0);
  // start loading sign-in right after the first paint (or at once if the user taps Log in)
  useEffect(() => {
    const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number };
    if (w.requestIdleCallback) w.requestIdleCallback(() => setLoad(true), { timeout: 1500 });
    else setTimeout(() => setLoad(true), 300);
  }, []);
  // only update when something the page shows actually changed
  const onState = useCallback((s: AuthState) => setAuth((cur) => (cur.ready === s.ready && cur.address === s.address && cur.signer === s.signer && cur.email === s.email ? cur : s)), []);
  const value = useMemo(() => ({
    ready: auth.ready,
    signedIn: !!auth.address,
    address: auth.address,
    email: auth.email ?? null,
    signer: auth.signer,
    login: () => { setLoad(true); if (auth.ready) auth.login(); else setWantLogin((n) => n + 1); },
    logout: auth.logout,
  }), [auth]);
  return (
    <>
      <Provide value={value}>{children}</Provide>
      {load && <PrivyRoot appId={PRIVY_APP_ID} onState={onState} wantLogin={wantLogin} />}
    </>
  );
}

function DevBridge({ children }: { children: React.ReactNode }) {
  const [on, setOn] = useState(false);
  const [signer, setSigner] = useState<Signer | null>(null);
  useEffect(() => {
    import("viem/accounts").then(({ privateKeyToAccount }) => {
      const acct = privateKeyToAccount(DEV_PK as Hex);
      setSigner({ address: acct.address, signTypedData: (_chainId: number, t: TypedData) => acct.signTypedData(t as never), sendTx: (chainId, tx) => sendWithAccount(acct, chainId, tx) });
    });
  }, []);
  const value = useMemo(() => ({ ready: !!signer, signedIn: on && !!signer, address: on && signer ? signer.address : null, login: () => setOn(true), logout: () => setOn(false), signer: on ? signer : null }), [on, signer]);
  return <Provide value={value}>{children}</Provide>;
}

export function WalletProvider({ children }: { children: React.ReactNode }) {
  if (DEV_PK) return <DevBridge>{children}</DevBridge>;
  return <LazyPrivy>{children}</LazyPrivy>;
}
