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
  published_at: string;
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
