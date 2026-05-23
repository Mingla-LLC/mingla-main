// ORCH-0925 ADVERSARIAL regression test — attacks distinct angles from
// the implementor's happy-path test (orch-0925-installment-customer-
// attachment.test.ts).
//
// Happy-path covers: fix shape is PRESENT.
// Adversarial covers: fix is correctly SCOPED + failure-mode CONTRACT
// + downstream side-effects.
//
// Distinct angles attacked here:
//  - A-1: full-pay Checkout Session does NOT receive customer_creation
//         (scope correctness: the conditional must not leak into full-pay)
//  - A-2: full-pay native PI does NOT receive `customer:` field
//         (mirror of A-1 for the PaymentIntent path)
//  - A-3: full-pay customer provisioning FAILURE preserves the ORCH-0844
//         guest-mode fallback (non-fatal contract preserved for non-installments)
//  - A-4: installment customer provisioning failure 502 EARLY-RETURN
//         is ordered BEFORE paymentIntents.create (no orphaned PI on failure)
//  - A-5: Stripe customers.search escapes single quotes in buyer email
//         (regression guard: malicious / Gmail-alias emails parse correctly,
//         the existing escape pattern is preserved end-to-end)
//
// All assertions read source + strip comments + match regex/string
// presence. No runtime mocking — kept consistent with the existing
// source-string assertion style under this directory.
//
// Append-only per ORCH-0840: this file is immutable once landed.

import {
  assert,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";

const indexSource = await Deno.readTextFile(
  new URL("../index.ts", import.meta.url),
);

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "")
    .replace(/[ \t]\/\/[^\n]*$/gm, "");
}

const sourceNoComments = stripComments(indexSource);

Deno.test(
  "ORCH-0925 A-1 — full-pay Checkout Session does NOT receive customer_creation (scope correctness)",
  () => {
    // Every reference to customer_creation must be inside an isInstallmentPlan-
    // guarded conditional spread. Bare `customer_creation:` (un-spread, un-
    // conditional) means the field would be set for full-pay too — that would
    // change the existing ORCH-0843 + ORCH-0844 + ORCH-0804 contracts.
    const customerCreationMatches = sourceNoComments.match(
      /customer_creation\s*:/g,
    );
    const guardedMatches = sourceNoComments.match(
      /\.\.\.\(\s*isInstallmentPlan\s*\?\s*\{\s*customer_creation:/g,
    );
    const totalCount = customerCreationMatches?.length ?? 0;
    const guardedCount = guardedMatches?.length ?? 0;
    assert(
      totalCount > 0,
      "Expected at least one customer_creation reference in source (the ORCH-0925 fix).",
    );
    assert(
      totalCount === guardedCount,
      `Expected ALL ${totalCount} customer_creation references to be guarded by isInstallmentPlan; only ${guardedCount} are. An unconditional customer_creation: would break full-pay scope.`,
    );
  },
);

Deno.test(
  "ORCH-0925 A-2 — full-pay native PI does NOT receive customer field (scope correctness)",
  () => {
    // The only `customer: customerId` reference inside the native PaymentIntent
    // path must be guarded by `isInstallmentPlan && customerId !== null`.
    // An unguarded `customer: customerId` in piCreateBody would attach Customer
    // to FULL-PAY PIs too — which breaks the ORCH-0843 direct-charge contract
    // (full-pay PIs intentionally have no Customer per the existing pattern).
    //
    // We assert the spread pattern is present AND that the piCreateBody literal
    // (between `const piCreateBody: Record<string, unknown> = {` and the
    // matching `};`) contains exactly one `customer:` key reference and it is
    // inside the guarded spread.
    const piBodyStart = sourceNoComments.indexOf(
      "const piCreateBody: Record<string, unknown> = {",
    );
    assert(piBodyStart >= 0, "Expected piCreateBody literal in source.");
    // Find matching closing brace — naive but sufficient since the literal
    // is well-known shape; look for the first `};\n` after start that is at
    // outer brace depth 1 (i.e., the closing of the literal).
    let depth = 0;
    let piBodyEnd = -1;
    for (let i = piBodyStart; i < sourceNoComments.length; i++) {
      const ch = sourceNoComments[i];
      if (ch === "{") depth++;
      if (ch === "}") {
        depth--;
        if (depth === 0) {
          piBodyEnd = i + 1;
          break;
        }
      }
    }
    assert(piBodyEnd > piBodyStart, "Expected to find closing brace of piCreateBody literal.");
    const piBodyLiteral = sourceNoComments.slice(piBodyStart, piBodyEnd);

    const guardedRe =
      /\.\.\.\(\s*isInstallmentPlan\s*&&\s*customerId\s*!==\s*null\s*\?\s*\{\s*customer:\s*customerId/;
    assert(
      guardedRe.test(piBodyLiteral),
      "Expected piCreateBody to contain the guarded spread `...(isInstallmentPlan && customerId !== null ? { customer: customerId ...`.",
    );

    // Count bare `customer:` occurrences inside piCreateBody — should be
    // exactly 1 (the one inside the guarded spread above).
    const bareMatches = piBodyLiteral.match(/\bcustomer\s*:/g);
    const bareCount = bareMatches?.length ?? 0;
    assert(
      bareCount === 1,
      `Expected exactly 1 \`customer:\` reference inside piCreateBody (the guarded spread), found ${bareCount}. An additional unguarded reference would leak Customer attachment to full-pay PIs.`,
    );
  },
);

Deno.test(
  "ORCH-0925 A-3 — full-pay customer provisioning failure preserves ORCH-0844 guest-mode fallback",
  () => {
    // The non-fatal branch for !isInstallmentPlan must still log + continue.
    // We assert the explicit guard `!isInstallmentPlan && customerProvisioningError !== null`
    // AND the historical "continuing in guest mode" warning string are both present.
    const guardRe =
      /if\s*\(\s*!isInstallmentPlan\s*&&\s*customerProvisioningError\s*!==\s*null\s*\)/;
    assert(
      guardRe.test(sourceNoComments),
      "Expected `if (!isInstallmentPlan && customerProvisioningError !== null)` guard to preserve ORCH-0844 non-fatal fallback.",
    );
    assert(
      sourceNoComments.includes('"[ticket-checkout-create] customer+ephemeralKey creation failed; continuing in guest mode"'),
      "Expected the ORCH-0844 'continuing in guest mode' console.warn message string to be preserved verbatim.",
    );
  },
);

Deno.test(
  "ORCH-0925 A-4 — installment FATAL early-return is ordered BEFORE paymentIntents.create (no orphaned PI on failure)",
  () => {
    // The critical invariant: if installment customer provisioning fails, the
    // edge fn MUST return 502 BEFORE reaching paymentIntents.create. Otherwise
    // we'd create a PaymentIntent on Stripe that has no Customer attached AND
    // no order in our DB — exactly the bug class ORCH-0925 set out to prevent
    // (orphaned PIs that the cron cannot charge + can't reconcile).
    const errorCodeIdx = sourceNoComments.indexOf(
      '"installment_customer_provisioning_failed"',
    );
    const piCreateIdx = sourceNoComments.indexOf("paymentIntents.create");
    assert(errorCodeIdx >= 0, "Expected FATAL error code in source.");
    assert(piCreateIdx >= 0, "Expected paymentIntents.create in source.");
    assert(
      errorCodeIdx < piCreateIdx,
      `Expected FATAL error code (idx ${errorCodeIdx}) to appear BEFORE paymentIntents.create (idx ${piCreateIdx}). If the order is reversed, the edge fn could create an orphaned PI before reaching the FATAL guard.`,
    );

    // Additionally assert the session row is marked failed in the FATAL branch
    // — without this, the session would remain in awaiting_* state forever
    // and the buyer would have no closure path.
    const sessionFailureRe =
      /status:\s*"failed"[\s\S]{0,400}?failure_reason:\s*"installment_customer_provisioning_failed"/;
    assert(
      sessionFailureRe.test(sourceNoComments),
      "Expected the FATAL branch to UPDATE ticket_checkout_sessions with status='failed' and failure_reason='installment_customer_provisioning_failed' (closure for the stuck session).",
    );
  },
);

Deno.test(
  "ORCH-0925 A-5 — Stripe customers.search escapes single quotes in buyer email (injection regression guard)",
  () => {
    // The customers.search query is a Stripe DSL string built via template
    // literal interpolation: `email:'${buyerEmail.replace(/'/g, "\\'")}'`.
    // If the .replace() escape is dropped, an email containing a single quote
    // (legal per RFC 5321, also the technique a malicious tester could use)
    // would break the search query syntax → Stripe returns 400 → our catch
    // turns the 400 into customerProvisioningError → installment plan returns
    // 502 to the buyer with no actionable detail. Regression-prevent the
    // escape function call.
    const escapeRe =
      /buyerEmail\.replace\(\s*\/'\/g\s*,\s*"\\\\'"\s*\)/;
    assert(
      escapeRe.test(sourceNoComments),
      "Expected `buyerEmail.replace(/'/g, \"\\\\'\")` escape inside the Stripe customers.search query template literal. Removing the escape would break injection-safety AND legitimate Gmail-alias buyers.",
    );

    // Also confirm the email value is wrapped in single quotes inside the
    // Stripe DSL — the literal pattern `email:'${...}'` is the exact Stripe
    // search-query DSL shape; deviating from this pattern would silently
    // break the search.
    const stripeDslRe = /email:'\$\{buyerEmail\.replace/;
    assert(
      stripeDslRe.test(sourceNoComments),
      "Expected Stripe customers.search query in `email:'${buyerEmail.replace(...)}'` DSL shape.",
    );
  },
);
