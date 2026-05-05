/**
 * reconciliation — Pure aggregator joining 4 client stores into ReconciliationSummary (Cycle 13).
 *
 * Cycle 13 + DEC-095 — 11 architectural decisions locked. Reads-only over:
 *   - useOrderStore.entries (Cycle 9c)
 *   - useDoorSalesStore.entries (Cycle 12)
 *   - useGuestStore.entries (Cycle 10)
 *   - useScanStore.entries (Cycle 11)
 *
 * Selector contract: caller passes RAW arrays (raw entries + useMemo at the route layer).
 * NEVER subscribe to fresh-array selectors directly (banned per Cycle 9c v2 + Cycle 12 lesson).
 *
 * I-27 defensive dedupe: scanStore does NOT enforce single-scan-per-ticket at store level
 * (D-CYCLE13-RECON-FOR-1; B-cycle backlog). Cycle 13 dedupes by ticketId via Set for the
 * uniqueScannedTickets count.
 *
 * D-13-10 settlement-stub split: payoutEstimate = round(onlineRevenue × 96)/100 + doorRevenue.
 * Online×0.96 (Stripe fee stub); door×1.0 (cash fees zero; card_reader/NFC schedules ship B-cycle).
 *
 * D1/D2/D3 discrepancy detection: ADVISORY-only per D-13-4. D4 (unscanned) is informational,
 * NOT a discrepancy (reframed as "no-shows" on past events per D-13-6).
 *
 * Pure: no side effects, no console.log, no async.
 *
 * Per Cycle 13 SPEC §4.2.1.
 */

import type { CompGuestEntry } from "../store/guestStore";
import type { DoorSaleRecord } from "../store/doorSalesStore";
import type { OrderRecord } from "../store/orderStore";
import type { ScanRecord } from "../store/scanStore";
import { expandDoorTickets } from "./expandDoorTickets";
import { formatGbp } from "./currency";

// ---- Types -----------------------------------------------------------

export type EventLifecycleStatus = "live" | "upcoming" | "past" | "cancelled";

export type PaymentMethodKey =
  | "card"
  | "apple_pay"
  | "google_pay"
  | "free"
  | "cash"
  | "card_reader"
  | "nfc"
  | "manual";

export type DiscrepancyKind =
  | "auto_check_in_mismatch"
  | "method_sum_mismatch"
  | "refund_status_mismatch";

export interface DiscrepancyEntry {
  kind: DiscrepancyKind;
  /** Plain-English copy for the discrepancy row (deterministic for same inputs). */
  copy: string;
  /** Sub-row dim hint text. Always present (never undefined) per SPEC §4.2.1. */
  followupHint: string;
}

export interface ReconciliationSummary {
  // ---- Headline / lifecycle ----
  status: EventLifecycleStatus;
  headlineCopy: string;

  // ---- Tickets ----
  onlineLiveTickets: number;
  doorLiveTickets: number;
  compTickets: number;
  totalLiveTickets: number;

  // ---- Revenue ----
  onlineRevenue: number;
  doorRevenue: number;
  grossRevenue: number;
  totalRefunded: number;
  /** Sum of values across all 8 keys MUST equal grossRevenue (within ±0.005 rounding tolerance). */
  revenueByMethod: Record<PaymentMethodKey, number>;
  /** [TRANSITIONAL] payoutEstimate per D-13-10. EXIT: B-cycle Stripe payout API + Stripe Terminal SDK. */
  payoutEstimate: number;
  /** Online refund subtotal; for break-down rendering. */
  onlineRefunded: number;
  /** Door refund subtotal; for break-down rendering. */
  doorRefunded: number;

  // ---- Scans ----
  uniqueScannedTickets: number;
  scanDups: number;
  scanWrongEvent: number;
  scanNotFound: number;
  scanVoid: number;
  scanCancelled: number;
  /** key = scannerUserId; value = unique-ticket success-scan count for that scanner. */
  scansByScanner: Record<string, number>;

  // ---- D4 informational (not discrepancy) ----
  unscannedTickets: number;

  // ---- Discrepancies (D1+D2+D3 only) ----
  discrepancies: DiscrepancyEntry[];
}

export interface ReconciliationInputs {
  eventId: string;
  status: EventLifecycleStatus;
  eventName: string;
  orderEntries: OrderRecord[];
  doorEntries: DoorSaleRecord[];
  compEntries: CompGuestEntry[];
  scanEntries: ScanRecord[];
}

// ---- Constants -------------------------------------------------------

const ZERO_REVENUE_BY_METHOD: Record<PaymentMethodKey, number> = {
  card: 0,
  apple_pay: 0,
  google_pay: 0,
  free: 0,
  cash: 0,
  card_reader: 0,
  nfc: 0,
  manual: 0,
};

/**
 * EMPTY_SUMMARY — used when event === null OR eventId is not a string.
 * Every numeric field === 0; revenueByMethod has all 8 keys at 0;
 * scansByScanner === {}; discrepancies === []; status === "upcoming";
 * headlineCopy === "" (route uses fallback when headline empty).
 */
export const EMPTY_SUMMARY: ReconciliationSummary = {
  status: "upcoming",
  headlineCopy: "",
  onlineLiveTickets: 0,
  doorLiveTickets: 0,
  compTickets: 0,
  totalLiveTickets: 0,
  onlineRevenue: 0,
  doorRevenue: 0,
  grossRevenue: 0,
  totalRefunded: 0,
  revenueByMethod: { ...ZERO_REVENUE_BY_METHOD },
  payoutEstimate: 0,
  onlineRefunded: 0,
  doorRefunded: 0,
  uniqueScannedTickets: 0,
  scanDups: 0,
  scanWrongEvent: 0,
  scanNotFound: 0,
  scanVoid: 0,
  scanCancelled: 0,
  scansByScanner: {},
  unscannedTickets: 0,
  discrepancies: [],
};

// ---- Helpers ---------------------------------------------------------

/** Round to 2 decimal places to avoid float drift in revenue arithmetic. */
const round2 = (n: number): number => Math.round(n * 100) / 100;

/**
 * Headline copy lookup — exposed for route consumers + tests.
 * BINDING per SPEC §4.2.1.
 */
export const headlineCopyFor = (status: EventLifecycleStatus): string => {
  switch (status) {
    case "live":
      return "Live · reconciliation in progress";
    case "upcoming":
      return "Upcoming · pre-event door sales";
    case "past":
      return "Ticket sales ended · final reconciliation";
    case "cancelled":
      return "Event cancelled · refund/payout audit";
    default: {
      const _exhaust: never = status;
      return _exhaust;
    }
  }
};

// ---- Aggregator ------------------------------------------------------

/**
 * Deterministic aggregator. Pure — no side effects, no console.log, no async.
 * Handles empty input arrays gracefully (returns zero-counts everywhere).
 * Dedupes scans by ticketId per I-27 defensive contract.
 */
export const computeReconciliation = (
  inputs: ReconciliationInputs,
): ReconciliationSummary => {
  const {
    eventId,
    status,
    orderEntries,
    doorEntries,
    compEntries,
    scanEntries,
  } = inputs;

  // ---- Tickets (online live, excludes cancelled — refunded-partial keeps live qty - refundedQty) ----
  const eventOrders = orderEntries.filter((o) => o.eventId === eventId);
  const liveOrders = eventOrders.filter(
    (o) => o.status === "paid" || o.status === "refunded_partial",
  );
  let onlineLiveTickets = 0;
  for (const order of liveOrders) {
    for (const line of order.lines) {
      onlineLiveTickets += Math.max(0, line.quantity - line.refundedQuantity);
    }
  }

  // ---- Tickets (door live — no status filter; refunded sales still contribute live tickets per OBS-1) ----
  const eventDoorSales = doorEntries.filter((s) => s.eventId === eventId);
  let doorLiveTickets = 0;
  for (const sale of eventDoorSales) {
    for (const line of sale.lines) {
      doorLiveTickets += Math.max(0, line.quantity - line.refundedQuantity);
    }
  }

  // ---- Tickets (comps) ----
  const eventComps = compEntries.filter((c) => c.eventId === eventId);
  const compTickets = eventComps.length;

  const totalLiveTickets = onlineLiveTickets + doorLiveTickets + compTickets;

  // ---- Revenue (online live = total - refunded; cancelled excluded) ----
  let onlineRevenue = 0;
  for (const order of liveOrders) {
    onlineRevenue += Math.max(
      0,
      order.totalGbpAtPurchase - order.refundedAmountGbp,
    );
  }

  // ---- Revenue (door live = total - refunded across ALL door sales for the event) ----
  let doorRevenue = 0;
  for (const sale of eventDoorSales) {
    doorRevenue += Math.max(0, sale.totalGbpAtSale - sale.refundedAmountGbp);
  }

  const grossRevenue = round2(onlineRevenue + doorRevenue);

  // ---- Refunds (gross out per channel) ----
  let onlineRefunded = 0;
  for (const order of eventOrders) {
    for (const refund of order.refunds) {
      onlineRefunded += refund.amountGbp;
    }
  }
  let doorRefunded = 0;
  for (const sale of eventDoorSales) {
    for (const refund of sale.refunds) {
      doorRefunded += refund.amountGbp;
    }
  }
  const totalRefunded = round2(onlineRefunded + doorRefunded);

  // ---- Per-method revenue (live, post-refund) ----
  const revenueByMethod: Record<PaymentMethodKey, number> = {
    ...ZERO_REVENUE_BY_METHOD,
  };
  for (const order of liveOrders) {
    const live = Math.max(
      0,
      order.totalGbpAtPurchase - order.refundedAmountGbp,
    );
    if (live <= 0) continue;
    revenueByMethod[order.paymentMethod] += live;
  }
  for (const sale of eventDoorSales) {
    const live = Math.max(0, sale.totalGbpAtSale - sale.refundedAmountGbp);
    if (live <= 0) continue;
    revenueByMethod[sale.paymentMethod] += live;
  }
  // Round each method total to mitigate float drift
  for (const key of Object.keys(revenueByMethod) as PaymentMethodKey[]) {
    revenueByMethod[key] = round2(revenueByMethod[key]);
  }

  // ---- Settlement stub split (D-13-10) ----
  // [TRANSITIONAL] payoutEstimate = round(onlineRevenue × 96)/100 + doorRevenue.
  // EXIT: B-cycle Stripe payout API for online; Stripe Terminal SDK fee schedules for card_reader/NFC.
  const payoutEstimate = round2(round2(onlineRevenue * 0.96) + doorRevenue);

  // ---- Scans ----
  const eventScans = scanEntries.filter((s) => s.eventId === eventId);
  let scanDups = 0;
  let scanWrongEvent = 0;
  let scanNotFound = 0;
  let scanVoid = 0;
  let scanCancelled = 0;
  const successTicketIds = new Set<string>();
  const scansByScanner: Record<string, number> = {};
  // Track per-scanner unique-ticket success counts (dedupe by ticketId per scanner)
  const perScannerSuccessTicketIds: Record<string, Set<string>> = {};
  for (const scan of eventScans) {
    if (scan.scanResult === "success") {
      successTicketIds.add(scan.ticketId);
      const key = scan.scannerUserId;
      const set = perScannerSuccessTicketIds[key] ?? new Set<string>();
      set.add(scan.ticketId);
      perScannerSuccessTicketIds[key] = set;
    } else if (scan.scanResult === "duplicate") {
      scanDups += 1;
    } else if (scan.scanResult === "wrong_event") {
      scanWrongEvent += 1;
    } else if (scan.scanResult === "not_found") {
      scanNotFound += 1;
    } else if (scan.scanResult === "void") {
      scanVoid += 1;
    } else if (scan.scanResult === "cancelled_order") {
      scanCancelled += 1;
    }
  }
  const uniqueScannedTickets = successTicketIds.size;
  for (const key of Object.keys(perScannerSuccessTicketIds)) {
    scansByScanner[key] = perScannerSuccessTicketIds[key].size;
  }

  const unscannedTickets = Math.max(0, totalLiveTickets - uniqueScannedTickets);

  // ---- Discrepancies (D1 + D2 + D3 — ADVISORY-only per D-13-4) ----
  const discrepancies: DiscrepancyEntry[] = [];

  // D1 — Auto-check-in mismatch (HIDDEN-1 contract violation surface)
  let d1MissingCount = 0;
  for (const sale of eventDoorSales) {
    const expected = expandDoorTickets(sale.id, sale.lines).map(
      (t) => t.ticketId,
    );
    for (const tid of expected) {
      if (!successTicketIds.has(tid)) d1MissingCount += 1;
    }
  }
  if (d1MissingCount > 0) {
    discrepancies.push({
      kind: "auto_check_in_mismatch",
      copy: `${d1MissingCount} door ticket${d1MissingCount === 1 ? "" : "s"} sold but never scanned in`,
      followupHint:
        "Likely auto-check-in race (HIDDEN-1). Manual verify with door scanner; B-cycle backend will reconcile.",
    });
  }

  // D2 — Method sum mismatch (sum across 8 method keys MUST equal grossRevenue)
  const methodSum = (Object.keys(revenueByMethod) as PaymentMethodKey[]).reduce(
    (sum, key) => sum + revenueByMethod[key],
    0,
  );
  const d2Diff = Math.abs(grossRevenue - methodSum);
  if (d2Diff > 0.005) {
    discrepancies.push({
      kind: "method_sum_mismatch",
      copy: `${formatGbp(d2Diff)} unattributed across payment methods`,
      followupHint: `Sum-by-method (${formatGbp(methodSum)}) doesn't equal grand revenue (${formatGbp(grossRevenue)}). Likely rounding artifact; verify in B-cycle.`,
    });
  }

  // D3 — Refund status mismatch (failsafe; should be impossible per recordRefund atomicity)
  const d3OrderCount = eventOrders.filter(
    (o) =>
      o.refunds.length > 0 &&
      o.status !== "refunded_full" &&
      o.status !== "refunded_partial",
  ).length;
  const d3DoorCount = eventDoorSales.filter(
    (s) =>
      s.refunds.length > 0 &&
      s.status !== "refunded_full" &&
      s.status !== "refunded_partial",
  ).length;
  const d3Total = d3OrderCount + d3DoorCount;
  if (d3Total > 0) {
    discrepancies.push({
      kind: "refund_status_mismatch",
      copy: `${d3Total} record${d3Total === 1 ? "" : "s"} with refunds but mismatched status`,
      followupHint:
        "Internal data integrity issue — refund applied but parent status didn't flip. Reset client cache + retry.",
    });
  }

  return {
    status,
    headlineCopy: headlineCopyFor(status),
    onlineLiveTickets,
    doorLiveTickets,
    compTickets,
    totalLiveTickets,
    onlineRevenue: round2(onlineRevenue),
    doorRevenue: round2(doorRevenue),
    grossRevenue,
    totalRefunded,
    revenueByMethod,
    payoutEstimate,
    onlineRefunded: round2(onlineRefunded),
    doorRefunded: round2(doorRefunded),
    uniqueScannedTickets,
    scanDups,
    scanWrongEvent,
    scanNotFound,
    scanVoid,
    scanCancelled,
    scansByScanner,
    unscannedTickets,
    discrepancies,
  };
};
