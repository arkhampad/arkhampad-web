// Sample data for the design build. Replaced by live data from the indexer in a later package.
export type Chain = "Robinhood" | "Base" | "BNB" | "Arc";
export type Coin = {
  id: string; name: string; tick: string; chain: Chain; age: string;
  price: string; chg: number; mc: string; vol: string; liq: string;
  holders: string; trades: string; c1: string; c2: string; spark: number[]; progress: number;
  image?: string | null; own?: boolean;
};

function rng(seed: number) {
  let s = seed;
  return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
}
function series(seed: number, up: boolean, n = 30) {
  const r = rng(seed); let v = 50; const out: number[] = [];
  for (let i = 0; i < n; i++) { v += (up ? 1.3 : -1.3) + (r() - 0.5) * 10; out.push(v); }
  return out;
}

const raw: [string, string, Chain, string, string, number, string, string, string, string, string][] = [
  ["Moonfrog", "MFROG", "Base", "4m", "$0.00412", 182.4, "$412K", "$1.24M", "$96K", "#7C5CFF", "#3A2BFF"],
  ["Byte Cat", "BCAT", "Robinhood", "22m", "$0.00087", 64.1, "$87.1K", "$310K", "$31K", "#FF8A3D", "#FF3D7F"],
  ["Orbit Dog", "ORBD", "Base", "3h", "$0.0213", 41.8, "$2.13M", "$4.02M", "$388K", "#2BB3FF", "#0066FF"],
  ["Pixel Pepe", "PXPE", "Base", "1d", "$0.00064", -12.6, "$64.0K", "$98.4K", "$22K", "#E8559A", "#8A2BE2"],
  ["Neon Whale", "NWHL", "Robinhood", "6h", "$0.0151", 27.3, "$1.51M", "$2.77M", "$241K", "#3DDC97", "#00B37E"],
  ["Glitch", "GLCH", "Base", "45m", "$0.00009", 9.8, "$9.4K", "$21.6K", "$7.1K", "#F5C542", "#FF7A00"],
  ["Lazy Lion", "LZYL", "Robinhood", "2d", "$0.0039", -4.1, "$390K", "$512K", "$84K", "#5AD1C4", "#0E9F8E"],
  ["Turbo Snail", "TSNL", "Base", "9h", "$0.00218", 18.9, "$218K", "$640K", "$57K", "#B57BFF", "#6A3BFF"],
  ["Ghost Chain", "GHST", "Base", "3d", "$0.0477", -21.3, "$4.77M", "$1.92M", "$610K", "#FF6B6B", "#E0245E"],
  ["Banana Bot", "BBOT", "Robinhood", "1h", "$0.00031", 73.5, "$31.2K", "$145K", "$13K", "#8FB3FF", "#4060FF"],
  ["Solar Fox", "SFOX", "Base", "12h", "$0.0092", 6.2, "$920K", "$1.08M", "$142K", "#C9A27A", "#A06A3B"],
  ["Rug Proof", "RGPF", "Robinhood", "5d", "$0.0011", -2.7, "$110K", "$76K", "$29K", "#69D36E", "#2FA84F"],
];

export const coins: Coin[] = raw.map((c, i) => ({
  id: c[1].toLowerCase(), name: c[0], tick: c[1], chain: c[2], age: c[3], price: c[4], chg: c[5],
  mc: c[6], vol: c[7], liq: c[8], c1: c[9], c2: c[10],
  holders: String(200 + ((i * 397) % 2200)), trades: String(300 + ((i * 1231) % 8000)),
  spark: series(i + 3, c[5] >= 0), progress: 20 + ((i * 37) % 76),
}));

export const trades = [
  { who: "0x3f…a91", act: "bought", amt: "$25", tick: "MFROG", up: true },
  { who: "mira.eth", act: "sold", amt: "$140", tick: "GHST", up: false },
  { who: "0x9c…11e", act: "bought", amt: "$10", tick: "BCAT", up: true },
  { who: "kaan", act: "bought", amt: "$50", tick: "ORBD", up: true },
  { who: "0x77…f03", act: "bought", amt: "$5", tick: "BBOT", up: true },
  { who: "deniz", act: "sold", amt: "$32", tick: "PXPE", up: false },
  { who: "0x1a…c2d", act: "bought", amt: "$100", tick: "NWHL", up: true },
  { who: "luna", act: "bought", amt: "$15", tick: "GLCH", up: true },
];

export type Trader = { rank: number; name: string; c1: string; c2: string; pnl: string; roi: string; win: string; trades: string; fol: string; badge: string; best: string; spark: number[] };
const tn: [string, string, string, string][] = [
  ["mira.eth", "#7C5CFF", "#3A2BFF", "+$12,400"], ["kaan", "#FF8A3D", "#FF3D7F", "+$8,900"], ["0x9c…11e", "#2BB3FF", "#0066FF", "+$6,100"],
  ["luna", "#E8559A", "#8A2BE2", "+$4,700"], ["deniz.base", "#3DDC97", "#00B37E", "+$3,900"], ["alphawolf", "#F5C542", "#FF7A00", "+$3,100"],
  ["0x3f…a91", "#5AD1C4", "#0E9F8E", "+$2,600"], ["satoshi_jr", "#B57BFF", "#6A3BFF", "+$2,050"], ["nova", "#FF6B6B", "#E0245E", "+$1,700"],
  ["0x77…f03", "#8FB3FF", "#4060FF", "+$1,300"], ["pixelqueen", "#C9A27A", "#A06A3B", "+$980"], ["degenlab", "#69D36E", "#2FA84F", "+$720"],
];
const badges = ["Sniper", "Diamond hands", "Early bird", "Steady"];
export const traders: Trader[] = tn.map((t, i) => ({
  rank: i + 1, name: t[0], c1: t[1], c2: t[2], pnl: t[3], roi: `+${60 + ((i * 73) % 360)}%`, win: `${52 + ((i * 7) % 26)}%`,
  trades: String(40 + ((i * 131) % 860)), fol: (80 + ((i * 977) % 4100)).toLocaleString("en-US"), badge: badges[i % 4],
  best: ["MFROG +640%", "ORBD +310%", "BCAT +220%", "NWHL +180%"][i % 4], spark: series(i + 40, true),
}));

export const guides = [
  ["getting-started", "What is ArkhamPad?", "The AI launchpad for creating and trading coins with USDC.", "3 min", "#7C5CFF", "#3A2BFF", "what-is-arkhampad"],
  ["getting-started", "How to deposit and withdraw USDC", "Add money from any wallet or exchange and cash out anytime.", "4 min", "#2BB3FF", "#0066FF", "deposit-and-withdraw-usdc"],
  ["creating", "Create a coin with AI in 60 seconds", "Write one sentence in any language, get a ready coin.", "5 min", "#D4FF3A", "#5CFFB0", "create-a-coin-with-ai"],
  ["creating", "Robinhood Chain or Base: where to launch", "How each chain differs and which one fits your coin.", "6 min", "#CCFF4D", "#5B8CFF", "robinhood-chain-or-base"],
  ["creating", "Creator lock explained", "Why locking your own coins makes buyers trust you.", "3 min", "#F5C542", "#FF7A00", "creator-lock"],
  ["creating", "Creator fees vs buyback and burn", "Earn from every trade or use fees to burn your coin.", "4 min", "#FF8A3D", "#FF3D7F", "creator-fees-vs-buyback-and-burn"],
  ["trading", "What is a bonding curve?", "How the price moves as people buy and sell, simply explained.", "5 min", "#3DDC97", "#00B37E", "what-is-a-bonding-curve"],
  ["trading", "What does graduation mean?", "What happens when a coin reaches $7.5K market cap.", "4 min", "#5AD1C4", "#0E9F8E", "what-is-graduation"],
  ["trading", "Take profit and stop loss for meme coins", "Let the site sell for you at the price you choose.", "5 min", "#8FB3FF", "#4060FF", "take-profit-and-stop-loss"],
  ["trading", "How copy trading works", "Follow top traders and copy their buys in one tap.", "4 min", "#B57BFF", "#6A3BFF", "copy-trading"],
  ["safety", "How to spot a rug pull", "Read the AI safety check like a pro before you buy.", "6 min", "#FF6B6B", "#E0245E", "spot-a-rug-pull"],
  ["safety", "Keep your account safe", "Login options, scams to avoid and what we never ask.", "4 min", "#E8559A", "#8A2BE2", "account-safety"],
].map(([cat, title, desc, read, c1, c2, slug]) => ({ cat, title, desc, read, c1, c2, slug }));

export const catLabel: Record<string, string> = { "getting-started": "Getting started", creating: "Creating", trading: "Trading", safety: "Safety" };
