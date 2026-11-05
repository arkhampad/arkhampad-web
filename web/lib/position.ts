// "Your position" on a coin: what you hold, what it cost on average, and profit or loss, from your own trades
// (average-cost method: a sell takes its share of the cost; what's left is the cost of what you still hold).
import type { ETrade } from "./ely";

export type Position = {
  bought: number; boughtHype: number; sold: number; soldHype: number; trades: number;
  held: number;          // tokens still held by the trade history
  cost: number;          // HYPE paid for what's still held
  realized: number;      // HYPE profit/loss already taken by sells
  entryPrice: number | null; // average HYPE per token of what's held
  complete: boolean;     // false when sells exceed the buys we know of (tokens came from elsewhere)
};

export function positionFrom(trades: ETrade[], me: string): Position | null {
  const mine = trades.filter((x) => (x.trader || "").toLowerCase() === me.toLowerCase()).slice().sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || a.log_index - b.log_index);
  if (!mine.length) return null;
  let held = 0, cost = 0, realized = 0, bought = 0, boughtHype = 0, sold = 0, soldHype = 0, complete = true;
  for (const x of mine) {
    if (x.side === "buy") { held += x.amount; cost += x.hype; bought += x.amount; boughtHype += x.hype; continue; }
    sold += x.amount; soldHype += x.hype;
    if (held <= 0) { complete = false; continue; }
    if (x.amount > held * 1.001) complete = false; // sold more than we saw bought
    const part = Math.min(1, x.amount / held);
    const c = cost * part;
    realized += x.hype - c;
    cost -= c; held = Math.max(0, held - x.amount);
  }
  return { bought, boughtHype, sold, soldHype, trades: mine.length, held, cost, realized, entryPrice: held > 0 ? cost / held : bought > 0 ? boughtHype / bought : null, complete };
}
