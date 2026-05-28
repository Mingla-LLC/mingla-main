import { supabase } from './supabase';

/**
 * ORCH-0977 — Client-side gate for user-generated content moderation.
 *
 * Calls the `moderate-content` edge function (OpenAI Moderation) before any
 * UGC insert (board messages, direct messages, place reviews, profile bio).
 * Required for Apple App Review Guideline 1.2 + Google Play UGC policy:
 * objectionable material must be filtered before it can be posted.
 *
 * FAILS OPEN: if the edge function is unreachable or errors, this returns
 * `{ allowed: true }` so a moderation outage never blocks legitimate users.
 * The report + block features backstop the residual risk.
 */

export interface ModerationResult {
  allowed: boolean;
  /** Human-readable reason shown to the user when blocked. */
  reason?: string;
  /** Triggered OpenAI categories (for logging / debugging). */
  categories?: string[];
}

const BLOCKED_MESSAGE =
  "This content goes against our community guidelines and can't be posted. Please revise and try again.";

/**
 * Check whether `text` is allowed to be posted.
 * @param text The candidate user-generated text.
 * @param context Optional short label (e.g. "board_message", "review") for server logs.
 */
export async function moderateText(
  text: string,
  context?: string,
): Promise<ModerationResult> {
  // Empty text is always allowed (nothing to moderate).
  if (!text || !text.trim()) {
    return { allowed: true };
  }

  try {
    const { data, error } = await supabase.functions.invoke('moderate-content', {
      body: { text, context: context ?? '' },
    });

    if (error) {
      // Fail open on transport error — do not block the user.
      console.warn('[moderationService] invoke error — failing open:', error);
      return { allowed: true };
    }

    if (data?.flagged === true) {
      return {
        allowed: false,
        reason: BLOCKED_MESSAGE,
        categories: Array.isArray(data.categories) ? data.categories : [],
      };
    }

    return { allowed: true };
  } catch (err) {
    // Fail open on any unexpected error.
    console.warn('[moderationService] unexpected error — failing open:', err);
    return { allowed: true };
  }
}
