// Notifications: the in-site bell (notifications table) + web push to the user's devices.
// Env: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY (create once: npx web-push generate-vapid-keys).
import webpush from "web-push";

const log = (...a) => console.log(new Date().toISOString(), "notify:", ...a);

export function makeNotifier(db) {
  const pub = (process.env.VAPID_PUBLIC_KEY || "").trim(), priv = (process.env.VAPID_PRIVATE_KEY || "").trim();
  const push = !!(pub && priv);
  if (push) webpush.setVapidDetails(process.env.VAPID_SUBJECT || "mailto:team@arkhampad.com", pub, priv);
  else log("web push off (no VAPID keys); the in-site bell still works");

  async function sendPush(user, payload) {
    if (!push) return;
    const { rows } = await db.query(`select endpoint, keys from push_subs where "user"=$1`, [user]);
    await Promise.allSettled(rows.map(async (s) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, JSON.stringify(payload), { TTL: 3600, urgency: "high" });
      } catch (e) {
        if (e.statusCode === 404 || e.statusCode === 410) await db.query("delete from push_subs where endpoint=$1", [s.endpoint]); // phone unsubscribed
      }
    }));
  }

  /** One notification to one user. Never throws (a failed notification must not break trading). */
  async function notify(user, n) {
    try {
      const u = String(user).toLowerCase();
      await db.query(`insert into notifications ("user", kind, title, body, url) values ($1,$2,$3,$4,$5)`, [u, n.kind, n.title.slice(0, 120), n.body.slice(0, 300), n.url || "/"]);
      await sendPush(u, { title: n.title, body: n.body, url: n.url || "/" });
    } catch (e) { log(`failed: ${e.message}`); }
  }
  const notifyMany = async (users, n) => { for (const u of users) await notify(u, n); };
  return { notify, notifyMany, publicKey: push ? pub : null };
}
