// ORCH-0925 regression test — assert `ticket-checkout-create/index.ts`
// attaches a Stripe Customer to payment-plan checkouts so the cron
// `process-scheduled-installments` can later charge the saved
// PaymentMethod off-session.
//
// Pattern follows the source-string assertion style established by the
// existing ORCH-0843 / ORCH-0911 / payment-method-allowlist tests under
// supabase/functions/ticket-checkout-create/__tests__/. We read the
// source, strip comments, and assert the load-bearing strings + ordering.
//
// Happy-path coverage:
//  - HP-1: Checkout Session payload conditionally sets
//          customer_creation: "always" guarded by isInstallmentPlan
//  - HP-2: piCreateBody conditionally attaches `customer: customerId`
//          guarded by isInstallmentPlan && customerId !== null
//  - HP-3: customer provisioning failure is FATAL for installment plans
//          (returns installment_customer_provisioning_failed via 502)
//  - HP-4: customer provisioning block is REORDERED to run BEFORE
//          paymentIntents.create (so customerId is available for piCreateBody)
//  - HP-5: customer provisioning block does NOT appear twice (regression
//          guard against forgetting to delete the old location after move)
//
// The tester's adversarial pair lives at
// orch-0925-installment-customer-attachment.adversarial.test.ts and
// attacks scope correctness + failure-mode contract (distinct angle).
//
// `fails-on-revert`: verified by implementor at the pre-fix commit hash
// captured in the implementation report. With Changes 1-4 reverted,
// assertions HP-1, HP-2, HP-3 MUST FAIL.

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";

const indexSource = await Deno.readTextFile(
  new URL("../index.ts", import.meta.url),
);

// Strip line + block comments before testing, mirroring the CI gate so
// invariant-preserving doc comments that mention the load-bearing
// keywords don't trip (or rescue) the assertions.
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "")
    .replace(/[ \t]\/\/[^\n]*$/gm, "");
}

const sourceNoComments = stripComments(indexSource);

Deno.test(
  "ORCH-0925 HP-1 — Checkout Session conditionally sets customer_creation: 'always' for installment plans",
  () => {
    const re =
      /\.\.\.\(\s*isInstallmentPlan\s*\?\s*\{\s*customer_creation:\s*"always"/;
    assert(
      re.test(sourceNoComments),
      "Expected source to contain a `...(isInstallmentPlan ? { customer_creation: \"always\" ...` spread inside checkout.sessions.create payload.",
    );
  },
);

Deno.test(
  "ORCH-0925 HP-2 — piCreateBody conditionally attaches customer for installment plans",
  () => {
    const re =
      /\.\.\.\(\s*isInstallmentPlan\s*&&\s*customerId\s*!==\s*null\s*\?\s*\{\s*customer:\s*customerId/;
    assert(
      re.test(sourceNoComments),
      "Expected source to contain a `...(isInstallmentPlan && customerId !== null ? { customer: customerId ...` spread inside piCreateBody.",
    );
  },
);

Deno.test(
  "ORCH-0925 HP-3 — customer provisioning failure is FATAL for installment plans",
  () => {
    assert(
      sourceNoComments.includes('"installment_customer_provisioning_failed"'),
      "Expected source to contain the FATAL error code 'installment_customer_provisioning_failed'.",
    );
    const guardRe = /if\s*\(\s*isInstallmentPlan\s*&&\s*customerId\s*===\s*null\s*\)/;
    assert(
      guardRe.test(sourceNoComments),
      "Expected source to contain `if (isInstallmentPlan && customerId === null)` guard.",
    );
  },
);

Deno.test(
  "ORCH-0925 HP-4 — customer provisioning block precedes paymentIntents.create",
  () => {
    const customerIdDeclIdx = sourceNoComments.indexOf(
      "let customerId: string | null = null;",
    );
    const piCreateIdx = sourceNoComments.indexOf("paymentIntents.create");
    assert(customerIdDeclIdx >= 0, "Expected `let customerId` declaration in source.");
    assert(piCreateIdx >= 0, "Expected `paymentIntents.create` call in source.");
    assert(
      customerIdDeclIdx < piCreateIdx,
      `Expected customerId declaration (idx ${customerIdDeclIdx}) to precede paymentIntents.create (idx ${piCreateIdx}). The ORCH-0925 reorder did not happen.`,
    );
  },
);

Deno.test(
  "ORCH-0925 HP-5 — customer provisioning block does NOT appear twice (regression guard)",
  () => {
    const matches = sourceNoComments.match(
      /let\s+customerId:\s*string\s*\|\s*null\s*=\s*null;/g,
    );
    const count = matches?.length ?? 0;
    assertEquals(
      count,
      1,
      `Expected EXACTLY one declaration of \`let customerId: string | null = null;\` (found ${count}). The old block at the original location must be deleted as part of the ORCH-0925 reorder.`,
    );
  },
);
