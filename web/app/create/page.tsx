"use client";
import Link from "next/link";
import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { FrogArt } from "@/components/bits";
import { ICopy, IFire, IGlobe, IRocket, ISpark, IX } from "@/components/icons";
import { useApp } from "@/components/shell";
import { coinText, downloadCard, openX, prepareCard, shareCoinCard, type ShareCoin } from "@/lib/share";
import { useWallet } from "@/components/wallet";
import { FEE, NETS, TradeError, fromUsdc, launch, promote, toUsdc, uploadCoinImage } from "@/lib/chain";

const PALETTE = [["#1B1F6B", "#7C5CFF"], ["#0B3B2E", "#2BB38A"], ["#3B1B0B", "#FF8A3D"]];
const OPTS0 = [
  { name: "Moonfrog", tick: "MFROG", desc: "An astronaut frog who only buys the dip. Floating in orbit, waiting for red candles.", c1: "#1B1F6B", c2: "#7C5CFF" },
  { name: "Dip Hopper", tick: "HOPPR", desc: "A space frog that hops in every time the chart dips. Never sleeps, never sells.", c1: "#0B3B2E", c2: "#2BB38A" },
  { name: "Orbit Toad", tick: "OTOAD", desc: "Zero gravity, zero panic. This toad buys dips from low orbit.", c1: "#3B1B0B", c2: "#FF8A3D" },
];
const Step = ({ n, t }: { n: number; t: string }) => (
  <div style={{ display: "flex", alignItems: "center", gap: 10 }}><span className="mono" style={{ width: 26, height: 26, borderRadius: 8, background: "var(--volt)", color: "var(--on-volt)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 13 }}>{n}</span><span style={{ fontWeight: 800, fontSize: 18, letterSpacing: -0.3 }}>{t}</span></div>
);
const Label = ({ t, sub }: { t: string; sub?: string }) => <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}><span style={{ fontWeight: 700, fontSize: 14 }}>{t}</span>{sub && <span style={{ fontSize: 12, color: "var(--faint)" }}>{sub}</span>}</div>;

function CreateView() {
  const q = useSearchParams();
  const { toast, openFunds } = useApp();
  const [idea, setIdea] = useState(q.get("idea") || "A frog astronaut who only buys the dip");
  const [pick, setPick] = useState(0);
  const [OPTS, setOpts] = useState(OPTS0);
  const [thinking, setThinking] = useState(false);
  const [drawing, setDrawing] = useState(false);
  const [name, setName] = useState(OPTS0[0].name);
  const [tick, setTick] = useState(OPTS0[0].tick);
  const [desc, setDesc] = useState(OPTS0[0].desc);
  // networks come from the site config (testnet: Robinhood + Base; mainnet adds more)
  const CHAINS = NETS.map((n) => ({ id: n.id, name: n.short, color: n.short === "Robinhood" ? "var(--rh)" : n.short === "Base" ? "var(--base)" : n.short === "BNB" ? "#F0B90B" : "var(--volt)" }));
  const [chain, setChain] = useState(CHAINS.find((c) => c.name === "Base")?.name ?? CHAINS[0].name);
  const [lock, setLock] = useState("Lock 24h");
  const [fee, setFee] = useState("burn");
  const [boost, setBoost] = useState("none");
  const [first, setFirst] = useState(0);
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
  const cash = fromUsdc(w.usdc[chainId] ?? 0n);
  const need = first + (boost === "none" ? 0 : Number(boost)) + fromUsdc(FEE) * (boost === "none" ? 1 : 2);
  const o = OPTS[pick];
  const choose = (i: number, list = OPTS) => { setPick(i); setName(list[i].name); setTick(list[i].tick); setDesc(list[i].desc); };

  // AI: one sentence (any language) -> three ready coins
  const generate = async (text = idea) => {
    if (!text.trim()) { toast("Describe your coin in a few words."); return; }
    setThinking(true);
    try {
      const r = await fetch("/api/ideas", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ idea: text }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !Array.isArray(j.options) || !j.options.length) throw new Error(j.error || "AI is busy, please try again.");
      const list = j.options.slice(0, 3).map((o: { name: string; ticker: string; description: string }, i: number) => ({ name: o.name, tick: o.ticker, desc: o.description, c1: PALETTE[i][0], c2: PALETTE[i][1] }));
      setOpts(list);
      choose(0, list);
      setImgFile(null); setImgPreview(null);
    } catch (e) { toast((e as Error).message || "AI is busy, please try again."); } finally { setThinking(false); }
  };
  // AI image for the chosen coin
  const drawImage = async () => {
    setDrawing(true);
    try {
      const r = await fetch("/api/image", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, description: desc }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.dataUrl) throw new Error(j.error || "Couldn't draw an image right now.");
      const blob = await (await fetch(j.dataUrl)).blob();
      setImgFile(new File([blob], "coin.png", { type: blob.type || "image/png" }));
      setImgPreview(j.dataUrl);
    } catch (e) { toast((e as Error).message); } finally { setDrawing(false); }
  };
  const autoRan = useRef(false);
  useEffect(() => { if (!autoRan.current && q.get("idea")) { autoRan.current = true; generate(q.get("idea") || ""); } }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const ca = done?.coin ?? "";
  const coinUrl = done ? `https://arkhampad.com/coin/?c=${done.chainId}-${done.coin}` : "";
  const shareObj: ShareCoin = { name, tick, chain, mc: "$450", chg: 0, address: ca, id: done ? `${done.chainId}-${done.coin.toLowerCase()}` : "", c1: o.c1, c2: o.c2, own: true };
  const post = coinText(shareObj, { launched: true }).replace(/\nMarket cap.*\n/, "\n") + (desc ? `\n\n${desc.trim().slice(0, 140)}` : "");
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
    if (!/^[A-Z0-9]{1,10}$/.test(tk)) return toast("Ticker must be 1 to 10 letters or numbers.");
    if (desc.length > 280) return toast("Keep the description under 280 characters.");
    if (cash < need) { toast(`You need $${need.toFixed(2)} USDC on ${chain}. Add test USDC first.`); openFunds("deposit"); return; }
    const meta = JSON.stringify({ description: desc.trim().slice(0, 280), x: xUrl.trim().slice(0, 100) || undefined, telegram: tgUrl.trim().slice(0, 100) || undefined, website: webUrl.trim().slice(0, 100) || undefined, art: { c1: o.c1, c2: o.c2 } });
    const metadataURI = `data:application/json;base64,${btoa(unescape(encodeURIComponent(meta)))}`;
    try {
      setBusy("Launching…");
      const lockSeconds = lock === "Lock 24h" ? 86400 : lock === "Lock 1h" ? 3600 : 0;
      const r = await launch(chainId, { name: nm, symbol: tk, metadataURI, lockSeconds, feeMode: fee === "burn" ? 1 : 0, launchUsdc: toUsdc(first) }, w.signer);
      if (imgFile) {
        setBusy("Adding image…");
        // the indexer needs a moment to see the new coin before the image can be attached
        for (let i = 0; i < 6; i++) {
          try { await uploadCoinImage(chainId, r.coin, imgFile, w.signer); break; }
          catch (e) { if (i === 5 || !(e instanceof TradeError) || !/not found yet/i.test(e.message)) { toast(`Coin is live, but the image failed: ${(e as Error).message}`); break; } await new Promise((res) => setTimeout(res, 2500)); }
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

  return (
    <div className="wrap page" style={{ maxWidth: 1240, paddingBottom: 150 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
        <h1 style={{ margin: 0, fontSize: "clamp(24px, 3vw, 32px)", fontWeight: 900, letterSpacing: -0.8 }}>One sentence. One coin.</h1>
        <p className="h-sub" style={{ fontSize: 14 }}>Any language. AI makes the name, ticker, story and image.</p>
      </div>
      <div className="row">
        <div className="main-col card" style={{ background: "var(--card)", borderRadius: 22, padding: 16, gap: 12 }}>
          <Step n={1} t="Describe it" />
          <label htmlFor="cidea" className="sr">Describe your coin in any language</label>
          <div style={{ borderRadius: 14, background: "var(--bg)", border: "1px solid var(--line3)", padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
            <textarea id="cidea" rows={2} value={idea} onChange={(e) => setIdea(e.target.value)} style={{ resize: "none", background: "transparent", border: 0, outline: "none", fontSize: 16, fontWeight: 500, lineHeight: 1.5 }} />
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <span className="pill mono" style={{ background: "var(--raise)", color: "var(--muted)", fontSize: 11 }}><IGlobe size={12} />Any language → English coin</span>
              <button type="button" className="btn volt" disabled={thinking} onClick={() => generate()}><ISpark size={15} color="#0A0B10" />{thinking ? "Thinking…" : "Generate with AI"}</button>
            </div>
          </div>
          <div className="grid3" style={{ gap: 8 }}>
            {OPTS.map((x, i) => (
              <button key={i} type="button" onClick={() => choose(i)} style={{ textAlign: "left", display: "flex", alignItems: "center", gap: 10, padding: 10, borderRadius: 14, border: pick === i ? "2px solid var(--volt)" : "1px solid var(--line2)", background: pick === i ? "rgba(212,255,58,0.06)" : "var(--bg)", minWidth: 0 }}>
                <span style={{ width: 52, height: 52, borderRadius: 12, overflow: "hidden", flex: "none" }}><FrogArt c1={x.c1} c2={x.c2} /></span>
                <span style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                  <span style={{ fontWeight: 800, fontSize: 14, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{x.name}</span>
                  <span className="mono volt" style={{ fontWeight: 700, fontSize: 11 }}>${x.tick}</span>
                </span>
              </button>
            ))}
          </div>
          <div style={{ height: 1, background: "var(--line)" }} />
          <Step n={2} t="Make it yours" />
          <div className="grid2" style={{ gap: 8 }}>
            <div className="field"><label htmlFor="cn">Name</label><input id="cn" className="inp" value={name} maxLength={32} onChange={(e) => setName(e.target.value)} /></div>
            <div className="field"><label htmlFor="ct">Ticker</label><input id="ct" className="inp mono" value={tick} maxLength={10} onChange={(e) => setTick(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))} /></div>
          </div>
          <div className="field"><label htmlFor="cd">Description</label><textarea id="cd" rows={2} className="inp" value={desc} onChange={(e) => setDesc(e.target.value)} /></div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) { setImgFile(f); setImgPreview(URL.createObjectURL(f)); } }} />
            <button type="button" className="btn ghost sm" disabled={drawing} onClick={drawImage}><ISpark size={14} color="var(--volt-ink)" />{drawing ? "Drawing…" : imgFile ? "New AI image" : "AI image"}</button>
            <button type="button" className="btn ghost sm" onClick={() => fileRef.current?.click()}>{imgFile ? "Change image" : "Upload image"}</button>
            {imgFile && <button type="button" className="btn ghost sm" onClick={() => { setImgFile(null); setImgPreview(null); }}>Remove image</button>}
            <button type="button" className="btn ghost sm" aria-expanded={links} onClick={() => setLinks(!links)}>{links ? "Hide links" : "+ Add links (optional)"}</button>
          </div>
          {links && (
            <div className="grid3" style={{ gap: 8 }}>
              <div className="field"><label htmlFor="cx">X</label><input id="cx" className="inp" placeholder="x.com/yourcoin" value={xUrl} onChange={(e) => setXUrl(e.target.value)} /></div>
              <div className="field"><label htmlFor="ctg">Telegram</label><input id="ctg" className="inp" placeholder="t.me/yourcoin" value={tgUrl} onChange={(e) => setTgUrl(e.target.value)} /></div>
              <div className="field"><label htmlFor="cw">Website</label><input id="cw" className="inp" placeholder="yourcoin.com" value={webUrl} onChange={(e) => setWebUrl(e.target.value)} /></div>
            </div>
          )}
          <div style={{ height: 1, background: "var(--line)" }} />
          <Step n={3} t="Launch settings" />
          <div className="grid2" style={{ gap: 14 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <Label t="Chain" sub="pick one" />
          <div className="grid2 keep" style={{ gap: 8 }}>
            {CHAINS.map(({ name: n, color: col }) => (
              <button key={n} type="button" onClick={() => setChain(n)} className="seg" style={{ height: 46, borderRadius: 12, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, fontWeight: 700, fontSize: 14, border: chain === n ? `2px solid ${col}` : undefined }}><span className="dot" style={{ width: 10, height: 10, background: col }} />{n}</button>
            ))}
          </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <Label t="Creator lock" sub="shows buyers you won't dump" />
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>{["No lock", "Lock 1h", "Lock 24h"].map((t) => <button key={t} type="button" className={`seg${lock === t ? " on" : ""}`} onClick={() => setLock(t)}>{t}</button>)}</div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <Label t="Creator fees" />
          <div className="grid2 keep" style={{ gap: 8 }}>
            <button type="button" onClick={() => setFee("you")} style={{ textAlign: "left", padding: 10, borderRadius: 12, border: fee === "you" ? "1px solid var(--volt)" : "1px solid var(--line2)", background: fee === "you" ? "rgba(212,255,58,0.08)" : "transparent", display: "flex", flexDirection: "column", gap: 4 }}><span style={{ fontWeight: 700, fontSize: 14 }}>To you</span><span className="dim" style={{ fontSize: 12, lineHeight: 1.4 }}>Creator fees go to your balance.</span></button>
            <button type="button" onClick={() => setFee("burn")} style={{ textAlign: "left", padding: 10, borderRadius: 12, border: fee === "burn" ? "1px solid var(--burn)" : "1px solid var(--line2)", background: fee === "burn" ? "rgba(255,138,61,0.08)" : "transparent", display: "flex", flexDirection: "column", gap: 4 }}><span style={{ fontWeight: 700, fontSize: 14, display: "flex", gap: 6, alignItems: "center" }}><IFire size={14} color="var(--burn)" />Buyback &amp; burn</span><span className="dim" style={{ fontSize: 12, lineHeight: 1.4 }}>Fees buy your coin and burn it.</span></button>
          </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <Label t="Boost" sub="optional" />
          <div className="grid3" style={{ gap: 8, gridTemplateColumns: "repeat(3, minmax(0,1fr))" }}>
            {[["none", "No boost", ""], ["10", "$10", "6 hours on top"], ["20", "$20", "24 hours on top"]].map(([k, a, b]) => (
              <button key={k} type="button" onClick={() => setBoost(k)} className={`seg${boost === k ? " on" : ""}`} style={{ height: 52, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 2, minWidth: 0 }}><span className={b ? "mono" : ""} style={{ fontWeight: 700, fontSize: b ? 15 : 13 }}>{a}</span>{b && <span className="dim" style={{ fontSize: 11 }}>{b}</span>}</button>
            ))}
          </div>
            </div>
          </div>
        </div>
        <aside className="side-col" style={{ position: "sticky", top: 90 }}>
          <div className="card" style={{ borderRadius: 22, borderColor: "var(--line2)", gap: 14 }}>
            <span className="mono" style={{ fontSize: 11, color: "var(--faint)" }}>Live preview</span>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}><span style={{ width: 64, height: 64, borderRadius: 18, overflow: "hidden", flex: "none" }}>{imgPreview ? <img src={imgPreview} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <FrogArt c1={o.c1} c2={o.c2} />}</span><span style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}><span style={{ fontWeight: 900, fontSize: 20, overflow: "hidden", textOverflow: "ellipsis" }}>{name || "Your coin"}</span><span className="mono dim" style={{ fontWeight: 600, fontSize: 13 }}>{tick || "TICKER"} · {chain}</span></span></div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {lock !== "No lock" && <span className="pill volt" style={{ background: "rgba(212,255,58,0.10)" }}>Dev locked {lock.replace("Lock ", "")}</span>}
              <span className="pill" style={{ background: fee === "burn" ? "rgba(255,138,61,0.12)" : "rgba(61,220,151,0.12)", color: fee === "burn" ? "var(--burn)" : "var(--up)" }}>{fee === "burn" ? "Buyback & burn" : "Fees to creator"}</span>
            </div>
            {[["Starts at", "$450 market cap (testnet)"], ["Graduates at", "$750 (testnet)"], ["Your USDC on " + chain, w.signedIn ? `$${cash.toFixed(2)}` : "—"]].map(([a, b]) => <div key={a} style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}><span className="dim">{a}</span><span className="mono">{b}</span></div>)}
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}><span className="dim">Launch cost</span><span className="mono up">{boost === "none" ? "Free" : `$${boost} boost`}</span></div>
            <span className="dim" style={{ fontSize: 13 }}>Be the first buyer (optional)</span>
            <div style={{ display: "flex", gap: 6 }}>{[0, 10, 25, 50].map((v) => <button key={v} type="button" className={`seg mono${first === v ? " on" : ""}`} style={{ height: 38, minWidth: 0 }} onClick={() => setFirst(v)}>${v}</button>)}</div>
            <button type="button" className="btn volt lg hide-m" style={{ fontSize: 17, fontWeight: 900 }} onClick={launchNow} disabled={!!busy}><IRocket size={18} color="#0A0B10" w={2.4} />{busy || (w.signedIn ? `Launch ${name || "coin"}` : "Log in to launch")}</button>
            <span className="hide-m" style={{ fontSize: 12, color: "var(--faint)", textAlign: "center" }}>You review everything before it goes live.</span>
          </div>
        </aside>
      </div>
      <div className="show-m" style={{ position: "fixed", left: 0, right: 0, bottom: "calc(74px + var(--safe-bottom))", zIndex: 25, padding: "10px 16px", background: "var(--bar-bg)", borderTop: "1px solid var(--line)" }}>
        <button type="button" className="btn volt lg" style={{ width: "100%", fontWeight: 900 }} onClick={launchNow} disabled={!!busy}>{busy || (w.signedIn ? `Launch ${name || "coin"} · ${boost === "none" ? "Free" : `$${boost}`}` : "Log in to launch")}</button>
      </div>
    </div>
  );
}
export default function CreatePage() { return <Suspense fallback={<div className="wrap page" />}><CreateView /></Suspense>; }
