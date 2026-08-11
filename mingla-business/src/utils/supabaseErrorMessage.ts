/**
 * supabaseErrorMessage — turn a Supabase/PostgREST failure into something a
 * human can act on, without ever showing raw database text to a user. Issue #1835.
 *
 * THE BUG THIS EXISTS TO KILL
 * ---------------------------
 * `@supabase/postgrest-js` only constructs a real `PostgrestError extends Error`
 * on the `shouldThrowOnError` path. The `{ data, error }` path this codebase uses
 * does `error = JSON.parse(body)` — a PLAIN OBJECT `{ message, code, details,
 * hint }`. So the widespread guard
 *
 *     error instanceof Error ? error.message : "<generic fallback>"
 *
 * is INVERTED: it is true only for errors the app constructed itself (whose
 * messages are developer jargon) and false for every error the DATABASE returned
 * (the only ones that carry the real reason). Users got the generic fallback for
 * genuine 403s while internal debug strings leaked through for app-thrown errors.
 *
 * `normalizeSupabaseError` collapses that fork: it reads `message`/`code`/
 * `details`/`hint` off plain objects as well as `Error` instances and always
 * returns a real `Error`, so no downstream `instanceof Error` check can silently
 * drop the reason.
 *
 * Prior art in this repo that already did it right and was never generalised:
 * `src/utils/sanitizeAuthoringError.ts` (reads `.message` off plain objects, and
 * maps a `forbidden` server response to owner-facing copy).
 */

/** A real `Error` that preserves the PostgREST diagnostic fields. */
export interface NormalizedSupabaseError extends Error {
  code?: string;
  details?: string;
  hint?: string;
}

function readStringField(source: object, key: string): string | undefined {
  if (!(key in source)) return undefined;
  const value = (source as Record<string, unknown>)[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * Coerce anything thrown by a Supabase call into a real `Error` carrying the
 * server's own `message` / `code` / `details` / `hint` where present.
 *
 * `fallbackMessage` is used ONLY when no usable message can be recovered, so a
 * genuine server reason is never overwritten.
 */
export function normalizeSupabaseError(
  raw: unknown,
  fallbackMessage: string,
): NormalizedSupabaseError {
  // Already an Error: keep the instance, but adopt any PostgREST fields riding
  // on it (supabase-js attaches `code` to some thrown errors).
  if (raw instanceof Error) {
    const enriched = raw as NormalizedSupabaseError;
    if (enriched.code === undefined) {
      const code = readStringField(raw, "code");
      if (code !== undefined) enriched.code = code;
    }
    return enriched;
  }

  if (typeof raw === "object" && raw !== null) {
    const message = readStringField(raw, "message") ?? fallbackMessage;
    const error = new Error(message) as NormalizedSupabaseError;
    error.name = "SupabaseError";
    const code = readStringField(raw, "code");
    const details = readStringField(raw, "details");
    const hint = readStringField(raw, "hint");
    if (code !== undefined) error.code = code;
    if (details !== undefined) error.details = details;
    if (hint !== undefined) error.hint = hint;
    return error;
  }

  if (typeof raw === "string" && raw.length > 0) {
    const error = new Error(raw) as NormalizedSupabaseError;
    error.name = "SupabaseError";
    return error;
  }

  const error = new Error(fallbackMessage) as NormalizedSupabaseError;
  error.name = "SupabaseError";
  return error;
}

/**
 * True when the failure is the database refusing on permission grounds.
 *
 * `42501` is Postgres `insufficient_privilege`, which is what an RLS USING or
 * WITH CHECK rejection raises (PostgREST surfaces it as HTTP 403). The message
 * probe is a belt-and-braces fallback for paths that lose the code — matching on
 * code alone would silently misclassify those as "unknown" and re-introduce a
 * bogus retry prompt.
 */
export function isPermissionDeniedError(raw: unknown): boolean {
  const error = normalizeSupabaseError(raw, "");
  if (error.code === "42501") return true;
  const message = error.message.toLowerCase();
  return (
    message.includes("row-level security") ||
    message.includes("permission denied")
  );
}

/**
 * True when the failure looks like connectivity rather than a decision by the
 * server. This is the ONLY class for which telling someone to try again is
 * honest.
 */
export function isLikelyOfflineError(raw: unknown): boolean {
  const error = normalizeSupabaseError(raw, "");
  const message = error.message.toLowerCase();
  return (
    message.includes("network request failed") ||
    message.includes("failed to fetch") ||
    message.includes("networkerror") ||
    message.includes("timed out") ||
    message.includes("timeout")
  );
}
