// Shared types for coins shown in lists, cards and tables.
export type Chain = "Robinhood" | "Base" | "BNB" | "Arc";
export type Coin = {
  id: string; name: string; tick: string; chain: Chain; age: string;
  price: string; chg: number; mc: string; vol: string; liq: string;
  holders: string; trades: string; c1: string; c2: string; spark: number[]; progress: number;
  image?: string | null; own?: boolean;
};
