// ===========================================================================
// #3392 — what a guest's private manage link may see about their booking.
// ---------------------------------------------------------------------------
// `reserve/[brandId]/manage` only ever asked `pg_guest_venue_refund_summary`,
// and that RPC RAISES `reservation_not_found` whenever the booking has no refund
// row. So every free booking — and every paid booking before a refund — opened
// the manage page to "We couldn't open this reservation.", and a guest could
// not see or cancel the booking the link was for.
//
// This module answers the question the page actually needs, with the SAME
// credential rule the #1221 guest RPCs use: the link's token must hash to the
// `reservation_checkout_sessions.guest_cancel_token_hash` for THAT reservation
// ('v1:' || sha256 hex). No match → null (the caller answers 404, identical
// to an unknown id, so a token can't be used to probe other bookings).
//
// It returns booking facts only — status, whether money was taken, when, how
// many, and the venue name. No guest name, email, phone or payment identifiers.
// The refund summary stays the RPC's job; the caller merges the two.
// ===========================================================================

export type GuestManageReservationStatus =
  | "requested"
  | "confirmed"
  | "seated"
  | "completed"
  | "no_show"
  | "cancelled_by_guest"
  | "cancelled_by_venue"
  | "waitlisted";

export interface GuestReservationManageView {
  status: GuestManageReservationStatus;
  paymentStatus: "none" | "paid" | "refunded";
  reservedForUtc: string;
  partySize: number;
  venueName: string | null;
  /** A guest may cancel only an upcoming booking in a cancellable state. */
  canCancel: boolean;
}

// The guest-legal subset of pg_reservation_transition_is_legal(_, 'cancelled_by_guest').
const GUEST_CANCELLABLE: ReadonlySet<string> = new Set([
  "requested",
  "confirmed",
  "waitlisted",
]);

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function guestCancelTokenHash(token: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token),
  );
  const hex = Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `v1:${hex}`;
}

// deno-lint-ignore no-explicit-any
type QueryClient = { from: (table: string) => any };

export async function loadGuestReservationManageView(
  client: QueryClient,
  input: { reservationId: string; guestToken: string; now?: Date },
): Promise<GuestReservationManageView | null> {
  const reservationId = input.reservationId.trim();
  const guestToken = input.guestToken.trim();
  if (!UUID_RE.test(reservationId) || guestToken.length === 0) return null;

  const tokenHash = await guestCancelTokenHash(guestToken);
  const { data: session, error: sessionError } = await client
    .from("reservation_checkout_sessions")
    .select("reservation_id, venue_id")
    .eq("reservation_id", reservationId)
    .eq("guest_cancel_token_hash", tokenHash)
    .limit(1)
    .maybeSingle();
  if (sessionError) throw new Error("manage_session_lookup_failed");
  if (!session) return null;

  const { data: reservation, error: reservationError } = await client
    .from("reservations")
    .select("status, payment_status, reserved_for, party_size, venue_id")
    .eq("id", reservationId)
    .maybeSingle();
  if (reservationError) throw new Error("manage_reservation_lookup_failed");
  if (!reservation) return null;

  let venueName: string | null = null;
  const venueId = reservation.venue_id ?? session.venue_id ?? null;
  if (typeof venueId === "string" && venueId.length > 0) {
    const { data: venue } = await client
      .from("venue_listings")
      .select("name")
      .eq("id", venueId)
      .maybeSingle();
    venueName = typeof venue?.name === "string" && venue.name.trim().length > 0
      ? venue.name.trim()
      : null;
  }

  const status = String(reservation.status) as GuestManageReservationStatus;
  const reservedForUtc = String(reservation.reserved_for);
  const reservedForMs = Date.parse(reservedForUtc);
  const nowMs = (input.now ?? new Date()).getTime();
  const paymentStatus = reservation.payment_status === "paid" ||
      reservation.payment_status === "refunded"
    ? reservation.payment_status
    : "none";

  return {
    status,
    paymentStatus,
    reservedForUtc,
    partySize: Number(reservation.party_size),
    venueName,
    canCancel: GUEST_CANCELLABLE.has(status) &&
      Number.isFinite(reservedForMs) && reservedForMs > nowMs,
  };
}
