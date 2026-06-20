// META-ORCH-1161 Sub-B — phone-keyed SMS suppression (the audience side of the
// reach-truth fix). Proves reach.reachable_sms EXCLUDES a phone that is
// suppressed via the phone-keyed ledgers, even though the email channel is fine.
//
// Fails-on-revert: delete the `!phoneSuppressed` clause in aggregate() → a
// suppressed phone counts as reachable_sms again → this test FAILS.
//
// (b) The SMS-send block in marketing-send filters on `c.sms_marketing_ok`, so a
// phone whose sms_marketing_ok=false is never dispatched — see the assertion on
// the suppressed row's sms_marketing_ok below (the send path's gate).

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

Deno.test("aggregate: a phone-suppressed buyer is NOT reachable_sms (but email unaffected)", () => {
  const orders = [
    order("keep@example.com", "+15551112222"),
    order("stop@example.com", "+15553334444"),
  ];

  // +15553334444 is suppressed for SMS marketing (e.g. channel_suppressions or
  // marketing_unsubscribes.contact_phone). Both trimmed + digits-only keys.
  const suppressedPhones = new Set<string>(["+15553334444", "15553334444"]);

  const result = aggregate(orders, [], "22222222-2222-2222-2222-222222222222", suppressedPhones);

  // 2 buyers total; both have email → 2 reachable_email.
  assertEquals(result.reach.total, 2);
  assertEquals(result.reach.reachable_email, 2);
  // Only ONE phone reachable for SMS — the suppressed one is excluded.
  assertEquals(result.reach.reachable_sms, 1);

  const suppressedRow = result.rows.find((r) => r.raw_phone === "+15553334444");
  const keepRow = result.rows.find((r) => r.raw_phone === "+15551112222");
  // The send path gates on sms_marketing_ok — the suppressed row must be false
  // so marketing-send's `c.sms_marketing_ok` filter never dispatches to it.
  assertEquals(suppressedRow?.sms_marketing_ok, false);
  assertEquals(keepRow?.sms_marketing_ok, true);
  // Email reachability is independent — suppression was SMS-only.
  assertEquals(suppressedRow?.email_marketing_ok, true);
});

Deno.test("aggregate: with NO phone suppression, both phones are reachable_sms", () => {
  const orders = [
    order("a@example.com", "+15551112222"),
    order("b@example.com", "+15553334444"),
  ];
  const result = aggregate(orders, [], "22222222-2222-2222-2222-222222222222", new Set<string>());
  assertEquals(result.reach.reachable_sms, 2);
});
