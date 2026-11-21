// POST /api/subscribe-phone — phone-led signup for CreditFix Kit
// (fleet SMS capture contract, 🔵 standard filed 2026-11-20/21).
// Requires sms_consent === true (the form's explicit, unchecked-by-default
// TCPA checkbox, copy version fleet-sms-v1-2026-11-21); the consent version
// + timestamp are logged with the row. Storage mirrors the fleet pattern
// (doomready_subscribers shape): rows land in creditfixkit_subscribers —
// subscribers_global is email-keyed (email NOT NULL), so phone-led
// captures live in the brand table the SMS tooling reads. Collection +
// storage ONLY: no SMS is sent by this endpoint. Suppression-safe: an
// opted_out row is never reactivated.
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}
const PHONE_RE = /^\+?[0-9 ()-]{7,20}$/;
const DEFAULT_CONSENT_VERSION = "fleet-sms-v1-2026-11-21";

function cleanPhone(raw) {
  const v = String(raw || "").trim().slice(0, 24);
  if (!PHONE_RE.test(v)) return null;
  const digits = v.replace(/\D/g, "");
  if (digits.length === 10) return "+1" + digits;
  if (digits.length >= 7 && digits.length <= 15) return "+" + digits;
  return null;
}
function cleanZip(raw) {
  if (!raw) return null;
  const v = String(raw).trim().slice(0, 10);
  return /^[0-9A-Za-z -]{3,10}$/.test(v) ? v : null;
}
function cleanName(raw) {
  if (!raw) return null;
  const v = String(raw).trim().replace(/\s+/g, " ").slice(0, 120);
  return v || null;
}

export async function onRequestPost({ request, env }) {
  if (!env || !env.LEADS_DB) return json({ ok: false, error: "service_unavailable" }, 503);
  const db = env.LEADS_DB;
  const body = await request.json().catch(() => ({}));
  if (body.sms_consent !== true) return json({ ok: false, error: "consent_required" }, 400);
  const phone = cleanPhone(body.phone);
  if (!phone) return json({ ok: false, error: "invalid_phone" }, 400);
  const zip = cleanZip(body.zip);
  const name = cleanName(body.first_name) || cleanName(body.name);
  const source = String(body.source || "sms_landing").trim().slice(0, 60) || "sms_landing";
  const cv = String(body.consent_version || "").trim();
  const consentVersion = /^[A-Za-z0-9._-]{1,64}$/.test(cv) ? cv : DEFAULT_CONSENT_VERSION;
  try {
    const existing = await db.prepare(
      "SELECT status FROM creditfixkit_subscribers WHERE phone = ?"
    ).bind(phone).first();
    if (existing && existing.status === "opted_out") {
      return json({ ok: true, note: "previously_opted_out" });
    }
    await db.prepare(
      "INSERT INTO creditfixkit_subscribers (phone, zip, status, source, sms_consent, consent_version, consent_at, token, name) " +
      "VALUES (?, ?, 'active', ?, 1, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'), ?, ?) " +
      "ON CONFLICT(phone) DO UPDATE SET " +
      "status = CASE WHEN creditfixkit_subscribers.status='opted_out' THEN 'opted_out' ELSE 'active' END, " +
      "zip = COALESCE(excluded.zip, creditfixkit_subscribers.zip), sms_consent = 1, " +
      "name = COALESCE(excluded.name, creditfixkit_subscribers.name), " +
      "consent_version = excluded.consent_version, consent_at = excluded.consent_at"
    ).bind(phone, zip, source, consentVersion, crypto.randomUUID(), name).run();
    return json({ ok: true });
  } catch (e) {
    console.error("creditfixkit phone subscribe failed", e && e.message);
    return json({ ok: false, error: "subscribe_failed" }, 500);
  }
}
