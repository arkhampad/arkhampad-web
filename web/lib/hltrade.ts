"use client";

/**
 * Futures trading on Hyperliquid (orders, money in and out). Read-only data is in lib/hl.ts.
 *
 * Signing: the user's own key (the ArkhamPad wallet) signs three things, once each: approving
 * ArkhamPad's 0.07% builder fee, approving a trading key, and moving money out. The trading key
 * (an "agent", kept in this browser) signs the orders themselves, so trading needs no pop-ups and
 * works with any wallet. An agent can trade but can never move money out.
 *
 * Money in: ArkhamPad cash (Base USDC) -> the user's Hyperliquid futures balance, through Relay.
 * Money out: Hyperliquid sends it (minus its $1 fee) to a one-time Relay address on Arbitrum,
 * which delivers USDC to the user's ArkhamPad address on Base.
 */
import { ExchangeClient, HttpTransport, InfoClient } from "@nktkas/hyperliquid";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { HOME_CHAIN, ensureCash, moveApi, netOf, runMove, toUsdc, type Signer } from "./chain";
import { BUILDER_FEE_TENTHS_BP, HL_API, HL_BUILDER, MIN_NOTIONAL, info, priceString, sizeString, type PerpMarket, type PerpOrder, type PerpPosition } from "./hl";
import { SPOT_MIN_NOTIONAL, SPOT_SLIP, fetchAccountMode, fetchSpotBalances, holdingOf, spotPriceString, usdcOf, type SpotMarket } from "./hlspot";

/** Hyperliquid's withdrawal fee (dollars), taken from what is moved out. */
export const HL_WITHDRAW_FEE = 1;
export const MIN_MOVE = 5;
/** How far a market order may fill from the mark price (open) and when closing. */
const SLIP_OPEN = 0.01;
const SLIP_CLOSE = 0.02;
const AGENT_NAME = "ArkhamPad";
/** User-signed Hyperliquid actions name the chain they're signed on: Base. */
const SIGN_CHAIN = 8453;

/** `limitPx`: a limit order that waits at that price; none: a market order. */
export type OpenOrder = { market: PerpMarket; side: "long" | "short"; margin: number; lev: number; coins: string; tp: number | null; sl: number | null; limitPx?: number | null };
export type FuturesTrade = {
  deposit: (amount: number, onStep: (m: string | null) => void) => Promise<void>;
  withdraw: (amount: number, onStep: (m: string | null) => void) => Promise<void>;
  open: (o: OpenOrder, onStep: (m: string | null) => void) => Promise<{ avgPx: number | null; resting?: boolean }>;
  /** Closes all of a position, or a part (fraction 0.25 = a quarter). */
  close: (p: PerpPosition, m: PerpMarket | null, fraction?: number) => Promise<void>;
  /** Sets (or removes, with null) the take profit and stop loss of an open position. */
  setTpsl: (p: PerpPosition, m: PerpMarket | null, t: { tp: number | null; sl: number | null }, current: PerpOrder[]) => Promise<void>;
  cancel: (o: PerpOrder, m: PerpMarket | null) => Promise<void>;
  /** Spot: buys `usd` dollars of the coin (a limit order at `limitPx` when given). */
  spotBuy: (m: SpotMarket, usd: number, limitPx: number | null, onStep: (m: string | null) => void) => Promise<{ avgPx: number | null; coins: number; resting?: boolean }>;
  /** Spot: sells `fraction` (0..1] of the coins held (a limit order at `limitPx` when given). */
  spotSell: (m: SpotMarket, fraction: number, limitPx: number | null, onStep: (m: string | null) => void) => Promise<{ avgPx: number | null; usd: number; resting?: boolean }>;
  /** Spot: cancels an open spot order. */
  spotCancel: (m: SpotMarket, oid: number) => Promise<void>;
};

const transport = new HttpTransport({ apiUrl: HL_API });
const infoClient = new InfoClient({ transport });
const agentKey = (user: string) => `arkhampad.hl.agent.${user.toLowerCase()}`;

function readAgent(user: string): `0x${string}` | null {
  try {
    const k = localStorage.getItem(agentKey(user));
    return k && /^0x[0-9a-f]{64}$/i.test(k) ? (k as `0x${string}`) : null;
  } catch {
    return null;
  }
}

/** Hyperliquid's error text, in plain words where we know it. */
export function hlError(e: unknown): Error {
  const m = String((e as { message?: string })?.message ?? e);
  if (/insufficient margin|not enough/i.test(m)) return new Error("Not enough in your trading balance for that.");
  if (/could not immediately match|no resting orders/i.test(m)) return new Error("The price moved too fast. Try again.");
  if (/minimum value|min.*\$10/i.test(m)) return new Error(`The smallest position is $${MIN_NOTIONAL} (amount × leverage).`);
  if (/builder fee has not been approved|builder/i.test(m) && /approv/i.test(m)) return new Error("Trading isn't approved yet. Try again to approve it.");
  if (/does not exist|user or api wallet/i.test(m)) return new Error("Your futures account isn't set up yet. Add money first.");
  if (/rejected|denied|user rejected/i.test(m)) return new Error("You cancelled it in your wallet.");
  return new Error(m.length > 160 ? `${m.slice(0, 160)}…` : m);
}

/** The ArkhamPad wallet, in the shape the Hyperliquid SDK signs with (always on Base). */
function userWallet(s: Signer) {
  return {
    signTypedData: (p: { domain: Record<string, unknown>; types: Record<string, { name: string; type: string }[]>; primaryType: string; message: Record<string, unknown> }) =>
      s.signTypedData(Number(p.domain?.chainId ?? SIGN_CHAIN), { domain: p.domain, types: p.types, primaryType: p.primaryType, message: p.message }),
    getAddresses: async () => [s.address] as `0x${string}`[],
    getChainId: async () => SIGN_CHAIN,
  };
}

/** Waits (up to `ms`) until the futures balance changes from `before`. */
async function balanceMoves(user: string, before: number, ms: number) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    await new Promise((r) => setTimeout(r, 3000));
    const s = await info<{ marginSummary?: { accountValue?: string } }>({ type: "clearinghouseState", user: user.toLowerCase() }).catch(() => null);
    const v = Number(s?.marginSummary?.accountValue ?? NaN);
    if (Number.isFinite(v) && Math.abs(v - before) > 0.01) return true;
  }
  return false;
}

export function makeFuturesTrade(s: Signer | null, after: () => Promise<void>): FuturesTrade {
  const user = s?.address ?? null;

  function mainClient(): ExchangeClient {
    if (!s) throw new Error("Sign in first.");
    return new ExchangeClient({ transport, wallet: userWallet(s) as never });
  }

  /** The builder fee approved once, a trading key approved once. Returns the client that trades. */
  async function ready(onStep: (m: string | null) => void): Promise<ExchangeClient> {
    if (!user) throw new Error("Sign in first.");
    const max = await infoClient.maxBuilderFee({ user, builder: HL_BUILDER }).catch(() => 0);
    if (Number(max) < BUILDER_FEE_TENTHS_BP) {
      onStep("Setting up futures (one time)…");
      try {
        await mainClient().approveBuilderFee({ maxFeeRate: `${BUILDER_FEE_TENTHS_BP / 1000}%`, builder: HL_BUILDER });
      } catch (e) {
        throw hlError(e);
      }
    }
    let key = readAgent(user);
    const agents = await infoClient.extraAgents({ user }).catch(() => [] as { address: string; validUntil: number | null }[]);
    const live = key && agents.some((a) => a.address.toLowerCase() === privateKeyToAccount(key!).address.toLowerCase() && (a.validUntil ?? Number.MAX_SAFE_INTEGER) > Date.now() + 60_000);
    if (!live) {
      key = generatePrivateKey();
      onStep("Setting up futures (one time)…");
      try {
        await mainClient().approveAgent({ agentAddress: privateKeyToAccount(key).address, agentName: AGENT_NAME });
      } catch (e) {
        throw hlError(e);
      }
      try {
        localStorage.setItem(agentKey(user), key);
      } catch {
        /* private window: approved again next time */
      }
    }
    return new ExchangeClient({ transport, wallet: privateKeyToAccount(key!) });
  }

  const builder = { b: HL_BUILDER, f: BUILDER_FEE_TENTHS_BP };

  return {
    async deposit(amount, onStep) {
      if (!s || !user) throw new Error("Sign in first.");
      if (!(amount >= MIN_MOVE)) throw new Error(`The smallest amount is $${MIN_MOVE}.`);
      const base = netOf(HOME_CHAIN);
      if (!base) throw new Error("Futures aren't available on this network.");
      const units = toUsdc(amount);
      onStep("Getting your cash ready…");
      await ensureCash(HOME_CHAIN, units, s);
      onStep("Getting the route…");
      const before = Number((await info<{ marginSummary?: { accountValue?: string } }>({ type: "clearinghouseState", user: user.toLowerCase() }).catch(() => null))?.marginSummary?.accountValue ?? 0);
      const q = await moveApi({ action: "hlIn", user, amount: units.toString() });
      onStep("Moving to futures…");
      await runMove(q, base, HOME_CHAIN, s);
      onStep("Almost there…");
      await balanceMoves(user, before, 90_000);
      onStep(null);
      void after();
    },

    async withdraw(amount, onStep) {
      if (!s || !user) throw new Error("Sign in first.");
      if (!(amount >= MIN_MOVE)) throw new Error(`The smallest amount is $${MIN_MOVE}.`);
      // a standard account keeps spot dollars apart: bring over what the futures side is short
      const mode = await fetchAccountMode(user);
      if (mode === "standard") {
        const perp = Number((await info<{ withdrawable?: string }>({ type: "clearinghouseState", user: user.toLowerCase() }).catch(() => null))?.withdrawable ?? 0);
        if (perp + 1e-6 < amount) {
          const spot = usdcOf(await fetchSpotBalances(user).catch(() => []))?.free ?? 0;
          const move = Math.ceil((amount - perp) * 100) / 100;
          if (move > spot + 1e-6) throw new Error(`You can withdraw up to $${(Math.floor((perp + spot) * 100) / 100).toFixed(2)}.`);
          onStep("Getting your dollars together…");
          try {
            await mainClient().usdClassTransfer({ amount: move.toFixed(2), toPerp: true });
          } catch (e) {
            throw hlError(e);
          }
        }
      }
      onStep("Getting the route…");
      const q = await moveApi({ action: "hlOut", user, amount: toUsdc(amount - HL_WITHDRAW_FEE).toString() });
      if (!q.depositAddress || !/^0x[0-9a-fA-F]{40}$/.test(q.depositAddress)) throw new Error("This route isn't available right now. Try again in a moment.");
      onStep("Confirming…");
      try {
        await mainClient().withdraw3({ destination: q.depositAddress as `0x${string}`, amount: String(amount) });
      } catch (e) {
        throw hlError(e);
      }
      onStep(null);
      setTimeout(() => void after(), 5_000);
    },

    async open(o, onStep) {
      const ex = await ready(onStep);
      const m = o.market;
      const buy = o.side === "long";
      // dollars sitting on the spot side of a standard account come over for the margin
      await futuresDollars(o.margin * 1.01 + 0.05, onStep);
      try {
        onStep(`Setting ${o.lev}x…`);
        await ex.updateLeverage({ asset: m.index, isCross: false, leverage: o.lev });
        onStep("Opening…");
        const orders: Parameters<ExchangeClient["order"]>[0]["orders"] = [
          o.limitPx
            ? { a: m.index, b: buy, p: priceString(o.limitPx, m.szDecimals), s: o.coins, r: false, t: { limit: { tif: "Gtc" } } }
            : { a: m.index, b: buy, p: priceString(m.mark * (buy ? 1 + SLIP_OPEN : 1 - SLIP_OPEN), m.szDecimals), s: o.coins, r: false, t: { limit: { tif: "Ioc" } } },
        ];
        for (const [kind, at] of [["tp", o.tp], ["sl", o.sl]] as const) {
          if (!at) continue;
          // closing side; the limit is a 10% slippage bound behind the trigger
          orders.push({
            a: m.index,
            b: !buy,
            p: priceString(at * (buy ? 0.9 : 1.1), m.szDecimals),
            s: o.coins,
            r: true,
            t: { trigger: { isMarket: true, triggerPx: priceString(at, m.szDecimals), tpsl: kind } },
          });
        }
        const res = await ex.order({ orders, grouping: orders.length > 1 ? "normalTpsl" : "na", builder });
        const first = res.response.data.statuses[0];
        onStep(null);
        void after();
        if (first && typeof first === "object" && "filled" in first) return { avgPx: Number(first.filled.avgPx) };
        if (o.limitPx && first && typeof first === "object" && "resting" in first) return { avgPx: null, resting: true };
        throw new Error("The order didn't fill. Try again.");
      } catch (e) {
        throw hlError(e);
      }
    },

    async close(p, m, fraction = 1) {
      if (!m) throw new Error("This market isn't loaded yet.");
      const all = !(fraction > 0 && fraction < 1);
      const size = all ? sizeString(Math.abs(p.size), m.szDecimals) : sizeString(Math.abs(p.size) * fraction, m.szDecimals);
      // a part must still be a real order, and leave a real position behind
      if (!all && (Number(size) * m.mark < MIN_NOTIONAL * 1.05 || (Math.abs(p.size) - Number(size)) * m.mark < MIN_NOTIONAL * 1.05))
        throw new Error(`That part is too small (the smallest order is $${MIN_NOTIONAL}). Close all of it instead.`);
      if (!(Number(size) > 0)) throw new Error("Nothing to close.");
      const ex = await ready(() => {});
      const buy = p.side === "short";
      try {
        await ex.order({
          orders: [{ a: m.index, b: buy, p: priceString(m.mark * (buy ? 1 + SLIP_CLOSE : 1 - SLIP_CLOSE), m.szDecimals), s: size, r: true, t: { limit: { tif: "Ioc" } } }],
          grouping: "na",
          builder,
        });
      } catch (e) {
        throw hlError(e);
      }
      void after();
    },

    async setTpsl(p, m, t, current) {
      if (!m) throw new Error("This market isn't loaded yet.");
      const long = p.side === "long";
      const ref = m.mark;
      if (t.tp && (long ? t.tp <= ref : t.tp >= ref)) throw new Error(`Take profit must be ${long ? "above" : "below"} the price.`);
      if (t.sl && (long ? t.sl >= ref : t.sl <= ref)) throw new Error(`Stop loss must be ${long ? "below" : "above"} the price.`);
      if (t.sl && p.liq && (long ? t.sl <= p.liq : t.sl >= p.liq)) throw new Error("Stop loss is past the liquidation price.");
      const ex = await ready(() => {});
      const size = sizeString(Math.abs(p.size), m.szDecimals);
      const old = current.filter((o) => o.coin === p.coin && (o.tpsl === "tp" || o.tpsl === "sl"));
      try {
        // the new ones first, so the position is never left without them; then the old ones go
        const orders: Parameters<ExchangeClient["order"]>[0]["orders"] = [];
        for (const [kind, at] of [["tp", t.tp], ["sl", t.sl]] as const) {
          if (!at) continue;
          orders.push({
            a: m.index,
            b: !long,
            p: priceString(at * (long ? 0.9 : 1.1), m.szDecimals),
            s: size,
            r: true,
            t: { trigger: { isMarket: true, triggerPx: priceString(at, m.szDecimals), tpsl: kind } },
          });
        }
        if (orders.length) {
          try {
            await ex.order({ orders, grouping: "na", builder });
          } catch (e) {
            // part of it may have gone through: drop only the old ones a new one replaced
            const oldIds = new Set(old.map((o) => o.oid));
            const now = (await infoClient.frontendOpenOrders({ user: user! }).catch(() => [])) as { coin: string; oid: number; orderType: string }[];
            const kinds = new Set(
              now
                .filter((o) => o.coin === p.coin && !oldIds.has(o.oid))
                .map((o) => (/take profit/i.test(o.orderType) ? "tp" : /stop/i.test(o.orderType) ? "sl" : ""))
            );
            const gone = old.filter((o) => o.tpsl && kinds.has(o.tpsl));
            if (gone.length) await ex.cancel({ cancels: gone.map((o) => ({ a: m.index, o: o.oid })) }).catch(() => {});
            throw e;
          }
        }
        if (old.length) {
          try {
            await ex.cancel({ cancels: old.map((o) => ({ a: m.index, o: o.oid })) });
          } catch {
            throw new Error("The new TP/SL is set, but an old one couldn't be removed. Cancel it under Orders.");
          }
        }
      } catch (e) {
        throw hlError(e);
      }
      void after();
    },

    async cancel(o, m) {
      if (!m) throw new Error("This market isn't loaded yet.");
      const ex = await ready(() => {});
      try {
        await ex.cancel({ cancels: [{ a: m.index, o: o.oid }] });
      } catch (e) {
        throw hlError(e);
      }
      void after();
    },

    async spotBuy(m, usd, limitPx, onStep) {
      if (!user) throw new Error("Sign in first.");
      if (!(usd >= SPOT_MIN_NOTIONAL)) throw new Error(`The smallest order is $${SPOT_MIN_NOTIONAL}.`);
      const at = limitPx && limitPx > 0 ? limitPx : m.mark * (1 + SPOT_SLIP);
      const coins = sizeString(usd / (limitPx && limitPx > 0 ? limitPx : m.mark), m.szDecimals);
      if (!(Number(coins) > 0)) throw new Error("That amount is too small for this coin.");
      const ex = await ready(onStep);
      // dollars the order can take at most (its price bound), and a little for the fee
      const need = Number(coins) * at * 1.002;
      await spotDollars(need, onStep);
      onStep(limitPx ? "Placing the order…" : "Buying…");
      try {
        const res = await ex.order({
          orders: [{ a: m.asset, b: true, p: spotPriceString(at, m.szDecimals), s: coins, r: false, t: { limit: { tif: limitPx ? "Gtc" : "Ioc" } } }],
          grouping: "na",
          builder,
        });
        const first = res.response.data.statuses[0];
        onStep(null);
        void after();
        if (first && typeof first === "object" && "filled" in first) return { avgPx: Number(first.filled.avgPx), coins: Number(first.filled.totalSz) };
        if (limitPx && first && typeof first === "object" && "resting" in first) return { avgPx: null, coins: Number(coins), resting: true };
        throw new Error("The order didn't fill. Try again.");
      } catch (e) {
        throw hlError(e);
      }
    },

    async spotSell(m, fraction, limitPx, onStep) {
      if (!user) throw new Error("Sign in first.");
      const held = holdingOf(await fetchSpotBalances(user), m)?.free ?? 0;
      const f = fraction > 0 && fraction < 1 ? fraction : 1;
      const coins = sizeString(held * f, m.szDecimals);
      if (!(Number(coins) > 0)) throw new Error(`You don't have ${m.base} to sell.`);
      const ref = limitPx && limitPx > 0 ? limitPx : m.mark;
      if (Number(coins) * ref < SPOT_MIN_NOTIONAL) throw new Error(`The smallest order is $${SPOT_MIN_NOTIONAL}.`);
      const ex = await ready(onStep);
      const at = limitPx && limitPx > 0 ? limitPx : m.mark * (1 - SPOT_SLIP);
      onStep(limitPx ? "Placing the order…" : "Selling…");
      try {
        const res = await ex.order({
          orders: [{ a: m.asset, b: false, p: spotPriceString(at, m.szDecimals), s: coins, r: false, t: { limit: { tif: limitPx ? "Gtc" : "Ioc" } } }],
          grouping: "na",
          builder,
        });
        const first = res.response.data.statuses[0];
        onStep(null);
        void after();
        if (first && typeof first === "object" && "filled" in first) return { avgPx: Number(first.filled.avgPx), usd: Number(first.filled.avgPx) * Number(first.filled.totalSz) };
        if (limitPx && first && typeof first === "object" && "resting" in first) return { avgPx: null, usd: Number(coins) * limitPx, resting: true };
        throw new Error("The order didn't fill. Try again.");
      } catch (e) {
        throw hlError(e);
      }
    },

    async spotCancel(m, oid) {
      const ex = await ready(() => {});
      try {
        await ex.cancel({ cancels: [{ a: m.asset, o: oid }] });
      } catch (e) {
        throw hlError(e);
      }
      void after();
    },
  };

  /** Makes sure the futures side of a standard account can spend `need` dollars (moving spot dollars over). */
  async function futuresDollars(need: number, onStep: (m: string | null) => void) {
    if (!user) return;
    const mode = await fetchAccountMode(user);
    if (mode !== "standard") return;
    const perp = Number((await info<{ withdrawable?: string }>({ type: "clearinghouseState", user: user.toLowerCase() }).catch(() => null))?.withdrawable ?? 0);
    if (perp + 1e-6 >= need) return;
    const spot = usdcOf(await fetchSpotBalances(user).catch(() => []))?.free ?? 0;
    if (spot <= 0.01) return; // nothing to bring; Hyperliquid answers with its own message
    const move = Math.min(spot, Math.ceil((need - perp) * 100) / 100);
    onStep("Getting your dollars ready…");
    try {
      await mainClient().usdClassTransfer({ amount: (Math.floor(move * 100) / 100).toFixed(2), toPerp: true });
    } catch (e) {
      throw hlError(e);
    }
  }

  /**
   * Makes sure the spot side holds `need` dollars. A unified account has one balance (nothing to
   * do); a standard one gets the difference moved over from its futures side.
   */
  async function spotDollars(need: number, onStep: (m: string | null) => void) {
    if (!user) throw new Error("Sign in first.");
    const mode = await fetchAccountMode(user);
    const spot = usdcOf(await fetchSpotBalances(user).catch(() => []))?.free ?? 0;
    if (mode !== "standard") {
      if (spot + 1e-6 < need) throw new Error(`Not enough in your trading balance ($${spot.toFixed(2)}). Add money first.`);
      return;
    }
    if (spot + 1e-6 >= need) return;
    const perp = Number((await info<{ withdrawable?: string }>({ type: "clearinghouseState", user: user.toLowerCase() }).catch(() => null))?.withdrawable ?? 0);
    const move = Math.ceil((need - spot) * 100) / 100;
    if (move > perp + 1e-6) throw new Error(`Not enough in your trading balance ($${(spot + perp).toFixed(2)}). Add money first.`);
    onStep("Getting your dollars ready…");
    try {
      await mainClient().usdClassTransfer({ amount: move.toFixed(2), toPerp: false });
    } catch (e) {
      throw hlError(e);
    }
    // the order needs to see them
    for (let i = 0; i < 10; i++) {
      const now = usdcOf(await fetchSpotBalances(user).catch(() => []))?.free ?? 0;
      if (now + 1e-6 >= need) return;
      await new Promise((r) => setTimeout(r, 700));
    }
  }
}
