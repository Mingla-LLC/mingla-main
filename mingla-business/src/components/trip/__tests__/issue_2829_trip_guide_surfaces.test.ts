/**
 * Issue #2829 W4 — the trip guide reaches the shared trip body on EVERY
 * surface, through each surface's own adapter, identically:
 *  - Business + buyer web: `buildTripOfferingData(trip, …, guideRaw)` (the
 *    /t/<brand>/<trip> route reads `pg_public_trip_guide` via
 *    usePublicTripGuide — anon-tolerant, no useAuth);
 *  - consumer iOS/Android: `buildConsumerTripOfferingData(detail, …, guideRaw)`
 *    (the consumer trip screen reads it via useConsumerTripGuide).
 * Both produce the same `guide` for the same stored guide and capacity, and
 * `guide: null` for a trip without one (so the body renders as before).
 */

import { describe, expect, jest, test } from "@jest/globals";

// #2829 W11 — the adapters are loaded as real modules (jest transpiles them),
// with only their outside boundaries stubbed; no source text is read here. The
// wiring of each surface (route, hooks, consumer screen) is a structural rule
// and lives in the Sites strict-grep gate (issue-2830-sites-foundation.mjs).
jest.mock("@mingla/offering-rendering", () => ({
  deriveTripDuration: () => "5 days · 4 nights",
  formatTripDateRange: () => "Jun 28 – Jul 2, 2026",
  normalizeCityCountry: (value: string | null) => value,
}));
// virtual: app-mobile has its own node_modules, which this jest run does not resolve.
jest.mock("@tanstack/react-query", () => ({ useQuery: jest.fn() }), { virtual: true });
jest.mock("../../../../../app-mobile/src/services/supabase", () => ({ supabase: {} }));
jest.mock("../../../../../app-mobile/src/hooks/useConsumerTripDetail", () => ({ consumerTripDetailKeys: { all: ["consumerTripDetail"] } }));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const business = require("../tripOfferingAdapter") as { buildTripOfferingData: (...args: unknown[]) => Record<string, unknown> };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const consumer = require("../../../../../app-mobile/src/hooks/useConsumerTripOfferingData") as { buildConsumerTripOfferingData: (...args: unknown[]) => Record<string, unknown> };

const RAW = {
  highlights: ["Swim at Ksamil"],
  what_to_prepare: "Water shoes.",
  good_to_know: null,
  faqs: [{ question: "Visa?", answer: "Not needed." }],
  group_minimum: 6,
  activity_level: "moderate",
  updated_at: "2026-10-26T00:00:00Z",
};

const bizTrip = {
  id: "trip-1", title: "Albania", description: null, bookingDeadline: null, bookingsClosed: false,
  businessTrip: { startAt: null, endAt: null, capacity: 16, departureLocationText: null, destinationLocationText: null, destinationLat: null, destinationLng: null },
  pricingTiers: [], days: [], inclusions: [], refundPolicy: null,
};
const consumerDetail = {
  tripId: "trip-1", title: "Albania", description: null, startAt: null, endAt: null, spotsLeft: 4, totalCapacity: 16,
  departureText: null, destinationText: null, bookingDeadline: null, days: [], inclusions: [], refundPolicy: null,
  tiers: [], currency: "USD", destinationLat: null, destinationLng: null, bookable: true, bookingsClosed: false,
};

describe("#2829 trip guide on every surface", () => {
  test("Business/buyer web and consumer map the same stored guide to the same body guide", () => {
    const fromBusiness = business.buildTripOfferingData(bizTrip, true, null, RAW).guide;
    const fromConsumer = consumer.buildConsumerTripOfferingData(consumerDetail, null, RAW).guide;
    expect(fromBusiness).toEqual({
      highlights: ["Swim at Ksamil"],
      whatToPrepare: "Water shoes.",
      goodToKnow: null,
      faqs: [{ question: "Visa?", answer: "Not needed." }],
      activityLevel: "moderate",
      groupSizeLabel: "Group size 6–16",
    });
    expect(fromConsumer).toEqual(fromBusiness);
  });

  test("no guide on record (or not loaded) → guide null on both, so the body is unchanged", () => {
    for (const raw of [undefined, null, {}]) {
      expect(business.buildTripOfferingData(bizTrip, true, null, raw).guide).toBeNull();
      expect(consumer.buildConsumerTripOfferingData(consumerDetail, null, raw).guide).toBeNull();
    }
  });
});
