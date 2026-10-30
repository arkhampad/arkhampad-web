"use client";
// Create: launch a coin on Elysium. The whole supply goes into a locked pool at a 60 HYPE start market cap;
// the creator earns 30% of the 1% trading fee forever. The picture and details travel inside the coin's
// own metadata (a small data URI), so nothing depends on an outside server.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { decodeEventLog, encodeFunctionData, parseAbi, type Address, type Hex } from "viem";
import { useWallet } from "@/components/wallet";
import { useT } from "@/lib/i18n";
import { fetchHypeUsd, money, usePoll } from "@/lib/ely";
import { ELY_CHAIN, ely, fromWei, hypeBalance, rememberToken, toWei } from "@/lib/elytrade";

const LAUNCHER = (process.env.NEXT_PUBLIC_ELY_LAUNCHER || "") as Address | "";
const START_MC = 60; // HYPE, whole supply
const ABI = parseAbi([
  "function launch(string name, string symbol, string uri, address creator, uint256 minOut) payable returns (address coin, uint256 bought)",
  "function launchFee() view returns (uint256)",
  "event Launched(address indexed coin, address indexed creator, address pool, uint256 tokenId, string name, string symbol, string uri, uint256 startMc, uint256 firstBuyIn, uint256 firstBuyOut)",
]);

/**
 * The picture travels inside the coin's own metadata on-chain, so it must stay small: square, and
 * re-encoded until it is under ~5 KB (phones without WebP get JPEG, which is bigger, so we step down).
 */
function shrink(src: string, size = 160): Promise<string> {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => {
      const side = Math.min(img.width, img.height);
      const enc = (px: number, q: number) => {
        const cv = document.createElement("canvas");
        cv.width = px;
        cv.height = px;
        const ctx = cv.getContext("2d");
        if (!ctx) throw new Error("canvas");
        ctx.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, px, px);
        const w = cv.toDataURL("image/webp", q);
        return w.startsWith("data:image/webp") ? w : cv.toDataURL("image/jpeg", q);
      };
      try {
        let out = "";
        // every byte of the picture is stored on-chain inside the coin, which costs gas; ~7 KB keeps a
        // launch well inside what wallets and nodes allow (bigger pictures made the launch revert)
        for (const [px, q] of [[128, 0.72], [128, 0.55], [112, 0.5], [96, 0.5], [96, 0.38], [80, 0.35]] as const) {
          out = enc(px, q);
          if (out.length <= 7_000) break;
        }
        res(out);
      } catch (e) {
        rej(e);
      }
    };
    img.onerror = () => rej(new Error("image"));
    img.src = src;
  });
}

/** base64 of UTF-8 text, in chunks (spreading a long byte array into one call breaks on iPhones). */
const b64 = (s: string) => {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 8192) bin += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(bin);
};

export function CreatePage() {
  const tr = useT();
  const w = useWallet();
  const r = useRouter();
  const usd = usePoll(fetchHypeUsd, 30_000) ?? 0;
  const me = w.address as Address | null;
  const hype = usePoll(async () => (me ? hypeBalance(me) : null), 6000, [me]);
  const [name, setName] = useState("");
  const [sym, setSym] = useState("");
  const [desc, setDesc] = useState("");
  const [x, setX] = useState("");
  const [tg, setTg] = useState("");
  const [site, setSite] = useState("");
  const [buy, setBuy] = useState("");
  const [img, setImg] = useState<string | null>(null);
  const [drawing, setDrawing] = useState(false);
  const [picture, setPicture] = useState("");
  const [thinking, setThinking] = useState(false);
  const [left, setLeft] = useState<number | null>(null);
  const [aiMsg, setAiMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);

  const buyWei = toWei(buy);
  const b = fromWei(buyWei) * 0.99;
  const pctOfSupply = b > 0 ? (b / (START_MC + b)) * 100 : 0;
  const ok = name.trim().length > 0 && sym.trim().length > 0;

  async function pick(f: File | undefined) {
    if (!f) return;
    if (!/^image\/(png|jpe?g|webp|gif)$/.test(f.type)) return setMsg("Use a PNG, JPG, WebP or GIF image.");
    if (f.size > 10_000_000) return setMsg("That image is over 10 MB.");
    const url = URL.createObjectURL(f);
    try { setImg(await shrink(url)); setMsg(null); } catch { setMsg("Couldn't read that image."); } finally { URL.revokeObjectURL(url); }
  }

  async function draw(pic = picture, nm = name, ds = desc) {
    setDrawing(true);
    setAiMsg(null);
    try {
      const res = await fetch("/api/image", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: nm || "Elysium meme", description: ds, picture: pic }) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j.dataUrl) throw new Error(j.error || "Couldn't draw an image right now. Try again.");
      setImg(await shrink(j.dataUrl));
    } catch (e) {
      setAiMsg((e as Error).message || "Couldn't draw an image right now. Try again.");
    } finally {
      setDrawing(false);
    }
  }

  /** A whole coin (name, ticker, description and picture) in the style of what trends on Elysium now. */
  async function idea() {
    setThinking(true);
    setAiMsg(null);
    try {
      let j: { name?: string; ticker?: string; description?: string; picture?: string; left?: number; error?: string } = {};
      let limited = false;
      try {
        const res = await fetch("/api/ely-idea", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ address: me ?? "" }) });
        j = await res.json().catch(() => ({}));
        limited = res.status === 429;
        if (typeof j.left === "number") setLeft(j.left);
      } catch {}
      if (limited) throw new Error(j.error || "You've used today's AI ideas.");
      if (!j.name) {
        // backup: the general idea maker, pointed at Elysium
        const res = await fetch("/api/ideas", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ idea: "a fun meme coin for Elysium, the fast new Hyperliquid chain where everyone trades with HYPE" }) });
        const k = await res.json().catch(() => ({}));
        const o = k?.options?.[Math.floor(Math.random() * (k?.options?.length || 1))];
        if (!o?.name) throw new Error(k.error || j.error || "AI is busy right now. Try again in a few seconds.");
        j = o;
      }
      setName(j.name!);
      setSym(String(j.ticker || "").toUpperCase());
      setDesc(j.description || "");
      setPicture(j.picture || "");
      setImg(null);
      setThinking(false);
      await draw(j.picture || "", j.name!, j.description || "");
    } catch (e) {
      setAiMsg((e as Error).message);
    } finally {
      setThinking(false);
    }
  }

  async function launch() {
    if (!w.signedIn || !w.signer?.sendTx || !me) return w.login();
    if (!LAUNCHER) return;
    setMsg(null);
    try {
      const fee = (await ely().readContract({ address: LAUNCHER, abi: ABI, functionName: "launchFee" }).catch(() => 0n)) as bigint;
      const meta = {
        name: name.trim(),
        symbol: sym.trim().toUpperCase(),
        description: desc.trim() || undefined,
        image: img || undefined,
        twitter: x.trim() || undefined,
        telegram: tg.trim() || undefined,
        website: site.trim() || undefined,
        createdOn: "https://arkhampad.com",
      };
      const uri = `data:application/json;base64,${b64(JSON.stringify(meta))}`;
      const minOut = 0n; // the first buy is the first trade in a brand-new pool: nothing can move the price before it
      const data = encodeFunctionData({ abi: ABI, functionName: "launch", args: [meta.name, meta.symbol, uri, me, minOut] });
      setBusy("Launching…");
      const hash = await w.signer.sendTx(ELY_CHAIN, { to: LAUNCHER, data, value: fee + buyWei });
      setBusy("Confirming…");
      const rc = await ely().waitForTransactionReceipt({ hash: hash as Hex, timeout: 90_000 });
      if (rc.status !== "success") throw new Error("failed");
      let coin: string | null = null;
      for (const l of rc.logs) {
        try {
          const d = decodeEventLog({ abi: ABI, data: l.data, topics: l.topics });
          if (d.eventName === "Launched") coin = (d.args as { coin: string }).coin;
        } catch {}
      }
      if (!coin) throw new Error("no coin");
      rememberToken(coin);
      r.push(`/t/?a=${coin.toLowerCase()}&new=1`);
    } catch (e) {
      const m = String((e as Error)?.message ?? "");
      // keep the real reason in the console and on screen (short), so a failed launch can be diagnosed
      console.error("launch failed", e);
      const why = String((e as { shortMessage?: string })?.shortMessage || m).split("\n")[0].slice(0, 140);
      if (!/insufficient|reject|denied|cancel/i.test(m)) { setMsg(`Launch failed: ${why}`); return; }
      setMsg(/insufficient/i.test(m) ? (buyWei > 0n ? "Not enough HYPE for the first buy and gas." : "You need a little HYPE on Elysium for gas.") : /reject|denied|cancel/i.test(m) ? "Cancelled." : "Launch failed. Nothing was spent except gas. Please try again.");
    } finally {
      setBusy(null);
    }
  }

  let label = "Launch coin";
  let disabled = !!busy;
  if (!w.signedIn) label = "Log in to launch";
  else if (!LAUNCHER) { label = "Launching opens soon"; disabled = true; }
  else if (!ok) { label = "Add a name and ticker"; disabled = true; }
  else if (hype != null && buyWei > 0n && buyWei > hype) { label = "Not enough HYPE"; disabled = true; }
  // no HYPE at all: launching still costs a little gas, so point to Add money instead of failing
  else if (hype === 0n) { label = "Add HYPE for gas first"; disabled = true; }
  if (busy) label = busy;

  return (
    <main className="e-in e-page">
      <section className="e-hero">
        <div>
          <span className="e-eyebrow">{tr("Create")}</span>
          <h1>{tr("Launch a coin on Elysium")}</h1>
          <p>{tr("Takes about 30 seconds. You earn 30% of the trading fees on your coin, forever.")}</p>
        </div>
      </section>
      <div className="e-bridge">
        <section className="e-panel">
          <div className="e-trade">
            <button type="button" className="e-idea" onClick={idea} disabled={thinking || drawing}>
              <span className="e-spark" aria-hidden="true">✦</span>
              <span>
                <b>{tr(thinking ? "Reading Elysium trends…" : drawing && !img ? "Drawing your coin…" : "Give me a coin idea")}</b>
                <small>{tr("AI looks at what's trending on Elysium and fills everything in")}{left != null ? ` · ${tr("{n} left today", { n: left })}` : ""}</small>
              </span>
            </button>
            <div className="e-imgrow">
              <button type="button" className="e-imgbox" onClick={() => file.current?.click()} aria-label="Upload a picture">
                {img ? <img src={img} alt="Coin picture" /> : <span>{tr("Add picture")}</span>}
              </button>
              <div className="e-imgbtns">
                <button type="button" className="e-btn" onClick={() => file.current?.click()}>{tr("Upload")}</button>
                <button type="button" className="e-btn" onClick={() => (name.trim() ? draw() : idea())} disabled={drawing || thinking}>{tr(drawing ? "Drawing…" : "Draw with AI")}</button>
                <span className="e-note">{tr("Square works best. PNG, JPG, WebP or GIF.")}</span>
              </div>
              <input ref={file} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={(e) => pick(e.target.files?.[0])} />
            </div>
            {aiMsg && <div className="e-msg bad" role="status">{tr(aiMsg)}</div>}
            <label className="e-field"><span>{tr("Name")}</span><input value={name} maxLength={32} onChange={(e) => setName(e.target.value)} placeholder="Moon Otter" autoComplete="off" /></label>
            <label className="e-field"><span>{tr("Ticker")}</span><input value={sym} maxLength={10} onChange={(e) => setSym(e.target.value.replace(/[^A-Za-z0-9]/g, "").toUpperCase())} placeholder="OTTER" autoComplete="off" autoCapitalize="characters" /></label>
            <label className="e-field"><span>{tr("Description")} <i className="dim">{tr("optional")}</i></span><textarea value={desc} maxLength={400} rows={3} onChange={(e) => { setDesc(e.target.value); setPicture(""); }} placeholder={tr("What is your coin about?")} /></label>
            <details className="e-more-links">
              <summary>{tr("Links")} <i className="dim">{tr("optional")}</i></summary>
              <label className="e-field"><span>X</span><input value={x} onChange={(e) => setX(e.target.value)} placeholder="https://x.com/yourcoin" inputMode="url" autoCapitalize="off" /></label>
              <label className="e-field"><span>Telegram</span><input value={tg} onChange={(e) => setTg(e.target.value)} placeholder="https://t.me/yourcoin" inputMode="url" autoCapitalize="off" /></label>
              <label className="e-field"><span>{tr("Website")}</span><input value={site} onChange={(e) => setSite(e.target.value)} placeholder="https://" inputMode="url" autoCapitalize="off" /></label>
            </details>
            <label className="e-amt">
              <span className="e-amt-top"><span>{tr("First buy")} <i className="dim">{tr("optional")}</i></span><span className="dim">{tr("Balance")} {hype != null ? `${fromWei(hype).toFixed(4)} HYPE` : "—"}</span></span>
              <span className="e-amt-row"><input inputMode="decimal" placeholder="0" value={buy} onChange={(e) => setBuy(e.target.value.replace(/[^0-9.,]/g, ""))} aria-label="First buy in HYPE" /><b>HYPE</b></span>
              <span className="dim" style={{ fontSize: 12.5 }}>{b > 0 ? `≈ ${money(fromWei(buyWei) * usd)} · ${tr("about {p}% of the supply", { p: pctOfSupply.toFixed(1) })}` : tr("Be the first buyer of your own coin, in the same transaction.")}</span>
            </label>
            <div className="e-quick">{["0.1", "0.5", "1", "2"].map((v) => <button key={v} type="button" onClick={() => setBuy(v)}>{v}</button>)}</div>
            <button type="button" className="e-go" disabled={disabled && w.signedIn} onClick={launch}>{tr(label)}</button>
            {msg && <div className="e-msg bad" role="status">{tr(msg)}</div>}
            {w.signedIn && hype === 0n && <Link href="/bridge/" className="e-hint">{tr("You need a little HYPE on Elysium for gas.")} <b>{tr("Add HYPE or USDC →")}</b></Link>}
          </div>
        </section>
        <aside className="e-bstack">
          <section className="e-panel" aria-label={tr("Preview")}>
            <h3 className="e-ph">{tr("Preview")} <span className="dim" style={{ fontWeight: 600, fontSize: 12.5 }}>{tr("how it shows on Discover")}</span></h3>
            <div className="e-prev">
              <span className="e-prev-img">{img ? <img src={img} alt="" /> : (sym || name || "?").slice(0, 1).toUpperCase()}</span>
              <div className="e-prev-body">
                <span className="l1"><b>{name.trim() || "Moon Otter"}</b><span className="dim">${sym || "OTTER"}</span></span>
                <span className="dim" style={{ fontSize: 13 }}>{tr("by you · just now")}</span>
              </div>
            </div>
            <div className="e-prev-grid">
              <div><span>{tr("Market cap")}</span><b>{usd ? money(START_MC * usd) : `${START_MC} HYPE`}</b></div>
              <div><span>{tr("Supply")}</span><b>1B</b></div>
              <div><span>{tr("You earn")}</span><b>30%</b></div>
            </div>
          </section>
          <div className="e-panel e-bside">
          <h3 className="e-ph">{tr("How it works")}</h3>
          <ul>
            <li>{tr("All 1,000,000,000 coins go into the pool. No team share, no presale.")}</li>
            <li>{tr("Starts at a {n} HYPE market cap", { n: START_MC })}{usd ? ` (≈ ${money(START_MC * usd)})` : ""}.</li>
            <li>{tr("Liquidity is locked forever. Nobody can pull it, including you and us.")}</li>
            <li>{tr("Every trade pays a 1% fee. 30% of it goes to you, paid in HYPE and in your coin.")}</li>
            <li>{tr("Your coin shows up on Discover right away, with a chart and holders.")}</li>
          </ul>
          <Link href="/learn/create-a-token-on-elysium/" className="e-more" style={{ display: "grid", placeItems: "center", textDecoration: "none" }}>{tr("Full guide")}</Link>
          </div>
        </aside>
      </div>
    </main>
  );
}
