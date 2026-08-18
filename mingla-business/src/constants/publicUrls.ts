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

/** Explorer's public share origin. This is intentionally independent of the
 * organiser origin: opaque `/p` links are consumer universal links. */
export const EXPLORER_PUBLIC_ORIGIN = "https://usemingla.com";

export const sharedCardPublicPath = (shareId: string): string =>
  `/p/${requireSegment(shareId, "shareId")}`;
export const sharedCardPublicUrl = (shareId: string): string =>
  `${EXPLORER_PUBLIC_ORIGIN}${sharedCardPublicPath(shareId)}`;
export const sharedCardSnippetUrl = (shareId: string): string =>
  `${EXPLORER_PUBLIC_ORIGIN}/share/${requireSegment(shareId, "shareId")}.png`;
export const sharedCardOgImageUrl = (shareId: string): string =>
  `${EXPLORER_PUBLIC_ORIGIN}/og/share/${requireSegment(shareId, "shareId")}.png`;

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

// META-ORCH-1255(C): per-venue public page under the brand (D-2).
export const venuePublicPath = (input: {
  brandSlug: string;
  venueSlug: string;
}): string =>
  `/b/${requireSegment(input.brandSlug, "brandSlug")}/v/${requireSegment(
    input.venueSlug,
    "venueSlug",
  )}`;

export const venuePublicUrl = (input: {
  brandSlug: string;
  venueSlug: string;
}): string => `${BUSINESS_PUBLIC_ORIGIN}${venuePublicPath(input)}`;

export const checkoutPublicPath = (eventId: string): string =>
  `/checkout/${requireSegment(eventId, "eventId")}`;

/**
 * ORCH-1167 [event-page-canonical] — encode the inline-ticket-box selection as a
 * compact `seed` query param so the checkout cart step (i) lands PRE-POPULATED +
 * editable (replacing the empty tier-PICKER push). Format: `id:qty,id:qty`. Empty
 * selection → the bare path (no seed param). The checkout index seeds the cart from
 * this on mount; quantities remain editable there (the cart step is unchanged).
 */
export const encodeCartSeed = (
  quantities: Record<string, number>,
): string =>
  Object.entries(quantities)
    .filter(([, qty]) => qty > 0)
    .map(([id, qty]) => `${id}:${qty}`)
    .join(",");

/** Decode the `seed` query param back into a {ticketTypeId: qty} map. */
export const decodeCartSeed = (
  seed: string | null | undefined,
): Record<string, number> => {
  const out: Record<string, number> = {};
  if (typeof seed !== "string" || seed.length === 0) return out;
  for (const pair of seed.split(",")) {
    const [id, qtyRaw] = pair.split(":");
    const qty = Number.parseInt(qtyRaw ?? "", 10);
    if (typeof id === "string" && id.length > 0 && Number.isFinite(qty) && qty > 0) {
      out[id] = qty;
    }
  }
  return out;
};

/**
 * checkoutPublicPath with an optional pre-populated cart seed (ORCH-1167) and,
 * since issue #2135, the buyer's chosen multi-date occurrence.
 *
 * `eventDateId` is the `event_dates.id` the guest picked on the public page for
 * a multi-date event. It is appended ONLY when a non-empty id is supplied, so
 * every single-date caller (which passes nothing) produces the byte-identical
 * path it produced before — `/checkout/{id}` or `/checkout/{id}?seed=…`.
 * The checkout cart step reads it back and seeds `CartContext.eventDateId`,
 * which the existing chain already forwards to `ticket-checkout-create` and
 * persists on `orders.event_date_id` (#1188).
 */
export const checkoutPublicPathWithSeed = (
  eventId: string,
  quantities: Record<string, number>,
  // issue #2160 — the day SET. A single string is still accepted so nothing
  // that passes one has to change; it is treated as a one-element set.
  eventDateIds?: readonly string[] | string | null,
): string => {
  const base = checkoutPublicPath(eventId);
  const seed = encodeCartSeed(quantities);
  const params: string[] = [];
  if (seed.length > 0) params.push(`seed=${encodeURIComponent(seed)}`);
  const days = typeof eventDateIds === "string"
    ? (eventDateIds.length > 0 ? [eventDateIds] : [])
    : (eventDateIds ?? []).filter((id) => id.length > 0);
  // EMPTY => a BYTE-IDENTICAL path to the pre-#2135 one. A single-date event
  // must produce exactly the string it produced before any of this existed,
  // and that is asserted by string equality in the #2135 / #2160 suites.
  //
  // ONE `encodeURIComponent` over the JOINED value, matching the single-id
  // encoding it replaces. The cart route still accepts the legacy single
  // `eventDateId=` param (links minted between the #2135 and #2160 deploys are
  // live in the wild and must keep working).
  if (days.length > 0) {
    params.push(`eventDateIds=${encodeURIComponent(days.join(","))}`);
  }
  return params.length > 0 ? `${base}?${params.join("&")}` : base;
};

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
  if (!isAbsoluteHttpUrl(input.coverMediaUrl)) return "";
  return `${BUSINESS_PUBLIC_ORIGIN}/og/event/${requireSegment(
    input.eventId,
    "eventId",
  )}.png`;
};

export const brandOgImageUrl = (input: {
  brandSlug: string;
  profilePhotoUrl?: string | null;
}): string => {
  if (!isAbsoluteHttpUrl(input.profilePhotoUrl)) return "";
  return `${BUSINESS_PUBLIC_ORIGIN}/og/brand/${requireSegment(
    input.brandSlug,
    "brandSlug",
  )}.png`;
};

export const venueOgImageUrl = (input: {
  brandSlug: string;
  venueSlug: string;
  coverMediaUrl?: string | null;
}): string => {
  if (!isAbsoluteHttpUrl(input.coverMediaUrl)) return "";
  return `${BUSINESS_PUBLIC_ORIGIN}/og/venue/${requireSegment(
    input.brandSlug,
    "brandSlug",
  )}/${requireSegment(input.venueSlug, "venueSlug")}.png`;
};
