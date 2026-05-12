/**
 * ORCH-0809: Client-side slug taxonomy for the Discover Ticketmaster filter.
 *
 * Slugs ONLY — never Ticketmaster classification IDs. The server-owned
 * authoritative source for slug→TM-ID resolution lives at
 * `supabase/functions/_shared/ticketmasterClassifications.ts`.
 *
 * Slice M1 ships with the verified segment slugs (`music`, `sports`) only.
 * Additional segments (`arts-theatre`, `comedy`, `family`, `film`) ship in
 * Slice M2 after the operator runs the TM `/classifications` verification curl.
 */

export type DiscoverSegmentSlug = "music" | "sports";

export type DiscoverGenreSlug =
  | "all"
  // Music
  | "afrobeats"
  | "dancehall"
  | "hiphop-rnb"
  | "house"
  | "techno"
  | "jazz-blues"
  | "latin-salsa"
  | "reggae"
  | "kpop"
  | "acoustic-indie"
  // Sports
  | "basketball"
  | "football-nfl"
  | "baseball"
  | "soccer"
  | "hockey";

/**
 * Genres available per segment. Drives the context-aware genre chip rendering
 * in DiscoverScreen (Slice M2 will consume this).
 */
export const GENRES_BY_SEGMENT: Record<DiscoverSegmentSlug, DiscoverGenreSlug[]> = {
  music: [
    "all",
    "afrobeats",
    "dancehall",
    "hiphop-rnb",
    "house",
    "techno",
    "jazz-blues",
    "latin-salsa",
    "reggae",
    "kpop",
    "acoustic-indie",
  ],
  sports: ["all", "basketball", "football-nfl", "baseball", "soccer", "hockey"],
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
