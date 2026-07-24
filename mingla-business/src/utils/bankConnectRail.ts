import {
  getStripeSupportedCountry,
  type StripeSupportedCountry,
} from "../constants/stripeSupportedCountries";

export type BankConnectProvider = "stripe" | "paystack";

export interface BankConnectRail {
  provider: BankConnectProvider;
  countryCode: string;
  displayName: string;
  currency: string;
}

interface ResolveBankConnectRailInput {
  countryCode?: string | null;
  paymentProvider?: string | null;
}

const DEFAULT_STRIPE_COUNTRY = "GB" as const;
const PAYSTACK_RAIL: BankConnectRail = {
  provider: "paystack",
  // orch-strict-grep-allow stripe-country-out-of-scope — Nigeria uses Paystack and is deliberately outside the Stripe allowlist.
  countryCode: "NG",
  displayName: "Nigeria",
  currency: "NGN",
} as const;

function normalizeCountryCode(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toUpperCase();
  return normalized.length === 2 ? normalized : null;
}

function stripeRail(country: StripeSupportedCountry): BankConnectRail {
  return {
    provider: "stripe",
    countryCode: country.country,
    displayName: country.displayName,
    currency: country.defaultCurrency,
  };
}

/**
 * Resolves the payout rail from the canonical brand row.
 *
 * Paystack is Nigeria-only. Stripe countries must exist in Mingla's existing
 * frontend allowlist; missing or unsupported country data keeps the prior GB
 * fallback instead of sending an untrusted code to Stripe.
 */
export function resolveBankConnectRail(
  input: ResolveBankConnectRailInput,
): BankConnectRail {
  const countryCode = normalizeCountryCode(input.countryCode);
  const provider =
    typeof input.paymentProvider === "string"
      ? input.paymentProvider.trim().toLowerCase()
      : null;

  // orch-strict-grep-allow stripe-country-out-of-scope — Nigeria uses Paystack and is deliberately outside the Stripe allowlist.
  if (provider === "paystack" || countryCode === "NG") {
    return PAYSTACK_RAIL;
  }

  const supported = countryCode === null
    ? null
    : getStripeSupportedCountry(countryCode);
  return stripeRail(
    supported ??
      getStripeSupportedCountry(DEFAULT_STRIPE_COUNTRY) ??
      (() => {
        throw new Error("The canonical Stripe country list is missing GB.");
      })(),
  );
}
