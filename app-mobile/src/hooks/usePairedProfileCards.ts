import { useQuery } from "@tanstack/react-query";
import { fetchPairedProfileCards, type PairedProfileCardsResponse } from "../services/personHeroCardsService";
import { personCardKeys } from "./queryKeys";
import type { PairedCardsMode } from "./usePairedCards";

type PairedProfileMode = Exclude<PairedCardsMode, "shuffle">;

export type PairedProfileSectionRequest = {
  holidayKey: string;
  isCustomHoliday: boolean;
  yearsElapsed?: number;
  categorySlugs: string[];
  curatedExperienceType: string | null;
};

/**
 * Issue #1639 — the section list is a REQUEST INPUT, so it belongs in the cache key.
 *
 * `holidayKey` alone is a complete determinant of a section's request payload:
 * `categorySlugs` / `curatedExperienceType` are derived from the STATIC
 * `holiday.sections` constants (`constants/holidays.ts`), and `isCustomHoliday` /
 * `yearsElapsed` are derived from the key itself. So the digest is the sorted,
 * de-duplicated set of holiday keys — order-independent (the visible-holiday list
 * re-sorts by days-away) and stable across re-renders that change only array
 * identity (the 30 s `usePairingPills` poll re-creates `customHolidays`).
 */
export function buildSectionsCacheKey(sections: PairedProfileSectionRequest[]): string {
  return Array.from(new Set(sections.map((section) => section.holidayKey))).sort().join(",");
}

export function usePairedProfileCards(params: {
  pairedUserId: string;
  sections: PairedProfileSectionRequest[];
  mode?: PairedProfileMode;
  /**
   * Issue #1639 — FALSE until every asynchronously-resolved input to `sections`
   * and `mode` has settled (custom holidays from the DB, archived holiday ids from
   * AsyncStorage, the bilateral-mode override from AsyncStorage). The batched
   * request fans out server-side to ~17 sections, each running a geospatial RPC
   * measured at 1.8 s warm / 3.9 s cold — firing it twice is not a rounding error,
   * it doubles the single most expensive operation in the product. Defaults to
   * `true` so callers with no async inputs are unaffected.
   */
  enabled?: boolean;
} | null) {
  const mode: PairedProfileMode = params?.mode ?? "default";
  const sectionsKey = params ? buildSectionsCacheKey(params.sections) : "";

  const query = useQuery<PairedProfileCardsResponse>({
    queryKey: params
      ? personCardKeys.pairedProfileSections(params.pairedUserId, mode, sectionsKey)
      : personCardKeys.all,
    queryFn: () =>
      fetchPairedProfileCards({
        pairedUserId: params!.pairedUserId,
        sections: params!.sections,
        mode,
      }),
    enabled:
      !!params?.pairedUserId &&
      (params?.sections.length ?? 0) > 0 &&
      (params?.enabled ?? true),
    staleTime: 5 * 60 * 1000,
    gcTime: 24 * 60 * 60 * 1000,
    retry: 2,
    // Issue #1639: the key now moves when a section is ADDED (a new custom holiday,
    // or unarchiving a holiday that was archived before the first request). Without
    // this, that key change would drop `data` to undefined, flip `isLoading` true,
    // and blank EVERY already-painted card row for the full 1.8–3.9 s × 17 fan-out —
    // the umbrella's "never reshuffles content after it has painted" violation, caused
    // by the fix. Keeping the previous response means the rows that already have cards
    // hold them, and only the genuinely-new section shows a skeleton.
    placeholderData: (previousData) => previousData,
  });

  return {
    locationStatus: query.data?.locationStatus ?? "ok",
    sections: query.data?.sections ?? {},
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
}
