export type DoorPaymentMethod = "cash" | "card_reader" | "nfc" | "manual";

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
}
