# CreditFix Kit PWA — Integration Guide (webhook agent)

**Product:** CreditFix Kit — $47 one-time DIY credit repair kit.
**PWA origin:** https://creditfixkit.mehyar.us
**Code:** `~/workspace/creditfixkit/pwa/` (frontend + `functions/api/creditfix/`,
template engine `_lib/kit.js`, PDF writer `_lib/pdf.js`).
**Scope for this agent:** code only. Do NOT touch `~/workspace/repos/mehyar-web`,
do NOT touch D1/production, do NOT create Pages projects or GitHub repos,
do NOT send email. Another agent handles infra + deploy.

## 1. Checkout contract (PWA → mehyar.us)

The PWA (`pwa/app.js`) POSTs to the centralized checkout:

```
POST https://mehyar.us/api/pay/checkout
{
  "product_id": "creditfix-kit",
  "email": "<buyer email>",
  "params": {
    "name": "<buyer full name>",
    "situation": "collections" | "late-payments" | "thin-file" | "mixed",
    "state": "NY",
    "goal": "buy-home" | "buy-car" | "lower-rates" | "rebuild-general",
    "accounts": "<free text, <=600 chars, e.g. 'Midland Credit $1,240 collections opened 2023; Capital One 30-day late Mar 2024'>"
  },
  "success_url": "https://creditfixkit.mehyar.us/success.html",
  "cancel_url": "https://creditfixkit.mehyar.us/#pricing"
}
```

Checkout limits (mirroring the Designful contract): `params` JSON ≤ 2048 bytes
total, each string ≤ 2000 chars. The PWA validates this client-side
(`app.js` blocks submit when the params payload exceeds 2048 bytes).
`params` are stored **FLAT as `metadata_json`** on the `billing_payments` row.

## 2. Webhook fulfillment (your job)

On paid `creditfix-kit` payment:

1. Create the order row in `creditfixkit_orders` (idempotent on `payment_id`
   — `idx_creditfixkit_orders_payment` is UNIQUE; second webhook delivery must
   be a no-op returning the existing row):
   - `payment_id` = `billing_payments.id`
   - `product_id` = `'creditfix-kit'`
   - `email` = buyer email
   - `inputs_json` = `{"inputs": {name, situation, state, goal, accounts}}`
     taken **flat** from `billing_payments.metadata_json`
     (keys `name`, `situation`, `state`, `goal`, `accounts`)
   - `status` = `'paid'`
   - `access_token` = fresh unguessable token (32+ hex chars)
2. **Token unification:** write the SAME token onto the payment row:
   `billing_payments.access_token := <order access_token>`.
3. Trigger generation: `POST https://creditfixkit.mehyar.us/api/creditfix/generate`
   `{ "order_token": "<access_token>" }` (server-to-server; the endpoint sets
   status `generating` → builds the kit PDF → R2 → status `ready`).
4. Email the buyer (from the onboarded sender for this brand):
   - subject like "Your CreditFix Kit is ready"
   - link target: `https://creditfixkit.mehyar.us/deliverable.html?token=<access_token>`
   - the same link is the receipt-time destination; `success.html?token=`
     polls status and links through to `deliverable.html?token=`.

`success_url_template` suggestion for the `billing_products` seed row:

```
https://creditfixkit.mehyar.us/success.html?token={access_token}
```

## 3. Generate endpoint (already built — reference)

`POST /api/creditfix/generate` `{ order_token, inputs? }`
- looks up `creditfixkit_orders` by `access_token`; 404 on bogus token
- requires status `paid|failed`; `ready` → `{ok:true, replay:true, manifest}`
- `inputs` merge over stored intake, then `buildKit()` → `renderKitPdf()`
- R2 put → `creditfix/pdfs/<token>.pdf` (binding name: `env.DELIVERABLES`,
  contentType `application/pdf`)
- UPDATE `status='ready'`, `output_json` = manifest
  `{ok,name,situation,situation_label,goal,goal_label,pages,letters:[{id,title}],plan_months,pdf_url,generat
...[truncated 1567 chars]