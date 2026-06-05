// ORCH-1082 [business notification deep-link handlers] — TESTER adversarial
// regression (BACKEND routing-BREADTH angle).
//
// Distinct from BOTH the implementor Deno test (which asserts the single
// re-prefixed type + the old type) and the implementor Jest test (path parsing):
// THIS test proves the re-prefix did NOT silently WIDEN or NARROW the
// business-app routing universe. The bug class it guards: a careless change to
// `resolveOneSignalApp` (or the prefix set) that either (a) starts routing a
// real consumer type to the business app, or (b) stops routing an existing
// business/stripe type — both of which would silently drop or mis-deliver pushes
// for unrelated notification types while ORCH-1082's single-type fix still passes.
//
// Coverage:
//   * EVERY existing business.* type (the 11 v1 + stripe.* compliance set the
//     business parser knows about) still resolves to "business".
//   * The re-prefixed `stripe.partner_detach_completed` resolves to "business"
//     and the old `partner_stripe.detach_completed` resolves to "consumer"
//     (regression-locks the exact boundary moved by 17a).
//   * A broad sweep of REAL consumer-side / neutral prefixes still resolves to
//     "consumer" — the re-prefix must NOT have leaked any of them to business.
//   * Robustness: undefined/null/empty/whitespace/near-miss prefixes
//     ("stripeX.", "business", "Stripe.") all resolve to "consumer" (default),
//     never throw — proving the prefix match is exact, not substring/fuzzy.
//
// Run: deno test --allow-env \
//   supabase/functions/_shared/__tests__/orch_1082_resolve_app_no_regression.test.ts

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import { resolveOneSignalApp } from "../push-utils.ts";

// ── business universe must STILL route to business (no narrowing) ────────────
Deno.test("ORCH-1082 no-regression: every existing business.* + stripe.* type still → business", () => {
  const businessTypes = [
    // 11 v1 business types
    "business.order_paid",
    "business.event_sold_out",
    "business.low_inventory",
    "business.refund_processed",
    "business.new_review",
    "business.dispute_opened",
    "business.dispute_action_needed",
    "business.payout_paid",
    "business.account_status_changed",
    "business.claim_decision",
    "business.team_member_joined",
    // stripe.* compliance set (incl. the ORCH-1082 re-prefixed type)
    "stripe.kyc_stall_reminder",
    "stripe.deadline_warning_3d",
    "stripe.deadline_warning_7d",
    "stripe.payout_failed",
    "stripe.account_status_changed",
    "stripe.partner_detach_completed", // ← ORCH-1082 17a
  ];
  for (const t of businessTypes) {
    assertEquals(resolveOneSignalApp(t), "business", `${t} must route to business`);
  }
});

// ── consumer / neutral universe must STILL route to consumer (no widening) ───
Deno.test("ORCH-1082 no-regression: real consumer/neutral prefixes still → consumer (re-prefix leaked nothing)", () => {
  const consumerTypes = [
    "match_found",
    "new_message",
    "session_invite",
    "friend_request",
    "card_recommendation",
    "trip_reminder",
    // The OLD broken partner type must remain consumer (it is the exact bug 17a
    // moved AWAY from — if a future edit re-adds a `partner_stripe.` business
    // prefix this locks that it stays consumer unless deliberately changed).
    "partner_stripe.detach_completed",
    "partner_stripe.something_else",
  ];
  for (const t of consumerTypes) {
    assertEquals(resolveOneSignalApp(t), "consumer", `${t} must route to consumer`);
  }
});

// ── exact-prefix discipline: near-miss strings must NOT match business ───────
Deno.test("ORCH-1082 no-regression: near-miss prefixes resolve to consumer (match is exact-prefix, not fuzzy/substring)", () => {
  const nearMiss = [
    "Stripe.payout_failed", // wrong case
    "Business.order_paid", // wrong case
    "xstripe.foo", // stripe not at start
    "xbusiness.foo", // business not at start
    "stripe", // no dot, no leaf
    "business", // no dot, no leaf
    " stripe.payout_failed", // leading space → not a prefix
    "a_business.thing", // substring, not prefix
  ];
  for (const t of nearMiss) {
    assertEquals(
      resolveOneSignalApp(t),
      "consumer",
      `${t} must NOT be treated as a business type`,
    );
  }
});

// ── robustness: undefined/null/empty never throw, default to consumer ────────
Deno.test("ORCH-1082 no-regression: undefined/null/empty types default to consumer without throwing", () => {
  assertEquals(resolveOneSignalApp(undefined), "consumer");
  assertEquals(resolveOneSignalApp(null), "consumer");
  assertEquals(resolveOneSignalApp(""), "consumer");
  // sanity: function is total over weird input
  assert(["consumer", "business"].includes(resolveOneSignalApp("   ")));
});
