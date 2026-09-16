// functions/api/creditfix/teaser.js
// POST /api/creditfix/teaser — free score-factor explainer preview.
// Body: { situation: "collections"|"late-payments"|"thin-file"|"mixed",
//         state?: "NY", name?: "..." }
// Free, no auth. Deterministic templates (no AI). Light in-memory rate limit.

import { buildTeaser } from "./_lib/kit.js";

const RL_CAP = 30; // per IP per 15 min (per isolate)
const RL = new Map();

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

export async function onRequestPost({ request }) {
  try {
    const ip = request.headers.get("cf-connecting-ip") || "unknown";
    const now = Date.now();
    const arr = (RL.get(ip) || []).filter((ts) => now - ts < 15 * 60 * 1000);
    if (arr.length >= RL_CAP) return json({ ok: false, error: "rate_limited" }, 429);
    arr.push(now);
    RL.set(ip, arr);

    let body = {};
    try { body = await request.json(); } catch { return json({ ok: false, error: "bad_json" }, 400); }
    const situation = String(body.situation || "").toLowerCase();
    if (!["collections", "late-payments", "thin-file", "mixed"].includes(situation)) {
      return json({ ok: false, error: "unknown_situation" }, 400);
    }
    const teaser = buildTeaser({
      situation,
      state: String(body.state || "").slice(0, 2),
      name: String(body.name || "").slice(0, 120),
      goal: String(body.goal || "rebuild-general").slice(0, 32),
    });
    return json(teaser);
  } catch (e) {
    console.error("creditfix/teaser failed", e && e.message);
    return json({ ok: false, error: "teaser_failed" }, 500);
  }
}
