/**
 * @jest-environment ./__tests__/support/issue3801TimeZoneEnvironment.cjs
 *
 * Issue #3801 — tester adversarial proof for the trip length ("N days · M
 * nights").
 *
 * A different angle from the implementor suite, which proves the reported trip
 * and the plain shapes. This suite attacks the boundary the bug lived on and
 * the inputs a real row or an old build can hand over:
 *
 *   - ends at 23:59:59Z, 23:59:59.999Z, 00:00:00Z and one millisecond either
 *     side of midnight
 *   - the same instant, a reversed range, and a one-second trip over midnight
 *   - trips that cross a daylight-saving change, read on devices inside the
 *     zones that change
 *   - a start that is NOT at midnight UTC (a date written with a local offset)
 *   - junk, empty and missing dates
 *   - leap days, a year, a decade
 *   - a JavaScript engine with no `Intl` (the native app's engine has had
 *     gaps there before)
 *   - the length and the date range printed beside it always describe the
 *     same days
 *
 * Every case runs the REAL shared function, and the REAL business adapter that
 * feeds the public trip page. Fails on revert of
 * packages/offering-rendering/tripDuration.ts.
 */

import { deriveTripDuration, formatTripDateRange } from "@mingla/offering-rendering";

import type { Trip } from "../../../services/tripsService";
import { buildTripOfferingData } from "../tripOfferingAdapter";

const setZone = (zone: string): void => {
  (
    globalThis as unknown as { __setProcessTimeZone: (zone: string) => void }
  ).__setProcessTimeZone(zone);
};

// West of UTC, east of UTC, a half-hour zone, the far edges of the date line,
// and two zones whose clocks change inside the DST cases below.
const ZONES = [
  "UTC",
  "America/New_York",
  "America/Los_Angeles",
  "Africa/Lagos",
  "Europe/London",
  "Asia/Kolkata",
  "Pacific/Kiritimati",
  "Pacific/Pago_Pago",
] as const;

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

const label = (days: number): string =>
  days === 1 ? "1 day" : `${days} days · ${days - 1} night${days - 1 === 1 ? "" : "s"}`;

describe("issue #3801 tester — the end-of-day boundary", () => {
  for (const zone of ZONES) {
    describe(`device in ${zone}`, () => {
      beforeEach(() => setZone(zone));

      it("every way of writing the last second of 16 Nov is 5 days", () => {
        const start = "2026-11-12T00:00:00.000Z";
        const ends = [
          "2026-11-16T23:59:59Z",
          "2026-11-16T23:59:59.000Z",
          "2026-11-16T23:59:59.999Z",
          "2026-11-16 23:59:59+00",
          "2026-11-16 23:59:59.999+00",
          "2026-11-16 23:59:59.999999+00",
          "2026-11-16 23:59:59 +0000",
          "2026-11-16T23:59:59+00:00",
        ];
        for (const end of ends) {
          expect([end, deriveTripDuration(start, end)]).toEqual([end, "5 days · 4 nights"]);
        }
      });

      it("one millisecond decides the day, and only at midnight UTC", () => {
        const start = "2026-11-12T00:00:00.000Z";
        expect(deriveTripDuration(start, "2026-11-16T23:59:59.999Z")).toBe(label(5));
        expect(deriveTripDuration(start, "2026-11-17T00:00:00.000Z")).toBe(label(6));
        expect(deriveTripDuration(start, "2026-11-17T00:00:00.001Z")).toBe(label(6));
        // Any time of day on the 16th is still the 16th.
        expect(deriveTripDuration(start, "2026-11-16T00:00:00.000Z")).toBe(label(5));
        expect(deriveTripDuration(start, "2026-11-16T12:00:00.000Z")).toBe(label(5));
      });

      it("a trip inside one day is 1 day however long it runs", () => {
        expect(deriveTripDuration("2026-11-12T00:00:00.000Z", "2026-11-12T00:00:00.000Z")).toBe(label(1));
        expect(deriveTripDuration("2026-11-12T00:00:00.000Z", "2026-11-12T23:59:59.999Z")).toBe(label(1));
        expect(deriveTripDuration("2026-11-12T09:30:00.000Z", "2026-11-12T09:30:01.000Z")).toBe(label(1));
      });

      it("a trip that touches two dates is 2 days even when it is one second long", () => {
        expect(deriveTripDuration("2026-11-12T23:59:59.000Z", "2026-11-13T00:00:00.000Z")).toBe(label(2));
        expect(deriveTripDuration("2026-11-12T20:00:00.000Z", "2026-11-13T02:00:00.000Z")).toBe(label(2));
      });

      it("an end before the start is nothing, down to one millisecond", () => {
        expect(deriveTripDuration("2026-11-12T00:00:00.001Z", "2026-11-12T00:00:00.000Z")).toBeNull();
        expect(deriveTripDuration("2026-11-16T23:59:59.000Z", "2026-11-12T00:00:00.000Z")).toBeNull();
        expect(deriveTripDuration("2027-01-01 00:00:00+00", "2026-12-31 23:59:59+00")).toBeNull();
      });

      it("a trip across a clock change keeps its calendar length", () => {
        // US spring forward (8 Mar 2026) and fall back (1 Nov 2026).
        expect(deriveTripDuration("2026-03-07 00:00:00+00", "2026-03-09 23:59:59+00")).toBe(label(3));
        expect(deriveTripDuration("2026-10-31 00:00:00+00", "2026-11-02 23:59:59+00")).toBe(label(3));
        // UK spring forward (29 Mar 2026) and fall back (25 Oct 2026).
        expect(deriveTripDuration("2026-03-28 00:00:00+00", "2026-03-30 23:59:59+00")).toBe(label(3));
        expect(deriveTripDuration("2026-10-24 00:00:00+00", "2026-10-26 23:59:59+00")).toBe(label(3));
        // A whole summer across both US changes.
        expect(deriveTripDuration("2026-03-01 00:00:00+00", "2026-11-30 23:59:59+00")).toBe(label(275));
      });

      it("leap days, a year and a decade count by the calendar", () => {
        expect(deriveTripDuration("2028-02-28 00:00:00+00", "2028-03-01 23:59:59+00")).toBe(label(3));
        expect(deriveTripDuration("2027-02-28 00:00:00+00", "2027-03-01 23:59:59+00")).toBe(label(2));
        expect(deriveTripDuration("2026-01-01 00:00:00+00", "2026-12-31 23:59:59+00")).toBe(label(365));
        expect(deriveTripDuration("2028-01-01 00:00:00+00", "2028-12-31 23:59:59+00")).toBe(label(366));
        expect(deriveTripDuration("2026-01-01 00:00:00+00", "2035-12-31 23:59:59+00")).toBe(label(3652));
      });

      it("junk, empty and missing dates are nothing, never a guess", () => {
        const good = "2026-11-12T00:00:00.000Z";
        const junk = ["", "   ", "not a date", "2026-13-40", "2026-11-12T25:00:00Z", "null"];
        for (const bad of junk) {
          expect([bad, deriveTripDuration(bad, good)]).toEqual([bad, null]);
          expect([bad, deriveTripDuration(good, bad)]).toEqual([bad, null]);
        }
        expect(deriveTripDuration(null, null)).toBeNull();
        expect(deriveTripDuration(undefined as unknown as null, good)).toBeNull();
        const data = buildTripOfferingData(tripWithDates("not a date", good), true);
        expect(data.durationLabel).toBeNull();
      });

      it("the length never contains NaN, a zero or a negative number", () => {
        const starts = ["2026-11-12T00:00:00.000Z", "2026-11-12T23:59:59.999Z", "2026-11-12 11:11:11+00"];
        const ends = ["2026-11-12T23:59:59.999Z", "2026-11-13T00:00:00.000Z", "2026-12-01 23:59:59+00"];
        for (const s of starts) {
          for (const e of ends) {
            const out = deriveTripDuration(s, e);
            if (out === null) continue;
            expect(out).toMatch(/^(1 day|[2-9]\d* days · [1-9]\d* nights?|1\d+ days · \d+ nights)$/);
            expect(out).not.toMatch(/NaN|-|\b0 /);
          }
        }
      });
    });
  }
});

describe("issue #3801 tester — a start that is not midnight UTC", () => {
  beforeEach(() => setZone("Africa/Lagos"));

  // Trips are stored as UTC day bounds (00:00:00Z to 23:59:59Z). If a row were
  // ever written as LOCAL day bounds instead, for example midnight in Lagos
  // (UTC+1), its instants sit on the previous UTC date. The length follows the
  // UTC dates, and so does the date range printed beside it, so the page never
  // contradicts itself. This pins that agreement; it does not claim such a row
  // reads the days the host meant.
  it("a local-midnight start counts the UTC dates it touches", () => {
    // 12 Nov 00:00 to 16 Nov 23:59:59 in Lagos = 11 Nov 23:00Z to 16 Nov 22:59:59Z.
    expect(deriveTripDuration("2026-11-12T00:00:00+01:00", "2026-11-16T23:59:59+01:00")).toBe(label(6));
    expect(deriveTripDuration("2026-11-11 23:00:00+00", "2026-11-16 22:59:59+00")).toBe(label(6));
    // West of UTC the same mistake lands on the NEXT UTC date at the end.
    expect(deriveTripDuration("2026-11-12T00:00:00-05:00", "2026-11-16T23:59:59-05:00")).toBe(label(6));
  });

  it("the length and the printed date range always describe the same days", () => {
    const cases: [string, string][] = [
      ["2026-11-12 00:00:00+00", "2026-11-16 23:59:59+00"],
      ["2026-11-11 23:00:00+00", "2026-11-16 22:59:59+00"],
      ["2026-11-12T00:00:00-05:00", "2026-11-16T23:59:59-05:00"],
      ["2026-12-30 00:00:00+00", "2027-01-02 23:59:59+00"],
    ];
    for (const zone of ZONES) {
      setZone(zone);
      for (const [start, end] of cases) {
        const data = buildTripOfferingData(tripWithDates(start, end), true);
        const days = Number.parseInt(String(data.durationLabel), 10);
        // The two day-of-month numbers the range prints, read back from it.
        expect(data.dateRangeLabel).toBe(formatTripDateRange(start, end));
        const first = new Date(start.replace(" ", "T").replace(/\+00$/, "+00:00"));
        const last = new Date(end.replace(" ", "T").replace(/\+00$/, "+00:00"));
        expect(data.dateRangeLabel).toContain(String(first.getUTCDate()));
        expect(data.dateRangeLabel).toContain(String(last.getUTCDate()));
        const utcDays =
          (Date.UTC(last.getUTCFullYear(), last.getUTCMonth(), last.getUTCDate()) -
            Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), first.getUTCDate())) /
            86400000 +
          1;
        expect([zone, start, days]).toEqual([zone, start, utcDays]);
      }
    }
  });
});

describe("issue #3801 tester — no Intl needed", () => {
  const realIntl = globalThis.Intl;

  afterEach(() => {
    (globalThis as { Intl: unknown }).Intl = realIntl;
  });

  it("the length is the same on an engine with no Intl at all", () => {
    setZone("America/New_York");
    const withIntl = deriveTripDuration("2026-11-12 00:00:00+00", "2026-11-16 23:59:59+00");
    (globalThis as { Intl: unknown }).Intl = undefined;
    expect(deriveTripDuration("2026-11-12 00:00:00+00", "2026-11-16 23:59:59+00")).toBe(withIntl);
    expect(deriveTripDuration("2026-11-12 00:00:00+00", "2026-11-16 23:59:59+00")).toBe(label(5));
    expect(deriveTripDuration("2026-03-07 00:00:00+00", "2026-03-09 23:59:59+00")).toBe(label(3));
    expect(deriveTripDuration("2026-11-12 00:00:00+00", "2026-11-12 23:59:59+00")).toBe(label(1));
  });
});
