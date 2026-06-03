/**
 * META-ORCH-1059 [experiences-business-parity] · CHANGE 2 — curated-intent taxonomy.
 *
 * The SINGLE source of the 6 curated "intent / vibe" ids a brand picks for an
 * experience. The ids + human labels + descriptions are mirrored VERBATIM from
 * the consumer app's onboarding taxonomy
 * (`app-mobile/src/types/onboarding.ts` → `ONBOARDING_INTENTS`) so a brand
 * experience aligns with the consumer deck's `CuratedExperienceCard.experienceType`
 * taxonomy (`app-mobile/src/types/curatedExperience.ts`). The id strings MUST
 * stay byte-identical to the consumer list — the DB CHECK constraint in
 * `20260827000000_meta_orch_1059_wizard_intent_desc_validation.sql` enforces the
 * exact same 6 ids server-side.
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
  | "group-fun"
  | "picnic-dates"
  | "take-a-stroll";

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
 * The 6 curated intents, mirrored from `ONBOARDING_INTENTS` in the consumer app.
 * Order matches the consumer list.
 */
export const EXPERIENCE_INTENTS: readonly ExperienceIntentOption[] = [
  { id: "adventurous", label: "Adventurous", description: "Explore the unexpected", icon: "compass" },
  { id: "first-date", label: "First Dates", description: "Nail the first impression", icon: "sparkle" },
  { id: "romantic", label: "Romantic", description: "Turn up the spark", icon: "star" },
  { id: "group-fun", label: "Group Fun", description: "The more the merrier", icon: "users" },
  { id: "picnic-dates", label: "Picnic Dates", description: "Sun, snacks, good times", icon: "tag" },
  { id: "take-a-stroll", label: "Take a Stroll", description: "Wander with purpose", icon: "location" },
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
