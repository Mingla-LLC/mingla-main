/**
 * #3720 — Host-facing support identity.
 *
 * Historical messages that predate real-person attribution use this neutral
 * fallback. New replies snapshot the authenticated staff member's display name
 * and render `Actual name · Mingla Support` in both the thread and push.
 */

export const SUPPORT_HOST_FACING_AGENT = "Mingla Support" as const;

/** Help Centre videos — "Browse all help videos" opens it in the browser. */
export const HELP_CENTRE_URL = "https://usemingla.com/help" as const;

/**
 * The Help & Support screen: Account → Settings → Help & Support. One route for
 * every "Get help" in the app (the Tap to Pay screens too, #4271).
 */
export const HELP_AND_SUPPORT_ROUTE = "/account/support" as const;

/**
 * #4420 — every "Get help" button: Help & Support on Support, with "A person"
 * selected (Payments, Door, Tap to Pay, Host Ads).
 */
export const HELP_SUPPORT_PERSON_ROUTE = "/account/support?tab=support&mode=person" as const;

/** #4420 — a closed conversation's "Start a new request". */
export const HELP_SUPPORT_NEW_CONVERSATION_ROUTE =
  "/account/support?tab=support&mode=person&new=1" as const;

/** #4420 — an announcement push or link: that announcement, opened in place. */
export function helpSupportAnnouncementRoute(announcementId: string): string {
  return `/account/support?tab=announcements&announcementId=${encodeURIComponent(announcementId)}`;
}
