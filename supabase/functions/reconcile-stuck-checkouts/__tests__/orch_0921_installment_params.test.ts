// ORCH-0921 [Trip payment-plan finalize drops installments] happy-path tests.
//
// Run with:
//   deno test --allow-read supabase/functions/reconcile-stuck-checkouts/__tests__/orch_0921_installment_params.test.ts

import {
  assertMatch,
  assertStringIncludes,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";

const source = await Deno.readTextFile(new URL("../index.ts", import.meta.url));

function finalizePayload(sourceText: string): string {
  const match = sourceText.match(
    /supabase\.rpc\(\s*"biz_ticket_checkout_finalize"\s*,\s*\{([\s\S]*?)\}\s*,?\s*\)/,
  );
  if (!match) {
    throw new Error("expected reconcile-stuck-checkouts finalize RPC call");
  }
  return match[1];
}

Deno.test("ORCH-0921 T-03 - reconcile-stuck-checkouts passes populated installment params for plan-root PI", () => {
  assertMatch(
    source,
    /piMetadata\["mingla_installment_plan_root"\]\s*===\s*"true"/,
    "reconcile path must derive the plan-root flag from strict Stripe metadata equality.",
  );
  assertMatch(
    source,
    /typeof\s+\(pi\s+as\s+unknown\s+as\s+\{\s+customer\?:\s+unknown\s+\}\)\.customer\s*===\s*"string"/,
    "reconcile path must type-check Stripe Customer before passing it to finalize.",
  );
  assertMatch(
    source,
    /typeof\s+\(pi\s+as\s+unknown\s+as\s+\{\s+payment_method\?:\s+unknown\s+\}\)\s*\.payment_method\s*===\s*"string"/,
    "reconcile path must type-check saved PaymentMethod before passing it to finalize.",
  );

  const payload = finalizePayload(source);
  assertStringIncludes(
    payload,
    "p_stripe_customer_id_on_connected_account: stripeCustomerId",
  );
  assertStringIncludes(
    payload,
    "p_saved_payment_method_id: savedPaymentMethodId",
  );
  assertStringIncludes(
    payload,
    "p_installment_plan_root: isInstallmentPlanRoot",
  );
});

Deno.test("ORCH-0921 T-04 - reconcile-stuck-checkouts keeps non-plan fall-through false/null", () => {
  assertMatch(
    source,
    /const\s+isInstallmentPlanRoot\s*=\s*piMetadata\["mingla_installment_plan_root"\]\s*===\s*"true"/,
  );
  assertMatch(
    source,
    /const\s+stripeCustomerId[\s\S]*?\n\s*:\s*null;/,
    "non-plan PIs must pass null Stripe Customer.",
  );
  assertMatch(
    source,
    /const\s+savedPaymentMethodId[\s\S]*?\n\s*:\s*null;/,
    "non-plan PIs must pass null saved PaymentMethod.",
  );
  assertStringIncludes(finalizePayload(source), "p_qr_token_pepper: pepper");
});
