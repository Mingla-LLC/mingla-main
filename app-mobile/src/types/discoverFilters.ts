/**
 * ORCH-0809 + ORCH-0809-D: Client-side slug taxonomy for the Discover
 * Ticketmaster filter.
 *
 * Slugs ONLY — never Ticketmaster classification IDs. The server-owned
 * authoritative source for slug→TM-ID resolution lives at
 * `supabase/functions/_shared/ticketmasterClassifications.ts`.
 *
 * Architectural correction (post 2026-05-12 TM classifications fetch):
 * Mingla's original SPEC named "Comedy" and "Family" as top-level segments.
 * TM does NOT model them that way — Comedy is a genre inside Arts & Theatre,
 * Family is a genre inside Film. This file reflects TM's actual 4-segment
 * structure (Music / Sports / Arts & Theatre / Film). Comedy and Family
 * are therefore genre slugs under their respective segments.
 *
 * Lockstep rule (per ORCH-0809 M3 hotfix): the client's GENRES_BY_SEGMENT
 * below MUST only list slugs that have a real TM ID mapped in the server's
 * DISCOVER_GENRE_ID. If you add a slug here without also adding the ID
 * server-side, the chip silently no-ops — the recurring Constitution
 * #3 + #9 violation we fixed in ORCH-0809 M3 hotfix.
 */

export type DiscoverSegmentSlug =
  | "music"
  | "sports"
  | "arts-theatre"
  | "film";

export type DiscoverGenreSlug =
  | "all"
  // Music — top-level genres
  | "rock"
  | "pop"
  | "hiphop-rap"
  | "rnb"
  | "country"
  | "latin"
  | "dance-electronic"
  | "jazz"
  | "blues"
  | "reggae"
  | "classical"
  | "folk"
  | "alternative"
  | "metal"
  | "world"
  // Music — curated sub-genre unions (ORCH-0809-E)
  | "afro"
  // Sports
  | "basketball"
  | "football"
  | "baseball"
  | "soccer"
  | "hockey"
  | "tennis"
  | "boxing"
  | "wrestling"
  | "golf"
  | "motorsports"
  // Arts & Theatre
  | "theatre"
  | "comedy"
  | "dance"
  | "opera"
  | "childrens-theatre"
  | "magic-illusion"
  // Film
  | "action-adventure"
  | "film-comedy"
  | "drama"
  | "documentary"
  | "family"
  | "horror"
  | "animation"
  | "science-fiction";

/**
 * Genres available per segment. Drives the context-aware genre chip rendering
 * in DiscoverScreen. Every slug below MUST have a corresponding real TM ID
 * in `supabase/functions/_shared/ticketmasterClassifications.ts`
 * (DISCOVER_GENRE_ID). Lockstep rule above.
 */
export const GENRES_BY_SEGMENT: Record<DiscoverSegmentSlug, DiscoverGenreSlug[]> = {
  music: [
    "all",
    "afro",
    "rock",
    "pop",
    "hiphop-rap",
    "rnb",
    "country",
    "latin",
    "dance-electronic",
    "jazz",
    "blues",
    "reggae",
    "classical",
    "folk",
    "alternative",
    "metal",
    "world",
  ],
  sports: [
    "all",
    "basketball",
    "football",
    "baseball",
    "soccer",
    "hockey",
    "tennis",
    "boxing",
    "wrestling",
    "golf",
    "motorsports",
  ],
  "arts-theatre": [
    "all",
    "theatre",
    "comedy",
    "dance",
    "opera",
    "childrens-theatre",
    "magic-illusion",
  ],
  film: [
    "all",
    "action-adventure",
    "film-comedy",
    "drama",
    "documentary",
    "family",
    "horror",
    "animation",
    "science-fiction",
  ],
};

/**
 * DiscoverCity represents a single autocomplete-resolved city. All five fields
 * are denormalized from Google Places Autocomplete at city-pick time and
 * persist to `preferences.discover_city_*`. lat/lng feed the edge function's
 * <5-result lat/lng fallback path.
 */
export interface DiscoverCity {
  name: string;
  stateCode: string | null;
  countryCode: string | null;
  lat: number;
  lng: number;
}
