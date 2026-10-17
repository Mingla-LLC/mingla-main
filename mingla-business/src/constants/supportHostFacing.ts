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
