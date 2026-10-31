"use client";
// Loaded after the page is on screen, so sign-in code never slows the first paint.
import { PrivyProvider, usePrivy, useSendTransaction, useSignTypedData, useWallets, type ConnectedWallet } from "@privy-io/react-auth";
import { useEffect, useMemo, useRef } from "react";
import type { Address, Hex } from "viem";
import { defineChain } from "viem";
import { arbitrum, base, baseSepolia, bsc, mainnet, optimism, polygon } from "viem/chains";
import { LIVE, robinhoodTestnet, type Signer, type TypedData } from "@/lib/chain";
import { ELY_CHAIN as ELY_CHAIN_ID, ELY_RPC_LIST } from "@/lib/elytrade";

/** The next nonce for `addr` on Elysium: the highest "pending" count any of our nodes reports. */
// "latest", not "pending": a node can keep a transaction it never passed on in its own queue, and counting
// it would leave a gap that holds every later transaction back. Mined count, highest across nodes.
async function freshNonce(addr: Address): Promise<number | null> {
  const counts = await Promise.all(
    ELY_RPC_LIST.map(async (url) => {
      try {
        const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getTransactionCount", params: [addr, "latest"] }), signal: AbortSignal.timeout(2500) });
        const j = await r.json();
        return j?.result ? parseInt(j.result, 16) : -1;
      } catch {
        return -1;
      }
    })
  );
  const n = Math.max(...counts);
  return n >= 0 ? n : null;
}

// Mainnets the embedded wallet must know, or it can't send a transaction there.
const robinhood = defineChain({
  id: 4663, name: "Robinhood Chain", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [process.env.NEXT_PUBLIC_ROBINHOOD_RPC || "https://robinhood.drpc.org"] } },
});
// Elysium (Kinetiq's chain on Hyperliquid) and HyperEVM, where HYPE is bridged from.
export const elysium = defineChain({
  id: 99901, name: "Elysium", nativeCurrency: { name: "HYPE", symbol: "HYPE", decimals: 18 },
  // wallets (MetaMask etc.) add Elysium with our own doorway first: it always reports the newest nonce
  rpcUrls: { default: { http: ["https://arkhampad.com/api/ely-rpc", ...ELY_RPC_LIST.filter((u) => !u.includes("arkhampad.com"))] } },
});
const elysiumTestnet = defineChain({
  id: 99801, name: "Elysium Testnet", nativeCurrency: { name: "HYPE", symbol: "HYPE", decimals: 18 },
  rpcUrls: { default: { http: (process.env.NEXT_PUBLIC_ELY_TEST_RPCS || "https://rpc-elysium-testnet.t.conduit.xyz,https://rpc.elysium-testnet.kinetiq.xyz").split(",") } },
  testnet: true,
});
const hyperevm = defineChain({
  id: 999, name: "HyperEVM", nativeCurrency: { name: "HYPE", symbol: "HYPE", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.hyperliquid.xyz/evm"] } },
});
const arc = defineChain({
  id: 5042, name: "Arc", nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: [process.env.NEXT_PUBLIC_ARC_RPC || "https://arc.drpc.org"] } },
});

export type AuthState = { ready: boolean; address: Address | null; signer: Signer | null; login: () => void; logout: () => void; email?: string | null };

function domainFields(d: Record<string, unknown>) {
  const all: [string, string][] = [["name", "string"], ["version", "string"], ["chainId", "uint256"], ["verifyingContract", "address"]];
  return all.filter(([k]) => d[k] !== undefined).map(([name, type]) => ({ name, type }));
}

function Bridge({ onState, wantLogin }: { onState: (s: AuthState) => void; wantLogin: number }) {
  const { ready, authenticated, login, logout, user } = usePrivy();
  const email = authenticated ? (user?.email?.address ?? user?.google?.email ?? null) : null;
  const { wallets } = useWallets();
  const { signTypedData } = useSignTypedData();
  const { sendTransaction } = useSendTransaction();
  const sendRef = useRef(sendTransaction);
  sendRef.current = sendTransaction;
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
      sendTx: async (chainId: number, tx: { to: Address; data: Hex; value?: bigint; gas?: bigint }) => {
        const w = walletRef.current;
        if (!w) throw new Error("Wallet not ready. Please try again.");
        // On Elysium some nodes run a block behind and hand out an old nonce ("wrong nonce: expected 15,
        // received 14"). Ask every node and use the highest pending count; on a nonce error retry once
        // with the count the node said it expected.
        const elysium = chainId === ELY_CHAIN_ID;
        const send = async (nonce?: number) => {
          if (w.walletClientType === "privy") {
            const { hash } = await sendRef.current({ to: tx.to, data: tx.data, value: tx.value, chainId, ...(tx.gas ? { gasLimit: tx.gas } : {}), ...(nonce != null ? { nonce } : {}) }, { address: w.address, uiOptions: { showWalletUIs: false } });
            return hash as Hex;
          }
          if (Number(String(w.chainId).split(":").pop()) !== chainId) await w.switchChain(chainId);
          const provider = await w.getEthereumProvider();
          return (await provider.request({ method: "eth_sendTransaction", params: [{ from: w.address, to: tx.to, data: tx.data, ...(tx.value ? { value: `0x${tx.value.toString(16)}` } : {}), ...(tx.gas ? { gas: `0x${tx.gas.toString(16)}` } : {}), ...(nonce != null ? { nonce: `0x${nonce.toString(16)}` } : {}) }] })) as Hex;
        };
        if (!elysium) return send();
        const nonce = await freshNonce(w.address as Address);
        try {
          return await send(nonce ?? undefined);
        } catch (e) {
          const m = String((e as Error)?.message ?? e);
          const want = m.match(/expected\s+(\d+)/i)?.[1];
          if (/nonce/i.test(m)) {
            if (w.walletClientType !== "privy") {
              // MetaMask & co. ignore the nonce we pass and use their own node: point them at our doorway
              // (it always reports the newest count), then try once more
              try {
                const provider = await w.getEthereumProvider();
                await provider.request({ method: "wallet_addEthereumChain", params: [{ chainId: `0x${ELY_CHAIN_ID.toString(16)}`, chainName: "Elysium", nativeCurrency: { name: "HYPE", symbol: "HYPE", decimals: 18 }, rpcUrls: ["https://arkhampad.com/api/ely-rpc"] }] });
              } catch {}
            }
            return send(want ? Number(want) : (await freshNonce(w.address as Address)) ?? undefined);
          }
          throw e;
        }
      },
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
  useEffect(() => { onState({ ready, address, signer, email, ...stable }); }, [ready, address, signer, email, stable, onState]);
  const asked = useRef(0);
  useEffect(() => {
    if (wantLogin && wantLogin !== asked.current && ready && !authenticated) { asked.current = wantLogin; loginRef.current(); }
  }, [wantLogin, ready, authenticated]);
  return null;
}

const CONFIG = {
  // Telegram appears once its bot is set up in Privy (Cloudflare env NEXT_PUBLIC_TELEGRAM_LOGIN=1)
  loginMethods: (process.env.NEXT_PUBLIC_ELY_LIVE === "1" ? ["email", "google", "wallet"] : process.env.NEXT_PUBLIC_TELEGRAM_LOGIN === "1" ? ["google", "twitter", "telegram", "email", "wallet"] : ["google", "twitter", "email", "wallet"]) as ("google" | "twitter" | "telegram" | "email" | "wallet")[],
  appearance: { theme: "light" as const, accentColor: "#0A9A8D" as `#${string}`, logo: "/icon-192.png", landingHeader: "Sign in to ArkhamPad", showWalletLoginFirst: false },
  embeddedWallets: { ethereum: { createOnLogin: "users-without-wallets" as const }, showWalletUIs: false },
  supportedChains: process.env.NEXT_PUBLIC_ELY_LIVE === "1" ? [elysium, hyperevm, base, arbitrum, mainnet, optimism, polygon, bsc, elysiumTestnet] : [base, robinhood, bsc, arc, baseSepolia, robinhoodTestnet, elysiumTestnet],
  defaultChain: process.env.NEXT_PUBLIC_ELY_LIVE === "1" ? elysium : LIVE ? base : baseSepolia,
};

export default function PrivyRoot({ appId, onState, wantLogin }: { appId: string; onState: (s: AuthState) => void; wantLogin: number }) {
  return (
    <PrivyProvider appId={appId} config={CONFIG}>
      <Bridge onState={onState} wantLogin={wantLogin} />
    </PrivyProvider>
  );
}
