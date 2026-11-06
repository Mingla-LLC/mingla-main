import { countryFromE164 } from "./e164Country.ts";
import { resolveOfferingInviteSmsPriceBook } from "./runtimeConfig.ts";

export interface SmsRateV1 {
  rateId: string;
  provider: "twilio" | "termii";
  country: string;
  currency: string;
  unit: "sms_segment";
  minorNumerator: number;
  minorDenominator: number;
  effectiveAt: string;
  expiresAt: string;
  sourceReference: string;
}

export interface SmsCostInput<T> {
  key: string;
  normalizedPhone: string;
  segments: number;
  target: T;
}

export interface SmsCostAllocation<T> extends SmsCostInput<T> {
  rate: SmsRateV1;
  allocatedCostMinor: number;
}

export function validatedSmsRates(
  now: Date,
  suppliedRaw?: unknown[],
): SmsRateV1[] {
  const raw = suppliedRaw ?? resolveOfferingInviteSmsPriceBook();
  if (!Array.isArray(raw)) {
    throw new Error("cost_unavailable:sms_rate_book_missing");
  }
  return raw.map((entry) => {
    const rate = entry as SmsRateV1;
    if (
      typeof rate?.rateId !== "string" ||
      (rate.provider !== "twilio" && rate.provider !== "termii") ||
      !/^[A-Z]{2}$/.test(rate.country) || !/^[A-Z]{3}$/.test(rate.currency) ||
      rate.unit !== "sms_segment" ||
      !Number.isSafeInteger(rate.minorNumerator) ||
      rate.minorNumerator <= 0 ||
      !Number.isSafeInteger(rate.minorDenominator) ||
      rate.minorDenominator <= 0 ||
      !Number.isFinite(Date.parse(rate.effectiveAt)) ||
      !Number.isFinite(Date.parse(rate.expiresAt)) ||
      typeof rate.sourceReference !== "string" ||
      rate.sourceReference.length === 0
    ) throw new Error("cost_unavailable:sms_rate_book_invalid");
    if (Date.parse(rate.effectiveAt) > now.getTime()) {
      throw new Error("cost_unavailable:sms_rate_book_not_effective");
    }
    if (Date.parse(rate.expiresAt) <= now.getTime()) {
      throw new Error("cost_unavailable:sms_rate_book_expired");
    }
    return rate;
  });
}

export interface SmsCostSubtotal {
  currency: string;
  estimatedCostMinor: number;
}

/**
 * #4273 — prices every reachable phone with its own provider rate.
 *
 * A Blast may text numbers priced in different currencies (Termii bills NGN,
 * Twilio bills USD). This function never joins currencies: it returns one
 * subtotal per currency, each computed exactly as a single-currency quote
 * always was (ceil of the exact rational sum, largest-remainder allocation).
 * The ONE place currencies are joined is `buildMarketingBookQuote` with
 * `marketingSmsFx.ts`, which converts with the FX snapshot as of `quotedAt`
 * so a confirm rebuild reproduces the preview byte for byte. The top-level
 * `estimatedCostMinor` / `currency` are set only when there is at most one
 * currency; for a single currency every number is identical to before.
 */
export function allocateSmsCosts<T>(
  inputs: SmsCostInput<T>[],
  now: Date,
  suppliedRates?: SmsRateV1[],
): {
  allocations: SmsCostAllocation<T>[];
  subtotals: SmsCostSubtotal[];
  estimatedCostMinor: number | null;
  currency: string | null;
} {
  if (inputs.length === 0) {
    return {
      allocations: [],
      subtotals: [],
      estimatedCostMinor: 0,
      currency: null,
    };
  }
  const rates = suppliedRates ?? validatedSmsRates(now);
  const fractions = inputs.map((input) => {
    const country = countryFromE164(input.normalizedPhone);
    if (
      country === null || !Number.isSafeInteger(input.segments) ||
      input.segments < 1
    ) throw new Error("cost_unavailable:sms_rate_unavailable");
    // orch-strict-grep-allow stripe-country-out-of-scope — messaging-provider selection, not Stripe/self-serve payout eligibility
    const provider = country === "NG" ? "termii" : "twilio";
    const rate = rates.find((candidate) =>
      candidate.country === country && candidate.provider === provider
    );
    if (rate === undefined) {
      throw new Error("cost_unavailable:sms_rate_unavailable");
    }
    return {
      input,
      rate,
      numerator: BigInt(input.segments) * BigInt(rate.minorNumerator),
      denominator: BigInt(rate.minorDenominator),
    };
  });
  const currencies = [...new Set(fractions.map((entry) => entry.rate.currency))]
    .sort();
  const allocations: SmsCostAllocation<T>[] = [];
  const subtotals: SmsCostSubtotal[] = [];
  for (const currency of currencies) {
    const group = fractions.filter((entry) => entry.rate.currency === currency);
    let exactNumerator = 0n, exactDenominator = 1n, floorTotal = 0n;
    for (const entry of group) {
      floorTotal += entry.numerator / entry.denominator;
      exactNumerator = exactNumerator * entry.denominator +
        entry.numerator * exactDenominator;
      exactDenominator *= entry.denominator;
    }
    const aggregate = (exactNumerator + exactDenominator - 1n) /
      exactDenominator;
    const groupAllocations = group.map((entry) => ({
      ...entry.input,
      rate: entry.rate,
      allocatedCostMinor: Number(entry.numerator / entry.denominator),
    }));
    let remainder = Number(aggregate - floorTotal);
    group.map((entry, index) => ({ entry, allocation: groupAllocations[index] }))
      .sort((left, right) => {
        const l = left.entry.numerator % left.entry.denominator,
          r = right.entry.numerator % right.entry.denominator;
        const comparison = l * right.entry.denominator -
          r * left.entry.denominator;
        return comparison === 0n
          ? left.entry.input.key.localeCompare(right.entry.input.key)
          : comparison > 0n
          ? -1
          : 1;
      }).forEach(({ allocation }) => {
        if (remainder > 0) {
          allocation.allocatedCostMinor += 1;
          remainder -= 1;
        }
      });
    allocations.push(...groupAllocations);
    subtotals.push({ currency, estimatedCostMinor: Number(aggregate) });
  }
  allocations.sort((a, b) => a.key.localeCompare(b.key));
  return {
    allocations,
    subtotals,
    estimatedCostMinor: subtotals.length === 1
      ? subtotals[0].estimatedCostMinor
      : null,
    currency: subtotals.length === 1 ? subtotals[0].currency : null,
  };
}
