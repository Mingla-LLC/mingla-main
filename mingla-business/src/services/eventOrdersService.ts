import { supabase } from "./supabase";
import type { OrderRecord } from "../store/orderStore";

interface OrderRow {
  id: string;
  event_id: string;
  buyer_email: string | null;
  buyer_name: string | null;
  buyer_phone_e164: string | null;
  buyer_phone: string | null;
  total_cents: number;
  currency: string;
  payment_method: string;
  payment_status: string;
  confirmed_at: string | null;
  created_at: string;
  events: { brand_id: null | string } | null;
  order_line_items: Array<{
    ticket_type_id: string;
    quantity: number;
    unit_price_cents: number;
    total_cents: number;
    ticket_types: { name: string; is_free: boolean } | null;
  }>;
}

export interface EventOrderRevenue {
  soldCount: number;
  revenue: number;
  refunded: number;
  netRevenue: number;
  currency: string;
}

export interface EventOrderActivity {
  kind: "purchase" | "refund" | "cancel";
  orderId: string;
  buyerName: string;
  summary: string;
  amountGbp?: number;
  currency?: string;
  at: string;
}

const statusFromPayment = (status: string): OrderRecord["status"] => {
  if (status === "refunded") return "refunded_full";
  if (status === "partial_refund") return "refunded_partial";
  if (status === "failed") return "cancelled";
  return "paid";
};

const paymentMethodFromRow = (method: string): OrderRecord["paymentMethod"] => {
  if (method === "online_card") return "card";
  if (method === "apple_pay" || method === "google_pay" || method === "free") return method;
  if (method === "nfc" || method === "card_reader" || method === "cash" || method === "manual") {
    return method;
  }
  return "card";
};

export const fetchEventOrders = async (
  eventId: string,
): Promise<OrderRecord[]> => {
  const { data, error } = await supabase
    .from("orders")
    .select(`
      id,
      event_id,
      buyer_email,
      buyer_name,
      buyer_phone,
      buyer_phone_e164,
      total_cents,
      currency,
      payment_method,
      payment_status,
      confirmed_at,
      created_at,
      events!inner ( brand_id ),
      order_line_items (
        ticket_type_id,
        quantity,
        unit_price_cents,
        total_cents,
        ticket_types (name, is_free)
      )
    `)
    .eq("event_id", eventId)
    .order("created_at", { ascending: false });

  if (error) throw error;

  return ((data ?? []) as unknown as OrderRow[]).map((order) => ({
    id: order.id,
    eventId: order.event_id,
    brandId: order.events?.brand_id ?? "",
    buyer: {
      name: order.buyer_name ?? "Anonymous",
      email: order.buyer_email ?? "",
      phone: order.buyer_phone_e164 ?? order.buyer_phone ?? "",
      marketingOptIn: false,
    },
    lines: order.order_line_items.map((line) => ({
      ticketTypeId: line.ticket_type_id,
      ticketNameAtPurchase: line.ticket_types?.name ?? "Ticket",
      unitPriceGbpAtPurchase: line.unit_price_cents / 100,
      unitPriceAtPurchase: line.unit_price_cents / 100,
      isFreeAtPurchase: line.ticket_types?.is_free ?? line.unit_price_cents === 0,
      quantity: line.quantity,
      refundedQuantity: 0,
      refundedAmountGbp: 0,
      refundedAmount: 0,
    })),
    totalGbpAtPurchase: order.total_cents / 100,
    totalAtPurchase: order.total_cents / 100,
    currency: order.currency.trim(),
    paymentMethod: paymentMethodFromRow(order.payment_method),
    paidAt: order.confirmed_at ?? order.created_at,
    status: statusFromPayment(order.payment_status),
    refundedAmountGbp: 0,
    refundedAmount: 0,
    refunds: [],
    cancelledAt: order.payment_status === "failed" ? order.created_at : null,
    lastSeenEventUpdatedAt: order.created_at,
  }));
};

export const getEventOrderById = (
  orders: OrderRecord[],
  orderId: string,
): OrderRecord | null => orders.find((order) => order.id === orderId) ?? null;

export const getEventOrderRevenue = (
  orders: OrderRecord[],
  currency = "GBP",
): EventOrderRevenue => {
  let soldCount = 0;
  let revenue = 0;
  let refunded = 0;
  for (const order of orders) {
    if (order.status !== "paid" && order.status !== "refunded_partial") continue;
    for (const line of order.lines) {
      soldCount += Math.max(0, line.quantity - line.refundedQuantity);
    }
    revenue += order.totalAtPurchase ?? order.totalGbpAtPurchase;
    refunded += order.refundedAmount ?? order.refundedAmountGbp;
  }
  return {
    soldCount,
    revenue,
    refunded,
    netRevenue: revenue - refunded,
    currency,
  };
};

export const getEventSoldCounts = (
  orders: OrderRecord[],
): Record<string, number> => {
  const counts: Record<string, number> = {};
  for (const order of orders) {
    if (order.status !== "paid" && order.status !== "refunded_partial") continue;
    for (const line of order.lines) {
      const live = Math.max(0, line.quantity - line.refundedQuantity);
      if (live === 0) continue;
      counts[line.ticketTypeId] = (counts[line.ticketTypeId] ?? 0) + live;
    }
  }
  return counts;
};

export const getEventOrderActivity = (
  orders: OrderRecord[],
  sinceTs?: number,
): EventOrderActivity[] => {
  const cutoff = sinceTs ?? Number.NEGATIVE_INFINITY;
  const activity: EventOrderActivity[] = [];
  for (const order of orders) {
    const buyerName = order.buyer.name.trim().length > 0 ? order.buyer.name : "Anonymous";
    const totalQty = order.lines.reduce((sum, line) => sum + line.quantity, 0);
    const purchaseSummary =
      order.lines.length === 1
        ? `bought ${order.lines[0].quantity}x ${order.lines[0].ticketNameAtPurchase}`
        : `bought ${totalQty}x tickets`;
    if (new Date(order.paidAt).getTime() >= cutoff) {
      activity.push({
        kind: "purchase",
        orderId: order.id,
        buyerName,
        summary: purchaseSummary,
        amountGbp: order.totalAtPurchase ?? order.totalGbpAtPurchase,
        currency: order.currency,
        at: order.paidAt,
      });
    }
    for (const refund of order.refunds) {
      if (new Date(refund.refundedAt).getTime() < cutoff) continue;
      const refundedQty = refund.lines.reduce((sum, line) => sum + line.quantity, 0);
      activity.push({
        kind: "refund",
        orderId: order.id,
        buyerName,
        summary: `refunded ${refundedQty}x tickets`,
        amountGbp: refund.amount ?? refund.amountGbp,
        currency: order.currency,
        at: refund.refundedAt,
      });
    }
    if (order.status === "cancelled" && order.cancelledAt !== null) {
      if (new Date(order.cancelledAt).getTime() >= cutoff) {
        activity.push({
          kind: "cancel",
          orderId: order.id,
          buyerName,
          summary: "cancelled their order",
          at: order.cancelledAt,
        });
      }
    }
  }
  return activity.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
};

export const getEventHasWebPurchases = (orders: OrderRecord[]): boolean =>
  orders.some(
    (order) =>
      order.paymentMethod === "card" ||
      order.paymentMethod === "apple_pay" ||
      order.paymentMethod === "google_pay",
  );

export const getEventGuestList = (orders: OrderRecord[]): OrderRecord[] => orders;

export const getEventGuestById = (
  orders: OrderRecord[],
  guestId: string,
): OrderRecord | null => getEventOrderById(orders, guestId);
