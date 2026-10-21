/**
 * #4037 — Seth's decisions (comment 6325156309) on the Business client:
 *  4. every page request names its brand (`p_brand_id`), and an answer about
 *     another brand is refused;
 *  5. view taps (brand / venue / offering) are engagement and must reconcile
 *     into Button taps;
 *  7. a decline keeps its sign and uses the neutral treatment, never hidden.
 */
import {
  fetchEntityTrafficRollup,
  normalizeEntityTrafficRollup,
  TRAFFIC_CTA_TYPES,
} from "../trafficAnalyticsService";
import {
  formatTrafficDelta,
  trafficDeltaAccessibilityLabel,
  trafficDeltaTone,
  visibleDelta,
} from "../../utils/trafficAnalyticsMath";

const mockRpc = jest.fn();
jest.mock("../supabase", () => ({
  supabase: { rpc: (...args: unknown[]) => mockRpc(...args) },
}));

const BRAND_ID = "40370000-0000-4000-8000-0000000000b1";
const OTHER_BRAND_ID = "40370000-0000-4000-8000-0000000000b2";
const EVENT_ID = "40370000-0000-4000-8000-0000000000e1";

const zeroTotals = {
  page_views: 0,
  visitors: 0,
  button_taps: 0,
  checkout_starts: 0,
  bookings: 0,
  customers: 0,
  mingla_customers: 0,
  mingla_visitors: 0,
  booking_value: {},
  value_mingla_brought: {},
  primary_currency: "GBP",
};

const sources = [
  "mingla_app",
  "mingla_ads",
  "search",
  "social",
  "own_links",
  "direct_unknown",
].map((source) => ({
  source,
  visitors: 0,
  bookings: 0,
  value_by_currency: {},
}));

const rollup = (
  brandId: string,
  ctaCounts: Record<string, number>,
  buttonTaps: number,
) => ({
  brand_id: brandId,
  entity_type: "event",
  entity_id: EVENT_ID,
  authorized: true,
  range: "30d",
  totals: { ...zeroTotals, button_taps: buttonTaps },
  prior: zeroTotals,
  daily: [{ day: "2027-01-15", page_views: 0 }],
  sources,
  ctas: TRAFFIC_CTA_TYPES.map((type) => ({
    type,
    count: ctaCounts[type] ?? 0,
  })),
  capture_started_at: "2027-01-01T00:00:00.000Z",
  window_complete: false,
});

describe("#4037 decision 4 — page detail is requested for a named brand", () => {
  beforeEach(() => mockRpc.mockReset());

  it("sends p_brand_id with every entity request, including the brand page", async () => {
    mockRpc.mockResolvedValueOnce({
      data: {
        ...rollup(BRAND_ID, {}, 0),
        entity_type: "brand",
        entity_id: null,
      },
      error: null,
    });
    await fetchEntityTrafficRollup(BRAND_ID, "brand", null, "30d");
    expect(mockRpc).toHaveBeenCalledWith("entity_traffic_rollup", {
      p_brand_id: BRAND_ID,
      p_entity_type: "brand",
      p_entity_id: null,
      p_range: "30d",
    });
  });

  it("refuses an answer about a different brand", () => {
    expect(() =>
      normalizeEntityTrafficRollup(
        rollup(OTHER_BRAND_ID, {}, 0),
        BRAND_ID,
        "event",
        EVENT_ID,
        "30d",
      ),
    ).toThrow("entity_traffic_rollup returned an invalid contract");
    expect(
      normalizeEntityTrafficRollup(
        rollup(BRAND_ID, {}, 0),
        BRAND_ID,
        "event",
        EVENT_ID,
        "30d",
      ).brandId,
    ).toBe(BRAND_ID);
  });
});

describe("#4037 decision 5 — view taps are engagement", () => {
  it("lists the three view taps and counts them in Button taps", () => {
    expect(TRAFFIC_CTA_TYPES).toEqual(
      expect.arrayContaining(["view_brand", "view_venue", "view_offering"]),
    );
    const result = normalizeEntityTrafficRollup(
      rollup(BRAND_ID, { buy: 2, view_brand: 3, view_offering: 1 }, 6),
      BRAND_ID,
      "event",
      EVENT_ID,
      "30d",
    );
    expect(result.totals.buttonTaps).toBe(6);
    expect(result.ctas.filter((row) => row.type.startsWith("view_"))).toEqual([
      { type: "view_brand", count: 3 },
      { type: "view_venue", count: 0 },
      { type: "view_offering", count: 1 },
    ]);
  });

  it("fails closed when the server omits the view taps", () => {
    const legacy = rollup(BRAND_ID, {}, 0);
    expect(() =>
      normalizeEntityTrafficRollup(
        {
          ...legacy,
          ctas: legacy.ctas.filter((row) => !row.type.startsWith("view_")),
        },
        BRAND_ID,
        "event",
        EVENT_ID,
        "30d",
      ),
    ).toThrow("entity_traffic_rollup returned an invalid contract");
  });
});

describe("#4037 decision 7 — declines are shown, neutrally", () => {
  it("keeps the sign of a decline above the thresholds and uses the neutral tone", () => {
    const delta = visibleDelta(80, 100, 40, 40, 30);
    expect(delta).toBe(-20);
    expect(formatTrafficDelta(delta as number)).toBe("-20.0%");
    expect(trafficDeltaTone(delta as number)).toBe("neutral");
    expect(trafficDeltaAccessibilityLabel(delta as number)).toBe(
      "Down 20 percent versus prior period",
    );
  });

  it("only a rise uses the positive tone", () => {
    expect(trafficDeltaTone(12.5)).toBe("positive");
    expect(formatTrafficDelta(12.5)).toBe("+12.5%");
    expect(trafficDeltaTone(0)).toBe("neutral");
    expect(formatTrafficDelta(0)).toBe("0.0%");
  });
});
