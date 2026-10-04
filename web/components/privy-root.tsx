"use client";
// Loaded after the page is on screen, so sign-in code never slows the first paint.
import { PrivyProvider, usePrivy, useSignTypedData, useWallets, type ConnectedWallet } from "@privy-io/react-auth";
import { useEffect, useMemo } from "react";
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
  const signer: Signer | null = useMemo(() => {
    if (!address || !wallet) return null;
    return {
      address,
      signTypedData: async (chainId: number, t: TypedData) => {
        const typed = JSON.parse(JSON.stringify({ ...t, types: { EIP712Domain: domainFields(t.domain), ...t.types } }, (_, v) => (typeof v === "bigint" ? v.toString() : v)));
        if (wallet.walletClientType === "privy") {
          // the embedded wallet signs silently: no pop-up, one tap trading
          const { signature } = await signTypedData(typed, { address: wallet.address, uiOptions: { showWalletUIs: false } });
          return signature as Hex;
        }
        // an outside wallet (e.g. MetaMask) must be on the right network to sign
        if (Number(String(wallet.chainId).split(":").pop()) !== chainId) await wallet.switchChain(chainId);
        const provider = await wallet.getEthereumProvider();
        return (await provider.request({ method: "eth_signTypedData_v4", params: [wallet.address, JSON.stringify(typed)] })) as Hex;
      },
    };
  }, [address, wallet, signTypedData]);
  useEffect(() => { onState({ ready, address, signer, login: () => login(), logout: () => { logout(); } }); }, [ready, address, signer, login, logout, onState]);
  useEffect(() => { if (wantLogin && ready && !authenticated) login(); }, [wantLogin, ready, authenticated, login]);
  return null;
}

export default function PrivyRoot({ appId, onState, wantLogin }: { appId: string; onState: (s: AuthState) => void; wantLogin: number }) {
  return (
    <PrivyProvider
      appId={appId}
      config={{
        loginMethods: ["google", "twitter", "email", "wallet"],
        appearance: { theme: "dark", accentColor: "#D4FF3A", logo: "/icon-192.png", landingHeader: "Sign in to ArkhamPad", showWalletLoginFirst: false },
        embeddedWallets: { ethereum: { createOnLogin: "users-without-wallets" }, showWalletUIs: false },
        supportedChains: [baseSepolia, robinhoodTestnet],
        defaultChain: baseSepolia,
      }}
    >
      <Bridge onState={onState} wantLogin={wantLogin} />
    </PrivyProvider>
  );
}
