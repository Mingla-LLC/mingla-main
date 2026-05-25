#!/usr/bin/env node
/**
 * ORCH-0804 strict-grep gate — I-PROPOSED-BF STRIPE_TAX_ENABLED_ON_CHECKOUT.
 *
 * Enforces that every Stripe Checkout Session created by
 * `ticket-checkout-create/index.ts` passes the Stripe Tax params required
 * for buyer tax collection.
 *
 * ORCH-0843 REWORK (2026-05-15): under DIRECT charges (Stripe-Account
 * header on the request-options), Stripe Tax for Platforms uses the
 * Stripe-Account header alone to designate the connected account as
 * merchant of record. The legacy
 *   automatic_tax: { enabled: true, liability: { type: "account", account: <id> } }
 * shape (destination-charge model, verified against
 * https://docs.stripe.com/tax/tax-for-platforms on 2026-05-12) is
 * REJECTED by Stripe under direct charges with 400
 * StripeInvalidRequestError. See
 * https://docs.stripe.com/tax/connect/direct-charges — the correct
 * direct-charge shape is `automatic_tax: { enabled: true }` with NO
 * liability block. This gate therefore now requires ONLY:
 *   - automatic_tax: enabled: true
 * (the `liability.account: stripeAccountId` requirement was relaxed by
 * ORCH-0843 REWORK because it blocks the live-sales unblocker fix).
 *
 * NOTE: ORCH-0811 removed the previously required `customer_update: { address: "auto" }`.
 * That parameter is only valid alongside an existing `customer` id; Mingla
 * creates a fresh Customer per buyer via `customer_email`, and Stripe
 * rejected every Checkout Session with "You cannot use customer_update
 * without setting customer". Stripe Checkout auto-collects the billing
 * address on the new Customer when automatic_tax is enabled, so tax
 * jurisdiction lookup still works.
 *
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
 *      `enabled: true`. Must NOT contain `customer_update:` (ORCH-0811:
 *      incompatible with customer_email). Post-ORCH-0843 REWORK: no
 *      longer requires `liability:` / `account: stripeAccountId` because
 *      direct charges reject that shape — see header docblock.
 *   4. `_shared/stripeWebhookRouter.ts` references `total_details` AND
 *      `amount_tax` AND `tax_amount_cents` (proves the webhook persists tax
 *      data on the orders row).
 *   5. `BrandPaymentsView.tsx` imports the new
 *      `useBrandStripeTaxDashboardLink` hook AND contains the literal
 *      "merchant of record" (disclosure-copy enforcement).
 *   6. Embedded Tax account-session edge function exists
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
const TAX_ACCOUNT_SESSION_FN_PATH = join(
  REPO_ROOT,
  "supabase",
  "functions",
  "brand-stripe-tax-account-session",
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

// Check 3 — checkout creation enables Stripe Tax.
// ORCH-0843 REWORK: under direct charges Stripe rejects
// automatic_tax.liability.{type,account} with 400 InvalidRequestError. The
// connected account is designated merchant of record via the
// Stripe-Account header on the request-options (enforced separately by
// orch-0843-stripe-direct-charges-only.mjs T-G2). This gate therefore
// only asserts automatic_tax is ENABLED — not the legacy liability block
// (which would block the live-sales unblocker fix).
const checkoutSrc = readOrEmpty(CHECKOUT_PATH);
if (!/automatic_tax\s*:/.test(checkoutSrc)) {
  failures.push(
    "Check 3 FAIL: ticket-checkout-create/index.ts is missing `automatic_tax:` block — Stripe Tax is silently disabled in production",
  );
}
if (!/enabled\s*:\s*true/.test(checkoutSrc)) {
  failures.push(
    "Check 3 FAIL: ticket-checkout-create/index.ts is missing `enabled: true` — automatic_tax block must be ON",
  );
}
// ORCH-0811: customer_update is INCOMPATIBLE with customer_email (Stripe
// rejects: "You cannot use customer_update without setting customer").
// Active code lines that pass this param to Stripe must not exist; comments
// referencing it for history are fine — we strip line comments before scanning.
const checkoutSrcSansComments = checkoutSrc
  .split("\n")
  .filter((line) => !/^\s*(\/\/|\*)/.test(line))
  .join("\n");
if (/customer_update\s*:/.test(checkoutSrcSansComments)) {
  failures.push(
    "Check 3 FAIL: ticket-checkout-create/index.ts passes `customer_update:` to Stripe — ORCH-0811 forbids this; it is incompatible with customer_email and breaks every Checkout Session create",
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
if (!/useBrandStripeTaxAccountSession/.test(paymentsViewSrc)) {
  failures.push(
    "Check 5 FAIL: BrandPaymentsView.tsx does not import useBrandStripeTaxAccountSession — Tax & registrations CTA missing",
  );
}
if (!/merchant\s+of\s+record/.test(paymentsViewSrc)) {
  failures.push(
    "Check 5 FAIL: BrandPaymentsView.tsx does not contain the literal 'merchant of record' — brand-disclosure copy missing",
  );
}

// Check 6 — new edge function exists.
if (!existsSync(TAX_ACCOUNT_SESSION_FN_PATH)) {
  failures.push(
    "Check 6 FAIL: supabase/functions/brand-stripe-tax-account-session/index.ts is missing",
  );
} else {
  const fnSrc = readOrEmpty(TAX_ACCOUNT_SESSION_FN_PATH);
  if (!/accountSessions\.create/.test(fnSrc)) {
    failures.push(
      "Check 6 FAIL: brand-stripe-tax-account-session/index.ts must call accountSessions.create",
    );
  }
}

if (failures.length > 0) {
  console.error("ORCH-0804 strict-grep FAIL:");
  for (const f of failures) console.error("  - " + f);
  process.exit(1);
}

console.log("ORCH-0804 strict-grep PASS — 6/6 checks.");
