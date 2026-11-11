// Issue #4383 — what the Communications screens say when the server refuses.
// Each server code maps to plain words; the code is kept beside them so a
// report always names what happened. Never an empty list, never "Something
// went wrong" alone.
//
// Pure module: no React, no Supabase, so the plain node tests run it.

export const COMMUNICATIONS_ERROR_COPY = Object.freeze({
  scheduled_time_past: "Pick a time at least a minute from now.",
  invalid_timezone: "Pick a real timezone.",
  invalid_title: "The title must be 1 to 65 characters.",
  invalid_body: "The message must be 1 to 178 characters.",
  invalid_audience: "Pick who gets it.",
  invalid_destination: "Pick a screen it opens from the list.",
  stale_revision: "Someone changed this push since you opened it. Reload to see the latest.",
  already_sending: "This push already started sending, so it can't be changed.",
  push_rate_limited: "Another push went out less than a minute ago. Try again in a minute.",
  test_rate_limited: "You already sent a test this minute. Try again in a minute.",
  already_published: "It already went out, so it can't be changed.",
  already_sent: "This notice already went out, so it can't be cancelled.",
  not_schedulable: "Only a draft can be scheduled.",
  not_editable: "A published announcement can't be edited.",
  roadmap_notify_rate_limited: "Hosts were told about a roadmap change less than a minute ago. Try again in a minute.",
  no_published_roadmap: "Publish at least one roadmap card first.",
  campaign_not_reschedulable: "This email already started sending, so it can't be changed.",
  not_authorized: "Only someone with access to this screen can do this.",
  not_found: "It isn't there any more. Reload to see the latest.",
});

const CODES = Object.keys(COMMUNICATIONS_ERROR_COPY);

/** The server code inside an error, or null. */
export function communicationsErrorCode(error) {
  const text = `${error?.code || ""} ${error?.message || ""} ${error?.details || ""}`;
  return CODES.find((code) => new RegExp(`\\b${code}\\b`).test(text)) || null;
}

/**
 * Plain words for an error, with its code in brackets. A CommunicationsError
 * already carries those words, so it is returned as is: never worded twice
 * (tester P2-3).
 */
export function communicationsErrorMessage(error, fallback = "The server didn't accept that.") {
  if (error instanceof CommunicationsError) return error.message;
  const code = communicationsErrorCode(error);
  if (code) return `${COMMUNICATIONS_ERROR_COPY[code]} (${code})`;
  const raw = String(error?.message || "").trim();
  const sqlstate = typeof error?.code === "string" && error.code ? ` (${error.code})` : "";
  return raw ? `${fallback} ${raw}${sqlstate}` : `${fallback}${sqlstate}`;
}

/** An Error that carries the server code, for services to throw. */
export class CommunicationsError extends Error {
  constructor(error) {
    super(communicationsErrorMessage(error));
    this.name = "CommunicationsError";
    this.code = communicationsErrorCode(error) || error?.code || null;
    // The server's own error, untouched (for logs and for a code check).
    this.raw = error;
  }
}
