/**
 * rsvpRpcFailure — issue #3047 [rsvp-publish-reachable].
 *
 * Pure, RN-free reader for a FAILED RSVP `supabase.rpc()` call, plus the
 * user-facing copy that failure must produce. No react-native import, no
 * supabase import, so it is unit-testable without mounting a render tree.
 *
 * # Why this exists
 *
 * Driving the shipped production Business build on a real iOS Simulator,
 * Preview (6/6) → Publish RSVP → Publish produced, twice:
 *
 *   POST | 404 | .../rest/v1/rpc/business_publish_rsvp_graph
 *
 * and the organiser saw NOTHING — no error, no toast, no state change. A
 * definite server answer rendered as though the button had never been pressed.
 * Two independent defects made that possible, and this module fixes the second
 * one (the migration fixes the first):
 *
 *  1. **A PostgREST error is a PLAIN OBJECT, not an `Error`.**
 *     `supabase.rpc()` resolves `{ data: null, error: PostgrestError }` where
 *     the error is `{ message, details, hint, code }` — a bare object. The RSVP
 *     services `throw error` verbatim, so every downstream reader written as
 *     `error instanceof Error ? error.message : String(error)` collapsed the
 *     whole failure to the literal string `"[object Object]"`. Nothing could
 *     match a guard reason, and the generic fallback was the only branch left.
 *     `readRpcFailureMessage` reads the message off BOTH shapes.
 *
 *  2. **"Try again" is a lie for a missing function.** PostgREST answers
 *     `PGRST202` / HTTP 404 when the RPC is not in the schema cache, and
 *     Postgres answers `42883` for an undefined function. Neither is transient:
 *     retrying cannot succeed, ever, until a migration ships. Telling the user
 *     to try again sends them into an unbounded retry loop against a wall —
 *     the exact failure issue #2333 cost us for two days with `city_required`.
 *     `isMissingRpcFailure` separates the terminal case so the copy can say
 *     what is actually true: this is broken on our side, not theirs.
 *
 * The precedent for the code set is the shipped edge function
 * `supabase/functions/event-cover-video-upload-intent/index.ts`
 * (`isMissingDeterministicContract`), which already treats
 * `PGRST202 / PGRST204 / 42883 / 42703` as "the deterministic contract is not
 * deployed".
 */

/**
 * The two error shapes an RSVP RPC caller can be handed: a real `Error`
 * (thrown by our own service code) or the bare PostgREST object.
 */
interface RpcFailureShape {
  message?: unknown;
  code?: unknown;
  details?: unknown;
  hint?: unknown;
}

const asFailureShape = (error: unknown): RpcFailureShape | null =>
  error !== null && typeof error === "object"
    ? (error as RpcFailureShape)
    : null;

/**
 * Read the failure's message off an `Error`, a PostgREST plain object, or a
 * raw string. NEVER returns `"[object Object]"` — an object with no readable
 * message yields the empty string, which every caller treats as "unknown".
 */
export const readRpcFailureMessage = (error: unknown): string => {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  const shape = asFailureShape(error);
  if (shape === null) return "";
  if (typeof shape.message === "string") return shape.message;
  return "";
};

/** Read the PostgREST / Postgres error code, when the failure carries one. */
export const readRpcFailureCode = (error: unknown): string | null => {
  const shape = asFailureShape(error);
  if (shape === null) return null;
  return typeof shape.code === "string" && shape.code.length > 0
    ? shape.code
    : null;
};

/**
 * Codes that mean "the thing the client called is not deployed". Mirrors the
 * shipped edge-function set. `PGRST202` is the 404 this issue was opened on;
 * `42883` is Postgres's own undefined_function; the two `20*` codes are their
 * column-level twins, which a schema drift produces from the same cause.
 */
const MISSING_CONTRACT_CODES = ["PGRST202", "PGRST204", "42883", "42703"];

/**
 * True when the failure is TERMINAL because the server has no such routine.
 * A terminal failure must never be presented as retryable.
 *
 * Matched on the code when one is present, and on the message otherwise —
 * PostgREST's 404 body reads
 *   `Could not find the function public.business_publish_rsvp_graph(...) in the schema cache`
 * and Postgres's undefined_function reads
 *   `function public.business_publish_rsvp_graph(uuid, uuid) does not exist`.
 * Both are matched, because a message can reach us through a re-thrown `Error`
 * that dropped the code.
 */
export const isMissingRpcFailure = (error: unknown): boolean => {
  const code = readRpcFailureCode(error);
  if (code !== null && MISSING_CONTRACT_CODES.includes(code)) return true;
  const message = readRpcFailureMessage(error).toLowerCase();
  if (message.length === 0) return false;
  if (message.includes("in the schema cache")) return true;
  if (/could not find the (?:function|table)/.test(message)) return true;
  if (/function .* does not exist/.test(message)) return true;
  return false;
};

/**
 * The single copy contract for a failed RSVP write.
 *
 * `action` names what the organiser was doing, in their words, so the sentence
 * reads naturally: "We couldn't publish this RSVP." / "We couldn't update
 * Amara." It is NEVER a function name — the user does not care which RPC 404'd.
 *
 * Terminal → says the failure is ours and that retrying will not help, so the
 * organiser stops hammering a button that cannot work and tells us instead.
 * Transient → keeps the existing retry invitation.
 */
export const rsvpRpcFailureCopy = (
  error: unknown,
  action: string,
): string => {
  if (isMissingRpcFailure(error)) {
    return `We couldn't ${action}. This is a problem on our side, not something you did — retrying won't help. Please contact support@usemingla.com so we can fix it.`;
  }
  return `We couldn't ${action}. Try again.`;
};

/**
 * `true` when retrying could plausibly succeed. Surfaces that offer a retry
 * control use this to decide whether the control is honest.
 */
export const isRetryableRsvpRpcFailure = (error: unknown): boolean =>
  !isMissingRpcFailure(error);

/**
 * A real `Error` carrying a PostgREST failure's `message` AND `code`.
 *
 * The RSVP services used to `throw error` — the bare PostgREST object — which
 * made every `error instanceof Error` reader downstream take its else-branch
 * and stringify the object to `"[object Object]"`. Re-throwing through this
 * class keeps the message byte-identical (so the existing
 * `resolvePaidPublishGuardCopy(error.message)` guard matching still works
 * unchanged) while making the value an `Error` and preserving the code that
 * `isMissingRpcFailure` needs to tell terminal from transient.
 *
 * SUBTRACT, don't layer: this replaces `throw error`, it does not wrap it in a
 * second try/catch.
 */
export class RsvpRpcError extends Error {
  /** PostgREST / Postgres code, when the failure carried one. */
  public readonly code: string | null;

  /** The original failure value, for logging. Never rendered to a user. */
  public readonly cause: unknown;

  public constructor(error: unknown, fallbackMessage: string) {
    const message = readRpcFailureMessage(error);
    super(message.length > 0 ? message : fallbackMessage);
    this.name = "RsvpRpcError";
    this.code = readRpcFailureCode(error);
    this.cause = error;
  }
}
