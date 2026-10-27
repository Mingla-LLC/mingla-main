/**
 * Issue #4114 — the last known brand-team set, cached per person.
 *
 * Explorer hides a brand's event and trip chats from people on that brand's
 * team (they run them in the Host app) and folds every other event chat into
 * a brand channel. The team set comes from a network read, so the last
 * successful set is kept on the phone and used from the first frame of every
 * launch after the first. Logout removes it (authCleanup, Constitution #6).
 *
 * Pure and dependency-free so it runs under Deno; ConnectionsPage does the
 * AsyncStorage reads and writes.
 */

export const TEAM_BRAND_CACHE_PREFIX = "team_brand_ids:v1:";

export function teamBrandCacheKey(userId: string): string {
  return `${TEAM_BRAND_CACHE_PREFIX}${userId}`;
}

/** The cached set, or null when there is none or it cannot be read (unknown). */
export function parseTeamBrandCache(raw: string | null | undefined): ReadonlySet<string> | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return new Set(parsed.filter((id): id is string => typeof id === "string" && id.length > 0));
  } catch {
    return null;
  }
}

export function serializeTeamBrandCache(ids: ReadonlySet<string>): string {
  return JSON.stringify([...ids].sort());
}

/**
 * The set to use before the fresh read returns: what this launch already knows,
 * else the cache, else null (unknown: hide nothing, fold everything).
 */
export function startupTeamBrandIds(
  current: ReadonlySet<string> | null,
  cachedRaw: string | null | undefined,
): ReadonlySet<string> | null {
  return current ?? parseTeamBrandCache(cachedRaw);
}
