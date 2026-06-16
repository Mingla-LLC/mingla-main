/**
 * ORCH-1150 — pure RSVP error-code parsing (no RN / no supabase import).
 *
 * supabase.functions.invoke surfaces a non-2xx from the public-submit-rsvp edge
 * fn as a FunctionsHttpError whose `context.body` carries the `{ error }` code.
 * The public page maps that code to an inline message (rsvp_contact_required /
 * rsvp_phone_invalid / rsvp_full / rsvp_not_open). Extracted so it's unit-testable
 * without importing the react-native supabase client. See SPEC §6 / §5.3.
 */

export interface RsvpInvokeError {
  message?: string;
  context?: { body?: unknown };
}

/**
 * Resolve the canonical RSVP error code from a functions-invoke error. Prefers
 * the `{ error }` code embedded in the response body (string or already-parsed
 * object); falls back to `error.message`; then to "rsvp_write_failed".
 */
export const parseRsvpErrorCode = (error: RsvpInvokeError | null): string => {
  if (error === null) return "rsvp_write_failed";
  let code = error.message ?? "rsvp_write_failed";
  const body = error.context?.body;
  if (body !== undefined && body !== null) {
    try {
      const parsed =
        typeof body === "string"
          ? (JSON.parse(body) as { error?: string })
          : (body as { error?: string });
      if (typeof parsed.error === "string" && parsed.error.length > 0) {
        code = parsed.error;
      }
    } catch {
      // malformed body → keep the message/default code
    }
  }
  return code;
};
