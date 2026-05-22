/**
 * ORCH-0921 ADVERSARIAL — `reconcile-stuck-checkouts` edge fn caller of
 * `biz_ticket_checkout_finalize`. Different angle from implementor's T-03/T-04.
 *
 * Implementor covered:
 *   T-03 — recovery caller passes 8 params for plan-root PI
 *   T-04 — recovery caller fall-through for non-plan PI
 *
 * Adversarial angles (5 tests):
 *   TA-R01 — caller is the same shape as the webhook router pattern (no drift)
 *   TA-R02 — `pi.customer` derivation handles Stripe SDK's `Customer | string | null`
 *            union safely via `typeof === "string"` (defensive type narrowing)
 *   TA-R03 — service-role-only auth gate preserved (no anon access expansion)
 *   TA-R04 — the loop's per-session error capture preserves the existing
 *            partial-success behavior (one bad session doesn't kill the run)
 *   TA-R05 — exactly one finalize invocation per session (no duplicate-call leak)
 */

import { assertEquals, assertMatch } from "https://deno.land/std@0.190.0/testing/asserts.ts";

const RECONCILE_SRC_PATH = new URL("../index.ts", import.meta.url);
const RECONCILE_SRC = await Deno.readTextFile(RECONCILE_SRC_PATH);

Deno.test("ORCH-0921 TA-R01 - reconcile caller mirrors webhook router pattern (metadata derivation shape parity)", () => {
  // Same derivation shape as stripeWebhookRouter.ts:778-784. Drift between
  // the two would cause divergent behavior between webhook-path and
  // reconcile-path payment-plan finalization.
  assertMatch(
    RECONCILE_SRC,
    /piMetadata\[\s*["']mingla_installment_plan_root["']\s*\]\s*===\s*["']true["']/,
    "Metadata derivation must match webhook router pattern",
  );
});

Deno.test("ORCH-0921 TA-R02 - pi.customer + pi.payment_method extraction handles the Stripe SDK Union type via typeof === 'string'", () => {
  // Stripe SDK types pi.customer as `string | Customer | null | undefined`.
  // The reconcile path uses an `as unknown as { customer?: unknown }` cast +
  // typeof guard so a Customer object (expandable) doesn't get serialized as
  // "[object Object]" into the RPC.
  assertMatch(
    RECONCILE_SRC,
    /typeof\s+\(pi\s+as\s+unknown\s+as\s+\{\s*customer\?\s*:\s*unknown\s*\}\)\.customer\s*===[\s\S]{0,30}["']string["']/,
    "pi.customer extraction must type-guard against non-string Customer object",
  );
  assertMatch(
    RECONCILE_SRC,
    /typeof\s+\(pi\s+as\s+unknown\s+as\s+\{\s*payment_method\?\s*:\s*unknown\s*\}\)[\s\S]{0,60}["']string["']/,
    "pi.payment_method extraction must type-guard against non-string PaymentMethod object",
  );
});

Deno.test("ORCH-0921 TA-R03 - service-role auth gate is preserved unchanged (no anon access expansion)", () => {
  // The function gates on auth header containing the service-role key.
  // ORCH-0921 must NOT have weakened this; otherwise anon callers could
  // trigger reconcile against ANY stuck session.
  assertMatch(
    RECONCILE_SRC,
    /if\s*\(!auth\.includes\(SERVICE_ROLE_KEY\)\)\s*\{[\s\S]{0,200}return\s+new\s+Response\(["']unauthorized["']/,
    "Service-role-only auth gate must remain in place",
  );
});

Deno.test("ORCH-0921 TA-R04 - per-session try/catch preserves partial-success: one bad PI does not abort the whole run", () => {
  // The for-of loop has a try/catch that pushes the error into `results`
  // and continues. ORCH-0921 must not have thrown the catch away.
  assertMatch(
    RECONCILE_SRC,
    /for\s+\(const\s+s\s+of\s+sessions[\s\S]{0,5000}try\s*\{[\s\S]{0,5000}\}\s+catch\s*\(err\)\s*\{[\s\S]{0,300}results\.push\([\s\S]{0,200}error:/,
    "Per-session try/catch must remain so a single bad session doesn't kill the run",
  );
});

Deno.test("ORCH-0921 TA-R05 - exactly one biz_ticket_checkout_finalize invocation per iteration (no duplicate-call)", () => {
  const matches = RECONCILE_SRC.match(/supabase\.rpc\(\s*\n?\s*["']biz_ticket_checkout_finalize["']/g);
  const count = matches ? matches.length : 0;
  assertEquals(
    count,
    1,
    `Expected exactly 1 biz_ticket_checkout_finalize invocation in reconcile loop; found ${count}`,
  );
});
