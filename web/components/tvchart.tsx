"use client";
// Price / market-cap chart built on TradingView Lightweight Charts (Apache-2.0).
import { useEffect, useRef, useState } from "react";
import { CandlestickSeries, ColorType, CrosshairMode, HistogramSeries, createChart, type IChartApi, type ISeriesApi, type UTCTimestamp } from "lightweight-charts";
import type { Candle } from "./trade";

const css = (name: string, fallback: string) => (typeof window === "undefined" ? fallback : getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback);
function palette() {
  return { up: css("--up", "#3DDC97"), down: css("--down", "#FF6B6B"), text: css("--dim", "#8A909C"), grid: css("--row", "#15171E"), line: css("--line", "#1B1E25"), cross: css("--line3", "#3A3F4B"), label: css("--raise2", "#1E2129") };
}

function fmt(v: number, mc: boolean): string {
  if (!Number.isFinite(v)) return "";
  if (mc) {
    const a = Math.abs(v);
    if (a >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
    if (a >= 1e6) return `$${(v / 1e6).toFixed(2)}M`;
    if (a >= 1e3) return `$${(v / 1e3).toFixed(1)}K`;
    return `$${v.toFixed(0)}`;
  }
  if (v >= 1) return `$${v.toFixed(v >= 100 ? 2 : 4)}`;
  if (v <= 0) return "$0";
  const zeros = Math.floor(-Math.log10(v));
  return `$${v.toFixed(Math.min(18, zeros + 3))}`;
}

/** `supply` turns prices into market cap (price × supply) for the MC view. */
export default function TvChart({ candles, supply, height = 380, empty = "No trades yet for a chart." }: { candles: Candle[] | null; supply: number | null; height?: number; empty?: string }) {
  const box = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
  const candle = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volume = useRef<ISeriesApi<"Histogram"> | null>(null);
  const lastKey = useRef("");
  const [mc, setMc] = useState(true);
  const mcOk = !!supply && supply > 0;
  const useMc = mc && mcOk;

  // create once
  useEffect(() => {
    if (!box.current) return;
    const p = palette();
    const c = createChart(box.current, {
      autoSize: true,
      localization: { locale: "en-US" },
      layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: p.text, fontFamily: "var(--mono), ui-monospace, monospace", fontSize: 11, attributionLogo: false },
      grid: { vertLines: { color: "var(--line)" }, horzLines: { color: "var(--line)" } },
      crosshair: { mode: CrosshairMode.Normal, vertLine: { color: "#3A3F4B", labelBackgroundColor: "var(--raise2)" }, horzLine: { color: "#3A3F4B", labelBackgroundColor: "var(--raise2)" } },
      rightPriceScale: { borderColor: "var(--line)", scaleMargins: { top: 0.08, bottom: 0.24 } },
      timeScale: { borderColor: "var(--line)", timeVisible: true, secondsVisible: false, rightOffset: 4, barSpacing: 8 },
      handleScale: { axisPressedMouseMove: true, mouseWheel: true, pinch: true },
      handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
    });
    candle.current = c.addSeries(CandlestickSeries, { upColor: p.up, downColor: p.down, borderUpColor: p.up, borderDownColor: p.down, wickUpColor: p.up, wickDownColor: p.down, priceLineVisible: true, priceLineStyle: 2 });
    volume.current = c.addSeries(HistogramSeries, { priceScaleId: "vol", priceFormat: { type: "volume" }, lastValueVisible: false, priceLineVisible: false });
    c.priceScale("vol").applyOptions({ scaleMargins: { top: 0.8, bottom: 0 }, visible: false });
    chart.current = c;
    // follow the light/dark switch
    const mo = new MutationObserver(() => {
      const q = palette();
      c.applyOptions({ layout: { textColor: q.text }, crosshair: { vertLine: { color: q.cross, labelBackgroundColor: q.label }, horzLine: { color: q.cross, labelBackgroundColor: q.label } }, rightPriceScale: { borderColor: q.line }, timeScale: { borderColor: q.line } });
      candle.current?.applyOptions({ upColor: q.up, downColor: q.down, borderUpColor: q.up, borderDownColor: q.down, wickUpColor: q.up, wickDownColor: q.down });
    });
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => { mo.disconnect(); c.remove(); chart.current = null; candle.current = null; volume.current = null; lastKey.current = ""; };
  }, []);

  // data + price / market-cap view
  useEffect(() => {
    const c = chart.current, s = candle.current, v = volume.current;
    if (!c || !s || !v || !candles) return;
    const k = useMc ? supply! : 1;
    // minMove 1e-20 keeps tiny meme prices exact (the library treats bases above 1e18 as decimal).
    s.applyOptions({ priceFormat: { type: "custom", formatter: (p: number) => fmt(p, useMc), minMove: useMc ? 0.01 : 1e-20 } });
    const rows = candles.map((x) => ({ time: Math.floor(x.t / 1000) as UTCTimestamp, open: x.o * k, high: x.h * k, low: x.l * k, close: x.c * k }));
    const vols = candles.map((x) => ({ time: Math.floor(x.t / 1000) as UTCTimestamp, value: x.v, color: x.c >= x.o ? "rgba(61,220,151,0.35)" : "rgba(255,107,107,0.35)" }));
    // Same series, one new or changed candle at the end: update in place (smooth, keeps the zoom).
    const key = `${useMc}|${rows.length > 1 ? rows[rows.length - 2].time : 0}|${rows.length}`;
    if (lastKey.current && key === lastKey.current && rows.length) {
      s.update(rows[rows.length - 1]); v.update(vols[vols.length - 1]);
    } else {
      const fresh = !lastKey.current || !lastKey.current.startsWith(`${useMc}|`);
      s.setData(rows); v.setData(vols);
      if (fresh) c.timeScale().fitContent();
    }
    lastKey.current = key;
  }, [candles, useMc, supply]);

  return (
    <div style={{ position: "relative" }}>
      <div style={{ position: "absolute", top: 6, left: 8, zIndex: 3, display: "flex", gap: 2, background: "var(--hdr)", borderRadius: 8, padding: 2 }}>
        {(["MC", "Price"] as const).map((t) => {
          const on = (t === "MC") === useMc;
          return <button key={t} type="button" disabled={t === "MC" && !mcOk} onClick={() => setMc(t === "MC")} className="mono" style={{ height: 26, padding: "0 10px", borderRadius: 6, border: 0, background: on ? "var(--raise2)" : "transparent", color: on ? "var(--text)" : "var(--dim)", fontWeight: 600, fontSize: 11 }}>{t}</button>;
        })}
      </div>
      <div ref={box} className="tv-box" style={{ ["--tv-h" as string]: `${height}px`, width: "100%" }} aria-label="Price chart" role="img" />
      {candles && candles.length === 0 && (
        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none" }}><span className="dim" style={{ fontSize: 14 }}>{empty}</span></div>
      )}
      {!candles && <div className="skel" style={{ position: "absolute", inset: 0, borderRadius: 12 }} />}
      <a href="https://www.tradingview.com/" target="_blank" rel="noopener noreferrer" style={{ position: "absolute", left: 8, bottom: 2, fontSize: 9, color: "var(--line3)", lineHeight: 1 }}>TradingView</a>
    </div>
  );
}
