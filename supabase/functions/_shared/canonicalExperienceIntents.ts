// ORCH-1146 — canonical experience-intent mapping (Ve5 menu + Ve6 Play).
//
// The experience parsers emit their own tag taxonomies (Ve5: free-text;
// Ve6: the Play allowlist `friends_chill|group_activity|date_night_active|
// family_friendly|solo_exploration`). The `events.experience_intents` column,
// however, accepts ONLY the canonical 4-id vocabulary enforced by the DB CHECK
// `events_experience_intents_chk` (migration
// `20260828000000_meta_orch_1059_experience_intents_multi.sql:57-62`) and
// mirrored by the business-app wizard vocab
// (`mingla-business/src/constants/experienceIntents.ts:44-49`).
//
// This helper maps the parser tags → the canonical ids DETERMINISTICALLY in the
// confirm executor (NOT in the Gemini prompt — keeps a single, testable source
// of truth, no LLM variance, and leaves the Play allowlist intact). Unmappable
// tags are DROPPED (Constitution #9 — never fabricate a vibe). When nothing
// maps, an empty array is returned and the executor writes NULL to the column
// (NEVER an empty array — the CHECK requires length 1–4 when non-null).
//
// ⚠️ KEEP THE ID LIST BYTE-IDENTICAL to:
//   - the DB CHECK (`20260828000000…:62-64`), and
//   - `mingla-business/src/constants/experienceIntents.ts:44-49` (EXPERIENCE_INTENTS).
// Any drift here will produce CHECK-violating writes.

export const CANONICAL_EXPERIENCE_INTENTS = [
  "adventurous",
  "first-date",
  "romantic",
  "group-fun",
] as const;

export type CanonicalExperienceIntent =
  (typeof CANONICAL_EXPERIENCE_INTENTS)[number];

const CANONICAL_SET = new Set<string>(CANONICAL_EXPERIENCE_INTENTS);

// Play-vocab tags (Ve6) → canonical id. LOCKED by Seth (SPEC §4.4 / Q1):
//   family_friendly → group-fun (no "family" canonical id)
//   solo_exploration → adventurous (no "solo" canonical id)
const PLAY_TAG_MAP: Record<string, CanonicalExperienceIntent> = {
  group_activity: "group-fun",
  friends_chill: "group-fun",
  family_friendly: "group-fun",
  date_night_active: "romantic",
  solo_exploration: "adventurous",
};

// Free-text keyword mapping (Ve5). Each rule is a substring match against the
// normalized tag (lowercased, trimmed, spaces→underscores). Rules are applied
// IN ORDER; the first matching rule wins for a given tag (romantic > first-date
// > adventurous > group-fun). Intentionally conservative: anything matching no
// rule is DROPPED (never invented). SPEC §4.4 table.
const KEYWORD_RULES: Array<
  { id: CanonicalExperienceIntent; substrings: string[] }
> = [
  {
    id: "romantic",
    substrings: [
      "romantic",
      "date_night",
      "date-night",
      "couple",
      "intimate",
      "candlelit",
      "tasting_menu",
      "wine_pairing",
      "anniversary",
    ],
  },
  {
    id: "first-date",
    substrings: [
      "first_date",
      "first-date",
      "casual_date",
      "meet",
      "icebreaker",
    ],
  },
  {
    id: "adventurous",
    substrings: [
      "adventur",
      "explore",
      "thrill",
      "outdoor",
      "active",
      "solo",
      "discover",
    ],
  },
  {
    id: "group-fun",
    substrings: [
      "group",
      "friends",
      "family",
      "party",
      "social",
      "shareable",
      "bottomless",
      "brunch",
      "happy_hour",
      "crew",
      "team",
    ],
  },
];

function normalizeTag(tag: string): string {
  return tag.trim().toLowerCase().replace(/\s+/g, "_");
}

/** Map ONE raw tag → a canonical id, or null if it maps to nothing. */
function mapOneTag(tag: string): CanonicalExperienceIntent | null {
  const norm = normalizeTag(tag);
  if (!norm) return null;

  // 1. If the tag is ALREADY a canonical id (e.g. an Ari caller passing
  //    'group-fun' directly), keep it. (Underscore-normalization turns the
  //    hyphenated ids into 'group_fun'/'first_date', so check both forms.)
  if (CANONICAL_SET.has(tag.trim().toLowerCase())) {
    return tag.trim().toLowerCase() as CanonicalExperienceIntent;
  }
  const hyphenated = norm.replace(/_/g, "-");
  if (CANONICAL_SET.has(hyphenated)) {
    return hyphenated as CanonicalExperienceIntent;
  }

  // 2. Play allowlist exact-tag map (Ve6).
  const play = PLAY_TAG_MAP[norm];
  if (play) return play;

  // 3. Free-text keyword rules (Ve5), first-match-wins by rule order.
  for (const rule of KEYWORD_RULES) {
    for (const sub of rule.substrings) {
      if (norm.includes(sub)) return rule.id;
    }
  }

  // 4. Unmappable → DROP.
  return null;
}

/**
 * Map an arbitrary `intent_tags` value (free-text Ve5 or Play-vocab Ve6) to the
 * canonical 4-id vocabulary. Dedups, preserves the order of
 * CANONICAL_EXPERIENCE_INTENTS, caps at 4, drops unmappable tags. Returns `[]`
 * when nothing maps (caller writes NULL — never an empty array).
 *
 * @param rawTags  the parser's `intent_tags` (any shape; non-arrays → []).
 * @param _venueCategory  reserved for future per-category mapping; unused today
 *   (the mapping is taxonomy-driven, not category-gated). Accepted so the
 *   executor can pass it without a future signature change.
 */
export function mapToCanonicalExperienceIntents(
  rawTags: unknown,
  _venueCategory: string | null,
): CanonicalExperienceIntent[] {
  if (!Array.isArray(rawTags)) return [];

  const matched = new Set<CanonicalExperienceIntent>();
  for (const tag of rawTags) {
    if (typeof tag !== "string") continue;
    const id = mapOneTag(tag);
    if (id) matched.add(id);
  }

  // Preserve canonical order; cap at 4 (the full set is exactly 4).
  return CANONICAL_EXPERIENCE_INTENTS.filter((id) => matched.has(id)).slice(
    0,
    4,
  );
}
