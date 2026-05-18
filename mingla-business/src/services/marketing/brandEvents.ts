/**
 * ORCH-0864 [Marketing Composer V2] Stage F — brand events hook + type.
 *
 * Source of truth for `EventCardOption` (previously lived in
 * `EventCardInserter.tsx`, deleted at Stage F) + a small React Query hook
 * that fetches the most recent 50 events for a brand from
 * `events_with_master_date_view`.
 *
 * Used by:
 *   - ComposerV2/InsertionBar (events scroller)
 *   - ComposerV2/ComposerV2Editor (handler typing)
 *   - compose.tsx (call site)
 */

import { useQuery, type UseQueryResult } from "@tanstack/react-query";

import { supabase } from "../supabase";

export interface EventCardOption {
  id: string;
  title: string;
  date_label: string | null;
  cover_image_url: string | null;
}

interface EventsViewRow {
  id: string;
  title: string | null;
  master_start_at: string | null;
  cover_media_url: string | null;
}

function parseRow(row: EventsViewRow): EventCardOption {
  return {
    id: row.id,
    title: row.title ?? "Untitled event",
    date_label:
      row.master_start_at !== null
        ? new Date(row.master_start_at).toLocaleDateString(undefined, {
            weekday: "short",
            month: "short",
            day: "numeric",
          })
        : null,
    cover_image_url: row.cover_media_url,
  };
}

/**
 * Fetch the most recent 50 events for a brand (newest first). Used by the
 * composer's inline event-picker scroller. 60s stale — operators rarely
 * create events while composing, but a stale cache up to a minute is
 * acceptable trade for fewer round-trips.
 */
export async function listBrandEvents(
  brandId: string,
): Promise<EventCardOption[]> {
  const { data, error } = await supabase
    .from("events_with_master_date_view")
    .select("id, title, master_start_at, cover_media_url")
    .eq("brand_id", brandId)
    .is("deleted_at", null)
    .order("master_start_at", { ascending: false, nullsFirst: false })
    .limit(50);
  if (error) throw error;
  return ((data ?? []) as EventsViewRow[]).map(parseRow);
}

export interface UseBrandEventsState {
  data: EventCardOption[] | undefined;
  isLoading: boolean;
  isError: boolean;
  refetch: UseQueryResult<EventCardOption[]>["refetch"];
}

const STALE_TIME_MS = 60 * 1000;

export function useBrandEvents(
  brandId: string | null | undefined,
): UseBrandEventsState {
  const enabled = typeof brandId === "string" && brandId.length > 0;
  const query = useQuery<EventCardOption[]>({
    queryKey: ["marketing", "brand-events", brandId ?? null] as const,
    queryFn: async () => {
      if (!enabled || brandId === null || brandId === undefined) return [];
      return listBrandEvents(brandId);
    },
    enabled,
    staleTime: STALE_TIME_MS,
  });
  return {
    data: query.data,
    isLoading: query.isLoading,
    isError: query.isError,
    refetch: query.refetch,
  };
}
