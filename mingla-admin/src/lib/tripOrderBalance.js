// issue #4522 S-13 (spec §12) — a plan-v2 trip order as Admin's order view
// shows it: the plan terms it was booked on, its rows (kind, status, schedule
// version, add-on share, provider and method), the balance and the history of
// balance changes. Pure: the page passes what admin_trip_order_balance
// returned, or null for any other order. Every figure is the server's.

import { isMissingFunctionError } from "./systemPages.js";

/**
 * issue #4522 deploy window — what admin_trip_order_balance answered. Admin
 * deploys before the branch's migrations are applied; until then the function
 * does not exist (PGRST202 / 42883) and every order keeps main's view with no
 * error. Any other failure is reported (the order still shows, old view).
 */
export function readTripOrderBalanceResult(result) {
  const error = result?.error ?? null;
  if (error) {
    if (isMissingFunctionError(error)) return { balance: null, error: null };
    return {
      balance: null,
      error: "Couldn't load this order's payment plan. Reload to try again.",
    };
  }
  return { balance: result?.data ?? null, error: null };
}

export const ROW_STATUS_LABEL = {
  scheduled: "Scheduled",
  collected: "Paid",
  failed: "Failed",
  refunded: "Refunded",
  cancelled: "Cancelled",
  superseded: "Rebalanced",
};

const EVENT_LABEL = {
  flex_payment: "Traveler paid part of the balance. Remaining payments updated.",
  missed_rollover: "Missed payment moved to later payments.",
  addon_removed: "Add-on removed. Remaining payments updated.",
  host_adjust: "Remaining payments updated.",
};

function rowLabel(row) {
  if (row.kind === "flex") {
    return row.status === "refunded" ? "Refunded" : "Partial";
  }
  return ROW_STATUS_LABEL[row.status] ?? String(row.status ?? "—");
}

/** null when the order has no v2 balance (older plans keep the bundle view). */
export function tripOrderBalanceView(balance) {
  if (!balance || typeof balance !== "object" || !Array.isArray(balance.rows)) return null;
  const terms = balance.terms && typeof balance.terms === "object" ? balance.terms : {};
  // The RPC answers for any order; only a version 2 plan is shown this way.
  if (terms.v !== 2) return null;
  // A flexible attempt that was never collected (in flight, failed or closed)
  // is not a row of the plan; one still in flight shows as paymentInFlight.
  const rows = balance.rows
    .filter((row) => row && (row.kind !== "flex" || row.status === "collected" || row.status === "refunded"))
    .map((row) => ({
      id: String(row.installmentId ?? ""),
      ordinal: Number.isSafeInteger(row.ordinal) ? row.ordinal : null,
      kind: row.kind === "flex" ? "Partial payment" : "Scheduled payment",
      status: String(row.status ?? ""),
      statusLabel: rowLabel(row),
      amountMinor: Number.isSafeInteger(row.amountMinor) ? row.amountMinor : 0,
      buyerTotalMinor: Number.isSafeInteger(row.buyerTotalMinor) ? row.buyerTotalMinor : null,
      addonPortionMinor: Number.isSafeInteger(row.addonPortionMinor) ? row.addonPortionMinor : 0,
      scheduleVersion: Number.isSafeInteger(row.scheduleVersion) ? row.scheduleVersion : null,
      provider: typeof row.provider === "string" ? row.provider : null,
      collectionMethod: typeof row.collectionMethod === "string" ? row.collectionMethod : null,
      dueAt: typeof row.dueAt === "string" ? row.dueAt : null,
      refundedMinor: Number.isSafeInteger(row.refundedMinor) ? row.refundedMinor : 0,
    }));
  const history = (Array.isArray(balance.balanceEvents) ? balance.balanceEvents : []).map((event, i) => ({
    key: `${i}`,
    reason: String(event?.reason ?? ""),
    label: EVENT_LABEL[event?.reason] ?? String(event?.reason ?? "—"),
    createdAt: typeof event?.createdAt === "string" ? event.createdAt : null,
  }));
  const money = (v) => (Number.isSafeInteger(v) ? v : null);
  return {
    currency: String(balance.currency ?? ""),
    terms: {
      version: terms.v,
      depositMinor: money(balance.depositMinor),
      countGiven: money(terms.count_given),
      countOffered: money(terms.count_offered),
      finalDueAt: typeof terms.final_due_at === "string" ? terms.final_due_at : null,
      tripStartAt: typeof terms.trip_start_at === "string" ? terms.trip_start_at : null,
      autoAdjust: terms.auto_adjust === true,
      flexEnabled: terms.flex_enabled === true,
      minPaymentMinor: money(terms.min_payment_minor),
      depositNonRefundable: terms.deposit_non_refundable === true,
      addonPaymentMode: typeof terms.addon_payment_mode === "string" ? terms.addon_payment_mode : null,
    },
    paidMinor: money(balance.paidMinor),
    remainingMinor: money(balance.remainingMinor),
    totalMinor: money(balance.totalMinor),
    // A balance below the provider's minimum stays owed (never written off)
    // and cannot be charged automatically; ops follow up.
    belowProviderMinimum: Number.isSafeInteger(balance.remainingMinor) && balance.remainingMinor > 0
      && Number.isSafeInteger(balance.providerMinimumMinor) && balance.remainingMinor < balance.providerMinimumMinor,
    paymentInFlight: balance.paymentInFlight === true,
    rows,
    history,
  };
}
