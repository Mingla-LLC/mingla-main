/**
 * Jest tests for marketingAudienceService (ORCH-0815-A2).
 *
 * Covers SPEC §11 test matrix:
 *   T-01 — brand-rollup audience query returns expected buyer count
 *   T-02 — event-scoped audience query returns expected buyer count
 *   T-03 — marketing-consent state reflected in BuyerRowData.consent
 *   T-04 — unsubscribed contact has email_marketing_ok=false (still in rows
 *           for visibility, but excluded from reachable_email count)
 *
 * Plus deterministic-helper tests:
 *   - maskEmail honest pass-through on malformed
 *   - maskPhone honest pass-through on malformed
 *
 * NEVER use real Supabase calls — mock at module boundary.
 */

jest.mock("../../supabase", () => ({
  supabase: {
    from: jest.fn(),
  },
}));

import {
  maskEmail,
  maskPhone,
  resolveBrandBuyers,
  resolveEventBuyers,
} from "../marketingAudienceService";
import { supabase } from "../../supabase";

type FromMock = jest.Mock;

interface OrderFixture {
  id: string;
  event_id: string;
  buyer_email: string | null;
  buyer_name: string | null;
  buyer_phone: string | null;
  buyer_phone_e164: string | null;
  total_cents: number;
  currency: string;
  payment_status: string;
  confirmed_at: string | null;
  created_at: string;
  events: { id: string; title: string | null; brand_id: string } | null;
}

interface UnsubFixture {
  contact_email: string | null;
  channel: string;
  scope: string;
  brand_id: string | null;
}

function buildOrder(overrides: Partial<OrderFixture> = {}): OrderFixture {
  return {
    id: "ord_1",
    event_id: "00000000-0000-0000-0000-0000000000b1",
    buyer_email: "alex@example.com",
    buyer_name: "Alex M.",
    buyer_phone: "+15555550001",
    buyer_phone_e164: "+15555550001",
    total_cents: 5000,
    currency: "USD",
    payment_status: "paid",
    confirmed_at: "2026-04-20T18:00:00Z",
    created_at: "2026-04-20T18:00:00Z",
    events: { id: "00000000-0000-0000-0000-0000000000b1", title: "Sunset Rooftop", brand_id: "00000000-0000-0000-0000-0000000000a1" },
    ...overrides,
  };
}

function setupSupabaseMock(args: {
  orders: OrderFixture[];
  unsubs: UnsubFixture[];
  ordersError?: Error;
  unsubsError?: Error;
}): void {
  const fromMock = supabase.from as FromMock;
  fromMock.mockReset();
  fromMock.mockImplementation((table: string) => {
    if (table === "orders") {
      const chain = {
        select: jest.fn().mockReturnThis(),
        in: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        order: jest.fn().mockResolvedValue({
          data: args.ordersError ? null : args.orders,
          error: args.ordersError ?? null,
        }),
      };
      return chain;
    }
    if (table === "marketing_unsubscribes") {
      const chain = {
        select: jest.fn().mockReturnThis(),
        or: jest.fn().mockResolvedValue({
          data: args.unsubsError ? null : args.unsubs,
          error: args.unsubsError ?? null,
        }),
      };
      return chain;
    }
    throw new Error(`unexpected supabase.from(${table})`);
  });
}

describe("marketingAudienceService — mask helpers", () => {
  it("maskEmail returns first-3-chars + ** + @domain for typical email", () => {
    expect(maskEmail("alex@gmail.com")).toBe("ale**@gmail.com");
    expect(maskEmail("maya.r@hotmail.com")).toBe("may**@hotmail.com");
  });

  it("maskEmail handles short local part (<= 3 chars)", () => {
    expect(maskEmail("al@x.io")).toBe("al**@x.io");
  });

  it("maskEmail passes through malformed addresses (no @)", () => {
    expect(maskEmail("notanemail")).toBe("notanemail");
  });

  it("maskEmail returns null on null/empty", () => {
    expect(maskEmail(null)).toBeNull();
    expect(maskEmail("")).toBeNull();
  });

  it("maskPhone formats +1 E.164 to (NNN) ***-NNNN", () => {
    expect(maskPhone("+15555551234")).toBe("(555) ***-1234");
  });

  it("maskPhone passes through malformed (< 10 digits)", () => {
    expect(maskPhone("12345")).toBe("12345");
  });

  it("maskPhone returns null on null", () => {
    expect(maskPhone(null)).toBeNull();
  });
});

describe("marketingAudienceService — resolveBrandBuyers (T-01)", () => {
  it("aggregates orders into one BuyerRowData per unique email", async () => {
    setupSupabaseMock({
      orders: [
        buildOrder({ id: "ord_1", buyer_email: "alex@example.com", total_cents: 5000 }),
        buildOrder({ id: "ord_2", buyer_email: "alex@example.com", total_cents: 3500 }),
        buildOrder({ id: "ord_3", buyer_email: "maya@example.com", total_cents: 2500 }),
      ],
      unsubs: [],
    });
    const result = await resolveBrandBuyers("00000000-0000-0000-0000-0000000000a1");
    expect(result.rows).toHaveLength(2);
    const alex = result.rows.find((r) => r.contact_key === "alex@example.com");
    expect(alex).toBeDefined();
    expect(alex?.order_count).toBe(2);
    expect(alex?.total_spend_minor).toBe(8500);
    expect(alex?.masked_email).toBe("ale**@example.com");
  });

  it("sets reach.total = unique buyer count and reachable_email = unsuppressed count", async () => {
    setupSupabaseMock({
      orders: [
        buildOrder({ buyer_email: "a@x.com" }),
        buildOrder({ buyer_email: "b@x.com" }),
      ],
      unsubs: [],
    });
    const result = await resolveBrandBuyers("00000000-0000-0000-0000-0000000000a1");
    expect(result.reach.total).toBe(2);
    expect(result.reach.reachable_email).toBe(2);
  });

  it("skips orders with empty/null buyer_email (anonymous buyers excluded from marketing audience)", async () => {
    setupSupabaseMock({
      orders: [
        buildOrder({ buyer_email: null }),
        buildOrder({ buyer_email: "" }),
        buildOrder({ buyer_email: "real@x.com" }),
      ],
      unsubs: [],
    });
    const result = await resolveBrandBuyers("00000000-0000-0000-0000-0000000000a1");
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.contact_key).toBe("real@x.com");
  });

  it("throws on Supabase error (caller translates to error state)", async () => {
    setupSupabaseMock({
      orders: [],
      unsubs: [],
      ordersError: new Error("rls_denied"),
    });
    await expect(resolveBrandBuyers("00000000-0000-0000-0000-0000000000a1")).rejects.toThrow("rls_denied");
  });

  it("throws when brandId is empty", async () => {
    setupSupabaseMock({ orders: [], unsubs: [] });
    await expect(resolveBrandBuyers("")).rejects.toThrow(
      /brandId is required/i,
    );
  });

  // P1-2 fix (ORCH-0815-A2-B 2026-05-12) — PostgREST filter-injection guard.
  it("throws when brandId is not a valid UUID (PostgREST filter-injection guard)", async () => {
    setupSupabaseMock({ orders: [], unsubs: [] });
    // A pathological brand id containing PostgREST filter separators
    // would corrupt the `.or()` filter string. Guard rejects it before
    // the query is built.
    await expect(
      resolveBrandBuyers("abc),scope.eq.global,(brand_id.eq.something"),
    ).rejects.toThrow(/UUID/);
    // Plain non-UUID string also rejected.
    await expect(resolveBrandBuyers("brand_A")).rejects.toThrow(/UUID/);
    // Valid UUID format passes the guard (mock returns empty data).
    await expect(
      resolveBrandBuyers("00000000-0000-0000-0000-0000000000a1"),
    ).resolves.toBeDefined();
  });
});

describe("marketingAudienceService — resolveEventBuyers (T-02)", () => {
  it("scopes to a single event_id and aggregates the same way", async () => {
    setupSupabaseMock({
      orders: [
        buildOrder({ id: "ord_a", event_id: "00000000-0000-0000-0000-0000000000b1", buyer_email: "x@x.com" }),
        buildOrder({ id: "ord_b", event_id: "00000000-0000-0000-0000-0000000000b1", buyer_email: "y@x.com" }),
      ],
      unsubs: [],
    });
    const result = await resolveEventBuyers("00000000-0000-0000-0000-0000000000b1");
    expect(result.rows).toHaveLength(2);
    expect(result.reach.total).toBe(2);
  });

  it("returns empty result without throwing when no orders exist", async () => {
    setupSupabaseMock({ orders: [], unsubs: [] });
    const result = await resolveEventBuyers("00000000-0000-0000-0000-0000000000b2");
    expect(result.rows).toEqual([]);
    expect(result.reach.total).toBe(0);
    expect(result.reach.reachable_email).toBe(0);
  });

  it("throws when eventId is empty", async () => {
    setupSupabaseMock({ orders: [], unsubs: [] });
    await expect(resolveEventBuyers("")).rejects.toThrow(
      /eventId is required/i,
    );
  });
});

describe("marketingAudienceService — consent filtering (T-03 + T-04)", () => {
  it("(T-04) unsubscribed buyer is still in rows but reachable_email excludes them", async () => {
    setupSupabaseMock({
      orders: [
        buildOrder({ buyer_email: "alex@example.com" }),
        buildOrder({ buyer_email: "maya@example.com" }),
      ],
      unsubs: [
        {
          contact_email: "alex@example.com",
          channel: "email",
          scope: "brand",
          brand_id: "00000000-0000-0000-0000-0000000000a1",
        },
      ],
    });
    const result = await resolveBrandBuyers("00000000-0000-0000-0000-0000000000a1");
    expect(result.rows).toHaveLength(2);
    expect(result.reach.total).toBe(2);
    expect(result.reach.reachable_email).toBe(1);

    const alex = result.rows.find((r) => r.contact_key === "alex@example.com");
    expect(alex?.consent.email_marketing_ok).toBe(false);
    expect(alex?.consent.unsubscribed_brand_scope).toBe(true);
  });

  it("(T-03) global 'all'-channel unsub suppresses every channel for that contact", async () => {
    setupSupabaseMock({
      orders: [buildOrder({ buyer_email: "alex@example.com" })],
      unsubs: [
        {
          contact_email: "alex@example.com",
          channel: "all",
          scope: "global",
          brand_id: null,
        },
      ],
    });
    const result = await resolveBrandBuyers("00000000-0000-0000-0000-0000000000a1");
    const alex = result.rows[0];
    expect(alex?.consent.email_marketing_ok).toBe(false);
    expect(alex?.consent.sms_marketing_ok).toBe(false);
    expect(result.reach.reachable_email).toBe(0);
    expect(result.reach.reachable_sms).toBe(0);
  });

  it("unsubscribe match is case-insensitive on email", async () => {
    setupSupabaseMock({
      orders: [buildOrder({ buyer_email: "Alex@Example.COM" })],
      unsubs: [
        {
          contact_email: "alex@example.com",
          channel: "email",
          scope: "brand",
          brand_id: "00000000-0000-0000-0000-0000000000a1",
        },
      ],
    });
    const result = await resolveBrandBuyers("00000000-0000-0000-0000-0000000000a1");
    expect(result.rows[0]?.consent.email_marketing_ok).toBe(false);
  });
});

// ===========================================================================
// T-02 (ORCH-0863) — listAudiencesForAccount virtual-row discovery
// ===========================================================================

import { listAudiencesForAccount } from "../marketingAudienceService";

describe("listAudiencesForAccount (T-02 ORCH-0863 virtual-row discovery)", () => {
  const ACCOUNT_UUID = "00000000-0000-0000-0000-0000000000aa";
  const BRAND_UUID = "00000000-0000-0000-0000-0000000000b1";
  const EVENT_UUID_A = "00000000-0000-0000-0000-0000000000e1";
  const EVENT_UUID_B = "00000000-0000-0000-0000-0000000000e2";

  beforeEach(() => {
    (supabase.from as jest.Mock).mockReset();
  });

  it("merges existing real rows with virtual rows for every brand/event with paid orders", async () => {
    // Mock chain — 4 .from() calls in order:
    //   1. marketing_audiences SELECT (1 existing event row)
    //   2. marketing_campaigns SELECT (last_used_at lookup)
    //   3. orders SELECT with events!inner join (2 events under 1 brand)
    //   4. brands SELECT (brand name)
    (supabase.from as jest.Mock)
      // Call 1: marketing_audiences
      .mockReturnValueOnce({
        select: () => ({
          eq: () => ({
            data: [
              {
                id: "00000000-0000-0000-0000-000000000a01",
                brand_id: BRAND_UUID,
                query_definition: {
                  kind: "event_buyers",
                  event_id: EVENT_UUID_A,
                  payment_statuses: ["paid", "partial_refund"],
                },
              },
            ],
            error: null,
          }),
        }),
      })
      // Call 2: marketing_campaigns last-used lookup
      .mockReturnValueOnce({
        select: () => ({
          eq: () => ({
            in: () => ({
              order: () => ({
                data: [
                  {
                    audience_id: "00000000-0000-0000-0000-000000000a01",
                    created_at: "2026-05-13T15:25:00Z",
                  },
                ],
                error: null,
              }),
            }),
          }),
        }),
      })
      // Call 3: orders SELECT with events!inner
      .mockReturnValueOnce({
        select: () => ({
          in: () => ({
            data: [
              {
                event_id: EVENT_UUID_A,
                events: { id: EVENT_UUID_A, title: "Event Alpha", brand_id: BRAND_UUID },
              },
              {
                event_id: EVENT_UUID_B,
                events: { id: EVENT_UUID_B, title: "Event Beta", brand_id: BRAND_UUID },
              },
            ],
            error: null,
          }),
        }),
      })
      // Call 4: brands SELECT (with I-PROPOSED-A deleted_at filter)
      .mockReturnValueOnce({
        select: () => ({
          in: () => ({
            is: () => ({
              data: [{ id: BRAND_UUID, name: "Rooftop Club" }],
              error: null,
            }),
          }),
        }),
      });

    const entries = await listAudiencesForAccount({ account_id: ACCOUNT_UUID });

    // Should return: 1 brand_buyers (virtual) + 2 event_buyers (1 real + 1 virtual) = 3 entries.
    expect(entries).toHaveLength(3);

    // The brand-rollup entry should be virtual (no existing brand_buyers row).
    const brandEntry = entries.find((e) => e.kind === "brand_buyers");
    expect(brandEntry).toBeDefined();
    expect(brandEntry?.audience_id).toBeNull();
    expect(brandEntry?.brand_id).toBe(BRAND_UUID);
    expect(brandEntry?.brand_name).toBe("Rooftop Club");
    expect(brandEntry?.display_name).toContain("Rooftop Club");

    // Event A entry should be REAL (has an audience row).
    const eventA = entries.find(
      (e) => e.kind === "event_buyers" && e.event_id === EVENT_UUID_A,
    );
    expect(eventA?.audience_id).toBe("00000000-0000-0000-0000-000000000a01");
    expect(eventA?.last_used_at).toBe("2026-05-13T15:25:00Z");

    // Event B entry should be VIRTUAL.
    const eventB = entries.find(
      (e) => e.kind === "event_buyers" && e.event_id === EVENT_UUID_B,
    );
    expect(eventB?.audience_id).toBeNull();
    expect(eventB?.last_used_at).toBeNull();
  });
});
