const rpc = jest.fn();
const reportNonFatal = jest.fn();

jest.mock("../supabase", () => ({ supabase: { rpc } }));
jest.mock("../../diagnostics/reportNonFatal", () => ({ reportNonFatal }));

import { getBrandCircleReachSummary } from "../brandCircleReachSummaryService";

const response = {
  schemaVersion: 1,
  state: "partial",
  snapshotVersion: 9,
  counts: { followers: 42, extended: null, total: null },
  availability: {
    followers: {
      state: "ready",
      reason: null,
      refreshedAt: "2026-09-14T00:00:00.000Z",
      expiresAt: "2026-09-14T00:05:00.000Z",
    },
    extended: {
      state: "unavailable",
      reason: "controls_not_live",
      refreshedAt: null,
      expiresAt: null,
    },
  },
  rows: [
    {
      memberId: "member-1",
      ring: "follower",
      displayName: "Visible name",
      avatarUrl: null,
      reasonCode: "follows_brand",
      reasonLabel: "Follows your brand.",
    },
  ],
  nextCursor: null,
};

describe("#1778 on-demand circle summary", () => {
  beforeEach(() => {
    rpc.mockReset();
    reportNonFatal.mockReset();
  });

  test("requests one privacy-safe aggregate page and discards roster rows", async () => {
    rpc.mockResolvedValue({ data: response, error: null });
    await expect(getBrandCircleReachSummary("brand-1")).resolves.toEqual({
      state: "partial",
      counts: { followers: 42, extended: null, total: null },
      availability: response.availability,
    });
    expect(rpc).toHaveBeenCalledWith("get_brand_circle_reach", {
      p_brand_id: "brand-1",
      p_ring: "all",
      p_cursor: null,
      p_limit: 1,
    });
  });

  test("fails closed when the summary envelope grows an unowned field", async () => {
    rpc.mockResolvedValue({
      data: { ...response, contactDetails: ["forbidden@example.test"] },
      error: null,
    });
    await expect(getBrandCircleReachSummary("brand-1")).rejects.toThrow(
      "circle_temporarily_unavailable",
    );
    expect(reportNonFatal).toHaveBeenCalledWith(
      "brand-circle-reach-summary-malformed",
      expect.any(Error),
      expect.objectContaining({ code: "circle_temporarily_unavailable" }),
    );
  });
});
