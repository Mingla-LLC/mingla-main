/**
 * #3388 — the "Take orders through Mingla" switch, explained.
 *
 * `biz_venue_ordering_set_enabled` refuses to turn ordering ON for a venue that
 * isn't verified (`venue_not_orderable`). The switch called `mutate` with no
 * error handling, so on a venue still in review it flicked back and said
 * nothing — on camera, it looked broken.
 *
 * Two pure pieces:
 *   - `orderingSwitchState` decides whether the switch can be used and what the
 *     card says, BEFORE anyone taps (the refusal is predictable from the claim
 *     status, so it should never be discovered by tapping);
 *   - `orderingSwitchErrorCopy` turns any refusal that still happens into a
 *     sentence, so no failure is silent.
 */

import type { BrandClaimStatus } from "../../types/brand";

export const ORDERING_NOT_LIVE_COPY =
  "Ordering turns on once your venue is live. Mingla is still reviewing it.";
export const ORDERING_UNAVAILABLE_COPY =
  "Ordering is unavailable while your venue isn't live on Mingla.";
export const ORDERING_SWITCH_FAILED_COPY =
  "Couldn't change ordering. Check your connection and try again.";
export const ORDERING_NOT_ALLOWED_COPY =
  "Only a manager or the owner can change ordering.";

export interface OrderingSwitchState {
  disabled: boolean;
  /** Why the switch is unavailable, or null when it works normally. */
  note: string | null;
}

export function orderingSwitchState(input: {
  claimStatus: BrandClaimStatus | null | undefined;
  orderingEnabled: boolean;
  canDecideMoney: boolean;
  pending: boolean;
}): OrderingSwitchState {
  if (!input.canDecideMoney || input.pending) {
    return { disabled: true, note: null };
  }
  // Switching OFF is always allowed — a venue must never be stuck taking orders.
  if (input.orderingEnabled) return { disabled: false, note: null };
  if (input.claimStatus === "verified") return { disabled: false, note: null };
  // Unknown while the venue loads: hold the switch, say nothing yet.
  if (input.claimStatus == null) return { disabled: true, note: null };
  if (input.claimStatus === "none" || input.claimStatus === "pending_review") {
    return { disabled: true, note: ORDERING_NOT_LIVE_COPY };
  }
  return { disabled: true, note: ORDERING_UNAVAILABLE_COPY };
}

/** Reads the `{ error }` code out of a supabase-js FunctionsHttpError. */
async function staffErrorCode(error: unknown): Promise<string | null> {
  if (error === null || typeof error !== "object") return null;
  const context = (error as { context?: unknown }).context;
  if (
    context !== null &&
    typeof context === "object" &&
    typeof (context as { text?: unknown }).text === "function"
  ) {
    try {
      const raw = await (context as { text: () => Promise<string> }).text();
      const parsed = JSON.parse(raw) as { error?: unknown };
      return typeof parsed.error === "string" ? parsed.error : null;
    } catch {
      return null;
    }
  }
  const message = (error as { message?: unknown }).message;
  return typeof message === "string" && /^[a-z_]+$/.test(message)
    ? message
    : null;
}

export async function orderingSwitchErrorCopy(error: unknown): Promise<string> {
  const code = await staffErrorCode(error);
  if (code === "venue_not_orderable") return ORDERING_NOT_LIVE_COPY;
  if (code === "not_authorized") return ORDERING_NOT_ALLOWED_COPY;
  return ORDERING_SWITCH_FAILED_COPY;
}
