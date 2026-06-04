// META-ORCH-1074 Sub-A — regression test: business.order_paid trigger payload.
//
// Asserts the LOCKED §3.A.5 order_paid contract:
//   * recipients = the 3 payments roles (brand_owner, brand_admin,
//     finance_manager) — one dispatch per recipient,
//   * payload type/brandId/data slots/relatedId/relatedType/deepLink/
//     idempotencyKey match the spec exactly,
//   * {amount} is currency-aware formatted (no GBP fallback) from
//     (totalCents, currency),
//   * a sold-out event ALSO fires business.event_sold_out to owner+admin.
//
// notify-dispatch is mocked via a globalThis.fetch stub that captures the
// outbound bodies; the Supabase client is a hand-rolled fake returning the
// team roster + capacity RPC rows.
//
// Run: deno test --allow-env supabase/functions/_shared/__tests__/meta_orch_1074_order_paid_payload.test.ts

import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { fireOrderFinalizeNotifications } from "../businessNotifyTriggers.ts";

const BRAND_ID = "brand-aaaa";
const EVENT_ID = "event-bbbb";
const ORDER_ID = "order-cccc";

interface DispatchBody {
  userId: string;
  type: string;
  brandId: string;
  data: Record<string, unknown>;
  relatedId: string;
  relatedType: string;
  deepLink: string;
  idempotencyKey: string;
  title: string;
  body: string;
}

// Fake Supabase client: from("events") → title; from("brand_team_members") →
// roster filtered by .in("role", roles); rpc(pg_public_ticket_types_remaining)
// → capacity rows. Supports the exact chain the production code uses.
function makeFakeSupabase(opts: {
  roster: Array<{ user_id: string; role: string }>;
  remainingRows: Array<{ sold: number; remaining: number | null }>;
  eventTitle: string;
}) {
  return {
    from(table: string) {
      if (table === "events") {
        return {
          select() {
            return {
              eq() {
                return {
                  maybeSingle() {
                    return Promise.resolve({
                      data: { title: opts.eventTitle },
                      error: null,
                    });
                  },
                };
              },
            };
          },
        };
      }
      if (table === "brand_team_members") {
        let roleFilter: string[] = [];
        const builder = {
          select() {
            return builder;
          },
          eq() {
            return builder;
          },
          is() {
            return builder;
          },
          not() {
            return builder;
          },
          in(_col: string, roles: string[]) {
            roleFilter = roles;
            return Promise.resolve({
              data: opts.roster.filter((r) => roleFilter.includes(r.role)),
              error: null,
            });
          },
        };
        return builder;
      }
      throw new Error(`unexpected table ${table}`);
    },
    rpc(name: string) {
      if (name === "pg_public_ticket_types_remaining") {
        return Promise.resolve({ data: opts.remainingRows, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    },
  };
}

function stubDispatchFetch(captured: DispatchBody[]): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = ((_input: string | URL | Request, init?: RequestInit) => {
    const bodyStr = typeof init?.body === "string" ? init.body : "{}";
    captured.push(JSON.parse(bodyStr));
    return Promise.resolve(
      new Response(JSON.stringify({ success: true }), { status: 200 }),
    );
  }) as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

Deno.test("order_paid fans out to owner+admin+finance with exact payload", async () => {
  Deno.env.set("SUPABASE_URL", "https://example.supabase.co");
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "svc-key");
  const captured: DispatchBody[] = [];
  const restore = stubDispatchFetch(captured);
  try {
    const supabase = makeFakeSupabase({
      roster: [
        { user_id: "owner-1", role: "brand_owner" },
        { user_id: "admin-1", role: "brand_admin" },
        { user_id: "finance-1", role: "finance_manager" },
        { user_id: "scanner-1", role: "scanner" }, // must NOT receive
      ],
      remainingRows: [{ sold: 1, remaining: 49 }], // plenty left → no sold-out
      eventTitle: "Friday Night",
    });
    // deno-lint-ignore no-explicit-any
    await fireOrderFinalizeNotifications(supabase as any, {
      brandId: BRAND_ID,
      eventId: EVENT_ID,
      orderId: ORDER_ID,
      totalCents: 1500,
      currency: "USD",
      qty: 1,
    });

    const orderPaid = captured.filter((c) => c.type === "business.order_paid");
    assertEquals(orderPaid.length, 3); // owner + admin + finance, NOT scanner
    const recipients = orderPaid.map((c) => c.userId).sort();
    assertEquals(recipients, ["admin-1", "finance-1", "owner-1"]);

    const sample = orderPaid.find((c) => c.userId === "owner-1")!;
    assertEquals(sample.brandId, BRAND_ID);
    assertEquals(sample.relatedId, ORDER_ID);
    assertEquals(sample.relatedType, "order");
    assertEquals(sample.deepLink, `mingla-business://event/${EVENT_ID}`);
    // per-user idempotency suffix
    assertEquals(
      sample.idempotencyKey,
      `business.order_paid:${ORDER_ID}:owner-1`,
    );
    assertEquals(sample.data.orderId, ORDER_ID);
    assertEquals(sample.data.eventId, EVENT_ID);
    assertEquals(sample.data.eventTitle, "Friday Night");
    assertEquals(sample.data.totalCents, 1500);
    assertEquals(sample.data.currency, "USD");
    // currency-aware {amount}: 1500 USD → "$15.00" (no GBP)
    assertStringIncludes(sample.body, "$15.00");
    assertStringIncludes(sample.body, "Friday Night");
  } finally {
    restore();
  }
});

Deno.test("event_sold_out fires to owner+admin when remaining hits 0", async () => {
  Deno.env.set("SUPABASE_URL", "https://example.supabase.co");
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "svc-key");
  const captured: DispatchBody[] = [];
  const restore = stubDispatchFetch(captured);
  try {
    const supabase = makeFakeSupabase({
      roster: [
        { user_id: "owner-1", role: "brand_owner" },
        { user_id: "admin-1", role: "brand_admin" },
        { user_id: "finance-1", role: "finance_manager" },
      ],
      remainingRows: [{ sold: 50, remaining: 0 }], // sold out
      eventTitle: "Gala",
    });
    // deno-lint-ignore no-explicit-any
    await fireOrderFinalizeNotifications(supabase as any, {
      brandId: BRAND_ID,
      eventId: EVENT_ID,
      orderId: ORDER_ID,
      totalCents: 5000,
      currency: "NGN",
      qty: 2,
    });

    const soldOut = captured.filter((c) => c.type === "business.event_sold_out");
    assertEquals(soldOut.length, 2); // owner + admin only (NOT finance)
    const recipients = soldOut.map((c) => c.userId).sort();
    assertEquals(recipients, ["admin-1", "owner-1"]);
    const s = soldOut[0];
    assertEquals(s.relatedType, "event");
    assertEquals(s.idempotencyKey.startsWith(`business.event_sold_out:${EVENT_ID}`), true);
    assertEquals(s.data.capacity, 50);
  } finally {
    restore();
  }
});

Deno.test("low_inventory fires at <=10% remaining (and >0)", async () => {
  Deno.env.set("SUPABASE_URL", "https://example.supabase.co");
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "svc-key");
  const captured: DispatchBody[] = [];
  const restore = stubDispatchFetch(captured);
  try {
    const supabase = makeFakeSupabase({
      roster: [{ user_id: "owner-1", role: "brand_owner" }],
      remainingRows: [{ sold: 92, remaining: 8 }], // 8/100 = 8% ≤ 10%
      eventTitle: "Workshop",
    });
    // deno-lint-ignore no-explicit-any
    await fireOrderFinalizeNotifications(supabase as any, {
      brandId: BRAND_ID,
      eventId: EVENT_ID,
      orderId: ORDER_ID,
      totalCents: 1000,
      currency: "USD",
      qty: 1,
    });
    const low = captured.filter((c) => c.type === "business.low_inventory");
    assertEquals(low.length, 1);
    assertEquals(low[0].data.remaining, 8);
    assertEquals(low[0].data.capacity, 100);
    assertStringIncludes(low[0].body, "only 8 left");
  } finally {
    restore();
  }
});
