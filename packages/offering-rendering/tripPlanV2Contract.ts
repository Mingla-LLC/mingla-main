/**
 * issue #4522 — dependency-free public decoder for a saved v2 trip plan.
 * Keep this leaf separate from tripPlanV2Math: buyer reads must not pull the
 * host-only schedule preview calculator into the eager web graph.
 */

import type {
  DepositRule,
  TripPaymentPlanV2,
} from "./tripPlanV2Math";

const isWhole = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value);

/**
 * Decode `tier_metadata.payment_plan`. Malformed cache/RPC data stays dark and
 * can never arm a buyer payment control.
 */
export function decodeTripPaymentPlanV2(
  value: unknown,
): TripPaymentPlanV2 | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const row = value as Record<string, unknown>;
  const allowed = new Set([
    "v",
    "deposit",
    "count",
    "final_due_days_before_start",
    "auto_adjust",
    "flex",
    "custom_amounts_minor",
  ]);
  if (
    row.v !== 2 ||
    Object.keys(row).some((key) => !allowed.has(key)) ||
    !isWhole(row.count) ||
    row.count < 1 ||
    row.count > 12 ||
    !isWhole(row.final_due_days_before_start) ||
    row.final_due_days_before_start < 0 ||
    row.final_due_days_before_start > 180 ||
    (row.auto_adjust !== undefined && typeof row.auto_adjust !== "boolean") ||
    row.deposit === null ||
    typeof row.deposit !== "object" ||
    Array.isArray(row.deposit)
  )
    return null;

  const rawDeposit = row.deposit as Record<string, unknown>;
  let deposit: DepositRule;
  if (
    rawDeposit.mode === "percent" &&
    typeof rawDeposit.pct === "number" &&
    Number.isFinite(rawDeposit.pct) &&
    rawDeposit.pct >= 1 &&
    rawDeposit.pct <= 100 &&
    !("amount_minor" in rawDeposit)
  ) {
    deposit = { mode: "percent", pct: rawDeposit.pct };
  } else if (
    rawDeposit.mode === "amount" &&
    isWhole(rawDeposit.amount_minor) &&
    rawDeposit.amount_minor >= 100 &&
    !("pct" in rawDeposit)
  ) {
    deposit = { mode: "amount", amount_minor: rawDeposit.amount_minor };
  } else {
    return null;
  }

  let flex: TripPaymentPlanV2["flex"];
  if (row.flex !== undefined && row.flex !== null) {
    if (typeof row.flex !== "object" || Array.isArray(row.flex)) return null;
    const rawFlex = row.flex as Record<string, unknown>;
    if (rawFlex.enabled === false) flex = { enabled: false };
    else if (
      rawFlex.enabled === true &&
      isWhole(rawFlex.min_payment_minor) &&
      rawFlex.min_payment_minor >= 100
    ) {
      flex = { enabled: true, min_payment_minor: rawFlex.min_payment_minor };
    } else return null;
  }

  let custom: number[] | null | undefined;
  if (row.custom_amounts_minor === null) custom = null;
  else if (row.custom_amounts_minor !== undefined) {
    if (
      !Array.isArray(row.custom_amounts_minor) ||
      row.custom_amounts_minor.length !== row.count - 1 ||
      row.custom_amounts_minor.some(
        (amount) => !isWhole(amount) || amount < 100,
      )
    )
      return null;
    custom = row.custom_amounts_minor as number[];
  }

  return {
    v: 2,
    deposit,
    count: row.count,
    final_due_days_before_start: row.final_due_days_before_start,
    ...(row.auto_adjust !== undefined
      ? { auto_adjust: row.auto_adjust as boolean }
      : {}),
    ...(flex !== undefined ? { flex } : {}),
    ...(custom !== undefined
      ? { custom_amounts_minor: custom === null ? null : [...custom] }
      : {}),
  };
}
