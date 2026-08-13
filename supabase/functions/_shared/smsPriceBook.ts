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

export function validatedSmsRates(now: Date): SmsRateV1[] {
  const raw = resolveOfferingInviteSmsPriceBook();
  if (!Array.isArray(raw)) throw new Error("cost_unavailable");
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
      Date.parse(rate.effectiveAt) > now.getTime() ||
      Date.parse(rate.expiresAt) <= now.getTime() ||
      typeof rate.sourceReference !== "string" ||
      rate.sourceReference.length === 0
    ) throw new Error("cost_unavailable");
    return rate;
  });
}

export function allocateSmsCosts<T>(
  inputs: SmsCostInput<T>[],
  now: Date,
): {
  allocations: SmsCostAllocation<T>[];
  estimatedCostMinor: number;
  currency: string | null;
} {
  if (inputs.length === 0) {
    return { allocations: [], estimatedCostMinor: 0, currency: null };
  }
  const rates = validatedSmsRates(now);
  const fractions = inputs.map((input) => {
    const country = countryFromE164(input.normalizedPhone);
    if (
      country === null || !Number.isSafeInteger(input.segments) ||
      input.segments < 1
    ) throw new Error("cost_unavailable");
    const provider = country === "NG" ? "termii" : "twilio";
    const rate = rates.find((candidate) =>
      candidate.country === country && candidate.provider === provider
    );
    if (rate === undefined) throw new Error("cost_unavailable");
    return {
      input,
      rate,
      numerator: BigInt(input.segments) * BigInt(rate.minorNumerator),
      denominator: BigInt(rate.minorDenominator),
    };
  });
  const currencies = new Set(fractions.map((entry) => entry.rate.currency));
  if (currencies.size !== 1) throw new Error("mixed_currency_cost_unsupported");
  let exactNumerator = 0n, exactDenominator = 1n, floorTotal = 0n;
  for (const entry of fractions) {
    floorTotal += entry.numerator / entry.denominator;
    exactNumerator = exactNumerator * entry.denominator +
      entry.numerator * exactDenominator;
    exactDenominator *= entry.denominator;
  }
  const aggregate = (exactNumerator + exactDenominator - 1n) / exactDenominator;
  const allocations = fractions.map((entry) => ({
    ...entry.input,
    rate: entry.rate,
    allocatedCostMinor: Number(entry.numerator / entry.denominator),
  }));
  let remainder = Number(aggregate - floorTotal);
  fractions.map((entry, index) => ({ entry, allocation: allocations[index] }))
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
  allocations.sort((a, b) => a.key.localeCompare(b.key));
  return {
    allocations,
    estimatedCostMinor: Number(aggregate),
    currency: allocations[0].rate.currency,
  };
}
