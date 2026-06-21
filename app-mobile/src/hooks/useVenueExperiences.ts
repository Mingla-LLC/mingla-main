import { useQuery, type UseQueryResult } from "@tanstack/react-query";

import { supabase } from "../services/supabase";

/**
 * ORCH-1072 [venue-card brand experiences section]
 * ---------------------------------------------------------------------------
 * Fetches the published experiences authored by the VERIFIED brand that has
 * claimed a given place_pool venue. Powers the compact "Experiences" rows on
 * the consumer expanded venue card (beneath stars/miles/price, above weather).
 *
 * `placePoolId` is the deck card's `id` (== place_pool.id uuid — see
 * discover-cards: `id: row.place_id` where place_id is place_pool.id). The RPC
 * is anon-safe (SECURITY DEFINER, only PUBLIC + PUBLISHED rows of a VERIFIED
 * brand). Returns [] for unclaimed venues / venues whose brand has no public
 * experiences, so the section renders nothing.
 */

/** Row shape returned by pg_brand_experiences_for_place. */
export interface VenueExperienceRow {
  experience_id: string;
  brand_id: string;
  brand_slug: string;
  brand_name: string;
  experience_slug: string;
  title: string;
  description: string | null;
  cover_media_url: string | null;
  cover_media_type: "image" | "video" | "gif" | null;
  theme: Record<string, unknown> | null;
  venue_text: string | null;
  next_occurrence_at: string | null;
  price_from_cents: number | null;
  currency: string | null;
  is_free: boolean;
  /**
   * ORCH-1138 rework (§4.A.3) — the curated vibes (canonical 4) for the consumer
   * vibe chips on the venue→detail seed. null/[] → no vibe row (rule 9).
   */
  experience_intents: string[] | null;
  /**
   * ORCH-1138 rework (§4.A.3) — the ordered stops (mirrors the deck RPC stops
   * jsonb) so the venue→detail seed renders per-stop galleries + map + labels.
   */
  stops:
    | Array<{
        stop_order: number;
        place_id: string | null;
        place_name: string | null;
        address: string | null;
        city: string | null;
        image_urls: string[] | null;
        ai_description: string | null;
        lat: number | null;
        lng: number | null;
        start_time: string | null;
        price_cents: number | null;
      }>
    | null;
  /**
   * ORCH-1138 rework (§4.A.3) — the upcoming bookable occurrences (post-
   * materializer) so the venue→detail Reserve sees real slots.
   */
  upcoming_occurrences:
    | Array<{
        event_date_id: string;
        start_at: string;
        end_at: string;
        capacity: number | null;
        sold: number;
        remaining: number | null;
      }>
    | null;
  published_at: string;
  /**
   * ORCH-1153 WS2 — recurrence fields (from pg_brand_experiences_for_place, added
   * in 20261009000003) so the venue→detail seed runs the SHARED rule-based
   * open-daily detector (isOpenDailyExperience). NULL recurrence_rules → not
   * open-daily (falls back to the flat slot list).
   */
  is_recurring?: boolean | null;
  recurrence_rules?: {
    preset?: string;
    byDay?: string;
    byMonthDay?: number;
    bySetPos?: number;
    termination?: { kind?: string; count?: number; until?: string };
  } | null;
  /**
   * ORCH-1183 — the experience's REAL IANA timezone (events.timezone), added to
   * pg_brand_experiences_for_place so the venue→detail SEED no longer hardcodes
   * "UTC". null/undefined (pre-migration payload) → the mapper keeps "UTC".
   */
  timezone?: string | null;
}

export const venueExperiencesKeys = {
  all: ["venueExperiences"] as const,
  byPlace: (placePoolId: string) =>
    [...venueExperiencesKeys.all, placePoolId] as const,
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function fetchVenueExperiences(
  placePoolId: string,
): Promise<VenueExperienceRow[]> {
  const { data, error } = await supabase.rpc("pg_brand_experiences_for_place", {
    p_place_pool_id: placePoolId,
  });
  if (error !== null) throw error;
  return (data ?? []) as VenueExperienceRow[];
}

/**
 * Returns the claimed-brand experiences for a venue. Disabled (no fetch) when
 * `placePoolId` is null or not a uuid — Ticketmaster / curated / stroll cards
 * carry non-uuid ids and must never hit the RPC.
 */
export function useVenueExperiences(
  placePoolId: string | null | undefined,
): UseQueryResult<VenueExperienceRow[]> {
  const enabled =
    typeof placePoolId === "string" && UUID_RE.test(placePoolId);
  return useQuery({
    queryKey: venueExperiencesKeys.byPlace(placePoolId ?? "none"),
    queryFn: () => fetchVenueExperiences(placePoolId as string),
    enabled,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });
}
