// Router check: proves the ArkhamPad router (contracts-elysium/src/ArkhamRouter.sol) can buy AND sell
// real Elysium tokens, before it is deployed. Each check is one eth_call where the router and a
// small test contract are placed on the chain only for that call (state override), with fake HYPE.
// Nothing is sent, nothing is spent.
import { readFileSync } from "node:fs";

const CODE = JSON.parse(readFileSync(new URL("./router-code.json", import.meta.url), "utf8"));
const ROUTER = "0x00000000000000000000000000000000a4c0de01";
const PROBE = "0x00000000000000000000000000000000a4c0de02";
const CALLER = "0x00000000000000000000000000000000a4c0de03";
const TREASURY = "d9d46eb26c9d753135683b7736fc2be097e7b099";
const FEE_BPS = 50;
const SEL_RUN = "9752f202";
const ERRORS = { "44c8ad13": "Quote", "203d82d8": "Expired", "0f2e5b6c": "Locked", "618bc7c9": "TooLittle", "81063e51": "SendFailed", "4e487b71": "Panic", "08c379a0": "Error" };
const STAGES = ["", "quote buy", "buy", "quote sell", "sell", "ok"];

const w = (hex) => hex.replace(/^0x/, "").toLowerCase().padStart(64, "0");
const num = (n) => w(BigInt.asUintN(256, BigInt(n)).toString(16));
const slot = (i) => "0x" + w(i.toString(16));

function encodeRun(t) {
  const v4 = t.venue === "v4";
  const target = v4 ? t.manager : t.pool;
  return "0x" + SEL_RUN + w(ROUTER) + num(v4 ? 4 : 3) + w(target) + w(t.address) + w(t.whype || "0x0") + num(t.token_is0 ? 1 : 0) + num(t.fee || 0) + num(t.tick_spacing || 0) + w(t.hooks || "0x0");
}

function decode(ret) {
  const h = ret.replace(/^0x/, "");
  const word = (i) => BigInt("0x" + h.slice(i * 64, i * 64 + 64));
  const stage = Number(word(0));
  const off = Number(word(5)) * 2;
  const len = Number(BigInt("0x" + h.slice(off, off + 64)));
  const err = h.slice(off + 64, off + 64 + len * 2);
  return { stage, qb: word(1), bought: word(2), qs: word(3), back: word(4), err };
}

const errName = (e) => (e ? ERRORS[e.slice(0, 8)] || `0x${e.slice(0, 8)}` : "no data");

export async function checkRouter(rpc, tokens, hypeIn = 10n ** 17n) {
  const override = {
    [ROUTER]: {
      code: CODE.router,
      stateDiff: {
        [slot(1)]: "0x" + w(((BigInt(FEE_BPS) << 160n) | BigInt("0x" + TREASURY)).toString(16)),
        [slot(5)]: slot(1),
      },
    },
    [PROBE]: { code: CODE.probe },
    [CALLER]: { balance: "0x" + (10n ** 21n).toString(16) },
  };
  const results = [];
  for (const t of tokens) {
    const data = encodeRun(t);
    const body = { jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ from: CALLER, to: PROBE, data, value: "0x" + hypeIn.toString(16), gas: "0x1c9c380" }, "latest", override] };
    let r;
    try {
      const res = await fetch(rpc, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      r = await res.json();
    } catch (e) {
      results.push({ symbol: t.symbol, pad: t.launchpad, venue: t.venue, result: `rpc error: ${e.message}` });
      continue;
    }
    if (r.error) {
      results.push({ symbol: t.symbol, pad: t.launchpad, venue: t.venue, result: `call failed: ${r.error.message}` });
      continue;
    }
    const d = decode(r.result);
    const row = { symbol: t.symbol, address: t.address, pad: t.launchpad, venue: t.venue, hooks: t.hooks && !/^0x0+$/.test(t.hooks) ? t.hooks : null };
    if (d.stage === 5) {
      row.result = "ok";
      row.quoteMatchesBuy = d.qb === d.bought;
      row.quoteMatchesSell = d.qs === d.back;
      row.roundTripPct = +((Number(d.back) / Number(hypeIn)) * 100).toFixed(2); // HYPE back after buying and selling at once
    } else {
      row.result = `failed at ${STAGES[d.stage]}: ${errName(d.err)}`;
    }
    results.push(row);
  }
  const ok = results.filter((x) => x.result === "ok").length;
  return { hypeIn: Number(hypeIn) / 1e18, checked: results.length, ok, results };
}
