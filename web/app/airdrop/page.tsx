"use client";
import { useEffect } from "react";

// The airdrop points page is closed. Anyone arriving from an old link goes to the front page.
export default function Airdrop() {
  useEffect(() => { window.location.replace("/"); }, []);
  return (
    <div className="wrap page">
      <p className="dim">Redirecting…</p>
    </div>
  );
}
