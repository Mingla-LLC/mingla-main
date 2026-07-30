const useQueryMock = jest.fn((options: Record<string, unknown>) => ({
  ...options,
  data:
    Array.isArray(options.queryKey) && options.queryKey[2] === "identity"
      ? { id: "listing-a" }
      : undefined,
}));

jest.mock("@tanstack/react-query", () => ({
  useQuery: (options: Record<string, unknown>) => useQueryMock(options),
}));

import {
  listingInsightsKeys,
  useListingInsights,
} from "../useListingInsights";

describe("issue #1403 listing insights auth-ready keys", () => {
  beforeEach(() => useQueryMock.mockClear());

  it("keys identity and aggregate by the exact listing ID", () => {
    useListingInsights("listing-a", true, true);
    expect(useQueryMock.mock.calls[0][0].queryKey).toEqual(
      listingInsightsKeys.identity("listing-a"),
    );
    expect(useQueryMock.mock.calls[1][0].queryKey).toEqual(
      listingInsightsKeys.rollup("listing-a"),
    );
  });

  it.each([
    { ready: false, allowed: true, id: "listing-a" },
    { ready: true, allowed: false, id: "listing-a" },
    { ready: true, allowed: true, id: null },
  ])("keeps identity and rollup disabled until every gate settles", (input) => {
    useListingInsights(input.id, input.ready, input.allowed);
    expect(useQueryMock.mock.calls[0][0].enabled).toBe(false);
    expect(useQueryMock.mock.calls[1][0].enabled).toBe(false);
  });

  it("does not carry placeholder data across listing IDs", () => {
    useListingInsights("listing-a", true, true);
    useListingInsights("listing-b", true, true);
    expect(useQueryMock.mock.calls[0][0]).not.toHaveProperty("placeholderData");
    expect(useQueryMock.mock.calls[2][0].queryKey).toEqual(
      listingInsightsKeys.identity("listing-b"),
    );
  });
});
