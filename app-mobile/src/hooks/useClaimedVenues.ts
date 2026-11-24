import { useQueries } from "@tanstack/react-query";
import { useMemo } from "react";
import {
  parseDeckVenueFacts,
  type DeckVenueFacts,
  type DeckVenuePriceFrom,
} from "@mingla/brand-rendering/deckVenueChip";
import type { VenueFeatureKey } from "@mingla/brand-rendering/venueFeaturePage";

import { supabase } from "../services/supabase";

/**
 * #4347 wave 1 — which deck places are CLAIMED host venues, and where their
 * public venue page lives. #4490 Explorer W3 — and what each venue card says.
 *
 * THE SIGNAL. `pg_deck_venue_facts` (SECURITY DEFINER, granted to anon and
 * authenticated, at most 100 ids) answers one row per claimed place of a
 * VERIFIED venue of a live, non-internal brand (I-4174-EXPLORER-EXCLUDES-INTERNAL-BRANDS), carrying the card
 * facts from the single server owner `issue_4490_venue_card_facts`: the slugs
 * and names the `/b/{brandSlug}/v/{venueSlug}` route needs, the switched-on
 * features, whether anything is bookable, the live "from" price per feature
 * and whether something is on today. It replaced the `venue_public_view` read
 * (rule 8: replaced, not duplicated). A venue of an internal brand stops
 * showing as claimed on the deck (intended, #4174).
 *
 * NOT N+1. The deck's place ids are read in fixed chunks of `CHUNK` with one
 * RPC per chunk, keyed by the chunk's ids. The chunks only change when the
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
  readonly venueId: string;
  readonly venueName: string;
  readonly venueType: string | null;
  readonly features: readonly VenueFeatureKey[];
  readonly isBookable: boolean;
  readonly priceFrom: DeckVenuePriceFrom;
  readonly currency: { readonly code: string; readonly exponent: number };
  readonly onToday: { readonly startsAt: string | null; readonly live: boolean };
  /** The whole parsed row, for `deckVenueChips`. */
  readonly facts: DeckVenueFacts;
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
  facts: unknown;
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
  if (typeof placePoolId !== "string") return null;
  const facts = parseDeckVenueFacts(row.facts);
  if (facts === null) return null;
  return {
    placePoolId,
    brandSlug: facts.brandSlug,
    venueSlug: facts.venueSlug,
    brandName: facts.brandName,
    venueId: facts.venueId,
    venueName: facts.venueName,
    venueType: facts.venueType,
    features: facts.features,
    isBookable: facts.isBookable,
    priceFrom: facts.priceFrom,
    currency: { code: facts.currencyCode, exponent: facts.minorUnitExponent },
    onToday: { startsAt: facts.onTodayStartsAt, live: facts.onTodayLive },
    facts,
  };
}

async function fetchClaimedVenueChunk(ids: readonly string[]): Promise<ClaimedVenue[]> {
  const { data, error } = await supabase.rpc("pg_deck_venue_facts", {
    p_place_ids: ids as string[],
  });
  if (error !== null) {
    // Surfaced, not swallowed: the cards degrade to "not claimed" (the pool
    // sheet still opens), and the reason is in the log.
    console.warn("[useClaimedVenues] pg_deck_venue_facts read failed:", error.message);
    throw error;
  }
  return ((Array.isArray(data) ? data : []) as ClaimedVenueRow[])
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
