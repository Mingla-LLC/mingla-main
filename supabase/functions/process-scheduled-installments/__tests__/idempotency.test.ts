/**
 * ORCH-0869 [Tr3 Installment Payments] — implementor regression test.
 *
 * Per SPEC §6 T-04 (idempotency) + T-01 happy path source-level assertions.
 *
 * This is a SOURCE-ASSERTION test, mirroring the repo's pattern at
 * `mingla-business/app/account/__tests__/edit-profile.avatar.test.tsx`
 * and `mingla-business/src/utils/__tests__/routeForEventRow.test.ts`.
 * Pins load-bearing characteristics of the cron edge function source:
 *   - Idempotency key includes retry_count (so each retry attempt is
 *     independently idempotent at Stripe)
 *   - PI metadata carries the 4 required keys for webhook discrimination
 *   - At-risk flag flips at retry_count >= 3
 *   - Stripe-Account header on every PI create (direct charges)
 *   - Off-session + saved-PM contract on PI create
 *
 * Fails-on-revert: removing any of these characteristics from the cron
 * source will fail one or more assertions below. Cited at CLOSE Step 0.5
 * regression-test gate.
 *
 * Run: deno test supabase/functions/process-scheduled-installments/__tests__/
 */

import {
  assert,
  assertMatch,
  assertStringIncludes,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";

const CRON_SOURCE = await Deno.readTextFile(
  new URL("../index.ts", import.meta.url),
);
const WEBHOOK_HANDLER_SOURCE = await Deno.readTextFile(
  new URL("../../_shared/installmentWebhookHandlers.ts", import.meta.url),
);

Deno.test("ORCH-0869 cron: idempotency key includes retry_count (per SPEC §6 T-04)", () => {
  assertMatch(
    CRON_SOURCE,
    /idempotency[Kk]ey\s*=\s*`installment:\$\{installment\.order_id\}:\$\{installment\.ordinal\}:\$\{installment\.retry_count\}`/,
    "Cron idempotency key MUST include retry_count so each retry attempt is independently idempotent at Stripe. Without this, retry 2 reuses retry 1's key and Stripe returns the failed PI instead of creating a new attempt.",
  );
});

Deno.test("ORCH-0869 cron: PI create carries 4 metadata keys for webhook discrimination", () => {
  // mingla_installment_id is the discriminator the webhook router uses.
  assertStringIncludes(
    CRON_SOURCE,
    "mingla_installment_id: installment.id",
    "metadata.mingla_installment_id is the load-bearing discriminator for the webhook router.",
  );
  assertStringIncludes(CRON_SOURCE, "mingla_installment_ordinal");
  assertStringIncludes(CRON_SOURCE, "mingla_order_id: order.id");
  assertStringIncludes(CRON_SOURCE, "mingla_brand_id: brand.id");
});

Deno.test("ORCH-0869 cron: at-risk flag flips at retry_count >= MAX_RETRY_ATTEMPTS (per SPEC AC #9)", () => {
  assertMatch(
    CRON_SOURCE,
    /MAX_RETRY_ATTEMPTS\s*=\s*3/,
    "MAX_RETRY_ATTEMPTS = 3 per brief AC #9.",
  );
  assertMatch(
    CRON_SOURCE,
    /willBeAtRisk\s*=\s*nextRetryCount\s*>=\s*MAX_RETRY_ATTEMPTS/,
    "at_risk flips when nextRetryCount >= MAX_RETRY_ATTEMPTS, NOT when retry_count alone exceeds.",
  );
  assertStringIncludes(
    CRON_SOURCE,
    "at_risk: true",
    "Orders update must set at_risk: true when willBeAtRisk.",
  );
});

Deno.test("ORCH-0869 cron: every PI create uses Stripe-Account header (direct charge per ORCH-0843)", () => {
  // The stripeAccount option must accompany every paymentIntents.create.
  // I-PROPOSED-TR3-INSTALLMENT-PI-VIA-CRON-OWNER + ORCH-0843 direct-charge
  // invariant: installment PIs must be direct charges on the connected
  // account, not platform charges.
  assertMatch(
    CRON_SOURCE,
    /stripeAccount:\s*stripeAccount\.stripe_account_id/,
    "PI create must pass stripeAccount: stripeAccount.stripe_account_id as the third-arg request option.",
  );
});

Deno.test("ORCH-0869 cron: PI create uses off_session + saved PM contract", () => {
  assertStringIncludes(CRON_SOURCE, "off_session: true");
  assertStringIncludes(CRON_SOURCE, "confirm: true");
  assertMatch(
    CRON_SOURCE,
    /customer:\s*order\.stripe_customer_id_on_connected_account/,
    "PI must attach to the connected-account Customer (ORCH-0844).",
  );
  assertMatch(
    CRON_SOURCE,
    /payment_method:\s*order\.saved_payment_method_id/,
    "PI must use the saved PaymentMethod from booking (setup_future_usage:off_session at deposit time).",
  );
});

Deno.test("ORCH-0869 cron: card-only payment_method_types for installments (SPEC H-2)", () => {
  assertMatch(
    CRON_SOURCE,
    /payment_method_types:\s*\["card"\]/,
    "Installment PIs MUST be card-only; Link off-session reuse semantics excluded from v1.",
  );
});

Deno.test("ORCH-0869 cron: application_fee_amount per ORCH-0843 rate", () => {
  assertMatch(
    CRON_SOURCE,
    /MINGLA_APPLICATION_FEE_RATE\s*=\s*0\.015/,
    "Mingla platform cut = 1.5% per ORCH-0843 hardcoded rate; installments inherit.",
  );
  assertMatch(
    CRON_SOURCE,
    /application_fee_amount:\s*applicationFeeAmountCents/,
    "application_fee_amount must route Mingla cut on every installment PI.",
  );
});

Deno.test("ORCH-0869 cron: retry cadence Day-3 then Day-7 (per SPEC §3.2.1)", () => {
  assertMatch(
    CRON_SOURCE,
    /1:\s*72/,
    "retry_count 1 → 72 hours = Day-3 retry per SPEC.",
  );
  assertMatch(
    CRON_SOURCE,
    /2:\s*168/,
    "retry_count 2 → 168 hours = Day-7 retry per SPEC.",
  );
});

Deno.test("ORCH-0869 cron: rejects calls without service-role auth header", () => {
  // The serve handler must reject any caller without the SUPABASE_SERVICE_ROLE_KEY
  // Bearer token. pg_cron + manual debugging both send this header.
  assertStringIncludes(
    CRON_SOURCE,
    "if (authHeader !== expected)",
    "Cron edge function must service-role-auth gate the entry point.",
  );
  assertStringIncludes(CRON_SOURCE, `error: "unauthorized"`);
});

Deno.test("ORCH-0869 webhook handlers: route by metadata.mingla_installment_id", () => {
  assertMatch(
    WEBHOOK_HANDLER_SOURCE,
    /metadata\["mingla_installment_id"\]/,
    "Webhook discriminator MUST inspect metadata.mingla_installment_id; otherwise the existing handleTicketCheckoutPaymentIntent will run for installment PIs and break finalize semantics.",
  );
  assertStringIncludes(
    WEBHOOK_HANDLER_SOURCE,
    "isInstallmentPaymentIntentEvent",
  );
});

Deno.test("ORCH-0869 webhook handlers: success writer is predicate-bound (idempotent)", () => {
  // The .in("status", ["scheduled", "failed"]) predicate makes the update
  // safe under webhook replay + cron-then-webhook ordering.
  assertMatch(
    WEBHOOK_HANDLER_SOURCE,
    /\.in\("status",\s*\["scheduled",\s*"failed"\]\)/,
    "Webhook collected-state update MUST be predicate-bound to avoid double-write on replay.",
  );
});

Deno.test("ORCH-0869 webhook handlers: at_risk flag flips at MAX_RETRY_ATTEMPTS", () => {
  assertMatch(
    WEBHOOK_HANDLER_SOURCE,
    /MAX_RETRY_ATTEMPTS\s*=\s*3/,
    "Webhook handler must mirror cron's at-risk threshold.",
  );
  assertMatch(
    WEBHOOK_HANDLER_SOURCE,
    /willBeAtRisk\s*=\s*nextRetryCount\s*>=\s*MAX_RETRY_ATTEMPTS/,
  );
});
