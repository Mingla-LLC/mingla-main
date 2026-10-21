import {
  normalizeBrandTrafficRollup,
  normalizeEntityTrafficRollup,
} from "../trafficAnalyticsService";
import { visibleDelta } from "../../utils/trafficAnalyticsMath";

const BRAND_ID = "11111111-1111-4111-8111-111111111111";
const EVENT_ID = "22222222-2222-4222-8222-222222222222";

const totals = (pageViews: number, bookings: number) => ({
  page_views: pageViews,
  visitors: pageViews === 0 ? 0 : 22,
  button_taps: pageViews === 0 ? 0 : 8,
  checkout_starts: pageViews === 0 ? 0 : 4,
  bookings,
  customers: bookings,
  mingla_customers: bookings,
  mingla_visitors: pageViews === 0 ? 0 : 12,
  booking_value: bookings === 0 ? {} : { GBP: 4500 },
  value_mingla_brought: bookings === 0 ? {} : { GBP: 4500 },
  primary_currency: bookings === 0 ? null : "GBP",
});

const sources = [
  "mingla_app",
  "mingla_ads",
  "search",
  "social",
  "own_links",
  "direct_unknown",
].map((source, index) => ({
  source,
  visitors: index === 0 ? 22 : 0,
  bookings: index === 0 ? 3 : 0,
  value_by_currency: index === 0 ? { GBP: 4500 } : {},
}));

const ctas = [
  "buy",
  "book",
  "rsvp",
  "share",
  "save",
  "directions",
  "website",
  "call",
  "view_brand",
  "view_venue",
  "view_offering",
].map((type, index) => ({ type, count: index === 0 ? 8 : 0 }));

const base = {
  authorized: true,
  range: "30d",
  totals: totals(30, 3),
  prior: totals(40, 5),
  daily: [
    { day: "2026-10-20", page_views: 12 },
    { day: "2026-10-21", page_views: 18 },
  ],
  sources,
  ctas,
  capture_started_at: "2026-10-01T00:00:00.000Z",
  window_complete: false,
};

describe("#4037 traffic analytics contract", () => {
  it("normalizes the strict brand rollup and preserves source order", () => {
    const result = normalizeBrandTrafficRollup(
      {
        ...base,
        brand_id: BRAND_ID,
        pages: [
          {
            entity_type: "event",
            entity_id: EVENT_ID,
            title: "Autumn supper",
            page_views: 30,
            visitors: 22,
            cta_total: 8,
            checkout_starts: 4,
            bookings: 3,
            value_by_currency: { GBP: 4500 },
          },
        ],
      },
      BRAND_ID,
      "30d",
    );

    expect(result.totals.pageViews).toBe(30);
    expect(result.sources.map((row) => row.source)).toEqual([
      "mingla_app",
      "mingla_ads",
      "search",
      "social",
      "own_links",
      "direct_unknown",
    ]);
    expect(result.pages[0]).toMatchObject({
      entityId: EVENT_ID,
      title: "Autumn supper",
      valueByCurrency: { GBP: 4500 },
    });
  });

  it("fails closed when daily traffic does not reconcile to the total", () => {
    expect(() =>
      normalizeEntityTrafficRollup(
        {
          ...base,
          brand_id: BRAND_ID,
          entity_type: "event",
          entity_id: EVENT_ID,
          daily: [{ day: "2026-10-21", page_views: 29 }],
        },
        BRAND_ID,
        "event",
        EVENT_ID,
        "30d",
      ),
    ).toThrow("entity_traffic_rollup returned an invalid contract");
  });

  it("fails closed when source bookings, value or CTA totals do not reconcile", () => {
    const entity = {
      ...base,
      brand_id: BRAND_ID,
      entity_type: "event",
      entity_id: EVENT_ID,
    };
    for (const inconsistent of [
      {
        ...entity,
        sources: sources.map((row, index) =>
          index === 0 ? { ...row, bookings: 4 } : row,
        ),
      },
      {
        ...entity,
        sources: sources.map((row, index) =>
          index === 0 ? { ...row, value_by_currency: { GBP: 4_499 } } : row,
        ),
      },
      {
        ...entity,
        ctas: ctas.map((row, index) =>
          index === 0 ? { ...row, count: 7 } : row,
        ),
      },
    ]) {
      expect(() =>
        normalizeEntityTrafficRollup(
          inconsistent,
          BRAND_ID,
          "event",
          EVENT_ID,
          "30d",
        ),
      ).toThrow("entity_traffic_rollup returned an invalid contract");
    }
  });

  it("requires honest-empty unauthorized results", () => {
    expect(() =>
      normalizeBrandTrafficRollup(
        {
          ...base,
          brand_id: BRAND_ID,
          authorized: false,
          pages: [],
        },
        BRAND_ID,
        "30d",
      ),
    ).toThrow("brand_traffic_rollup returned an invalid contract");
  });

  it("hides deltas below both contract thresholds", () => {
    expect(visibleDelta(40, 20, 29, 100, 30)).toBeNull();
    expect(visibleDelta(40, 20, 100, 29, 30)).toBeNull();
    expect(visibleDelta(4_500, 3_000, 4, 8, 5)).toBeNull();
    expect(visibleDelta(4_500, 3_000, 8, 4, 5)).toBeNull();
    expect(visibleDelta(4_500, 3_000, 8, 8, 5)).toBe(50);
  });
});
