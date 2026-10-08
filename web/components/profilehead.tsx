"use client";
// Profile header: picture + display name, both editable by the owner.
import { useRef, useState } from "react";
import { short } from "@/lib/live";
import { traderColors } from "@/lib/traders";
import { NAME_RE, saveAvatar, saveName, useProfile } from "@/lib/profiles";
import { TradeError } from "@/lib/chain";
import { useWallet } from "./wallet";
import { useApp } from "./shell";

export function ProfileHead() {
  const w = useWallet();
  const { toast } = useApp();
  const me = useProfile(w.address);
  const [edit, setEdit] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState("");
  const file = useRef<HTMLInputElement>(null);
  if (!w.address) return null;
  const [c1, c2] = traderColors(w.address);
  const copy = async () => { try { await navigator.clipboard.writeText(w.address as string); toast("Address copied"); } catch { /* blocked */ } };
  const pick = async (f?: File) => {
    if (!f || !w.signer) return;
    setBusy("photo");
    try { await saveAvatar(f, w.signer); toast("Profile picture updated"); }
    catch (e) { toast(e instanceof TradeError ? e.message : "Upload failed, please try again."); }
    finally { setBusy(""); if (file.current) file.current.value = ""; }
  };
  const save = async () => {
    if (!w.signer) return;
    setBusy("name");
    try { await saveName(name, w.signer); setEdit(false); toast("Name saved"); }
    catch (e) { toast(e instanceof TradeError ? e.message : "Couldn't save the name. Please try again."); }
    finally { setBusy(""); }
  };
  const valid = NAME_RE.test(name.trim());
  return (
    <div className="phead">
      <input ref={file} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={(e) => pick(e.target.files?.[0])} />
      <button type="button" className="phead-av" onClick={() => file.current?.click()} disabled={busy === "photo"} aria-label="Change profile picture">
        {me?.avatar ? <img src={me.avatar} alt="" /> : <span style={{ background: `linear-gradient(135deg, ${c1}, ${c2})` }}>{(me?.name || w.address.slice(2, 4)).slice(0, 2).toUpperCase()}</span>}
        <i>{busy === "photo" ? "…" : "Edit"}</i>
      </button>
      {edit ? (
        <form className="phead-edit" onSubmit={(e) => { e.preventDefault(); if (valid) save(); else toast("Use 3-20 letters, numbers, dots or underscores (no spaces)."); }}>
          <label htmlFor="pname" className="sr">Display name</label>
          <input id="pname" className="inp" autoFocus value={name} maxLength={20} placeholder="Your name" onChange={(e) => setName(e.target.value.replace(/\s/g, ""))} />
          <span style={{ display: "flex", gap: 6 }}>
            <button type="submit" className="btn volt sm" disabled={!!busy}>{busy === "name" ? "Saving…" : "Save"}</button>
            <button type="button" className="btn ghost sm" onClick={() => setEdit(false)}>Cancel</button>
          </span>
          <span style={{ fontSize: 11, color: "var(--faint)" }}>3-20 letters, numbers, dots or underscores. Everyone can see it.</span>
        </form>
      ) : (
        <span style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
          <span style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <b style={{ fontSize: 20, overflowWrap: "anywhere" }}>{me?.name || short(w.address)}</b>
            <button type="button" className="btn ghost sm" style={{ height: 30, padding: "0 10px", fontSize: 12 }} onClick={() => { setName(me?.name ?? ""); setEdit(true); }}>{me?.name ? "Edit name" : "Add a name"}</button>
          </span>
          <button type="button" className="mono dim" onClick={copy} style={{ background: "none", border: 0, padding: 0, textAlign: "left", fontSize: 12 }}>{short(w.address)} · Copy address</button>
        </span>
      )}
    </div>
  );
}
