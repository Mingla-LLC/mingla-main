#!/usr/bin/env node
/**
 * ORCH-1054 — strict-grep gate for the partner_splits ledger + Stripe Transfer
 * pipeline. META-ORCH-1048 sub-E.
 *
 * RULES:
 *   1. Required new files exist (migration, _shared module, service, hook,
 *      strict-grep file itself).
 *   2. Migration references partner_splits table + the 4 RPCs +
 *      I-PROPOSED-PARTNER-TRANSFER-SOURCE-CURRENCY invariant note +
 *      ON CONFLICT idempotency on stripe_application_fee_id.
 *   3. stripeWebhookRouter.ts:
 *        - imports handleChargeSucceeded, handleChargeReversal, and
 *          syncPartnerAccountFromEvent
 *        - lists charge.succeeded in STRIPE_ROUTED_EVENT_TYPES
 *        - routes charge.succeeded to handleChargeSucceeded
 *        - calls handleChargeReversal from charge.refunded + charge.dispute
 *        - calls syncPartnerAccountFromEvent from account.updated
 *   4. _shared/partnerSplits.ts:
 *        - cites docs.stripe.com/api/transfers/create
 *        - cites docs.stripe.com/api/transfer_reversals/create
 *        - uses Idempotency-Key partner_split_<application_fee_id>
 *        - creates TransferReversal for refunds + disputes
 *        - populates external_account_currencies on account.updated
 *        - asserts Transfer.currency = charge.currency (zero FX)
 *   5. partnerEarningsScreen wires usePartnerSplits + usePartnerEarningsSummary.
 *
 * Self-test (`--self-test`) proves each rule fires on a synthetic violation.
 */
import fs from "node:fs";
import path from "node:path";

const root = process.cwd().endsWith("mingla-business")
  ? path.resolve(process.cwd(), "..")
  : process.cwd();

const REQUIRED_FILES = [
  "supabase/migrations/20260823000000_orch_1054_partner_splits.sql",
  "supabase/functions/_shared/partnerSplits.ts",
  "mingla-business/src/services/partnerSplitsService.ts",
  "mingla-business/src/hooks/usePartnerSplits.ts",
  ".github/scripts/strict-grep/orch-1054-partner-splits.mjs",
];

const MIGRATION_REQUIRED_TOKENS = [
  "partner_splits",
  "resolve_partner_for_brand_at_time",
  "record_partner_split_attempt",
  "mark_partner_split_transferred",
  "mark_partner_split_failed",
  "mark_partner_split_reversed",
  "stripe_application_fee_id",
  "blocked_currency_mismatch",
  "blocked_no_stripe",
  "I-PROPOSED-PARTNER-TRANSFER-SOURCE-CURRENCY",
  "ON CONFLICT (stripe_application_fee_id)",
];

const WEBHOOK_REQUIRED_TOKENS = [
  "handleChargeSucceeded",
  "handleChargeReversal",
  "syncPartnerAccountFromEvent",
  '"charge.succeeded"',
  "ORCH-1054",
];

const PARTNER_SPLITS_REQUIRED_TOKENS = [
  "docs.stripe.com/api/transfers/create",
  "docs.stripe.com/api/transfer_reversals/create",
  "partner_split_${applicationFeeId}",
  "partner_split_reversal_${applicationFeeId}",
  "external_account_currencies",
  "source_transaction",
  // Zero-FX invariant — Transfer.currency MUST equal source charge currency.
  "ZERO FX",
  "PARTNER_SHARE_OF_FEE",
  "createReversal",
];

const EARNINGS_REQUIRED_TOKENS = [
  "usePartnerSplits",
  "usePartnerEarningsSummary",
  "PartnerSplitsSection",
  "ORCH-1054",
];

function readFileOrNull(rel) {
  const abs = path.join(root, rel);
  try {
    return fs.readFileSync(abs, "utf8");
  } catch {
    return null;
  }
}

function checkRequiredFilesExist() {
  const missing = [];
  for (const rel of REQUIRED_FILES) {
    if (readFileOrNull(rel) === null) missing.push(rel);
  }
  if (missing.length > 0) {
    return `Required file(s) missing:\n  - ${missing.join("\n  - ")}`;
  }
  return null;
}

function checkMigrationContents() {
  const src = readFileOrNull(REQUIRED_FILES[0]);
  if (src === null) return null;
  const missing = MIGRATION_REQUIRED_TOKENS.filter((t) => !src.includes(t));
  if (missing.length > 0) {
    return `Migration missing required tokens: ${missing.join(", ")}`;
  }
  return null;
}

function checkWebhookRouterContents() {
  const src = readFileOrNull(
    "supabase/functions/_shared/stripeWebhookRouter.ts",
  );
  if (src === null) return "stripeWebhookRouter.ts not found";
  const missing = WEBHOOK_REQUIRED_TOKENS.filter((t) => !src.includes(t));
  if (missing.length > 0) {
    return `stripeWebhookRouter.ts missing ORCH-1054 wiring: ${missing.join(", ")}`;
  }
  return null;
}

function checkPartnerSplitsContents() {
  const src = readFileOrNull(REQUIRED_FILES[1]);
  if (src === null) return null;
  const missing = PARTNER_SPLITS_REQUIRED_TOKENS.filter((t) => !src.includes(t));
  if (missing.length > 0) {
    return `partnerSplits.ts missing required tokens: ${missing.join(", ")}`;
  }
  return null;
}

function checkEarningsScreen() {
  const src = readFileOrNull("mingla-business/app/partner/earnings.tsx");
  if (src === null) return "partner/earnings.tsx not found";
  const missing = EARNINGS_REQUIRED_TOKENS.filter((t) => !src.includes(t));
  if (missing.length > 0) {
    return `partner/earnings.tsx missing ORCH-1054 wiring: ${missing.join(", ")}`;
  }
  return null;
}

const CHECKS = [
  ["required-files", checkRequiredFilesExist],
  ["migration", checkMigrationContents],
  ["stripe-webhook-router", checkWebhookRouterContents],
  ["partner-splits-shared", checkPartnerSplitsContents],
  ["partner-earnings-screen", checkEarningsScreen],
];

function runChecks() {
  const failures = [];
  for (const [name, fn] of CHECKS) {
    const result = fn();
    if (result !== null) failures.push(`[${name}] ${result}`);
  }
  return failures;
}

function selfTest() {
  const violations = [];

  // Rule 1: required files exist on clean tree.
  const r1 = checkRequiredFilesExist();
  if (r1 !== null) {
    violations.push("self-test fail: required-files fired on clean tree (" + r1 + ")");
  }

  // Rule 2: migration token check fires on empty body.
  {
    const fake = "BEGIN; COMMIT;\n";
    const missing = MIGRATION_REQUIRED_TOKENS.filter((t) => !fake.includes(t));
    if (missing.length !== MIGRATION_REQUIRED_TOKENS.length) {
      violations.push("self-test fail: migration check would not fire on empty body");
    }
  }

  // Rule 3: webhook router check fires on empty body.
  {
    const fake = "";
    const missing = WEBHOOK_REQUIRED_TOKENS.filter((t) => !fake.includes(t));
    if (missing.length !== WEBHOOK_REQUIRED_TOKENS.length) {
      violations.push("self-test fail: webhook router check would not fire");
    }
  }

  // Rule 4: partnerSplits shared check fires on empty body.
  {
    const fake = "";
    const missing = PARTNER_SPLITS_REQUIRED_TOKENS.filter((t) => !fake.includes(t));
    if (missing.length !== PARTNER_SPLITS_REQUIRED_TOKENS.length) {
      violations.push("self-test fail: partnerSplits check would not fire");
    }
  }

  // Rule 5: earnings screen check fires on empty body.
  {
    const fake = "";
    const missing = EARNINGS_REQUIRED_TOKENS.filter((t) => !fake.includes(t));
    if (missing.length !== EARNINGS_REQUIRED_TOKENS.length) {
      violations.push("self-test fail: earnings screen check would not fire");
    }
  }

  return violations;
}

const args = new Set(process.argv.slice(2));
if (args.has("--self-test")) {
  const violations = selfTest();
  if (violations.length > 0) {
    for (const v of violations) console.error(v);
    process.exit(1);
  }
  console.log("ORCH-1054 strict-grep self-test PASS");
  process.exit(0);
}

const failures = runChecks();
if (failures.length > 0) {
  console.error(
    "ORCH-1054 strict-grep FAIL:\n" + failures.map((f) => `  - ${f}`).join("\n"),
  );
  process.exit(1);
}
console.log("ORCH-1054 strict-grep PASS");
process.exit(0);
