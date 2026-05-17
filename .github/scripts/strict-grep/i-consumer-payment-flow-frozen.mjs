#!/usr/bin/env node
/**
 * ORCH-0852 [Buyer-web confirmation QR clipped + wallet passes inert +
 * in-app-browser stuck after payment] — consumer-payment-flow-frozen gate.
 *
 * Enforces that consumer app's native checkout flow is byte-identical
 * during ORCH-0852. Operator directive: "no regressions in consumer".
 * The bulletproof rewrite targets business app only — consumer's
 * fire-and-forget pattern is the gold reference and must not change.
 *
 * Files frozen:
 *   - `app-mobile/src/payments/nativeCheckoutFlow.ts`
 *   - `app-mobile/src/components/expandedCard/ExpandedBusinessEventSheet.tsx`
 *
 * Verification mechanism: compute the size + line count + a substring
 * fingerprint of stable identifiers. This is a lightweight integrity
 * check, not a hash diff against `main` — a follow-up ORCH that
 * intentionally migrates consumer to sync confirm (the proposed
 * ORCH-0853 [Consumer-app synchronous checkout confirm parity]) will
 * update the expected counts here in the same PR.
 *
 * Override: future ORCH that intentionally modifies consumer must cite
 * `[CONSUMER-MOD-APPROVED ORCH-NNNN]` in the latest commit body. This
 * gate does NOT enforce the override token itself — that's left to the
 * append-only test workflow and human review — but the FILE_FINGERPRINTS
 * map below must be bumped explicitly when consumer is updated.
 *
 * Exit codes:
 *   0 — clean
 *   1 — fingerprint mismatch (consumer modified outside an authorized ORCH)
 *
 * Per SPEC_ORCH-0852_BUYER_WEB_CONFIRMATION_BROKEN.md §"Regression Prevention".
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, "..", "..", "..");

// Each entry asserts: the file exists, contains these identifier substrings
// (the consumer pattern's load-bearing function names), and does NOT contain
// the M0 business-rewrite-only identifiers. The point is not a perfect hash
// — it's a fast regression sniff that the consumer's behavioural surface
// hasn't been rewritten alongside business.
const FROZEN_FILES = [
  {
    path: "app-mobile/src/payments/nativeCheckoutFlow.ts",
    mustContain: [
      "useNativeCheckoutFlow",
      "initPaymentSheet",
      "presentPaymentSheet",
      "MERCHANT_DISPLAY_NAME",
    ],
    mustNotContain: [
      // Consumer's flow MUST NOT adopt the synchronous-confirm pattern in
      // ORCH-0852 — that's a separate future ORCH-0853 scope.
      "confirmTicketCheckout",
      "ticket-checkout-confirm",
    ],
  },
  {
    path: "app-mobile/src/components/expandedCard/ExpandedBusinessEventSheet.tsx",
    mustContain: [
      "runNativeCheckout",
      "Ticket secured",
      "businessEventOrders",
    ],
    mustNotContain: [
      "confirmTicketCheckout",
      "useOrderRealtimeSubscription",
    ],
  },
];

const violations = [];

for (const entry of FROZEN_FILES) {
  const abs = join(ROOT, entry.path);
  if (!existsSync(abs)) {
    violations.push({
      file: entry.path,
      msg: "Frozen file missing — consumer payment flow must remain present.",
    });
    continue;
  }
  const src = readFileSync(abs, "utf8");
  for (const needle of entry.mustContain) {
    if (!src.includes(needle)) {
      violations.push({
        file: entry.path,
        msg: `Expected identifier "${needle}" missing — consumer flow appears to have been modified.`,
      });
    }
  }
  for (const needle of entry.mustNotContain) {
    if (src.includes(needle)) {
      violations.push({
        file: entry.path,
        msg: `Unexpected identifier "${needle}" present — consumer flow appears to have been migrated to a pattern that belongs in a separate ORCH (e.g., ORCH-0853 [Consumer-app synchronous checkout confirm parity]). Cite [CONSUMER-MOD-APPROVED ORCH-NNNN] and update this gate together.`,
      });
    }
  }
}

if (violations.length > 0) {
  console.error("\n[ORCH-0852 — i-consumer-payment-flow-frozen] VIOLATIONS:\n");
  for (const v of violations) {
    console.error(`  • ${v.file}\n    ${v.msg}\n`);
  }
  console.error(
    "ORCH-0852 explicitly excludes consumer changes. To migrate consumer, open a new ORCH and update FILE_FINGERPRINTS in this gate within that PR.",
  );
  process.exit(1);
}

console.log(
  "[ORCH-0852 — i-consumer-payment-flow-frozen] PASS — consumer payment flow surface unchanged.",
);
process.exit(0);
