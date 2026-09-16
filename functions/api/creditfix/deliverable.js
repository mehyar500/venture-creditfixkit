// functions/api/creditfix/deliverable.js
// GET /api/creditfix/deliverable?token=<access_token>
// Returns the order's manifest + pdf_url. The access token is the capability.
// Bogus token -> 404 {ok:false}. Not-ready -> 409 with status.

export async function onRequestGet({ request, env }) {
  const token = new URL(request.url).searchParams.get("token") || "";
  if (token.length < 16) {
    return Response.json({ ok: false, error: "invalid_token" }, { status: 403 });
  }
  const db = env.LEADS_DB;
  if (!db) return Response.json({ ok: false, error: "no_db" }, { status: 503 });
  const order = await db
    .prepare("SELECT id, product_id, email, status, output_json, ready_at FROM creditfixkit_orders WHERE access_token = ?")
    .bind(token)
    .first();
  if (!order) return Response.json({ ok: false, error: "unknown_order" }, { status: 404 });
  if (order.status !== "ready") {
    return Response.json(
      { ok: false, error: "not_ready", status: order.status },
      { status: 409 }
    );
  }
  let manifest = {};
  try { manifest = JSON.parse(order.output_json || "{}"); } catch {}
  return Response.json(
    {
      ok: true,
      status: order.status,
      email: order.email,
      manifest,
      pdf_url: "/api/creditfix/pdf?token=" + encodeURIComponent(token),
      ready_at: order.ready_at,
    },
    { headers: { "cache-control": "no-store" } }
  );
}
