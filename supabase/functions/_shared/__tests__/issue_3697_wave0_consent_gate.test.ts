/**
 * toward #3697 Wave 0b / F-3 / #3703: Reject (and pending) touch → local count,
 * shared_with_platforms=false, zero outbound CAPI. Append-only.
 *
 * Run: deno test --allow-none supabase/functions/_shared/__tests__/issue_3697_wave0_consent_gate.test.ts
 */
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";
import {
  fireAdConversion,
  type SenderResult,
} from "../adConversionFire.ts";

type Cap = {
  upsert?: Record<string, unknown>;
  updates: Record<string, unknown>[];
  senderCalls: string[];
};

// deno-lint-ignore no-explicit-any
function mockDb(cap: Cap, consentState: string): any {
  return {
    from(table: string) {
      if (table === "orders") {
        const b = {
          select: () => b,
          eq: () => b,
          maybeSingle: () =>
            Promise.resolve({
              data: {
                id: "ord-1",
                event_id: "ev-1",
                total_cents: 2500,
                currency: "USD",
                buyer_email: "a@b.co",
                buyer_phone: null,
                payment_status: "paid",
              },
              error: null,
            }),
        };
        return b;
      }
      if (table === "events") {
        const b = {
          select: () => b,
          eq: () => b,
          maybeSingle: () =>
            Promise.resolve({ data: { brand_id: "brand-1" }, error: null }),
        };
        return b;
      }
      if (table === "ticket_checkout_sessions") {
        const b = {
          select: () => b,
          eq: () => b,
          not: () => b,
          maybeSingle: () =>
            Promise.resolve({
              data: { attribution_click_id: "click-1" },
              error: null,
            }),
        };
        return b;
      }
      if (table === "ad_attribution_touches") {
        const b = {
          select: () => b,
          eq: () => b,
          maybeSingle: () =>
            Promise.resolve({
              data: {
                id: "touch-1",
                connection_id: null,
                campaign_id: null,
                network: "meta",
                external_click_id: "fbclid",
                created_at: new Date().toISOString(),
                consent_state: consentState,
              },
              error: null,
            }),
        };
        return b;
      }
      if (table === "ad_conversions") {
        return {
          select: () => {
            const b = {
              eq: () => b,
              maybeSingle: () => Promise.resolve({ data: null, error: null }),
            };
            return b;
          },
          upsert: (row: Record<string, unknown>) => {
            cap.upsert = row;
            return Promise.resolve({ data: null, error: null });
          },
          update: (row: Record<string, unknown>) => {
            cap.updates.push(row);
            const b = {
              eq: () => Promise.resolve({ data: null, error: null }),
            };
            return b;
          },
        };
      }
      if (table === "ad_connections") {
        const b = {
          select: () => b,
          eq: () => b,
          maybeSingle: () => Promise.resolve({ data: null, error: null }),
        };
        return b;
      }
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: () => Promise.resolve({ data: null, error: null }),
          }),
        }),
      };
    },
  };
}

function spySenders(cap: Cap) {
  const mk = (channel: string) =>
    async (): Promise<SenderResult> => {
      cap.senderCalls.push(channel);
      return { channel: channel as SenderResult["channel"], status: "sent" };
    };
  return {
    meta: mk("meta"),
    tiktok: mk("tiktok"),
    snap: mk("snap"),
    reddit: mk("reddit"),
    google: mk("google"),
  };
}

Deno.test("F-3: rejected consent counts locally and never calls senders", async () => {
  const cap: Cap = { updates: [], senderCalls: [] };
  const result = await fireAdConversion(
    mockDb(cap, "rejected"),
    { orderId: "ord-1" },
    { senders: spySenders(cap) },
  );
  assert(result.ok);
  assertEquals(cap.upsert?.shared_with_platforms, false);
  assertEquals(cap.senderCalls.length, 0);
  assertEquals(
    (result as { results?: SenderResult[] }).results?.every((r) =>
      r.status === "skipped"
    ),
    true,
  );
});

Deno.test("F-3: pending consent also blocks outbound (Accept required)", async () => {
  const cap: Cap = { updates: [], senderCalls: [] };
  await fireAdConversion(
    mockDb(cap, "pending"),
    { orderId: "ord-1" },
    { senders: spySenders(cap) },
  );
  assertEquals(cap.senderCalls.length, 0);
  assertEquals(cap.upsert?.shared_with_platforms, false);
  // Channel statuses stay pending so a later Accept + redelivery can fan out.
  const last = cap.updates[cap.updates.length - 1] ?? {};
  assertEquals(last.meta_capi_status, undefined);
  assertEquals(last.shared_with_platforms, false);
});

Deno.test("F-3: granted consent allows fan-out", async () => {
  const cap: Cap = { updates: [], senderCalls: [] };
  await fireAdConversion(
    mockDb(cap, "granted"),
    { orderId: "ord-1" },
    { senders: spySenders(cap) },
  );
  assert(cap.senderCalls.length > 0);
  assertEquals(cap.upsert?.shared_with_platforms, true);
});

Deno.test("F-4: free ticket ($0) is sign-up event name, not Purchase", async () => {
  const cap: Cap = { updates: [], senderCalls: [] };
  // deno-lint-ignore no-explicit-any
  const db: any = mockDb(cap, "granted");
  const origFrom = db.from.bind(db);
  db.from = (table: string) => {
    if (table === "orders") {
      const b = {
        select: () => b,
        eq: () => b,
        maybeSingle: () =>
          Promise.resolve({
            data: {
              id: "ord-free",
              event_id: "ev-1",
              total_cents: 0,
              currency: "USD",
              buyer_email: null,
              buyer_phone: null,
              payment_status: "paid",
            },
            error: null,
          }),
      };
      return b;
    }
    return origFrom(table);
  };
  await fireAdConversion(db, { orderId: "ord-free" }, {
    senders: spySenders(cap),
  });
  assertEquals(cap.upsert?.event_type, "reservation");
  assertEquals(cap.upsert?.event_name, "CompleteRegistration");
  assertEquals(cap.upsert?.value_cents, 0);
});
