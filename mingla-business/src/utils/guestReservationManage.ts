/**
 * #3392 — the guest's private manage link for a venue booking.
 *
 * One owner for three things the free success card, the paid confirm screen
 * and the manage page must agree on:
 *   - the link shape: the reservation id and token ride in the URL FRAGMENT,
 *     which browsers never send to a server; the manage page scrubs it from
 *     history on arrival (#1221);
 *   - what the page says for each booking state, including a cancelled free
 *     booking (which used to keep showing "Cancel reservation");
 *   - reading the edge function's `{ error }` code, so a refusal gets a sentence.
 */

export function guestReservationManagePath(input: {
  brandId: string;
  reservationId: string;
  token: string;
}): string {
  return `/reserve/${encodeURIComponent(input.brandId)}/manage#reservationId=${encodeURIComponent(
    input.reservationId,
  )}&token=${encodeURIComponent(input.token)}`;
}

export type GuestManageStatus =
  | "requested"
  | "confirmed"
  | "seated"
  | "completed"
  | "no_show"
  | "cancelled_by_guest"
  | "cancelled_by_venue"
  | "waitlisted";

/**
 * #4490 N119 — "Fri 20 Nov · 19:00": the booking's time in the VENUE's zone,
 * day-first, 24-hour, the way the confirmation says it. With no zone (an older
 * server answer) it falls back to the device's. "" when the instant is bad.
 */
export function guestManageWhen(iso: string, timeZone: string | null | undefined): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const zone = typeof timeZone === "string" && timeZone.trim().length > 0 ? timeZone.trim() : undefined;
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: zone,
      weekday: "short",
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(date);
  } catch {
    return guestManageWhen(iso, null);
  }
  const pick = (type: string): string => parts.find((part) => part.type === type)?.value ?? "";
  return `${pick("weekday")} ${pick("day")} ${pick("month")} · ${pick("hour")}:${pick("minute")}`;
}

export interface GuestManageReservation {
  status: GuestManageStatus;
  paymentStatus: "none" | "paid" | "refunded";
  reservedForUtc: string;
  partySize: number;
  venueName: string | null;
  /** The venue's IANA zone (absent from older answers). */
  timezone?: string | null;
  canCancel: boolean;
}

export interface GuestManageRefundLike {
  buyer_state: string;
}

export function guestManageHeadline(
  reservation: GuestManageReservation,
): string {
  switch (reservation.status) {
    case "cancelled_by_guest":
      return "You cancelled this reservation";
    case "cancelled_by_venue":
      return "The venue cancelled this reservation";
    case "completed":
    case "seated":
      return "Thanks for visiting";
    case "no_show":
      return "This reservation was marked as missed";
    case "requested":
      return "Your reservation is requested";
    case "waitlisted":
      return "You're on the waitlist";
    default:
      return "Your table is reserved";
  }
}

/**
 * The money line. `null` means say nothing about money (a free, live booking
 * needs no payment sentence).
 */
export function guestManageMoneyLine(
  reservation: GuestManageReservation,
  refund: GuestManageRefundLike | null,
): string | null {
  if (refund !== null) {
    if (refund.buyer_state === "processed") return "Your refund has been processed.";
    if (refund.buyer_state === "needs_attention") {
      return "Action is needed to continue your refund.";
    }
    return "Your refund is processing.";
  }
  const cancelled =
    reservation.status === "cancelled_by_guest" ||
    reservation.status === "cancelled_by_venue";
  if (reservation.paymentStatus === "none") {
    return cancelled ? "No payment was taken for this booking." : null;
  }
  if (reservation.paymentStatus === "refunded") {
    return "Your payment has been refunded.";
  }
  return cancelled
    ? "No refund has been requested for this booking."
    : "You paid when you booked.";
}

/** Reads `{ error }` from a supabase-js FunctionsHttpError, else null. */
export async function guestManageErrorCode(
  error: unknown,
): Promise<string | null> {
  if (error === null || typeof error !== "object") return null;
  const context = (error as { context?: unknown }).context;
  if (
    context === null ||
    typeof context !== "object" ||
    typeof (context as { text?: unknown }).text !== "function"
  ) {
    return null;
  }
  try {
    const raw = await (context as { text: () => Promise<string> }).text();
    const parsed = JSON.parse(raw) as { error?: unknown };
    return typeof parsed.error === "string" ? parsed.error : null;
  } catch {
    return null;
  }
}
