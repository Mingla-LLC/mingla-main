// Issue #4276: the backlog hold. Intelligence results evaluated before this instant are
// held back from live decks until Seth releases them. The same instant lives in SQL as
// public.ai_score_hold_since() and in pg_meta_orch_1009_sub_d_select_stale_pairs; a
// Deno test reads both migrations and pins all three equal.
export const AI_SCORE_HOLD_SINCE = "2026-11-05T00:00:00Z";

const HOLD_MS = Date.parse(AI_SCORE_HOLD_SINCE);

/**
 * True when a place's AI slice for one signal predates the hold, or has no usable
 * evaluated_at. No slice at all is not held: the score is rules only.
 */
export function aiSliceIsHeld(slice: unknown): boolean {
  if (!slice || typeof slice !== "object") return false;
  const at = (slice as Record<string, unknown>).evaluated_at;
  if (typeof at !== "string") return true;
  const ms = Date.parse(at);
  return !Number.isFinite(ms) || ms < HOLD_MS;
}
