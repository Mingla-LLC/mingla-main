/**
 * Display labels for door-sale payment methods. Single source of truth —
 * used in door sale detail (`app/event/[id]/door/[saleId].tsx`), door sale
 * list rows (`app/event/[id]/door/index.tsx`), guest screens, the CSV export
 * and reconciliation.
 *
 * issue #4271 — the door method set is cash, manual, card reader (disabled,
 * coming later), buyer's phone (pay code) and tap to pay. "NFC tap" is gone.
 */
import { TAP_TO_PAY_SHORT } from "../constants/tapToPayCopy";

import type { DoorPaymentMethod } from "../types/doorSales";

export const PAYMENT_METHOD_LABELS: Record<DoorPaymentMethod, string> = {
  cash: "Cash",
  manual: "Manual",
  card_reader: "Card reader",
  pay_code: "Buyer's phone",
  tap_to_pay: TAP_TO_PAY_SHORT,
};

/** issue #4271 — the short pill text shown on door sale rows. */
export const PAYMENT_METHOD_PILLS: Record<DoorPaymentMethod, string> = {
  cash: "CASH",
  manual: "MANUAL",
  card_reader: "CARD",
  pay_code: "PHONE",
  tap_to_pay: "TAP",
};
