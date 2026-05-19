import {
  checkClaimSearchRateLimit,
  normalizeClaimSearchBody,
} from "../claimSearchPoolLogic";

describe("claimSearchPoolLogic", () => {
  test("normalizeClaimSearchBody rejects short query", () => {
    expect(normalizeClaimSearchBody({ query: "ab" })).toEqual({
      ok: false,
      error: "query_too_short",
    });
  });

  test("normalizeClaimSearchBody clamps limit", () => {
    const r = normalizeClaimSearchBody({ query: "pizza", limit: 99 });
    expect(r).toEqual({ ok: true, query: "pizza", limit: 5 });
  });

  test("checkClaimSearchRateLimit blocks after 10 per minute", () => {
    const buckets = new Map<string, number[]>();
    const uid = "u1";
    const t0 = 1_700_000_000_000;
    for (let i = 0; i < 10; i++) {
      expect(checkClaimSearchRateLimit(uid, buckets, t0 + i)).toBe(true);
    }
    expect(checkClaimSearchRateLimit(uid, buckets, t0 + 10)).toBe(false);
  });
});
