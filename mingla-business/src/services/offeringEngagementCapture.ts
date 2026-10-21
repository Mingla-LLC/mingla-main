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
  | "call";

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
