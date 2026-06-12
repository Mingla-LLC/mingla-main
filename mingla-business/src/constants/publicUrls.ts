import { MINGLA_BUSINESS_WEB_URL } from "./platformUrl";

export class PublicUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PublicUrlError";
  }
}

const trimTrailingSlash = (value: string): string => value.replace(/\/+$/, "");

const requireSegment = (value: string, label: string): string => {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new PublicUrlError(`${label} is required to build a public Mingla URL.`);
  }
  return encodeURIComponent(trimmed);
};

const isAbsoluteHttpUrl = (value: string | null | undefined): value is string => {
  if (typeof value !== "string" || value.length === 0) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
};

export const BUSINESS_PUBLIC_ORIGIN: string = trimTrailingSlash(
  MINGLA_BUSINESS_WEB_URL,
);

export const eventPublicPath = (input: {
  brandSlug: string;
  eventSlug: string;
}): string =>
  `/e/${requireSegment(input.brandSlug, "brandSlug")}/${requireSegment(
    input.eventSlug,
    "eventSlug",
  )}`;

export const eventPublicUrl = (input: {
  brandSlug: string;
  eventSlug: string;
}): string => `${BUSINESS_PUBLIC_ORIGIN}${eventPublicPath(input)}`;

export const brandPublicPath = (brandSlug: string): string =>
  `/b/${requireSegment(brandSlug, "brandSlug")}`;

export const brandPublicUrl = (brandSlug: string): string =>
  `${BUSINESS_PUBLIC_ORIGIN}${brandPublicPath(brandSlug)}`;

export const checkoutPublicPath = (eventId: string): string =>
  `/checkout/${requireSegment(eventId, "eventId")}`;

export const checkoutPublicUrl = (eventId: string): string =>
  `${BUSINESS_PUBLIC_ORIGIN}${checkoutPublicPath(eventId)}`;

// ORCH-0876: trip-specific buyer-anon checkout chain. Event-side
// /checkout/[eventId]/* hard-rejects trips by audit-test invariant
// (eventType.filter.audit.test.ts). Trips have their own chain at
// /checkout-trip/[tripEventId]/{_layout,index,buyer,payment,confirm}.tsx.
export const tripCheckoutPath = (tripEventId: string): string =>
  `/checkout-trip/${requireSegment(tripEventId, "tripEventId")}`;

export const tripCheckoutUrl = (tripEventId: string): string =>
  `${BUSINESS_PUBLIC_ORIGIN}${tripCheckoutPath(tripEventId)}`;

// ORCH-1117: experience-specific buyer-anon checkout entry, mirror of
// tripCheckoutPath. Experiences route into their own chain at
// /checkout-experience/[experienceEventId]/* (event-side /checkout/[eventId]
// hard-rejects non-event rows by audit-test invariant). The floating Buy bar
// on the public experience page uses this single helper instead of an inline
// template string (parity with tripCheckoutPath/checkoutPublicPath).
export const experienceCheckoutPath = (experienceEventId: string): string =>
  `/checkout-experience/${requireSegment(
    experienceEventId,
    "experienceEventId",
  )}`;

export const experienceCheckoutUrl = (experienceEventId: string): string =>
  `${BUSINESS_PUBLIC_ORIGIN}${experienceCheckoutPath(experienceEventId)}`;

// ORCH-0876: public trip page path helper (mirror of eventPublicPath).
export const tripPublicPath = (input: {
  brandSlug: string;
  tripSlug: string;
}): string =>
  `/t/${requireSegment(input.brandSlug, "brandSlug")}/${requireSegment(
    input.tripSlug,
    "tripSlug",
  )}`;

export const tripPublicUrl = (input: {
  brandSlug: string;
  tripSlug: string;
}): string => `${BUSINESS_PUBLIC_ORIGIN}${tripPublicPath(input)}`;

// ORCH-1114: experience public-URL helper, mirror of tripPublicPath/tripPublicUrl.
export const experiencePublicPath = (input: {
  brandSlug: string;
  experienceSlug: string;
}): string =>
  `/exp/${requireSegment(input.brandSlug, "brandSlug")}/${requireSegment(
    input.experienceSlug,
    "experienceSlug",
  )}`;

export const experiencePublicUrl = (input: {
  brandSlug: string;
  experienceSlug: string;
}): string => `${BUSINESS_PUBLIC_ORIGIN}${experiencePublicPath(input)}`;

export const eventOgImageUrl = (input: {
  eventId: string;
  coverMediaUrl?: string | null;
}): string => {
  if (isAbsoluteHttpUrl(input.coverMediaUrl)) return input.coverMediaUrl;
  return `${BUSINESS_PUBLIC_ORIGIN}/og/event/${requireSegment(
    input.eventId,
    "eventId",
  )}.png`;
};

export const brandOgImageUrl = (input: {
  brandSlug: string;
  profilePhotoUrl?: string | null;
}): string => {
  if (isAbsoluteHttpUrl(input.profilePhotoUrl)) return input.profilePhotoUrl;
  return `${BUSINESS_PUBLIC_ORIGIN}/og/brand/${requireSegment(
    input.brandSlug,
    "brandSlug",
  )}.png`;
};
