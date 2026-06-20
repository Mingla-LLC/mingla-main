/**
 * META-ORCH-1161 Sub-B — client audience resolver SMS phone-suppression.
 *
 * Proves the composer's reachable_sms preview EXCLUDES a phone that has a
 * phone-keyed marketing_unsubscribes(contact_phone, channel='sms') row — so the
 * preview matches the server send (which never texts a suppressed phone).
 *
 * Fails-on-revert: delete the `!phoneKeysOf(acc.raw_phone)...` clause in
 * marketingAudienceService.aggregateBuyers → the suppressed phone counts as
 * reachable_sms again → this test FAILS.
 *
 * We mock the supabase client so the resolver runs without a live DB.
 */

const orderRows = [
  {
    id: "o1",
    event_id: "e1",
    buyer_email: "keep@example.com",
    buyer_name: "Keep Buyer",
    buyer_phone: null,
    buyer_phone_e164: "+15551112222",
    total_cents: 1000,
    currency: "USD",
    payment_status: "paid",
    confirmed_at: "2026-01-01T00:00:00Z",
    created_at: "2026-01-01T00:00:00Z",
    events: { id: "e1", title: "Show", brand_id: "22222222-2222-2222-2222-222222222222" },
  },
  {
    id: "o2",
    event_id: "e1",
    buyer_email: "stop@example.com",
    buyer_name: "Stop Buyer",
    buyer_phone: null,
    buyer_phone_e164: "+15553334444",
    total_cents: 1000,
    currency: "USD",
    payment_status: "paid",
    confirmed_at: "2026-01-02T00:00:00Z",
    created_at: "2026-01-02T00:00:00Z",
    events: { id: "e1", title: "Show", brand_id: "22222222-2222-2222-2222-222222222222" },
  },
];

const unsubRows = [
  // +15553334444 unsubscribed from SMS via a phone-keyed unsub row.
  { contact_email: null, contact_phone: "+15553334444", channel: "sms", scope: "global", brand_id: null },
];

jest.mock("../../supabase", () => {
  const makeBuilder = (rows: unknown[]) => {
    const b: Record<string, unknown> = {};
    const chain = () => b;
    b.select = chain;
    b.in = chain;
    b.eq = chain;
    b.or = chain;
    b.order = () => Promise.resolve({ data: rows, error: null });
    // marketing_unsubscribes path awaits the builder directly (no .order()).
    b.then = (resolve: (v: { data: unknown[]; error: null }) => unknown) =>
      resolve({ data: rows, error: null });
    return b;
  };
  return {
    supabase: {
      from: (table: string) =>
        table === "orders" ? makeBuilder(orderRows) : makeBuilder(unsubRows),
    },
  };
});

import { resolveBrandBuyers } from "../marketingAudienceService";

describe("marketingAudienceService — SMS phone suppression (ORCH-1161 Sub-B)", () => {
  it("excludes a phone-unsubscribed buyer from reachable_sms", async () => {
    const result = await resolveBrandBuyers("22222222-2222-2222-2222-222222222222");
    // Two buyers, both with email → reachable_email = 2.
    expect(result.reach.total).toBe(2);
    expect(result.reach.reachable_email).toBe(2);
    // Only the non-suppressed phone is reachable on SMS.
    expect(result.reach.reachable_sms).toBe(1);

    const stopRow = result.rows.find((r) => r.raw_phone === "+15553334444");
    const keepRow = result.rows.find((r) => r.raw_phone === "+15551112222");
    expect(stopRow?.consent.sms_marketing_ok).toBe(false);
    expect(keepRow?.consent.sms_marketing_ok).toBe(true);
  });
});
