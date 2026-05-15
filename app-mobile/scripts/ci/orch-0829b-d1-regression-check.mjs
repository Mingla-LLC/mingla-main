#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * ORCH-0829-B D-1 regression check.
 *
 * Asserts the three-layer fix for the silent-failure paid checkout:
 *   - Database: new migration extends the tombstone-eligibility predicate
 *     so past-expiry in-flight sessions get tombstoned and transitioned
 *     to status='expired' (R-1).
 *   - Component: handleBuy wraps runNativeCheckout in try/catch/finally
 *     so checkoutInFlight always clears even on hang/throw (H-2).
 *   - Package: useStripePaymentSheet adds a 60s timeout race around both
 *     initPaymentSheet and presentPaymentSheet (H-3).
 *
 * Contracts (spec §3.4 S4):
 *   T-A1  Migration file with monotonic prefix > 20260605000001 exists
 *   T-A2  Migration body contains the new OR clause `expires_at < now()`
 *   T-A3  Migration body transitions tombstoned non-terminal rows to status='expired'
 *   T-A4  handleBuy wraps runNativeCheckout in try { ... } finally { setCheckoutInFlight(false) }
 *   T-A5  handleBuy catch converts thrown errors to { outcome: "failed", message }
 *   T-A6  useStripePaymentSheet declares PAYMENT_SHEET_TIMEOUT_MS = 60_000 and withTimeout helper
 *   T-A7  Both initPaymentSheet and presentPaymentSheet wrappers call withTimeout(...)
 *   T-A8  Synthetic timeout error has code: "Timeout"
 *   T-A9  Timeout fires diagnostic log line `<label> timed out after <ms>ms`
 *
 * Invariants codified:
 *   I-PROPOSED-CHECKOUT-EXPIRY-TOMBSTONE  (T-A1, T-A2, T-A3)
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

check(
  "T-A6 useStripePaymentSheet declares PAYMENT_SHEET_TIMEOUT_MS = 60_000 and withTimeout helper",
  hook !== null &&
    /const\s+PAYMENT_SHEET_TIMEOUT_MS\s*=\s*60_000\b/.test(hook) &&
    /function\s+withTimeout\s*<\s*T\s*>\s*\(/.test(hook),
  "useStripePaymentSheet.ts MUST declare PAYMENT_SHEET_TIMEOUT_MS = 60_000 and a module-level withTimeout<T>(promise, ms, label) helper per spec §3.3.",
);

check(
  "T-A7 Both initPaymentSheet and presentPaymentSheet wrap their native calls in withTimeout(...)",
  hook !== null &&
    /withTimeout\s*\(\s*initPaymentSheet\s*\(\s*input\s*\)\s*,\s*PAYMENT_SHEET_TIMEOUT_MS\s*,\s*["']initPaymentSheet["']\s*,?\s*\)/.test(
      hook,
    ) &&
    /withTimeout\s*\(\s*presentPaymentSheet\s*\(\s*\)\s*,\s*PAYMENT_SHEET_TIMEOUT_MS\s*,\s*["']presentPaymentSheet["']\s*,?\s*\)/.test(
      hook,
    ),
  "Both wrappers MUST invoke withTimeout(initPaymentSheet(input), PAYMENT_SHEET_TIMEOUT_MS, 'initPaymentSheet') and withTimeout(presentPaymentSheet(), PAYMENT_SHEET_TIMEOUT_MS, 'presentPaymentSheet') inside their IIFEs so the existing finally clears the in-flight ref on timeout.",
);

check(
  "T-A8 Synthetic timeout error carries code: 'Timeout'",
  hook !== null && /code:\s*["']Timeout["']/.test(hook),
  "withTimeout's synthetic rejection MUST attach code: 'Timeout' (distinct from Stripe's 'Canceled' and 'Failed' codes) so downstream callers can detect timeout-specific failure.",
);

check(
  "T-A9 Timeout fires diagnostic log line `<label> timed out after <ms>ms`",
  hook !== null &&
    /timed out after \$\{ms\}ms/.test(hook),
  "withTimeout MUST log `[useStripePaymentSheet] ${label} timed out after ${ms}ms` so the tester has a positive Metro signal that the timeout race triggered.",
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
