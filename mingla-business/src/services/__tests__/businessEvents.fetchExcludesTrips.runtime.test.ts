/* eslint-disable import/first */
/**
 * ORCH-0859 [Tr2 Minimum Viable Trip] RETEST 3 follow-up — RUNTIME test for
 * the events-tab trip-exclusion filter.
 *
 * Closes a gap in REWORK 3's source-grep audit: the audit pinned the
 * `.eq(...)` / `.filter(...)` call SHAPE but did not exercise the
 * function against a real mock that returns a trip row and assert the
 * trip is excluded from the result. Operator's RETEST 3 smoke surfaced
 * a live leak of trips into the events tab; a runtime test catches
 * logic errors in the filter even when the source patterns are present.
 *
 * Failure mode this attacks: if `tripIds` set is empty (e.g. RLS blocks
 * the second probe, or the response shape is different from the mock,
 * or the chained `.in("id", ids)` is dropped), the source-grep audit
 * still passes but the filter returns the trip row.
 */

import { beforeEach, describe, expect, jest, test } from "@jest/globals";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const fromMock = jest.fn() as any;

jest.mock("../supabase", () => ({
  supabase: {
    from: (table: string) => fromMock(table),
  },
}));

// Mock out transitive native imports (AppsFlyer + analytics) so
// `import { fetchBusinessEventsForBrand } from "../businessEvents"`
// doesn't pull react-native into jest.
jest.mock("../appsFlyerService", () => ({
  logAppsFlyerEvent: jest.fn(),
}));

import { fetchBusinessEventsForBrand } from "../businessEvents";

beforeEach(() => {
  fromMock.mockReset();
});

describe("ORCH-0859 RETEST 3 follow-up — fetchBusinessEventsForBrand runtime filter", () => {
  test("excludes event_type='trip' rows when the events probe returns them", async () => {
    // View returns 2 rows: one event (id=evt-1) and one trip (id=trip-1).
    const viewChain = {
      select: () => viewChain,
      eq: () => viewChain,
      order: () =>
        Promise.resolve({
          data: [
            {
              id: "evt-1",
              brand_id: "brand-1",
              title: "Real event",
              slug: "real-event",
              status: "scheduled",
              event_type: undefined, // view doesn't expose
            },
            {
              id: "trip-1",
              brand_id: "brand-1",
              title: "Leaking trip",
              slug: "leaking-trip",
              status: "scheduled",
            },
          ],
          error: null,
        }),
    };

    // Events table probe returns event_type per id.
    const eventsChain = {
      select: () => eventsChain,
      in: () =>
        Promise.resolve({
          data: [
            { id: "evt-1", event_type: "event" },
            { id: "trip-1", event_type: "trip" },
          ],
          error: null,
        }),
    };

    // Ticket probe returns empty for both ids.
    const ticketsChain = {
      select: () => ticketsChain,
      eq: () => ticketsChain,
      is: () => ticketsChain,
      order: () => Promise.resolve({ data: [], error: null }),
    };

    fromMock.mockImplementation((table: string) => {
      if (table === "business_management_events_view") return viewChain;
      if (table === "events") return eventsChain;
      if (table === "ticket_types") return ticketsChain;
      throw new Error(`Unexpected table: ${table}`);
    });

    const result = await fetchBusinessEventsForBrand("brand-1");

    // Critical assertion: the trip MUST be filtered out.
    const ids = result.map((r) => r.id);
    expect(ids).toContain("evt-1");
    expect(ids).not.toContain("trip-1");
    expect(result.length).toBe(1);
  });

  test("returns ALL rows when events probe returns ALL as event_type='event'", async () => {
    // Sanity test: when there are no trips, nothing is filtered.
    const viewChain = {
      select: () => viewChain,
      eq: () => viewChain,
      order: () =>
        Promise.resolve({
          data: [
            { id: "evt-1", brand_id: "brand-1", title: "A", slug: "a", status: "scheduled" },
            { id: "evt-2", brand_id: "brand-1", title: "B", slug: "b", status: "live" },
          ],
          error: null,
        }),
    };

    const eventsChain = {
      select: () => eventsChain,
      in: () =>
        Promise.resolve({
          data: [
            { id: "evt-1", event_type: "event" },
            { id: "evt-2", event_type: "event" },
          ],
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
      if (table === "business_management_events_view") return viewChain;
      if (table === "events") return eventsChain;
      if (table === "ticket_types") return ticketsChain;
      throw new Error(`Unexpected table: ${table}`);
    });

    const result = await fetchBusinessEventsForBrand("brand-1");
    expect(result.length).toBe(2);
  });

  test("FAILS LOUDLY (throws) when events probe RLS rejects — does NOT silently pass-through trips", async () => {
    // Failure-mode attack: if the events probe errors (e.g. RLS gap),
    // the original implementation would still return the unfiltered
    // view rows. That's the EXACT silent-leak the strict-grep can't
    // detect. The contract is THROW on error, NOT silently pass.
    const viewChain = {
      select: () => viewChain,
      eq: () => viewChain,
      order: () =>
        Promise.resolve({
          data: [
            { id: "trip-1", brand_id: "brand-1", title: "T", slug: "t", status: "scheduled" },
          ],
          error: null,
        }),
    };

    const eventsChain = {
      select: () => eventsChain,
      in: () =>
        Promise.resolve({
          data: null,
          error: { code: "42501", message: "permission denied for table events" },
        }),
    };

    fromMock.mockImplementation((table: string) => {
      if (table === "business_management_events_view") return viewChain;
      if (table === "events") return eventsChain;
      throw new Error(`Unexpected table: ${table}`);
    });

    await expect(fetchBusinessEventsForBrand("brand-1")).rejects.toBeTruthy();
  });
});
