"use client";
// How far each new wallet gets: login → welcome → deposit page → deposit sent → funded → trade → create.
// Each step is sent once per wallet (remembered on the device too, so it costs nothing to call often).
export type FunnelStep = "login" | "welcome" | "deposit_page" | "deposit_sent" | "funded" | "trade" | "create";
const sent = new Set<string>();
export function funnel(addr: string | null | undefined, step: FunnelStep) {
  if (!addr || typeof window === "undefined") return;
  const k = `ap_fn_${addr.toLowerCase()}_${step}`;
  if (sent.has(k)) return;
  sent.add(k);
  try { if (localStorage.getItem(k)) return; } catch {}
  fetch("/api/funnel", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ a: addr, s: step }), keepalive: true })
    .then((r) => { if (r.ok) { try { localStorage.setItem(k, "1"); } catch {} } else sent.delete(k); })
    .catch(() => sent.delete(k));
}
export type FunnelRow = { step: FunnelStep; total: number; d7: number; d1: number };
export async function funnelStats(): Promise<FunnelRow[]> {
  const r = await fetch("/api/funnel", { cache: "no-store" });
  const j = await r.json();
  return (Array.isArray(j) ? j : []).map((x: { step: FunnelStep; total: number | string; d7: number | string; d1: number | string }) => ({ step: x.step, total: Number(x.total), d7: Number(x.d7), d1: Number(x.d1) }));
}
