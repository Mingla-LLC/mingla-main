/**
 * adSendOutcome.ts — #4238 W1-2 (spec section 5.3). One owner for what a
 * conversion sender's `reason` means: which class it is in, whether it is
 * retried, for how long, and whether the tracking-health run alerts on it.
 *
 * Pure: no I/O, no Deno globals. Imported by the retry lane and the health
 * evaluator so both read the same table.
 */

export type FailureClass =
  | "config"
  | "auth"
  | "payload"
  | "transient"
  | "consent"
  | "consent_pending"
  | "not_applicable"
  | "unknown";

/** A sender could not run because a key, pixel or action is not configured. */
export const CONFIG_REASONS: ReadonlySet<string> = new Set([
  "no_token",
  "no_token_name",
  "no_pixel",
  "pending_config",
]);

/**
 * The platform refused the credential. TikTok answers HTTP 200 with a body
 * code; the sender maps it to `code_<n>`. Only code 40001 is named by the spec
 * (section 5.3); any other TikTok body code stays in the payload class until a
 * documented auth code is added here.
 */
export const AUTH_REASONS: ReadonlySet<string> = new Set([
  "http_401",
  "http_403",
  "code_40001",
]);

export const TRANSIENT_REASONS: ReadonlySet<string> = new Set([
  "timeout",
  "network_error",
  "sender_threw",
  "api_error",
]);

export const CONSENT_REASONS: ReadonlySet<string> = new Set([
  "consent_rejected",
  "tracking_opt_out",
]);

export const NOT_APPLICABLE_REASONS: ReadonlySet<string> = new Set([
  "no_google_click",
  "native_surface",
  "no_web_context",
  // #4238 W3-3: the platform has no event for this host-funnel kind.
  "no_channel_event",
]);

export function classifyReason(reason: string | null | undefined): FailureClass {
  if (typeof reason !== "string" || reason.length === 0) return "unknown";
  if (CONFIG_REASONS.has(reason)) return "config";
  if (AUTH_REASONS.has(reason)) return "auth";
  if (CONSENT_REASONS.has(reason)) return "consent";
  if (reason === "consent_pending_retryable") return "consent_pending";
  if (NOT_APPLICABLE_REASONS.has(reason)) return "not_applicable";
  if (TRANSIENT_REASONS.has(reason)) return "transient";
  const http = /^http_(\d{3})$/.exec(reason);
  if (http) {
    const code = Number(http[1]);
    if (code >= 500) return "transient";
    if (code >= 400) return "payload";
  }
  // Snap's 200-envelope failures, TikTok body codes and Google partial
  // failures are the platform rejecting this event's shape.
  if (
    /^code_\d+$/.test(reason) || reason === "partial_failure" ||
    /^(sub_)?request_status_/.test(reason) || reason === "event_error"
  ) {
    return "payload";
  }
  return "unknown";
}

/** Config and auth failures are retried for 72 h, so a key restore recovers them. */
export const isLongRetryClass = (cls: FailureClass): boolean =>
  cls === "config" || cls === "auth";
