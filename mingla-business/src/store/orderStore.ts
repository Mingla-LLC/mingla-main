/**
 * orderStore — persisted Zustand store for paid orders.
 *
 * Created Cycle 9c per spec §3.1.1 + §3.2.1 + §3.2.2. OrderRecord shape
 * matches ORCH-0704 SPEC v2 §3.1.5 verbatim — NO drift.
 *
 * Constitutional notes:
 *   - #2 one owner per truth: orders live ONLY here. NEVER duplicated in
 *     liveEventStore or CartContext.
 *   - #6 logout clears: extended via `clearAllStores`.
 *   - #9 no fabricated data: store starts EMPTY; never seeded.
 *   - #10 currency-aware UI: `currency: "GBP"` frozen on every order.
 *
 * I-19 — Immutable order financials:
 *   API surface enforces write-once on lines[i].* snapshot fields +
 *   buyer + currency + paidAt + paymentMethod. Mutations expose ONLY
 *   recordOrder (idempotent dedupe by id), recordRefund (creates
 *   RefundRecord; updates aggregates), cancelOrder (sets status +
 *   cancelledAt), updateLastSeenEventUpdatedAt (buyer acknowledge),
 *   reset (logout). NO updateLine, NO updateBuyer, NO updatePrice,
 *   NO setStatus.
 *
 * I-18 — Buyer→founder order persistence:
 *   `confirm.tsx` calls `recordOrder` immediately after the existing
 *   `cart.recordResult({...})` call. Operator's Orders ledger reads
 *   from `getOrdersForEvent`. RATIFIED at Cycle 9c CLOSE.
 *
 * [TRANSITIONAL] Zustand persist holds orders client-side. B-cycle
 * migrates to Supabase orders + order_line_items per PR #59 §B.4. When
 * backend lands, this store contracts to a cache + ID-only.
 *
 * Per Cycle 9c spec §3.1.1 + §3.2.1 + §3.2.2.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import {
  createJSONStorage,
  persist,
  type PersistOptions,
} from "zustand/middleware";

import type { CheckoutPaymentMethod } from "../components/checkout/CartContext";

// Cycle 9c rework v2 — orderStore is PURE DATA. Notification + edit-log
// side effects fired by callers (RefundSheet + CancelOrderDialog) to break
// the require cycle (liveEventStore → orderStore → liveEventStore).

// ---- Types (verbatim from ORCH-0704 SPEC v2 §3.1.5) -----------------

export type OrderStatus =
  | "paid"
  | "refunded_full"
  | "refunded_partial"
  | "cancelled";

export interface OrderLineRecord {
  /** References LiveEvent.tickets[].id (stable across event edits). */
  ticketTypeId: string;
  /** FROZEN at purchase. NEVER mutated. */
  ticketNameAtPurchase: string;
  /** FROZEN at purchase. NEVER mutated. */
  unitPriceGbpAtPurchase: number;
  /** FROZEN at purchase. NEVER mutated. */
  isFreeAtPurchase: boolean;
  /** FROZEN at purchase. NEVER mutated. */
  quantity: number;
  /** Mutable post-refund. 0 ≤ refundedQuantity ≤ quantity. */
  refundedQuantity: number;
  /** Mutable post-refund. Sum of refunds applied to this line. */
  refundedAmountGbp: number;
}

export interface BuyerSnapshot {
  /** All FROZEN at purchase. NEVER mutated. */
  name: string;
  email: string;
  /** Empty string if buyer didn't provide. */
  phone: string;
  marketingOptIn: boolean;
}

export interface RefundRecord {
  /** rf_<ts36>_<rand4> */
  id: string;
  orderId: string;
  amountGbp: number;
  /** REQUIRED 10..200 chars trimmed (spec §3.1.1 D-9c-9). */
  reason: string;
  refundedAt: string;
  /** For partial refunds: which lines + quantities. Full refund = all lines. */
  lines: { ticketTypeId: string; quantity: number; amountGbp: number }[];
}

export interface OrderRecord {
  // Identity
  id: string;
  eventId: string;
  /** Denormalized for fast brand-scoped queries. */
  brandId: string;
  // Snapshot at purchase (write-once)
  buyer: BuyerSnapshot;
  lines: OrderLineRecord[];
  totalGbpAtPurchase: number;
  /** Locked per Const #10. */
  currency: "GBP";
  paymentMethod: CheckoutPaymentMethod;
  paidAt: string;
  // Mutable lifecycle
  status: OrderStatus;
  /** Sum across all refunds (denormalized cache). */
  refundedAmountGbp: number;
  /** Append-only audit log. */
  refunds: RefundRecord[];
  cancelledAt: string | null;
  /**
   * Advances when buyer views their order detail page (buyer-side
   * material-change banner acknowledge). Initialized to event.updatedAt
   * at recordOrder time so first view shows no stale banner.
   */
  lastSeenEventUpdatedAt: string;
}

export interface OrderStoreState {
  entries: OrderRecord[];
  // ---- Mutations ----
  /**
   * Idempotent — dedupes by id. If id exists, returns existing record
   * without overwriting (I-19 write-once).
   */
  recordOrder: (order: OrderRecord) => OrderRecord;
  /**
   * Appends RefundRecord, updates per-line refundedQuantity +
   * refundedAmountGbp, flips status to "refunded_full" or
   * "refunded_partial". Fires destructive notification + records edit
   * log entry. Returns updated OrderRecord, or null if order not found.
   */
  recordRefund: (
    orderId: string,
    refund: Omit<RefundRecord, "id" | "refundedAt">,
  ) => OrderRecord | null;
  /**
   * Sets status="cancelled" + cancelledAt. Fires destructive notification
   * + records edit log entry. Returns updated OrderRecord, or null if
   * order not found.
   */
  cancelOrder: (orderId: string, reason: string) => OrderRecord | null;
  /** Buyer-side acknowledge — does NOT fire notification. */
  updateLastSeenEventUpdatedAt: (orderId: string, iso: string) => void;
  /** Logout reset — wired via `clearAllStores`. */
  reset: () => void;
  // ---- Selectors ----
  /** All orders for an event, newest first. */
  getOrdersForEvent: (eventId: string) => OrderRecord[];
  getOrderById: (orderId: string) => OrderRecord | null;
  /**
   * Sum of (line.quantity - line.refundedQuantity) across paid +
   * refunded_partial orders for the event.
   */
  getSoldCountForEvent: (eventId: string) => number;
  /** Same as above, grouped by ticketTypeId. */
  getSoldCountByTier: (eventId: string) => Record<string, number>;
  /**
   * Sum of (totalGbpAtPurchase - refundedAmountGbp) across paid +
   * refunded_partial orders for the event.
   */
  getRevenueForEvent: (eventId: string) => number;
}

// ---- ID generator ---------------------------------------------------

const generateRefundId = (): string => {
  const ts36 = Date.now().toString(36);
  const rand4 = Math.floor(Math.random() * 36 ** 4)
    .toString(36)
    .padStart(4, "0");
  return `rf_${ts36}_${rand4}`;
};

// ---- Persistence ----------------------------------------------------

type PersistedState = Pick<OrderStoreState, "entries">;

const persistOptions: PersistOptions<OrderStoreState, PersistedState> = {
  name: "mingla-business.orderStore.v1",
  storage: createJSONStorage(() => AsyncStorage),
  partialize: (s): PersistedState => ({ entries: s.entries }),
  version: 1,
};

// ---- Store ----------------------------------------------------------

export const useOrderStore = create<OrderStoreState>()(
  persist(
    (set, get) => ({
      entries: [],

      // ---- Mutations ----

      recordOrder: (order): OrderRecord => {
        const existing = get().entries.find((o) => o.id === order.id);
        if (existing !== undefined) return existing; // I-19 write-once dedupe
        // Prepend so getOrdersForEvent returns newest-first naturally.
        set((s) => ({ entries: [order, ...s.entries] }));
        return order;
      },

      recordRefund: (orderId, refund): OrderRecord | null => {
        const order = get().entries.find((o) => o.id === orderId);
        if (order === undefined) return null;
        const id = generateRefundId();
        const refundedAt = new Date().toISOString();
        const fullRefund: RefundRecord = { ...refund, id, refundedAt };

        // Update per-line aggregates from refund.lines[]
        const newLines = order.lines.map((line) => {
          const lineRefund = fullRefund.lines.find(
            (rl) => rl.ticketTypeId === line.ticketTypeId,
          );
          if (lineRefund === undefined) return line;
          return {
            ...line,
            refundedQuantity: line.refundedQuantity + lineRefund.quantity,
            refundedAmountGbp:
              line.refundedAmountGbp + lineRefund.amountGbp,
          };
        });

        const newRefundedAmount =
          order.refundedAmountGbp + fullRefund.amountGbp;
        const allLinesFullyRefunded = newLines.every(
          (l) => l.refundedQuantity >= l.quantity,
        );
        const newStatus: OrderStatus = allLinesFullyRefunded
          ? "refunded_full"
          : "refunded_partial";

        const updatedOrder: OrderRecord = {
          ...order,
          lines: newLines,
          refundedAmountGbp: newRefundedAmount,
          refunds: [...order.refunds, fullRefund],
          status: newStatus,
        };

        set((s) => ({
          entries: s.entries.map((o) => (o.id === orderId ? updatedOrder : o)),
        }));

        // Side effects (notification + edit log) fired by caller
        // (RefundSheet) to break require cycle. Caller has the OrderRecord
        // returned here + can read event/brand stores without circular import.
        return updatedOrder;
      },

      cancelOrder: (orderId, reason): OrderRecord | null => {
        const order = get().entries.find((o) => o.id === orderId);
        if (order === undefined) return null;
        // reason is preserved on the function signature for caller symmetry
        // (component uses the same string for the notification it fires)
        // but the store does NOT consume it directly.
        void reason;
        const cancelledAt = new Date().toISOString();
        const updatedOrder: OrderRecord = {
          ...order,
          status: "cancelled",
          cancelledAt,
        };

        set((s) => ({
          entries: s.entries.map((o) => (o.id === orderId ? updatedOrder : o)),
        }));

        // Side effects fired by caller (CancelOrderDialog).
        return updatedOrder;
      },

      updateLastSeenEventUpdatedAt: (orderId, iso): void => {
        set((s) => ({
          entries: s.entries.map((o) =>
            o.id === orderId ? { ...o, lastSeenEventUpdatedAt: iso } : o,
          ),
        }));
      },

      reset: (): void => {
        set({ entries: [] });
      },

      // ---- Selectors ----

      getOrdersForEvent: (eventId): OrderRecord[] =>
        get().entries.filter((o) => o.eventId === eventId),

      getOrderById: (orderId): OrderRecord | null =>
        get().entries.find((o) => o.id === orderId) ?? null,

      getSoldCountForEvent: (eventId): number => {
        const orders = get().entries.filter((o) => o.eventId === eventId);
        const liveOrders = orders.filter(
          (o) => o.status === "paid" || o.status === "refunded_partial",
        );
        return liveOrders.reduce(
          (sum, o) =>
            sum +
            o.lines.reduce(
              (s, l) => s + Math.max(0, l.quantity - l.refundedQuantity),
              0,
            ),
          0,
        );
      },

      getSoldCountByTier: (eventId): Record<string, number> => {
        const orders = get().entries.filter((o) => o.eventId === eventId);
        const liveOrders = orders.filter(
          (o) => o.status === "paid" || o.status === "refunded_partial",
        );
        const out: Record<string, number> = {};
        for (const order of liveOrders) {
          for (const line of order.lines) {
            const live = Math.max(0, line.quantity - line.refundedQuantity);
            if (live === 0) continue;
            out[line.ticketTypeId] =
              (out[line.ticketTypeId] ?? 0) + live;
          }
        }
        return out;
      },

      getRevenueForEvent: (eventId): number => {
        const orders = get().entries.filter((o) => o.eventId === eventId);
        const liveOrders = orders.filter(
          (o) => o.status === "paid" || o.status === "refunded_partial",
        );
        return liveOrders.reduce(
          (sum, o) =>
            sum + Math.max(0, o.totalGbpAtPurchase - o.refundedAmountGbp),
          0,
        );
      },
    }),
    persistOptions,
  ),
);
