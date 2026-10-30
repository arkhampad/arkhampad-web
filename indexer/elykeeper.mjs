// Elysium fee keeper: every 30 minutes, collects the trading fees of every ArkhamPad coin that traded
// since the last round (launcher.collectMany). The launcher pays each coin's creator 30% and the
// ArkhamPad treasury 70%, in native HYPE and in the coin. Anyone may call collect; this wallet only
// pays the gas. Runs when KEEPER_KEY (a private key with a little HYPE on Elysium) is set on Railway.
import { createPublicClient, createWalletClient, defineChain, fallback, http, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const ABI = parseAbi(["function collectMany(address[] list)"]);
const EVERY_MS = 30 * 60_000;
const BATCH = 25;

export async function keeperLoop({ rpc, launcher, key, pool, log }) {
  const urls = [...new Set([...String(rpc).split(",").map((u) => u.trim()).filter(Boolean), "https://arkhampad.com/api/ely-rpc"])];
  const transport = () => fallback(urls.map((u) => http(u, { timeout: 10_000, retryCount: 1 })));
  const chain = defineChain({ id: 99901, name: "Elysium", nativeCurrency: { name: "HYPE", symbol: "HYPE", decimals: 18 }, rpcUrls: { default: { http: urls } } });
  const account = privateKeyToAccount(key.startsWith("0x") ? key : `0x${key}`);
  const pub = createPublicClient({ chain, transport: transport() });
  const wallet = createWalletClient({ chain, account, transport: transport() });
  log(`keeper: collecting creator fees every 30 min from ${account.address}`);
  let since = new Date(Date.now() - 24 * 3600_000);
  for (;;) {
    const started = new Date();
    try {
      const bal = await pub.getBalance({ address: account.address });
      if (bal < 10n ** 15n) log(`keeper: low gas, ${Number(bal) / 1e18} HYPE left on ${account.address}`);
      const { rows } = await pool.query(
        `select distinct t.address from ely_tokens t join ely_trades x on x.token = t.address
         where t.ours and x.at > $1 order by t.address`,
        [since]
      );
      const coins = rows.map((r) => r.address);
      for (let i = 0; i < coins.length; i += BATCH) {
        const list = coins.slice(i, i + BATCH);
        try {
          const hash = await wallet.writeContract({ address: launcher, abi: ABI, functionName: "collectMany", args: [list] });
          const r = await pub.waitForTransactionReceipt({ hash, timeout: 120_000 });
          log(`keeper: collected fees for ${list.length} coins (${r.status})`);
        } catch (e) {
          // one bad coin must not block the rest: retry this batch one by one
          for (const c of list) {
            try {
              const hash = await wallet.writeContract({ address: launcher, abi: ABI, functionName: "collectMany", args: [[c]] });
              await pub.waitForTransactionReceipt({ hash, timeout: 120_000 });
            } catch (e2) {
              log(`keeper: ${c} ${String(e2.shortMessage || e2.message).slice(0, 120)}`);
            }
          }
        }
      }
      since = started;
    } catch (e) {
      log(`keeper: ${String(e.shortMessage || e.message).slice(0, 200)}`);
    }
    await new Promise((r) => setTimeout(r, EVERY_MS));
  }
}
