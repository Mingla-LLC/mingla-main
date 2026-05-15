/**
 * ORCH-0824 — Mingla event taxonomy canonical source.
 *
 * Three parity-locked copies of this module exist (per I-PROPOSED-EVENT-TAXONOMY-PARITY):
 *   - supabase/functions/_shared/eventTaxonomy.ts   (THIS FILE — Deno edge fn use)
 *   - mingla-business/src/constants/eventTaxonomy.ts (business wizard + filter use)
 *   - app-mobile/src/constants/eventTaxonomy.ts      (consumer Discover filter use)
 *
 * The three files must be byte-equivalent in their PARTY_TYPES, VIBE_TAGS,
 * and MUSIC_GENRES exports. CI strict-grep gate enforces this (see
 * .github/workflows/strict-grep-mingla-business.yml step "ORCH-0824 taxonomy parity").
 *
 * Adding or removing a slug requires:
 *   1. Update all three modules byte-equivalently.
 *   2. Update the SQL CHECK constraint in
 *      supabase/migrations/20260604000000_orch_0824_event_taxonomy_columns.sql.
 *   3. Update the SQL canonical list inside business_publish_event_draft RPC in
 *      supabase/migrations/20260604000001_orch_0824_publish_rpc.sql.
 *   4. Re-run CI to verify parity.
 *
 * See: Mingla_Artifacts/specs/SPEC_ORCH-0824_BUSINESS_EVENTS_IN_CONSUMER_DISCOVER.md §3.4
 */

export interface PartyTypeOption {
  readonly slug: string;
  readonly label: string;
}

export interface VibeTagOption {
  readonly slug: string;
  readonly label: string;
  readonly emoji: string;
}

export interface MusicGenreOption {
  readonly slug: string;
  readonly label: string;
  /**
   * Ticketmaster `DiscoverGenreSlug` mapping. `null` = no TM analog —
   * applying this Mingla genre filter MUST suppress Ticketmaster from
   * the merged Discover response (per I-PROPOSED-DISCOVER-TM-SUPPRESSION).
   */
  readonly tmSlug: string | null;
}

export const PARTY_TYPES: readonly PartyTypeOption[] = [
  { slug: "birthday-party",    label: "Birthday Party" },
  { slug: "rooftop-party",     label: "Rooftop Party" },
  { slug: "club-night",        label: "Club Night" },
  { slug: "house-party",       label: "House Party" },
  { slug: "warehouse-party",   label: "Warehouse Party" },
  { slug: "beach-party",       label: "Beach Party" },
  { slug: "pool-party",        label: "Pool Party" },
  { slug: "boat-party",        label: "Boat Party" },
  { slug: "themed-party",      label: "Themed Party" },
  { slug: "corporate-event",   label: "Corporate Event" },
  { slug: "graduation-party",  label: "Graduation Party" },
  { slug: "holiday-party",     label: "Holiday Party" },
  { slug: "networking-event",  label: "Networking Event" },
  { slug: "rave",              label: "Rave" },
  { slug: "festival",          label: "Festival" },
] as const;

export const VIBE_TAGS: readonly VibeTagOption[] = [
  { slug: "energetic",  label: "Energetic",  emoji: "⚡" },
  { slug: "chill",      label: "Chill",      emoji: "😌" },
  { slug: "intimate",   label: "Intimate",   emoji: "🕯" },
  { slug: "wild",       label: "Wild",       emoji: "🎉" },
  { slug: "classy",     label: "Classy",     emoji: "🥂" },
  { slug: "casual",     label: "Casual",     emoji: "👕" },
  { slug: "upscale",    label: "Upscale",    emoji: "💎" },
  { slug: "underground",label: "Underground",emoji: "🔒" },
  { slug: "mainstream", label: "Mainstream", emoji: "🌟" },
  { slug: "artsy",      label: "Artsy",      emoji: "🎨" },
  { slug: "social",     label: "Social",     emoji: "🤝" },
  { slug: "exclusive",  label: "Exclusive",  emoji: "👑" },
  { slug: "laid-back",  label: "Laid-back",  emoji: "🌴" },
  { slug: "vibrant",    label: "Vibrant",    emoji: "🌈" },
  { slug: "retro",      label: "Retro",      emoji: "📻" },
  { slug: "futuristic", label: "Futuristic", emoji: "🚀" },
] as const;

export const MUSIC_GENRES: readonly MusicGenreOption[] = [
  { slug: "electronic-edm",   label: "Electronic/EDM",   tmSlug: "dance-electronic" },
  { slug: "hiphop-rap",       label: "Hip-Hop/Rap",      tmSlug: "hiphop-rap" },
  { slug: "pop",              label: "Pop",              tmSlug: "pop" },
  { slug: "rock",             label: "Rock",             tmSlug: "rock" },
  { slug: "latin",            label: "Latin",            tmSlug: "latin" },
  { slug: "afrobeats",        label: "Afrobeats",        tmSlug: "afro" },
  { slug: "rnb-soul",         label: "R&B/Soul",         tmSlug: "rnb" },
  { slug: "disco-funk",       label: "Disco/Funk",       tmSlug: null },
  { slug: "reggae-dancehall", label: "Reggae/Dancehall", tmSlug: "reggae" },
  { slug: "indie",            label: "Indie",            tmSlug: "alternative" },
  { slug: "country",          label: "Country",          tmSlug: "country" },
  { slug: "jazz",             label: "Jazz",             tmSlug: "jazz" },
  { slug: "classical",        label: "Classical",        tmSlug: "classical" },
  { slug: "mixed-variety",    label: "Mixed/Variety",    tmSlug: null },
] as const;

export const PARTY_TYPE_SLUGS: readonly string[] = PARTY_TYPES.map((p) => p.slug);
export const VIBE_TAG_SLUGS:   readonly string[] = VIBE_TAGS.map((v) => v.slug);
export const MUSIC_GENRE_SLUGS: readonly string[] = MUSIC_GENRES.map((g) => g.slug);

/**
 * Resolve a set of Mingla music-genre slugs to:
 *   - tmMappable: the TM `DiscoverGenreSlug` values to forward upstream
 *   - minglaOnly: the Mingla slugs that have NO TM analog (tmSlug === null)
 *
 * Caller decision (per I-PROPOSED-DISCOVER-TM-SUPPRESSION):
 *   - If the filter contains ONLY Mingla-only values → skip TM entirely.
 *   - If the filter contains any tmMappable value → forward tmMappable to TM.
 *     Mingla-only values still filter the business-events side; TM never
 *     sees them.
 *   - Empty input → no genre filter applied to TM (current behavior).
 */
export function mapMinglaMusicGenresToTmSlugs(
  minglaSlugs: readonly string[],
): { tmMappable: string[]; minglaOnly: string[] } {
  const tmMappable: string[] = [];
  const minglaOnly: string[] = [];
  const lookup = new Map<string, string | null>(
    MUSIC_GENRES.map((g) => [g.slug, g.tmSlug] as const),
  );
  for (const slug of minglaSlugs) {
    if (!lookup.has(slug)) continue;
    const tm = lookup.get(slug)!;
    if (tm === null) minglaOnly.push(slug);
    else tmMappable.push(tm);
  }
  return { tmMappable, minglaOnly };
}

/** Returns true if every slug in `input` is in `canonical`. */
export function isSubsetOf(
  input: readonly string[],
  canonical: readonly string[],
): boolean {
  const set = new Set(canonical);
  return input.every((s) => set.has(s));
}
