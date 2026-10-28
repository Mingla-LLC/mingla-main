/**
 * Issue #3645 — the all-in naira price of each later Paystack instalment.
 *
 * MINGLA-INVARIANT: I-3645-PS-3 | issue #3645 | each later Paystack payment is priced at checkout by the deposit's engine, shown to the buyer, persisted, and charged unchanged
 *
 * Exactly the deposit's math (ticket-checkout-create Paystack arm):
 * computeBuyerSubtotal → computeConfigVat → buildPricingBreakdown with
 * config_vat, region NG, currency NGN. No discount is re-applied: each
 * schedule amount is already the post-discount net. Pure; runs only at
 * checkout. The scheduler and pay links charge the persisted result and never
 * import this module.
 */
import {
  buildPricingBreakdown,
  type ComputeAllInInput,
  computeBuyerSubtotal,
  computeConfigVat,
  MINGLA_SERVICE_FEE_BPS,
  type PricingBreakdown,
  type PricingSwitches,
} from "../allInPricingEngine.ts";

/** Paystack first-charge and refund floor (NGN 50 in kobo). */
export const PAYSTACK_INSTALLMENT_MIN_KOBO = 5000;

export interface PaystackInstallmentCharge {
  ordinal: number;
  netCents: number;
  buyerTotalCents: number;
  /** Mingla fee from the engine, before any referral share. */
  applicationFeeCents: number;
  taxCents: number;
  breakdown: PricingBreakdown;
}

export class PaystackInstallmentPricingError extends Error {
  constructor(readonly code: "installment_amount_below_minimum" | "installment_amount_invalid") {
    super(code);
    this.name = "PaystackInstallmentPricingError";
  }
}

export interface PaystackInstallmentPricingInput {
  installments: ReadonlyArray<{ ordinal: number; amountCents: number }>;
  switches: PricingSwitches;
  effectiveTakeRateBps: number;
  takeRateSource: "brand_override" | "platform_default";
  vatRateBps: number;
}

export function computePaystackInstallmentCharges(
  input: PaystackInstallmentPricingInput,
): PaystackInstallmentCharge[] {
  return input.installments.map((installment) => {
    if (!Number.isInteger(installment.amountCents) || installment.amountCents <= 0) {
      throw new PaystackInstallmentPricingError("installment_amount_invalid");
    }
    const engineInput: ComputeAllInInput = {
      baseCents: installment.amountCents,
      switches: input.switches,
      region: "NG",
      currency: "NGN",
      effectiveTakeRateBps: input.effectiveTakeRateBps,
      takeRateSource: input.takeRateSource,
      serviceFeeBps: MINGLA_SERVICE_FEE_BPS,
    };
    const subtotal = computeBuyerSubtotal(engineInput);
    const { taxCents, buyerTotalCents } = computeConfigVat(
      subtotal.buyerSubtotalCents,
      input.vatRateBps,
      input.switches.pass_tax,
    );
    if (buyerTotalCents < PAYSTACK_INSTALLMENT_MIN_KOBO) {
      throw new PaystackInstallmentPricingError("installment_amount_below_minimum");
    }
    const breakdown = buildPricingBreakdown({
      input: engineInput,
      amountTotalCents: buyerTotalCents,
      taxCents,
      taxBasis: "config_vat",
      stripeTaxCalculationId: null,
    });
    return {
      ordinal: installment.ordinal,
      netCents: installment.amountCents,
      buyerTotalCents,
      applicationFeeCents: breakdown.application_fee_amount_cents,
      taxCents,
      breakdown,
    };
  });
}

/** The session's installment_charge_plan (M1 §5 shape). */
export function installmentChargePlanJson(charges: ReadonlyArray<PaystackInstallmentCharge>) {
  return {
    currency: "NGN",
    engineVersion: 1,
    payments: charges.map((c) => ({
      ordinal: c.ordinal,
      netCents: c.netCents,
      buyerTotalCents: c.buyerTotalCents,
      applicationFeeCents: c.applicationFeeCents,
      taxCents: c.taxCents,
      breakdown: c.breakdown,
    })),
  };
}

/** What a buyer sees per later payment (quote + create envelopes). */
export function installmentChargeScheduleEnvelope(
  charges: ReadonlyArray<PaystackInstallmentCharge>,
  dueAtByOrdinal: ReadonlyMap<number, string>,
) {
  return {
    currency: "NGN",
    payments: charges.map((c) => ({
      ordinal: c.ordinal,
      dueAt: dueAtByOrdinal.get(c.ordinal) ?? null,
      buyerTotalCents: c.buyerTotalCents,
      feesCents: c.buyerTotalCents - c.netCents - c.taxCents,
      taxCents: c.taxCents,
    })),
  };
}

/**
 * The later payments of a session / quote installment schedule
 * ({installments:[{ordinal, amountCents, dueAt}]}), or null when there is no
 * plan. A malformed schedule throws (never price a guess).
 */
export function scheduledInstallmentsFrom(
  schedule: unknown,
): Array<{ ordinal: number; amountCents: number; dueAt: string }> | null {
  if (schedule === null || schedule === undefined || typeof schedule !== "object" || Array.isArray(schedule)) {
    return null;
  }
  const raw = (schedule as Record<string, unknown>).installments;
  if (!Array.isArray(raw) || raw.length === 0) return null;
  return raw.map((item) => {
    const it = (item ?? {}) as Record<string, unknown>;
    const ordinal = Number(it.ordinal);
    const amountCents = Number(it.amountCents);
    const dueAt = typeof it.dueAt === "string" ? it.dueAt : "";
    if (!Number.isInteger(ordinal) || ordinal < 1 || !Number.isInteger(amountCents) || dueAt === "") {
      throw new PaystackInstallmentPricingError("installment_amount_invalid");
    }
    return { ordinal, amountCents, dueAt };
  });
}
