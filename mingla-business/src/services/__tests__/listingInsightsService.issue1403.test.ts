import {
  ListingInsightsUnavailableError,
  normalizeListingInsightsIdentity,
  normalizeListingInsightsRollup,
} from "../listingInsightsService";

const ID = "listing-1403";

const sources = [
  { source: "direct", customers: 1, value_cents: {} },
  { source: "organic", customers: 2, value_cents: { GBP: 1200 } },
  { source: "ad", customers: 1, value_cents: { USD: 2500 } },
  { source: "social", customers: 0, value_cents: {} },
  { source: "search", customers: 0, value_cents: {} },
];

describe("issue #1403 listing insights service", () => {
  it("normalizes canonical identity and always returns a non-editor detail route", () => {
    expect(
      normalizeListingInsightsIdentity(
        {
          id: ID,
          brand_id: "brand-1403",
          title: "Summer Table",
          event_type: "trip",
          status: "draft",
        },
        ID,
      ),
    ).toEqual({
      id: ID,
      brandId: "brand-1403",
      title: "Summer Table",
      listingType: "trip",
      status: "draft",
      detailRoute: `/trip/${ID}`,
    });
  });

  it("uses the server total, canonical source-key order and strips by_platform", () => {
    const result = normalizeListingInsightsRollup(
      {
        event_id: ID,
        authorized: true,
        mingla_drove_count: 2,
        value_cents: { USD: 2500, GBP: 1200 },
        by_source: sources,
        by_platform: [{ platform: "meta", customers: 99 }],
        customer_id: "forbidden",
      },
      ID,
    );
    expect(result.minglaDroveCount).toBe(2);
    expect(result.bySource.map((row) => row.source)).toEqual([
      "ad",
      "search",
      "organic",
      "social",
      "direct",
    ]);
    expect(result.valueCents).toEqual({ GBP: 1200, USD: 2500 });
    expect(JSON.stringify(result)).not.toMatch(/platform|customer_id|forbidden/);
  });

  it("preserves a truthful free-RSVP count without fabricating currency", () => {
    const result = normalizeListingInsightsRollup(
      {
        event_id: ID,
        authorized: true,
        mingla_drove_count: 1,
        value_cents: {},
        by_source: sources.map((source) => ({
          ...source,
          customers: source.source === "organic" ? 1 : 0,
          value_cents: {},
        })),
      },
      ID,
    );
    expect(result.minglaDroveCount).toBe(1);
    expect(result.valueCents).toEqual({});
  });

  it.each([
    null,
    { id: "wrong", brand_id: "brand", title: "x", event_type: "event", status: "live" },
    { id: ID, brand_id: "brand", title: "", event_type: "event", status: "live" },
    { id: ID, brand_id: "brand", title: "x", event_type: "venue", status: "live" },
  ])("rejects malformed/forged identity", (raw) => {
    expect(() => normalizeListingInsightsIdentity(raw, ID)).toThrow(
      ListingInsightsUnavailableError,
    );
  });

  it.each([
    null,
    {
      event_id: "wrong",
      authorized: true,
      mingla_drove_count: 0,
      value_cents: {},
      by_source: sources,
    },
    {
      event_id: ID,
      authorized: true,
      mingla_drove_count: 0,
      value_cents: {},
      by_source: sources.slice(1),
    },
    {
      event_id: ID,
      authorized: true,
      mingla_drove_count: -1,
      value_cents: {},
      by_source: sources,
    },
    {
      event_id: ID,
      authorized: false,
      mingla_drove_count: 1,
      value_cents: {},
      by_source: [],
    },
  ])("rejects malformed, wrong-ID, and dishonest unauthorized envelopes", (raw) => {
    expect(() => normalizeListingInsightsRollup(raw, ID)).toThrow(
      ListingInsightsUnavailableError,
    );
  });
});
