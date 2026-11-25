const mockRpc = jest.fn();

jest.mock("../supabase", () => ({
  supabase: { rpc: (...args: unknown[]) => mockRpc(...args) },
}));

import { fetchVenueIntelligence } from "../venueIntelligenceService";

describe("#1493 shared Venue Overview intelligence service", () => {
  beforeEach(() => mockRpc.mockReset());

  test("web, iOS and Android use the same venue-scoped RPC read", async () => {
    mockRpc.mockResolvedValueOnce({
      data: {
        resolved_timezone: "Africa/Lagos",
        tz_confidence: "iana",
        brand_default_currency: "NGN",
        order_count: 0,
        hours: [],
        days: [],
        revenue_trend: { currency: "NGN", days: [] },
        revenue_by_currency: {},
        rev7d_by_currency: {},
        signal_scores: [],
      },
      error: null,
    });

    const result = await fetchVenueIntelligence("brand-1493", "venue-1493");

    expect(mockRpc).toHaveBeenCalledWith("venue_intelligence_overview", {
      p_brand_id: "brand-1493",
      p_venue_id: "venue-1493",
    });
    expect(result).toMatchObject({
      resolvedTimezone: "Africa/Lagos",
      brandDefaultCurrency: "NGN",
      orderCount: 0,
    });
    expect(result.hours).toHaveLength(24);
    expect(result.days).toHaveLength(7);
  });

  test("still surfaces a server authorization refusal instead of inventing empties", async () => {
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { message: "not authorized for brand brand-1493" },
    });

    await expect(fetchVenueIntelligence("brand-1493", "venue-1493")).rejects.toThrow(
      "venue_intelligence_overview failed: not authorized for brand brand-1493",
    );
  });
});
