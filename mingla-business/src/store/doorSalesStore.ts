/**
 * doorSalesStore — persisted Zustand store for in-person door sales (Cycle 12).
 *
 * I-29: Door sales live in useDoorSalesStore.entries ONLY. NEVER as phantom
 * OrderRecord rows in useOrderStore. CheckoutPaymentMethod online union
 * filters to "card | apple_pay | google_pay | free"; door payment methods
 * "cash | card_reader | nfc | manual" are RESERVED for door flow ONLY.
 *
 * I-30: Door-tier vs online-tier separation enforced via TicketStub.availableAt.
 * Online checkout filters availableAt !== "door"; door flow filters
 * availableAt !== "online". AddCompGuestSheet filters availableAt === "both".
 *
 * Refund pattern (mirrors Cycle 9c orderStore): refunds are append-only;
 * original lines NEVER overwritten; status flips refunded_partial / refunded_full.
 *
 * I-19 spirit (Cycle 12 OBS-1): refund of door sale affects MONEY only
 * (DoorSaleRecord state). Auto-check-in (useScanStore success record fired
 * at sale time) is NEVER voided by refund — physical attendance ≠ financial
 * event.
 *
 * Constitutional notes:
 *   - #2 one owner per truth: door sales live ONLY here; NEVER duplicated in
 *     orderStore or guestStore.
 *   - #6 logout clears: extended via clearAllStores.
 *   - #9 no fabricated data: store starts EMPTY; never seeded.
 *   - #10 currency-aware: currency: "GBP" frozen on every sale.
 *
 * [TRANSITIONAL] Zustand persist holds entries client-side. B-cycle migrates
 * to Supabase door_sales_ledger (PR #59 schema READY + ORCH-0706 hardened
 * the payment_method CHECK constraint). When backend lands, this store
 * contracts to a cache + ID-only.
 *
 * Per Cycle 12 SPEC §4.5.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import {
  createJSONStorage,
  persist,
  type PersistOptions,
} from "zustand/middleware";

// ---- Types ----------------------------------------------------------

export type DoorPaymentMethod = "cash" | "card_reader" | "nfc" | "manual";

export interface DoorSaleLine {
  /** References LiveEvent.tickets[].id (stable across event edits). */
  ticketTypeId: string;
  /** FROZEN at sale. NEVER mutated. */
  ticketNameAtSale: string;
  /** FROZEN at sale. NEVER mutated. */
  unitPriceGbpAtSale: number;
  /** FROZEN at sale. NEVER mutated. */
  isFreeAtSale: boolean;
  /** FROZEN at sale. NEVER mutated. */
  quantity: number;
  /** Mutable post-refund. 0 ≤ refundedQuantity ≤ quantity. */
  refundedQuantity: number;
  /** Mutable post-refund. Sum of refunds applied to this line. */
  refundedAmountGbp: number;
}

export interface DoorRefundRecord {
  /** dr_<base36-ts>_<base36-rand4> */
  id: string;
  saleId: string;
  amountGbp: number;
  /** REQUIRED 10..200 chars trimmed (mirrors Cycle 9c refund reason). */
  reason: string;
  refundedAt: string;
  /** Per-line attribution. */
  lines: { ticketTypeId: string; quantity: number; amountGbp: number }[];
}

export type DoorSaleStatus = "completed" | "refunded_full" | "refunded_partial";

export interface DoorSaleRecord {
  // Identity
  /** ds_<base36-ts>_<base36-rand4> */
  id: string;
  eventId: string;
  /** Denormalized for fast brand-scoped queries. */
  brandId: string;
  /** Operator/scanner account_id (auth.users.id); audit. Cycle 12: always operator. */
  recordedBy: string;
  // Optional buyer info — door buyer may be anonymous walk-up
  /** Empty string for anonymous walk-ups. */
  buyerName: string;
  /** Empty string if not collected. */
  buyerEmail: string;
  /** Empty string if not collected. */
  buyerPhone: string;
  // Snapshot at sale (write-once)
  paymentMethod: DoorPaymentMethod;
  lines: DoorSaleLine[];
  totalGbpAtSale: number;
  /** Locked per Const #10. */
  currency: "GBP";
  /** Operator notes (e.g., "John gave £50 cash, change £20"). 0..500 chars. */
  notes: string;
  recordedAt: string;
  // Mutable lifecycle
  status: DoorSaleStatus;
  /** Sum across all refunds (denormalized cache). */
  refundedAmountGbp: number;
  /** Append-only audit log. */
  refunds: DoorRefundRecord[];
}

export interface DoorSalesStoreState {
  entries: DoorSaleRecord[];
  // ---- Mutations ----
  /**
   * Append-only. Returns the new DoorSaleRecord (caller fires N scan
   * records per Decision #5). Never throws.
   */
  recordSale: (
    sale: Omit<
      DoorSaleRecord,
      "id" | "recordedAt" | "status" | "refundedAmountGbp" | "refunds"
    >,
  ) => DoorSaleRecord;
  /**
   * Appends DoorRefundRecord, updates per-line refundedQuantity +
   * refundedAmountGbp, flips status. Returns updated DoorSaleRecord, or
   * null if sale not found. **OBS-1 lock: caller MUST NOT touch
   * useScanStore — refund is money-only, not attendance.**
   */
  recordRefund: (
    saleId: string,
    refund: Omit<DoorRefundRecord, "id" | "refundedAt">,
  ) => DoorSaleRecord | null;
  /** Logout reset. */
  reset: () => void;
  // ---- Selectors ----
  /** Single existing reference; safe to subscribe. */
  getSaleById: (saleId: string) => DoorSaleRecord | null;
  /** Fresh array; USE VIA .getState() ONLY (one-shot lookups). */
  getSalesForEvent: (eventId: string) => DoorSaleRecord[];
  getDoorRevenueForEvent: (eventId: string) => number;
  getDoorSoldCountForEvent: (eventId: string) => number;
}

// ---- ID generators ---------------------------------------------------

const generateSaleId = (): string => {
  const ts36 = Date.now().toString(36);
  const rand4 = Math.floor(Math.random() * 36 ** 4)
    .toString(36)
    .padStart(4, "0");
  return `ds_${ts36}_${rand4}`;
};

const generateDoorRefundId = (): string => {
  const ts36 = Date.now().toString(36);
  const rand4 = Math.floor(Math.random() * 36 ** 4)
    .toString(36)
    .padStart(4, "0");
  return `dr_${ts36}_${rand4}`;
};

// ---- Persistence ----------------------------------------------------

type PersistedState = Pick<DoorSalesStoreState, "entries">;

const persistOptions: PersistOptions<DoorSalesStoreState, PersistedState> = {
  name: "mingla-business.doorSalesStore.v1",
  storage: createJSONStorage(() => AsyncStorage),
  partialize: (s): PersistedState => ({ entries: s.entries }),
  version: 1,
};

// ---- Store ----------------------------------------------------------

export const useDoorSalesStore = create<DoorSalesStoreState>()(
  persist(
    (set, get) => ({
      entries: [],

      // ---- Mutations ----

      // Caller-side audit / scan firing per HIDDEN-1 contract; recordSale
      // returns the new record so the caller can deterministically fire
      // N × useScanStore.recordScan({ via: "manual", scanResult: "success" })
      // for each ticket per Decision #5.
      recordSale: (sale): DoorSaleRecord => {
        const newSale: DoorSaleRecord = {
          ...sale,
          id: generateSaleId(),
          recordedAt: new Date().toISOString(),
          status: "completed",
          refundedAmountGbp: 0,
          refunds: [],
        };
        // Prepend so getSalesForEvent returns newest-first naturally.
        set((s) => ({ entries: [newSale, ...s.entries] }));
        return newSale;
      },

      recordRefund: (saleId, refund): DoorSaleRecord | null => {
        const sale = get().entries.find((e) => e.id === saleId);
        if (sale === undefined) return null;
        const id = generateDoorRefundId();
        const refundedAt = new Date().toISOString();
        const fullRefund: DoorRefundRecord = { ...refund, id, refundedAt };

        // Update per-line aggregates from refund.lines[]
        const newLines = sale.lines.map((line) => {
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
          sale.refundedAmountGbp + fullRefund.amountGbp;
        const allLinesFullyRefunded = newLines.every(
          (l) => l.refundedQuantity >= l.quantity,
        );
        const newStatus: DoorSaleStatus = allLinesFullyRefunded
          ? "refunded_full"
          : "refunded_partial";

        const updatedSale: DoorSaleRecord = {
          ...sale,
          lines: newLines,
          refundedAmountGbp: newRefundedAmount,
          refunds: [...sale.refunds, fullRefund],
          status: newStatus,
        };

        set((s) => ({
          entries: s.entries.map((e) =>
            e.id === saleId ? updatedSale : e,
          ),
        }));

        // OBS-1 lock: NO useScanStore touch. Refund is money-only; the
        // auto-check-in scan record stays untouched (the buyer was
        // physically at the door — financial event ≠ attendance event).
        // Caller (DoorRefundSheet) does NOT fire any scan record either.
        return updatedSale;
      },

      reset: (): void => {
        set({ entries: [] });
      },

      // ---- Selectors ----

      getSaleById: (saleId): DoorSaleRecord | null =>
        get().entries.find((e) => e.id === saleId) ?? null,

      getSalesForEvent: (eventId): DoorSaleRecord[] =>
        get().entries.filter((e) => e.eventId === eventId),

      getDoorRevenueForEvent: (eventId): number => {
        const sales = get().entries.filter((e) => e.eventId === eventId);
        return sales.reduce(
          (sum, s) =>
            sum + Math.max(0, s.totalGbpAtSale - s.refundedAmountGbp),
          0,
        );
      },

      getDoorSoldCountForEvent: (eventId): number => {
        const sales = get().entries.filter((e) => e.eventId === eventId);
        return sales.reduce(
          (sum, s) =>
            sum +
            s.lines.reduce(
              (lineSum, l) =>
                lineSum + Math.max(0, l.quantity - l.refundedQuantity),
              0,
            ),
          0,
        );
      },
    }),
    persistOptions,
  ),
);
