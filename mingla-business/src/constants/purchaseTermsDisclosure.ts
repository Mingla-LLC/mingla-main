/**
 * #4420 — split out of ./consentDisclosure (which re-exports every name here).
 * The checkout buyer routes, the door-pay route and the ticket-link landing
 * import only these short strings; keeping them in their own module keeps the
 * full consent terms body out of the eager `__common` boot chunk.
 */

/**
 * #3859 — purchase acceptance and marketing are separate affirmative acts.
 * The purchase sentence is recorded only under transactional scope; the
 * optional marketing sentence is recorded only when the buyer selects it.
 */
export const PURCHASE_TERMS_DISCLOSURE_VERSION =
  "2026-10-14-purchase-v1" as const;
export const PURCHASE_TERMS_DISCLOSURE_TEXT =
  "I agree to Mingla’s Terms of Service and Privacy Policy." as const;
export const PURCHASE_TERMS_LABEL_PREFIX = "I agree to Mingla’s " as const;
export const PURCHASE_TERMS_LABEL_TERMS = "Terms of Service" as const;
export const PURCHASE_TERMS_LABEL_JOINER = " and " as const;
export const PURCHASE_TERMS_LABEL_PRIVACY = "Privacy Policy" as const;
export const PURCHASE_TERMS_LABEL_SUFFIX = "." as const;

// #4273 (Seth, 2026-11-06): anybody who buys is opted in to the brand's
// marketing by email and text. No checkbox; the buyer is told plainly. The
// grant is recorded at order ingest as purchase_auto_optin.
export const CHECKOUT_MARKETING_NOTICE =
  "By buying, you'll get updates from this brand and Mingla by email and text. You can unsubscribe at any time." as const;

export const PURCHASE_TERMS_URL =
  "https://www.usemingla.com/terms-of-service" as const;
export const PURCHASE_PRIVACY_URL =
  "https://www.usemingla.com/privacy-policy" as const;
