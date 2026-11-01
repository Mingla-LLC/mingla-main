import type {
  DoorPaymentMethod,
  DoorRefundRecord,
  DoorSaleLine,
  DoorSaleRecord,
  DoorSaleStatus,
} from "../types/doorSales";
import { supabase } from "./supabase";

export class DoorSaleError extends Error {
  readonly code: string;

  constructor(code: string, message?: string) {
    super(message ?? code);
    this.name = "DoorSaleError";
    this.code = code;
  }
}

export interface RecordDoorSaleInput {
  eventId: string;
  eventDateId?: string | null;
  lines: { ticketTypeId: string; quantity: number }[];
  paymentMethod: DoorPaymentMethod;
  buyerName?: string;
  buyerPhoneE164?: string | null;
  buyerEmail?: string;
  notes?: string;
  clientRequestId: string;
}

export interface RecordDoorSaleResult {
  orderId: string;
  ticketIds: string[];
  receiptQueued: boolean;
  replayed: boolean;
}

export interface RefundDoorSaleResult {
  orderId: string;
  refundId: string;
  amountCents: number;
  refundedAmountCents: number;
  status: "refunded" | "partial_refund";
}

interface DoorSaleLineRow {
  id: string;
  ticket_type_id: string;
  quantity: number;
  unit_price_cents: number;
  total_cents: number;
  list_unit_price_cents: number | null;
  ticket_types: { name: string; is_free: boolean } | { name: string; is_free: boolean }[] | null;
}

interface DoorRefundRow {
  id: string;
  amount_cents: number;
  reason: string | null;
  created_at: string;
  status: string;
}

interface DoorSaleRow {
  id: string;
  event_id: string;
  buyer_name: string | null;
  buyer_email: string | null;
  buyer_phone_e164: string | null;
  door_payment_method: DoorPaymentMethod;
  buyer_total_cents: number | null;
  total_cents: number;
  currency: string | null;
  created_by_scanner_id: string | null;
  created_at: string;
  payment_status: string;
  refunded_amount_cents: number;
  metadata: Record<string, unknown> | null;
  events: { brand_id: string } | { brand_id: string }[] | null;
  order_line_items: DoorSaleLineRow[] | null;
  refunds: DoorRefundRow[] | null;
}

const objectOrFirst = <T>(value: T | T[] | null): T | null =>
  Array.isArray(value) ? value[0] ?? null : value;

const centsToMajor = (value: number | null | undefined): number =>
  (value ?? 0) / 100;

const mapStatus = (paymentStatus: string): DoorSaleStatus => {
  if (paymentStatus === "refunded") return "refunded_full";
  if (paymentStatus === "partial_refund") return "refunded_partial";
  return "completed";
};

const mapDoorSale = (row: DoorSaleRow): DoorSaleRecord => {
  const event = objectOrFirst(row.events);
  const lines: DoorSaleLine[] = (row.order_line_items ?? []).map((line) => {
    const tier = objectOrFirst(line.ticket_types);
    const unit = centsToMajor(line.list_unit_price_cents ?? line.unit_price_cents);
    return {
      ticketTypeId: line.ticket_type_id,
      ticketNameAtSale: tier?.name ?? "Ticket",
      unitPriceGbpAtSale: unit,
      unitPriceAtSale: unit,
      isFreeAtSale: tier?.is_free === true || unit === 0,
      quantity: line.quantity,
      // Door refunds are amount-based and deliberately do not rewrite the
      // already-used tickets. Aggregate refund truth lives on the order.
      refundedQuantity: 0,
      refundedAmountGbp: 0,
      refundedAmount: 0,
    };
  });
  const refunds: DoorRefundRecord[] = (row.refunds ?? [])
    .filter((refund) => refund.status === "succeeded")
    .map((refund) => ({
      id: refund.id,
      saleId: row.id,
      amountGbp: centsToMajor(refund.amount_cents),
      amount: centsToMajor(refund.amount_cents),
      reason: refund.reason ?? "Door sale refund",
      refundedAt: refund.created_at,
      lines: [],
    }));
  const total = centsToMajor(row.buyer_total_cents ?? row.total_cents);
  const refunded = centsToMajor(row.refunded_amount_cents);
  const notes = typeof row.metadata?.door_notes === "string"
    ? row.metadata.door_notes
    : "";
  return {
    id: row.id,
    eventId: row.event_id,
    brandId: event?.brand_id ?? "",
    recordedBy: row.created_by_scanner_id ?? "",
    buyerName: row.buyer_name ?? "",
    buyerEmail: row.buyer_email ?? "",
    buyerPhone: row.buyer_phone_e164 ?? "",
    paymentMethod: row.door_payment_method,
    lines,
    totalGbpAtSale: total,
    totalAtSale: total,
    currency: row.currency?.trim() ?? "",
    notes,
    recordedAt: row.created_at,
    status: mapStatus(row.payment_status),
    refundedAmountGbp: refunded,
    refundedAmount: refunded,
    refunds,
  };
};

const rpcErrorCode = (error: { code?: string; message?: string }): string => {
  const message = error.message ?? "";
  const known = [
    "door_access_denied",
    "door_ticket_capacity_exceeded",
    "door_ticket_type_unavailable",
    "door_event_unavailable",
    "ticket_not_valid_on_chosen_days",
    "door_refund_amount_invalid",
    "reason_invalid_length",
  ].find((code) => message.includes(code));
  return known ?? error.code ?? "door_sale_failed";
};

export async function recordDoorSale(
  input: RecordDoorSaleInput,
): Promise<RecordDoorSaleResult> {
  const { data, error } = await supabase.rpc("biz_door_sale_record", {
    p_event_id: input.eventId,
    p_event_date_id: input.eventDateId ?? null,
    p_lines: input.lines.map((line) => ({
      ticket_type_id: line.ticketTypeId,
      quantity: line.quantity,
    })),
    p_payment_method: input.paymentMethod,
    p_buyer_name: input.buyerName?.trim() || null,
    p_buyer_phone_e164: input.buyerPhoneE164?.trim() || null,
    p_buyer_email: input.buyerEmail?.trim().toLowerCase() || null,
    p_notes: input.notes?.trim() || null,
    p_client_request_id: input.clientRequestId,
  });
  if (error !== null) {
    throw new DoorSaleError(rpcErrorCode(error), error.message);
  }
  const result = (data ?? {}) as Record<string, unknown>;
  if (typeof result.orderId !== "string" || !Array.isArray(result.ticketIds)) {
    throw new DoorSaleError("door_sale_invalid_response");
  }
  return {
    orderId: result.orderId,
    ticketIds: result.ticketIds.filter((id): id is string => typeof id === "string"),
    receiptQueued: result.receiptQueued === true,
    replayed: result.replayed === true,
  };
}

export async function fetchEventDoorSales(eventId: string): Promise<DoorSaleRecord[]> {
  const { data, error } = await supabase
    .from("orders")
    .select(`
      id,event_id,buyer_name,buyer_email,buyer_phone_e164,door_payment_method,
      buyer_total_cents,total_cents,currency,created_by_scanner_id,created_at,
      payment_status,refunded_amount_cents,metadata,
      events!inner(brand_id),
      order_line_items(id,ticket_type_id,quantity,unit_price_cents,total_cents,list_unit_price_cents,ticket_types(name,is_free)),
      refunds(id,amount_cents,reason,created_at,status)
    `)
    .eq("event_id", eventId)
    .eq("source", "door_sale")
    .order("created_at", { ascending: false });
  if (error !== null) throw new DoorSaleError(error.code ?? "door_sales_load_failed", error.message);
  return ((data ?? []) as unknown as DoorSaleRow[]).map(mapDoorSale);
}

export async function refundDoorSale(input: {
  orderId: string;
  amountCents: number;
  reason: string;
}): Promise<RefundDoorSaleResult> {
  const { data, error } = await supabase.rpc("biz_door_sale_refund", {
    p_order_id: input.orderId,
    p_amount_cents: input.amountCents,
    p_reason: input.reason.trim(),
  });
  if (error !== null) throw new DoorSaleError(rpcErrorCode(error), error.message);
  const result = (data ?? {}) as Record<string, unknown>;
  if (typeof result.orderId !== "string" || typeof result.refundId !== "string") {
    throw new DoorSaleError("door_refund_invalid_response");
  }
  return {
    orderId: result.orderId,
    refundId: result.refundId,
    amountCents: Number(result.amountCents ?? 0),
    refundedAmountCents: Number(result.refundedAmountCents ?? 0),
    status: result.status === "refunded" ? "refunded" : "partial_refund",
  };
}
