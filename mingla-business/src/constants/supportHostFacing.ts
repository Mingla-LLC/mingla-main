/**
 * #3720 — Host-facing support identity.
 *
 * Every host-visible staff surface shows this name. The admin audit log still
 * records the real agent. Push titles for staff→host replies use the same
 * string (mirrored in supabase/functions/_shared/supportHostFacing.ts).
 */

export const SUPPORT_HOST_FACING_AGENT = "Veronica from Mingla" as const;

/** Help Centre videos (Guides) — opens in the system browser. */
export const HELP_CENTRE_URL = "https://usemingla.com/help" as const;
