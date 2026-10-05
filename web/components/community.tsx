"use client";
// Invite link capture (?ref=) and holder-only coin comments.
import Link from "next/link";
import { useEffect, useState } from "react";
import { useApp } from "./shell";
import { useWallet } from "./wallet";
import { TradeError, accountAction } from "@/lib/chain";
import { ago, short, type LiveCoin } from "@/lib/live";
import { commentsOf, translate, type Comment } from "@/lib/insights";
import { looksForeign } from "@/lib/moderation";

/** Remembers who invited this visitor and links them once they log in. */
export function RefLinker() {
  const w = useWallet();
  useEffect(() => {
    try {
      const ref = new URLSearchParams(location.search).get("ref");
      if (ref && /^0x[0-9a-fA-F]{40}$/.test(ref) && !localStorage.getItem("ap_ref")) localStorage.setItem("ap_ref", ref.toLowerCase());
    } catch { /* storage off */ }
  }, []);
  useEffect(() => {
    if (!w.signer || !w.address) return;
    let ref: string | null = null;
    try { ref = localStorage.getItem("ap_ref"); if (localStorage.getItem("ap_ref_done") === w.address.toLowerCase()) return; } catch { return; }
    if (!ref || ref === w.address.toLowerCase()) return;
    accountAction("ref.set", { referrer: ref }, w.signer).catch(() => {}).finally(() => { try { localStorage.setItem("ap_ref_done", w.address!.toLowerCase()); } catch { /* storage off */ } });
  }, [w.signer, w.address]);
  return null;
}

const userLang = () => (typeof navigator !== "undefined" ? navigator.language || "en" : "en").slice(0, 2).toLowerCase();

function CommentBody({ m }: { m: Comment }) {
  const [tr, setTr] = useState<{ text: string; from: string } | null>(null);
  const [on, setOn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [fail, setFail] = useState(false);
  const [lang, setLang] = useState("en");
  useEffect(() => { setLang(userLang()); }, []);
  const show = looksForeign(m.body, lang);
  const go = async () => {
    if (on) { setOn(false); return; }
    if (tr) { setOn(true); return; }
    setBusy(true); setFail(false);
    const r = await translate(m.body, lang);
    setBusy(false);
    if (r) { setTr(r); setOn(true); } else setFail(true);
  };
  return (
    <>
      <span style={{ fontSize: 14, lineHeight: 1.5, overflowWrap: "anywhere", whiteSpace: "pre-wrap" }}>{on && tr ? tr.text : m.body}</span>
      {on && tr?.from && <span style={{ fontSize: 11, color: "var(--faint)" }}>Translated from {tr.from}</span>}
      {show && <button type="button" className="linkbtn" style={{ marginTop: 0, fontSize: 12, minHeight: 26 }} onClick={go} disabled={busy}>{busy ? "Translating…" : on ? "Show original" : fail ? "Try translating again" : "Translate"}</button>}
    </>
  );
}

export function Comments({ c }: { c: LiveCoin }) {
  const w = useWallet();
  const { toast } = useApp();
  const [list, setList] = useState<Comment[] | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const load = () => commentsOf(c.chainId, c.address).then(setList).catch(() => setList([]));
  useEffect(() => { load(); const iv = setInterval(load, 20_000); return () => clearInterval(iv); }, [c.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const send = async () => {
    if (!w.signedIn || !w.signer) { w.login(); return; }
    setBusy(true);
    try {
      const r = await accountAction("comment.add", { chainId: c.chainId, coin: c.address, body: text }, w.signer);
      setText(""); await load();
      if (r?.hidden) toast("Posted, but hidden from others: it looks like a scam or spam.");
    }
    catch (e) { toast(e instanceof TradeError ? e.message : "Couldn't post. Please try again."); } finally { setBusy(false); }
  };
  const del = async (id: string) => { if (!w.signer) return; try { await accountAction("comment.delete", { id }, w.signer); await load(); } catch { toast("Couldn't delete it."); } };
  const me = w.address?.toLowerCase();
  const [showHidden, setShowHidden] = useState(false);
  const visible = (list ?? []).filter((m) => !m.hidden || m.user === me);
  const hiddenList = (list ?? []).filter((m) => m.hidden && m.user !== me);
  return (
    <div className="panel" style={{ gap: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}><span style={{ fontWeight: 700 }}>Holders chat</span><span className="dim" style={{ fontSize: 12 }}>Only holders can post</span></div>
      <div style={{ display: "flex", gap: 8 }}>
        <input className="inp" aria-label="Write a comment" placeholder={w.signedIn ? "Say something to other holders…" : "Log in to join the chat"} value={text} maxLength={280} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && text.trim()) send(); }} style={{ flex: 1 }} />
        <button type="button" className="btn volt" disabled={busy || (w.signedIn && text.trim().length < 2)} onClick={send}>{busy ? "…" : "Post"}</button>
      </div>
      {list === null ? <div className="skel" style={{ height: 80, borderRadius: 12 }} /> : visible.length === 0 && hiddenList.length === 0 ? <span className="dim" style={{ fontSize: 13 }}>No comments yet. Holders can start the conversation.</span> :
        visible.map((m) => (
          <div key={m.id} style={{ display: "flex", flexDirection: "column", gap: 4, padding: "8px 0", borderTop: "1px solid var(--row)" }}>
            <span style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
              <Link href={`/trader/?a=${m.user}`} className="mono" style={{ fontWeight: 700 }}>{short(m.user)}</Link>
              {c.creator && m.user === c.creator.toLowerCase() ? <span className="pill" style={{ fontSize: 10, padding: "1px 6px" }}>creator</span> : m.holder_pct != null && m.holder_pct > 0 ? <span className="mono dim" style={{ fontSize: 11 }}>holds {m.holder_pct < 0.01 ? "<0.01" : m.holder_pct.toFixed(2)}%</span> : null}
              <span className="mono dim" style={{ fontSize: 11, marginLeft: "auto" }}>{ago(m.created_at)}</span>
              {me === m.user && <button type="button" className="dim" style={{ background: "none", border: 0, fontSize: 11, cursor: "pointer" }} onClick={() => del(m.id)}>Delete</button>}
            </span>
            {m.hidden && me === m.user && <span style={{ fontSize: 11, color: "var(--warn-ink)" }}>Only you can see this. It was hidden as possible spam{m.hidden_reason ? ` (${m.hidden_reason})` : ""}.</span>}
            <CommentBody m={m} />
          </div>
        ))}
      {hiddenList.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, borderTop: "1px solid var(--row)", paddingTop: 8 }}>
          <div className="spambar">
            <span>{hiddenList.length} comment{hiddenList.length === 1 ? "" : "s"} hidden as possible scam or spam</span>
            <button type="button" className="linkbtn" style={{ marginTop: 0 }} onClick={() => setShowHidden(!showHidden)}>{showHidden ? "Hide" : "Show"}</button>
          </div>
          {showHidden && hiddenList.map((m) => (
            <div key={m.id} className="spamtxt">
              <span className="mono dim" style={{ fontSize: 11 }}>{short(m.user)} · {ago(m.created_at)}</span>
              <span style={{ overflowWrap: "anywhere", whiteSpace: "pre-wrap" }}>{m.body}</span>
              <b style={{ fontSize: 11, color: "var(--down)" }}>Hidden as possible spam{m.hidden_reason ? ` (${m.hidden_reason})` : ""}. Never share your seed phrase or send funds to strangers.</b>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
