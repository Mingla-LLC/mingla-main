// META-ORCH-1161 go-live-prep (P2 fix) — email-keyed marketing suppression (the
// audience side of the email-opt-out fix). Proves reach.reachable_email EXCLUDES a
// buyer whose email is suppressed via channel_suppressions(channel='email',
// scope ∈ {marketing,all}) — the ledger the prefs-UI RPC set_marketing_suppression
// writes to — even though that buyer's SMS channel is fine.
//
// WHY: before this fix, aggregate() only consulted marketing_unsubscribes for the
// email channel; a prefs-UI email opt-out lands in channel_suppressions, NOT
// marketing_unsubscribes, so the email blast still included the contact (can_send
// blocked it, the blast did not — a split-authority defect). aggregate() now takes
// a suppressedEmails set (resolveSuppressedEmails reads channel_suppressions).
//
// Fails-on-revert: delete the `!suppressedEmails.has(emailKey)` clause in
// aggregate() → the suppressed email counts as reachable_email again → this test
// FAILS (reach.reachable_email becomes 2 and email_marketing_ok becomes true).

import { assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";

import { aggregate } from "./marketingAudience.ts";

// deno-lint-ignore no-explicit-any
function order(email: string, phone: string): any {
  return {
    id: crypto.randomUUID(),
    event_id: "11111111-1111-1111-1111-111111111111",
    buyer_email: email,
    buyer_name: "Buyer One",
    buyer_phone: null,
    buyer_phone_e164: phone,
    total_cents: 1000,
    currency: "USD",
    payment_status: "paid",
    confirmed_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
    events: {
      id: "11111111-1111-1111-1111-111111111111",
      title: "Test Event",
      brand_id: "22222222-2222-2222-2222-222222222222",
    },
  };
}

Deno.test("aggregate: an email-suppressed buyer is NOT reachable_email (but sms unaffected)", () => {
  const orders = [
    order("keep@example.com", "+15551112222"),
    order("stop@example.com", "+15553334444"),
  ];

  // stop@example.com opted out of EMAIL marketing via the prefs-UI RPC →
  // channel_suppressions(channel='email', contact='stop@example.com'). The
  // resolveSuppressedEmails set is lowercased+trimmed email keys.
  const suppressedEmails = new Set<string>(["stop@example.com"]);

  const result = aggregate(
    orders,
    [],
    "22222222-2222-2222-2222-222222222222",
    new Set<string>(),
    suppressedEmails,
  );

  // 2 buyers total; both have phones → 2 reachable_sms.
  assertEquals(result.reach.total, 2);
  assertEquals(result.reach.reachable_sms, 2);
  // Only ONE email reachable — the suppressed one is excluded.
  assertEquals(result.reach.reachable_email, 1);

  const suppressedRow = result.rows.find((r) => r.raw_email === "stop@example.com");
  const keepRow = result.rows.find((r) => r.raw_email === "keep@example.com");
  // The send path gates on email_marketing_ok — the suppressed row must be false
  // so marketing-send's email filter never dispatches to it.
  assertEquals(suppressedRow?.email_marketing_ok, false);
  assertEquals(keepRow?.email_marketing_ok, true);
  // SMS reachability is independent — suppression was EMAIL-only.
  assertEquals(suppressedRow?.sms_marketing_ok, true);
});

Deno.test("aggregate: email suppression matches case-insensitively (mixed-case order email)", () => {
  // The RPC stores lower(email); resolveSuppressedEmails lowercases. The order's
  // buyer_email may be mixed-case but the aggregate key is lowercased — the
  // suppression set (lowercased) must still match.
  const orders = [order("Stop@Example.COM", "+15553334444")];
  const suppressedEmails = new Set<string>(["stop@example.com"]);

  const result = aggregate(
    orders,
    [],
    "22222222-2222-2222-2222-222222222222",
    new Set<string>(),
    suppressedEmails,
  );

  assertEquals(result.reach.reachable_email, 0);
  assertEquals(result.rows[0]?.email_marketing_ok, false);
});

Deno.test("aggregate: with NO email suppression, both emails are reachable_email", () => {
  const orders = [
    order("a@example.com", "+15551112222"),
    order("b@example.com", "+15553334444"),
  ];
  const result = aggregate(
    orders,
    [],
    "22222222-2222-2222-2222-222222222222",
    new Set<string>(),
    new Set<string>(),
  );
  assertEquals(result.reach.reachable_email, 2);
});
