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
