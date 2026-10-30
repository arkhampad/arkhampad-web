"use client";
// Candle chart for an Elysium token, built from its trades (TradingView Lightweight Charts, Apache-2.0).
import { useEffect, useMemo, useRef, useState } from "react";
import { CandlestickSeries, ColorType, CrosshairMode, HistogramSeries, createChart, type IChartApi, type ISeriesApi, type UTCTimestamp } from "lightweight-charts";
import type { ETrade } from "@/lib/ely";
import { useT } from "@/lib/i18n";

export type Candle = { t: number; o: number; h: number; l: number; c: number; v: number };
const FRAMES = [
  { id: "1m", s: 60 },
  { id: "5m", s: 300 },
  { id: "15m", s: 900 },
  { id: "1h", s: 3600 },
  { id: "4h", s: 14400 },
] as const;

/** Trades (newest first) → candles; each candle opens at the previous close so there are no gaps. */
export function toCandles(trades: ETrade[], frame: number): Candle[] {
  const rows = trades.filter((x) => x.price_hype && x.price_hype > 0).slice().reverse();
  const out: Candle[] = [];
  for (const x of rows) {
    const t = Math.floor(Date.parse(x.at) / 1000 / frame) * frame;
    const p = x.price_hype!;
    const last = out[out.length - 1];
    if (last && last.t === t) {
      last.h = Math.max(last.h, p); last.l = Math.min(last.l, p); last.c = p; last.v += x.hype;
    } else {
      const o = last ? last.c : p;
      out.push({ t, o, h: Math.max(o, p), l: Math.min(o, p), c: p, v: x.hype });
    }
  }
  return out;
}

function fmt(v: number, mc: boolean): string {
  if (!Number.isFinite(v)) return "";
  const a = Math.abs(v);
  if (mc || a >= 1000) {
    if (a >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
    if (a >= 1e6) return `$${(v / 1e6).toFixed(2)}M`;
    if (a >= 1e3) return `$${(v / 1e3).toFixed(1)}K`;
    return `$${v.toFixed(0)}`;
  }
  if (v >= 1) return `$${v.toFixed(4)}`;
  if (v <= 0) return "$0";
  const zeros = Math.floor(-Math.log10(v));
  return `$${v.toFixed(Math.min(18, zeros + 3))}`;
}

function palette(el: Element | null) {
  const s = el ? getComputedStyle(el) : null;
  const g = (n: string, f: string) => s?.getPropertyValue(n).trim() || f;
  return { up: g("--e-up", "#0b9a64"), down: g("--e-down", "#e0464b"), text: g("--e-dim", "#82919b"), line: g("--e-line", "#e4e9ed"), label: g("--e-text2", "#26343d") };
}

export function EChart({ trades, usd, supply, height = 400 }: { trades: ETrade[] | undefined; usd: number; supply: number; height?: number }) {
  const tr = useT();
  const box = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
  const candle = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const vol = useRef<ISeriesApi<"Histogram"> | null>(null);
  const [frame, setFrame] = useState<number>(300);
  const [mc, setMc] = useState(true);
  const fitKey = useRef("");
  const candles = useMemo(() => (trades ? toCandles(trades, frame) : null), [trades, frame]);

  useEffect(() => {
    if (!box.current) return;
    const p = palette(box.current);
    const c = createChart(box.current, {
      autoSize: true,
      localization: {
        locale: "en-US",
        // show the viewer's own clock, not UTC
        timeFormatter: (t: number) => new Date(t * 1000).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }),
      },
      layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: p.text, fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace', fontSize: 11, attributionLogo: false },
      grid: { vertLines: { visible: false }, horzLines: { color: p.line } },
      crosshair: { mode: CrosshairMode.Magnet, vertLine: { labelBackgroundColor: p.label }, horzLine: { labelBackgroundColor: p.label } },
      rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.1, bottom: 0.22 } },
      timeScale: {
        borderVisible: false, timeVisible: true, secondsVisible: false, rightOffset: 4, barSpacing: 9,
        tickMarkFormatter: (t: number, kind: number) => {
          const d = new Date(t * 1000);
          return kind >= 3 ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : d.toLocaleDateString([], { month: "short", day: "numeric" });
        },
      },
      handleScale: { axisPressedMouseMove: { time: true, price: true }, mouseWheel: true, pinch: true },
      handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
    });
    // keep the bottom margin small so the axis never dips below zero
    c.priceScale("right").applyOptions({ scaleMargins: { top: 0.12, bottom: 0.2 } });
    candle.current = c.addSeries(CandlestickSeries, {
      upColor: p.up, downColor: p.down, borderUpColor: p.up, borderDownColor: p.down, wickUpColor: p.up, wickDownColor: p.down, priceLineVisible: false,
      autoscaleInfoProvider: (orig: () => { priceRange: { minValue: number; maxValue: number } | null } | null) => {
        const r = orig();
        if (!r || !r.priceRange) return r;
        // prices and market caps are never below zero
        const minValue = Math.max(0, r.priceRange.minValue);
        const maxValue = Math.max(minValue, r.priceRange.maxValue);
        const mid = (minValue + maxValue) / 2;
        if (maxValue - minValue >= Math.abs(mid) * 0.02) return { ...r, priceRange: { minValue, maxValue } };
        const pad = Math.abs(mid) * 0.05 || 1e-12;
        return { ...r, priceRange: { minValue: Math.max(0, mid - pad), maxValue: mid + pad } };
      },
    });
    vol.current = c.addSeries(HistogramSeries, { priceScaleId: "vol", priceFormat: { type: "volume" }, lastValueVisible: false, priceLineVisible: false });
    c.priceScale("vol").applyOptions({ scaleMargins: { top: 0.82, bottom: 0 }, visible: false });
    chart.current = c;
    // one-finger drag on the right axis squeezes / stretches the price range (like on mobile trading apps)
    const el = box.current;
    let y0 = -1;
    let r0: { from: number; to: number } | null = null;
    let lastTap = 0;
    const axisW = () => c.priceScale("right").width() || 60;
    const onAxis = (x: number) => x > el.getBoundingClientRect().right - axisW() - 6;
    const ts = (e: TouchEvent) => {
      if (e.touches.length !== 1 || !onAxis(e.touches[0].clientX)) return;
      const now = Date.now();
      if (now - lastTap < 300) { c.priceScale("right").setAutoScale(true); lastTap = 0; return; }
      lastTap = now;
      y0 = e.touches[0].clientY;
      r0 = c.priceScale("right").getVisibleRange();
    };
    const tm = (e: TouchEvent) => {
      if (y0 < 0 || !r0) return;
      e.preventDefault();
      const dy = e.touches[0].clientY - y0; // down = positive
      const f = Math.exp(dy / 180);
      const mid = (r0.from + r0.to) / 2;
      const half = ((r0.to - r0.from) / 2) * f;
      c.priceScale("right").setAutoScale(false);
      c.priceScale("right").setVisibleRange({ from: Math.max(0, mid - half), to: mid + half });
    };
    const te = () => { y0 = -1; r0 = null; };
    el.addEventListener("touchstart", ts, { passive: true });
    el.addEventListener("touchmove", tm, { passive: false });
    el.addEventListener("touchend", te, { passive: true });
    const mo = new MutationObserver(() => {
      requestAnimationFrame(() => {
        const q = palette(box.current);
        c.applyOptions({ layout: { textColor: q.text }, grid: { horzLines: { color: q.line } }, crosshair: { vertLine: { labelBackgroundColor: q.label }, horzLine: { labelBackgroundColor: q.label } } });
        candle.current?.applyOptions({ upColor: q.up, downColor: q.down, borderUpColor: q.up, borderDownColor: q.down, wickUpColor: q.up, wickDownColor: q.down });
      });
    });
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => { el.removeEventListener("touchstart", ts); el.removeEventListener("touchmove", tm); el.removeEventListener("touchend", te); mo.disconnect(); c.remove(); chart.current = null; candle.current = null; vol.current = null; fitKey.current = ""; };
  }, []);

  useEffect(() => {
    const c = chart.current, s = candle.current, v = vol.current;
    if (!c || !s || !v || !candles) return;
    const k = (mc ? supply : 1) * (usd || 0);
    if (!k) return;
    s.applyOptions({ priceFormat: { type: "custom", formatter: (x: number) => (x < 0 ? "" : fmt(x, mc)), minMove: mc ? 0.01 : 1e-20 } });
    s.setData(candles.map((x) => ({ time: x.t as UTCTimestamp, open: x.o * k, high: x.h * k, low: x.l * k, close: x.c * k })));
    v.setData(candles.map((x) => ({ time: x.t as UTCTimestamp, value: x.v, color: x.c >= x.o ? "rgba(11,154,100,0.28)" : "rgba(224,70,75,0.28)" })));
    const key = `${frame}|${mc}`;
    if (fitKey.current !== key) {
      fitKey.current = key;
      if (candles.length > 60) c.timeScale().fitContent();
      else { c.timeScale().applyOptions({ barSpacing: 12 }); c.timeScale().scrollToRealTime(); }
    }
  }, [candles, mc, usd, supply, frame]);

  return (
    <div className="e-chart">
      <div className="e-chart-bar">
        <div className="e-seg">
          {FRAMES.map((f) => <button key={f.id} type="button" className={frame === f.s ? "on" : ""} onClick={() => setFrame(f.s)}>{f.id}</button>)}
        </div>
        <div className="e-seg">
          <button type="button" className={mc ? "on" : ""} onClick={() => setMc(true)}>{tr("MCap")}</button>
          <button type="button" className={!mc ? "on" : ""} onClick={() => setMc(false)}>{tr("Price")}</button>
        </div>
      </div>
      <div className="e-chart-box" style={{ ["--h" as string]: `${height}px` }}>
        <div ref={box} style={{ position: "absolute", inset: 0 }} role="img" aria-label="Price chart" />
        {candles && candles.length === 0 && <div className="e-chart-empty">{tr("No trades yet.")}</div>}
        {!candles && <div className="e-skel" style={{ position: "absolute", inset: 8 }} />}
      </div>
    </div>
  );
}
