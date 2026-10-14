/**
 * @jest-environment ./__tests__/support/issue3801TimeZoneEnvironment.cjs
 *
 * Issue #3801 — a trip's length counts calendar days.
 *
 * BEFORE. `deriveTripDuration` rounded the elapsed time between start and end.
 * Trips are stored as UTC day bounds, so the end is 23:59:59Z on the last day,
 * and rounding turned that into one extra day: 12 to 16 November read
 * "6 days · 5 nights" on the public page and in the Explorer app.
 *
 * AFTER. days = (UTC date of the end) − (UTC date of the start) + 1, in every
 * device timezone.
 *
 * Every case runs the REAL shared function, both directly and through the real
 * business adapter that feeds the public trip page. Fails on revert of
 * packages/offering-rendering/tripDuration.ts.
 */

import { deriveTripDuration } from "@mingla/offering-rendering";

import type { Trip } from "../../../services/tripsService";
import { buildTripOfferingData } from "../tripOfferingAdapter";

// Supplied by __tests__/support/issue3801TimeZoneEnvironment.cjs, which also
// restores the original zone when this file finishes.
const setZone = (zone: string): void => {
  (
    globalThis as unknown as { __setProcessTimeZone: (zone: string) => void }
  ).__setProcessTimeZone(zone);
};

const ZONES = ["America/New_York", "Africa/Lagos", "UTC", "Pacific/Kiritimati"] as const;

// The stored values of the production trip in the report, in the two forms the
// reader returns them: ISO, and Postgres timestamp text.
const START_ISO = "2026-11-12T00:00:00.000Z";
const END_ISO = "2026-11-16T23:59:59.000Z";
const START_PG = "2026-11-12 00:00:00+00";
const END_PG = "2026-11-16 23:59:59+00";

function tripWithDates(startAt: string | null, endAt: string | null): Trip {
  return {
    id: "trip-1",
    brandId: "brand-1",
    brandSlug: "sunrise",
    title: "Coast week",
    description: null,
    slug: "coast",
    status: "scheduled",
    visibility: "public",
    publishedAt: null,
    timezone: "UTC",
    coverMediaUrl: null,
    coverMediaAlt: null,
    coverMediaType: null,
    coverGallery: [],
    businessTrip: {
      startAt,
      endAt,
      destinationPlaceId: null,
      destinationLocationText: null,
      destinationLat: null,
      destinationLng: null,
      departurePlaceId: null,
      departureLocationText: null,
      departureLat: null,
      departureLng: null,
      capacity: null,
    },
    days: [],
    pricingTiers: [],
    inclusions: [],
    refundPolicy: null,
    bookingDeadline: null,
    bookingsClosed: false,
  } as unknown as Trip;
}

describe("issue #3801 — trip length counts calendar days", () => {
  it("really changes the process timezone", () => {
    setZone("America/New_York");
    expect(new Date("2026-11-12T00:00:00.000Z").getDate()).toBe(11);
    setZone("Pacific/Kiritimati");
    expect(new Date("2026-11-12T00:00:00.000Z").getDate()).toBe(12);
    expect(new Date("2026-11-16T23:59:59.000Z").getDate()).toBe(17);
  });

  for (const zone of ZONES) {
    describe(`device in ${zone}`, () => {
      beforeEach(() => setZone(zone));

      it("12 Nov to 16 Nov 23:59:59Z is 5 days and 4 nights", () => {
        expect(deriveTripDuration(START_ISO, END_ISO)).toBe("5 days · 4 nights");
        expect(deriveTripDuration(START_PG, END_PG)).toBe("5 days · 4 nights");
      });

      it("the public trip page shows the same length", () => {
        expect(buildTripOfferingData(tripWithDates(START_PG, END_PG), true).durationLabel).toBe(
          "5 days · 4 nights",
        );
      });

      it("a trip that starts and ends on one day is 1 day", () => {
        expect(deriveTripDuration("2026-11-12T00:00:00.000Z", "2026-11-12T23:59:59.000Z")).toBe(
          "1 day",
        );
        expect(deriveTripDuration("2026-11-12 00:00:00+00", "2026-11-12 00:00:00+00")).toBe(
          "1 day",
        );
      });

      it("an overnight trip is 2 days and 1 night", () => {
        expect(deriveTripDuration("2026-11-12T00:00:00.000Z", "2026-11-13T23:59:59.000Z")).toBe(
          "2 days · 1 night",
        );
      });

      it("a midnight end keeps the length it always had", () => {
        expect(deriveTripDuration("2026-08-17 00:00:00+00", "2026-08-18 00:00:00+00")).toBe(
          "2 days · 1 night",
        );
        expect(deriveTripDuration("2026-08-17 00:00:00+00", "2026-08-22 00:00:00+00")).toBe(
          "6 days · 5 nights",
        );
      });

      it("crosses a month and a year end by the calendar", () => {
        expect(deriveTripDuration("2026-12-30T00:00:00.000Z", "2027-01-02T23:59:59.000Z")).toBe(
          "4 days · 3 nights",
        );
      });

      it("still returns nothing for a missing or reversed range", () => {
        expect(deriveTripDuration(null, END_ISO)).toBeNull();
        expect(deriveTripDuration(START_ISO, null)).toBeNull();
        expect(deriveTripDuration(END_ISO, START_ISO)).toBeNull();
      });
    });
  }
});
