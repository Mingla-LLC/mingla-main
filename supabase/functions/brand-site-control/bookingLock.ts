/**
 * #4453 PR 2 (booking lock) — Core's half of "every button goes to Mingla".
 *
 *   - `publicationActionScope`: the brand a publish is for, read by Core from
 *     `brands` (never the caller's): its Mingla slug, contact email and phone.
 *     Studio freezes it into the artifact and checks every button against it.
 *   - `bookingLockRefusal`: Studio's two booking-lock refusals mapped to the
 *     customer-safe answer. Both are owner-fixable, so they are answered as
 *     VALIDATION_FAILED (409) with a `reason_code` and a plain instruction,
 *     never as SERVICE_TEMPORARILY_UNAVAILABLE (which would mark the publish
 *     ambiguous and tell the owner to retry).
 */
import { sitesJson } from "../_shared/sitesContracts.ts";
import { normalizeBrandPhone, socialHandlesFrom } from "../_shared/siteContracts/safety.ts";

type JsonObject = Record<string, unknown>;

export const BOOKING_LOCK_REASONS = {
  OUTBOUND_ACTION_LINK:
    "This button points outside Mingla. Bookings and payments on your site go through Mingla. Change the link to one of your Mingla pages.",
  BOOKING_THROUGH_ENQUIRY:
    "A question form can't take bookings. Bookings go through Mingla: remove words like book, reserve, tickets or stay from the form, or use your Mingla booking button.",
  BOOKING_LINK_UNVERIFIED:
    "We couldn't confirm your brand's Mingla pages and contact details, so buttons that link to them can't be published right now. Nothing on your site changed. Try again in a few minutes.",
} as const;

export type BookingLockReason = keyof typeof BOOKING_LOCK_REASONS;

export function isBookingLockReason(value: unknown): value is BookingLockReason {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(BOOKING_LOCK_REASONS, value);
}

const LINK_FIELDS = ["page_path", "block_index", "block_type", "field", "problem"] as const;

/** Which buttons to change, bounded (never the link itself). */
function safeLinks(value: unknown): JsonObject[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.slice(0, 20).filter((row) => row && typeof row === "object").map((row) => {
    const out: JsonObject = {};
    for (const key of LINK_FIELDS) {
      const field = (row as JsonObject)[key];
      if (typeof field === "string") out[key] = field.slice(0, 200);
      else if (typeof field === "number" && Number.isInteger(field)) out[key] = field;
      else if (field === null) out[key] = null;
    }
    return out;
  });
}

/** Studio's booking-lock refusal → the owner-fixable answer, or null for any other code. */
export function bookingLockRefusal(
  error: unknown,
  operationId: string | null = null,
): Response | null {
  const body = error && typeof error === "object" ? error as JsonObject : {};
  if (!isBookingLockReason(body.code)) return null;
  const links = safeLinks(body.links);
  return sitesJson({
    ok: false,
    error: {
      code: "VALIDATION_FAILED",
      message: BOOKING_LOCK_REASONS[body.code],
      retryable: body.code === "BOOKING_LINK_UNVERIFIED",
      operation_id: operationId,
      reason_code: body.code,
      ...(links ? { links } : {}),
    },
  }, 409);
}

/**
 * Deploy-order handshake (#4453 PR 2): Core advertises that it signs the
 * brand's identity into every publish and into Ari's evidence. Studio
 * enforces the identity part of the booking lock only when it sees this, so
 * Studio and this function may deploy in either order. Bump only with
 * Studio's `BOOKING_IDENTITY_CAPABILITY`.
 */
export const BOOKING_IDENTITY_CAPABILITY = 1;

export type PublicationActionScope = {
  brand_slug: string;
  contact_email?: string;
  contact_phone?: string;
  social_handles?: string[];
};

/**
 * The brand's slug, own contact details and social handles, as Core holds
 * them. The phone is normalised (extension and note text dropped); a field
 * that doesn't normalise is left out on its own. Null when the brand has no
 * usable slug: Studio then FAILS CLOSED (links that need the brand are
 * refused with BOOKING_LINK_UNVERIFIED), never a looser check.
 */
export function publicationActionScope(brand: JsonObject | null): PublicationActionScope | null {
  if (!brand) return null;
  const slug = typeof brand.slug === "string" ? brand.slug.trim() : "";
  if (!/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/i.test(slug)) return null;
  const scope: PublicationActionScope = { brand_slug: slug };
  const email = typeof brand.contact_email === "string" ? brand.contact_email.trim() : "";
  if (email && email.length <= 254 && /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email)) scope.contact_email = email;
  const phone = normalizeBrandPhone(brand.contact_phone);
  if (phone) scope.contact_phone = phone;
  const handles = socialHandlesFrom(brand.social_links);
  if (handles.length) scope.social_handles = handles;
  return scope;
}
