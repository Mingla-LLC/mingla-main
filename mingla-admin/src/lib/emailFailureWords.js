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
