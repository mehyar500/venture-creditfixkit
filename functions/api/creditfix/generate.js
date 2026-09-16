// functions/api/creditfix/generate.js
// POST /api/creditfix/generate — build the paid CreditFix Kit PDF.
// Body: { order_token: "<creditfixkit_orders.access_token>", inputs?: {...} }
//   inputs merge over the intake stored at checkout (same shape as checkout params).
//
// Auth: the order's access_token is the capability. Requires status paid|failed.
//   status=ready -> {ok:true, replay:true, manifest} (idempotent, no re-render).
// Flow: set status='generating' -> buildKit -> renderKitPdf -> R2 put
//   `pdfs/<token>.pdf` -> UPDATE status='ready', output_json, ready_at.
// On error: status='failed' + {ok:false, error} (client offers Retry).

import { buildKit, intake } from "./_lib/kit.js";
import { renderKitPdf, countPages } from "./_lib/pdf.js";

const nowSql = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

export async function onRequestPost({ request, env }) {
  try {
    const db = env.LEADS_DB;
    if (!db) return json({ ok: false, error: "no_db" }, 503);

    let body;
    try { body = await request.json(); } catch { return json({ ok: false, error: "bad_json" }, 400); }
    const order_token = body && body.order_token;
    if (!order_token || String(order_token).length < 16) {
      return json({ ok: false, error: "missing_token" }, 400);
    }

    const order = await db
      .prepare("SELECT * FROM creditfixkit_orders WHERE access_token = ?")
      .bind(String(order_token))
      .first();
    if (!order) return json({ ok: false, error: "unknown_order" }, 404);
    if (order.product_id && order.product_id !== "creditfix-kit") {
      return json({ ok: false, error: "wrong_product" }, 403);
    }
    if (!["paid", "failed"].includes(order.status)) {
      if (order.status === "ready" && order.output_json) {
        return json({ ok: true, replay: true, manifest: JSON.parse(order.output_json) });
      }
      return json({ ok: false, error: "order_not_payable", status: order.status }, 403);
    }

    // ── merge intake: checkout params win unless the body overrides ──
    let stored = {};
    try { stored = JSON.parse(order.inputs_json || "{}"); } catch {}
    const baseInputs = (stored && stored.inputs) || stored || {};
    const merged = intake(Object.assign({}, baseInputs, (body.inputs || {})));

    await db.prepare("UPDATE creditfixkit_orders SET status='generating' WHERE id=?")
      .bind(order.id).run();

    let pdfBytes;
    try {
      const kit = buildKit(merged);
      pdfBytes = renderKitPdf(kit);
      const parsed = countPages(pdfBytes);
      var manifest = {
        ok: true,
        name: merged.name,
        situation: merged.situation,
        situation_label: kit.situation_label,
        goal: merged.goal,
        goal_label: kit.goal_label,
        pages: parsed.ok ? parsed.pages : null,
        letters: kit.letters.map((l) => ({ id: l.id, title: l.title })),
        plan_months: kit.plan.length,
        pdf_url: "/api/creditfix/pdf?token=" + encodeURIComponent(order.access_token),
        generated_at: kit.generated_at,
      };
    } catch (e) {
      console.error("creditfix/generate build failed", e && e.message);
      await db.prepare("UPDATE creditfixkit_orders SET status='failed' WHERE id=?")
        .bind(order.id).run();
      return json({ ok: false, error: "build_failed" }, 500);
    }

    if (!env.DELIVERABLES) {
      await db.prepare("UPDATE creditfixkit_orders SET status='failed' WHERE id=?")
        .bind(order.id).run();
      return json({ ok: false, error: "no_storage" }, 503);
    }
    const key = "pdfs/" + order.access_token + ".pdf";
    try {
      await env.DELIVERABLES.put(key, pdfBytes, {
        httpMetadata: { contentType: "application/pdf" },
      });
    } catch (e) {
      console.error("creditfix/generate r2 put failed", e && e.message);
      await db.prepare("UPDATE creditfixkit_orders SET status='failed' WHERE id=?")
        .bind(order.id).run();
      return json({ ok: false, error: "storage_failed" }, 500);
    }

    const nextInputs = Object.assign({}, stored, { inputs: merged });
    await db.prepare(
      "UPDATE creditfixkit_orders SET status='ready', output_json=?, ready_at=" + nowSql + ", inputs_json=? WHERE id=?"
    ).bind(JSON.stringify(manifest), JSON.stringify(nextInputs), order.id).run();

    return json({ ok: true, manifest });
  } catch (e) {
    console.error("creditfix/generate failed", e && e.message);
    return json({ ok: false, error: "generate_failed" }, 500);
  }
}
