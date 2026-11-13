// Issue #4419 — why an Admin email didn't (fully) go out, in plain words.
//
// The codes come from admin-send-email (deliveryFailureCode /
// campaignFailureCode) and issue_4419_admin_email_delivery_summary. The raw
// provider text is never shown here: the detail page keeps it under
// "Technical detail for engineering".
//
// Pure module: no React, no Supabase, so a plain node test runs it.

export const EMAIL_FAILURE_WORDS = Object.freeze({
  rate_limited: "Our email provider paused us for sending too fast, partway through.",
  provider_key: "The email provider turned down our sending key, so nobody got this email. An engineer needs to update the key.",
  invalid_address: "Some addresses were turned down as invalid.",
  provider_down: "The email provider didn't answer.",
  blog_post_not_published: "The blog post in this email was unpublished, so we stopped sending.",
  email_snapshot_failed: "We couldn't save a copy of this email, so we didn't send it. Tell engineering.",
  campaign_recipient_snapshot_failed: "We couldn't save the list of people to send to, so we didn't send it. Tell engineering.",
  other: "Something went wrong sending to some people.",
});

/** The sentence for a failure code; anything unknown is "other". */
export function emailFailureWords(code) {
  return typeof code === "string" && Object.hasOwn(EMAIL_FAILURE_WORDS, code)
    ? EMAIL_FAILURE_WORDS[code]
    : EMAIL_FAILURE_WORDS.other;
}

/** "N people got it. M did not." (a partial send adds this). */
export function partialCountWords(accepted, missed) {
  const fmt = (n) => Number(n || 0).toLocaleString("en-US");
  const people = (n) => (Number(n) === 1 ? "person" : "people");
  return `${fmt(accepted)} ${people(accepted)} got it. ${fmt(missed)} did not.`;
}

// #4419 (tester P2-1): the saved copy became unreadable after some people
// already got it. Never "we didn't send it" when some did.
export const SNAPSHOT_FAILED_PARTWAY = "We couldn't read the saved copy of this email partway through, so we stopped sending. Tell engineering.";

/**
 * #4419 (tester P3-3) — what a screen or toast says when a request fails:
 * plain words, never a raw server code, never "the connection" for a server
 * error. The raw text comes back separately for the folded technical detail.
 */
export function emailErrorWords(error) {
  const raw = String(error?.message || "").trim();
  const status = Number(error?.status || 0);
  const technical = raw ? `${raw}${status ? ` (HTTP ${status})` : ""}` : status ? `HTTP ${status}` : null;
  const has = (code) => new RegExp(`\\b${code}\\b`).test(`${error?.code || ""} ${raw}`);
  let words;
  if (error?.name === "SessionExpiredError" || status === 401) words = "Your sign-in ended. Sign in again, then try once more.";
  else if (has("campaign_not_found")) words = "This email doesn't exist or was removed.";
  else if (has("campaign_not_reschedulable") || has("campaign_not_cancellable")) words = "This email already started sending, so it can't be changed.";
  else if (has("email_admin_only") || status === 403) words = "Only admins can open sent emails.";
  else if (has("test_send_limit")) words = "That's five tests this hour. Try again later.";
  else if (has("scheduled_time_past")) words = "Pick a time at least a minute from now.";
  else if (has("scheduled_timezone_invalid")) words = "Pick a real time zone.";
  else if (!status && (error?.name === "TypeError" || /failed to fetch|networkerror|network request failed|load failed/i.test(raw))) {
    words = "We couldn't reach the server. Check your connection and try again.";
  } else words = "Something went wrong on our side. Nothing was changed. Try again, and if it keeps happening, tell engineering.";
  return { words, technical };
}
