#!/usr/bin/env node

/**
 * I-PROPOSED-STRIPE-PM-METHOD-ALLOWLIST strict-grep gate (ORCH-0849).
 *
 * The `ticket-checkout-create` edge function MUST source
 * `payment_method_types` from the curated allowlist constant
 * `MINGLA_PM_ALLOWLIST` in `supabase/functions/_shared/stripePaymentMethods.ts`
 * via the spread call `[...getPaymentMethodTypes()]`. Hardcoded array
 * literals at the PI-create call site are forbidden. The
 * `automatic_payment_methods: { enabled: true }` form is forbidden
 * (preserves ORCH-0837 H2 root-cause guard).
 *
 * The allowlist contains exactly two methods: card, link. (Apple Pay
 * and Google Pay are wallets that surface through `card` — they are NOT
 * payment_method_types; Stripe rejects them with 400 invalid_parameter.
 * See `_shared/stripePaymentMethods.ts` header for the live-probe
 * reproduction.) Adding methods to the allowlist requires a new
 * ORCH proving the redirect-flow / delayed-method plumbing for the new
 * method type (Cash App Pay, Klarna, Afterpay, ACH, SEPA Debit, regional
 * redirects).
 *
 * Detection rules (all must hold for exit 0):
 *   R-1 — `supabase/functions/_shared/stripePaymentMethods.ts` exists and
 *         exports `MINGLA_PM_ALLOWLIST` as a frozen-literal array.
 *   R-2 — `supabase/functions/ticket-checkout-create/index.ts` imports
 *         `getPaymentMethodTypes` from
 *         `../_shared/stripePaymentMethods.ts`.
 *   R-3 — same file contains the spread call
 *         `payment_method_types: [...getPaymentMethodTypes()]` on a
 *         non-comment line.
 *   R-4 — same file does NOT contain `payment_method_types: ["card"]`
 *         (or any hardcoded single-string literal) on a non-comment line.
 *   R-5 — same file does NOT contain
 *         `automatic_payment_methods: { enabled: true }` on a non-comment
 *         line.
 *   R-6 — allowlist file's array contains exactly two entries (card,
 *         link); Phase 2 methods (cash_app_pay,
 *         klarna, afterpay_clearpay, us_bank_account, sepa_debit, ideal,
 *         bancontact, eps, p24) are absent.
 *
 * Self-test note: this script's filename + comments may mention any of
 * the forbidden tokens — the scan targets are the two source files
 * named above, not this gate.
 *
 * Exit codes:
 *   0 — all six rules hold (gate green)
 *   1 — one or more rules violated (gate red)
 *   2 — file system error
 *
 * Modeled on `.github/scripts/strict-grep/i-discover-excludes-ended-master-date.mjs`
 * (regex-style, single-file scans, line-comment filtering). Established by
 * SPEC_ORCH-0849 §3.5.4.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../../..");

const ALLOWLIST_FILE = "supabase/functions/_shared/stripePaymentMethods.ts";
const EDGE_FN_FILE = "supabase/functions/ticket-checkout-create/index.ts";

const PHASE_2_FORBIDDEN_METHODS = [
  "cash_app_pay",
  "klarna",
  "afterpay_clearpay",
  "us_bank_account",
  "sepa_debit",
  "ideal",
  "bancontact",
  "eps",
  "p24",
];

function readOrFail(rel) {
  try {
    return fs.readFileSync(path.join(repoRoot, rel), "utf8");
  } catch (err) {
    console.error(
      `[i-stripe-pm-method-allowlist] FAIL — could not read ${rel}: ${err.message}`,
    );
    process.exit(2);
  }
}

function nonCommentLines(source) {
  return source.split("\n").filter((line) => {
    const trimmed = line.trimStart();
    return !trimmed.startsWith("//");
  });
}

const failures = [];
const passes = [];

// ─── R-1: allowlist file exists + exports MINGLA_PM_ALLOWLIST ────────────

const allowSource = readOrFail(ALLOWLIST_FILE);
if (/export\s+const\s+MINGLA_PM_ALLOWLIST\s*=\s*\[/.test(allowSource)) {
  passes.push("R-1: MINGLA_PM_ALLOWLIST exported");
} else {
  failures.push(
    "R-1: MINGLA_PM_ALLOWLIST export missing from " + ALLOWLIST_FILE,
  );
}

// ─── R-2 + R-3 + R-4 + R-5: edge function shape ─────────────────────────

const edgeSource = readOrFail(EDGE_FN_FILE);
const edgeNonCommentText = nonCommentLines(edgeSource).join("\n");

if (
  /import\s+\{\s*getPaymentMethodTypes\s*\}\s+from\s+["']\.\.\/_shared\/stripePaymentMethods\.ts["']/
    .test(edgeSource)
) {
  passes.push("R-2: import getPaymentMethodTypes present");
} else {
  failures.push(
    "R-2: missing `import { getPaymentMethodTypes } from \"../_shared/stripePaymentMethods.ts\"` in " +
      EDGE_FN_FILE,
  );
}

if (
  /payment_method_types\s*:\s*\[\s*\.\.\.\s*getPaymentMethodTypes\(\s*\)\s*\]/
    .test(edgeNonCommentText)
) {
  passes.push("R-3: spread call present at PI-create site");
} else {
  failures.push(
    "R-3: missing `payment_method_types: [...getPaymentMethodTypes()]` on a non-comment line in " +
      EDGE_FN_FILE,
  );
}

if (
  /payment_method_types\s*:\s*\[\s*["']card["']\s*\]/.test(edgeNonCommentText)
) {
  failures.push(
    "R-4: hardcoded `payment_method_types: [\"card\"]` literal found on non-comment line — must source from getPaymentMethodTypes() in " +
      EDGE_FN_FILE,
  );
} else {
  passes.push("R-4: no hardcoded card-only literal");
}

if (
  /automatic_payment_methods\s*:\s*\{\s*enabled\s*:\s*true\s*\}/.test(
    edgeNonCommentText,
  )
) {
  failures.push(
    "R-5: forbidden `automatic_payment_methods: { enabled: true }` form found — preserves ORCH-0837 H2 guard in " +
      EDGE_FN_FILE,
  );
} else {
  passes.push("R-5: no automatic_payment_methods enabled form");
}

// ─── R-6: allowlist contains exactly Phase 1 methods, no Phase 2 ────────

// Extract array content between `MINGLA_PM_ALLOWLIST = [` and `] as const`.
const arrayMatch = allowSource.match(
  /MINGLA_PM_ALLOWLIST\s*=\s*\[([\s\S]*?)\]\s*as\s+const/,
);
if (arrayMatch === null) {
  failures.push(
    "R-6: could not parse MINGLA_PM_ALLOWLIST array literal in " +
      ALLOWLIST_FILE,
  );
} else {
  const body = arrayMatch[1];
  const entries = [...body.matchAll(/["']([a-z_]+)["']/g)].map((m) => m[1]);
  // ORCH-0849 hotfix 2026-05-15: reduced from four to two after Stripe CLI
  // live-probe proved "apple_pay" / "google_pay" are NOT valid
  // payment_method_types (400 payment_intent_invalid_parameter). The
  // wallets surface through `card` when the mobile SDK is initialized
  // with merchantIdentifier and the platform PaymentMethodConfiguration
  // has them enabled. See `_shared/stripePaymentMethods.ts` header.
  const allowlist = ["card", "link"];
  const isExactAllowlist =
    entries.length === allowlist.length &&
    allowlist.every((m, i) => entries[i] === m);
  if (!isExactAllowlist) {
    failures.push(
      "R-6: MINGLA_PM_ALLOWLIST must contain exactly [card, link] in this order. Found: " +
        JSON.stringify(entries) +
        ". Apple Pay / Google Pay are NOT separate types — they surface through `card`.",
    );
  } else {
    const phase2Leak = entries.filter((m) =>
      PHASE_2_FORBIDDEN_METHODS.includes(m),
    );
    if (phase2Leak.length > 0) {
      failures.push(
        "R-6: Phase 2 methods leaked into allowlist (require dedicated ORCH proving redirect-flow / delayed-method plumbing): " +
          phase2Leak.join(", "),
      );
    } else {
      passes.push(
        "R-6: allowlist is exactly [card, link] with no Phase 2 leakage",
      );
    }
  }
}

// ─── Report ──────────────────────────────────────────────────────────────

if (failures.length > 0) {
  console.error(
    "[i-stripe-pm-method-allowlist] FAIL — ORCH-0849 invariant violated:",
  );
  for (const f of failures) {
    console.error("  - " + f);
  }
  console.error("");
  console.error(
    "See `Mingla_Artifacts/specs/SPEC_ORCH-0849_STRIPE_PAYMENT_METHOD_PARITY.md` §3.5.4 for the required gate shape and §3.2 for the allowlist contract.",
  );
  process.exit(1);
}

console.log(
  "[i-stripe-pm-method-allowlist] PASS — all 6 rules hold:",
);
for (const p of passes) {
  console.log("  - " + p);
}
process.exit(0);
