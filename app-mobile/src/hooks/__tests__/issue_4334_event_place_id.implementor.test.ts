// issue #4334 N-1 (retest 2) — the Google place id reaches Explorer's event and
// RSVP pages through their REAL reads, so "Open in Maps" opens the picked place.
//
//   P-1  the event page's query function calls pg_direct_event_checkout_bundle and
//        carries googlePlaceId onto the event props
//   P-2  a withheld street (the bundle sends null) or an older bundle (no key) maps
//        to null, never to a stale or invented id
//   P-3  the RSVP page's query function (pg_public_rsvp_by_slug) carries it too
//
// FAILS-ON-REVERT: drop the `googlePlaceId:` line from usePublicEventBySlug.ts
// (P-1) or usePublicRsvpBySlug.ts (P-3) and the matching case fails.

let mockQueryOptions: Record<string, unknown>;

jest.mock("@tanstack/react-query", () => ({
  useQuery: (options: Record<string, unknown>) => {
    mockQueryOptions = options;
    return options;
  },
}));
// The same partial barrel factory as the #3284 / #1929 / #2230 suites.
jest.mock("@mingla/offering-rendering", () => ({
  forwardableAcquisitionState: (
    jest.requireActual("@mingla/offering-rendering/eventAcquisitionLifecycle") as {
      forwardableAcquisitionState: (...a: unknown[]) => unknown;
    }
  ).forwardableAcquisitionState,
  isThemeAnimationSlug: () => false,
  isThemeColor: () => false,
  isThemeFontSlug: () => false,
  isOpenDailyExperience: (
    jest.requireActual("@mingla/offering-rendering/experienceOpenDaily") as {
      isOpenDailyExperience: (...a: unknown[]) => boolean;
    }
  ).isOpenDailyExperience,
  normalizeCityCountry: (
    jest.requireActual("@mingla/offering-rendering/normalizeCityCountry") as {
      normalizeCityCountry: (...a: unknown[]) => string | null;
    }
  ).normalizeCityCountry,
}));
jest.mock("../../services/supabase", () => ({ supabase: { rpc: jest.fn() } }));

import { usePublicEventBySlug } from "../usePublicEventBySlug";
import { usePublicRsvpBySlug } from "../usePublicRsvpBySlug";
import { supabase } from "../../services/supabase";

const mockRpc = supabase.rpc as jest.Mock;
const PLACE_ID = "ChIJ0Wq9hS_1OxARsFOw5qkW6Y0";

const payload = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: "event-4334",
  brandId: "brand-1",
  brandSlug: "didi",
  eventSlug: "museum-night",
  name: "Museum Night",
  status: "scheduled",
  timezone: "Africa/Lagos",
  currency: "NGN",
  tickets: [],
  occurrences: [
    {
      id: "occ-1",
      startAt: "2099-10-03T19:00:00Z",
      endAt: "2099-10-03T23:00:00Z",
      timezone: "Africa/Lagos",
      isMaster: true,
    },
  ],
  brand: { id: "brand-1", slug: "didi", name: "Didi Museum" },
  ...overrides,
});

type WithEvent = { event: { googlePlaceId?: string | null } };

const runEvent = async (data: Record<string, unknown>): Promise<WithEvent> => {
  mockRpc.mockResolvedValue({ data, error: null });
  usePublicEventBySlug("didi", "museum-night");
  return (await (mockQueryOptions.queryFn as () => Promise<unknown>)()) as WithEvent;
};

const runRsvp = async (data: Record<string, unknown>): Promise<WithEvent> => {
  mockRpc.mockResolvedValue({ data, error: null });
  usePublicRsvpBySlug("didi", "museum-night");
  return (await (mockQueryOptions.queryFn as () => Promise<unknown>)()) as WithEvent;
};

describe("#4334 N-1 — Explorer's event pages carry the Google place id", () => {
  beforeEach(() => mockRpc.mockReset());

  test("P-1 the event page reads it from the checkout bundle", async () => {
    const result = await runEvent(payload({ googlePlaceId: PLACE_ID }));
    expect(mockRpc).toHaveBeenCalledWith("pg_direct_event_checkout_bundle", {
      p_event_id: null,
      p_brand_slug: "didi",
      p_event_slug: "museum-night",
    });
    expect(result.event.googlePlaceId).toBe(PLACE_ID);
  });

  test("P-2 a withheld street or an older bundle maps to null", async () => {
    expect((await runEvent(payload({ googlePlaceId: null }))).event.googlePlaceId).toBeNull();
    expect((await runEvent(payload())).event.googlePlaceId).toBeNull();
  });

  test("P-3 the RSVP page reads it from pg_public_rsvp_by_slug", async () => {
    const result = await runRsvp(payload({ googlePlaceId: PLACE_ID }));
    expect(mockRpc).toHaveBeenCalledWith("pg_public_rsvp_by_slug", {
      p_brand_slug: "didi",
      p_event_slug: "museum-night",
    });
    expect(result.event.googlePlaceId).toBe(PLACE_ID);
    expect((await runRsvp(payload({ googlePlaceId: null }))).event.googlePlaceId).toBeNull();
  });
});
