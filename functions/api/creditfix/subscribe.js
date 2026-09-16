// functions/api/creditfix/subscribe.js
// POST /api/creditfix/subscribe — { email, situation? }
// CreditFix Kit lead capture. Email required; situation optional.
// Dedupes on email (INSERT OR IGNORE). Returns {ok:true} always on valid email.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

const RL = new Map();
function rateLimitOk(ip) {
  const now = Date.now();
  const arr = (RL.get(ip) || []).filter((ts) => now - ts < 15 * 60 * 1000);
  if (arr.length >= 10) return false;
  arr.push(now);
  RL.set(ip, arr);
  return true;
}

export async function onRequestPost({ request, env }) {
  try {
    if (!env?.LEADS_DB) return json({ ok: false, error: "service_unavailable" }, 503);
    const ip = (request.headers.get("cf-connecting-ip") || "unknown").slice(0, 64);
    if (!rateLimitOk(ip)) return json({ ok: false, error: "rate_limited" }, 429);

    const body = await request.json().catch(() => ({}));
    const email = String(body.email || "").trim().toLowerCase().slice(0, 254);
    if (!EMAIL_RE.test(email)) return json({ ok: false, error: "invalid_email" }, 400);
    const situation = ["collections", "late-payments", "thin-file", "mixed"].includes(
      String(body.situation || "")
    ) ? String(body.situation) : null;

    const db = env.LEADS_DB;
    await db
      .prepare(
        "CREATE TABLE IF NOT EXISTS creditfixkit_leads (" +
          "id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT NOT NULL UNIQUE, " +
          "situation TEXT, " +
          "created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')))"
      )
      .run()
      .catch(() => {});
    await db
      .prepare("INSERT OR IGNORE INTO creditfixkit_leads (email, situation) VALUES (?, ?)")
      .bind(email, situation)
      .run();

    return json({ ok: true });
  } catch (e) {
    console.error("creditfix/subscribe failed", e && e.message);
    return json({ ok: false, error: "subscribe_failed" }, 500);
  }
}
