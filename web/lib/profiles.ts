"use client";
// Public profiles: a display name and a picture per wallet.
import { useEffect, useState } from "react";
import { keccak256, type Address } from "viem";
import { db } from "./live";
import { NETS, RELAYER, TradeError, accountAction, squareImage, type Signer } from "./chain";

export type Profile = { wallet: string; name: string | null; avatar: string | null };
const cache = new Map<string, { at: number; p: Promise<Profile | null> }>();
const listeners = new Set<() => void>();

export function getProfile(wallet: string, fresh = false): Promise<Profile | null> {
  const w = wallet.toLowerCase();
  const hit = cache.get(w);
  if (hit && !fresh && Date.now() - hit.at < 120_000) return hit.p;
  const p = (async () => {
    const { data } = await db().from("profiles").select("wallet,name,avatar_url").eq("wallet", w).maybeSingle();
    const r = data as { wallet: string; name: string | null; avatar_url: string | null } | null;
    return r ? { wallet: r.wallet, name: r.name, avatar: r.avatar_url } : null;
  })().catch(() => null);
  cache.set(w, { at: Date.now(), p });
  return p;
}

export function useProfile(wallet: string | null | undefined): Profile | null {
  const [p, setP] = useState<Profile | null>(null);
  const [n, setN] = useState(0);
  useEffect(() => { const f = () => setN((x) => x + 1); listeners.add(f); return () => { listeners.delete(f); }; }, []);
  useEffect(() => {
    if (!wallet) { setP(null); return; }
    let alive = true;
    getProfile(wallet).then((v) => { if (alive) setP(v); });
    return () => { alive = false; };
  }, [wallet, n]);
  return p;
}

const changed = (wallet: string) => { cache.delete(wallet.toLowerCase()); listeners.forEach((f) => f()); };

/** 3-20 letters (any language), numbers, dot or underscore. */
export const NAME_RE = /^[\p{L}\p{N}_.]{3,20}$/u;

export async function saveName(name: string, s: Signer) {
  const n = name.trim();
  if (!NAME_RE.test(n)) throw new TradeError("Use 3-20 letters, numbers, dots or underscores.");
  await accountAction("profile.name", { name: n }, s);
  changed(s.address);
}

export async function saveAvatar(file: File, s: Signer): Promise<string> {
  if (!/^image\/(png|jpe?g|webp|gif)$/.test(file.type)) throw new TradeError("Use a PNG, JPG or WebP image.");
  if (file.size > 10_000_000) throw new TradeError("Image is too large (max 10 MB).");
  const dataUrl = await squareImage(file, 256);
  const bytes = Uint8Array.from(atob(dataUrl.split(",")[1]), (ch) => ch.charCodeAt(0));
  const payload = { imageHash: keccak256(bytes) };
  const time = BigInt(Math.floor(Date.now() / 1000));
  const signature = await s.signTypedData(NETS[0].id, { domain: { name: "ArkhamPad", version: "1" }, types: { Request: [{ name: "action", type: "string" }, { name: "payload", type: "bytes32" }, { name: "time", type: "uint256" }] }, primaryType: "Request", message: { action: "profile.avatar", payload: keccak256(new TextEncoder().encode(JSON.stringify(payload))), time } });
  let r: Response;
  try { r = await fetch(`${RELAYER}/avatar`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ user: s.address as Address, action: "profile.avatar", payload, time: time.toString(), signature, dataUrl }) }); }
  catch { throw new TradeError("Can't reach ArkhamPad right now. Check your connection."); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new TradeError(j.error || "Upload failed, please try again.");
  changed(s.address);
  return j.url as string;
}
