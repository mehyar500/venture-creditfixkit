// functions/api/creditfix/pdf.js
// GET /api/creditfix/pdf?token=<access_token>
// Streams the generated kit PDF from R2 as an attachment.
// Allowed while status is paid|generating|ready (generating lets a buyer
// retry-download mid-build); 404 on bogus token or missing PDF.

export async function onRequestGet({ request, env }) {
  const token = new URL(request.url).searchParams.get("token") || "";
  if (token.length < 16) {
    return Response.json({ ok: false, error: "invalid_token" }, { status: 403 });
  }
  const db = env.LEADS_DB;
  if (!db) return Response.json({ ok: false, error: "no_db" }, { status: 503 });
  const order = await db
    .prepare("SELECT status FROM creditfixkit_orders WHERE access_token = ?")
    .bind(token)
    .first();
  if (!order) return Response.json({ ok: false, error: "unknown_order" }, { status: 404 });
  if (!["paid", "generating", "ready"].includes(order.status)) {
    return Response.json({ ok: false, error: "not_available", status: order.status }, { status: 409 });
  }
  if (!env.DELIVERABLES) return Response.json({ ok: false, error: "no_storage" }, { status: 503 });
  const obj = await env.DELIVERABLES.get("pdfs/" + token + ".pdf");
  if (!obj) return Response.json({ ok: false, error: "pdf_not_ready" }, { status: 404 });
  return new Response(obj.body, {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": 'attachment; filename="creditfix-kit.pdf"',
      "cache-control": "no-store",
    },
  });
}
