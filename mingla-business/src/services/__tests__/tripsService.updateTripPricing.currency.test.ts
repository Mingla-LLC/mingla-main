/* eslint-disable import/first */
/**
 * ORCH-0859 [Tr2 Minimum Viable Trip] REWORK 2 — Bug #1 regression.
 *
 * Pins that `updateTripPricing` ALWAYS sends the event's currency to
 * ticket_types, NEVER the caller-supplied currency. The
 * tg_enforce_event_ticket_currency trigger
 * (supabase/migrations/20260515000011_orch_0769_no_implicit_gbp_currency.sql:159)
 * rejects any mismatch between ticket_types.currency and events.currency;
 * before this fix the wizard let operators type a free-form currency on
 * Step 4 and the autosave hit `ticket_currency_must_match_event_currency`.
 *
 * Fails-on-revert: if the service trusts patch.currency instead of the
 * event-row-derived currency, the assertion that ticket_types receives
 * "EUR" (the event currency) regardless of patch input fails.
 */

import { beforeEach, describe, expect, jest, test } from "@jest/globals";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const fromMock = jest.fn() as any;

jest.mock("../supabase", () => ({
  supabase: {
    from: (table: string) => fromMock(table),
  },
}));

import { updateTripPricing } from "../tripsService";
// #1062 [biz-jest-residual-burndown] Wave 1 / B3c — shared chainable supabase mock.
import { createChainableQuery } from "./__helpers__/supabaseMock";

beforeEach(() => {
  fromMock.mockReset();
});

describe("ORCH-0859 REWORK 2 — updateTripPricing currency contract", () => {
  test("always sends events.currency to ticket_types, ignoring patch.currency", async () => {
    let capturedTicketUpdate: Record<string, unknown> | null = null;

    const eventsChain = {
      select: () => eventsChain,
      eq: () => eventsChain,
      maybeSingle: () =>
        Promise.resolve({
          data: { currency: "EUR" },
          error: null,
        }),
    };

    // #1062 [biz-jest-residual-burndown] Wave 1 / B3c [TEST-MOD-APPROVED ORCH-1062] —
    // updateTripPricing now reads the tier via `.order("created_at").limit(1)`
    // (META-ORCH-1174 Leg B1: pick the earliest-created row, NEVER throw on >1 as the
    // old `.maybeSingle()` did), so the select chain must expose `.order`/`.limit` and
    // resolve an ARRAY. Migrated to the shared chainable mock (every chain method +
    // thenable terminal). Plumbing only — assertions unchanged.
    const tierSelectChain = createChainableQuery({
      data: [
        {
          id: "tier-1",
          event_id: "evt-1",
          ticket_type_id: "tt-1",
          tier_name: "Standard",
          tier_metadata: {},
        },
      ],
    });

    const ticketUpdateChain = {
      update: (payload: Record<string, unknown>) => {
        capturedTicketUpdate = payload;
        return ticketUpdateChain;
      },
      eq: () => ticketUpdateChain,
      select: () => ticketUpdateChain,
      single: () =>
        Promise.resolve({
          data: {
            id: "tt-1",
            event_id: "evt-1",
            price_cents: 5000,
            currency: "EUR",
            quantity_total: 10,
            is_unlimited: false,
          },
          error: null,
        }),
    };

    const tierUpdateChain = {
      update: () => tierUpdateChain,
      eq: () => tierUpdateChain,
      select: () => tierUpdateChain,
      single: () =>
        Promise.resolve({
          data: {
            id: "tier-1",
            event_id: "evt-1",
            ticket_type_id: "tt-1",
            tier_name: "Standard",
            tier_metadata: {},
          },
          error: null,
        }),
    };

    let tierSelectCalls = 0;
    let ticketTypesCalls = 0;
    fromMock.mockImplementation((table: string) => {
      if (table === "events") return eventsChain;
      if (table === "trip_pricing_tiers") {
        tierSelectCalls += 1;
        return tierSelectCalls === 1 ? tierSelectChain : tierUpdateChain;
      }
      if (table === "ticket_types") {
        ticketTypesCalls += 1;
        return ticketUpdateChain;
      }
      throw new Error(`Unexpected table: ${table}`);
    });

    // Caller passes a DIFFERENT currency than the event's — must be IGNORED.
    await updateTripPricing("evt-1", {
      tierName: "Standard",
      priceCents: 5000,
      capacity: 10,
      currency: "JPY", // intentional bogus value — must NOT reach ticket_types
    });

    expect(capturedTicketUpdate).not.toBeNull();
    const payload = capturedTicketUpdate as unknown as Record<string, unknown>;
    expect(payload.currency).toBe("EUR"); // from events row, NOT from patch
    expect(payload.currency).not.toBe("JPY"); // belt-and-braces
    expect(payload.price_cents).toBe(5000);
    expect(payload.quantity_total).toBe(10);
    expect(ticketTypesCalls).toBe(1);
  });

  // issue #1014 (rework F-2) — NULL passthrough, no fabricated USD: a NULL-currency
  // event stamps the ticket NULL (tripsService.ts:1165-1204); the
  // tg_enforce_event_ticket_currency trigger resolves the brand currency for PAID
  // tickets at write time and raises event_currency_required if none.
  test("passes NULL through to ticket_types when events row has no currency [#1014]", async () => {
    let capturedTicketUpdate: Record<string, unknown> | null = null;

    const eventsChain = {
      select: () => eventsChain,
      eq: () => eventsChain,
      maybeSingle: () =>
        Promise.resolve({
          data: { currency: null },
          error: null,
        }),
    };

    // #1062 [biz-jest-residual-burndown] Wave 1 / B3c [TEST-MOD-APPROVED ORCH-1062] —
    // see the first case: the tier select now uses `.order().limit()` returning an
    // ARRAY. Migrated to the shared chainable mock. Plumbing only.
    const tierSelectChain = createChainableQuery({
      data: [
        {
          id: "tier-2",
          event_id: "evt-2",
          ticket_type_id: "tt-2",
          tier_name: "Standard",
          tier_metadata: {},
        },
      ],
    });

    const ticketUpdateChain = {
      update: (payload: Record<string, unknown>) => {
        capturedTicketUpdate = payload;
        return ticketUpdateChain;
      },
      eq: () => ticketUpdateChain,
      select: () => ticketUpdateChain,
      single: () =>
        Promise.resolve({
          data: {
            id: "tt-2",
            event_id: "evt-2",
            price_cents: 0,
            currency: "USD",
            quantity_total: 1,
            is_unlimited: false,
          },
          error: null,
        }),
    };

    const tierUpdateChain = {
      update: () => tierUpdateChain,
      eq: () => tierUpdateChain,
      select: () => tierUpdateChain,
      single: () =>
        Promise.resolve({
          data: { id: "tier-2", event_id: "evt-2", ticket_type_id: "tt-2", tier_name: "Standard", tier_metadata: {} },
          error: null,
        }),
    };

    let tierSelectCalls = 0;
    fromMock.mockImplementation((table: string) => {
      if (table === "events") return eventsChain;
      if (table === "trip_pricing_tiers") {
        tierSelectCalls += 1;
        return tierSelectCalls === 1 ? tierSelectChain : tierUpdateChain;
      }
      if (table === "ticket_types") return ticketUpdateChain;
      throw new Error(`Unexpected table: ${table}`);
    });

    await updateTripPricing("evt-2", {
      tierName: "Standard",
      priceCents: 0,
      capacity: 1,
    });

    expect(capturedTicketUpdate).not.toBeNull();
    const payload = capturedTicketUpdate as unknown as Record<string, unknown>;
    expect(payload.currency).toBeNull();
  });
});
