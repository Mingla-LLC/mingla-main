/**
 * Global search — the pure service.
 *
 * META-ORCH-1073 Sub-A. SPEC §3.3 (service layer, LOCKED):
 *  - buildSearchIndex(args): pure; maps each domain via its adapter,
 *    concatenates with the static registry, substitutes :brandId, drops
 *    brand-scoped registry rows when no brand, stamps recency. No I/O.
 *  - searchIndex(query, index, opts?): pure; runs scoreMatch over the
 *    (already role-filtered) index, applies per-group caps + sort, returns
 *    results in fixed group order (Offerings → Go to → Settings & actions).
 *
 * Role-gating: the index passed to searchIndex is expected to already be
 * role-filtered (the hook drops entries with minRank > rank before matching,
 * SPEC §3.4.2 / §3.6). buildSearchIndex still stamps minRank so a caller can
 * filter; `filterIndexByRank` is the canonical drop.
 *
 * I-SEARCH-CLIENT-ONLY: no fetch, no supabase import.
 */

import { FEATURE_REGISTRY, BRAND_ID_TOKEN } from "./registry";
import { normalizeSearchText } from "./normalize";
import { scoreMatch } from "./scoreMatch";
import {
  eventsToIndexEntries,
  draftsToIndexEntries,
  tripsToIndexEntries,
  experiencesToIndexEntries,
} from "./adapters";
import type {
  SearchGroup,
  SearchIndexEntry,
  SearchResult,
} from "./types";
import type { LiveEvent } from "../../store/liveEventStore";
import type { DraftEvent } from "../../store/draftEventStore";
import type { Trip } from "../../services/tripsService";
import type { VenueExperience } from "../../services/experiencesService";

/** Min query length (after trim). Below this → empty state, not zero-result. */
export const MIN_QUERY_LENGTH = 2;

/** Fixed render order (SPEC §3.1.3). */
export const GROUP_ORDER: readonly SearchGroup[] = [
  "offerings",
  "goto",
  "settings",
];

/** Per-group result caps (SPEC §3.2). */
export const GROUP_CAPS: Record<SearchGroup, number> = {
  offerings: 8,
  goto: 6,
  settings: 6,
};

/** Empty-state jump-to suggestion cap per group (SPEC §3.2). */
export const SUGGESTION_CAP_PER_GROUP = 5;

export interface BuildSearchIndexArgs {
  events: readonly LiveEvent[] | null | undefined;
  drafts: readonly DraftEvent[] | null | undefined;
  trips: readonly Trip[] | null | undefined;
  experiences: readonly VenueExperience[] | null | undefined;
  /** current brand id — substituted into :brandId registry routes. */
  brandId: string | null;
}

/**
 * Build the role-UNFILTERED index from cached offerings + the static
 * registry. Pure. The hook role-filters via `filterIndexByRank`.
 */
export function buildSearchIndex(args: BuildSearchIndexArgs): SearchIndexEntry[] {
  const offerings: SearchIndexEntry[] = [
    ...eventsToIndexEntries(args.events),
    ...draftsToIndexEntries(args.drafts, args.brandId),
    ...tripsToIndexEntries(args.trips),
    ...experiencesToIndexEntries(args.experiences),
  ];

  const registryEntries: SearchIndexEntry[] = [];
  for (const item of FEATURE_REGISTRY) {
    let route = item.route;
    if (route.includes(BRAND_ID_TOKEN)) {
      // Brand-scoped: drop if no brand to deep-link to.
      if (args.brandId === null || args.brandId.length === 0) continue;
      route = route.split(BRAND_ID_TOKEN).join(args.brandId);
    }
    registryEntries.push({
      type: item.type,
      id: item.key,
      title: item.title,
      subtitle: item.subtitle,
      route,
      group: item.group,
      minRank: item.minRank,
      iconName: item.iconName,
      recencyKey: null,
      searchText: {
        title: normalizeSearchText(item.title),
        keywords: item.synonyms
          .map(normalizeSearchText)
          .filter((s) => s.length > 0),
        body: null,
        location: null,
      },
    });
  }

  return [...offerings, ...registryEntries];
}

/**
 * Drop entries the caller's rank cannot see (SPEC §3.6). Pure.
 * I-SEARCH-ROLE-GATED is enforced by calling this before searchIndex.
 */
export function filterIndexByRank(
  index: readonly SearchIndexEntry[],
  rank: number,
): SearchIndexEntry[] {
  return index.filter((entry) => rank >= entry.minRank);
}

/**
 * Stable comparator for two scored results within a single group.
 * Higher score first; ties broken by recency (newer first) for offerings,
 * and by declaration order (stable) for registry rows (recencyKey === null).
 */
function compareScored(
  a: { score: number; entry: SearchIndexEntry; order: number },
  b: { score: number; entry: SearchIndexEntry; order: number },
): number {
  if (b.score !== a.score) return b.score - a.score;
  const aKey = a.entry.recencyKey;
  const bKey = b.entry.recencyKey;
  if (aKey !== null && bKey !== null) {
    // ISO strings sort lexically === chronologically; newer (greater) first.
    if (aKey !== bKey) return aKey > bKey ? -1 : 1;
  }
  // Stable fallback: original declaration order.
  return a.order - b.order;
}

export interface SearchIndexOpts {
  /** override per-group caps (tests). */
  caps?: Partial<Record<SearchGroup, number>>;
}

/**
 * Run the matcher over a (role-filtered) index for a query. Returns results
 * in fixed group order, per-group capped + score-sorted. Returns `[]` for a
 * query shorter than MIN_QUERY_LENGTH (caller shows the empty state).
 *
 * Defensive: wrapped so malformed entries cannot crash the pipeline — a
 * throw yields `[]` (the component surfaces the error state separately via
 * `searchIndexSafe`).
 */
export function searchIndex(
  query: string,
  index: readonly SearchIndexEntry[],
  opts?: SearchIndexOpts,
): SearchResult[] {
  const normalizedQuery = normalizeSearchText(query);
  if (normalizedQuery.length < MIN_QUERY_LENGTH) return [];

  const caps = { ...GROUP_CAPS, ...(opts?.caps ?? {}) };

  // Bucket scored matches per group, preserving declaration order as the
  // stable tiebreaker.
  const buckets: Record<
    SearchGroup,
    { score: number; entry: SearchIndexEntry; order: number; matchedField: SearchResult["matchedField"] }[]
  > = {
    offerings: [],
    goto: [],
    settings: [],
  };

  for (let i = 0; i < index.length; i += 1) {
    const entry = index[i];
    const match = scoreMatch(normalizedQuery, entry);
    if (match === null) continue;
    buckets[entry.group].push({
      score: match.score,
      entry,
      order: i,
      matchedField: match.matchedField,
    });
  }

  const results: SearchResult[] = [];
  for (const group of GROUP_ORDER) {
    const bucket = buckets[group];
    bucket.sort(compareScored);
    const capped = bucket.slice(0, caps[group]);
    for (const item of capped) {
      results.push(toResult(item.entry, item.score, item.matchedField));
    }
  }
  return results;
}

/**
 * Defensive wrapper around searchIndex — never throws on valid string input.
 * Returns `{ ok: true, results }` or `{ ok: false }` so the component can
 * render the error state (SPEC §3.7 state #9, Constitution rule 3).
 */
export function searchIndexSafe(
  query: string,
  index: readonly SearchIndexEntry[],
  opts?: SearchIndexOpts,
): { ok: true; results: SearchResult[] } | { ok: false } {
  try {
    return { ok: true, results: searchIndex(query, index, opts) };
  } catch {
    return { ok: false };
  }
}

/**
 * Empty-state "Jump to" suggestions: top registry screens grouped, capped at
 * SUGGESTION_CAP_PER_GROUP per group, in fixed group order. Pure. Offerings
 * are excluded here (the empty state shows registry jump-to + recents only,
 * SPEC §3.7 state #1).
 */
export function jumpToSuggestions(
  index: readonly SearchIndexEntry[],
): SearchResult[] {
  const out: SearchResult[] = [];
  for (const group of GROUP_ORDER) {
    if (group === "offerings") continue;
    const inGroup = index.filter((e) => e.group === group);
    const capped = inGroup.slice(0, SUGGESTION_CAP_PER_GROUP);
    for (const entry of capped) {
      out.push(toResult(entry, 0, null));
    }
  }
  return out;
}

/**
 * Zero-result rescue: up to 3 nearest registry suggestions via the fuzzy
 * tier (DESIGN state #4). Pure.
 */
export function nearestSuggestions(
  query: string,
  index: readonly SearchIndexEntry[],
  limit = 3,
): SearchResult[] {
  const normalizedQuery = normalizeSearchText(query);
  const scored: { score: number; entry: SearchIndexEntry; order: number }[] = [];
  for (let i = 0; i < index.length; i += 1) {
    const entry = index[i];
    if (entry.group === "offerings") continue; // suggest destinations, not data
    const match = scoreMatch(normalizedQuery, entry);
    if (match !== null) {
      scored.push({ score: match.score, entry, order: i });
    }
  }
  scored.sort(compareScored);
  return scored.slice(0, limit).map((s) => toResult(s.entry, s.score, null));
}

function toResult(
  entry: SearchIndexEntry,
  score: number,
  matchedField: SearchResult["matchedField"],
): SearchResult {
  return {
    type: entry.type,
    id: entry.id,
    title: entry.title,
    subtitle: entry.subtitle,
    route: entry.route,
    group: entry.group,
    score,
    matchedField,
    iconName: entry.iconName,
  };
}
