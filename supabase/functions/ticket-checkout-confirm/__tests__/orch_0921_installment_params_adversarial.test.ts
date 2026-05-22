/**
 * ORCH-0921 ADVERSARIAL — `ticket-checkout-confirm` edge fn caller of
 * `biz_ticket_checkout_finalize`. Attacks different angles from implementor's
 * T-01 (plan-root happy path) + T-02 (non-plan fall-through).
 *
 * Adversarial angles (6 tests):
 *   TA-C01 — strict-grep gate works against THIS specific deployed source
 *   TA-C02 — the metadata key MUST be the literal string "mingla_installment_plan_root"
 *            (typos/aliases would silently drop the plan)
 *   TA-C03 — the metadata value comparison MUST be against literal string "true"
 *            (Stripe always serializes metadata as strings; boolean true would never match)
 *   TA-C04 — when isInstallmentPlanRoot is true, customer/PM derivation MUST
 *            type-guard with typeof === "string" (defensive against unexpected
 *            object/null/undefined values from the Stripe SDK type union)
 *   TA-C05 — non-plan PIs MUST pass p_installment_plan_root: false (NOT undefined)
 *            so the RPC's DEFAULT false param resolution is never relied upon
 *   TA-C06 — the patch MUST stay above the existing finalize call site, not
 *            duplicate the call (no double-invocation possible)
 */

import { assertEquals, assertMatch } from "https://deno.land/std@0.190.0/testing/asserts.ts";

const CONFIRM_SRC_PATH = new URL("../index.ts", import.meta.url);
const CONFIRM_SRC = await Deno.readTextFile(CONFIRM_SRC_PATH);

Deno.test("ORCH-0921 TA-C01 - ticket-checkout-confirm/index.ts call site is detected by the new strict-grep gate (post-fix)", () => {
  // The strict-grep gate considers a call valid when p_installment_plan_root
  // appears in the surrounding 30 lines of the RPC call. Verify our patch
  // produces such a call site by reading the source directly.
  const rpcCallIdx = CONFIRM_SRC.indexOf('supabase.rpc(\n      "biz_ticket_checkout_finalize"');
  // Fall back to looser shape if formatting differs
  const rpcCallIdxAlt = CONFIRM_SRC.indexOf('biz_ticket_checkout_finalize');
  const rpcIdx = rpcCallIdx >= 0 ? rpcCallIdx : rpcCallIdxAlt;
  if (rpcIdx < 0) throw new Error("biz_ticket_checkout_finalize call site not found");
  const window = CONFIRM_SRC.substring(rpcIdx, rpcIdx + 1500);
  assertMatch(
    window,
    /p_installment_plan_root/,
    "p_installment_plan_root must appear within 30 lines of the finalize RPC call",
  );
});

Deno.test('ORCH-0921 TA-C02 - metadata key MUST be the exact literal "mingla_installment_plan_root"', () => {
  // A typo like "mingla_installments_plan_root" or "mingla_installment_plan"
  // would silently drop every payment-plan order back into the leaked state.
  assertMatch(
    CONFIRM_SRC,
    /piMetadata\[\s*["']mingla_installment_plan_root["']\s*\]/,
    "Metadata key must be the exact literal 'mingla_installment_plan_root'",
  );
});

Deno.test('ORCH-0921 TA-C03 - metadata value comparison MUST be against literal string "true" (Stripe stringifies metadata)', () => {
  // Stripe's API stores all metadata values as strings. A comparison against
  // boolean `true` (i.e., `=== true` without quotes) would never match. This
  // pins the correct comparison shape.
  assertMatch(
    CONFIRM_SRC,
    /piMetadata\[\s*["']mingla_installment_plan_root["']\s*\]\s*===\s*["']true["']/,
    "Comparison must be against the literal string 'true', not boolean true",
  );
});

Deno.test("ORCH-0921 TA-C04 - customer/PM derivation type-guards with typeof === 'string'", () => {
  // The Stripe SDK types paymentIntent.customer + payment_method as
  // unknown/string|null/object union. Without the typeof guard a non-string
  // value would be passed to the RPC and SQL-cast-fail at finalize time.
  assertMatch(
    CONFIRM_SRC,
    /typeof\s+paymentIntent\.customer\s*===\s*["']string["']/,
    "paymentIntent.customer derivation must type-guard with typeof === 'string'",
  );
  assertMatch(
    CONFIRM_SRC,
    /typeof\s+paymentIntent\.payment_method\s*===\s*["']string["']/,
    "paymentIntent.payment_method derivation must type-guard with typeof === 'string'",
  );
});

Deno.test("ORCH-0921 TA-C05 - non-plan PI fall-through passes explicit null/false, NOT relying on RPC param defaults", () => {
  // If the patch said `p_installment_plan_root: isInstallmentPlanRoot || undefined`
  // and `isInstallmentPlanRoot` were false, the params would be undefined and
  // the RPC's DEFAULT false would apply — same observable behavior, but more
  // fragile (default-value drift in a future migration could flip semantics).
  // Pin the explicit-pass shape.
  assertMatch(
    CONFIRM_SRC,
    /p_installment_plan_root:\s*isInstallmentPlanRoot\s*,/,
    "p_installment_plan_root MUST pass the boolean variable directly (not undefined / via spread)",
  );
  // Also verify customer/PM are explicitly passed (could be null) — not omitted.
  assertMatch(
    CONFIRM_SRC,
    /p_stripe_customer_id_on_connected_account:\s*stripeCustomerId\s*,/,
    "p_stripe_customer_id_on_connected_account MUST be explicitly passed",
  );
  assertMatch(
    CONFIRM_SRC,
    /p_saved_payment_method_id:\s*savedPaymentMethodId\s*,/,
    "p_saved_payment_method_id MUST be explicitly passed",
  );
});

Deno.test("ORCH-0921 TA-C06 - exactly one biz_ticket_checkout_finalize invocation in the confirm handler (no double-call)", () => {
  const matches = CONFIRM_SRC.match(/supabase\.rpc\(\s*\n?\s*["']biz_ticket_checkout_finalize["']/g);
  const count = matches ? matches.length : 0;
  assertEquals(
    count,
    1,
    `Expected exactly 1 biz_ticket_checkout_finalize invocation in confirm handler; found ${count}`,
  );
});
