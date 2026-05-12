/**
 * ORCH-0809: Server-owned Ticketmaster classification IDs.
 *
 * Source: https://developer.ticketmaster.com/products-and-docs/apis/discovery-api/v2/
 *   GET /discovery/v2/classifications.json
 *
 * Slice M1 (this commit) ships ONLY the segments that have been independently
 * verified against Ticketmaster's public developer documentation:
 *   - Music  (KZFzniwnSyZfZ7v7nJ — also matches the legacy hardcoded constant)
 *   - Sports (KZFzniwnSyZfZ7v7nE)
 *
 * Slice M2/M3 will add Arts & Theatre, Comedy, Family, and Film after the
 * operator runs the verification curl with the TICKETMASTER_API_KEY:
 *
 *   curl 'https://app.ticketmaster.com/discovery/v2/classifications.json?apikey=$KEY&size=200' | jq '._embedded.classifications[]._embedded.segment | {id, name}'
 *
 * Per SPEC §5.3, slugs that cannot be verified are REMOVED from the union
 * rather than shipped with placeholder strings — keeping the strict-grep
 * gate `orch-0809-tm-classification-by-id` Check 3 (no "VERIFY" literals)
 * trivially satisfiable in this slice.
 *
 * Client never ships these IDs. The DiscoverScreen + nightOutExperiencesService
 * pass user-facing slugs across the wire; this file is the only place the
 * mapping lives (one owner per truth — Constitution #2).
 */

export type DiscoverSegmentSlug = "music" | "sports";

export const DISCOVER_SEGMENT_ID: Record<DiscoverSegmentSlug, string> = {
  music: "KZFzniwnSyZfZ7v7nJ",
  sports: "KZFzniwnSyZfZ7v7nE",
};

/**
 * Genre slugs available within each segment. Slice M1 ships with empty
 * genre maps — the genre filter degrades to "segment only" until M2 adds
 * verified genre IDs. This is explicitly permitted by SPEC §5.3:
 *   "If any classification cannot be verified, the slug is removed from
 *    DISCOVER_GENRE_ID. The chip then renders but the genre filter
 *    degrades to 'segment only' — acceptable."
 */
export type DiscoverGenreSlug =
  // Music genre slugs (M2 will populate IDs)
  | "all"
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
  // Sports genre slugs (M2 will populate IDs)
  | "basketball"
  | "football-nfl"
  | "baseball"
  | "soccer"
  | "hockey";

export const DISCOVER_GENRE_ID: Record<
  DiscoverSegmentSlug,
  Partial<Record<DiscoverGenreSlug, string>>
> = {
  music: {
    // M2: populate after operator runs the verification curl
  },
  sports: {
    // M2: populate after operator runs the verification curl
  },
};

/**
 * Resolve a (segment slug, genre slugs[]) pair to TM API IDs.
 *
 * - Unknown segment slug → returns Music as the safe default (preserves
 *   the legacy hardcoded MUSIC_SEGMENT_ID behavior from edge function line 16).
 * - "all" genre slug or any unmapped slug → dropped silently (defensive —
 *   the edge function can still query by segmentId alone).
 *
 * The edge function is the only legitimate caller of this resolver.
 */
export function resolveTmClassification(
  segmentSlug: DiscoverSegmentSlug | string | undefined,
  genreSlugs: ReadonlyArray<DiscoverGenreSlug | string>,
): { segmentId: string; genreIds: string[] } {
  const segmentId =
    (segmentSlug && DISCOVER_SEGMENT_ID[segmentSlug as DiscoverSegmentSlug]) ||
    DISCOVER_SEGMENT_ID.music;

  const segmentKey = (
    segmentSlug && segmentSlug in DISCOVER_SEGMENT_ID
      ? segmentSlug
      : "music"
  ) as DiscoverSegmentSlug;

  const genreMap = DISCOVER_GENRE_ID[segmentKey] ?? {};
  const genreIds = genreSlugs
    .filter((slug): slug is DiscoverGenreSlug => slug !== "all" && slug !== "")
    .map((slug) => genreMap[slug as DiscoverGenreSlug])
    .filter((id): id is string => typeof id === "string" && id.length > 0);

  return { segmentId, genreIds };
}
