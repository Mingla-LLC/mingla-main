/**
 * cancelEventCopy — issue #3645.
 *
 * The cancel-event dialog and toast used to show internal wording to hosts:
 * "refunded automatically when those wire up (B-cycle)".
 *
 * WHEN NOTHING HAS BEEN SOLD there is nothing to refund, and that can be said
 * plainly. "Nothing sold" must be KNOWN, not assumed: the orders read has to
 * have completed (not loading, not an error, not stale) and both the online
 * and the door counts have to be zero. Door sales are recorded on the device
 * that took them, so on an event with door sales switched on this device
 * cannot know what another device sold: that is "may have sold" too.
 *
 * WHEN TICKETS HAVE BEEN SOLD the existing copy is deliberately left alone by
 * this change. What the code does then (the cancel opens a refund run that
 * waits for review before buyers are refunded) is not something this module
 * may describe to hosts until that behaviour and its wording are confirmed on
 * #3645. The caller keeps its existing string for that branch.
 */

export const CANCEL_EVENT_NOTHING_SOLD_DESCRIPTION =
  "No one has bought a ticket, so there is nothing to refund. You can't undo this.";

export const CANCEL_EVENT_NOTHING_SOLD_TOAST = "Event cancelled.";

interface SoldLine {
  quantity: number;
  refundedQuantity: number;
}
interface SoldOrder {
  status: string;
  lines: readonly SoldLine[];
}

/** Tickets currently held by buyers across paid (or partly refunded) orders. */
export const countSoldTickets = (orders: readonly SoldOrder[]): number =>
  orders.reduce((sum, order) => {
    if (order.status !== "paid" && order.status !== "refunded_partial") return sum;
    return (
      sum +
      order.lines.reduce(
        (lineSum, line) =>
          lineSum + Math.max(0, line.quantity - line.refundedQuantity),
        0,
      )
    );
  }, 0);

export interface NothingSoldInput {
  /** The orders read's status. Only "ready" counts as known. */
  ordersStatus: string | null | undefined;
  onlineSoldCount: number;
  doorSoldCount: number;
  /**
   * True when the event takes payments at the door. Door sales live on the
   * device that took them, so a zero here does not prove a zero elsewhere.
   */
  doorSalesEnabled: boolean;
}

/** True only when it is KNOWN that no ticket is held by any buyer. */
export const nothingSoldIsKnown = (input: NothingSoldInput): boolean =>
  input.ordersStatus === "ready" &&
  input.onlineSoldCount === 0 &&
  input.doorSoldCount === 0 &&
  !input.doorSalesEnabled;

/** The dialog body: the plain sentence when nothing sold, else the caller's. */
export const cancelEventDialogDescription = (
  nothingSold: boolean,
  existingDescription: string,
): string =>
  nothingSold ? CANCEL_EVENT_NOTHING_SOLD_DESCRIPTION : existingDescription;

/** The toast after a cancel: the plain one when nothing sold, else the caller's. */
export const cancelEventDoneToast = (
  nothingSold: boolean,
  existingToast: string,
): string => (nothingSold ? CANCEL_EVENT_NOTHING_SOLD_TOAST : existingToast);

// ---------------------------------------------------------------------------
// #3645 — WHEN SOMETHING HAS BEEN SOLD. Confirmed in code, and approved wording:
// cancelling stops sales at once (the cancel prepare step closes the ticket
// types and bookings), lists every paid order for a full refund, and opens a
// refund run that WAITS for a Mingla admin to release it. Nothing is refunded
// at cancel time. Nothing here promises an email: whether buyers are emailed
// at cancel time is not established.
// ---------------------------------------------------------------------------

/** Paid (or partly refunded) orders: the ones the cancel queues for refund. */
export const countPaidOrders = (
  orders: readonly { status: string }[],
): number =>
  orders.filter(
    (order) => order.status === "paid" || order.status === "refunded_partial",
  ).length;

/**
 * The paid-order count when it is KNOWN, else null. Known means the orders
 * read completed; a count of zero is reported as null too, because "0 paid
 * orders are queued" is not a sentence a host should read.
 */
export const knownPaidOrderCount = (
  ordersStatus: string | null | undefined,
  orders: readonly { status: string }[],
): number | null => {
  if (ordersStatus !== "ready") return null;
  const count = countPaidOrders(orders);
  return count > 0 ? count : null;
};

const REVIEW_TAIL =
  "queued for a full refund, and Mingla reviews the batch before the money is sent. You can't undo this.";

/** The cancel dialog body when sales exist, or may exist. */
export const cancelWithSalesDescription = (
  paidOrderCount: number | null,
): string => {
  if (paidOrderCount === null || paidOrderCount <= 0) {
    return `Sales stop straight away. Any paid orders are ${REVIEW_TAIL}`;
  }
  return paidOrderCount === 1
    ? `Sales stop straight away. The 1 paid order is ${REVIEW_TAIL}`
    : `Sales stop straight away. The ${paidOrderCount} paid orders are ${REVIEW_TAIL}`;
};

/** The experience dashboard's "nothing to refund" body (it sells bookings). */
export const CANCEL_EXPERIENCE_NOTHING_SOLD_DESCRIPTION =
  "No one has booked, so there is nothing to refund. You can't undo this.";

export const CANCEL_EVENT_WITH_SALES_TOAST =
  "Event cancelled. Refunds are with Mingla for review.";

/**
 * The toast after a cancel. "Refunds are with Mingla" is said only when paid
 * orders are KNOWN to exist; otherwise the plain confirmation, which claims
 * nothing.
 */
export const cancelDoneToast = (
  paidOrderCount: number | null,
  kind: "Event" | "Experience" | "RSVP" = "Event",
): string =>
  paidOrderCount !== null && paidOrderCount > 0
    ? `${kind} cancelled. Refunds are with Mingla for review.`
    : `${kind} cancelled.`;

// ---------------------------------------------------------------------------
// #3645 — cancelling an RSVP. An RSVP sells no tickets; the only money in it is
// chip-ins guests chose to pay. The same cancel step queues those for a full
// refund behind the same Mingla review. Guests cannot respond to a cancelled
// RSVP (the response function accepts scheduled and live RSVPs only).
// ---------------------------------------------------------------------------

/**
 * @param paidChipInCount null = not known (still loading, or the read failed);
 *                        0 = known that no guest has paid a chip-in.
 */
export const cancelRsvpDescription = (paidChipInCount: number | null): string => {
  if (paidChipInCount === null) {
    return `Guests can no longer respond. Any chip-ins guests paid are ${REVIEW_TAIL}`;
  }
  if (paidChipInCount <= 0) {
    return "Guests can no longer respond. No guest has chipped in, so there is nothing to refund. You can't undo this.";
  }
  return paidChipInCount === 1
    ? `Guests can no longer respond. The 1 chip-in a guest paid is ${REVIEW_TAIL}`
    : `Guests can no longer respond. The ${paidChipInCount} chip-ins guests paid are ${REVIEW_TAIL}`;
};
