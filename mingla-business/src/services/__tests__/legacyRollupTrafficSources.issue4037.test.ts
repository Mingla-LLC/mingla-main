import { normalizeBrandMinglaDroveRollup } from "../brandAnalyticsService";
import { normalizeListingInsightsRollup } from "../listingInsightsService";

const SOURCES = [
  "mingla_app",
  "mingla_ads",
  "search",
  "social",
  "own_links",
  "direct_unknown",
] as const;

const rows = SOURCES.map((source, index) => ({
  source,
  customers: index,
  value_cents: index === 0 ? { GBP: 1_500 } : {},
}));

describe("#4037 relabelled conversion rollups", () => {
  it("accepts all six traffic buckets from brand_mingla_drove_rollup", () => {
    const normalized = normalizeBrandMinglaDroveRollup(
      {
        brand_id: "brand-4037",
        authorized: true,
        mingla_drove_30d: 2,
        mingla_drove_lifetime: 5,
        value_cents_30d: { GBP: 1_500 },
        value_cents_lifetime: { GBP: 1_500 },
        by_source: rows,
      },
      "brand-4037",
    );

    expect(normalized.bySource.map(({ source }) => source)).toEqual(SOURCES);
  });

  it("accepts the same six buckets from entity_conversion_rollup", () => {
    const normalized = normalizeListingInsightsRollup(
      {
        event_id: "event-4037",
        authorized: true,
        mingla_drove_count: 2,
        value_cents: { GBP: 1_500 },
        by_source: rows,
      },
      "event-4037",
    );

    expect(normalized.bySource.map(({ source }) => source)).toEqual(SOURCES);
  });
});
