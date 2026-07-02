/**
 * ORCH-1256 [brand profile completion to-dos] — pure emptiness predicates.
 *
 * Derives the 8 "this profile field is EMPTY" booleans from a mapped `Brand`
 * record so `businessTodos.ts` stays free of `Brand` type coupling (its
 * documented file contract). Consumed by `useBusinessTodos` (derive + pass)
 * and — type-only — by `businessTodos.ts` (band 6 input shape).
 *
 * Invariant I-PROPOSED-1256-PROFILE-TODOS-NO-FALSE-POSITIVE: a filled
 * (non-blank after trim) profile field NEVER shows its to-do row. Every
 * predicate below routes through the single `isBlank` so the trim rule
 * cannot drift per-field.
 */

import type { Brand } from "../types/brand";

/**
 * Blank = null/undefined OR trim-empty. Whitespace-only counts as EMPTY.
 * LOAD-BEARING for `address` / `photo` / `coverMediaUrl`, which are mapped
 * UNTRIMMED from the DB row (investigation F-2: `brandMapping.ts` passes
 * `row.address` raw and the edit form only nulls on length 0, so `"  "` is
 * persistable). Belt-and-braces for the pre-trimmed rest (contact/links/
 * tagline/bio are trimmed at map time).
 */
export function isBlank(value: string | null | undefined): boolean {
  return value == null || value.trim().length === 0;
}

/**
 * The 8 named social networks the aggregated "Add your social links" row
 * inspects. MIRRORS `SOCIAL_KEYS` in `services/brandMapping.ts` — declared
 * locally (do not import; brandMapping is out of this ORCH's lane) with this
 * sync comment. `links.custom` is intentionally EXCLUDED: no UI can author
 * it (custom-links UI deferred per BrandEditView.tsx header), so it never
 * counts as "has socials".
 */
export const SOCIAL_TODO_KEYS = [
  "website",
  "instagram",
  "tiktok",
  "x",
  "facebook",
  "youtube",
  "linkedin",
  "threads",
] as const;

export type SocialTodoKey = (typeof SOCIAL_TODO_KEYS)[number];

/** The 8 emptiness booleans band 6 of `buildBusinessTodos` consumes. */
export interface BusinessTodoProfileInput {
  needsCover: boolean;
  needsPhoto: boolean;
  needsTagline: boolean;
  needsDescription: boolean;
  needsAddress: boolean;
  needsEmail: boolean;
  needsPhone: boolean;
  needsSocials: boolean;
}

/**
 * Derive the 8 profile-completeness booleans (true = field EMPTY = row shows).
 *
 * - `needsCover` inspects `coverMediaUrl` ONLY — the `coverHue` fallback
 *   gradient is NOT a cover; hue-only brands still need one.
 * - `needsTagline`/`needsDescription`: tagline + bio share one DB column via
 *   the double-newline split (brandMapping F-7) — a single-paragraph
 *   description maps to bio only, so such brands correctly still get the
 *   tagline row (that IS an empty tagline in the data model).
 * - `needsSocials` is TRUE only when ALL 8 named networks are blank; one
 *   filled network suppresses the aggregated row.
 */
export function deriveBrandProfileTodoInput(
  brand: Brand,
): BusinessTodoProfileInput {
  return {
    needsCover: isBlank(brand.coverMediaUrl),
    needsPhoto: isBlank(brand.photo),
    needsTagline: isBlank(brand.tagline),
    needsDescription: isBlank(brand.bio),
    needsAddress: isBlank(brand.address),
    needsEmail: isBlank(brand.contact?.email),
    needsPhone: isBlank(brand.contact?.phone),
    needsSocials: SOCIAL_TODO_KEYS.every((key) =>
      isBlank(brand.links?.[key]),
    ),
  };
}
