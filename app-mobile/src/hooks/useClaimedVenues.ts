import { useQueries } from "@tanstack/react-query";
import { useMemo } from "react";

import { supabase } from "../services/supabase";

/**
 * #4347 wave 1 — which deck places are CLAIMED host venues, and where their
 * public venue page lives.
 *
 * THE SIGNAL. `venue_public_view` is the existing anon-granted view the brand
 * page already reads (`useBrandBySlug.getPublicBrandVenues`). It lists ONLY
 * `venue_listings` rows with `claim_status = 'verified'`, and carries the
 * `place_pool_id`, the venue `slug` and the brand's `brand_slug` / `brand_name`
 * — every field the host chip and the `/b/{brandSlug}/v/{venueSlug}` route need.
 * Nothing on the deck payload says "claimed", and `pg_venue_reservable_for_place`
 * is one RPC per place (and only knows reservable brands), so it is not used.
 *
 * NOT N+1. The deck's place ids are read in fixed chunks of `CHUNK` with one
 * `.in()` per chunk, keyed by the chunk's ids. The chunks only change when the
 * deck itself reloads, so a session of swiping costs a handful of reads per
 * deck load, never one per card. A failed chunk degrades to "not claimed" for
 * its cards (no chip, the pool sheet opens as before): the venue page is an
 * enhancement, and the card stays fully usable.
 */
export interface ClaimedVenue {
  readonly placePoolId: string;
  readonly brandSlug: string;
  readonly brandName: string;
  readonly venueSlug: string;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const CLAIMED_VENUE_CHUNK = 50;

export const claimedVenueKeys = {
  all: ["claimedVenues"] as const,
  chunk: (ids: readonly string[]) => [...claimedVenueKeys.all, ...ids] as const,
};

interface ClaimedVenueRow {
  place_pool_id: string | null;
  slug: string | null;
  brand_slug: string | null;
  brand_name: string | null;
}

/** The distinct, valid place ids of a deck, in fixed chunks. Pure. */
export function claimedVenueChunks(
  placePoolIds: readonly (string | null | undefined)[],
  size: number = CLAIMED_VENUE_CHUNK,
): string[][] {
  const unique = Array.from(
    new Set(
      placePoolIds.filter(
        (id): id is string => typeof id === "string" && UUID_RE.test(id),
      ),
    ),
  );
  const chunks: string[][] = [];
  for (let i = 0; i < unique.length; i += size) {
    chunks.push(unique.slice(i, i + size));
  }
  return chunks;
}

/** A row the route can use: every slug present. Anything less is not claimed. */
export function toClaimedVenue(row: ClaimedVenueRow): ClaimedVenue | null {
  const placePoolId = row.place_pool_id;
  const venueSlug = typeof row.slug === "string" ? row.slug.trim() : "";
  const brandSlug = typeof row.brand_slug === "string" ? row.brand_slug.trim() : "";
  if (typeof placePoolId !== "string" || venueSlug.length === 0 || brandSlug.length === 0) {
    return null;
  }
  return {
    placePoolId,
    brandSlug,
    venueSlug,
    brandName: typeof row.brand_name === "string" ? row.brand_name.trim() : "",
  };
}

async function fetchClaimedVenueChunk(ids: readonly string[]): Promise<ClaimedVenue[]> {
  const { data, error } = await supabase
    .from("venue_public_view")
    .select("place_pool_id, slug, brand_slug, brand_name")
    .in("place_pool_id", ids as string[]);
  if (error !== null) {
    // Surfaced, not swallowed: the cards degrade to "not claimed" (the pool
    // sheet still opens), and the reason is in the log.
    console.warn("[useClaimedVenues] venue_public_view read failed:", error.message);
    throw error;
  }
  return ((data ?? []) as ClaimedVenueRow[])
    .map(toClaimedVenue)
    .filter((venue): venue is ClaimedVenue => venue !== null);
}

/** placePoolId -> claimed venue, for every deck place that is one. */
export function useClaimedVenues(
  placePoolIds: readonly (string | null | undefined)[],
): ReadonlyMap<string, ClaimedVenue> {
  const idsKey = placePoolIds.join(",");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const chunks = useMemo(() => claimedVenueChunks(placePoolIds), [idsKey]);
  const results = useQueries({
    queries: chunks.map((ids) => ({
      queryKey: claimedVenueKeys.chunk(ids),
      queryFn: () => fetchClaimedVenueChunk(ids),
      // A claim is a slow-moving fact; one read per deck load is plenty.
      staleTime: 10 * 60 * 1000,
      retry: 1,
    })),
  });
  const dataKey = results.map((r) => r.dataUpdatedAt).join(",");
  return useMemo(() => {
    const map = new Map<string, ClaimedVenue>();
    for (const result of results) {
      for (const venue of result.data ?? []) map.set(venue.placePoolId, venue);
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataKey]);
}
