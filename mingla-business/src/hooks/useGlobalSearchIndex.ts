/**
 * useGlobalSearchIndex — builds the role-filtered search index from the
 * brand's cached offerings + the static registry.
 *
 * META-ORCH-1073 Sub-A. SPEC §3.4.2 (LOCKED). Called ONCE inside the mounted
 * sheet component, never per-TopBar. It reads React Query caches via the
 * existing list hooks (preserving subscription/refresh semantics) + the
 * Zustand draft store (R-1 include drafts), then memoizes
 * `buildSearchIndex(...)` and role-filters so neither presentation shell can
 * leak an entry the caller cannot open.
 *
 * I-SEARCH-ROLE-GATED: entries with minRank > rank are dropped HERE, before
 * matching. Role gating is a UX courtesy (no dead-end taps); RLS remains the
 * real security boundary.
 *
 * I-SEARCH-CLIENT-ONLY: this hook calls list hooks that read cache; the
 * search lib it feeds imports no fetch. No new network request fires on open
 * or on any keystroke.
 */

import { useMemo } from "react";

import { useCurrentBrand } from "./useCurrentBrand";
import { useCurrentBrandRole } from "./useCurrentBrandRole";
import { useBusinessEventsForBrand } from "./useBusinessEvents";
import { useServerDraftsForBrand } from "./useServerDraftEvents";
import { useTripsByBrand } from "./useTrips";
import { useExperiencesByBrand } from "./useExperiencesByBrand";
import {
  buildSearchIndex,
  filterIndexByRank,
} from "../lib/search/globalSearch";
import type { SearchIndexEntry } from "../lib/search/types";

export interface GlobalSearchIndexResult {
  /** role-filtered index for the current brand + caller. */
  index: SearchIndexEntry[];
  /** true while any offering source cache is still on its first fetch. */
  isOfferingsLoading: boolean;
  /** the caller's rank on the current brand (0 = no membership / cold). */
  rank: number;
  /** whether a current brand is resolved (drives the degraded state). */
  hasBrand: boolean;
}

export const useGlobalSearchIndex = (): GlobalSearchIndexResult => {
  const brand = useCurrentBrand();
  const brandId = brand?.id ?? null;
  const { rank } = useCurrentBrandRole(brandId);

  const eventsQuery = useBusinessEventsForBrand(brandId);
  const draftsQuery = useServerDraftsForBrand(brandId);
  const tripsQuery = useTripsByBrand(brandId);
  const experiencesQuery = useExperiencesByBrand(brandId);

  const events = eventsQuery.data;
  const drafts = draftsQuery.data;
  const trips = tripsQuery.data;
  const experiences = experiencesQuery.data;

  const index = useMemo<SearchIndexEntry[]>(() => {
    const full = buildSearchIndex({
      events,
      drafts,
      trips,
      experiences,
      brandId,
    });
    return filterIndexByRank(full, rank);
  }, [events, drafts, trips, experiences, brandId, rank]);

  const isOfferingsLoading =
    brandId !== null &&
    (eventsQuery.isLoading ||
      tripsQuery.isLoading ||
      experiencesQuery.isLoading ||
      draftsQuery.isLoading);

  return {
    index,
    isOfferingsLoading,
    rank,
    hasBrand: brandId !== null,
  };
};
