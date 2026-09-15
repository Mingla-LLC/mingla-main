/**
 * #3391 — say it before the host confirms: a venue cancelling a PAID booking
 * does not refund the guest today.
 *
 * Refunds for venue bookings (#1221) cover a guest who cancels in time. A
 * booking the VENUE cancels creates no refund, and the guest is only told
 * "contact the venue". Until the refund policy for venue cancellations is
 * decided (see #3391), the host must not find this out from an angry guest.
 * The note shows only while Cancel is armed on a paid booking with no refund.
 */

import type {
  Reservation,
  ReservationAction,
} from "../../types/venueReservation";

export const PAID_CANCEL_REFUND_NOTE =
  "This guest paid to book. Cancelling won't refund them automatically. Email support@usemingla.com before you cancel.";

export function paidCancelNeedsRefundNote(
  reservation: Pick<Reservation, "paymentStatus" | "refund">,
  armedAction: ReservationAction | null,
): boolean {
  return (
    armedAction === "cancel" &&
    reservation.paymentStatus === "paid" &&
    (reservation.refund ?? null) === null
  );
}
