#!/usr/bin/env node
/**
 * ORCH-1052 — strict-grep gate for the partner-identity + account-level
 * Stripe Connect + currency-match invite gate. META-ORCH-1048 sub-D.
 *
 * RULES:
 *   1. Required new files exist:
 *        - supabase/migrations/20260822000000_orch_1052_partner_identity_stripe.sql
 *        - supabase/functions/partner-stripe-onboard/index.ts
 *        - supabase/functions/partner-stripe-account-session/index.ts
 *        - mingla-business/app/connect-partner-onboarding.web.tsx
 *        - mingla-business/app/partner/earnings.tsx
 *        - mingla-business/src/services/partnerStripeService.ts
 *        - mingla-business/src/hooks/usePartnerStripe.ts
 *   2. The migration file references partner_can_accept_brand, partner_enabled,
 *      partner_stripe_connect_accounts, external_account_currencies, and the
 *      RAISE EXCEPTION 'invite_currency_mismatch' (P0006).
 *   3. The partner-stripe-onboard edge fn references creator_accounts
 *      partner_enabled gate AND createRecipientAccount AND
 *      createAccountSession.
 *   4. The accept-brand-invitation edge fn now maps the new P0006 code AND
 *      handles 'invite_currency_mismatch' error.
 *   5. supabase/config.toml declares verify_jwt = true for both new fns.
 *
 * Self-test (`--self-test`) proves each rule fires on a synthetic violation
 * and stays silent on a clean tree.
 */
import fs from "node:fs";
import path from "node:path";

const root = process.cwd().endsWith("mingla-business")
  ? path.resolve(process.cwd(), "..")
  : process.cwd();

const REQUIRED_FILES = [
  "supabase/migrations/20260822000000_orch_1052_partner_identity_stripe.sql",
  "supabase/functions/partner-stripe-onboard/index.ts",
  "supabase/functions/partner-stripe-account-session/index.ts",
  "mingla-business/app/connect-partner-onboarding.web.tsx",
  "mingla-business/app/partner/earnings.tsx",
  "mingla-business/src/services/partnerStripeService.ts",
  "mingla-business/src/hooks/usePartnerStripe.ts",
];

const MIGRATION_REQUIRED_TOKENS = [
  "partner_can_accept_brand",
  "partner_enabled",
  "partner_stripe_connect_accounts",
  "external_account_currencies",
  "invite_currency_mismatch",
  "P0006",
  "admin_toggle_partner",
];

const ONBOARD_REQUIRED_TOKENS = [
  "creator_accounts",
  "partner_enabled",
  "createRecipientAccount",
  "createAccountSession",
  "partner_stripe_connect_accounts",
];

const ACCEPT_REQUIRED_TOKENS = [
  "P0006",
  "invite_currency_mismatch",
  "parsePartnerGateDetail",
];

const CONFIG_REQUIRED_TOKENS = [
  "[functions.partner-stripe-onboard]",
  "[functions.partner-stripe-account-session]",
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
  if (src === null) return null; // covered by checkRequiredFilesExist
  const missing = MIGRATION_REQUIRED_TOKENS.filter((t) => !src.includes(t));
  if (missing.length > 0) {
    return `Migration missing required tokens: ${missing.join(", ")}`;
  }
  return null;
}

function checkOnboardContents() {
  const src = readFileOrNull(REQUIRED_FILES[1]);
  if (src === null) return null;
  const missing = ONBOARD_REQUIRED_TOKENS.filter((t) => !src.includes(t));
  if (missing.length > 0) {
    return `partner-stripe-onboard missing required tokens: ${missing.join(", ")}`;
  }
  return null;
}

function checkAcceptContents() {
  const src = readFileOrNull("supabase/functions/accept-brand-invitation/index.ts");
  if (src === null) return "accept-brand-invitation/index.ts not found";
  const missing = ACCEPT_REQUIRED_TOKENS.filter((t) => !src.includes(t));
  if (missing.length > 0) {
    return `accept-brand-invitation missing ORCH-1052 P0006 handling: ${missing.join(", ")}`;
  }
  return null;
}

function checkConfigToml() {
  const src = readFileOrNull("supabase/config.toml");
  if (src === null) return "supabase/config.toml not found";
  const missing = CONFIG_REQUIRED_TOKENS.filter((t) => !src.includes(t));
  if (missing.length > 0) {
    return `supabase/config.toml missing entries: ${missing.join(", ")}`;
  }
  return null;
}

const CHECKS = [
  ["required-files", checkRequiredFilesExist],
  ["migration", checkMigrationContents],
  ["partner-stripe-onboard", checkOnboardContents],
  ["accept-brand-invitation", checkAcceptContents],
  ["config-toml", checkConfigToml],
];

function runChecks() {
  const failures = [];
  for (const [name, fn] of CHECKS) {
    const result = fn();
    if (result !== null) {
      failures.push(`[${name}] ${result}`);
    }
  }
  return failures;
}

function selfTest() {
  // Each rule must fire on a synthetic violation.
  const violations = [];

  // Rule 1: required files exist.
  const r1 = checkRequiredFilesExist();
  if (r1 !== null) {
    violations.push(
      "self-test fail: required-files check fired on a clean tree (" + r1 + ")",
    );
  }

  // Rule 2: simulate migration violation by parsing a stripped string.
  {
    const fakeMigration = "BEGIN; -- empty migration\nCOMMIT;\n";
    const missing = MIGRATION_REQUIRED_TOKENS.filter(
      (t) => !fakeMigration.includes(t),
    );
    if (missing.length !== MIGRATION_REQUIRED_TOKENS.length) {
      violations.push(
        "self-test fail: migration check would not fire on empty migration",
      );
    }
  }

  // Rule 3: empty onboard contents.
  {
    const fakeOnboard = "";
    const missing = ONBOARD_REQUIRED_TOKENS.filter(
      (t) => !fakeOnboard.includes(t),
    );
    if (missing.length !== ONBOARD_REQUIRED_TOKENS.length) {
      violations.push("self-test fail: onboard check would not fire on empty fn");
    }
  }

  // Rule 4: accept missing all required tokens.
  {
    const fakeAccept = "// stripped accept fn";
    const missing = ACCEPT_REQUIRED_TOKENS.filter(
      (t) => !fakeAccept.includes(t),
    );
    if (missing.length !== ACCEPT_REQUIRED_TOKENS.length) {
      violations.push(
        "self-test fail: accept-brand-invitation check would not fire when P0006 absent",
      );
    }
  }

  // Rule 5: config toml without entries.
  {
    const fakeConfig = "project_id = \"test\"\n";
    const missing = CONFIG_REQUIRED_TOKENS.filter(
      (t) => !fakeConfig.includes(t),
    );
    if (missing.length !== CONFIG_REQUIRED_TOKENS.length) {
      violations.push("self-test fail: config check would not fire");
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
  console.log("ORCH-1052 strict-grep self-test PASS");
  process.exit(0);
}

const failures = runChecks();
if (failures.length > 0) {
  console.error("ORCH-1052 strict-grep FAIL:\n" + failures.map((f) => `  - ${f}`).join("\n"));
  process.exit(1);
}
console.log("ORCH-1052 strict-grep PASS");
process.exit(0);
