/**
 * META-ORCH-1059 [experiences-business-parity] · CHANGE 2 — curated-intent taxonomy.
 *
 * The source of the curated "intent / vibe" ids a brand picks for an experience.
 * MULTI-select: a brand tags an experience with ≥1 of these vibes.
 *
 * Operator change (2026-06-02): REMOVED `picnic-dates` + `take-a-stroll` — they
 * don't fit brand-created experiences. Only these 4 remain; ids stay byte-
 * identical to the consumer onboarding taxonomy
 * (`app-mobile/src/types/onboarding.ts` → `ONBOARDING_INTENTS`) so a brand
 * experience aligns with the consumer deck's `CuratedExperienceCard.experienceType`
 * taxonomy. The DB CHECK in
 * `20260828000000_meta_orch_1059_experience_intents_multi.sql` enforces the EXACT
 * same 4 ids server-side (on both `experience_intents text[]` and the legacy
 * back-compat `experience_intent text` mirror).
 *
 * Icons are mapped to the mingla-business `IconName` union (a different icon set
 * than the consumer Ionicons), choosing the closest available glyph. Labels +
 * descriptions are NOT remapped.
 */

import type { IconName } from "../components/ui/Icon";

export type ExperienceIntentId =
  | "adventurous"
  | "first-date"
  | "romantic"
  | "group-fun";

export interface ExperienceIntentOption {
  id: ExperienceIntentId;
  /** Human label — identical to the consumer onboarding label. */
  label: string;
  /** Short tagline — identical to the consumer onboarding description. */
  description: string;
  /** Closest mingla-business Icon glyph (consumer uses Ionicons, business doesn't). */
  icon: IconName;
}

/**
 * The 4 curated intents, mirrored from `ONBOARDING_INTENTS` in the consumer app.
 * Order matches the consumer list.
 *
 * ⚠️ ORCH-1146: this id list is the SINGLE SOURCE OF TRUTH for experience vibes.
 * It is mirrored byte-for-byte by the DB CHECK `events_experience_intents_chk`
 * (migration `20260828000000_meta_orch_1059_experience_intents_multi.sql:62-64`)
 * and by the edge-side parser mapper
 * `supabase/functions/_shared/canonicalExperienceIntents.ts`
 * (CANONICAL_EXPERIENCE_INTENTS). Keep all three in sync — drift produces
 * CHECK-violating writes from the snap-confirm path.
 */
export const EXPERIENCE_INTENTS: readonly ExperienceIntentOption[] = [
  { id: "adventurous", label: "Adventurous", description: "Explore the unexpected", icon: "compass" },
  { id: "first-date", label: "First Dates", description: "Nail the first impression", icon: "sparkle" },
  { id: "romantic", label: "Romantic", description: "Turn up the spark", icon: "star" },
  { id: "group-fun", label: "Group Fun", description: "The more the merrier", icon: "users" },
] as const;

/** Set of valid intent ids for runtime narrowing (mirrors the DB CHECK). */
export const EXPERIENCE_INTENT_IDS: readonly ExperienceIntentId[] =
  EXPERIENCE_INTENTS.map((i) => i.id);

/** Narrow an arbitrary string to a valid intent id, or null. */
export function asExperienceIntent(value: string | null | undefined): ExperienceIntentId | null {
  if (value === null || value === undefined) return null;
  return (EXPERIENCE_INTENT_IDS as readonly string[]).includes(value)
    ? (value as ExperienceIntentId)
    : null;
}

/**
 * Normalise an arbitrary array (DB row / payload) to the canonical ordered,
 * deduped list of valid intent ids. Drops unknown/removed ids (e.g. legacy
 * `picnic-dates`/`take-a-stroll`). Order follows EXPERIENCE_INTENTS so the
 * picker + deck card render deterministically regardless of stored order.
 */
export function normalizeExperienceIntents(
  value: readonly (string | null | undefined)[] | null | undefined,
): ExperienceIntentId[] {
  if (value === null || value === undefined) return [];
  const present = new Set<ExperienceIntentId>();
  for (const raw of value) {
    const id = asExperienceIntent(typeof raw === "string" ? raw.trim() : raw);
    if (id !== null) present.add(id);
  }
  return EXPERIENCE_INTENTS.filter((o) => present.has(o.id)).map((o) => o.id);
}
