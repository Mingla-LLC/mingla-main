/**
 * #3720 — Host-facing support identity.
 *
 * Historical messages that predate real-person attribution use this neutral
 * fallback. New replies snapshot the authenticated staff member's display name
 * and render `Actual name · Mingla Support` in both the thread and push.
 */

export const SUPPORT_HOST_FACING_AGENT = "Mingla Support" as const;

/** Help Centre videos (Guides) — opens in the system browser. */
export const HELP_CENTRE_URL = "https://usemingla.com/help" as const;

/**
 * The Help & Support screen: Account → Settings → Help & Support. One route for
 * every "Get help" in the app (the Tap to Pay screens too, #4271).
 */
export const HELP_AND_SUPPORT_ROUTE = "/account/support" as const;
