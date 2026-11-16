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

type JsonObject = Record<string, unknown>;

export const BOOKING_LOCK_REASONS = {
  OUTBOUND_ACTION_LINK:
    "This button points outside Mingla. Bookings and payments on your site go through Mingla. Change the link to one of your Mingla pages.",
  BOOKING_THROUGH_ENQUIRY:
    "A question form can't take bookings. Bookings go through Mingla: remove words like book, reserve, tickets or stay from the form, or use your Mingla booking button.",
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
      retryable: false,
      operation_id: operationId,
      reason_code: body.code,
      ...(links ? { links } : {}),
    },
  }, 409);
}

export type PublicationActionScope = { brand_slug: string; contact_email?: string; contact_phone?: string };

/**
 * The brand's slug and own contact details, as Core holds them. Null when the
 * brand can't be read or has no usable slug (Studio then runs its
 * brand-agnostic check; it never loosens).
 */
export function publicationActionScope(brand: JsonObject | null): PublicationActionScope | null {
  if (!brand) return null;
  const slug = typeof brand.slug === "string" ? brand.slug.trim() : "";
  if (!/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/i.test(slug)) return null;
  const scope: PublicationActionScope = { brand_slug: slug };
  if (typeof brand.contact_email === "string" && brand.contact_email.trim()) scope.contact_email = brand.contact_email.trim().slice(0, 254);
  if (typeof brand.contact_phone === "string" && brand.contact_phone.trim()) scope.contact_phone = brand.contact_phone.trim().slice(0, 40);
  return scope;
}
