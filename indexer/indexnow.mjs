// IndexNow: tell Bing (and Yandex, Seznam, Naver…) about new pages within a minute, instead of
// waiting for them to re-read the sitemap. Google doesn't use IndexNow; it reads /sitemap-coins.xml.
// Env (optional): INDEXNOW_KEY (must match web/public/<key>.txt), SITE_URL.
const SITE = (process.env.SITE_URL || "https://arkhampad.com").replace(/\/$/, "");
const KEY = process.env.INDEXNOW_KEY || "3ddc1bd04f4161fe2559c6c8ff2e21d9";
const queue = new Set();
let timer = null;

async function send(urls) {
  if (!urls.length) return;
  const host = new URL(SITE).host;
  try {
    const r = await fetch("https://api.indexnow.org/indexnow", {
      method: "POST",
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({ host, key: KEY, keyLocation: `${SITE}/${KEY}.txt`, urlList: urls.slice(0, 10000) }),
    });
    // 200/202 = accepted. On an error, log IndexNow's own explanation too.
    const why = r.status >= 400 ? ` ${(await r.text().catch(() => "")).slice(0, 200)}` : "";
    console.log(`${new Date().toISOString()} indexnow: ${urls.length} url(s) -> ${r.status}${why}`);
  } catch (e) { console.log(`indexnow: ${e.message}`); }
}

/** Queue a page; sent in one batch about a minute later. */
export function announce(path) {
  queue.add(path.startsWith("http") ? path : `${SITE}${path}`);
  if (!timer) timer = setTimeout(() => { timer = null; const urls = [...queue]; queue.clear(); send(urls); }, 60_000);
}
export const coinPath = (chainId, address) => `/coin/?c=${chainId}-${String(address).toLowerCase()}`;

/** Once a day: send every page in the sitemap (Learn articles, main pages). */
export function startIndexNow() {
  const run = async () => {
    try {
      const xml = await (await fetch(`${SITE}/sitemap.xml`)).text();
      const urls = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
      await send(urls);
    } catch (e) { console.log(`indexnow sitemap: ${e.message}`); }
  };
  setTimeout(run, 30_000);
  setInterval(run, 24 * 3600_000);
}
