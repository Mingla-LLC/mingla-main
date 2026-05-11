import { supabase } from "./supabase";
import type { OrderRecord, RefundRecord } from "../store/orderStore";

// ORCH-0787: Order shape now includes server-truth refunds + line-level refund accounting
// + cancellation columns. The hardcoded `refunds: []` stub is gone.

interface OrderLineItemRow {
  id: string;
  ticket_type_id: string;
  quantity: number;
  unit_price_cents: number;
  total_cents: number;
  ticket_types: { name: string; is_free: boolean } | null;
}

interface RefundLineItemRow {
  order_line_item_id: string;
  ticket_type_id: string;
  quantity: number;
  amount_cents: number;
}

interface RefundRow {
  id: string;
  amount_cents: number;
  currency: string;
  reason: string | null;
  status: string;
  processed_at: string | null;
  created_at: string;
  stripe_refund_id: string | null;
  refund_line_items: RefundLineItemRow[];
}

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
  // ORCH-0787 cancellation columns
  cancelled_at: string | null;
  cancelled_by: string | null;
  cancellation_reason: string | null;
  refunded_amount_cents: number;
  events: { brand_id: null | string } | null;
  order_line_items: OrderLineItemRow[];
  refunds: RefundRow[];
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

// ORCH-0787: split the conflated 'failed' → 'cancelled' mapping per I-PROPOSED-(new)
// ORDER-CANCELLED-VS-FAILED-SEPARATION. 'failed' is a Stripe gateway failure (rare for
// finalized orders — pre-finalization failures live in ticket_checkout_sessions). 'cancelled'
// is intentional organiser cancellation via biz_cancel_order. OrderStatus does not include
// 'failed' today (orderStore.ts:56-60 union); we map failed orders to 'cancelled' status
// at the surface level only for visibility — they remain DB-distinct via payment_status.
// TODO ORCH-0788 / follow-up: extend OrderStatus union with 'failed' once UI is ready.
const statusFromPayment = (status: string): OrderRecord["status"] => {
  if (status === "refunded") return "refunded_full";
  if (status === "partial_refund") return "refunded_partial";
  if (status === "cancelled") return "cancelled";
  // 'failed' orders are gateway failures that finalized into the orders table. Today the
  // orders list filters won't surface them; if they appear, surface as paid (default) and
  // rely on the next ORCH to add explicit Failed visibility. Tickets are still 'valid' for
  // failed orders so scanner gates remain correct.
  if (status === "failed") return "paid";
  return "paid";
};

const mapRefundRow = (row: RefundRow, orderCurrency: string): RefundRecord => {
  const amountMajor = row.amount_cents / 100;
  return {
    id: row.id,
    orderId: "", // populated by caller
    amountGbp: amountMajor,
    amount: amountMajor,
    reason: row.reason ?? "",
    refundedAt: row.processed_at ?? row.created_at,
    lines: (row.refund_line_items ?? []).map((rli) => ({
      ticketTypeId: rli.ticket_type_id,
      quantity: rli.quantity,
      amountGbp: rli.amount_cents / 100,
      amount: rli.amount_cents / 100,
    })),
  };
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
  // ORCH-0787: select includes refunds + refund_line_items (joined) for server-truth refund state.
  // Also pulls orders.cancelled_at + cancellation_reason + refunded_amount_cents cache.
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
      cancelled_at,
      cancelled_by,
      cancellation_reason,
      refunded_amount_cents,
      events!inner ( brand_id ),
      order_line_items (
        id,
        ticket_type_id,
        quantity,
        unit_price_cents,
        total_cents,
        ticket_types (name, is_free)
      ),
      refunds (
        id,
        amount_cents,
        currency,
        reason,
        status,
        processed_at,
        created_at,
        stripe_refund_id,
        refund_line_items (
          order_line_item_id,
          ticket_type_id,
          quantity,
          amount_cents
        )
      )
    `)
    .eq("event_id", eventId)
    .order("created_at", { ascending: false });

  if (error) throw error;

  return ((data ?? []) as unknown as OrderRow[]).map((order) => {
    // ORCH-0787: filter refunds to status='succeeded' for the visible refund ledger.
    // Pending/failed refunds do not appear in the UI (they exist for reconciliation only).
    const succeededRefunds = (order.refunds ?? []).filter((r) => r.status === "succeeded");
    const orderCurrency = order.currency.trim();

    // Build per-line refund accounting from refund_line_items across succeeded refunds.
    const refundedQtyByLine: Record<string, number> = {};
    const refundedAmountByLine: Record<string, number> = {};
    for (const refund of succeededRefunds) {
      for (const rli of refund.refund_line_items ?? []) {
        refundedQtyByLine[rli.order_line_item_id] =
          (refundedQtyByLine[rli.order_line_item_id] ?? 0) + rli.quantity;
        refundedAmountByLine[rli.order_line_item_id] =
          (refundedAmountByLine[rli.order_line_item_id] ?? 0) + rli.amount_cents;
      }
    }

    const refundedAmountMajor = (order.refunded_amount_cents ?? 0) / 100;

    return {
      id: order.id,
      eventId: order.event_id,
      brandId: order.events?.brand_id ?? "",
      buyer: {
        name: order.buyer_name ?? "Anonymous",
        email: order.buyer_email ?? "",
        phone: order.buyer_phone_e164 ?? order.buyer_phone ?? "",
        marketingOptIn: false,
      },
      lines: order.order_line_items.map((line) => {
        const refundedQty = refundedQtyByLine[line.id] ?? 0;
        const refundedAmountCents = refundedAmountByLine[line.id] ?? 0;
        return {
          orderLineItemId: line.id,
          ticketTypeId: line.ticket_type_id,
          ticketNameAtPurchase: line.ticket_types?.name ?? "Ticket",
          unitPriceGbpAtPurchase: line.unit_price_cents / 100,
          unitPriceAtPurchase: line.unit_price_cents / 100,
          isFreeAtPurchase: line.ticket_types?.is_free ?? line.unit_price_cents === 0,
          quantity: line.quantity,
          refundedQuantity: refundedQty,
          refundedAmountGbp: refundedAmountCents / 100,
          refundedAmount: refundedAmountCents / 100,
        };
      }),
      totalGbpAtPurchase: order.total_cents / 100,
      totalAtPurchase: order.total_cents / 100,
      currency: orderCurrency,
      paymentMethod: paymentMethodFromRow(order.payment_method),
      paidAt: order.confirmed_at ?? order.created_at,
      status: statusFromPayment(order.payment_status),
      refundedAmountGbp: refundedAmountMajor,
      refundedAmount: refundedAmountMajor,
      refunds: succeededRefunds.map((row) => ({
        ...mapRefundRow(row, orderCurrency),
        orderId: order.id,
      })),
      // ORCH-0787: cancelled_at is the canonical column. Failed payments are NOT mapped to cancelled.
      cancelledAt: order.cancelled_at,
      lastSeenEventUpdatedAt: order.created_at,
    };
  });
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
