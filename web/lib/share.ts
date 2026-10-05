"use client";
// Sharing: a clean branded card image + tidy text, opened in the X app on phones.

export type ShareCoin = { name: string; tick: string; chain: string; mc: string; mcIsFdv?: boolean; chg: number; address: string; id: string; image?: string | null; c1: string; c2: string; own?: boolean };

const SITE = "https://arkhampad.com";
export const coinUrl = (c: ShareCoin) => `${SITE}/coin/?c=${c.id}`;

export function coinText(c: ShareCoin, opts: { launched?: boolean } = {}) {
  const change = `${c.chg >= 0 ? "+" : ""}${c.chg.toFixed(1)}%`;
  const head = opts.launched ? `I just launched $${c.tick} on @Arkhampad 🚀` : `$${c.tick} on @Arkhampad`;
  return [head, "", `${c.name} · ${c.chain}`, `${c.mcIsFdv ? "FDV" : "Market cap"} ${c.mc} (${change} 24h)`, "", `CA: ${c.address}`].join("\n");
}

const isPhone = () => typeof navigator !== "undefined" && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

/** Opens X with the text. Phones: same-tab navigation, which hands over to the X app. */
export function openX(text: string, url?: string) {
  const full = url ? `${text}\n${url}` : text;
  const web = `https://x.com/intent/post?text=${encodeURIComponent(full)}`;
  if (!isPhone()) { window.open(web, "_blank", "noopener,noreferrer"); return; }
  // Phones: the X app's own link opens the app directly. If it isn't installed the page
  // stays visible, so after a moment we open X in the browser instead.
  let left = false;
  const onHide = () => { left = true; };
  document.addEventListener("visibilitychange", onHide, { once: true });
  window.location.href = `twitter://post?message=${encodeURIComponent(full)}`;
  setTimeout(() => {
    document.removeEventListener("visibilitychange", onHide);
    if (!left && document.visibilityState === "visible") window.location.href = web;
  }, 1500);
}

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((res) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => res(img);
    img.onerror = () => res(null);
    img.src = src;
    setTimeout(() => res(null), 2500);
  });
}

function rounded(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// Cards are drawn ahead of time (when a coin page opens) so the share sheet opens instantly:
// phones only allow it right after the tap.
const cards = new Map<string, Promise<Blob | null>>();
export function prepareCard(c: ShareCoin) {
  const key = `${c.id}|${c.mc}|${c.chg.toFixed(1)}`;
  if (!cards.has(key)) cards.set(key, drawCard(c).catch(() => null));
  return cards.get(key)!;
}
export const coinCard = (c: ShareCoin) => prepareCard(c);

/** Branded 1200x675 card (PNG) for a coin. */
async function drawCard(c: ShareCoin): Promise<Blob | null> {
  const W = 1200, H = 675;
  const cv = document.createElement("canvas");
  cv.width = W; cv.height = H;
  const ctx = cv.getContext("2d");
  if (!ctx) return null;
  const sans = '"Geist Sans","Helvetica Neue",Arial,sans-serif', mono = '"Geist Mono",ui-monospace,Menlo,monospace';
  // background
  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, "#0A0B10"); bg.addColorStop(1, "#11141C");
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
  const glow = ctx.createRadialGradient(W - 160, 120, 10, W - 160, 120, 520);
  glow.addColorStop(0, "rgba(212,255,58,0.18)"); glow.addColorStop(1, "rgba(212,255,58,0)");
  ctx.fillStyle = glow; ctx.fillRect(0, 0, W, H);
  // brand
  const logo = await loadImage("/icon-192.png");
  if (logo) { ctx.save(); rounded(ctx, 64, 56, 56, 56, 14); ctx.clip(); ctx.drawImage(logo, 64, 56, 56, 56); ctx.restore(); }
  ctx.fillStyle = "#F2F3F5"; ctx.font = `800 34px ${sans}`; ctx.textBaseline = "middle";
  ctx.fillText("ArkhamPad", 136, 85);
  ctx.fillStyle = "#D4FF3A"; ctx.font = `700 20px ${sans}`; ctx.textAlign = "right";
  ctx.fillText(c.own ? "Launched on ArkhamPad" : c.chain, W - 64, 85);
  ctx.textAlign = "left";
  // coin avatar
  const ax = 64, ay = 190, as = 150;
  const pic = c.image ? await loadImage(c.image) : null;
  ctx.save(); rounded(ctx, ax, ay, as, as, 36); ctx.clip();
  if (pic) ctx.drawImage(pic, ax, ay, as, as);
  else {
    const g = ctx.createLinearGradient(ax, ay, ax + as, ay + as);
    g.addColorStop(0, c.c1); g.addColorStop(1, c.c2);
    ctx.fillStyle = g; ctx.fillRect(ax, ay, as, as);
    ctx.fillStyle = "#fff"; ctx.font = `900 56px ${sans}`; ctx.textAlign = "center";
    ctx.fillText(c.tick.slice(0, 2).toUpperCase(), ax + as / 2, ay + as / 2 + 2);
    ctx.textAlign = "left";
  }
  ctx.restore();
  // name, ticker
  const tx = ax + as + 36;
  ctx.fillStyle = "#F2F3F5"; ctx.font = `900 64px ${sans}`;
  let name = c.name;
  while (ctx.measureText(name).width > W - tx - 64 && name.length > 4) name = name.slice(0, -2) + "…";
  ctx.fillText(name, tx, ay + 48);
  ctx.fillStyle = "#8A909C"; ctx.font = `700 30px ${mono}`;
  ctx.fillText(`$${c.tick} · ${c.chain}`, tx, ay + 112);
  // stats
  const up = c.chg >= 0;
  ctx.fillStyle = "#8A909C"; ctx.font = `600 22px ${sans}`;
  ctx.fillText(c.mcIsFdv ? "FDV" : "Market cap", 64, 420);
  ctx.fillText("24h", 520, 420);
  ctx.fillStyle = "#F2F3F5"; ctx.font = `800 72px ${mono}`;
  ctx.fillText(c.mc, 64, 480);
  ctx.fillStyle = up ? "#3DDC97" : "#FF6B6B";
  ctx.fillText(c.chg === 0 && c.own ? "New" : `${up ? "+" : ""}${c.chg.toFixed(1)}%`, 520, 480);
  // CA strip
  rounded(ctx, 64, 548, W - 128, 66, 18);
  ctx.fillStyle = "rgba(255,255,255,0.05)"; ctx.fill();
  ctx.fillStyle = "#8A909C"; ctx.font = `700 20px ${sans}`;
  ctx.fillText("CA", 92, 581);
  ctx.fillStyle = "#F2F3F5"; ctx.font = `600 24px ${mono}`;
  ctx.fillText(c.address, 140, 581);
  ctx.fillStyle = "#D4FF3A"; ctx.font = `800 22px ${sans}`; ctx.textAlign = "right";
  ctx.fillText("arkhampad.com", W - 92, 581);
  ctx.textAlign = "left";
  return await new Promise((res) => cv.toBlob((b) => res(b), "image/png"));
}

/**
 * Shares a coin. Phones: the system share sheet with the card image + text (pick X, Telegram,
 * WhatsApp…; the X app opens with the image attached). Computers: X opens with the text + link.
 */
export async function shareCoinCard(c: ShareCoin, opts: { launched?: boolean } = {}) {
  const text = coinText(c, opts);
  const url = coinUrl(c);
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (isPhone() && nav.share) {
    try {
      const blob = await coinCard(c);
      const file = blob ? new File([blob], `${c.tick.toLowerCase()}-arkhampad.png`, { type: "image/png" }) : null;
      if (file && nav.canShare?.({ files: [file] })) { await nav.share({ files: [file], text: `${text}\n${url}` }); return; }
      await nav.share({ text, url });
      return;
    } catch (e) {
      if ((e as Error)?.name === "AbortError") return; // the user closed the sheet
      // NotAllowedError (tap too long ago) or no file sharing: fall back to X below
    }
  }
  openX(text, url);
}

/** Saves the card image (for computers: download, then attach it to the post). */
export async function downloadCard(c: ShareCoin) {
  const blob = await coinCard(c);
  if (!blob) return;
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${c.tick.toLowerCase()}-arkhampad.png`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

// ---------------------------------------------------------------- profit card

export type Pnl = { name: string; tick: string; chain: string; id: string; image?: string | null; c1: string; c2: string; bought: number; back: number; pnl: number; pct: number; entryMc: number; nowMc: number; closed: boolean };

/** Branded 1200x675 "my result" card (PNG). */
export async function pnlCard(p: Pnl): Promise<Blob | null> {
  const W = 1200, H = 675;
  const cv = document.createElement("canvas");
  cv.width = W; cv.height = H;
  const ctx = cv.getContext("2d");
  if (!ctx) return null;
  const sans = '"Geist Sans","Helvetica Neue",Arial,sans-serif', mono = '"Geist Mono",ui-monospace,Menlo,monospace';
  const up = p.pnl >= 0;
  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, "#0A0B10"); bg.addColorStop(1, up ? "#0C1A13" : "#1A0F12");
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
  const glow = ctx.createRadialGradient(W - 200, 160, 10, W - 200, 160, 560);
  glow.addColorStop(0, up ? "rgba(61,220,151,0.22)" : "rgba(255,107,107,0.2)"); glow.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = glow; ctx.fillRect(0, 0, W, H);
  ctx.textBaseline = "middle";
  const logo = await loadImage("/icon-192.png");
  if (logo) { ctx.save(); rounded(ctx, 64, 56, 56, 56, 14); ctx.clip(); ctx.drawImage(logo, 64, 56, 56, 56); ctx.restore(); }
  ctx.fillStyle = "#F2F3F5"; ctx.font = `800 34px ${sans}`; ctx.fillText("ArkhamPad", 136, 85);
  // coin
  const pic = p.image ? await loadImage(p.image) : null;
  ctx.save(); rounded(ctx, 64, 170, 96, 96, 24); ctx.clip();
  if (pic) ctx.drawImage(pic, 64, 170, 96, 96);
  else { const g = ctx.createLinearGradient(64, 170, 160, 266); g.addColorStop(0, p.c1); g.addColorStop(1, p.c2); ctx.fillStyle = g; ctx.fillRect(64, 170, 96, 96); ctx.fillStyle = "#fff"; ctx.font = `900 36px ${sans}`; ctx.textAlign = "center"; ctx.fillText(p.tick.slice(0, 2).toUpperCase(), 112, 220); ctx.textAlign = "left"; }
  ctx.restore();
  ctx.fillStyle = "#F2F3F5"; ctx.font = `900 48px ${sans}`; ctx.fillText(p.name.length > 22 ? p.name.slice(0, 21) + "…" : p.name, 186, 202);
  ctx.fillStyle = "#8A909C"; ctx.font = `700 26px ${mono}`; ctx.fillText(`$${p.tick} · ${p.chain}`, 188, 248);
  // result
  ctx.fillStyle = up ? "#3DDC97" : "#FF6B6B"; ctx.font = `800 132px ${mono}`;
  ctx.fillText(`${up ? "+" : ""}${p.pct.toFixed(1)}%`, 60, 380);
  ctx.font = `800 44px ${mono}`;
  ctx.fillText(`${up ? "+" : "-"}$${Math.abs(p.pnl).toFixed(2)}`, 66, 470);
  ctx.fillStyle = "#8A909C"; ctx.font = `600 24px ${sans}`;
  const fmt = (v: number) => (v >= 1e6 ? `$${(v / 1e6).toFixed(2)}M` : v >= 1e3 ? `$${(v / 1e3).toFixed(1)}K` : `$${v.toFixed(0)}`);
  ctx.fillText(`Bought at ${fmt(p.entryMc)} MC  →  ${p.closed ? "sold" : "now"} at ${fmt(p.nowMc)} MC`, 66, 540);
  rounded(ctx, 64, 588, W - 128, 50, 14); ctx.fillStyle = "rgba(255,255,255,0.05)"; ctx.fill();
  ctx.fillStyle = "#D4FF3A"; ctx.font = `800 22px ${sans}`; ctx.fillText("Trade with one tap on arkhampad.com", 90, 614);
  return await new Promise((res) => cv.toBlob((b) => res(b), "image/png"));
}

export async function sharePnl(p: Pnl) {
  const up = p.pnl >= 0;
  const text = `${up ? "+" : ""}${p.pct.toFixed(1)}% on $${p.tick} ${up ? "📈" : "📉"}\n\n${up ? "Up" : "Down"} $${Math.abs(p.pnl).toFixed(2)} trading on @Arkhampad`;
  const url = `${SITE}/coin/?c=${p.id}`;
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (isPhone() && nav.share) {
    try {
      const blob = await pnlCard(p);
      const file = blob ? new File([blob], `${p.tick.toLowerCase()}-result.png`, { type: "image/png" }) : null;
      if (file && nav.canShare?.({ files: [file] })) { await nav.share({ files: [file], text: `${text}\n${url}` }); return; }
    } catch (e) { if ((e as Error)?.name === "AbortError") return; }
  }
  openX(text, url);
}
