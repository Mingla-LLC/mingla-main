import type { DiscoverFiltersV2 } from '../types/discoverFeed';
import { normalizeDiscoverFilters } from '../types/discoverFeed';

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
    [...discoverKeys.all, 'facets', anchorKey, normalizeDiscoverFilters(filters)] as const,
  feed: (anchorKey: string, filters: DiscoverFiltersV2) =>
    [...discoverKeys.all, 'feed', anchorKey, normalizeDiscoverFilters(filters)] as const,
  cityWatch: (cityKey: string, userId: string) =>
    [...discoverKeys.all, 'cityWatch', cityKey, userId] as const,
};
