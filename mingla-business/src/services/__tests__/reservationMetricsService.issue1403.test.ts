import {
  ReservationMetricsUnavailableError,
  normalizeVenueReservationMetrics,
} from "../reservationMetricsService";

const BRAND = "brand-1403";
const VENUE = "venue-1403";

const valid = {
  brand_id: BRAND,
  venue_id: VENUE,
  authorized: true,
  resolved_timezone: "America/New_York",
  tz_confidence: "iana",
  covers_30d: 4,
  covers_lifetime: 7,
  avg_party_size: 2.5,
  no_show_rate: 0.125,
  by_source: [
    { source: "mingla", reservations: 3, covers: 4 },
    { source: "website", reservations: 1, covers: 3 },
    { source: "future_native_source", reservations: 9, covers: 9 },
  ],
  value_cents_30d: { GBP: 1200 },
  value_cents_lifetime: { GBP: 1200, NGN: 250000 },
};

describe("issue #1403 venue reservation service", () => {
  it("preserves exact venue scope, server source order and per-currency fees", () => {
    const result = normalizeVenueReservationMetrics(valid, BRAND, VENUE);
    expect(result.brandId).toBe(BRAND);
    expect(result.venueId).toBe(VENUE);
    expect(result.bySource.map((row) => row.source)).toEqual([
      "mingla",
      "website",
    ]);
    expect(result.valueCentsLifetime).toEqual({ GBP: 1200, NGN: 250000 });
  });

  it("accepts a future-confirmed zero-cover state without fabricating a no-show", () => {
    const result = normalizeVenueReservationMetrics(
      {
        ...valid,
        covers_30d: 0,
        covers_lifetime: 0,
        avg_party_size: 3,
        no_show_rate: 0,
        by_source: [{ source: "website", reservations: 1, covers: 0 }],
        value_cents_30d: {},
        value_cents_lifetime: {},
      },
      BRAND,
      VENUE,
    );
    expect(result.bySource[0].reservations).toBe(1);
    expect(result.noShowRate).toBe(0);
  });

  it.each([
    ["forged", "iana"],
    ["America/New_York", "offset"],
    ["UTC+5", "offset"],
    ["UTC+05:60", "offset"],
    ["UTC+14:30", "offset"],
    ["UTC+05:30", "utc"],
  ])(
    "rejects malformed or inconsistent timezone pair %s/%s",
    (resolvedTimezone, timezoneConfidence) => {
      expect(() =>
        normalizeVenueReservationMetrics(
          {
            ...valid,
            resolved_timezone: resolvedTimezone,
            tz_confidence: timezoneConfidence,
          },
          BRAND,
          VENUE,
        ),
      ).toThrow(ReservationMetricsUnavailableError);
    },
  );

  it.each([
    ["Asia/Kolkata", "iana"],
    ["UTC", "iana"],
    ["GMT", "iana"],
    ["CET", "iana"],
    ["UTC+05:30", "offset"],
    ["UTC-03:30", "offset"],
    ["UTC", "utc"],
  ])(
    "accepts canonical timezone pair %s/%s",
    (resolvedTimezone, timezoneConfidence) => {
      const result = normalizeVenueReservationMetrics(
        {
          ...valid,
          resolved_timezone: resolvedTimezone,
          tz_confidence: timezoneConfidence,
        },
        BRAND,
        VENUE,
      );
      expect(result.resolvedTimezone).toBe(resolvedTimezone);
      expect(result.timezoneConfidence).toBe(timezoneConfidence);
    },
  );

  it.each([
    { ...valid, brand_id: "wrong" },
    { ...valid, venue_id: "wrong" },
    { ...valid, covers_30d: -1 },
    { ...valid, no_show_rate: 1.1 },
    { ...valid, value_cents_30d: { gbp: 100 } },
    {
      ...valid,
      authorized: false,
      covers_30d: 4,
      resolved_timezone: null,
      tz_confidence: null,
      by_source: [],
      value_cents_30d: {},
      value_cents_lifetime: {},
    },
    {
      ...valid,
      authorized: false,
      covers_30d: 0,
      covers_lifetime: 0,
      avg_party_size: 0,
      no_show_rate: 0,
      resolved_timezone: null,
      tz_confidence: null,
      by_source: [
        { source: "future_native_source", reservations: 999, covers: 999 },
      ],
      value_cents_30d: {},
      value_cents_lifetime: {},
    },
  ])("rejects wrong scope and malformed/unauthorized-as-data envelopes", (raw) => {
    expect(() => normalizeVenueReservationMetrics(raw, BRAND, VENUE)).toThrow(
      ReservationMetricsUnavailableError,
    );
  });
});
