/**
 * #3645 — Trip cancellation tells hosts exactly what happens to bookings and
 * paid orders, without naming a payment provider or promising an email.
 *
 * Fails on revert: cancelTripDialogDescription and the Trip toast kind do not
 * exist before this change.
 */

import {
  CANCEL_TRIP_NOTHING_PAID_DESCRIPTION,
  cancelDoneToast,
  cancelTripDialogDescription,
} from "../cancelEventCopy";

describe("#3645 Trip cancellation copy", () => {
  it("uses the approved singular, plural, unknown, and nothing-paid bodies", () => {
    expect(
      cancelTripDialogDescription({ nothingToRefund: false, paidOrderCount: 1 }),
    ).toBe(
      "Sales and bookings stop straight away. The 1 paid order is queued for a full refund, and Mingla reviews the batch before the money is sent. You can't undo this.",
    );
    expect(
      cancelTripDialogDescription({ nothingToRefund: false, paidOrderCount: 3 }),
    ).toBe(
      "Sales and bookings stop straight away. The 3 paid orders are queued for a full refund, and Mingla reviews the batch before the money is sent. You can't undo this.",
    );
    expect(
      cancelTripDialogDescription({ nothingToRefund: false, paidOrderCount: null }),
    ).toBe(
      "Sales and bookings stop straight away. Any paid orders are queued for a full refund, and Mingla reviews the batch before the money is sent. You can't undo this.",
    );
    expect(
      cancelTripDialogDescription({ nothingToRefund: true, paidOrderCount: null }),
    ).toBe(CANCEL_TRIP_NOTHING_PAID_DESCRIPTION);
    expect(CANCEL_TRIP_NOTHING_PAID_DESCRIPTION).toBe(
      "Sales and bookings stop straight away. No one has paid, so there is nothing to refund. You can't undo this.",
    );
  });

  it("mentions review only when paid orders are known and names no provider or email", () => {
    expect(cancelDoneToast(2, "Trip")).toBe(
      "Trip cancelled. Refunds are with Mingla for review.",
    );
    expect(cancelDoneToast(null, "Trip")).toBe("Trip cancelled.");

    for (const copy of [
      cancelTripDialogDescription({ nothingToRefund: false, paidOrderCount: 2 }),
      cancelTripDialogDescription({ nothingToRefund: false, paidOrderCount: null }),
      cancelTripDialogDescription({ nothingToRefund: true, paidOrderCount: null }),
      cancelDoneToast(2, "Trip"),
    ]) {
      expect(copy).not.toMatch(/stripe|paystack|email|automatically|immediately refunded/i);
    }
  });
});
