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
 * Adding or removing a party / event type slug requires (#4572 item 6 did all):
 *   1. Update all three modules byte-equivalently.
 *   2. Update packages/offering-rendering/taxonomyLabels.ts (ORCH-1292 gate).
 *   3. A migration re-emitting the events_party_types_canonical CHECK and the
 *      six SQL copies (the four publish / patch gates, ari_execute_event_operation,
 *      discover_v2_facets_exact): see 20281129704572_issue_4572_event_types.sql.
 *   4. The 29 consumer locale files (discover.json taxonomy.party.*).
 *   5. Re-run CI to verify parity.
 *
 * See: Mingla_Artifacts/specs/SPEC_ORCH-0824_BUSINESS_EVENTS_IN_CONSUMER_DISCOVER.md §3.4
 */

export type PartyTypeGroup = "party" | "culture";

export interface PartyTypeOption {
  readonly slug: string;
  readonly label: string;
  /**
   * #4572 item 6 (D6) — the field is "Event type" in host and guest copy.
   * Hosts and guests see the list in two groups, in this array's order:
   * "Parties" and "Culture & learning".
   */
  readonly group: PartyTypeGroup;
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
  { slug: "birthday-party",    label: "Birthday Party",     group: "party" },
  { slug: "club-night",        label: "Club Night",         group: "party" },
  { slug: "house-party",       label: "House Party",        group: "party" },
  { slug: "rooftop-party",     label: "Rooftop Party",      group: "party" },
  { slug: "themed-party",      label: "Themed Party",       group: "party" },
  { slug: "festival",          label: "Festival",           group: "party" },
  { slug: "warehouse-party",   label: "Warehouse Party",    group: "party" },
  { slug: "beach-party",       label: "Beach Party",        group: "party" },
  { slug: "pool-party",        label: "Pool Party",         group: "party" },
  { slug: "boat-party",        label: "Boat Party",         group: "party" },
  { slug: "graduation-party",  label: "Graduation Party",   group: "party" },
  { slug: "holiday-party",     label: "Holiday Party",      group: "party" },
  { slug: "rave",              label: "Rave",               group: "party" },
  { slug: "exhibition",        label: "Exhibition",         group: "culture" },
  { slug: "opening",           label: "Opening / launch",   group: "culture" },
  { slug: "talk",              label: "Talk",               group: "culture" },
  { slug: "workshop",          label: "Workshop",           group: "culture" },
  { slug: "screening",         label: "Screening",          group: "culture" },
  { slug: "kids-family",       label: "Kids & family",      group: "culture" },
  { slug: "class",             label: "Class",              group: "culture" },
  { slug: "market",            label: "Market",             group: "culture" },
  { slug: "tour",              label: "Tour",               group: "culture" },
  { slug: "performance",       label: "Performance",        group: "culture" },
  { slug: "tasting",           label: "Tasting",            group: "culture" },
  { slug: "networking-event",  label: "Networking Event",   group: "culture" },
  { slug: "corporate-event",   label: "Corporate Event",    group: "culture" },
] as const;

/** #4572 item 6 — the two headed groups of the Event type list (host copy). */
export const PARTY_TYPE_GROUPS: readonly { readonly id: PartyTypeGroup; readonly label: string }[] = [
  { id: "party",   label: "Parties" },
  { id: "culture", label: "Culture & learning" },
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
  { slug: "house",            label: "House",            tmSlug: null },
  { slug: "hiphop-rap",       label: "Hip-Hop/Rap",      tmSlug: "hiphop-rap" },
  { slug: "pop",              label: "Pop",              tmSlug: "pop" },
  { slug: "rock",             label: "Rock",             tmSlug: "rock" },
  { slug: "latin",            label: "Latin",            tmSlug: "latin" },
  { slug: "afrobeats",        label: "Afrobeats",        tmSlug: "afro" },
  { slug: "afro-house",       label: "Afro House",       tmSlug: null },
  { slug: "amapiano",         label: "Amapiano",         tmSlug: null },
  { slug: "gospel",           label: "Gospel",           tmSlug: null },
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
