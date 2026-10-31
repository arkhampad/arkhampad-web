"use client";
// ArkhamPad Pioneer: 10,000 free on-chain badges (contracts-elysium/src/ArkhamPioneer.sol). One per wallet.
import { encodeFunctionData, parseAbi, type Address } from "viem";
import type { Signer } from "./chain";
import { ELY_CHAIN, ely, nice, waitReceipt } from "./elytrade";

/** Set after /ops deploys the contract (or Cloudflare env NEXT_PUBLIC_ELY_PIONEER). */
export const PIONEER = (process.env.NEXT_PUBLIC_ELY_PIONEER || "0xf567815133c4b478c5c3b1ef04eac6114656f822") as Address | "";
export const MAX_SUPPLY = 10_000;
export const PIONEER_ABI = parseAbi([
  "function mint() returns (uint256)",
  "function totalSupply() view returns (uint256)",
  "function idOf(address) view returns (uint256)",
  "function art(uint256 id) pure returns (string)",
]);
export const SAMPLES = [42, 1052, 777, 4242, 1, 9999];
export const pad = (n: number) => String(n).padStart(4, "0");

export type Tier = { name: string; range: string; color: string };
export const TIERS: Tier[] = [
  { name: "Founder", range: "#1 – #100", color: "#f6c768" },
  { name: "Vanguard", range: "#101 – #1,000", color: "#a48bff" },
  { name: "Pioneer", range: "#1,001 – #10,000", color: "#3fe3d4" },
  { name: "Aurora", range: "1 in 40, any number", color: "#ff6fd8" },
];
export const tierOf = (id: number) => (id <= 100 ? "Founder" : id <= 1000 ? "Vanguard" : "Pioneer");

export async function pioneerState(me?: string | null) {
  if (!PIONEER) return null;
  const c = { address: PIONEER as Address, abi: PIONEER_ABI } as const;
  const [minted, mine] = await Promise.all([
    ely().readContract({ ...c, functionName: "totalSupply" }),
    me ? ely().readContract({ ...c, functionName: "idOf", args: [me as Address] }) : Promise.resolve(0n),
  ]);
  return { minted: Number(minted), mine: Number(mine) };
}

const artMemo = new Map<number, string>();
/** The badge's picture, drawn by the contract (works for any number, minted or not). */
export async function pioneerArt(id: number): Promise<string | null> {
  if (artMemo.has(id)) return artMemo.get(id)!;
  if (!PIONEER) return null;
  try {
    const svg = (await ely().readContract({ address: PIONEER as Address, abi: PIONEER_ABI, functionName: "art", args: [BigInt(id)] })) as string;
    const url = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`;
    artMemo.set(id, url);
    return url;
  } catch {
    return null;
  }
}

export class MintFail extends Error {}
/** Mints your badge and waits until it's on chain; returns its number. */
export async function mintPioneer(signer: Signer): Promise<number> {
  if (!PIONEER || !signer.sendTx) throw new MintFail("Minting opens in a moment.");
  try {
    const hash = await signer.sendTx(ELY_CHAIN, { to: PIONEER as Address, data: encodeFunctionData({ abi: PIONEER_ABI, functionName: "mint" }), gas: 250_000n });
    const r = await waitReceipt(hash, 150_000);
    if (r.status !== "success") throw new MintFail("Mint failed on chain. You may already have one, or all 10,000 are gone.");
    // the Transfer log carries the badge number (3rd topic)
    const log = r.logs.find((l) => l.address.toLowerCase() === PIONEER.toLowerCase() && l.topics.length === 4);
    return log ? Number(BigInt(log.topics[3]!)) : 0;
  } catch (e) {
    throw e instanceof MintFail ? e : new MintFail(nice(e).replace(/^Trade failed: /, "Mint failed: "));
  }
}


/** The badge as a PNG (for sharing on X). */
export async function artPng(src: string, size = 1000): Promise<Blob | null> {
  try {
    const im = new Image();
    await new Promise<void>((ok, bad) => { im.onload = () => ok(); im.onerror = () => bad(); im.src = src; });
    const cv = document.createElement("canvas");
    cv.width = size;
    cv.height = size;
    const c = cv.getContext("2d");
    if (!c) return null;
    c.drawImage(im, 0, 0, size, size);
    return await new Promise((ok) => cv.toBlob((b) => ok(b), "image/png"));
  } catch {
    return null;
  }
}
