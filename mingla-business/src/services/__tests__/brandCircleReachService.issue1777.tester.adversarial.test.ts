import { beforeEach, describe, expect, jest, test } from "@jest/globals";

const rpc = jest.fn<(...args: unknown[]) => Promise<{ data: unknown; error: { message?: string } | null }>>();
const report = jest.fn();
jest.mock("../supabase", () => ({ supabase: { rpc: (...args: unknown[]) => rpc(...args) } }));
jest.mock("../../diagnostics/reportNonFatal", () => ({ reportNonFatal: (...args: unknown[]) => report(...args) }));

import { BrandCircleReachError, listBrandCircleReach, parseBrandCircleReach } from "../brandCircleReachService";

const availability = {
  followers: { state: "ready", reason: null, refreshedAt: "2026-09-11T12:00:00Z", expiresAt: "2026-09-11T12:05:00Z" },
  extended: { state: "unavailable", reason: "controls_not_live", refreshedAt: null, expiresAt: null },
};
const row = { memberId: "17770000-0000-4000-8000-000000000010", ring: "follower", displayName: "Amina Cole", avatarUrl: null, reasonCode: "follows_brand", reasonLabel: "Follows your brand." };
const page = { schemaVersion: 1, state: "partial", snapshotVersion: 7, counts: { followers: 1, extended: null, total: null }, availability, rows: [row], nextCursor: null };

beforeEach(() => { rpc.mockReset(); report.mockReset(); });

describe("#1777 tester adversarial service boundary", () => {
  test("stale cursor is the only retryable stable cursor error", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: "circle_cursor_stale: generation changed" } });
    await expect(listBrandCircleReach({ brandId: "brand-a", ring: "all", cursor: null, limit: 50 })).rejects.toEqual(expect.objectContaining({ code: "circle_cursor_stale", retryable: true }));
    rpc.mockResolvedValueOnce({ data: null, error: { message: "circle_cursor_invalid: malformed" } });
    await expect(listBrandCircleReach({ brandId: "brand-a", ring: "all", cursor: null, limit: 50 })).rejects.toEqual(expect.objectContaining({ code: "circle_cursor_invalid", retryable: false }));
  });

  test("unavailable cannot smuggle snapshot, cursor, rows, or counts", () => {
    expect(() => parseBrandCircleReach({ ...page, state: "unavailable", snapshotVersion: 7 })).toThrow(BrandCircleReachError);
    expect(() => parseBrandCircleReach({ ...page, state: "unavailable", rows: [{ ...row }], counts: { followers: 1, extended: null, total: null }, snapshotVersion: null })).toThrow(BrandCircleReachError);
    expect(() => parseBrandCircleReach({ ...page, state: "unavailable", nextCursor: { snapshotVersion: 7, ringOrder: 2, sortName: "amina", memberId: row.memberId }, snapshotVersion: null })).toThrow(BrandCircleReachError);
  });

  test("malformed payload reporting contains only the coarse feature/code", () => {
    expect(() => parseBrandCircleReach({ ...page, rows: [{ ...row, displayName: "A".repeat(121) }] })).toThrow(BrandCircleReachError);
    expect(report).toHaveBeenCalledTimes(1);
    expect(report.mock.calls[0]).toEqual(["brand-circle-reach-malformed", expect.any(Error), { feature: "brand-circle-reach", code: "circle_temporarily_unavailable" }]);
    expect(JSON.stringify(report.mock.calls[0])).not.toMatch(/17770000|brand-a/);
  });
});
