/**
 * brandDeleteError — user-facing copy for a failed brand delete. Issue #1835.
 *
 * Three rules this module exists to enforce:
 *
 *  1. NEVER show raw database text to a user. Before this, a delete that failed
 *     the "0 rows updated" way rendered the literal internal string
 *     "softDeleteBrand: 0 rows updated — brand may not exist, may already be
 *     soft-deleted, or RLS denied. brandId=<uuid>" straight into the sheet.
 *  2. NEVER promise a remedy the code cannot justify. The old fallback said
 *     "Tap Delete to try again" from the UNKNOWN-error branch — the one branch
 *     that by definition has no idea whether retrying helps. A permanent 403 was
 *     dressed as a transient glitch, which is what produced the retry loop in the
 *     original report.
 *  3. Name the actual reason when the server gave us one. A permission refusal
 *     is a decision, not a glitch, and it has a specific remedy.
 *
 * Voice matches the existing precedent in `sanitizeAuthoringError.ts`
 * (`USER_SAFE_SERVER_MESSAGES.forbidden`), which was written for venue authoring
 * and never generalised.
 */

import {
  isLikelyOfflineError,
  isPermissionDeniedError,
} from "./supabaseErrorMessage";

export const BRAND_DELETE_OWNER_ONLY_MESSAGE =
  "Only the brand owner can delete this brand. Ask the owner to remove it, or transfer ownership first.";

export const BRAND_DELETE_OFFLINE_MESSAGE =
  "You appear to be offline. Check your connection, then tap Delete to try again.";

export const BRAND_DELETE_UNKNOWN_MESSAGE =
  "Something went wrong deleting this brand. We've logged it — contact support if it keeps happening.";

/**
 * Map a caught brand-delete failure to a user-safe sentence.
 *
 * Deliberately has NO branch that interpolates a server message: every path
 * returns one of the three vetted constants above.
 */
export function brandDeleteErrorMessage(raw: unknown): string {
  if (isPermissionDeniedError(raw)) return BRAND_DELETE_OWNER_ONLY_MESSAGE;
  if (isLikelyOfflineError(raw)) return BRAND_DELETE_OFFLINE_MESSAGE;
  return BRAND_DELETE_UNKNOWN_MESSAGE;
}
