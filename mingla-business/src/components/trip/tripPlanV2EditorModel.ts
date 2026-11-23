/**
 * Issue #4522 slice 3 — pure Host editor rules for payment-plan v2.
 *
 * The database remains the authority for saved plans and checkout math. These
 * helpers keep each keystroke, the publish checklist and the conversion prompt
 * aligned with the same limits before autosave reaches the server.
 */

import type {
  TripPaymentPlanV2,
} from "../../../../packages/offering-rendering/tripPlanV2Math";

import type { TripInstallmentSchedule } from "./PaymentPlanEditor";

export type { TripPaymentPlanV2 };

export const DEFAULT_TRIP_PAYMENT_PLAN_V2: TripPaymentPlanV2 = {
  v: 2,
  deposit: { mode: "percent", pct: 25 },
  count: 3,
  final_due_days_before_start: 30,
  auto_adjust: true,
  flex: { enabled: false },
  custom_amounts_minor: null,
};

export type TripPlanV2ValidationCode =
  | "plan_deposit_invalid"
  | "plan_count_out_of_range"
  | "plan_final_due_out_of_range"
  | "plan_flex_min_invalid"
  | "plan_flex_min_above_balance"
  | "plan_custom_amounts_invalid"
  | "plan_custom_amounts_exceed_balance";

export interface TripPlanV2Validation {
  ok: boolean;
  code: TripPlanV2ValidationCode | null;
  message: string | null;
  depositMinor: number;
  balanceMinor: number;
  customFinalMinor: number | null;
}

const whole = (value: number): boolean => Number.isInteger(value);

export function isTripPaymentPlanV2(
  value: TripInstallmentSchedule | TripPaymentPlanV2 | null,
): value is TripPaymentPlanV2 {
  return value !== null && "v" in value && value.v === 2;
}

export function depositMinorForPlan(
  plan: TripPaymentPlanV2,
  totalAmountMinor: number,
): number {
  return plan.deposit.mode === "amount"
    ? plan.deposit.amount_minor
    : Math.floor((totalAmountMinor * plan.deposit.pct) / 100);
}

/** Default is 10% of the per-traveler balance, rounded down to a whole unit. */
export function defaultFlexMinimumMinor(
  plan: TripPaymentPlanV2,
  totalAmountMinor: number,
): number {
  const balance = Math.max(
    0,
    totalAmountMinor - depositMinorForPlan(plan, totalAmountMinor),
  );
  if (balance <= 0) return 100;
  const rounded = Math.floor((balance * 0.1) / 100) * 100;
  return Math.min(balance, Math.max(100, rounded));
}

/** Prefill the new setup without mutating or deleting the stored v1 plan. */
export function convertLegacyPlanToV2(
  legacy: TripInstallmentSchedule,
): TripPaymentPlanV2 {
  return {
    ...DEFAULT_TRIP_PAYMENT_PLAN_V2,
    deposit: { mode: "percent", pct: legacy.deposit_pct },
    count: Math.max(1, Math.min(12, legacy.installments.length)),
  };
}

export function defaultCustomAmountsMinor(
  plan: TripPaymentPlanV2,
  totalAmountMinor: number,
): number[] {
  const balance = Math.max(
    0,
    totalAmountMinor - depositMinorForPlan(plan, totalAmountMinor),
  );
  if (plan.count <= 1) return [];
  const each = Math.max(100, Math.floor(balance / plan.count / 100) * 100);
  return Array.from({ length: plan.count - 1 }, () => each);
}

export function resizeCustomAmountsMinor(
  values: number[] | null | undefined,
  count: number,
  fallback: number,
): number[] {
  const wanted = Math.max(0, count - 1);
  return Array.from({ length: wanted }, (_, index) =>
    whole(values?.[index] ?? Number.NaN) ? values![index] : fallback
  );
}

function invalid(
  code: TripPlanV2ValidationCode,
  message: string,
  depositMinor: number,
  balanceMinor: number,
  customFinalMinor: number | null = null,
): TripPlanV2Validation {
  return {
    ok: false,
    code,
    message,
    depositMinor,
    balanceMinor,
    customFinalMinor,
  };
}

export function validateTripPaymentPlanV2(
  plan: TripPaymentPlanV2,
  totalAmountMinor: number,
  currencyLabel = "the package price",
): TripPlanV2Validation {
  const total = whole(totalAmountMinor) && totalAmountMinor >= 0
    ? totalAmountMinor
    : 0;
  const deposit = depositMinorForPlan(plan, total);
  const balance = total - deposit;

  if (
    (plan.deposit.mode === "percent" &&
      (!Number.isFinite(plan.deposit.pct) || plan.deposit.pct < 1 ||
        plan.deposit.pct > 100)) ||
    (plan.deposit.mode === "amount" &&
      (!whole(plan.deposit.amount_minor) || plan.deposit.amount_minor < 100 ||
        plan.deposit.amount_minor > total))
  ) {
    return invalid(
      "plan_deposit_invalid",
      `Enter a deposit between 1.00 and ${currencyLabel}.`,
      deposit,
      balance,
    );
  }
  if (!whole(plan.count) || plan.count < 1 || plan.count > 12) {
    return invalid(
      "plan_count_out_of_range",
      "Choose between 1 and 12 payments.",
      deposit,
      balance,
    );
  }
  if (
    !whole(plan.final_due_days_before_start) ||
    plan.final_due_days_before_start < 0 ||
    plan.final_due_days_before_start > 180
  ) {
    return invalid(
      "plan_final_due_out_of_range",
      "The final payment must be due between 0 and 180 days before departure.",
      deposit,
      balance,
    );
  }
  if (plan.flex?.enabled === true) {
    if (
      !whole(plan.flex.min_payment_minor) ||
      plan.flex.min_payment_minor < 100
    ) {
      return invalid(
        "plan_flex_min_invalid",
        "Set a smallest payment of at least 1.00.",
        deposit,
        balance,
      );
    }
    if (plan.flex.min_payment_minor > balance) {
      return invalid(
        "plan_flex_min_above_balance",
        "The smallest payment can't be more than the balance.",
        deposit,
        balance,
      );
    }
  }
  if (Array.isArray(plan.custom_amounts_minor)) {
    if (
      plan.custom_amounts_minor.length !== plan.count - 1 ||
      plan.custom_amounts_minor.some((amount) => !whole(amount) || amount < 100)
    ) {
      return invalid(
        "plan_custom_amounts_invalid",
        "Enter each custom payment as a whole amount of at least 1.00.",
        deposit,
        balance,
      );
    }
    const customSum = plan.custom_amounts_minor.reduce(
      (sum, amount) => sum + amount,
      0,
    );
    const final = balance - customSum;
    if (plan.custom_amounts_minor.length > 0 && customSum >= balance) {
      return invalid(
        "plan_custom_amounts_exceed_balance",
        "Custom amounts leave nothing for the final payment. Lower an earlier row.",
        deposit,
        balance,
        final,
      );
    }
    return {
      ok: true,
      code: null,
      message: null,
      depositMinor: deposit,
      balanceMinor: balance,
      customFinalMinor: final,
    };
  }
  return {
    ok: true,
    code: null,
    message: null,
    depositMinor: deposit,
    balanceMinor: balance,
    customFinalMinor: null,
  };
}

/**
 * Passed across the single lazy boundary so the editor chunk does not import
 * the eager validator/model module a second time. Keep this surface narrow:
 * the pricing step owns the runtime and the lazy editor only consumes it.
 */
export interface TripPlanV2EditorRuntime {
  defaultCustomAmountsMinor: typeof defaultCustomAmountsMinor;
  defaultFlexMinimumMinor: typeof defaultFlexMinimumMinor;
  depositMinorForPlan: typeof depositMinorForPlan;
  resizeCustomAmountsMinor: typeof resizeCustomAmountsMinor;
  validateTripPaymentPlanV2: typeof validateTripPaymentPlanV2;
}

export const TRIP_PLAN_V2_EDITOR_RUNTIME: TripPlanV2EditorRuntime = {
  defaultCustomAmountsMinor,
  defaultFlexMinimumMinor,
  depositMinorForPlan,
  resizeCustomAmountsMinor,
  validateTripPaymentPlanV2,
};
