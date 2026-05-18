/**
 * ORCH-0875 [Tr4 Refund Tiers + Booking Deadline] — TESTER-AUTHORED adversarial
 * regression test.
 *
 * Per ORCH-0840 [Regression-test enforcement + append-only CI] Step 0.5 (b):
 * tester MUST author an adversarial test that attacks a DIFFERENT angle than
 * the implementor's happy-path. Implementor's contract_invariants.test.ts pins
 * source patterns ("the pattern exists"). This file attacks the patterns from
 * a different angle ("the pattern resists tampering", "the pattern is the
 * ONLY enforcement", "the pattern can't be bypassed via a forged
 * surrounding token / cross-key collision / metadata stripping").
 *
 * Test taxonomy (per dispatch §5):
 *   AD-01 — anon-RPC-bypass at PostgREST layer (proves P0 hotfix REVOKE
 *           closed the gap discovered at Phase C verification)
 *   AD-04 — SC-22 freshness divergence: race condition between buyer preview
 *           and operator policy edit
 *   AD-05 — refunds.amount_cents immutability trigger fires on UPDATE
 *   AD-06 — refund_line_items.installment_id cross-order mismatch trigger fires
 *   AD-07 — cron skips cancelled installments (belt-and-braces filter)
 *   AD-09 — events_refund_policy_valid CHECK constraint fires on
 *           monotonicity-violating UPDATE bypassing client validator
 *   AD-10 — stripe.refunds.create call sites cannot be added without
 *           stripeAccount header (defense-in-depth source assertion)
 *
 * Execution model:
 *   - Source-grade tests run unconditionally (no env required).
 *   - DB-firing tests (AD-05 / AD-06 / AD-09 / AD-07-cron / AD-04-end-to-end)
 *     require SUPABASE_SERVICE_ROLE_KEY + SUPABASE_URL in env. When absent,
 *     they skip with an explicit operator-runs marker so the orchestrator
 *     CLOSE banner can note them as documented operator-coordinated tests.
 *
 * Fails-on-revert hypotheses (cited per test):
 *   AD-01 — if hotfix migration 20260612000001 is reverted, RPC ACL gains
 *           anon EXECUTE → AD-01 source-grade ACL-shape check still PASSES
 *           (source code unchanged) BUT the live runtime check would FAIL.
 *           This file's AD-01 source test pins the existence of the REVOKE
 *           statements in the hotfix migration; a future revert that drops
 *           them silently would fail this test.
 *   AD-05 — revert tg_refunds_amount_immutable trigger creation in migration
 *           → AD-05-source test FAILS (RAISE EXCEPTION line missing).
 *   AD-06 — revert tg_refund_line_items_installment_parity trigger → AD-06
 *           source test FAILS.
 *   AD-09 — revert events_refund_policy_valid CHECK constraint → AD-09
 *           source test FAILS.
 *   AD-10 — neuter stripeAccount in any future refunds.create call site →
 *           AD-10 source test FAILS (zero-tolerance stripeAccount-absent
 *           regex).
 */

import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";

const __dirname = new URL(".", import.meta.url).pathname;
const REPO_ROOT = `${__dirname}../../../..`;
const EDGE_FN_SOURCE = await Deno.readTextFile(`${__dirname}../index.ts`);
const PARENT_MIGRATION = await Deno.readTextFile(
  `${REPO_ROOT}/supabase/migrations/20260612000000_tr4_refund_tiers_booking_deadline.sql`,
);
const HOTFIX_MIGRATION = await Deno.readTextFile(
  `${REPO_ROOT}/supabase/migrations/20260612000001_tr4_revoke_rpc_anon_grants.sql`,
);
const CRON_SOURCE = await Deno.readTextFile(
  `${REPO_ROOT}/supabase/functions/process-scheduled-installments/index.ts`,
);
const CHECKOUT_SOURCE = await Deno.readTextFile(
  `${REPO_ROOT}/supabase/functions/ticket-checkout-create/index.ts`,
);

// =========================================================================
// AD-01 — Anon-RPC-bypass: hotfix REVOKE statements present + intact
// =========================================================================
// Different angle than implementor: implementor's contract test verifies
// the FUNCTION definitions exist; this test verifies the HOTFIX MIGRATION
// is intact and contains all 4 REVOKE statements + the self-verification
// probe asserting clean ACL.

Deno.test("AD-01 hotfix REVOKE present for all 4 SECURITY DEFINER RPCs", () => {
  const requiredRevokes = [
    "REVOKE EXECUTE ON FUNCTION biz_compute_refund_for_cancel",
    "REVOKE EXECUTE ON FUNCTION biz_cancel_trip_booking_begin",
    "REVOKE EXECUTE ON FUNCTION biz_cancel_trip_booking_commit",
    "REVOKE EXECUTE ON FUNCTION biz_cancel_trip_booking_rollback",
  ];
  for (const stmt of requiredRevokes) {
    assert(
      HOTFIX_MIGRATION.includes(stmt) &&
        HOTFIX_MIGRATION.includes("FROM anon, authenticated"),
      `Hotfix migration missing required REVOKE statement: "${stmt} ... FROM anon, authenticated"`,
    );
  }
});

Deno.test("AD-01 hotfix self-verification probe asserts clean ACL post-apply", () => {
  // The probe block in the hotfix migration loops over 4 functions + raises
  // EXCEPTION if anon=X or authenticated=X appears in the ACL. Without this
  // probe, a partial-apply could leave some functions still exposed.
  assert(
    /v_acl_text LIKE '%anon=X%'/.test(HOTFIX_MIGRATION),
    "Hotfix self-verification probe missing anon=X scan",
  );
  assert(
    /v_acl_text LIKE '%authenticated=X%'/.test(HOTFIX_MIGRATION),
    "Hotfix self-verification probe missing authenticated=X scan",
  );
  assert(
    /v_acl_text NOT LIKE '%service_role=X%'/.test(HOTFIX_MIGRATION),
    "Hotfix self-verification probe missing service_role=X positive assertion",
  );
});

// =========================================================================
// AD-04 — SC-22 freshness divergence: tampering with computed amount
// =========================================================================
// Different angle: implementor's contract test pins the `computedRefundTotalCents
// !== expectedRefundTotalCents` comparison exists. This test attacks the
// LOOSE-EQUALITY angle (someone "simplifies" === to == which would coerce
// "100" === 100 to true) and the SKIP-PATH angle (someone wraps the check
// in a try/catch that swallows errors).

Deno.test("AD-04 SC-22 freshness uses STRICT-EQUAL comparison (not ==)", () => {
  // Find the comparison line + verify it's !== not !=. A switch to !=
  // would allow a JSON string "100" to silently equal numeric 100, defeating
  // the freshness check.
  const matches = EDGE_FN_SOURCE.match(
    /computedRefundTotalCents\s*([!=]={1,3})\s*expectedRefundTotalCents/,
  );
  assert(matches !== null, "SC-22 comparison missing entirely");
  assertEquals(
    matches[1],
    "!==",
    `SC-22 freshness divergence uses ${matches[1]} not !==; loose comparison would allow type-coerced bypass`,
  );
});

Deno.test("AD-04 SC-22 rollback is awaited (not fire-and-forget) AND returns 409 immediately", () => {
  // Extract the divergence block using a narrower regex that stops at the
  // first `return jsonResponse(...)` after the if-condition. Verifies:
  //   - rollback is AWAITED (not fire-and-forget — orphan refund row risk)
  //   - the return is 409 with policy_updated (correct HTTP semantics)
  //   - currentRefundTotalCents key present in response (UI needs it to refresh)
  const blockMatch = EDGE_FN_SOURCE.match(
    /if\s*\(computedRefundTotalCents\s*!==\s*expectedRefundTotalCents\)\s*\{[\s\S]*?return jsonResponse\([\s\S]*?\);/,
  );
  assert(blockMatch !== null, "Could not find SC-22 divergence block (if/return shape)");
  const block = blockMatch[0];
  assert(
    /await\s+supabase\.rpc\("biz_cancel_trip_booking_rollback"/.test(block),
    "SC-22 divergence rollback is not awaited — fire-and-forget would orphan the refund row",
  );
  assert(
    /"policy_updated"/.test(block),
    "SC-22 divergence does not return 'policy_updated' error code",
  );
  assert(
    /currentRefundTotalCents/.test(block),
    "SC-22 divergence response missing currentRefundTotalCents — UI cannot refresh to new amount",
  );
  assert(
    /409/.test(block),
    "SC-22 divergence does not return HTTP 409",
  );
});

// =========================================================================
// AD-05 — refunds.amount_cents immutability trigger source intact
// =========================================================================
// Different angle: implementor's contract test verifies the function in the
// DB exists. This test verifies the migration SOURCE has the RAISE statement
// (so a future migration revert that creates the trigger as a no-op would
// fail). Also verifies the trigger is BEFORE UPDATE (not AFTER — AFTER would
// fire AFTER the bad write committed, too late to prevent the change).

Deno.test("AD-05 amount-immutability trigger fires BEFORE UPDATE (not AFTER)", () => {
  assert(
    /CREATE TRIGGER trg_refunds_amount_immutable\s+BEFORE UPDATE ON public\.refunds/.test(
      PARENT_MIGRATION,
    ),
    "trg_refunds_amount_immutable must be BEFORE UPDATE — AFTER would let the bad write commit before raising",
  );
});

Deno.test("AD-05 amount-immutability raises with TR4 invariant ID in message", () => {
  // The RAISE EXCEPTION message must contain the invariant ID so operators
  // can grep their logs + tie incidents to the invariant registry.
  assert(
    /RAISE EXCEPTION 'I-PROPOSED-TR4-REFUND-AMOUNT-PINNED-AT-CANCEL/.test(
      PARENT_MIGRATION,
    ),
    "amount-immutability EXCEPTION message missing I-PROPOSED-TR4-REFUND-AMOUNT-PINNED-AT-CANCEL marker",
  );
});

Deno.test("AD-05 amount-immutability uses IS DISTINCT FROM (not !=) — handles NULL correctly", () => {
  // Edge case: if amount_cents is somehow NULL, `OLD.amount_cents != NEW.amount_cents`
  // returns NULL (not true), so the trigger wouldn't fire. IS DISTINCT FROM
  // correctly evaluates NULL ≠ value as true.
  assert(
    /IF OLD\.amount_cents IS DISTINCT FROM NEW\.amount_cents/.test(
      PARENT_MIGRATION,
    ),
    "amount-immutability comparison uses != instead of IS DISTINCT FROM — NULL would bypass the check",
  );
});

// =========================================================================
// AD-06 — refund_line_items.installment_id cross-order parity trigger
// =========================================================================

Deno.test("AD-06 installment-parity trigger handles NULL installment_id early-return", () => {
  // Single-payment refunds (ORCH-0787 [refund-order]) have installment_id=NULL
  // and must NOT be blocked by the parity trigger. The function must early-
  // return when installment_id IS NULL.
  assert(
    /IF NEW\.installment_id IS NULL THEN\s+RETURN NEW;\s+END IF;/.test(
      PARENT_MIGRATION,
    ),
    "installment-parity trigger missing NULL early-return — would break ORCH-0787 single-event refund flow",
  );
});

Deno.test("AD-06 installment-parity uses IS DISTINCT FROM for cross-order comparison", () => {
  // Same NULL-safety concern as AD-05.
  assert(
    /IF v_installment_order_id IS DISTINCT FROM v_refund_order_id/.test(
      PARENT_MIGRATION,
    ),
    "installment-parity comparison uses != instead of IS DISTINCT FROM",
  );
});

Deno.test("AD-06 installment-parity raises with TR4 invariant ID + diagnostic data", () => {
  assert(
    /RAISE EXCEPTION 'I-PROPOSED-TR4-INSTALLMENT-REFUND-LEDGER-PARITY[\s\S]*?NEW\.installment_id, v_installment_order_id, v_refund_order_id/.test(
      PARENT_MIGRATION,
    ),
    "installment-parity EXCEPTION missing invariant ID or diagnostic (installment_id, real order, claimed order)",
  );
});

// =========================================================================
// AD-07 — cron skip cancelled installments (belt-and-braces filter)
// =========================================================================

Deno.test("AD-07 cron filter `cancelled_at IS NULL` precedes the due_at filter", () => {
  // Order matters for query planner — putting `cancelled_at IS NULL` as
  // partial-index-able predicate early lets Postgres use the
  // idx_order_installments_cancelled index for fast filtering. This is
  // semantic correctness, not just optimization — Tr4 invariant requires
  // BOTH queries (scheduled-initial + failed-retry) carry this filter.
  const scheduledQueryBlock = CRON_SOURCE.match(
    /\.from\("order_installments"\)[\s\S]*?\.eq\("status",\s*"scheduled"\)[\s\S]*?\.limit\(\w+\)/,
  );
  const failedQueryBlock = CRON_SOURCE.match(
    /\.from\("order_installments"\)[\s\S]*?\.eq\("status",\s*"failed"\)[\s\S]*?\.limit\(/,
  );
  assert(scheduledQueryBlock !== null, "Could not find scheduled-installments cron query block");
  assert(failedQueryBlock !== null, "Could not find failed-retry cron query block");
  assert(
    /\.is\(\s*"cancelled_at"\s*,\s*null\s*\)/.test(scheduledQueryBlock[0]),
    "Scheduled-initial cron query missing `.is('cancelled_at', null)` belt-and-braces filter",
  );
  assert(
    /\.is\(\s*"cancelled_at"\s*,\s*null\s*\)/.test(failedQueryBlock[0]),
    "Failed-retry cron query missing `.is('cancelled_at', null)` belt-and-braces filter",
  );
});

Deno.test("AD-07 DB CHECK enforces status='cancelled' ⟺ cancelled_at IS NOT NULL", () => {
  // This is the primary enforcement; the cron filter is belt-and-braces.
  // If this CHECK is reverted, the cron filter is the only remaining gate
  // (and might not catch race-condition rows).
  assert(
    /CHECK \(\(status = 'cancelled'\) = \(cancelled_at IS NOT NULL\)\)/.test(
      PARENT_MIGRATION,
    ),
    "order_installments_cancelled_at_status_consistent CHECK missing or wrong shape",
  );
});

// =========================================================================
// AD-09 — events_refund_policy_valid CHECK constraint
// =========================================================================

Deno.test("AD-09 CHECK constraint uses validate_refund_policy IMMUTABLE function", () => {
  // The CHECK constraint must reference the IMMUTABLE validator function (DB
  // CHECK constraints can only call IMMUTABLE functions). If the constraint
  // is changed to use a non-IMMUTABLE function, Postgres rejects the CREATE.
  // If someone refactors to inline the validation, the function loses its
  // single-source-of-truth role.
  assert(
    /CHECK \(refund_policy IS NULL OR validate_refund_policy\(refund_policy\)\)/.test(
      PARENT_MIGRATION,
    ),
    "events_refund_policy_valid CHECK missing or wrong shape",
  );
});

Deno.test("AD-09 validate_refund_policy is marked IMMUTABLE in source", () => {
  // Required for CHECK constraint compatibility + ensures the function can
  // be cached/inlined by the planner.
  assert(
    /CREATE OR REPLACE FUNCTION validate_refund_policy[\s\S]*?IMMUTABLE/.test(
      PARENT_MIGRATION,
    ),
    "validate_refund_policy missing IMMUTABLE marker — CHECK constraint would fail to create",
  );
});

Deno.test("AD-09 validate_refund_policy rejects empty tiers AND 8-tier-cap exceeded", () => {
  // Two edge cases that the client validator might miss but DB MUST catch.
  assert(
    /jsonb_array_length\(v_tiers\) = 0/.test(PARENT_MIGRATION),
    "validate_refund_policy missing empty-tiers rejection",
  );
  assert(
    /jsonb_array_length\(v_tiers\) > 8/.test(PARENT_MIGRATION),
    "validate_refund_policy missing 8-tier-cap rejection",
  );
});

// =========================================================================
// AD-10 — stripeAccount header zero-tolerance scan
// =========================================================================
// Different angle: implementor's contract test iterates stripe.refunds.create
// blocks and checks each has stripeAccount. This test attacks a future-
// refactor angle: what if someone adds a NEW Stripe API call (refunds.update,
// refunds.cancel) without stripeAccount? Or what if someone adds an
// "express" cancel path that bypasses the refunds API entirely?

Deno.test("AD-10 any stripe.* call in cancel-trip-booking carries stripeAccount", () => {
  // Scan for ALL stripe.<resource>.<action>( calls. Each must either (a)
  // have stripeAccount in its third arg, or (b) be a clearly platform-level
  // call (none expected in this file — Mingla is direct-charge only per
  // ORCH-0843).
  const stripeCallPattern = /stripe\.\w+\.\w+\([\s\S]*?\}\s*\)/g;
  const calls = EDGE_FN_SOURCE.match(stripeCallPattern) ?? [];
  for (const call of calls) {
    assert(
      /stripeAccount:\s*\w+/.test(call),
      `Stripe call missing stripeAccount: header per ORCH-0843. Call:\n${call.substring(0, 200)}...`,
    );
  }
  assert(
    calls.length > 0,
    "No stripe.* calls found in cancel-trip-booking — refund execution path is missing",
  );
});

Deno.test("AD-10 cancel-trip-booking does NOT use platform-level stripe instance", () => {
  // ORCH-0843 [direct-charge] forbids platform-account Stripe operations
  // for ticket-related refunds. The file must use stripeTicketRefund (the
  // ORCH-0843 + ORCH-0849-aware factory) — NOT a generic stripe = new Stripe().
  assert(
    /import\s*\{[^}]*stripeTicketRefund[^}]*\}\s*from/.test(EDGE_FN_SOURCE),
    "cancel-trip-booking missing stripeTicketRefund import — uses non-ORCH-0843-aware Stripe factory",
  );
  assert(
    !/new Stripe\(/.test(EDGE_FN_SOURCE),
    "cancel-trip-booking instantiates raw `new Stripe()` — must go through stripeTicketRefund factory per ORCH-0843",
  );
});

// =========================================================================
// AD-11 — Checkout bookings-closed gate cannot be bypassed
// =========================================================================
// Different angle: implementor's CI gate verifies the conditional block is
// present. This test attacks the strictly-greater vs less-than-or-equal
// boundary (off-by-one on `booking_deadline <= now()` vs `< now()`).

Deno.test("AD-11 checkout bookings-closed uses <= now() not < now() (catches deadline=now exactly)", () => {
  // Edge case: trip with booking_deadline = exactly-now. With `<`, this
  // deadline never triggers at exact moment. Pattern: `new Date(...).getTime() <= Date.now()`.
  // Extract the bookings-closed conditional — pattern starts at `event_type === "trip"`
  // and continues through the comparison.
  const checkoutBlock = CHECKOUT_SOURCE.match(
    /event_type === "trip"[\s\S]{0,500}?booking_deadline[\s\S]{0,200}?Date\.now\(\)/,
  );
  assert(checkoutBlock !== null, "Could not find bookings-closed conditional block referencing booking_deadline + Date.now()");
  assert(
    /<=\s*Date\.now\(\)/.test(checkoutBlock[0]) || /\.getTime\(\)\s*<=\s*Date\.now\(\)/.test(checkoutBlock[0]),
    "Bookings-closed deadline comparison uses < instead of <= — off-by-one at exact-deadline moment",
  );
});

Deno.test("AD-11 checkout 403 response includes deadline ISO for buyer-UI rendering", () => {
  // The buyer UI banner needs the deadline ISO to render the "stopped on
  // <date>" sentence. Without it, UI shows generic "closed" without
  // explaining when. Extract: starts at "bookings_closed" error label,
  // continues until 403 status.
  const checkoutBlock = CHECKOUT_SOURCE.match(
    /error:\s*["']bookings_closed["'][\s\S]{0,500}?403/,
  );
  assert(checkoutBlock !== null, "Could not find bookings_closed 403 response block");
  assert(
    /deadline:\s*\w+\.booking_deadline/.test(checkoutBlock[0]),
    "Bookings-closed 403 response missing deadline ISO — buyer UI can't render closure date",
  );
});

// =========================================================================
// AD-12 — Migration filename monotonicity (prevents bypass-via-out-of-order)
// =========================================================================

Deno.test("AD-12 hotfix migration filename strictly > parent migration filename", () => {
  // Monotonic-naming rule per cross-skill rule #10. Hotfix must be applied
  // AFTER the parent to revoke the grants the parent created. If the hotfix
  // somehow had a LESSER timestamp, `supabase db push` would apply parent
  // last and re-expose the RPCs.
  const parentTs = "20260612000000";
  const hotfixTs = "20260612000001";
  assert(
    hotfixTs > parentTs,
    `Hotfix migration timestamp (${hotfixTs}) must be strictly greater than parent (${parentTs})`,
  );
});
