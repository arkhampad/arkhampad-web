// Elysium fee keeper: every 30 minutes, collects the trading fees of every ArkhamPad coin that traded
// since the last round (launcher.collectMany). The launcher pays each coin's creator 30% and the
// ArkhamPad treasury 70%, in native HYPE and in the coin. Anyone may call collect; this wallet only
// pays the gas. Runs when KEEPER_KEY (a private key with a little HYPE on Elysium) is set on Railway.
//
// Self-funding: when the launcher's treasury is set to this keeper wallet (owner, once, on /ops), the
// platform's share lands here first. After every round the keeper keeps KEEPER_FLOOR HYPE (default 0.1)
// for its own gas and forwards everything above it, plus the coin-side fees, to the real treasury
// (KEEPER_FORWARD_TO). So the keeper never runs dry and nobody has to top it up.
import { createPublicClient, createWalletClient, defineChain, fallback, http, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const ABI = parseAbi(["function collectMany(address[] list)", "function treasury() view returns (address)", "function coins(address) view returns (uint256 tokenId, address pool, address creator, uint16 creatorBps, bool coinIsToken0)"]);
const ERC20 = parseAbi(["function balanceOf(address) view returns (uint256)", "function transfer(address,uint256) returns (bool)"]);
const FORWARD_TO = (process.env.KEEPER_FORWARD_TO || "0xd9D46EB26c9D753135683b7736FC2be097e7B099").trim();
const FLOOR = BigInt(Math.round(Number(process.env.KEEPER_FLOOR || "0.1") * 1e6)) * 10n ** 12n;
const MIN_SEND = 10n ** 16n; // don't forward dust (0.01 HYPE)
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
      // only coins our launcher made (another pool on the same factory would revert UnknownCoin)
      const coins = [];
      for (const r of rows) {
        try {
          const c = await pub.readContract({ address: launcher, abi: ABI, functionName: "coins", args: [r.address] });
          if (c[1] && !/^0x0{40}$/i.test(c[1])) coins.push(r.address);
        } catch {}
      }
      for (let i = 0; i < coins.length; i += BATCH) {
        const list = coins.slice(i, i + BATCH);
        try {
          const hash = await wallet.writeContract({ address: launcher, abi: ABI, functionName: "collectMany", args: [list] });
          const r = await pub.waitForTransactionReceipt({ hash, timeout: 180_000, pollingInterval: 1000 });
          log(`keeper: collected fees for ${list.length} coins (${r.status})`);
        } catch (e) {
          // one bad coin must not block the rest: retry this batch one by one
          for (const c of list) {
            try {
              const hash = await wallet.writeContract({ address: launcher, abi: ABI, functionName: "collectMany", args: [[c]] });
              await pub.waitForTransactionReceipt({ hash, timeout: 180_000, pollingInterval: 1000 });
            } catch (e2) {
              log(`keeper: ${c} ${String(e2.shortMessage || e2.message).slice(0, 120)}`);
            }
          }
        }
      }
      since = started;
      // self-funding: forward what's above the gas floor (only when fees are routed through this wallet)
      const routed = String(await pub.readContract({ address: launcher, abi: ABI, functionName: "treasury" })).toLowerCase() === account.address.toLowerCase();
      if (routed && FORWARD_TO.toLowerCase() !== account.address.toLowerCase()) {
        for (const c of coins) {
          try {
            const amt = await pub.readContract({ address: c, abi: ERC20, functionName: "balanceOf", args: [account.address] }).catch(() => 0n);
            if (amt > 0n) {
              const h = await wallet.writeContract({ address: c, abi: ERC20, functionName: "transfer", args: [FORWARD_TO, amt] });
              await pub.waitForTransactionReceipt({ hash: h, timeout: 120_000 });
            }
          } catch (e) {
            log(`keeper: forward coin ${c}: ${String(e.shortMessage || e.message).slice(0, 100)}`);
          }
        }
        const now = await pub.getBalance({ address: account.address });
        if (now > FLOOR + MIN_SEND) {
          const value = now - FLOOR;
          const h = await wallet.sendTransaction({ to: FORWARD_TO, value });
          await pub.waitForTransactionReceipt({ hash: h, timeout: 120_000 });
          log(`keeper: forwarded ${Number(value) / 1e18} HYPE to the treasury`);
        }
      }
    } catch (e) {
      log(`keeper: ${String(e.shortMessage || e.message).slice(0, 200)}`);
    }
    await new Promise((r) => setTimeout(r, EVERY_MS));
  }
}
