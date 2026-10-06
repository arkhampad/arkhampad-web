"use client";
// Chart for coins on other DEXs, drawn with our own chart (same look, colours and number format
// as every other chart on the site). Candles come from GeckoTerminal; their embed is the fallback.
import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { Intervals } from "./trade";
import type { Candle } from "@/lib/live";

const TvChart = dynamic(() => import("./tvchart"), { ssr: false, loading: () => <div className="skel" style={{ height: 300, borderRadius: 12 }} /> });

const TF: Record<string, [string, number]> = { "1m": ["minute", 1], "5m": ["minute", 5], "15m": ["minute", 15], "1h": ["hour", 1], "4h": ["hour", 4], "1d": ["day", 1] };
const cache = new Map<string, { at: number; c: Candle[] }>();

async function gtCandles(network: string, pool: string, token: string | undefined, iv: string): Promise<Candle[]> {
  const [tf, agg] = TF[iv] ?? TF["15m"];
  const key = `${network}:${pool}:${token}:${iv}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 20_000) return hit.c;
  const q = `aggregate=${agg}&limit=300&currency=usd${token ? `&token=${token}` : ""}`;
  const r = await fetch(`https://api.geckoterminal.com/api/v2/networks/${network}/pools/${pool}/ohlcv/${tf}?${q}`, { headers: { accept: "application/json" } });
  if (!r.ok) throw new Error(String(r.status));
  const j = await r.json();
  const list: number[][] = j?.data?.attributes?.ohlcv_list ?? [];
  const c = list.map(([t, o, h, l, cl, v]) => ({ t, o, h, l, c: cl, v })).sort((a, b) => a.t - b.t);
  cache.set(key, { at: Date.now(), c });
  return c;
}

export default function ExtChart({ network, pool, token, supply, height = 420 }: { network: string | null | undefined; pool: string | null | undefined; token?: string; supply?: number | null; height?: number }) {
  const [iv, setIv] = useState("15m");
  const [candles, setCandles] = useState<Candle[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [light, setLight] = useState(false);
  useEffect(() => {
    const read = () => setLight(document.documentElement.dataset.theme === "light");
    read();
    const mo = new MutationObserver(read);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => mo.disconnect();
  }, []);
  useEffect(() => {
    if (!network || !pool) return;
    let alive = true;
    setCandles(null); setFailed(false);
    const load = () => gtCandles(network, pool, token, iv).then((c) => { if (alive) { setCandles(c); setFailed(c.length === 0); } }).catch(() => { if (alive) setFailed(true); });
    load();
    const t = setInterval(load, 30_000);
    return () => { alive = false; clearInterval(t); };
  }, [network, pool, token, iv]);

  if (!network || !pool) {
    return <div className="tv-box" style={{ ["--tv-h" as string]: `${height}px`, display: "flex", alignItems: "center", justifyContent: "center" }}><span className="dim" style={{ fontSize: 14 }}>Chart is not available for this coin yet.</span></div>;
  }
  if (failed) {
    // fallback: the DEX's own embed
    const theme = light ? "light" : "dark";
    const src = `https://www.geckoterminal.com/${network}/pools/${pool}?embed=1&info=0&swaps=0&grayscale=0&light_chart=${light ? 1 : 0}&chart_type=market_cap&resolution=15m`;
    return (
      <div className="tv-box" style={{ ["--tv-h" as string]: `${height}px`, borderRadius: 12, overflow: "hidden", background: "var(--bg2)" }} data-theme-chart={theme}>
        <iframe key={src} src={src} title="Price chart" loading="lazy" referrerPolicy="no-referrer" style={{ width: "100%", height: "100%", border: 0, display: "block" }} />
      </div>
    );
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <Intervals value={iv} onChange={setIv} />
      <TvChart candles={candles} supply={supply && Number.isFinite(supply) && supply > 0 ? supply : null} height={height} empty="Loading chart…" seriesKey={`${pool}|${iv}`} />
    </div>
  );
}
