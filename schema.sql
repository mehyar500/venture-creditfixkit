-- pwa/schema.sql — CreditFix Kit PWA schema.
-- Apply to the shared D1 (same DB that holds billing_products/billing_payments).
-- Safe to re-run (IF NOT EXISTS).
-- NOTE: nothing in ~/workspace/repos/mehyar-web is touched by this file.

-- ── orders: one row per paid CreditFix Kit purchase ─────────────────────────
CREATE TABLE IF NOT EXISTS creditfixkit_orders (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  payment_id    TEXT UNIQUE NOT NULL,      -- billing_payments.id (unique: idempotent fulfill)
  product_id    TEXT,                      -- 'creditfix-kit'
  email         TEXT,
  inputs_json   TEXT,                      -- {inputs:{name,situation,state,goal,accounts}}
  status        TEXT DEFAULT 'paid',        -- paid|generating|ready|failed
  access_token  TEXT UNIQUE,               -- unguessable buyer capability token
  output_json   TEXT,                      -- kit manifest (see generate.js)
  ready_at      TEXT,
  created_at    TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Idempotency key for the webhook fulfillment hook (one order per payment).
CREATE UNIQUE INDEX IF NOT EXISTS idx_creditfixkit_orders_payment ON creditfixkit_orders(payment_id);
CREATE INDEX IF NOT EXISTS idx_creditfixkit_orders_token ON creditfixkit_orders(access_token);

-- ── leads: free-teaser / newsletter capture ─────────────────────────────────
CREATE TABLE IF NOT EXISTS creditfixkit_leads (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT UNIQUE,
  situation     TEXT,
  created_at    TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
