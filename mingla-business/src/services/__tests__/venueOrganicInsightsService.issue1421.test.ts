import {
  normalizeVenueOrganicInsights,
  VenueOrganicInsightsUnavailableError,
} from "../venueOrganicInsightsService";

const brandId = "11111111-1111-4111-8111-111111111111";
const venueId = "22222222-2222-4222-8222-222222222222";

const row = {
  brand_id: brandId,
  venue_id: venueId,
  authorized: true,
  page_views: 9,
  menu_opens: 3,
  reservation_starts: 2,
  availability_shown: 2,
  reservations_made: 1,
  dayparts: { morning: 2, afternoon: 3, evening: 1, late_night: 3 },
  menu_published: true,
  reservations_enabled: true,
  capture_started_at: "2026-07-30T20:00:00.000Z",
  window_complete: false,
  aggregated_at: "2026-07-30T21:00:00.000Z",
  resolved_timezone: "America/New_York",
  tz_confidence: "iana",
};

describe("#1421 venue organic insights normalization", () => {
  it("keeps exact venue scope and server-owned dayparts", () => {
    const result = normalizeVenueOrganicInsights(row, brandId, venueId);
    expect(result.authorized).toBe(true);
    expect(result.pageViews).toBe(9);
    expect(result.dayparts).toEqual({
      morning: 2,
      afternoon: 3,
      evening: 1,
      lateNight: 3,
    });
    expect(result.windowComplete).toBe(false);
  });

  it("returns only a safe denial envelope for unauthorized scope", () => {
    const result = normalizeVenueOrganicInsights(
      { brand_id: brandId, venue_id: venueId, authorized: false },
      brandId,
      venueId,
    );
    expect(result).toMatchObject({
      brandId,
      venueId,
      authorized: false,
      pageViews: 0,
      reservationsMade: 0,
    });
  });

  it("rejects cross-venue and malformed aggregate data", () => {
    expect(() =>
      normalizeVenueOrganicInsights(
        { ...row, venue_id: "33333333-3333-4333-8333-333333333333" },
        brandId,
        venueId,
      )
    ).toThrow(VenueOrganicInsightsUnavailableError);
    expect(() =>
      normalizeVenueOrganicInsights(
        { ...row, page_views: -1 },
        brandId,
        venueId,
      )
    ).toThrow(VenueOrganicInsightsUnavailableError);
  });
});
