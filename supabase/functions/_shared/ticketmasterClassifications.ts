/**
 * ORCH-0809 + ORCH-0809-D: Server-owned Ticketmaster classification IDs.
 *
 * Source: https://developer.ticketmaster.com/products-and-docs/apis/discovery-api/v2/
 *   GET /discovery/v2/classifications.json?size=200
 *
 * All IDs in this file were resolved against the live TM Discovery API on
 * 2026-05-12 using the operator's TM consumer key. The endpoint returns a
 * `_embedded.classifications[].segment` tree with top-level segments and
 * their direct genres.
 *
 * Architectural note: Mingla's original SPEC §2 named "Comedy" and "Family"
 * as top-level segments. TM does NOT model them that way — Comedy lives
 * under Arts & Theatre as a genre, and Family lives under Film as a genre.
 * This file reflects TM's actual structure (4 segments: Music, Sports,
 * Arts & Theatre, Film). Comedy and Family are therefore genre slugs, not
 * segment slugs. If product wants Comedy as a top-level chip later, that's
 * a UX-only mapping in DiscoverScreen — the underlying TM query stays the
 * same (Arts & Theatre segment + Comedy genre).
 *
 * Lockstep rule (per ORCH-0809 M3 hotfix experience): any slug added to
 * this file's `DiscoverGenreSlug` union MUST be paired with a real TM ID
 * in `DISCOVER_GENRE_ID` and added to `GENRES_BY_SEGMENT` in
 * `app-mobile/src/types/discoverFilters.ts` in the same commit. Otherwise
 * the chip renders but silently no-ops at the server boundary
 * (Constitution #3 + #9 violation — the recurring bug class in ORCH-0809).
 */

export type DiscoverSegmentSlug =
  | "music"
  | "sports"
  | "arts-theatre"
  | "film";

export const DISCOVER_SEGMENT_ID: Record<DiscoverSegmentSlug, string> = {
  music: "KZFzniwnSyZfZ7v7nJ",
  sports: "KZFzniwnSyZfZ7v7nE",
  "arts-theatre": "KZFzniwnSyZfZ7v7na",
  film: "KZFzniwnSyZfZ7v7nn",
};

/**
 * Genre slugs across all four segments. Each slug maps to a real TM
 * top-level genre ID in DISCOVER_GENRE_ID below. The union is intentionally
 * curated (not every TM genre is exposed) — we ship the chips that fit
 * Mingla's product surface.
 */
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
  // Music — curated unions of sub-genres (ORCH-0809-E)
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
 * Mapping value for a single slug. Two shapes:
 *   - Plain string = top-level TM genre ID; no sub-genre filter applied.
 *   - Object = genre ID + sub-genre union; the edge function will send
 *     `subGenreId=<id1,id2,...>` alongside `genreId=<id>` so TM returns
 *     events matching ANY of the listed sub-genres (TM accepts arrays).
 *
 * The object shape powers "curated union" chips like "Afro" which spans
 * Afro-Beat + African + African Folk + Afro-Cuban + ... under TM's World
 * genre — a single chip that doesn't map 1:1 to a TM classification.
 */
export type DiscoverGenreMapping =
  | string
  | { genreId: string; subGenreIds: string[] };

/**
 * Map: segment slug → genre slug → TM genre ID.
 * Every value is a real TM ID verified against /discovery/v2/classifications.json
 * (2026-05-12 fetch via operator's TM consumer key).
 */
export const DISCOVER_GENRE_ID: Record<
  DiscoverSegmentSlug,
  Partial<Record<DiscoverGenreSlug, DiscoverGenreMapping>>
> = {
  music: {
    rock: "KnvZfZ7vAeA",
    pop: "KnvZfZ7vAev",
    "hiphop-rap": "KnvZfZ7vAv1",
    rnb: "KnvZfZ7vAee",
    country: "KnvZfZ7vAv6",
    latin: "KnvZfZ7vAJ6",
    "dance-electronic": "KnvZfZ7vAvF",
    jazz: "KnvZfZ7vAvE",
    blues: "KnvZfZ7vAvd",
    reggae: "KnvZfZ7vAed",
    classical: "KnvZfZ7vAeJ",
    folk: "KnvZfZ7vAva",
    alternative: "KnvZfZ7vAvv",
    metal: "KnvZfZ7vAvt",
    world: "KnvZfZ7vAeF",
    // ORCH-0809-E curated union: a single "Afro" chip that fans out to the
    // 9 afro-related sub-genres under TM's World genre. IDs verified live
    // against /discovery/v2/classifications/genres/KnvZfZ7vAeF on 2026-05-12.
    // The edge function emits `genreId=KnvZfZ7vAeF&subGenreId=ID1,ID2,...`
    // and TM returns events matching ANY of the listed sub-genres.
    afro: {
      genreId: "KnvZfZ7vAeF", // World
      subGenreIds: [
        "KZazBEonSMnZfZ7v6Ek", // Afro-Beat
        "KZazBEonSMnZfZ7v6Ev", // African
        "KZazBEonSMnZfZ7v6Ee", // African Folk
        "KZazBEonSMnZfZ7v6Ed", // African Jazz
        "KZazBEonSMnZfZ7v6E7", // Afro Brazilian
        "KZazBEonSMnZfZ7v6EA", // Afro Peruvian
        "KZazBEonSMnZfZ7v6E6", // Afro-Cuban
        "KZazBEonSMnZfZ7v6EF", // Afro-Cuban Jazz
        "KZazBEonSMnZfZ7vFF7", // South Africa
      ],
    },
  },
  sports: {
    basketball: "KnvZfZ7vAde",
    football: "KnvZfZ7vAdE",
    baseball: "KnvZfZ7vAdv",
    soccer: "KnvZfZ7vA7E",
    hockey: "KnvZfZ7vAdI",
    tennis: "KnvZfZ7vAAv",
    boxing: "KnvZfZ7vAdA",
    wrestling: "KnvZfZ7vAAk",
    golf: "KnvZfZ7vAdt",
    motorsports: "KnvZfZ7vA7k",
  },
  "arts-theatre": {
    theatre: "KnvZfZ7v7l1",
    comedy: "KnvZfZ7vAe1",
    dance: "KnvZfZ7v7nI",
    opera: "KnvZfZ7v7lk",
    "childrens-theatre": "KnvZfZ7v7na",
    "magic-illusion": "KnvZfZ7v7lv",
  },
  film: {
    "action-adventure": "KnvZfZ7vAke",
    "film-comedy": "KnvZfZ7vAkA",
    drama: "KnvZfZ7vAk6",
    documentary: "KnvZfZ7vAkk",
    family: "KnvZfZ7vAkF",
    horror: "KnvZfZ7vAJk",
    animation: "KnvZfZ7vAkd",
    "science-fiction": "KnvZfZ7vAJa",
  },
};

/**
 * Resolve a (segment slug, genre slugs[]) pair to TM API IDs.
 *
 * - Unknown segment slug → returns Music as the safe default (preserves
 *   the legacy hardcoded MUSIC_SEGMENT_ID behavior from edge function line 16
 *   pre-M1). The edge function itself rejects unknown slugs upstream with
 *   HTTP 400 (M2.1) — this is the helper-level defensive fallback.
 * - "all" genre slug or any unmapped slug → dropped silently (defensive —
 *   the edge function can still query by segmentId alone). However the
 *   client's GENRES_BY_SEGMENT only renders chips whose IDs are present
 *   here (post-M3-hotfix), so this drop should never fire from a chip tap.
 */
export function resolveTmClassification(
  segmentSlug: DiscoverSegmentSlug | string | undefined,
  genreSlugs: ReadonlyArray<DiscoverGenreSlug | string>,
): { segmentId: string; genreIds: string[]; subGenreIds: string[] } {
  const segmentId =
    (segmentSlug && DISCOVER_SEGMENT_ID[segmentSlug as DiscoverSegmentSlug]) ||
    DISCOVER_SEGMENT_ID.music;

  const segmentKey = (
    segmentSlug && segmentSlug in DISCOVER_SEGMENT_ID
      ? segmentSlug
      : "music"
  ) as DiscoverSegmentSlug;

  const genreMap = DISCOVER_GENRE_ID[segmentKey] ?? {};
  const genreIds: string[] = [];
  const subGenreIds: string[] = [];

  for (const slug of genreSlugs) {
    if (slug === "all" || slug === "") continue;
    const mapping = genreMap[slug as DiscoverGenreSlug];
    if (!mapping) continue;
    if (typeof mapping === "string") {
      if (mapping.length > 0) genreIds.push(mapping);
    } else {
      if (mapping.genreId.length > 0) genreIds.push(mapping.genreId);
      for (const sub of mapping.subGenreIds) {
        if (sub.length > 0) subGenreIds.push(sub);
      }
    }
  }

  return { segmentId, genreIds, subGenreIds };
}
