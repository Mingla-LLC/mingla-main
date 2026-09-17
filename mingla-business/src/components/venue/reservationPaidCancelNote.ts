/**
 * #3391 — what the host is told before and after cancelling a PAID booking.
 *
 * Seth's decision (2026-09-15): when the venue cancels a paid booking the guest
 * is refunded in full, Mingla's fee included, automatically. This replaces the
 * #3406 stopgap ("Cancelling won't refund them automatically").
 *
 *   - Armed Cancel on a paid, unrefunded, unseated booking says exactly what
 *     will happen: "This refunds $50.00 to the guest."
 *   - A SEATED paid booking is not auto-refunded (a default applied on Seth's
 *     behalf), so arming Cancel says why and where to go instead.
 *   - Once a refund exists the sheet shows the refund chip; no note.
 *
 * `fee_cents` / `fee_currency` on the reservation are the checkout's own
 * amount and currency (pg_finalize_guest_reservation copies them), which is
 * exactly what the server refunds.
 */

import type {
  Reservation,
  ReservationAction,
} from "../../types/venueReservation";
import { formatCurrency } from "../../utils/currency";

export const SEATED_PAID_CANCEL_NOTE =
  "This guest is already seated, so cancelling won't refund them. Email support@usemingla.com if they should get their money back.";

export type PaidCancelNote =
  | { kind: "refund"; text: string }
  | { kind: "seated_no_refund"; text: string };

type NoteInput = Pick<
  Reservation,
  "paymentStatus" | "refund" | "status" | "feeCents" | "feeCurrency"
>;

/** "$50.00", "£50.00", "₦25,000.00" — null when the amount is not known. */
export function paidCancelRefundAmount(
  reservation: Pick<Reservation, "feeCents" | "feeCurrency">,
): string | null {
  const cents = reservation.feeCents;
  const currency = reservation.feeCurrency?.trim() ?? "";
  if (cents === null || cents === undefined || cents <= 0 || currency === "") {
    return null;
  }
  return formatCurrency(cents, currency, true);
}

/** True when Cancel on this booking goes through the refunding path. */
export function cancelRefundsGuest(reservation: NoteInput): boolean {
  return (
    reservation.paymentStatus === "paid" &&
    (reservation.refund ?? null) === null &&
    reservation.status !== "seated"
  );
}

export function paidCancelNote(
  reservation: NoteInput,
  armedAction: ReservationAction | null,
): PaidCancelNote | null {
  if (armedAction !== "cancel") return null;
  if (reservation.paymentStatus !== "paid") return null;
  if ((reservation.refund ?? null) !== null) return null;
  if (reservation.status === "seated") {
    return { kind: "seated_no_refund", text: SEATED_PAID_CANCEL_NOTE };
  }
  const amount = paidCancelRefundAmount(reservation);
  return {
    kind: "refund",
    text: amount === null
      ? "This refunds the guest in full."
      : `This refunds ${amount} to the guest.`,
  };
}

/** A sentence for each refusal the host-cancel edge action can return. */
export function paidCancelErrorMessage(code: string | null): string {
  switch (code) {
    case "payout_in_flight":
      return "This booking's payout is being sent right now, so it can't be refunded automatically. Email support@usemingla.com.";
    case "already_refunded":
      return "This guest has already been refunded.";
    case "seated_no_auto_refund":
      return SEATED_PAID_CANCEL_NOTE;
    case "cancel_not_allowed":
      return "This booking can't be cancelled any more.";
    case "not_authorized":
      return "Only managers can cancel a paid booking.";
    case "application_fee_unrecorded":
    case "payment_reference_missing":
    case "not_a_paid_reservation":
      return "We couldn't refund this booking automatically, so it wasn't cancelled. Email support@usemingla.com.";
    default:
      return "We couldn't cancel this booking. Try again. A retry never refunds twice.";
  }
}
