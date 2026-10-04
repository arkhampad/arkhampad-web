"use client";
// Invite link capture (?ref=) and holder-only coin comments.
import Link from "next/link";
import { useEffect, useState } from "react";
import { useApp } from "./shell";
import { useWallet } from "./wallet";
import { TradeError, accountAction } from "@/lib/chain";
import { ago, short, type LiveCoin } from "@/lib/live";
import { commentsOf, type Comment } from "@/lib/insights";

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
    try { await accountAction("comment.add", { chainId: c.chainId, coin: c.address, body: text }, w.signer); setText(""); await load(); }
    catch (e) { toast(e instanceof TradeError ? e.message : "Couldn't post. Please try again."); } finally { setBusy(false); }
  };
  const del = async (id: string) => { if (!w.signer) return; try { await accountAction("comment.delete", { id }, w.signer); await load(); } catch { toast("Couldn't delete it."); } };
  const me = w.address?.toLowerCase();
  return (
    <div className="panel" style={{ gap: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}><span style={{ fontWeight: 700 }}>Holders chat</span><span className="dim" style={{ fontSize: 12 }}>Only holders can post</span></div>
      <div style={{ display: "flex", gap: 8 }}>
        <input className="inp" aria-label="Write a comment" placeholder={w.signedIn ? "Say something to other holders…" : "Log in to join the chat"} value={text} maxLength={280} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && text.trim()) send(); }} style={{ flex: 1 }} />
        <button type="button" className="btn volt" disabled={busy || (w.signedIn && text.trim().length < 2)} onClick={send}>{busy ? "…" : "Post"}</button>
      </div>
      {list === null ? <div className="skel" style={{ height: 80, borderRadius: 12 }} /> : list.length === 0 ? <span className="dim" style={{ fontSize: 13 }}>No comments yet. Holders can start the conversation.</span> :
        list.map((m) => (
          <div key={m.id} style={{ display: "flex", flexDirection: "column", gap: 4, padding: "8px 0", borderTop: "1px solid var(--row)" }}>
            <span style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
              <Link href={`/trader/?a=${m.user}`} className="mono" style={{ fontWeight: 700 }}>{short(m.user)}</Link>
              {c.creator && m.user === c.creator.toLowerCase() ? <span className="pill" style={{ fontSize: 10, padding: "1px 6px" }}>creator</span> : m.holder_pct != null && m.holder_pct > 0 ? <span className="mono dim" style={{ fontSize: 11 }}>holds {m.holder_pct < 0.01 ? "<0.01" : m.holder_pct.toFixed(2)}%</span> : null}
              <span className="mono dim" style={{ fontSize: 11, marginLeft: "auto" }}>{ago(m.created_at)}</span>
              {me === m.user && <button type="button" className="dim" style={{ background: "none", border: 0, fontSize: 11, cursor: "pointer" }} onClick={() => del(m.id)}>Delete</button>}
            </span>
            <span style={{ fontSize: 14, lineHeight: 1.5, overflowWrap: "anywhere", whiteSpace: "pre-wrap" }}>{m.body}</span>
          </div>
        ))}
    </div>
  );
}
