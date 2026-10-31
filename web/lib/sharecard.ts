"use client";
// Sharing a coin: its links (read from the coin's own on-chain metadata), the post text (tags the
// creator's X account when they gave one) and a share card image drawn in the browser.
import { useEffect, useState } from "react";
import { parseAbi, type Address } from "viem";
import { ely } from "./elytrade";
import type { EToken } from "./ely";

export type CoinLinks = { x?: string; xHandle?: string; telegram?: string; website?: string; description?: string };
const URI_ABI = parseAbi(["function tokenURI() view returns (string)"]);
const cache = new Map<string, CoinLinks>();

const clean = (u: unknown) => (typeof u === "string" && /^https?:\/\//i.test(u.trim()) ? u.trim() : undefined);
function handleOf(x?: string) {
  const m = x?.match(/(?:x|twitter)\.com\/(@?[A-Za-z0-9_]{1,15})(?:[/?#]|$)/i);
  return m && !/^(i|home|intent|share|search)$/i.test(m[1]) ? `@${m[1].replace(/^@/, "")}` : undefined;
}

/** X / Telegram / website the creator entered at launch (coins launched on ArkhamPad). */
export async function coinLinks(t: EToken): Promise<CoinLinks> {
  if (!t.ours) return {};
  const hit = cache.get(t.address);
  if (hit) return hit;
  let out: CoinLinks = {};
  try {
    const uri = (await ely().readContract({ address: t.address as Address, abi: URI_ABI, functionName: "tokenURI" })) as string;
    if (uri.startsWith("data:application/json")) {
      const body = uri.slice(uri.indexOf(",") + 1);
      const text = uri.includes(";base64,") ? new TextDecoder().decode(Uint8Array.from(atob(body), (c) => c.charCodeAt(0))) : decodeURIComponent(body);
      const j = JSON.parse(text);
      const x = clean(j.twitter ?? j.x);
      out = { x, xHandle: handleOf(x), telegram: clean(j.telegram), website: clean(j.website), description: typeof j.description === "string" ? j.description : undefined };
    }
  } catch {}
  cache.set(t.address, out);
  return out;
}
export function useCoinLinks(t: EToken | null) {
  const [l, setL] = useState<CoinLinks>({});
  useEffect(() => {
    let live = true;
    if (t) coinLinks(t).then((x) => live && setL(x));
    return () => { live = false; };
  }, [t?.address, t?.ours]); // eslint-disable-line react-hooks/exhaustive-deps
  return l;
}

export const coinUrl = (t: EToken) => `https://arkhampad.com/t/?a=${t.address}`;

/** The post text: what it is, where to trade it, the contract, the creator's X account if any. */
export function shareText(t: EToken, l: CoinLinks, fresh = false) {
  const lines = [
    fresh ? `$${t.symbol} just launched on Elysium 🚀` : `$${t.symbol} is live on Elysium 🚀`,
    "",
    `${t.name}${l.xHandle ? ` by ${l.xHandle}` : ""}, launched on @arkhampad. Liquidity locked forever. Buy and sell it now:`,
    coinUrl(t),
    "",
    `CA: ${t.address}`,
    "",
    "#Elysium #HYPE #memecoins",
  ];
  return lines.join("\n");
}
export function telegramText(t: EToken, l: CoinLinks) {
  return [`$${t.symbol} is live on Elysium 🚀`, `${t.name}, launched on ArkhamPad. Liquidity locked forever.`, "", `Trade: ${coinUrl(t)}`, `CA: ${t.address}`, l.x ? `X: ${l.x}` : "", l.telegram ? `Telegram: ${l.telegram}` : "", l.website ? `Website: ${l.website}` : ""].filter((x, i, a) => x || (i > 0 && a[i - 1])).join("\n");
}

function loadImg(src: string): Promise<HTMLImageElement | null> {
  return new Promise((ok) => {
    const im = new Image();
    im.onload = () => ok(im);
    im.onerror = () => ok(null);
    im.src = src;
  });
}
function rr(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

/** A 1200×675 card (X's large image size): coin picture, name, market cap, "live on Elysium". */
export async function shareCard(t: EToken, mcapUsd: string): Promise<Blob | null> {
  const W = 1200, H = 675;
  const cv = document.createElement("canvas");
  cv.width = W;
  cv.height = H;
  const c = cv.getContext("2d");
  if (!c) return null;
  const font = (w: number, s: number) => `${w} ${s}px Inter, "Segoe UI", system-ui, -apple-system, sans-serif`;
  c.fillStyle = "#06090c";
  c.fillRect(0, 0, W, H);
  let g = c.createRadialGradient(980, 120, 20, 980, 120, 640);
  g.addColorStop(0, "rgba(63,227,212,.30)");
  g.addColorStop(1, "rgba(63,227,212,0)");
  c.fillStyle = g;
  c.fillRect(0, 0, W, H);
  g = c.createRadialGradient(80, 700, 10, 80, 700, 520);
  g.addColorStop(0, "rgba(124,92,255,.22)");
  g.addColorStop(1, "rgba(124,92,255,0)");
  c.fillStyle = g;
  c.fillRect(0, 0, W, H);

  const [logo, pic] = await Promise.all([loadImg("/icon-192.png"), t.image ? loadImg(t.image) : Promise.resolve(null)]);
  if (logo) { c.save(); rr(c, 64, 52, 52, 52, 14); c.clip(); c.drawImage(logo, 64, 52, 52, 52); c.restore(); }
  c.fillStyle = "#eef6f5";
  c.font = font(800, 30);
  c.textBaseline = "middle";
  c.fillText("ArkhamPad", 130, 79);
  c.font = font(700, 20);
  const tag = "Live on Elysium";
  const tw = c.measureText(tag).width;
  rr(c, W - 64 - tw - 40, 58, tw + 40, 42, 21);
  c.fillStyle = "rgba(63,227,212,.12)";
  c.fill();
  c.strokeStyle = "rgba(63,227,212,.5)";
  c.lineWidth = 1.5;
  c.stroke();
  c.fillStyle = "#3fe3d4";
  c.fillText(tag, W - 64 - tw - 20, 80);

  // picture
  const P = 260, px = 64, py = 190;
  c.save();
  c.shadowColor = "rgba(63,227,212,.45)";
  c.shadowBlur = 50;
  rr(c, px, py, P, P, 56);
  c.fillStyle = "#0e171b";
  c.fill();
  c.restore();
  c.save();
  rr(c, px, py, P, P, 56);
  c.clip();
  if (pic) c.drawImage(pic, px, py, P, P);
  else {
    const gg = c.createLinearGradient(px, py, px + P, py + P);
    gg.addColorStop(0, "#0a9a8d");
    gg.addColorStop(1, "#7c5cff");
    c.fillStyle = gg;
    c.fillRect(px, py, P, P);
    c.fillStyle = "#fff";
    c.font = font(900, 130);
    c.textAlign = "center";
    c.fillText((t.symbol || "?").slice(0, 1).toUpperCase(), px + P / 2, py + P / 2 + 6);
    c.textAlign = "left";
  }
  c.restore();

  // text
  const tx = 380;
  c.fillStyle = "#3fe3d4";
  c.font = font(800, 22);
  c.fillText("JUST LAUNCHED ON ARKHAMPAD", tx, 214);
  let size = 78;
  c.font = font(900, size);
  while (c.measureText(t.name).width > W - tx - 64 && size > 40) { size -= 4; c.font = font(900, size); }
  c.fillStyle = "#ffffff";
  c.fillText(t.name, tx, 280);
  c.fillStyle = "#8aa0a6";
  c.font = font(700, 38);
  c.fillText(`$${t.symbol}`, tx, 340);
  c.fillStyle = "#8aa0a6";
  c.font = font(700, 20);
  c.fillText("MARKET CAP", tx, 400);
  c.fillStyle = "#ffffff";
  c.font = `700 56px "JetBrains Mono", ui-monospace, Menlo, monospace`;
  c.fillText(mcapUsd, tx, 446);

  // footer chips
  const chips = ["Liquidity locked forever", "Trade now on Elysium"];
  let cx = 64;
  c.font = font(700, 22);
  for (const ch of chips) {
    const w = c.measureText(ch).width + 44;
    rr(c, cx, 540, w, 56, 16);
    c.fillStyle = "rgba(255,255,255,.05)";
    c.fill();
    c.strokeStyle = "rgba(255,255,255,.1)";
    c.stroke();
    c.fillStyle = "#dfeceb";
    c.fillText(ch, cx + 22, 569);
    cx += w + 14;
  }
  c.fillStyle = "#3fe3d4";
  c.font = font(800, 26);
  c.textAlign = "right";
  c.fillText("arkhampad.com", W - 64, 569);
  c.textAlign = "left";
  return new Promise((ok) => cv.toBlob((b) => ok(b), "image/png"));
}

/** The "early on ArkhamPad" card (1200×675): your rank, what you launched and traded, the date you started. */
export async function earlyCard(o: { rank: number; total: number; launched: number; trades: number; volume: number; since: string | null }): Promise<Blob | null> {
  const W = 1200, H = 675;
  const cv = document.createElement("canvas");
  cv.width = W;
  cv.height = H;
  const c = cv.getContext("2d");
  if (!c) return null;
  const font = (w: number, s: number) => `${w} ${s}px Inter, "Segoe UI", system-ui, -apple-system, sans-serif`;
  const mono = (w: number, s: number) => `${w} ${s}px "JetBrains Mono", ui-monospace, Menlo, monospace`;
  c.fillStyle = "#05080b";
  c.fillRect(0, 0, W, H);
  let g = c.createRadialGradient(930, 300, 10, 930, 300, 520);
  g.addColorStop(0, "rgba(63,227,212,.32)");
  g.addColorStop(1, "rgba(63,227,212,0)");
  c.fillStyle = g;
  c.fillRect(0, 0, W, H);
  g = c.createRadialGradient(120, 720, 10, 120, 720, 560);
  g.addColorStop(0, "rgba(124,92,255,.22)");
  g.addColorStop(1, "rgba(124,92,255,0)");
  c.fillStyle = g;
  c.fillRect(0, 0, W, H);
  // faint grid
  c.strokeStyle = "rgba(255,255,255,.035)";
  c.lineWidth = 1;
  for (let x = 0; x <= W; x += 48) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x, H); c.stroke(); }
  for (let y = 0; y <= H; y += 48) { c.beginPath(); c.moveTo(0, y); c.lineTo(W, y); c.stroke(); }
  // frame
  rr(c, 24, 24, W - 48, H - 48, 28);
  c.strokeStyle = "rgba(63,227,212,.28)";
  c.lineWidth = 2;
  c.stroke();

  const logo = await loadImg("/icon-192.png");
  if (logo) { c.save(); rr(c, 64, 60, 52, 52, 14); c.clip(); c.drawImage(logo, 64, 60, 52, 52); c.restore(); }
  c.textBaseline = "middle";
  c.fillStyle = "#eef6f5";
  c.font = font(800, 30);
  c.fillText("ArkhamPad", 130, 87);
  c.font = font(700, 20);
  const tag = "Early on Elysium";
  const tw = c.measureText(tag).width;
  rr(c, W - 64 - tw - 40, 66, tw + 40, 42, 21);
  c.fillStyle = "rgba(63,227,212,.12)";
  c.fill();
  c.strokeStyle = "rgba(63,227,212,.55)";
  c.lineWidth = 1.5;
  c.stroke();
  c.fillStyle = "#3fe3d4";
  c.fillText(tag, W - 64 - tw - 20, 88);

  // the rank
  c.fillStyle = "#8aa0a6";
  c.font = font(800, 22);
  c.fillText("EARLY ARKHAMPAD USER", 64, 186);
  const big = `#${o.rank.toLocaleString("en-US")}`;
  let size = 190;
  c.font = font(900, size);
  while (c.measureText(big).width > 640 && size > 100) { size -= 10; c.font = font(900, size); }
  const gr = c.createLinearGradient(64, 220, 64 + c.measureText(big).width, 380);
  gr.addColorStop(0, "#ffffff");
  gr.addColorStop(1, "#3fe3d4");
  c.fillStyle = gr;
  c.save();
  c.shadowColor = "rgba(63,227,212,.45)";
  c.shadowBlur = 40;
  c.fillText(big, 58, 300);
  c.restore();
  c.fillStyle = "#c9d6d5";
  c.font = font(700, 30);
  c.fillText(`of ${o.total.toLocaleString("en-US")} people on ArkhamPad so far`, 64, 412);

  // stats
  const n = (v: number) => v >= 1000 ? `${(v / 1000).toFixed(1)}K` : v.toLocaleString("en-US", { maximumFractionDigits: v < 10 ? 2 : 0 });
  const stats: [string, string][] = [[n(o.launched), "coins launched"], [n(o.trades), "trades"], [n(o.volume), "HYPE traded"]];
  let sx = 64;
  for (const [v, l] of stats) {
    rr(c, sx, 470, 240, 110, 18);
    c.fillStyle = "rgba(255,255,255,.045)";
    c.fill();
    c.strokeStyle = "rgba(255,255,255,.09)";
    c.lineWidth = 1;
    c.stroke();
    c.fillStyle = "#ffffff";
    c.font = mono(700, 40);
    c.fillText(v, sx + 24, 510);
    c.fillStyle = "#8aa0a6";
    c.font = font(700, 19);
    c.fillText(l, sx + 24, 552);
    sx += 256;
  }
  // right side: badge
  const bx = 960, by = 330;
  c.save();
  c.translate(bx, by);
  for (let i = 0; i < 3; i++) {
    c.beginPath();
    c.arc(0, 0, 150 - i * 34, 0, Math.PI * 2);
    c.strokeStyle = `rgba(63,227,212,${0.5 - i * 0.14})`;
    c.lineWidth = 2;
    c.stroke();
  }
  c.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = (Math.PI / 4) * i - Math.PI / 2;
    const r = i % 2 ? 34 : 84;
    c.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  c.closePath();
  const sg = c.createLinearGradient(-80, -80, 80, 80);
  sg.addColorStop(0, "#ffffff");
  sg.addColorStop(1, "#3fe3d4");
  c.fillStyle = sg;
  c.shadowColor = "rgba(63,227,212,.8)";
  c.shadowBlur = 40;
  c.fill();
  c.restore();
  if (o.since) {
    const d = new Date(o.since).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    c.fillStyle = "#8aa0a6";
    c.font = font(700, 20);
    c.textAlign = "center";
    c.fillText(`Here since ${d}`, bx, by + 196);
    c.textAlign = "left";
  }
  c.fillStyle = "#3fe3d4";
  c.font = font(800, 26);
  c.textAlign = "right";
  c.fillText("arkhampad.com", W - 64, 620);
  c.textAlign = "left";
  c.fillStyle = "#6f8489";
  c.font = font(600, 19);
  c.fillText("Elysium's launchpad", 64, 620);
  return new Promise((ok) => cv.toBlob((b) => ok(b), "image/png"));
}
