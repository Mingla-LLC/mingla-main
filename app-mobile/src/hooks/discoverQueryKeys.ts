import type { DiscoverFiltersV2 } from '../types/discoverFeed';
import { normalizeDiscoverFilters } from '../types/discoverFeed';

export const DISCOVER_OCCURRENCE_CATALOG_VERSION = 3;

/**
 * Discover-only query keys stay outside the shared mutation key graph.
 *
 * The feed and facet identities need Discover's runtime filter normalizer. Keeping
 * that dependency here prevents unrelated visit/review mutations that import
 * queryKeys.ts from pulling the Discover feed model into their safety-critical
 * dependency closure.
 */
export const discoverKeys = {
  all: ['discover'] as const,
  facets: (anchorKey: string, filters: DiscoverFiltersV2) =>
    [...discoverKeys.all, 'facets', DISCOVER_OCCURRENCE_CATALOG_VERSION, anchorKey, normalizeDiscoverFilters(filters)] as const,
  feed: (anchorKey: string, filters: DiscoverFiltersV2) =>
    [...discoverKeys.all, 'feed', DISCOVER_OCCURRENCE_CATALOG_VERSION, anchorKey, normalizeDiscoverFilters(filters)] as const,
  cityWatch: (cityKey: string, userId: string) =>
    [...discoverKeys.all, 'cityWatch', cityKey, userId] as const,
};

/**
 * #4265 — the last Discover city shown to a user, so the next mount (including
 * the first one after a cold start, via the persisted cache) can paint at once.
 * Its own root so a Discover pull-to-refresh (`discoverKeys.all`) never touches
 * it. The user id in the key makes the persister drop it for any other account
 * and logout's `queryClient.clear()` remove it.
 */
export const discoverLastCityKeys = {
  all: ['discover-last-city'] as const,
  forUser: (userId: string) => [...discoverLastCityKeys.all, userId] as const,
};
