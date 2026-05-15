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
 */

import fs from "node:fs";
import path from "node:path";

const root = process.cwd().endsWith("mingla-business")
  ? path.resolve(process.cwd(), "..")
  : process.cwd();

const failures = [];

// Strip line + block comments so we don't match doc comments that legitimately
// mention the enforced tokens.
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "")
    .replace(/[ \t]\/\/[^\n]*$/gm, "");
}

const flowPath = path.join(
  root,
  "app-mobile/src/payments/nativeCheckoutFlow.ts",
);
let flowSource = "";
let flowNoComments = "";
try {
  flowSource = fs.readFileSync(flowPath, "utf8");
  flowNoComments = stripComments(flowSource);
} catch (error) {
  failures.push(
    `T-G1/T-G2 app-mobile/src/payments/nativeCheckoutFlow.ts read failed: ${error.message}`,
  );
}

const checkoutPath = path.join(
  root,
  "supabase/functions/ticket-checkout-create/index.ts",
);
let checkoutSource = "";
let checkoutNoComments = "";
try {
  checkoutSource = fs.readFileSync(checkoutPath, "utf8");
  checkoutNoComments = stripComments(checkoutSource);
} catch (error) {
  failures.push(
    `T-G3/T-G4 supabase/functions/ticket-checkout-create/index.ts read failed: ${error.message}`,
  );
}

// ─── T-G1: initStripe imported from @stripe/stripe-react-native ──────────────
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

// ─── T-G3: edge-fn requires_payment response includes stripeAccountId ───────
if (checkoutNoComments) {
  // Find the kind: "requires_payment" jsonResponse block. We scan a wide
  // window (up to 2000 chars from the `kind: "requires_payment"` literal)
  // to cover the full response object.
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

if (failures.length > 0) {
  console.error("ORCH-0844 Stripe Connect-account-id-per-PI gate failed:");
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log("ORCH-0844 Stripe Connect-account-id-per-PI gate passed.");
