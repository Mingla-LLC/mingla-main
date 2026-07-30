const useQueryMock = jest.fn((options: Record<string, unknown>) => options);

jest.mock("@tanstack/react-query", () => ({
  useQuery: (options: Record<string, unknown>) => useQueryMock(options),
}));

import {
  useVenueReservationMetrics,
  venueReservationMetricsKeys,
} from "../useVenueReservationMetrics";

describe("issue #1403 venue reservation auth-ready keys", () => {
  beforeEach(() => useQueryMock.mockClear());

  it("includes both brand and venue in the cache identity", () => {
    useVenueReservationMetrics("brand-a", "venue-a", true);
    expect(useQueryMock.mock.calls[0][0].queryKey).toEqual(
      venueReservationMetricsKeys.detail("brand-a", "venue-a"),
    );
  });

  it.each([
    { brand: null, venue: "venue-a", ready: true },
    { brand: "brand-a", venue: null, ready: true },
    { brand: "brand-a", venue: "venue-a", ready: false },
  ])("never executes before complete authenticated scope", (input) => {
    useVenueReservationMetrics(input.brand, input.venue, input.ready);
    expect(useQueryMock.mock.calls[0][0].enabled).toBe(false);
    expect(useQueryMock.mock.calls[0][0].queryKey).toEqual(
      venueReservationMetricsKeys.disabled,
    );
  });

  it("switches venue keys without placeholder leakage", () => {
    useVenueReservationMetrics("brand-a", "venue-a", true);
    useVenueReservationMetrics("brand-a", "venue-b", true);
    expect(useQueryMock.mock.calls[0][0].queryKey).not.toEqual(
      useQueryMock.mock.calls[1][0].queryKey,
    );
    expect(useQueryMock.mock.calls[1][0]).not.toHaveProperty("placeholderData");
  });
});
