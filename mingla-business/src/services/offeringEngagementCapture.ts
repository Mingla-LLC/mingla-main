export type OfferingEngagementEntityType =
  "event" | "brand" | "trip" | "experience" | "venue";

export type OfferingEngagementCtaType =
  | "buy"
  | "book"
  | "rsvp"
  | "share"
  | "save"
  | "directions"
  | "website"
  | "call"
  // #4037 decision 5 — opening the brand, a venue or an offering is engagement.
  | "view_brand"
  | "view_venue"
  | "view_offering";

export interface OfferingEngagementScope {
  brandId: string;
  entityType: OfferingEngagementEntityType;
  entityId: string | null;
}

/** Buyer-page capture is web-only. Native Mingla Host must never masquerade as buyer web. */
export async function captureOfferingPageView(
  _scope: OfferingEngagementScope,
): Promise<void> {}

export async function captureOfferingCta(
  _scope: OfferingEngagementScope,
  _ctaType: OfferingEngagementCtaType,
): Promise<void> {}

export async function captureOfferingCheckoutStart(
  _scope: OfferingEngagementScope,
  _checkoutSessionId: string,
): Promise<void> {}
