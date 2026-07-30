import {
  BrandAnalyticsContractError,
  normalizeBrandCustomerPatternsRollup,
  normalizeBrandMinglaDroveRollup,
  normalizeBrandRegularsRollup,
} from "../brandAnalyticsService";

const BRAND_ID = "brand-874";

const sources = [
  { source: "direct", customers: 1, value_cents: { USD: 2500 } },
  { source: "organic", customers: 4, value_cents: {} },
  { source: "ad", customers: 3, value_cents: { GBP: 1200 } },
  { source: "social", customers: 2, value_cents: {} },
  { source: "search", customers: 1, value_cents: { EUR: 700 } },
];

const view = (
  state: "no_data" | "more_data_needed" | "no_clear_pattern" | "winner",
) => ({
  state,
  sample_commitments: state === "no_data" ? 0 : 12,
  distinct_dates: state === "no_data" ? 0 : 4,
  positive_buckets: state === "no_data" ? 0 : 2,
  winner:
    state === "winner"
      ? { key: "monday", label: "Monday", commitments: 8 }
      : null,
  buckets:
    state === "no_data"
      ? []
      : [
          { key: "monday", label: "Monday", commitments: 8 },
          { key: "tuesday", label: "Tuesday", commitments: 4 },
        ],
});

describe("issue #874 brand analytics service contract", () => {
  it("normalizes authoritative totals, keyed source order, and currencies without summing", () => {
    const result = normalizeBrandMinglaDroveRollup(
      {
        brand_id: BRAND_ID,
        authorized: true,
        mingla_drove_30d: 5,
        mingla_drove_lifetime: 9,
        value_cents_30d: { USD: 2500, GBP: 1200 },
        value_cents_lifetime: { EUR: 700 },
        by_source: sources,
        by_platform: [{ platform: "meta", customers: 999 }],
      },
      BRAND_ID,
    );
    expect(result.bySource.map((row) => row.source)).toEqual([
      "ad",
      "search",
      "organic",
      "social",
      "direct",
    ]);
    expect(result.minglaDroveLifetime).toBe(9);
    expect(result.valueCents30d).toEqual({ GBP: 1200, USD: 2500 });
    expect(result).not.toHaveProperty("byPlatform");
  });

  it("preserves an unauthorized envelope rather than coercing it to success", () => {
    expect(
      normalizeBrandMinglaDroveRollup(
        {
          brand_id: BRAND_ID,
          authorized: false,
          mingla_drove_30d: 0,
          mingla_drove_lifetime: 0,
          value_cents_30d: {},
          value_cents_lifetime: {},
          by_source: [],
        },
        BRAND_ID,
      ).authorized,
    ).toBe(false);
  });

  it("strips every disallowed regular field and renames visits truthfully", () => {
    const result = normalizeBrandRegularsRollup(
      {
        brand_id: BRAND_ID,
        authorized: true,
        regulars_count: 1,
        top_regulars: [
          {
            masked_contact: "s***@m***.com",
            visits: 4,
            listings: 3,
            first_seen: "private",
            last_seen: "private",
            lifetime_value_cents: { GBP: 999999 },
            raw_contact: "seth@example.com",
          },
        ],
      },
      BRAND_ID,
    );
    expect(result.topRegulars).toEqual([
      {
        maskedContact: "s***@m***.com",
        bookingsAndRsvps: 4,
        listings: 3,
      },
    ]);
    expect(JSON.stringify(result)).not.toContain("seth@example.com");
    expect(JSON.stringify(result)).not.toContain("lifetime");
  });

  it.each(["no_data", "more_data_needed", "no_clear_pattern", "winner"] as const)(
    "preserves the server-owned %s pattern state",
    (state) => {
      const result = normalizeBrandCustomerPatternsRollup(
        {
          brand_id: BRAND_ID,
          authorized: true,
          generated_at: "2026-07-30T00:00:00Z",
          window_days: 180,
          metric: "qualified_customer_commitments",
          days: view(state),
          dayparts: {
            ...view("more_data_needed"),
            buckets: [
              { key: "morning", label: "Morning", commitments: 8 },
              { key: "evening", label: "Evening", commitments: 4 },
            ],
          },
          types: {
            ...view("no_clear_pattern"),
            buckets: [
              { key: "event", label: "Event", commitments: 6 },
              { key: "trip", label: "Trip", commitments: 6 },
            ],
          },
        },
        BRAND_ID,
      );
      expect(result.days.state).toBe(state);
      expect(result.days.winner?.label ?? null).toBe(
        state === "winner" ? "Monday" : null,
      );
    },
  );

  it.each([
    null,
    {},
    { brand_id: "wrong" },
    {
      brand_id: BRAND_ID,
      authorized: true,
      mingla_drove_30d: -1,
      mingla_drove_lifetime: 0,
      value_cents_30d: {},
      value_cents_lifetime: {},
      by_source: sources,
    },
    {
      brand_id: BRAND_ID,
      authorized: true,
      mingla_drove_30d: 0,
      mingla_drove_lifetime: 0,
      value_cents_30d: { usd: 100 },
      value_cents_lifetime: {},
      by_source: sources,
    },
    {
      brand_id: BRAND_ID,
      authorized: true,
      mingla_drove_30d: 0,
      mingla_drove_lifetime: 0,
      value_cents_30d: {},
      value_cents_lifetime: {},
      by_source: sources.slice(1),
    },
  ])("rejects malformed totals instead of manufacturing empty data", (raw) => {
    expect(() => normalizeBrandMinglaDroveRollup(raw, BRAND_ID)).toThrow(
      BrandAnalyticsContractError,
    );
  });
});
