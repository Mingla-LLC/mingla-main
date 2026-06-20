/* eslint-disable import/first */
/**
 * ORCH-1172 R3 — single-event RSVP hydration regression (proves B1).
 *
 * The gap the green ORCH-1172 suite missed: that suite pre-attaches a correct
 * `rsvpMeta` to its LiveEvent fixture, so it never exercises the REAL
 * `fetchBusinessEventById → detailFromRow → eventFromRow` read where the
 * hydration dropped. The single-event detail path (unlike the LIST path) did
 * NOT probe the rsvp_* columns nor thread an rsvpMeta, so a server-loaded RSVP
 * editor hydrated DEFAULTS (discoverable=false, capacity=null, approval="auto",
 * …) regardless of the saved DB values — the proven wrong-on-open render AND
 * the root of the save-clobber.
 *
 * This test mocks supabase so the `events` probe carries the REAL saved rsvp_*
 * values and asserts they flow all the way through to the returned LiveEvent.
 *
 * Fails-on-revert: drop the rsvpMeta/eventType thread out of
 * `fetchBusinessEventById` (or `detailFromRow`) → every rsvp_* assertion below
 * collapses to the defaults (false / null / 0 / "auto").
 */

import { beforeEach, describe, expect, jest, test } from "@jest/globals";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const fromMock = jest.fn() as any;

jest.mock("../supabase", () => ({
  supabase: {
    from: (table: string) => fromMock(table),
  },
}));

jest.mock("../appsFlyerService", () => ({
  logAppsFlyerEvent: jest.fn(),
}));

import { fetchBusinessEventById } from "../businessEvents";

beforeEach(() => {
  fromMock.mockReset();
});

describe("ORCH-1172 R3 — fetchBusinessEventById RSVP hydration (B1)", () => {
  test("threads the REAL saved rsvp_* values from the events probe into the LiveEvent (not defaults)", async () => {
    // The single-event events probe — carries the REAL host-control snapshot
    // + pass_* switches. event_type='rsvp' so the rsvpMeta is built.
    const eventsChain = {
      select: () => eventsChain,
      eq: () => eventsChain,
      maybeSingle: () =>
        Promise.resolve({
          data: {
            id: "rsvp-1",
            event_type: "rsvp",
            pass_tax: null,
            pass_mingla_fee: null,
            pass_service_fee: null,
            rsvp_capacity: 30,
            rsvp_allow_plus_ones: true,
            rsvp_plus_ones_max: 2,
            rsvp_waitlist_enabled: true,
            rsvp_approval_mode: "manual",
            rsvp_discoverable: true,
          },
          error: null,
        }),
    };

    // The management view — exposes management_theme but NO rsvp_* columns.
    // hideRemainingCount=false lives under theme.business_event.settings.
    const viewChain = {
      select: () => viewChain,
      eq: () => viewChain,
      maybeSingle: () =>
        Promise.resolve({
          data: {
            id: "rsvp-1",
            brand_id: "brand-1",
            brand_slug: "brand",
            title: "House Party",
            slug: "house-party",
            status: "scheduled",
            visibility: "public",
            description: "BYOB.",
            timezone: "America/New_York",
            management_theme: {
              business_event: {
                hideAddressUntilTicket: false,
                settings: { hideRemainingCount: false },
              },
            },
            created_at: "2026-06-01T11:00:00.000Z",
            updated_at: "2026-06-01T12:00:00.000Z",
            published_at: "2026-06-01T12:00:00.000Z",
          },
          error: null,
        }),
    };

    const ticketsChain = {
      select: () => ticketsChain,
      eq: () => ticketsChain,
      is: () => ticketsChain,
      order: () => Promise.resolve({ data: [], error: null }),
    };

    fromMock.mockImplementation((table: string) => {
      if (table === "events") return eventsChain;
      if (table === "business_management_events_view") return viewChain;
      if (table === "ticket_types") return ticketsChain;
      throw new Error(`Unexpected table: ${table}`);
    });

    const detail = await fetchBusinessEventById("rsvp-1");
    expect(detail).not.toBeNull();
    const ev = detail!.event;

    // The discriminator threads through.
    expect(ev.event_type).toBe("rsvp");

    // The 6 rsvp_* host-controls hydrate from the probe — NOT defaults.
    expect(ev.rsvpDiscoverable).toBe(true); // default would be false
    expect(ev.rsvpCapacity).toBe(30); // default would be null
    expect(ev.rsvpApprovalMode).toBe("manual"); // default would be "auto"
    expect(ev.rsvpWaitlistEnabled).toBe(true); // default would be false
    expect(ev.rsvpAllowPlusOnes).toBe(true); // default would be false
    expect(ev.rsvpPlusOnesMax).toBe(2); // default would be 0

    // Theme-derived privacy leaves hydrate from management_theme (already
    // correct pre-R3 — locked here to guard the B2 diff comparison shape).
    expect(ev.hideRemainingCount).toBe(false);
    expect(ev.hideAddressUntilTicket).toBe(false);
  });

  test("a non-RSVP event leaves the rsvp_* fields at their inert defaults", async () => {
    const eventsChain = {
      select: () => eventsChain,
      eq: () => eventsChain,
      maybeSingle: () =>
        Promise.resolve({
          data: {
            id: "evt-1",
            event_type: "event",
            pass_tax: null,
            pass_mingla_fee: null,
            pass_service_fee: null,
            rsvp_capacity: null,
            rsvp_allow_plus_ones: null,
            rsvp_plus_ones_max: null,
            rsvp_waitlist_enabled: null,
            rsvp_approval_mode: null,
            rsvp_discoverable: null,
          },
          error: null,
        }),
    };

    const viewChain = {
      select: () => viewChain,
      eq: () => viewChain,
      maybeSingle: () =>
        Promise.resolve({
          data: {
            id: "evt-1",
            brand_id: "brand-1",
            brand_slug: "brand",
            title: "Ticketed Event",
            slug: "ticketed-event",
            status: "scheduled",
            visibility: "public",
            management_theme: { business_event: { settings: {} } },
            created_at: "2026-06-01T11:00:00.000Z",
            updated_at: "2026-06-01T12:00:00.000Z",
          },
          error: null,
        }),
    };

    const ticketsChain = {
      select: () => ticketsChain,
      eq: () => ticketsChain,
      is: () => ticketsChain,
      order: () => Promise.resolve({ data: [], error: null }),
    };

    fromMock.mockImplementation((table: string) => {
      if (table === "events") return eventsChain;
      if (table === "business_management_events_view") return viewChain;
      if (table === "ticket_types") return ticketsChain;
      throw new Error(`Unexpected table: ${table}`);
    });

    const detail = await fetchBusinessEventById("evt-1");
    expect(detail).not.toBeNull();
    const ev = detail!.event;

    expect(ev.event_type).toBe("event");
    // rsvpMeta is null for non-RSVP → inert defaults (no clobber risk).
    expect(ev.rsvpDiscoverable).toBe(false);
    expect(ev.rsvpCapacity).toBeNull();
    expect(ev.rsvpApprovalMode).toBe("auto");
  });
});
