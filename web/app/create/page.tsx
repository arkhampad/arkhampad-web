"use client";
import Link from "next/link";
import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { FrogArt } from "@/components/bits";
import { ICopy, IFire, IGlobe, IRocket, ISpark, IX } from "@/components/icons";
import { useApp } from "@/components/shell";
import { Confetti } from "@/components/celebrate";
import { coinText, downloadCard, openX, prepareCard, shareCoinCard, type ShareCoin } from "@/lib/share";
import { useWallet } from "@/components/wallet";
import { launchSchedule } from "@/components/v2";
import { lastFee, warmFees, NETS, TradeError, fromUsdc, launch, promote, toUsdc, uploadCoinImage, LIVE, dollarOf, clankerLaunch, isClankerChain } from "@/lib/chain";

/**
 * An AI picture (data: URL) as a file to upload. Decoded by hand: the site's security
 * policy doesn't let fetch() read data: URLs, which used to drop the chosen picture.
 */
function dataUrlToFile(dataUrl: string): File | null {
  const m = /^data:([^;,]+);base64,(.*)$/.exec(dataUrl);
  if (!m) return null;
  try {
    const bin = atob(m[2]);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const ext = m[1].includes("jpeg") ? "jpg" : m[1].split("/")[1] || "png";
    return new File([bytes], `coin.${ext}`, { type: m[1] });
  } catch { return null; }
}

const PALETTE = [["#1B1F6B", "#7C5CFF"], ["#0B3B2E", "#2BB38A"], ["#3B1B0B", "#FF8A3D"]];
const OPTS0 = [
  { name: "Moonfrog", tick: "MFROG", desc: "An astronaut frog who only buys the dip. Floating in orbit, waiting for red candles.", c1: "#1B1F6B", c2: "#7C5CFF" },
  { name: "Dip Hopper", tick: "HOPPR", desc: "A space frog that hops in every time the chart dips. Never sleeps, never sells.", c1: "#0B3B2E", c2: "#2BB38A" },
  { name: "Orbit Toad", tick: "OTOAD", desc: "Zero gravity, zero panic. This toad buys dips from low orbit.", c1: "#3B1B0B", c2: "#FF8A3D" },
];
// Networks where launching is paused: BNB Chain until its Clanker launches are switched on
// (DEX screeners don't list its Uniswap v4 USDC pools).
const CREATE_PAUSED = new Set<number>([56]);
function CreateView() {
  const q = useSearchParams();
  const { toast, openFunds } = useApp();
  const [idea, setIdea] = useState(q.get("idea") || "");
  const [step, setStep] = useState(0);
  const [generated, setGenerated] = useState(false);
  // AI logos for the three ideas: drawn in parallel, picked with the idea
  const [arts, setArts] = useState<(string | null | "loading" | "failed")[]>([null, null, null]);
  const artRun = useRef(0);
  const pickRef = useRef(0);
  const [pick, setPick] = useState(0);
  const [OPTS, setOpts] = useState(OPTS0);
  const [thinking, setThinking] = useState(false);
  const [drawing, setDrawing] = useState(false);
  const [name, setName] = useState(OPTS0[0].name);
  const [tick, setTick] = useState(OPTS0[0].tick);
  const [desc, setDesc] = useState(OPTS0[0].desc);
  // networks come from the site config (testnet: Robinhood + Base; mainnet adds more)
  // Base first and the default: the chain most trading apps and wallets already show
  const CHAINS = [...NETS].filter((n) => !CREATE_PAUSED.has(n.id)).sort((a, b) => (a.short === "Base" ? -1 : b.short === "Base" ? 1 : 0)).map((n) => ({ id: n.id, name: n.short, color: n.short === "Robinhood" ? "var(--rh)" : n.short === "Base" ? "var(--base)" : n.short === "BNB" ? "#F0B90B" : "var(--volt)" }));
  const [chain, setChain] = useState(CHAINS.find((c) => c.name === "Base")?.name ?? CHAINS[0].name);
  // safe, simple defaults: fees to the creator unless they pick buyback & burn
  const [fee, setFee] = useState("you");
  const [boost, setBoost] = useState("none");
  const [first, setFirst] = useState(5); // every launch includes a first buy of at least $5
  const [firstTxt, setFirstTxt] = useState(""); // typed amount (kept as text so "12." can be typed)
  const [links, setLinks] = useState(false);
  const [done, setDone] = useState<null | { coin: string; chainId: number }>(null);
  const [xUrl, setXUrl] = useState("");
  const [tgUrl, setTgUrl] = useState("");
  const [webUrl, setWebUrl] = useState("");
  const [busy, setBusy] = useState("");
  const [imgFile, setImgFile] = useState<File | null>(null);
  const [imgPreview, setImgPreview] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const w = useWallet();
  const chainId = (CHAINS.find((c) => c.name === chain) ?? CHAINS[0]).id;
  const cash = LIVE ? w.totalUsdc : fromUsdc(w.usdc[chainId] ?? 0n); // live: one balance, moved to the coin's network automatically
  const viaClanker = isClankerChain(chainId);
  const launchKind = viaClanker ? "clankerLaunch" : "launch";
  const native = chainId === 56 ? "BNB" : "ETH";
  useEffect(() => { warmFees(chainId, [launchKind, "promote"]); }, [chainId, launchKind]);
  const need = first + (boost === "none" ? 0 : Number(boost)) + fromUsdc(lastFee(chainId, launchKind)) + (boost === "none" ? 0 : fromUsdc(lastFee(chainId, "promote")));
  const o = OPTS[pick];
  const applyArt = async (dataUrl: string) => {
    const f = dataUrlToFile(dataUrl);
    if (!f) return; // keep the current picture
    setImgFile(f);
    setImgPreview(dataUrl);
  };
  const choose = (i: number, list = OPTS, art = arts[i]) => {
    setPick(i); pickRef.current = i; setName(list[i].name); setTick(list[i].tick); setDesc(list[i].desc);
    if (art && art !== "loading" && art !== "failed") applyArt(art); else { setImgFile(null); setImgPreview(null); }
    // a coin's logo is only drawn when someone picks it (saves AI cost)
    if (art === null && generated && list === OPTS) {
      const x = list[i] as { name: string; desc: string; picture?: string };
      setArts((a) => a.map((v, k) => (k === i ? "loading" : v)));
      drawOne(i, x.name, x.desc, artRun.current, x.picture);
    }
  };
  const drawOne = async (i: number, nm: string, ds: string, run: number, picture?: string) => {
    try {
      const r = await fetch("/api/image", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: nm, description: ds, picture }) });
      const j = await r.json().catch(() => ({}));
      if (run !== artRun.current) return;
      if (!r.ok || !j.dataUrl) { setArts((a) => a.map((x, k) => (k === i ? "failed" : x))); return; }
      setArts((a) => a.map((x, k) => (k === i ? j.dataUrl : x)));
      // picked while it was still drawing: use the picture now
      if (pickRef.current === i) applyArt(j.dataUrl);
    } catch { if (run === artRun.current) setArts((a) => a.map((x, k) => (k === i ? "failed" : x))); }
  };

  // AI: one sentence (any language) -> three ready coins
  const generate = async (text = idea, trend?: string) => {
    if (!text.trim()) { toast("Describe your coin in a few words, or tap an idea."); return; }
    setThinking(true);
    try {
      const r = await fetch("/api/ideas", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ idea: text, trend }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !Array.isArray(j.options) || !j.options.length) throw new Error(j.error || "AI is busy, please try again.");
      const list = j.options.slice(0, 3).map((o: { name: string; ticker: string; description: string; picture?: string }, i: number) => ({ name: o.name, tick: o.ticker, desc: o.description, picture: o.picture, c1: PALETTE[i][0], c2: PALETTE[i][1] }));
      setOpts(list);
      setGenerated(true);
      const run = ++artRun.current;
      // one logo right away (the first coin), the others when they're picked (saves AI cost)
      setArts(["loading", null, null]);
      choose(0, list, "loading");
      drawOne(0, list[0].name, list[0].desc, run, list[0].picture);
    } catch (e) { toast((e as Error).message || "AI is busy, please try again."); } finally { setThinking(false); }
  };
  // Trend Coin: the 3 hottest topics right now (scanned every 5 minutes), one tap designs coins for it
  type Trend = { title: string; emoji: string; why: string; idea: string; heat: number };
  const [trends, setTrends] = useState<{ topics: Trend[]; scannedAt: number } | null>(null);
  const [trendOpen, setTrendOpen] = useState(false);
  const [trendBusy, setTrendBusy] = useState(false);
  const [trendPick, setTrendPick] = useState<number | null>(null);
  const openTrends = async () => {
    setTrendOpen(true);
    if (trends && Date.now() - trends.scannedAt < 5 * 60_000) return;
    setTrendBusy(true);
    try {
      const r = await fetch("/api/trends");
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !Array.isArray(j.topics) || !j.topics.length) throw new Error(j.error || "Couldn't read the trends right now. Try again in a minute.");
      setTrends(j);
    } catch (e) { toast((e as Error).message); setTrendOpen(false); } finally { setTrendBusy(false); }
  };
  const pickTrend = (i: number) => {
    const t = trends?.topics[i];
    if (!t || thinking) return;
    setTrendPick(i);
    setIdea(t.idea);
    setTrendOpen(false); // the topic is chosen: show the coins designed for it
    setTimeout(() => cardsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
    generate(t.idea, `${t.title}: ${t.why}`);
  };
  const cardsRef = useRef<HTMLDivElement>(null);
  const pickedTrend = trendPick !== null && trends?.topics[trendPick]?.idea === idea ? trends.topics[trendPick] : null;
  // "Generate again" on a trend idea keeps the trend's context
  const trendWhy = () => { const t = trendPick !== null ? trends?.topics[trendPick] : undefined; return t && t.idea === idea ? `${t.title}: ${t.why}` : undefined; };
  const ago = (ts: number) => { const m = Math.max(0, Math.round((Date.now() - ts) / 60_000)); return m < 1 ? "just now" : `${m} min ago`; };
  // AI image for the chosen coin
  const drawImage = async () => {
    setDrawing(true);
    try {
      const r = await fetch("/api/image", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, description: desc }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.dataUrl) { if (j.detail) console.warn("AI image:", j.code, j.detail); throw new Error(j.error || "Couldn't draw an image right now."); }
      const f = dataUrlToFile(j.dataUrl);
      if (!f) throw new Error("Couldn't draw an image right now.");
      setImgFile(f);
      setImgPreview(j.dataUrl);
    } catch (e) { toast((e as Error).message); } finally { setDrawing(false); }
  };
  const autoRan = useRef(false);
  useEffect(() => { if (!autoRan.current && q.get("idea")) { autoRan.current = true; generate(q.get("idea") || ""); } }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const ca = done?.coin ?? "";
  // the creator's own invite rides along: everyone who comes from their posts earns them a share
  const me = w.address?.toLowerCase() ?? "";
  const coinUrl = done ? `https://arkhampad.com/coin/?c=${done.chainId}-${done.coin}${me ? `&ref=${me}` : ""}` : "";
  const dexUrl = done && DEX_SLUG[done.chainId] ? `https://dexscreener.com/${DEX_SLUG[done.chainId]}/${done.coin}` : "";
  const shareObj: ShareCoin = { name, tick, chain, mc: viaClanker ? "$4.8K" : LIVE ? "$2K" : "$450", chg: 0, address: ca, id: done ? `${done.chainId}-${done.coin.toLowerCase()}` : "", c1: o.c1, c2: o.c2, own: true };
  const post = coinText(shareObj, { launched: true }).replace(/\nMarket cap.*\n/, "\n") + (desc ? `\n\n${desc.trim().slice(0, 140)}` : "") + (dexUrl ? `\n\nChart: ${dexUrl}` : "");
  const [cardUrl, setCardUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!done) return;
    let url = "";
    prepareCard(shareObj).then((b) => { if (b) { url = URL.createObjectURL(b); setCardUrl(url); } });
    return () => { if (url) URL.revokeObjectURL(url); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [done]);

  const launchNow = async () => {
    if (!w.signedIn || !w.signer) { w.login(); return; }
    const nm = name.trim(), tk = tick.trim();
    if (!nm || nm.length > 32) return toast("Name must be 1 to 32 characters.");
    if (/arkham/i.test(nm) || /arkham/i.test(tk)) return toast("Coins can't use the ArkhamPad name. Pick another name.");
    if (!/^[A-Z0-9]{1,10}$/.test(tk)) return toast("Ticker must be 1 to 10 letters or numbers.");
    if (desc.length > 280) return toast("Keep the description under 280 characters.");
    if (!(first >= 5)) return toast("Your first buy must be at least $5.");
    if (cash < need) { toast(`You need $${need.toFixed(2)} USDC on ${chain}. ${LIVE ? "Add USDC first." : "Add test USDC first."}`); openFunds("deposit"); return; }
    const meta = JSON.stringify({ description: desc.trim().slice(0, 280), x: xUrl.trim().slice(0, 100) || undefined, telegram: tgUrl.trim().slice(0, 100) || undefined, website: webUrl.trim().slice(0, 100) || undefined, art: { c1: o.c1, c2: o.c2 } });
    const metadataURI = `data:application/json;base64,${btoa(unescape(encodeURIComponent(meta)))}`;
    try {
      setBusy("Launching…");
      const lockSeconds = 0; // creators can always sell: no creator lock on ArkhamPad
      // Clanker launches carry the picture inside the coin (sent with the launch)
      const r = viaClanker
        ? await clankerLaunch(chainId, { name: nm, symbol: tk, metadataURI, launchUsdc: toUsdc(first) }, imgFile, w.signer)
        : await launch(chainId, { name: nm, symbol: tk, metadataURI, lockSeconds, feeMode: fee === "burn" ? 1 : 0, launchUsdc: toUsdc(first) }, w.signer);
      if (imgFile && !viaClanker) {
        setBusy("Adding image…");
        // the indexer needs a moment to see the new coin before the image can be attached
        for (let i = 0; i < 10; i++) {
          try { await uploadCoinImage(chainId, r.coin, imgFile, w.signer); break; }
          catch (e) { if (i === 9 || !(e instanceof TradeError) || !/not found yet/i.test(e.message)) { toast(`Coin is live, but the image failed: ${(e as Error).message}`); break; } await new Promise((res) => setTimeout(res, 2500)); }
        }
      }
      if (boost !== "none") {
        setBusy("Promoting…");
        try { await promote(chainId, r.coin, boost === "10" ? 1 : 2, w.signer); }
        catch (e) { toast(`Coin is live, but the boost failed: ${(e as Error).message}`); }
      }
      await w.refresh();
      setDone({ coin: r.coin, chainId });
      window.scrollTo({ top: 0 });
    } catch (e) {
      toast(e instanceof TradeError ? e.message : "Launch failed. Please try again.");
    } finally {
      setBusy("");
    }
  };
  const copy = async (s: string, m: string) => { try { await navigator.clipboard.writeText(s); toast(m); } catch { /* blocked */ } };

  if (done) return (
    <div className="wrap page" style={{ maxWidth: 680 }}>
      <Confetti />
      <div className="card" style={{ background: "var(--card)", borderRadius: 22, padding: 20, gap: 16 }}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", gap: 10 }}>
          <span style={{ width: 92, height: 92, borderRadius: 26, overflow: "hidden", boxShadow: "0 20px 60px rgba(124,92,255,0.35)" }}>{imgPreview ? <img src={imgPreview} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <FrogArt c1={o.c1} c2={o.c2} />}</span>
          <h1 style={{ margin: 0, fontSize: 32, fontWeight: 900, letterSpacing: -1 }}>{name} is live!</h1>
          <p className="muted" style={{ margin: 0, fontSize: 15 }}>Share it now. Everything is ready, including the contract address.</p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 12px 12px 16px", borderRadius: 16, background: "var(--bg)", border: "1px solid var(--line3)" }}>
          <span style={{ display: "flex", flexDirection: "column", gap: 2, flex: 1, minWidth: 0 }}><span style={{ fontSize: 11, color: "var(--faint)" }}>Contract address (CA)</span><span className="mono" style={{ fontWeight: 600, fontSize: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{ca}</span></span>
          <button type="button" className="btn volt" onClick={() => copy(ca, "Contract address copied")}><ICopy size={15} color="#0A0B10" />Copy CA</button>
        </div>
        <span style={{ fontWeight: 700, fontSize: 14 }}>Your post</span>
        <div style={{ padding: "14px 16px", borderRadius: 16, background: "var(--bg)", border: "1px solid var(--line2)", fontSize: 14, lineHeight: 1.55, color: "var(--note)", whiteSpace: "pre-line", wordBreak: "break-word" }}>{post}</div>
        {/* the branded card everyone will see */}
        {cardUrl && <img src={cardUrl} alt={`${name} share card`} style={{ width: "100%", borderRadius: 16, border: "1px solid var(--line2)" }} />}
        <button type="button" className="btn volt lg" onClick={() => shareCoinCard(shareObj, { launched: true })}><IX size={15} color="#0A0B10" w={2.4} />Share your coin</button>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button type="button" className="btn white" style={{ flex: "1 1 120px", height: 46 }} onClick={() => openX(post, coinUrl)}><IX size={14} color="#0A0B10" w={2.4} />Post on X</button>
          <a className="btn" style={{ flex: "1 1 120px", height: 46, background: "#2AABEE", border: 0, color: "#fff" }} href={`https://t.me/share/url?url=${encodeURIComponent(coinUrl)}&text=${encodeURIComponent(post)}`} target="_blank" rel="noopener noreferrer">Telegram</a>
          <a className="btn" style={{ flex: "1 1 120px", height: 46, background: "#25D366", border: 0, color: "#04130C" }} href={`https://wa.me/?text=${encodeURIComponent(`${post}\n${coinUrl}`)}`} target="_blank" rel="noopener noreferrer">WhatsApp</a>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button type="button" className="btn ghost" style={{ flex: 1 }} onClick={() => copy(`${post}\n${coinUrl}`, "Post and CA copied")}><ICopy size={15} />Copy post + CA</button>
          <button type="button" className="btn ghost" style={{ flex: 1 }} onClick={() => downloadCard(shareObj)}>Save card image</button>
          <Link href={`/coin/?c=${done.chainId}-${done.coin}`} className="btn ghost" style={{ flex: 1 }}>Open coin page</Link>
        </div>
      </div>
    </div>
  );

  const SPARKS: [string, string][] = [["Frog trader", "A frog that trades on Robinhood"], ["Panda astronaut", "A sleepy panda astronaut"], ["Moon pizza", "Pizza that goes to the moon"], ["Surfing cat", "A cat that surfs the ocean waves"], ["King shiba", "A shiba inu wearing a crown"], ["Meme robot", "A robot that only eats memes"], ["Pirate duck", "A pirate duck looking for treasure"], ["DJ penguin", "A penguin DJ at an ice party"], ["Gold dragon", "A dragon made of gold coins"], ["Rocket banana", "A banana on a rocket"]];
  const STEPS = ["Idea", "Details", "Launch"];
  const go = (i: number) => { setStep(i); window.scrollTo({ top: 0 }); };
  const skipAi = () => { setName(""); setTick(""); setDesc(""); setImgFile(null); setImgPreview(null); go(1); };
  const detailsOk = name.trim().length > 0 && /^[A-Z0-9]{1,10}$/.test(tick.trim());
  const next = () => {
    if (step === 0) { if (!generated) { if (idea.trim()) generate(); else toast("Describe your coin, or tap one of the ideas."); return; } go(1); return; }
    if (step === 1) { if (!detailsOk) { toast(!name.trim() ? "Give your coin a name." : "Ticker: 1 to 10 letters or numbers."); return; } go(2); return; }
    launchNow();
  };
  const nextLabel = step === 0 ? (generated ? "Next: details" : thinking ? "Designing…" : "Generate 3 coins")
    : step === 1 ? "Next: launch settings"
    : busy || (w.signedIn ? `Launch ${name || "coin"} · ${boost === "none" ? "Free" : `$${boost}`}` : "Log in to launch");
  const pic = (size: number, radius: number) => (
    <span className="cr-pic" style={{ width: size, height: size, borderRadius: radius }}>{imgPreview ? <img src={imgPreview} alt="" /> : <FrogArt c1={o.c1} c2={o.c2} />}</span>
  );

  return (
    <div className="wrap page cr">
      <div className="cr-top">
        <h1>Create a coin</h1>
        <div className="cr-steps" role="tablist" aria-label="Steps">
          {STEPS.map((t, i) => (
            <button key={t} type="button" role="tab" aria-selected={step === i} className={`${step === i ? "on" : ""}${step > i ? " past" : ""}`} onClick={() => (i <= step || (i === 1 && generated) || (i === 2 && detailsOk) ? go(i) : undefined)}>
              <i /><span>{i + 1} · {t}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="cr-grid">
        <div className="cr-main">
          {step === 0 && (
            <>
              <div className={`cr-trend${trendOpen ? " open" : ""}`}>
                <button type="button" className="cr-trend-btn" onClick={() => (trendOpen && !trendBusy ? setTrendOpen(false) : openTrends())} aria-expanded={trendOpen}>
                  <span className="cr-flame" aria-hidden="true">🔥</span>
                  <span className="cr-trend-t"><b>Create Trend Coin</b><span>{pickedTrend && !trendOpen ? <>Topic: <b style={{ fontSize: "inherit" }}>{pickedTrend.title}</b> · tap to pick another</> : "The 3 hottest topics on the internet right now. Pick one, your coin is ready."}</span></span>
                  <span className="cr-trend-go" aria-hidden="true">{trendOpen ? "▴" : "▾"}</span>
                </button>
                {trendOpen && (
                  <div className="cr-trend-list" role="radiogroup" aria-label="Trending topics" aria-busy={trendBusy}>
                    <span className="cr-trend-h">Pick a topic · we design 3 coins for it</span>
                    {trendBusy || !trends ? [0, 1, 2].map((i) => <div key={i} className="cr-topic skel" style={{ height: 76 }} />) : trends.topics.map((t, i) => (
                      <button key={i} type="button" role="radio" aria-checked={trendPick === i} className={`cr-topic${trendPick === i ? " on" : ""}`} disabled={thinking} onClick={() => pickTrend(i)}>
                        <span className="cr-topic-e" aria-hidden="true">{t.emoji}</span>
                        <span className="cr-topic-t"><b>{t.title}</b><span>{t.why}</span></span>
                        <span className="cr-heat" title="How hot it is right now">🔥 {t.heat}</span>
                      </button>
                    ))}
                    {trends && !trendBusy && <span className="cr-trend-note">{thinking && trendPick !== null ? "Designing your trend coins…" : `Updated ${ago(trends.scannedAt)} · scans dexes, Google, news and Reddit every 5 minutes`}</span>}
                  </div>
                )}
              </div>
              <div className="cr-ai">
                <span className="cr-badge"><ISpark size={12} color="currentColor" />AI</span>
                <h2>Your coin, designed in seconds</h2>
                <p>One sentence in any language. You get 3 coins with a name, ticker, story and logo.</p>
                <label htmlFor="cidea" className="sr">Describe your coin in any language</label>
                <textarea id="cidea" rows={2} value={idea} maxLength={300} placeholder="e.g. A frog astronaut who only buys the dip" onChange={(e) => setIdea(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); if (!thinking) generate(idea, trendWhy()); } }} />
                <div className="cr-sparks">
                  {SPARKS.map(([a, b]) => <button key={a} type="button" onClick={() => { setIdea(b); generate(b); }} disabled={thinking}>{a}</button>)}
                </div>
                <button type="button" className="cr-gen" disabled={thinking} onClick={() => generate(idea, trendWhy())}><ISpark size={16} color="currentColor" />{thinking ? "Designing your coins…" : generated ? "Generate again" : "Generate 3 coins"}</button>
              </div>
              {(thinking || generated) && pickedTrend && <div className="cr-cards-h" ref={cardsRef}>🔥 3 coins for: <b>{pickedTrend.title}</b> · pick one</div>}
              {(thinking || generated) && (
                <div className="cr-cards" role="radiogroup" aria-label="AI coins" aria-busy={thinking}>
                  {thinking ? [0, 1, 2].map((i) => <div key={i} className="cr-card skel" style={{ height: 268 }} />) : OPTS.map((x, i) => {
                    const a = arts[i];
                    return (
                      <button key={i} type="button" role="radio" aria-checked={pick === i} className={`cr-card${pick === i ? " on" : ""}`} onClick={() => choose(i)}>
                        <span className="cr-art">
                          {a === "loading" ? <span className="skel" style={{ position: "absolute", inset: 0 }} /> : a && a !== "failed" ? <img src={a} alt="" /> : <FrogArt c1={x.c1} c2={x.c2} />}
                          {a === "loading" && <span className="cr-drawing">Drawing logo…</span>}
                          {a === null && generated && <span className="cr-drawing">Tap to draw logo</span>}
                          <span className="cr-tick" aria-hidden="true">✓</span>
                        </span>
                        <b>{x.name}</b>
                        <span className="mono cr-tk">${x.tick}</span>
                        <span className="cr-ds">{x.desc}</span>
                      </button>
                    );
                  })}
                </div>
              )}
              {generated && !thinking && <span className="cr-hint">{OPTS.length > 1 ? "Swipe to see all 3 · " : ""}tap one, then Next. You can still change everything.</span>}
              <button type="button" className="cr-skip" onClick={skipAi}>Skip AI, I&apos;ll fill it in myself</button>
            </>
          )}

          {step === 1 && (
            <div className="card cr-pane">
              <div className="cr-id">
                <button type="button" className="cr-picbtn" onClick={() => fileRef.current?.click()} aria-label="Change picture">{pic(96, 18)}<span>Change</span></button>
                <div className="cr-fields">
                  <div className="field"><label htmlFor="cn">Name</label><input id="cn" className="inp" value={name} maxLength={32} placeholder="Harbor Cat" onChange={(e) => setName(e.target.value)} /></div>
                  <div className="field"><label htmlFor="ct">Ticker</label><input id="ct" className="inp mono" value={tick} maxLength={10} placeholder="HCAT" onChange={(e) => setTick(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))} /></div>
                </div>
              </div>
              <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) { setImgFile(f); setImgPreview(URL.createObjectURL(f)); } e.target.value = ""; }} />
              <div className="cr-mini">
                <button type="button" className="btn ghost sm" disabled={drawing} onClick={drawImage}><ISpark size={14} color="var(--volt-ink)" />{drawing ? "Drawing…" : "New AI logo"}</button>
                <button type="button" className="btn ghost sm" onClick={() => fileRef.current?.click()}>Upload image</button>
                {imgFile && <button type="button" className="btn ghost sm" onClick={() => { setImgFile(null); setImgPreview(null); }}>Remove</button>}
              </div>
              <div className="field"><label htmlFor="cd">Story <span className="dim" style={{ fontWeight: 400 }}>· shown on your coin page</span></label><textarea id="cd" rows={3} className="inp" value={desc} maxLength={280} placeholder="What's the idea? Tell future holders a little about it." onChange={(e) => setDesc(e.target.value)} /></div>
              <details className="cr-links" open={links} onToggle={(e) => setLinks((e.target as HTMLDetailsElement).open)}>
                <summary>Links <span className="dim">optional</span></summary>
                <div className="cr-links-in">
                  <div className="field"><label htmlFor="cx">X</label><input id="cx" className="inp" placeholder="x.com/yourcoin" value={xUrl} onChange={(e) => setXUrl(e.target.value)} /></div>
                  <div className="field"><label htmlFor="ctg">Telegram</label><input id="ctg" className="inp" placeholder="t.me/yourcoin" value={tgUrl} onChange={(e) => setTgUrl(e.target.value)} /></div>
                  <div className="field"><label htmlFor="cw">Website</label><input id="cw" className="inp" placeholder="yourcoin.com" value={webUrl} onChange={(e) => setWebUrl(e.target.value)} /></div>
                </div>
              </details>
              <span style={{ fontSize: 11, color: "var(--faint)" }}>Name, ticker, story and links are saved with the coin at launch. The picture can be changed later.</span>
            </div>
          )}

          {step === 2 && (
            <div className="card cr-pane">
              <div className="cr-sum">
                {pic(44, 12)}
                <span style={{ minWidth: 0, flex: 1 }}>
                  <b>{name || "Your coin"}</b> <span className="mono dim" style={{ fontSize: 11 }}>${tick || "TICKER"}</span>
                  <span className="cr-tags"><span>{chain}</span>{viaClanker ? <span className="g">Fees to you in {native}</span> : <span className={fee === "burn" ? "o" : "g"}>{fee === "burn" ? "Buyback & burn" : "Fees to you"}</span>}</span>
                </span>
              </div>
              <div className="cr-set"><div className="cr-lbl">Chain <span>{chain === "Base" ? "most apps and wallets support it" : "one per coin"}</span></div>
                <div className="cr-sg">{CHAINS.map(({ name: n, color: col }) => <button key={n} type="button" className={chain === n ? "on" : ""} onClick={() => setChain(n)}><span className="dot" style={{ width: 8, height: 8, background: col }} />{n}</button>)}</div>
              </div>

              {viaClanker ? (
                <div className="cr-set"><div className="cr-lbl">Your 50% of trading fees <span>from every trade, in any app or bot, paid in {native}</span></div></div>
              ) : (
                <div className="cr-set"><div className="cr-lbl">Your 30% of trading fees <span>{fee === "burn" ? "buys your coin back and burns it" : "from every trade, in any app"}</span></div>
                  <div className="cr-sg"><button type="button" className={fee === "you" ? "on" : ""} onClick={() => setFee("you")}>To you</button><button type="button" className={fee === "burn" ? "on" : ""} onClick={() => setFee("burn")}><IFire size={14} color="var(--burn)" />Buyback &amp; burn</button></div>
                </div>
              )}
              <div className="cr-set"><div className="cr-lbl">Your first buy <span>at least $5 · makes the first trade</span></div>
                <div className="cr-chips">{[5, 10, 25, 50, 100].map((v) => <button key={v} type="button" className={first === v && !firstTxt ? "on" : ""} onClick={() => { setFirst(v); setFirstTxt(""); }}>${v}</button>)}</div>
                <label className="amt-field" htmlFor="first-amt">
                  <span className="mono dim">$</span>
                  <input id="first-amt" inputMode="decimal" placeholder="Other amount" value={firstTxt}
                    onChange={(e) => { const v = e.target.value.replace(/[^0-9.]/g, "").replace(/(\..*)\./g, "$1").slice(0, 8); setFirstTxt(v); setFirst(Math.min(500, Math.round((Number(v) || 0) * 100) / 100)); }} />
                  {firstTxt !== "" && first < 5 && <span className="down" style={{ fontSize: 12, whiteSpace: "nowrap" }}>min $5</span>}
                  <span className="mono dim" style={{ fontSize: 12 }}>USDC</span>
                </label>
              </div>
              <div className="cr-set"><div className="cr-lbl">Boost <span>Get seen first: top of ArkhamPad</span></div>
                <div className="cr-sg cr-boost">
                  <button type="button" className={boost === "none" ? "on" : ""} onClick={() => setBoost("none")}>No boost</button>
                  <button type="button" className={boost === "10" ? "on" : ""} onClick={() => setBoost("10")}><em>Most popular</em>6h · $10</button>
                  <button type="button" className={boost === "20" ? "on" : ""} onClick={() => setBoost("20")}>24h · $20</button>
                </div>
              </div>
              <div className="cr-facts">
                {viaClanker
                  ? <span>Opens at a <b className="mono">$4.8K</b> market cap in a locked Uniswap pool, paired with {native}</span>
                  : LIVE
                  ? <span>Opens at a <b className="mono">$2K</b> market cap in a locked Uniswap pool</span>
                  : <span>Opens at a <b className="mono">$450</b> market cap in a Uniswap pool <span className="dim">(testnet; $2K on mainnet)</span></span>}
                <span>Liquidity locked forever. Nobody can pull it, not even us.</span>
                {viaClanker
                  ? <span>Launched through Clanker: DexScreener, GMGN and trading bots see it the moment it&apos;s live.</span>
                  : <span>Tradable in other apps from the first trade.</span>}
                {viaClanker
                  ? <span>Sniper protection: bots that buy in the first moments pay up to <b className="mono">66%</b> fees, and half of that goes to you. Then every trade pays <b className="mono">1%</b>.</span>
                  : <span>Launch fee protects you from bots: <b className="mono">{launchSchedule(chainId).start}%</b> falling to <b className="mono">2%</b> in {launchSchedule(chainId).decay === 300 ? "five" : "two"} minutes.</span>}
                <span>{LIVE ? "Your cash" : `Your ${dollarOf(chainId)} on ${chain}`}: <b className="mono">{w.signedIn ? `$${cash.toFixed(2)}` : "—"}</b></span>
              </div>
            </div>
          )}
        </div>

        <aside className="cr-side hide-m">
          <div className="card" style={{ borderRadius: 20, gap: 12 }}>
            <span className="mono" style={{ fontSize: 11, color: "var(--faint)" }}>Live preview</span>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>{pic(64, 18)}<span style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}><span style={{ fontWeight: 900, fontSize: 20, overflowWrap: "anywhere" }}>{name || "Your coin"}</span><span className="mono dim" style={{ fontSize: 12 }}>${tick || "TICKER"} · {chain}</span></span></div>
            {desc && <p className="muted" style={{ margin: 0, fontSize: 13, lineHeight: 1.5 }}>{desc}</p>}
            <div className="cr-tags"><span>{chain}</span>{viaClanker ? <span className="g">Fees to you in {native}</span> : <span className={fee === "burn" ? "o" : "g"}>{fee === "burn" ? "Buyback & burn" : "Fees to you"}</span>}{boost !== "none" && <span className="g">Boost {boost === "10" ? "6h" : "24h"}</span>}{first > 0 && <span>First buy ${first}</span>}</div>
            <span style={{ fontSize: 12, color: "var(--faint)" }}>You review everything before it goes live.</span>
          </div>
        </aside>
      </div>

      <div className="cr-foot">
        {step > 0 && <button type="button" className="btn cr-back" onClick={() => go(step - 1)} disabled={!!busy}>Back</button>}
        <button type="button" className="btn volt cr-next" onClick={next} disabled={!!busy || (step === 0 && thinking)}>{step === 2 && !busy && <IRocket size={17} color="#0A0B10" w={2.4} />}{nextLabel}</button>
      </div>
    </div>
  );
}

/** DexScreener chain slugs for the chains ArkhamPad runs on (mainnets only; testnets aren't listed). */
const DEX_SLUG: Record<number, string> = { 8453: "base", 4663: "robinhood", 56: "bsc" };
export default function CreatePage() { return <Suspense fallback={<div className="wrap page" />}><CreateView /></Suspense>; }
