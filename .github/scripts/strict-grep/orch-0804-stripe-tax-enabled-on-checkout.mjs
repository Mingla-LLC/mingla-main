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
 *
 * `--self-test` proves fail-on-revert (mirrors i-1272-identity-admin-read.mjs):
 * the pure `check(inputs, failures)` is exercised with a GOOD fixture and ≥2
 * DISTINCT BAD fixtures on the Stripe-Tax angle. The disk-reading main path
 * resolves `inputs` from the real tree and calls the SAME `check(...)`; the
 * refactor is behavior-preserving (identical verdict + messages on the tree).
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

function readOrEmpty(path) {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

/**
 * Pure verdict. `inputs`:
 *   migrationReadError — err.message if readdir(supabase/migrations) threw, else null;
 *   migrationMatched   — did a `*orch_0804*orders_tax_columns.sql` file match;
 *   migrationSrc       — matched migration contents ("" when unmatched/unreadable);
 *   checkoutSrc, webhookSrc, paymentsViewSrc — file contents;
 *   taxFnExists, taxFnSrc — presence + contents of the account-session edge fn.
 * Pushes the SAME strings, in the SAME order, as the pre-refactor gate.
 */
function check(inputs, failures) {
  const {
    migrationReadError,
    migrationMatched,
    migrationSrc,
    checkoutSrc,
    webhookSrc,
    paymentsViewSrc,
    taxFnExists,
    taxFnSrc,
  } = inputs;

  // Check 1 — migration file present. / Check 2 — declares tax_amount_cents column.
  if (migrationReadError != null) {
    failures.push(`Check 1 FAIL: cannot read supabase/migrations/: ${migrationReadError}`);
  } else if (!migrationMatched) {
    failures.push(
      "Check 1 FAIL: no migration file matching '*orch_0804*orders_tax_columns.sql' under supabase/migrations/",
    );
  } else if (!/ADD COLUMN IF NOT EXISTS\s+tax_amount_cents\s+integer/i.test(migrationSrc)) {
    failures.push(
      "Check 2 FAIL: migration does not declare 'ADD COLUMN IF NOT EXISTS tax_amount_cents integer'",
    );
  }

  // Check 3 — checkout creation enables Stripe Tax.
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
  if (!taxFnExists) {
    failures.push(
      "Check 6 FAIL: supabase/functions/brand-stripe-tax-account-session/index.ts is missing",
    );
  } else if (!/accountSessions\.create/.test(taxFnSrc)) {
    failures.push(
      "Check 6 FAIL: brand-stripe-tax-account-session/index.ts must call accountSessions.create",
    );
  }
}

// ─────────────────────────────────────────────────────────────── self-test
if (process.argv.includes("--self-test")) {
  const self = [];
  const GOOD = () => ({
    migrationReadError: null,
    migrationMatched: true,
    migrationSrc: "ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS tax_amount_cents integer;\n",
    checkoutSrc: "const params = { automatic_tax: { enabled: true } };\n",
    webhookSrc:
      "const td = session.total_details;\nconst tax = td.amount_tax;\nawait update({ tax_amount_cents: tax });\n",
    paymentsViewSrc: "const link = useBrandStripeTaxAccountSession();\n// discloses merchant of record\n",
    taxFnExists: true,
    taxFnSrc: "await stripe.accountSessions.create({ account, components });\n",
  });

  // GOOD: all 6 checks satisfied → silent.
  let f = [];
  check(GOOD(), f);
  if (f.length) self.push("GOOD (all 6 ORCH-0804 checks) wrongly flagged: " + f.join("; "));

  // BAD1 (revert-style): the automatic_tax block removed entirely → fires.
  f = [];
  check({ ...GOOD(), checkoutSrc: "const params = { mode: 'payment', customer_email };\n" }, f);
  if (f.length === 0) self.push("BAD1 (automatic_tax block removed) not flagged");

  // BAD2 (regression, different angle): automatic_tax present but DISABLED
  // (enabled: false) → fires.
  f = [];
  check({ ...GOOD(), checkoutSrc: "const params = { automatic_tax: { enabled: false } };\n" }, f);
  if (f.length === 0) self.push("BAD2 (automatic_tax { enabled: false }) not flagged");

  if (self.length) {
    console.error("ORCH-0804-STRIPE-TAX-ENABLED-ON-CHECKOUT self-test FAIL:");
    self.forEach((m) => console.error("  - " + m));
    process.exit(1);
  }
  console.log("ORCH-0804-STRIPE-TAX-ENABLED-ON-CHECKOUT self-test PASS (3/3 cases).");
  process.exit(0);
}

// ─────────────────────────────────────────────────────────────── main path
let migrationReadError = null;
let migrationMatched = false;
let migrationSrc = "";
try {
  const entries = readdirSync(MIGRATIONS_DIR);
  const match = entries.find((n) => /orch_0804.*orders_tax_columns\.sql$/.test(n));
  if (match) {
    migrationMatched = true;
    migrationSrc = readOrEmpty(join(MIGRATIONS_DIR, match));
  }
} catch (err) {
  migrationReadError = err.message;
}

const checkoutSrc = readOrEmpty(CHECKOUT_PATH);
const webhookSrc = readOrEmpty(WEBHOOK_ROUTER_PATH);
const paymentsViewSrc = readOrEmpty(PAYMENTS_VIEW_PATH);
const taxFnExists = existsSync(TAX_ACCOUNT_SESSION_FN_PATH);
const taxFnSrc = taxFnExists ? readOrEmpty(TAX_ACCOUNT_SESSION_FN_PATH) : "";

const failures = [];
check(
  {
    migrationReadError,
    migrationMatched,
    migrationSrc,
    checkoutSrc,
    webhookSrc,
    paymentsViewSrc,
    taxFnExists,
    taxFnSrc,
  },
  failures,
);

if (failures.length > 0) {
  console.error("ORCH-0804 strict-grep FAIL:");
  for (const f of failures) console.error("  - " + f);
  process.exit(1);
}

console.log("ORCH-0804 strict-grep PASS — 6/6 checks.");
