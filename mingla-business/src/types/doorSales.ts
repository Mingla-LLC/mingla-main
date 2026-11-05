/**
 * issue #4271 — every door payment method. `pay_code` (guest pays on their own
 * phone) and `tap_to_pay` (card or phone tapped on the host's phone) are card
 * money that rides the online payment rail; `cash` and `manual` are recorded
 * off-rail. `card_reader` stays a type for a disabled "coming later" row; no
 * sale can carry it today. "nfc" is gone.
 */
export type DoorPaymentMethod =
  | "cash"
  | "manual"
  | "card_reader"
  | "pay_code"
  | "tap_to_pay";

/** issue #4271 — door methods whose money moves through the provider. */
export const DOOR_CARD_PAYMENT_METHODS: readonly DoorPaymentMethod[] = [
  "pay_code",
  "tap_to_pay",
];

export const isCardDoorPaymentMethod = (method: string): boolean =>
  (DOOR_CARD_PAYMENT_METHODS as readonly string[]).includes(method);

export interface DoorSaleLine {
  ticketTypeId: string;
  ticketNameAtSale: string;
  unitPriceGbpAtSale: number;
  unitPriceAtSale?: number;
  isFreeAtSale: boolean;
  quantity: number;
  refundedQuantity: number;
  refundedAmountGbp: number;
  refundedAmount?: number;
}

export interface DoorRefundRecord {
  id: string;
  saleId: string;
  amountGbp: number;
  amount?: number;
  reason: string;
  refundedAt: string;
  /** issue #4271 — Mingla's fee this refund reversed, as the provider reported. */
  applicationFeeRefundedCents?: number | null;
  lines: {
    ticketTypeId: string;
    quantity: number;
    amountGbp: number;
    amount?: number;
  }[];
}

export type DoorSaleStatus = "completed" | "refunded_full" | "refunded_partial";

export interface DoorSaleRecord {
  id: string;
  eventId: string;
  brandId: string;
  recordedBy: string;
  buyerName: string;
  buyerEmail: string;
  buyerPhone: string;
  paymentMethod: DoorPaymentMethod;
  lines: DoorSaleLine[];
  totalGbpAtSale: number;
  totalAtSale?: number;
  currency: string;
  notes: string;
  recordedAt: string;
  status: DoorSaleStatus;
  refundedAmountGbp: number;
  refundedAmount?: number;
  refunds: DoorRefundRecord[];
  /**
   * issue #4271 — Mingla's application fee on a card door sale, in major
   * units. Null for cash/manual (no fee) and for a card sale whose fee the
   * provider has not confirmed yet.
   */
  minglaFeeAmount?: number | null;
}
