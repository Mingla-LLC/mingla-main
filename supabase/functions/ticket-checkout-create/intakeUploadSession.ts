import {
  createCheckoutAttemptId,
  isCheckoutAttemptId,
} from "../../../packages/offering-rendering/ticketCheckoutContract.ts";

/**
 * Legacy checkout clients predate upload drafts. Give their non-file intake a
 * private server draft while still rejecting a present malformed identifier.
 * A file claim cannot bind to this fresh UUID, so file intake remains closed.
 */
export function resolveIntakeUploadSessionId(
  value: unknown,
  createId: () => string = createCheckoutAttemptId,
): string | null {
  if (value === undefined) return createId();
  return isCheckoutAttemptId(value) ? value : null;
}
