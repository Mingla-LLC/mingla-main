/**
 * Which refund actions the order detail screen offers, and which rail refunds
 * the money.
 *
 * Cash and manual door sales (orders.source = 'door_sale') are money the host
 * collected by hand: only `biz_door_sale_refund` may record their refund (the
 * `issue_4063_guard_door_refund_path` trigger rejects any other insert with
 * `door_sale_refund_path_required`). Card money taken at the door (pay code,
 * Tap to Pay) is an online order and refunds through `refund-order` like any
 * other card sale (#4271).
 */
import type { OrderRecord } from "../store/orderStore";

export type OrderRefundRail = "provider" | "door_sale";

export const orderRefundRail = (
  order: Pick<OrderRecord, "source">,
): OrderRefundRail => (order.source === "door_sale" ? "door_sale" : "provider");

export interface OrderActionFlags {
  refundRail: OrderRefundRail;
  showRefundFull: boolean;
  showRefundPartialAgain: boolean;
  showCancelOrder: boolean;
  /** The provider sheet's partial mode. The door sheet picks seats itself. */
  showSecondaryPartialFromFull: boolean;
}

// ORCH-0787: derive primary-action visibility per Cycle 9c §3.4.2.
export const deriveActionFlags = (
  order: Pick<OrderRecord, "status" | "paymentMethod" | "source">,
  canRefund: boolean,
): OrderActionFlags => {
  const paid = order.status === "paid";
  const partial = order.status === "refunded_partial";
  const isFree = order.paymentMethod === "free";
  const refundRail = orderRefundRail(order);
  return {
    refundRail,
    showRefundFull: canRefund && !isFree && paid,
    showRefundPartialAgain: canRefund && !isFree && partial,
    showCancelOrder: canRefund && isFree && paid,
    showSecondaryPartialFromFull:
      canRefund && !isFree && paid && refundRail === "provider",
  };
};
