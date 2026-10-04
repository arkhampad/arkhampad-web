"use client";
// Loaded after the page is on screen, so sign-in code never slows the first paint.
import { PrivyProvider, usePrivy, useSignTypedData, useWallets, type ConnectedWallet } from "@privy-io/react-auth";
import { useEffect, useMemo, useRef } from "react";
import type { Address, Hex } from "viem";
import { baseSepolia } from "viem/chains";
import { robinhoodTestnet, type Signer, type TypedData } from "@/lib/chain";

export type AuthState = { ready: boolean; address: Address | null; signer: Signer | null; login: () => void; logout: () => void };

function domainFields(d: Record<string, unknown>) {
  const all: [string, string][] = [["name", "string"], ["version", "string"], ["chainId", "uint256"], ["verifyingContract", "address"]];
  return all.filter(([k]) => d[k] !== undefined).map(([name, type]) => ({ name, type }));
}

function Bridge({ onState, wantLogin }: { onState: (s: AuthState) => void; wantLogin: number }) {
  const { ready, authenticated, login, logout } = usePrivy();
  const { wallets } = useWallets();
  const { signTypedData } = useSignTypedData();
  const wallet: ConnectedWallet | undefined = useMemo(() => wallets.find((w) => w.walletClientType === "privy") ?? wallets[0], [wallets]);
  const address = authenticated && wallet ? (wallet.address as Address) : null;
  // The signer object must stay the same between renders (only the address matters),
  // otherwise the page would re-render forever. Live wallet and sign function sit in refs.
  const walletRef = useRef(wallet);
  const signRef = useRef(signTypedData);
  walletRef.current = wallet;
  signRef.current = signTypedData;
  const signer: Signer | null = useMemo(() => {
    if (!address) return null;
    return {
      address,
      signTypedData: async (chainId: number, t: TypedData) => {
        const w = walletRef.current;
        if (!w) throw new Error("Wallet not ready. Please try again.");
        const typed = JSON.parse(JSON.stringify({ ...t, types: { EIP712Domain: domainFields(t.domain), ...t.types } }, (_, v) => (typeof v === "bigint" ? v.toString() : v)));
        if (w.walletClientType === "privy") {
          // the embedded wallet signs silently: no pop-up, one tap trading
          const { signature } = await signRef.current(typed, { address: w.address, uiOptions: { showWalletUIs: false } });
          return signature as Hex;
        }
        // an outside wallet (e.g. MetaMask) must be on the right network to sign
        if (Number(String(w.chainId).split(":").pop()) !== chainId) await w.switchChain(chainId);
        const provider = await w.getEthereumProvider();
        return (await provider.request({ method: "eth_signTypedData_v4", params: [w.address, JSON.stringify(typed)] })) as Hex;
      },
    };
  }, [address]);
  // Privy may hand out new login/logout functions on every render: keep them in refs and
  // report to the page only when something real changes (ready, address, signer).
  const loginRef = useRef(login);
  const logoutRef = useRef(logout);
  loginRef.current = login;
  logoutRef.current = logout;
  const stable = useMemo(() => ({ login: () => loginRef.current(), logout: () => { logoutRef.current(); } }), []);
  useEffect(() => { onState({ ready, address, signer, ...stable }); }, [ready, address, signer, stable, onState]);
  const asked = useRef(0);
  useEffect(() => {
    if (wantLogin && wantLogin !== asked.current && ready && !authenticated) { asked.current = wantLogin; loginRef.current(); }
  }, [wantLogin, ready, authenticated]);
  return null;
}

const CONFIG = {
  loginMethods: ["google", "twitter", "email", "wallet"] as ("google" | "twitter" | "email" | "wallet")[],
  appearance: { theme: "dark" as const, accentColor: "#D4FF3A" as `#${string}`, logo: "/icon-192.png", landingHeader: "Sign in to ArkhamPad", showWalletLoginFirst: false },
  embeddedWallets: { ethereum: { createOnLogin: "users-without-wallets" as const }, showWalletUIs: false },
  supportedChains: [baseSepolia, robinhoodTestnet],
  defaultChain: baseSepolia,
};

export default function PrivyRoot({ appId, onState, wantLogin }: { appId: string; onState: (s: AuthState) => void; wantLogin: number }) {
  return (
    <PrivyProvider appId={appId} config={CONFIG}>
      <Bridge onState={onState} wantLogin={wantLogin} />
    </PrivyProvider>
  );
}
