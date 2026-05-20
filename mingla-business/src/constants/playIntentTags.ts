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
