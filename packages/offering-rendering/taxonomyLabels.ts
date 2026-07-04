/**
 * taxonomyLabels — ORCH-1292 [public-page-tag-slug-labels].
 *
 * The ONE in-package resolver that turns a party/vibe/music taxonomy SLUG
 * (e.g. "pool-party") into its canonical display LABEL ("Pool Party") for the
 * shared public event/RSVP page bodies. Dep-free (no react / react-native
 * imports) so it is Deno-unit-testable, mirroring rsvpMomentum.ts.
 *
 * Isolation (I-MOR-0827-PACKAGE-ISOLATION): this module is SELF-CONTAINED and
 * must NOT import any app `src/` copy of the taxonomy. The label pairs below are
 * transcribed VERBATIM from the canonical source of truth,
 * supabase/functions/_shared/eventTaxonomy.ts (PARTY_TYPES + VIBE_TAGS +
 * MUSIC_GENRES). The strict-grep drift gate
 * .github/scripts/strict-grep/orch-1292-taxonomy-label-parity.mjs asserts this
 * map stays in set-equality + byte-exact label-parity with that canonical file,
 * so a drift (a renamed / dropped / added slug on either side) fails CI.
 *
 * Cross-taxonomy slugs are unique across party/vibe/music (45 slugs, 45 unique,
 * zero collisions — verified + enforced by the drift gate), so a single flat map
 * is safe and unambiguous. Keys are quoted uniformly so the drift gate parses
 * every `"slug": "label"` pair with one rule.
 */

/** Canonical party/vibe/music `slug → label` map, verbatim from eventTaxonomy.ts. */
export const TAXONOMY_LABELS: Readonly<Record<string, string>> = {
  // PARTY_TYPES (15) — eventTaxonomy.ts:46-62
  "birthday-party": "Birthday Party",
  "rooftop-party": "Rooftop Party",
  "club-night": "Club Night",
  "house-party": "House Party",
  "warehouse-party": "Warehouse Party",
  "beach-party": "Beach Party",
  "pool-party": "Pool Party",
  "boat-party": "Boat Party",
  "themed-party": "Themed Party",
  "corporate-event": "Corporate Event",
  "graduation-party": "Graduation Party",
  "holiday-party": "Holiday Party",
  "networking-event": "Networking Event",
  "rave": "Rave",
  "festival": "Festival",
  // VIBE_TAGS (16) — eventTaxonomy.ts:64-81
  "energetic": "Energetic",
  "chill": "Chill",
  "intimate": "Intimate",
  "wild": "Wild",
  "classy": "Classy",
  "casual": "Casual",
  "upscale": "Upscale",
  "underground": "Underground",
  "mainstream": "Mainstream",
  "artsy": "Artsy",
  "social": "Social",
  "exclusive": "Exclusive",
  "laid-back": "Laid-back",
  "vibrant": "Vibrant",
  "retro": "Retro",
  "futuristic": "Futuristic",
  // MUSIC_GENRES (14) — eventTaxonomy.ts:83-98
  "electronic-edm": "Electronic/EDM",
  "hiphop-rap": "Hip-Hop/Rap",
  "pop": "Pop",
  "rock": "Rock",
  "latin": "Latin",
  "afrobeats": "Afrobeats",
  "rnb-soul": "R&B/Soul",
  "disco-funk": "Disco/Funk",
  "reggae-dancehall": "Reggae/Dancehall",
  "indie": "Indie",
  "country": "Country",
  "jazz": "Jazz",
  "classical": "Classical",
  "mixed-variety": "Mixed/Variety",
};

/**
 * Resolve a taxonomy slug to its canonical display label.
 *
 * Returns the canonical label when the slug is known; otherwise a Title-Case
 * fallback (split on "-", upper-case the first character of EACH word, join with
 * a space) so a brand-new / unknown slug never renders as raw kebab-case.
 * Empty string in → empty string out (no throw).
 */
export const taxonomyLabel = (slug: string): string =>
  TAXONOMY_LABELS[slug] ??
  slug
    .split("-")
    .filter((w) => w.length > 0)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
