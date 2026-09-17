// ===========================================================================
// #3392 — the "Manage or cancel" link a venue booking confirmation email carries.
// ---------------------------------------------------------------------------
// Pure, env-free. Two callers must agree on one shape:
//   - notify-outbox-drain BUILDS the link after re-deriving the guest's manage
//     token (see venueReservationManageToken.ts);
//   - notify-dispatch VALIDATES it before rendering it as the email's button, so
//     no caller can put any other URL behind "Manage or cancel".
//
// The shape mirrors mingla-business/src/utils/guestReservationManage.ts
// (`guestReservationManagePath`): the reservation id and the token ride in the
// URL FRAGMENT, which browsers never send to a server, and the manage page
// scrubs it from history on arrival (#1221).
// ===========================================================================

import { PRODUCTION_BUSINESS_WEB_ORIGIN } from "./businessWebOrigin.ts";

export const VENUE_RESERVATION_MANAGE_CTA_LABEL = "Manage or cancel";

/** Rendered above the button. The link is a credential, so say so plainly. */
export const VENUE_RESERVATION_MANAGE_EMAIL_NOTE =
  "Plans changed? Use the button below to manage or cancel your booking. " +
  "The link is private to you, so please don't forward this email.";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// The derived token shape: `<kid>.<43-char base64url HMAC-SHA256>`.
const MANAGE_TOKEN_RE = /^[a-z0-9_-]{1,16}\.[A-Za-z0-9_-]{43}$/;

export function isVenueReservationManageToken(token: string): boolean {
  return MANAGE_TOKEN_RE.test(token);
}

export function buildVenueReservationManageUrl(input: {
  brandId: string;
  reservationId: string;
  token: string;
}): string {
  if (
    !UUID_RE.test(input.brandId) || !UUID_RE.test(input.reservationId) ||
    !isVenueReservationManageToken(input.token)
  ) {
    throw new Error("manage_link_input_invalid");
  }
  return `${PRODUCTION_BUSINESS_WEB_ORIGIN}/reserve/${
    encodeURIComponent(input.brandId.toLowerCase())
  }/manage#reservationId=${
    encodeURIComponent(input.reservationId.toLowerCase())
  }&token=${encodeURIComponent(input.token)}`;
}

/**
 * The reservation id a well-formed manage link opens, or null for anything
 * else: another origin or path, a query string, extra fragment keys, a
 * malformed id or token. Exact rebuild, so there is one accepted spelling.
 */
export function venueReservationManageUrlReservationId(
  url: unknown,
): string | null {
  if (typeof url !== "string" || url.length > 512) return null;
  const prefix = `${PRODUCTION_BUSINESS_WEB_ORIGIN}/reserve/`;
  if (!url.startsWith(prefix)) return null;
  const match = url.slice(prefix.length).match(
    /^([0-9a-f-]{36})\/manage#reservationId=([0-9a-f-]{36})&token=([A-Za-z0-9_.-]{1,64})$/,
  );
  if (!match) return null;
  const [, brandId, reservationId, token] = match;
  try {
    return buildVenueReservationManageUrl({ brandId, reservationId, token }) ===
        url
      ? reservationId
      : null;
  } catch {
    return null;
  }
}

/**
 * #3392 — the email button notify-dispatch may render for a manage link.
 *
 * notify-outbox-drain re-derives the guest's link at send time and passes it in
 * the request body. It becomes a button ONLY when the caller is the service
 * role itself, the category is the booking confirmation, and the URL is exactly
 * the manage page for the SAME reservation the payload names. Anything else is
 * dropped (the email still sends). The label and wording are fixed here, never
 * caller-supplied.
 */
export function trustedReservationManageCta(input: {
  serviceCaller: boolean;
  categoryKey: unknown;
  payload: Record<string, unknown>;
  manageUrl: unknown;
}): { label: string; url: string; note: string } | undefined {
  if (input.manageUrl === undefined || input.manageUrl === null) {
    return undefined;
  }
  const reservationId = venueReservationManageUrlReservationId(input.manageUrl);
  if (
    !input.serviceCaller ||
    input.categoryKey !== "buyer_reservation_confirmed" ||
    reservationId === null ||
    String(input.payload.reservation_id ?? "").toLowerCase() !== reservationId
  ) {
    console.warn("[notify-dispatch v2] reservation_manage_url_rejected");
    return undefined;
  }
  return {
    label: VENUE_RESERVATION_MANAGE_CTA_LABEL,
    url: input.manageUrl as string,
    note: VENUE_RESERVATION_MANAGE_EMAIL_NOTE,
  };
}
