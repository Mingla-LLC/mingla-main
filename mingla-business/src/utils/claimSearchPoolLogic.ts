/**
 * Ve2 — pure helpers mirrored from claim-search-pool edge function (jest-testable).
 */

export const CLAIM_SEARCH_MIN_QUERY_LENGTH = 3;
export const CLAIM_SEARCH_DEFAULT_LIMIT = 1;
export const CLAIM_SEARCH_MAX_LIMIT = 5;
export const CLAIM_SEARCH_RATE_LIMIT_WINDOW_MS = 60_000;
export const CLAIM_SEARCH_RATE_LIMIT_MAX = 10;

export function normalizeClaimSearchBody(
  body: unknown,
):
  | { ok: true; query: string; limit: number }
  | { ok: false; error: string } {
  if (body === null || typeof body !== "object") {
    return { ok: false, error: "invalid_json" };
  }
  const b = body as Record<string, unknown>;
  const query = typeof b.query === "string" ? b.query.trim() : "";
  if (query.length < CLAIM_SEARCH_MIN_QUERY_LENGTH) {
    return { ok: false, error: "query_too_short" };
  }
  let limit = CLAIM_SEARCH_DEFAULT_LIMIT;
  if (typeof b.limit === "number" && Number.isFinite(b.limit)) {
    limit = Math.max(
      1,
      Math.min(Math.floor(b.limit), CLAIM_SEARCH_MAX_LIMIT),
    );
  }
  return { ok: true, query, limit };
}

export function checkClaimSearchRateLimit(
  userId: string,
  buckets: Map<string, number[]>,
  now = Date.now(),
): boolean {
  const windowStart = now - CLAIM_SEARCH_RATE_LIMIT_WINDOW_MS;
  const hits = (buckets.get(userId) ?? []).filter((t) => t > windowStart);
  if (hits.length >= CLAIM_SEARCH_RATE_LIMIT_MAX) {
    buckets.set(userId, hits);
    return false;
  }
  hits.push(now);
  buckets.set(userId, hits);
  return true;
}
