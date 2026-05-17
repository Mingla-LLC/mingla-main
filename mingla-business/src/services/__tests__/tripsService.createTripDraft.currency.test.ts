/* eslint-disable import/first */
/**
 * ORCH-0859 [Tr2 Minimum Viable Trip] — createTripDraft currency regression.
 *
 * Pins the fix for the P0 bug (caught at operator live-fire after the prior
 * QA turn): `createTripDraft` MUST set `currency` on the events INSERT row.
 *
 * Bug mechanics:
 *   1. createTripDraft INSERTs into `events`
 *   2. createTripDraft INSERTs into `ticket_types` (one placeholder row)
 *   3. The `tg_enforce_event_ticket_currency` trigger on ticket_types
 *      (supabase/migrations/20260515000011_orch_0769_no_implicit_gbp_currency.sql:159)
 *      looks up the parent event's currency. If NULL → RAISE
 *      `event_currency_not_found`.
 *
 * The fix: fetch `brands.default_currency` BEFORE the events INSERT and
 * include `currency: defaultCurrency` in the events payload. Mirrors
 * `eventDrafts.fetchBrandDefaultCurrency` + `draftToServerInsert` ordering
 * for event_type='event'.
 *
 * Fails-on-revert: removing `currency: defaultCurrency` from the events
 * insert payload causes the `currencyOnEventsInsert` assertion below to
 * fail because the captured payload no longer carries the field.
 */

import { beforeEach, describe, expect, jest, test } from "@jest/globals";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const fromMock = jest.fn() as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const authGetUserMock = jest.fn() as any;

jest.mock("../supabase", () => ({
  supabase: {
    from: (table: string) => fromMock(table),
    auth: {
      getUser: () => authGetUserMock(),
    },
  },
}));

import { createTripDraft } from "../tripsService";

beforeEach(() => {
  fromMock.mockReset();
  authGetUserMock.mockReset();
});

describe("ORCH-0859 — createTripDraft must set currency on events insert", () => {
  test("events.insert payload includes currency from brand.default_currency", async () => {
    authGetUserMock.mockResolvedValueOnce({
      data: { user: { id: "user-1" } },
    });

    // Capture the events insert payload so we can assert `currency` is present.
    let capturedEventsInsertPayload: Record<string, unknown> | null = null;

    const brandsChain = {
      select: () => brandsChain,
      eq: () => brandsChain,
      maybeSingle: () =>
        Promise.resolve({
          data: { default_currency: "EUR", slug: "travelbrand" },
          error: null,
        }),
    };

    const eventsChain = {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      insert: (payload: Record<string, unknown>) => {
        capturedEventsInsertPayload = payload;
        return eventsChain;
      },
      select: () => eventsChain,
      single: () =>
        Promise.resolve({
          data: {
            id: "event-1",
            brand_id: "brand-1",
            title: "Untitled trip",
            description: null,
            slug: "draft-x",
            status: "draft",
            visibility: "draft",
            published_at: null,
            timezone: "UTC",
            cover_media_url: null,
            cover_media_type: null,
            theme: { business_trip: {} },
            event_type: "trip",
            created_at: "2026-05-17T00:00:00Z",
            updated_at: "2026-05-17T00:00:00Z",
          },
          error: null,
        }),
    };

    const ticketTypesChain = {
      insert: () => ticketTypesChain,
      select: () => ticketTypesChain,
      single: () =>
        Promise.resolve({
          data: {
            id: "tt-1",
            event_id: "event-1",
            price_cents: 0,
            currency: "EUR",
            quantity_total: 1,
            is_unlimited: false,
          },
          error: null,
        }),
    };

    const tripPricingTiersChain = {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      insert: () => Promise.resolve({ data: null, error: null }) as any,
    };

    fromMock.mockImplementation((table: string) => {
      if (table === "brands") return brandsChain;
      if (table === "events") return eventsChain;
      if (table === "ticket_types") return ticketTypesChain;
      if (table === "trip_pricing_tiers") return tripPricingTiersChain;
      throw new Error(`Unexpected table: ${table}`);
    });

    await createTripDraft({ brandId: "brand-1" }, "owner");

    expect(capturedEventsInsertPayload).not.toBeNull();
    const payload = capturedEventsInsertPayload as unknown as Record<string, unknown>;
    // Core assertion: the events insert payload MUST carry currency.
    // Reverting the fix (removing `currency: defaultCurrency` from the
    // events insert) deletes this field and the test fails.
    expect(payload).toHaveProperty("currency");
    expect(payload.currency).toBe("EUR");
    // Also confirm event_type and other required fields are still set
    // (defensive — catches accidental restructuring during the fix).
    expect(payload.event_type).toBe("trip");
    expect(payload.brand_id).toBe("brand-1");
    expect(payload.status).toBe("draft");
  });

  test("falls back to 'USD' when brand has no default_currency", async () => {
    authGetUserMock.mockResolvedValueOnce({
      data: { user: { id: "user-1" } },
    });

    let capturedEventsInsertPayload: Record<string, unknown> | null = null;

    const brandsChain = {
      select: () => brandsChain,
      eq: () => brandsChain,
      maybeSingle: () =>
        Promise.resolve({
          data: { default_currency: null, slug: "newbrand" },
          error: null,
        }),
    };

    const eventsChain = {
      insert: (payload: Record<string, unknown>) => {
        capturedEventsInsertPayload = payload;
        return eventsChain;
      },
      select: () => eventsChain,
      single: () =>
        Promise.resolve({
          data: {
            id: "event-2",
            brand_id: "brand-2",
            title: "Untitled trip",
            description: null,
            slug: "draft-y",
            status: "draft",
            visibility: "draft",
            published_at: null,
            timezone: "UTC",
            cover_media_url: null,
            cover_media_type: null,
            theme: { business_trip: {} },
            event_type: "trip",
            created_at: "2026-05-17T00:00:00Z",
            updated_at: "2026-05-17T00:00:00Z",
          },
          error: null,
        }),
    };

    const ticketTypesChain = {
      insert: () => ticketTypesChain,
      select: () => ticketTypesChain,
      single: () =>
        Promise.resolve({
          data: {
            id: "tt-2",
            event_id: "event-2",
            price_cents: 0,
            currency: "USD",
            quantity_total: 1,
            is_unlimited: false,
          },
          error: null,
        }),
    };

    const tripPricingTiersChain = {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      insert: () => Promise.resolve({ data: null, error: null }) as any,
    };

    fromMock.mockImplementation((table: string) => {
      if (table === "brands") return brandsChain;
      if (table === "events") return eventsChain;
      if (table === "ticket_types") return ticketTypesChain;
      if (table === "trip_pricing_tiers") return tripPricingTiersChain;
      throw new Error(`Unexpected table: ${table}`);
    });

    await createTripDraft({ brandId: "brand-2" }, "owner");

    expect(capturedEventsInsertPayload).not.toBeNull();
    const payload = capturedEventsInsertPayload as unknown as Record<string, unknown>;
    expect(payload.currency).toBe("USD");
  });
});
