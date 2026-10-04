"use client";
// Professional chart for coins on other DEXs: DexScreener's embed (Base), GeckoTerminal's otherwise.
import { useEffect, useState } from "react";

export default function ExtChart({ network, pool, height = 420 }: { network: string | null | undefined; pool: string | null | undefined; height?: number }) {
  const [light, setLight] = useState(false);
  useEffect(() => {
    const read = () => setLight(document.documentElement.dataset.theme === "light");
    read();
    const mo = new MutationObserver(read);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => mo.disconnect();
  }, []);
  if (!network || !pool) {
    return <div className="tv-box" style={{ ["--tv-h" as string]: `${height}px`, display: "flex", alignItems: "center", justifyContent: "center" }}><span className="dim" style={{ fontSize: 14 }}>Chart is not available for this coin yet.</span></div>;
  }
  const theme = light ? "light" : "dark";
  const ds = network === "base" ? "base" : network === "bsc" ? "bsc" : null;
  const src = ds
    ? `https://dexscreener.com/${ds}/${pool}?embed=1&loadChartSettings=0&trades=0&tabs=0&info=0&chartLeftToolbar=0&chartDefaultOnMobile=1&chartTheme=${theme}&theme=${theme}&chartStyle=1&chartType=marketCap&interval=15`
    : `https://www.geckoterminal.com/${network}/pools/${pool}?embed=1&info=0&swaps=0&grayscale=0&light_chart=${light ? 1 : 0}&chart_type=market_cap&resolution=15m`;
  return (
    <div className="tv-box" style={{ ["--tv-h" as string]: `${height}px`, borderRadius: 12, overflow: "hidden", background: "var(--bg2)" }}>
      <iframe key={src} src={src} title="Price chart" loading="lazy" referrerPolicy="no-referrer" allow="clipboard-write" style={{ width: "100%", height: "100%", border: 0, display: "block" }} />
    </div>
  );
}
