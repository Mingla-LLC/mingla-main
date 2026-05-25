/**
 * ORCH-0965 [Home dashboard intelligent KPIs + tri-kind upcoming]
 *
 * Composes events + experiences + trips + drafts into a single
 * normalised, sorted, past-excluded list for the brand-owner home
 * dashboard. Pure client composition — no new edge function, no new
 * migration, no external API. Pre-existing services
 * (`fetchBusinessEventsForBrand`, `getTripsByBrand`, drafts Zustand
 * store) feed this hook unchanged. The events-tab filter that excludes
 * `event_type='trip'` from `fetchBusinessEventsForBrand` is preserved
 * for Constitutional rule #13 (exclusion consistency) — trips reach the
 * home Upcoming list via a SEPARATE query path here.
 *
 * Pure composition pipeline lives in `utils/upcomingBuilder.ts` so unit
 * tests can exercise sort + filter without React Query / RN scaffolding.
 *
 * Established by SPEC §4.4.
 */

import { useMemo } from "react";

import { useDraftsForBrand } from "../store/draftEventStore";
import { useLiveEventsForBrand } from "../store/liveEventStore";
import { buildUpcomingItems } from "../utils/upcomingBuilder";
import {
  type UpcomingCounts,
  type UpcomingItem,
  type UpcomingKind,
  type UpcomingStatus,
} from "../utils/upcomingBuilder";
import { useBusinessEventsForBrand } from "./useBusinessEvents";
import { useTripsByBrand } from "./useTrips";
import { upcomingKeys } from "./upcomingKeys";

// Re-export types so existing consumers don't have to change imports.
export type { UpcomingCounts, UpcomingItem, UpcomingKind, UpcomingStatus };
// Re-export the key factory so consumers can `import { upcomingKeys } from
// "./useUpcomingForBrand"` if they prefer the single-import ergonomic
// (the canonical home is `./upcomingKeys` — required to break the
// require-cycle through useBusinessEvents/useTrips).
export { upcomingKeys };

export interface UpcomingForBrand {
  items: UpcomingItem[];
  counts: UpcomingCounts;
  primaryLiveItem: UpcomingItem | null;
  isLoading: boolean;
  isError: boolean;
  errors: { events?: unknown; trips?: unknown };
}

export const useUpcomingForBrand = (
  brandId: string | null,
): UpcomingForBrand => {
  const eventsQuery = useBusinessEventsForBrand(brandId);
  const tripsQuery = useTripsByBrand(brandId);
  const legacyLiveEvents = useLiveEventsForBrand(brandId);
  const drafts = useDraftsForBrand(brandId);

  const serverEvents = eventsQuery.data ?? [];
  const trips = tripsQuery.data ?? [];

  const { items, counts, primaryLiveItem } = useMemo(
    () => buildUpcomingItems(serverEvents, legacyLiveEvents, trips, drafts),
    [serverEvents, legacyLiveEvents, trips, drafts],
  );

  return {
    items,
    counts,
    primaryLiveItem,
    isLoading: eventsQuery.isLoading || tripsQuery.isLoading,
    isError: eventsQuery.isError || tripsQuery.isError,
    errors: {
      events: eventsQuery.error ?? undefined,
      trips: tripsQuery.error ?? undefined,
    },
  };
};
