#!/usr/bin/env node
/**
 * ORCH-0804 strict-grep gate — I-PROPOSED-BF STRIPE_TAX_ENABLED_ON_CHECKOUT.
 *
 * Enforces that every Stripe Checkout Session created by
 * `ticket-checkout-create/index.ts` passes the Stripe Tax params for the
 * Connect destination-charge model (verified against
 * https://docs.stripe.com/tax/tax-for-platforms on 2026-05-12):
 *   - automatic_tax: { enabled: true, liability: { type: "account", account: <connected_account_id> } }
 *   - customer_update: { address: "auto" }
 * Plus persists the resulting tax data to `orders.tax_amount_cents` via the
 * webhook router, exposes the "Tax & registrations" CTA on the brand
 * Payments tab with merchant-of-record disclosure copy, and registers the
 * tax-storage migration.
 *
 * Six pattern checks (all must pass; any failure exits non-zero):
 *
 *   1. Migration file `*orch_0804*orders_tax_columns.sql` exists under
 *      supabase/migrations/.
 *   2. Migration declares `ADD COLUMN IF NOT EXISTS tax_amount_cents`.
 *   3. `ticket-checkout-create/index.ts` contains `automatic_tax:` AND
 *      `liability:` AND `account: stripeAccountId` AND
 *      `customer_update:` with `address: "auto"`.
 *   4. `_shared/stripeWebhookRouter.ts` references `total_details` AND
 *      `amount_tax` AND `tax_amount_cents` (proves the webhook persists tax
 *      data on the orders row).
 *   5. `BrandPaymentsView.tsx` imports the new
 *      `useBrandStripeTaxDashboardLink` hook AND contains the literal
 *      "merchant of record" (disclosure-copy enforcement).
 *   6. New edge function `brand-stripe-tax-dashboard-link/index.ts` exists
 *      and calls `accounts.createLoginLink`.
 *
 * Codified by ORCH-0804 SPEC §9 + §10.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = join(__dirname, "..", "..", "..");

const MIGRATIONS_DIR = join(REPO_ROOT, "supabase", "migrations");
const CHECKOUT_PATH = join(
  REPO_ROOT,
  "supabase",
  "functions",
  "ticket-checkout-create",
  "index.ts",
);
const WEBHOOK_ROUTER_PATH = join(
  REPO_ROOT,
  "supabase",
  "functions",
  "_shared",
  "stripeWebhookRouter.ts",
);
const PAYMENTS_VIEW_PATH = join(
  REPO_ROOT,
  "mingla-business",
  "src",
  "components",
  "brand",
  "BrandPaymentsView.tsx",
);
const TAX_DASHBOARD_LINK_FN_PATH = join(
  REPO_ROOT,
  "supabase",
  "functions",
  "brand-stripe-tax-dashboard-link",
  "index.ts",
);

const failures = [];

function readOrEmpty(path) {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

// Check 1 — migration file present.
try {
  const entries = readdirSync(MIGRATIONS_DIR);
  const match = entries.find(
    (n) => /orch_0804.*orders_tax_columns\.sql$/.test(n),
  );
  if (!match) {
    failures.push(
      "Check 1 FAIL: no migration file matching '*orch_0804*orders_tax_columns.sql' under supabase/migrations/",
    );
  } else {
    // Check 2 — migration declares tax_amount_cents column.
    const migrationSrc = readOrEmpty(join(MIGRATIONS_DIR, match));
    if (!/ADD COLUMN IF NOT EXISTS\s+tax_amount_cents\s+integer/i.test(migrationSrc)) {
      failures.push(
        "Check 2 FAIL: migration does not declare 'ADD COLUMN IF NOT EXISTS tax_amount_cents integer'",
      );
    }
  }
} catch (err) {
  failures.push(`Check 1 FAIL: cannot read supabase/migrations/: ${err.message}`);
}

// Check 3 — checkout creation passes the required Stripe Tax params.
const checkoutSrc = readOrEmpty(CHECKOUT_PATH);
if (!/automatic_tax\s*:/.test(checkoutSrc)) {
  failures.push(
    "Check 3 FAIL: ticket-checkout-create/index.ts is missing `automatic_tax:` block — Stripe Tax is silently disabled in production",
  );
}
if (!/liability\s*:\s*\{/.test(checkoutSrc)) {
  failures.push(
    "Check 3 FAIL: ticket-checkout-create/index.ts is missing `liability:` inside automatic_tax — brand merchant-of-record designation missing",
  );
}
if (!/account\s*:\s*stripeAccountId/.test(checkoutSrc)) {
  failures.push(
    "Check 3 FAIL: ticket-checkout-create/index.ts is missing `account: stripeAccountId` — tax liability not pinned to the connected account",
  );
}
if (!/customer_update\s*:\s*\{[^}]*address\s*:\s*"auto"/s.test(checkoutSrc)) {
  failures.push(
    "Check 3 FAIL: ticket-checkout-create/index.ts is missing `customer_update: { address: \"auto\" }` — Stripe Tax cannot resolve buyer jurisdiction without it",
  );
}

// Check 4 — webhook router persists tax to the orders row.
const webhookSrc = readOrEmpty(WEBHOOK_ROUTER_PATH);
if (!/total_details/.test(webhookSrc)) {
  failures.push(
    "Check 4 FAIL: _shared/stripeWebhookRouter.ts does not reference `total_details` — Stripe Tax amount cannot be extracted from session payload",
  );
}
if (!/amount_tax/.test(webhookSrc)) {
  failures.push(
    "Check 4 FAIL: _shared/stripeWebhookRouter.ts does not reference `amount_tax`",
  );
}
if (!/tax_amount_cents/.test(webhookSrc)) {
  failures.push(
    "Check 4 FAIL: _shared/stripeWebhookRouter.ts does not write `tax_amount_cents` to the orders row",
  );
}

// Check 5 — Payments tab CTA + disclosure copy.
const paymentsViewSrc = readOrEmpty(PAYMENTS_VIEW_PATH);
if (!/useBrandStripeTaxDashboardLink/.test(paymentsViewSrc)) {
  failures.push(
    "Check 5 FAIL: BrandPaymentsView.tsx does not import useBrandStripeTaxDashboardLink — Tax & registrations CTA missing",
  );
}
if (!/merchant of record/.test(paymentsViewSrc)) {
  failures.push(
    "Check 5 FAIL: BrandPaymentsView.tsx does not contain the literal 'merchant of record' — brand-disclosure copy missing",
  );
}

// Check 6 — new edge function exists.
if (!existsSync(TAX_DASHBOARD_LINK_FN_PATH)) {
  failures.push(
    "Check 6 FAIL: supabase/functions/brand-stripe-tax-dashboard-link/index.ts is missing",
  );
} else {
  const fnSrc = readOrEmpty(TAX_DASHBOARD_LINK_FN_PATH);
  if (!/accounts\.createLoginLink/.test(fnSrc)) {
    failures.push(
      "Check 6 FAIL: brand-stripe-tax-dashboard-link/index.ts must call accounts.createLoginLink",
    );
  }
}

if (failures.length > 0) {
  console.error("ORCH-0804 strict-grep FAIL:");
  for (const f of failures) console.error("  - " + f);
  process.exit(1);
}

console.log("ORCH-0804 strict-grep PASS — 6/6 checks.");
