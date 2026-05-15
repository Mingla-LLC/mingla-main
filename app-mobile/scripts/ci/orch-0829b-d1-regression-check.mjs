#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * ORCH-0829-B D-1 regression check (post-ORCH-0844 flip).
 *
 * Asserts that the timeout race was RETIRED at ORCH-0844 while preserving
 * the migration + handleBuy try/finally layers from the original D-1 fix:
 *   - Database: tombstone migration still extends the eligibility predicate
 *     so past-expiry in-flight sessions get tombstoned and transitioned
 *     to status='expired' (R-1; PRESERVED).
 *   - Component: handleBuy still wraps runNativeCheckout in try/catch/finally
 *     so checkoutInFlight always clears even on hang/throw (H-2; PRESERVED).
 *   - Package: useStripePaymentSheet MUST NOT declare PAYMENT_SHEET_TIMEOUT_MS
 *     or withTimeout — the timeout race was a double-settle vector on
 *     iOS 26 and the hang it guarded was resolved at the PI level by
 *     ORCH-0837 `payment_method_types: ['card']` (FLIPPED — ORCH-0844).
 *
 * Contracts (spec §3.4 S4 + ORCH-0844 §3.5.3):
 *   T-A1  Migration file with monotonic prefix > 20260605000001 exists (PRESERVED)
 *   T-A2  Migration body contains the new OR clause `expires_at < now()` (PRESERVED)
 *   T-A3  Migration body transitions tombstoned non-terminal rows to status='expired' (PRESERVED)
 *   T-A4  handleBuy wraps runNativeCheckout in try { ... } finally { setCheckoutInFlight(false) } (PRESERVED)
 *   T-A5  handleBuy catch converts thrown errors to { outcome: "failed", message } (PRESERVED)
 *   T-A6  useStripePaymentSheet MUST NOT declare PAYMENT_SHEET_TIMEOUT_MS or function withTimeout (FLIPPED — ORCH-0844)
 *   T-A7  Neither initPaymentSheet nor presentPaymentSheet wrappers may call withTimeout(...) (FLIPPED — ORCH-0844)
 *   T-A8  useStripePaymentSheet MUST NOT emit a synthetic error with code: "Timeout" (FLIPPED — ORCH-0844)
 *   T-A9  useStripePaymentSheet MUST NOT log `timed out after ${ms}ms` (FLIPPED — ORCH-0844)
 *
 * Invariants codified:
 *   I-PROPOSED-CHECKOUT-EXPIRY-TOMBSTONE          (T-A1, T-A2, T-A3 — PRESERVED)
 *   I-PROPOSED-PAYMENT-SHEET-TIMEOUT-RACE         (T-A6..T-A9 — RETIRED at ORCH-0844; flipped sub-checks enforce absence)
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "../..");
const repoRoot = path.resolve(root, "..");

const readMaybe = (absRel) => {
  try {
    return fs.readFileSync(absRel, "utf8");
  } catch {
    return null;
  }
};

const checks = [];
const check = (name, pass, detail) => {
  checks.push({ name, pass, detail });
};

// ─── Locate the D-1 migration ──────────────────────────────────────────────

const migrationsDir = path.join(repoRoot, "supabase/migrations");
let migrationFiles = [];
try {
  migrationFiles = fs.readdirSync(migrationsDir);
} catch {
  // empty — handled by T-A1
}

const d1Migration = migrationFiles
  .filter((f) =>
    /^\d{14}_orch_0829b_d1_checkout_expiry_tombstone\.sql$/.test(f),
  )
  .sort();

check(
  "T-A1 D-1 migration file exists with monotonic prefix > 20260605000001",
  d1Migration.length === 1 &&
    d1Migration[0].slice(0, 14) > "20260605000001",
  `Expected exactly 1 file matching /^\\d{14}_orch_0829b_d1_checkout_expiry_tombstone\\.sql$/ with timestamp prefix > 20260605000001. Found: ${
    d1Migration.length === 0 ? "(none)" : d1Migration.join(", ")
  }`,
);

const migrationBody =
  d1Migration.length === 1
    ? readMaybe(path.join(migrationsDir, d1Migration[0]))
    : null;

check(
  "T-A2 Migration body contains tombstone-expiry OR clause",
  migrationBody !== null &&
    /OR\s+v_existing\.expires_at\s*<\s*now\s*\(\s*\)/.test(migrationBody),
  "Migration body MUST extend the tombstone-eligibility predicate to include `OR v_existing.expires_at < now()` per spec §3.1.",
);

check(
  "T-A3 Migration body transitions tombstoned non-terminal rows to status='expired'",
  migrationBody !== null &&
    /status\s*=\s*CASE/i.test(migrationBody) &&
    /WHEN\s+status\s+IN\s*\(\s*'paid_completed'\s*,\s*'free_completed'\s*,\s*'failed'\s*,\s*'expired'\s*\)\s+THEN\s+status/i.test(
      migrationBody,
    ) &&
    /ELSE\s+'expired'/i.test(migrationBody),
  "Migration body MUST include a CASE expression that preserves terminal statuses as-is and writes 'expired' for non-terminal rows in the tombstone UPDATE.",
);

// ─── handleBuy try/catch/finally ───────────────────────────────────────────

const sheet = readMaybe(
  path.join(
    root,
    "src/components/expandedCard/ExpandedBusinessEventSheet.tsx",
  ),
);

check(
  "T-A4 handleBuy wraps runNativeCheckout in try ... finally { setCheckoutInFlight(false) }",
  sheet !== null &&
    /try\s*\{[\s\S]{0,3000}?await\s+runNativeCheckout[\s\S]{0,3000}?finally\s*\{[\s\S]{0,800}?setCheckoutInFlight\s*\(\s*false\s*\)/.test(
      sheet,
    ),
  "ExpandedBusinessEventSheet.tsx handleBuy MUST wrap the await runNativeCheckout call in a try block with a finally block that calls setCheckoutInFlight(false). Without finally, hung calls leave the flag stuck true.",
);

check(
  "T-A5 handleBuy catch converts thrown errors to { outcome: 'failed', message }",
  sheet !== null &&
    /catch\s*\(\s*err\s*\)\s*\{[\s\S]{0,500}?result\s*=\s*\{\s*outcome:\s*["']failed["'][\s\S]{0,150}?message[\s\S]{0,50}?\}/.test(
      sheet,
    ),
  "handleBuy catch block MUST convert thrown errors into a NativeCheckoutOutcome with outcome='failed' so the existing error-toast branch fires. Otherwise the rejection silently bubbles and the user sees nothing (Constitutional Rule 3).",
);

// ─── useStripePaymentSheet timeout race ────────────────────────────────────

const hook = readMaybe(
  path.join(repoRoot, "packages/payments-native/useStripePaymentSheet.ts"),
);

// ORCH-0844 FLIPPED — the timeout race that these four sub-checks originally
// asserted PRESENT is now asserted ABSENT. The race was a double-settle
// vector on iOS 26 (RCTPromiseResolveBlock fired twice from native +
// synthetic Timeout rejection from JS = three competing settles); the
// hang it guarded was resolved at the PI level by ORCH-0837 card-only
// PIs, so the race itself became net-negative.
check(
  "T-A6 (flipped) useStripePaymentSheet MUST NOT declare PAYMENT_SHEET_TIMEOUT_MS or function withTimeout",
  hook !== null &&
    !/const\s+PAYMENT_SHEET_TIMEOUT_MS\b/.test(hook) &&
    !/function\s+withTimeout\s*<\s*T\s*>\s*\(/.test(hook),
  "useStripePaymentSheet.ts MUST NOT declare PAYMENT_SHEET_TIMEOUT_MS or a withTimeout<T>(promise, ms, label) helper — the timeout race was retired in ORCH-0844 (the hang it guarded was resolved at the PI level by ORCH-0837 card-only PIs; the race itself became a double-settle vector on iOS 26).",
);

check(
  "T-A7 (flipped) Neither initPaymentSheet nor presentPaymentSheet wraps its native call in withTimeout(...)",
  hook !== null && !/\bwithTimeout\s*\(/.test(hook),
  "useStripePaymentSheet.ts MUST NOT invoke withTimeout(...) in either IIFE — the timeout race was retired in ORCH-0844. Native calls are awaited directly; the inFlightRef try/finally still clears the lock on settle.",
);

check(
  "T-A8 (flipped) useStripePaymentSheet MUST NOT emit a synthetic error with code: 'Timeout'",
  hook !== null && !/code:\s*["']Timeout["']/.test(hook),
  "useStripePaymentSheet.ts MUST NOT construct a synthetic rejection with code: 'Timeout' — the timeout race was retired in ORCH-0844. The PaymentSheetErrorCode 'Timeout' union member remains in types.ts as legacy (no longer emitted by this hook), but no code path here may produce it.",
);

check(
  "T-A9 (flipped) useStripePaymentSheet MUST NOT log `timed out after ${ms}ms`",
  hook !== null && !/timed out after \$\{ms\}ms/.test(hook),
  "useStripePaymentSheet.ts MUST NOT contain the diagnostic log line `timed out after ${ms}ms` — the timeout race was retired in ORCH-0844.",
);

// ─── Report ────────────────────────────────────────────────────────────────

console.log("\nORCH-0829-B D-1 regression check\n");
let failed = 0;
for (const c of checks) {
  const tag = c.pass ? "PASS" : "FAIL";
  console.log(`  [${tag}] ${c.name}`);
  if (!c.pass) {
    console.log(`         ${c.detail}`);
    failed += 1;
  }
}
console.log(
  `\nSummary: ${checks.length - failed}/${checks.length} PASS${
    failed > 0 ? ` (${failed} FAIL)` : ""
  }\n`,
);
process.exit(failed > 0 ? 1 : 0);
