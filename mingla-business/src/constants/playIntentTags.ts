/**
 * Ve6 — Play venue intent tags (mirrors supabase/functions/_shared/playIntentTags.ts).
 */

export const PLAY_INTENT_TAGS = [
  "friends_chill",
  "group_activity",
  "date_night_active",
  "family_friendly",
  "solo_exploration",
] as const;

export type PlayIntentTag = (typeof PLAY_INTENT_TAGS)[number];

const PLAY_INTENT_SET = new Set<string>(PLAY_INTENT_TAGS);

/** Filters tags to Play allowlist (mirrors server playIntentTags.ts). */
export function filterPlayIntentTags(raw: unknown): PlayIntentTag[] {
  if (!Array.isArray(raw)) return [];
  const out: PlayIntentTag[] = [];
  for (const t of raw) {
    if (typeof t !== "string") continue;
    const normalized = t.trim().toLowerCase().replace(/\s+/g, "_");
    if (PLAY_INTENT_SET.has(normalized) && !out.includes(normalized as PlayIntentTag)) {
      out.push(normalized as PlayIntentTag);
    }
    if (out.length >= 12) break;
  }
  return out;
}
