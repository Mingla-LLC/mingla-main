const nativeCapture = jest.fn();
const webCapture = jest.fn();

jest.mock("../../services/postHogService", () => ({
  postHogService: { capture: (...args: unknown[]) => nativeCapture(...args) },
}));
jest.mock("../webAnalytics", () => ({
  captureWeb: (...args: unknown[]) => webCapture(...args),
}));

import {
  captureBusinessListingInsightsOpened,
  captureBusinessListingInsightsRefreshed,
  captureBusinessVenueReservationsRefreshed,
  captureBusinessVenueReservationsViewed,
  sanitizeBusinessListingInsightsEntryPoint,
} from "../businessAnalyticsEvents";

describe("issue #1403 privacy-minimized analytics", () => {
  beforeEach(() => {
    nativeCapture.mockClear();
    webCapture.mockClear();
  });

  it("accepts only the exact safe listing entry metadata", () => {
    expect(sanitizeBusinessListingInsightsEntryPoint("detail_action")).toBe(
      "detail_action",
    );
    expect(sanitizeBusinessListingInsightsEntryPoint("listing-secret")).toBe(
      "direct",
    );
    expect(sanitizeBusinessListingInsightsEntryPoint(["detail_action"])).toBe(
      "direct",
    );
  });

  it("emits only the approved listing-open property allowlist", () => {
    captureBusinessListingInsightsOpened("experience", "detail_action", true);
    const [name, properties] = nativeCapture.mock.calls[0];
    expect(name).toBe("business_listing_insights_opened");
    expect(Object.keys(properties).sort()).toEqual([
      "entry_point",
      "has_customers",
      "listing_type",
      "platform",
    ]);
    expect(webCapture).toHaveBeenCalledWith(name, properties);
  });

  it("emits only result/platform for refresh and boolean/platform for venue view", () => {
    captureBusinessListingInsightsRefreshed("rsvp", "error");
    captureBusinessVenueReservationsViewed(true);
    captureBusinessVenueReservationsRefreshed("success");
    expect(nativeCapture.mock.calls.map((call) => call[0])).toEqual([
      "business_listing_insights_refreshed",
      "business_venue_reservations_viewed",
      "business_venue_reservations_refreshed",
    ]);
    for (const [, properties] of nativeCapture.mock.calls) {
      expect(JSON.stringify(properties)).not.toMatch(
        /brand|venue_id|listing_id|name|count|amount|source|rate|route|error_text/,
      );
    }
  });
});
