/**
 * issue #4271 — an order the door stream also reports (a door_sale order, or a
 * card door payment: pay code or Tap to Pay). Kept apart from reconciliation.ts
 * so the CSV export can use it without loading the whole reconciliation engine.
 */
import { isCardDoorPaymentMethod } from "../types/doorSales";
import type { OrderRecord } from "../store/orderStore";

export const isDoorOrder = (order: OrderRecord): boolean =>
  order.source === "door_sale" || isCardDoorPaymentMethod(order.paymentMethod);
