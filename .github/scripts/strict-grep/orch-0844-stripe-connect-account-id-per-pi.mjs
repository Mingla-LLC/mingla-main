#!/usr/bin/env node
/**
 * ORCH-0844 strict-grep gate — Stripe Connect account ID is re-applied
 * per-PaymentIntent on the mobile side, and the server returns the
 * matching scope (stripeAccountId + customerId + customerEphemeralKeySecret)
 * on every `requires_payment` response.
 *
 * Enforces (PROPOSED → ACTIVE post-CLOSE):
 *   - I-PROPOSED-STRIPE-CONNECT-ACCOUNT-ID-PER-PI
 *
 * Background: ORCH-0843 flipped every ticket PI to direct-charge via
 * `{ stripeAccount }` request option. The PI's client_secret is scoped to
 * the connected account; the mobile Stripe SDK MUST be re-initialised with
 * the matching stripeAccountId before initPaymentSheet, otherwise the
 * SDK's mid-sheet confirm hits Stripe under the platform context and is
 * rejected with a 404 (manifests on iOS 26 as RCTPromiseResolveBlock
 * firing twice → "tried to resolve a promise more than once").
 *
 * Contracts (per SPEC §3.5.1 / §5):
 *   T-G1: app-mobile/src/payments/nativeCheckoutFlow.ts imports `initStripe`
 *         from `@stripe/stripe-react-native`.
 *   T-G2: nativeCheckoutFlow.ts calls `initStripe({ ... })` with both
 *         `publishableKey` and `stripeAccountId` fields in the same call,
 *         BEFORE the first `initPaymentSheet(` call site.
 *   T-G3: supabase/functions/ticket-checkout-create/index.ts returns a
 *         `stripeAccountId` key inside its `kind: "requires_payment"`
 *         jsonResponse block.
 *   T-G4: ticket-checkout-create/index.ts returns BOTH `customerId` AND
 *         `customerEphemeralKeySecret` keys inside the same
 *         `kind: "requires_payment"` jsonResponse block.
 *
 * Exit 1 on any FAIL with a named failure list. Pattern mirrors
 * `orch-0843-stripe-direct-charges-only.mjs`.
 *
 * `--self-test` proves fail-on-revert (mirrors i-1272-identity-admin-read.mjs):
 * the pure `check(flowRaw, checkoutRaw, failures)` is exercised with a GOOD
 * fixture (specificity) and ≥2 DISTINCT BAD fixtures (sensitivity). The
 * disk-reading main path calls the SAME `check(...)`; the refactor is
 * behavior-preserving (identical verdict on the real tree).
 */

import fs from "node:fs";
import path from "node:path";

const root = process.cwd().endsWith("mingla-business")
  ? path.resolve(process.cwd(), "..")
  : process.cwd();

// Strip line + block comments so we don't match doc comments that legitimately
// mention the enforced tokens.
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "")
    .replace(/[ \t]\/\/[^\n]*$/gm, "");
}

/**
 * Pure verdict. `flowRaw` = raw source of nativeCheckoutFlow.ts (or null if
 * unreadable). `checkoutRaw` = raw source of ticket-checkout-create/index.ts
 * (or null if unreadable). Comment-stripping happens here.
 */
function check(flowRaw, checkoutRaw, failures) {
  const flowNoComments = flowRaw == null ? "" : stripComments(flowRaw);
  const checkoutNoComments = checkoutRaw == null ? "" : stripComments(checkoutRaw);

  if (flowRaw == null) {
    failures.push(
      "T-G1/T-G2 app-mobile/src/payments/nativeCheckoutFlow.ts read failed.",
    );
  }
  if (checkoutRaw == null) {
    failures.push(
      "T-G3/T-G4 supabase/functions/ticket-checkout-create/index.ts read failed.",
    );
  }

  // ─── T-G1: initStripe imported from @stripe/stripe-react-native ────────────
  if (flowNoComments) {
    const importPattern =
      /import\s*\{[^}]*\binitStripe\b[^}]*\}\s*from\s*["']@stripe\/stripe-react-native["']/;
    if (!importPattern.test(flowNoComments)) {
      failures.push(
        `T-G1 app-mobile/src/payments/nativeCheckoutFlow.ts must import ` +
          `\`initStripe\` from \`@stripe/stripe-react-native\` ` +
          `(ORCH-0844: per-PI SDK re-init for Connect direct-charge PIs).`,
      );
    }
  }

  // ─── T-G2: initStripe({...}) call contains both publishableKey + stripeAccountId
  // AND appears before the first initPaymentSheet( call site. ────────────────
  if (flowNoComments) {
    const initStripeCallPattern =
      /initStripe\s*\(\s*\{[\s\S]{0,500}?publishableKey[\s\S]{0,500}?stripeAccountId[\s\S]{0,500}?\}\s*\)/;
    const initStripeMatch = initStripeCallPattern.exec(flowNoComments);
    if (!initStripeMatch) {
      failures.push(
        `T-G2 app-mobile/src/payments/nativeCheckoutFlow.ts must call ` +
          `\`initStripe({ publishableKey, stripeAccountId, ... })\` with both ` +
          `fields in the same call (ORCH-0844: per-PI Connect-account scoping).`,
      );
    } else {
      // Ordering: initStripe must come BEFORE the first initPaymentSheet( call.
      const firstInitSheetIdx = flowNoComments.search(/\binitPaymentSheet\s*\(/);
      if (firstInitSheetIdx !== -1 && initStripeMatch.index >= firstInitSheetIdx) {
        failures.push(
          `T-G2 app-mobile/src/payments/nativeCheckoutFlow.ts: \`initStripe(...)\` ` +
            `call appears AT/AFTER the first \`initPaymentSheet(\` call site. ` +
            `Per-PI SDK re-init MUST precede initPaymentSheet, otherwise the ` +
            `sheet's confirm hits Stripe under the wrong account context.`,
        );
      }
    }
  }

  // ─── T-G3: edge-fn requires_payment response includes stripeAccountId ──────
  if (checkoutNoComments) {
    const requiresPaymentBlock =
      /kind\s*:\s*["']requires_payment["'][\s\S]{0,2000}/.exec(checkoutNoComments);
    if (!requiresPaymentBlock) {
      failures.push(
        `T-G3 supabase/functions/ticket-checkout-create/index.ts must contain ` +
          `a \`kind: "requires_payment"\` response block (found none).`,
      );
    } else {
      const blockText = requiresPaymentBlock[0];
      if (!/\bstripeAccountId\b/.test(blockText)) {
        failures.push(
          `T-G3 supabase/functions/ticket-checkout-create/index.ts ` +
            `\`requires_payment\` response is missing \`stripeAccountId\` key ` +
            `(ORCH-0844: mobile SDK needs the connected-account scope per-PI).`,
        );
      }
      // ─── T-G4: same block contains BOTH customerId AND customerEphemeralKeySecret
      const hasCustomerId = /\bcustomerId\b/.test(blockText);
      const hasEphemeral = /\bcustomerEphemeralKeySecret\b/.test(blockText);
      if (!hasCustomerId || !hasEphemeral) {
        const missing = [];
        if (!hasCustomerId) missing.push("customerId");
        if (!hasEphemeral) missing.push("customerEphemeralKeySecret");
        failures.push(
          `T-G4 supabase/functions/ticket-checkout-create/index.ts ` +
            `\`requires_payment\` response is missing key(s): ${missing.join(", ")} ` +
            `(ORCH-0844: PaymentSheet saved-PM UI requires the Connect-scoped ` +
            `Customer + ephemeralKey pair; both null is the guest-mode fallback ` +
            `but both keys must be PRESENT in the response shape).`,
        );
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────── self-test
if (process.argv.includes("--self-test")) {
  const self = [];

  const goodFlow = [
    'import { initStripe, initPaymentSheet, presentPaymentSheet } from "@stripe/stripe-react-native";',
    "",
    "export async function runNativeCheckout() {",
    "  await initStripe({ publishableKey, stripeAccountId });",
    "  await initPaymentSheet({ customer, customerEphemeralKeySecret });",
    "}",
  ].join("\n");
  const goodCheckout = [
    "return jsonResponse({",
    '  kind: "requires_payment",',
    "  stripeAccountId,",
    "  customerId,",
    "  customerEphemeralKeySecret,",
    "});",
  ].join("\n");

  // GOOD: both files satisfy T-G1..T-G4.
  let f = [];
  check(goodFlow, goodCheckout, f);
  if (f.length) self.push("GOOD fixture wrongly flagged: " + f.join("; "));

  // BAD1 (revert-style): remove stripeAccountId from the initStripe call →
  // T-G2 fires (both fields required in the same call).
  const bad1Flow = goodFlow.replace(
    "await initStripe({ publishableKey, stripeAccountId });",
    "await initStripe({ publishableKey });",
  );
  f = [];
  check(bad1Flow, goodCheckout, f);
  if (f.length === 0) self.push("BAD1 (stripeAccountId removed from initStripe) not flagged");

  // BAD2 (regression, different angle): omit stripeAccountId from the server
  // requires_payment response block → T-G3 fires.
  const bad2Checkout = goodCheckout.replace("  stripeAccountId,\n", "");
  f = [];
  check(goodFlow, bad2Checkout, f);
  if (f.length === 0) self.push("BAD2 (server requires_payment missing stripeAccountId) not flagged");

  if (self.length) {
    console.error("ORCH-0844 self-test FAIL:");
    self.forEach((m) => console.error("  - " + m));
    process.exit(1);
  }
  console.log("ORCH-0844 self-test PASS (3/3 cases).");
  process.exit(0);
}

// ─────────────────────────────────────────────────────────────── main path
const failures = [];

const flowPath = path.join(root, "app-mobile/src/payments/nativeCheckoutFlow.ts");
let flowRaw = null;
try {
  flowRaw = fs.readFileSync(flowPath, "utf8");
} catch {
  flowRaw = null;
}

const checkoutPath = path.join(
  root,
  "supabase/functions/ticket-checkout-create/index.ts",
);
let checkoutRaw = null;
try {
  checkoutRaw = fs.readFileSync(checkoutPath, "utf8");
} catch {
  checkoutRaw = null;
}

check(flowRaw, checkoutRaw, failures);

if (failures.length > 0) {
  console.error("ORCH-0844 Stripe Connect-account-id-per-PI gate failed:");
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log("ORCH-0844 Stripe Connect-account-id-per-PI gate passed.");
