/* CreditFix Kit — shared app logic.
 *
 * PRODUCTION DEFAULT: the buy form POSTs the real payload to
 * https://mehyar.us/api/pay/checkout and redirects to Stripe.
 * DEV MODE is opt-in ONLY via ?dev=1 (shows the payload modal instead of
 * charging). Never the default, never silent.
 */
"use strict";

/* Explicit opt-in: ?dev=1. Anything else = production checkout. */
var DEV_MODE = new URLSearchParams(window.location.search).get("dev") === "1";
var CHECKOUT_URL = "https://mehyar.us/api/pay/checkout";
var TEASER_URL = "/api/creditfix/teaser";
var SUBSCRIBE_URL = "/api/creditfix/subscribe";

var PRODUCT = {
  id: "creditfix-kit",
  name: "CreditFix Kit",
  price: "$47",
  success_url: "https://creditfixkit.mehyar.us/success.html",
  cancel_url: "https://creditfixkit.mehyar.us/#pricing"
};

/* ---------- helpers ---------- */
function $(sel, root) { return (root || document).querySelector(sel); }
function $all(sel, root) { return Array.from((root || document).querySelectorAll(sel)); }
function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function validEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(email).trim());
}

/* ---------- checkout params (≤2048 bytes JSON enforced) ---------- */
function checkoutParams() {
  var params = {
    name: $("#buy-name").value.trim().slice(0, 120),
    situation: $("#buy-situation").value,
    state: $("#buy-state").value.trim().toUpperCase().slice(0, 2),
    goal: $("#buy-goal").value,
    accounts: $("#buy-accounts").value.trim().slice(0, 600)
  };
  return params;
}

function checkoutPayload(email, params) {
  var payload = {
    product_id: PRODUCT.id,
    email: email,
    params: params,
    success_url: PRODUCT.success_url,
    cancel_url: PRODUCT.cancel_url
  };
  if (DEV_MODE) payload.test = true; // dev checkout only ever hits test mode
  return payload;
}

function openBuyModal() {
  $("#buy-error").textContent = "";
  $("#buy-modal").hidden = false;
  $("#buy-email").focus();
}
function closeBuyModal() { $("#buy-modal").hidden = true; }

function devCheckout(email, params) {
  var payload = checkoutPayload(email, params);
  $("#payload-pre").textContent =
    "POST " + CHECKOUT_URL + "\n\n" + JSON.stringify(payload, null, 2) +
    "\n\nparams JSON bytes: " + new Blob([JSON.stringify(params)]).size + " / 2048";
  $("#payload-modal").hidden = false;
}

async function liveCheckout(email, params) {
  var payload = checkoutPayload(email, params);
  var res;
  try {
    res = await fetch(CHECKOUT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
  } catch (e) {
    return { ok: false, error: "Couldn't reach checkout — check your connection and try again." };
  }
  var data = null;
  try { data = await res.json(); } catch (e) { /* fall through */ }
  if (!res.ok || !data || data.ok !== true || !data.checkout_url) {
    var msg = (data && (data.message || data.error)) || ("Checkout failed (HTTP " + res.status + ").");
    return { ok: false, error: String(msg).slice(0, 200) };
  }
  window.location.href = data.checkout_url;
  return { ok: true };
}

/* ---------- free teaser ---------- */
function renderTeaser(t) {
  var host = $("#teaser-result");
  var e = t.explainer || {};
  var html = '<div class="free-preview-banner" style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;background:rgba(245,185,66,.08);border:1px solid rgba(245,185,66,.35);border-radius:12px;padding:12px 16px;margin:0 0 16px;font-size:15px">' +
    '<span style="background:linear-gradient(135deg,#f5b942,#d98a1f);color:#231600;font-weight:800;font-size:12px;letter-spacing:1.5px;padding:5px 12px;border-radius:999px;white-space:nowrap">FREE PREVIEW</span>' +
    '<span>This is the knowledge layer. <a href="#pricing" style="color:var(--accent);font-weight:700">Unlock the $47 kit</a> for the mail-ready letters + your 12-month plan.</span></div>';
  html += "<p style='color:var(--muted);font-size:15px'>" + esc(e.intro || "") + "</p>";
  html += '<div class="factor-grid">';
  (e.factors || []).forEach(function (f) {
    html += '<div class="factor-card"><h3>' + esc(f.name) + ' <span class="w">' + esc(f.weight) + '</span></h3>' +
      "<p>" + esc(f.what_it_means) + "</p>" +
      "<p><strong>Your angle:</strong> " + esc(f.your_angle) + "</p></div>";
  });
  html += "</div>";
  html += '<h3 style="margin-top:22px">Locked in the $47 kit — your letters</h3><ul class="locked-list">';
  (t.locked_letters || []).forEach(function (l) {
    html += '<li><span class="lock-ico">🔒</span><span><strong>' + esc(l.title) + '</strong>' + esc(l.blurb) + "</span></li>";
  });
  html += "</ul>";
  html += "<p style='margin-top:14px'><strong>" + esc(t.cta || "") + "</strong></p>";
  html += '<div class="disclaimer-strip" style="margin-top:14px"><strong>Disclaimer:</strong> ' + esc(t.disclaimer || "") + "</div>";
  host.innerHTML = html;
  host.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function submitTeaser(ev) {
  ev.preventDefault();
  var statusEl = $("#teaser-status");
  var resultEl = $("#teaser-result");
  resultEl.innerHTML = "";
  statusEl.textContent = "Building your explainer…";
  statusEl.className = "status busy";
  var body = {
    situation: $("#teaser-situation").value,
    goal: $("#teaser-goal").value
  };
  fetch(TEASER_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  }).then(function (r) {
    if (!r.ok) throw new Error("HTTP " + r.status);
    return r.json();
  }).then(function (j) {
    statusEl.textContent = "";
    statusEl.className = "status";
    if (j && j.ok) renderTeaser(j);
    else {
      statusEl.textContent = "Hmm, that didn't load. Try again in a moment.";
      statusEl.className = "status error";
    }
  }).catch(function () {
    statusEl.textContent = "";
    statusEl.className = "status";
    resultEl.innerHTML =
      '<div class="disclaimer-strip"><strong>Dev backend not running.</strong><br>' +
      "This is where your free score-factor explainer would appear. The form POSTs to " +
      "<code>" + esc(TEASER_URL) + "</code> and renders the 5 factors + locked letters here.</div>";
  });
}

/* ---------- subscribe ---------- */
function initSubscribeForms() {
  $all("[data-subscribe-form]").forEach(function (form) {
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var msg = form.querySelector(".subscribe-msg");
      var btn = form.querySelector('button[type="submit"]');
      var email = form.email ? form.email.value.trim() : "";
      if (!validEmail(email)) {
        if (msg) { msg.hidden = false; msg.textContent = "Please enter a valid email address."; }
        return;
      }
      if (btn) { btn.disabled = true; btn.textContent = "Subscribing…"; }
      fetch(SUBSCRIBE_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email, situation: ($("#teaser-situation") || {}).value || null })
      }).then(function (r) { return r.json(); }).then(function (j) {
        if (msg) {
          msg.hidden = false;
          msg.textContent = j && j.ok
            ? "You're in — credit tips, occasionally. Unsubscribe anytime."
            : "Hmm, that didn't go through. Try again in a bit.";
        }
        if (j && j.ok) form.reset();
      }).catch(function () {
        if (msg) { msg.hidden = false; msg.textContent = "Hmm, that didn't go through. Try again in a bit."; }
      }).finally(function () {
        if (btn) { btn.disabled = false; btn.textContent = "Subscribe"; }
      });
    });
  });
}

/* ---------- global wiring ---------- */
document.addEventListener("DOMContentLoaded", function () {
  $all("[data-buy]").forEach(function (btn) {
    btn.addEventListener("click", openBuyModal);
  });
  initSubscribeForms();

  if (DEV_MODE && document.body) {
    var banner = document.createElement("div");
    banner.className = "dev-notice";
    banner.style.cssText = "position:sticky;top:0;z-index:9999;text-align:center;padding:8px;font-weight:700";
    banner.textContent = "DEV MODE (?dev=1) — no real checkout, no charges. Remove ?dev=1 for production.";
    document.body.insertBefore(banner, document.body.firstChild);
  }

  var tf = $("#teaser-form");
  if (tf) tf.addEventListener("submit", submitTeaser);

  var buyClose = $("#buy-close");
  if (buyClose) buyClose.addEventListener("click", closeBuyModal);

  var buyForm = $("#buy-form");
  if (buyForm) {
  buyForm.addEventListener("submit", function (e) {
    e.preventDefault();
    var err = $("#buy-error");
    var name = $("#buy-name").value.trim();
    var email = $("#buy-email").value.trim();
    var state = $("#buy-state").value.trim().toUpperCase();
    if (!name) { err.textContent = "Enter your full name — it goes on your letters."; return; }
    if (!validEmail(email)) { err.textContent = "Enter a valid email — your kit PDF goes there."; return; }
    if (!/^[A-Z]{2}$/.test(state)) { err.textContent = "Enter your 2-letter state code (e.g. NY)."; return; }
    err.textContent = "";
    var params = checkoutParams();
    var size = new Blob([JSON.stringify(params)]).size;
    if (size > 2048) { err.textContent = "Your details are too long (" + size + " bytes) — shorten the accounts field."; return; }
    if (DEV_MODE) { devCheckout(email, params); closeBuyModal(); return; }
    var btn = buyForm.querySelector('button[type="submit"]');
    if (btn) { btn.disabled = true; btn.textContent = "Starting secure checkout…"; }
    liveCheckout(email, params).then(function (r) {
      if (!r.ok) {
        err.textContent = r.error;
        if (btn) { btn.disabled = false; btn.textContent = "Continue to secure checkout — $47"; }
      }
    });
  });

  $("#payload-close").addEventListener("click", function () {
    $("#payload-modal").hidden = true;
  });
  } /* end if (buyForm) */
});
