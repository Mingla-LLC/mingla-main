/**
 * #4238 P1-4 (I-4238-AF-RESPECTS-OPT-OUT): the Explorer Account "share usage
 * data" switch rides the native checkout create request, so the server stores
 * it on the session (ticket_checkout_sessions.ad_tracking_opt_out) and its
 * af_purchase post skips an opted-out buyer.
 *
 * The store is required lazily: a harness that never loads it reads "not
 * opted out", and this never throws.
 */
export function explorerAnalyticsOptedOut(): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { useAppStore } = require("../store/appStore") as {
      useAppStore: { getState: () => { analyticsOptOut?: boolean } };
    };
    return useAppStore.getState().analyticsOptOut === true;
  } catch {
    return false;
  }
}

/** The body fields for ticket-checkout-create: present only when opted out. */
export function checkoutAdTrackingFields(): { ad_tracking_opt_out?: true } {
  return explorerAnalyticsOptedOut() ? { ad_tracking_opt_out: true } : {};
}
