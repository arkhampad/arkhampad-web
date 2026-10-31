// POST /api/ely-faucet {address}: sends a little TEST HYPE (Elysium testnet, chain 99801) so anyone, also
// email sign-ups with an empty wallet, can try ArkhamPad on testnet. Paid from the wallet in Cloudflare
// secret FAUCET_KEY (a testnet-only wallet, never a real one). Once per address and per visitor every 24 h.
// Env: FAUCET_KEY (secret), TESTNET_RPC (optional), FAUCET_AMOUNT (optional, HYPE, default 0.002 — testnet gas is tiny, so this covers dozens of trades).
import { createWalletClient, createPublicClient, http, parseEther, isAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const DEFAULT_RPC = "https://rpc-elysium-testnet.t.conduit.xyz";
const chain = (rpc) => ({ id: 99801, name: "Elysium Testnet", nativeCurrency: { name: "HYPE", symbol: "HYPE", decimals: 18 }, rpcUrls: { default: { http: [rpc] } } });
const json = (b, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

export async function onRequestPost({ request, env, waitUntil }) {
  if (!env.FAUCET_KEY) return json({ error: "The test faucet isn't switched on yet." }, 503);
  let address = "";
  try { address = String((await request.json()).address || "").toLowerCase(); } catch {}
  if (!isAddress(address)) return json({ error: "Bad address." }, 400);
  const ip = request.headers.get("cf-connecting-ip") || "unknown";
  const u = new URL(request.url);
  const cache = caches.default;
  const keys = [`a:${address}`, `i:${ip}`].map((k) => new Request(`${u.origin}/__faucet/${encodeURIComponent(k)}`));
  for (const k of keys) if (await cache.match(k)) return json({ error: "You already got test HYPE today. Come back tomorrow." }, 429);

  const rpc = env.TESTNET_RPC || DEFAULT_RPC;
  const key = String(env.FAUCET_KEY).trim();
  const account = privateKeyToAccount(key.startsWith("0x") ? key : `0x${key}`);
  const amount = parseEther(String(env.FAUCET_AMOUNT || "0.002"));
  try {
    const pub = createPublicClient({ chain: chain(rpc), transport: http(rpc, { timeout: 8000 }) });
    const left = await pub.getBalance({ address: account.address });
    if (left < amount * 2n) return json({ error: "The test faucet is empty right now. Please try again later." }, 503);
    const wallet = createWalletClient({ account, chain: chain(rpc), transport: http(rpc, { timeout: 15000 }) });
    const hash = await wallet.sendTransaction({ to: address, value: amount });
    const mark = new Response("1", { headers: { "cache-control": "public, s-maxage=86400" } });
    waitUntil(Promise.all(keys.map((k) => cache.put(k, mark.clone()))));
    return json({ hash, amount: String(env.FAUCET_AMOUNT || "0.002") });
  } catch (e) {
    return json({ error: "Couldn't send test HYPE right now. Please try again in a minute.", detail: String(e?.shortMessage || e?.message || e).slice(0, 160) }, 502);
  }
}
