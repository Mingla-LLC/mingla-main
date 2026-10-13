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
