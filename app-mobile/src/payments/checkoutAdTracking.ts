/**
 * #4238 P1-4 (I-4238-AF-RESPECTS-OPT-OUT-EXPLORER): the Explorer "share usage data"
 * switch rides the native checkout create request, so the server stores it on
 * the session (ticket_checkout_sessions.ad_tracking_opt_out) and its
 * af_purchase post skips an opted-out buyer.
 */
import { explorerAnalyticsOptedOut } from "../services/analyticsOptOut";

/** The body fields for ticket-checkout-create: present only when opted out. */
export function checkoutAdTrackingFields(): { ad_tracking_opt_out?: true } {
  return explorerAnalyticsOptedOut() ? { ad_tracking_opt_out: true } : {};
}
