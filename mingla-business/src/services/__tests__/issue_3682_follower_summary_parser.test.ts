const mockRpc = jest.fn();

jest.mock("../supabase", () => ({
  supabase: { rpc: mockRpc },
}));

import {
  brandFollowerCountService,
  parseBrandFollowerSummary,
} from "../brandFollowerCountService";

const valid = {
  schemaVersion: 1,
  total: 1204,
  newThisWeek: 38,
  sourcesThisWeek: {
    checkout: 29,
    brandPage: 7,
    emailInvite: 2,
    other: 0,
  },
  trend: [1100, 1119, 1138, 1155, 1172, 1190, 1204],
  asOf: "2026-10-22T12:00:00.000Z",
};

describe("#3682 follower summary parser", () => {
  beforeEach(() => mockRpc.mockReset());

  test("accepts the exact v1 envelope", () => {
    expect(parseBrandFollowerSummary(valid)).toEqual(valid);
  });

  test.each([
    ["extra key", { ...valid, secret: "no" }],
    ["six trend points", { ...valid, trend: valid.trend.slice(0, 6) }],
    ["last point differs", { ...valid, trend: [...valid.trend.slice(0, 6), 1203] }],
    ["source sum differs", { ...valid, sourcesThisWeek: { ...valid.sourcesThisWeek, other: 1 } }],
  ])("rejects %s", (_label, payload) => {
    expect(() => parseBrandFollowerSummary(payload)).toThrow(
      "follower_summary_malformed",
    );
  });

  test("rejects malformed scalar and batch count responses", async () => {
    mockRpc.mockResolvedValueOnce({ data: -1, error: null });
    await expect(brandFollowerCountService.getCount("brand-a")).rejects.toThrow(
      "follower_count_malformed",
    );

    mockRpc.mockResolvedValueOnce({
      data: [{ brand_id: "brand-a", follower_count: 2, extra: true }],
      error: null,
    });
    await expect(
      brandFollowerCountService.getCounts(["brand-a"]),
    ).rejects.toThrow("brand_follower_counts_malformed");
  });

  test("rejects a row leaked from a different 100-brand batch", async () => {
    const ids = Array.from(
      { length: 101 },
      (_, index) => `brand-${String(index).padStart(3, "0")}`,
    );
    mockRpc.mockResolvedValueOnce({
      data: [{ brand_id: ids[100], follower_count: 7 }],
      error: null,
    });

    await expect(brandFollowerCountService.getCounts(ids)).rejects.toThrow(
      "brand_follower_counts_malformed",
    );
    expect(mockRpc).toHaveBeenCalledTimes(1);
  });
});
