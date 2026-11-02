/**
 * #4238 — plain-English copy for the Host ads builder's setup states.
 * Raw server codes (e.g. currency_authority_unresolved) never reach a Host.
 */

export const HOST_AD_UNAVAILABLE_TITLE = "Ads aren't available yet";
export const HOST_AD_UNAVAILABLE_BODY =
  "We're getting ad platforms ready for Hosts. Your pages and videos are safe; check back soon.";

/** What to tell a Host when Ads setup could not load. */
export function hostAdSetupErrorCopy(code: string | null | undefined): string {
  if (typeof code === "string" && code.startsWith("currency_authority_unresolved")) {
    return "Set your brand's payout currency before running ads.";
  }
  return "Ads setup couldn't load. Try again.";
}
