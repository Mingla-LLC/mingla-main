import {
  getStripeSupportedCountry,
  STRIPE_SUPPORTED_COUNTRIES,
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
        // orch-strict-grep-allow provider-name-host-copy — developer invariant: thrown only if the country constant itself is broken.
        throw new Error("The canonical Stripe country list is missing GB.");
      })(),
  );
}

/** The Nigerian payout rail, exported so callers never restate its country. */
export const NIGERIA_BANK_CONNECT_RAIL: BankConnectRail = PAYSTACK_RAIL;

/**
 * #3645 — the rail for a country the organiser PICKED, with no fallback.
 *
 * `resolveBankConnectRail` answers "which rail does this brand row resolve to"
 * and falls back to the United Kingdom when the row says nothing. That fallback
 * is exactly how a brand with no address was saved in pounds before anyone
 * chose a country. This one returns null instead: no pick, no rail, no
 * currency.
 */
export function resolveBankConnectRailForCountry(
  countryCode: string | null | undefined,
): BankConnectRail | null {
  const normalized = normalizeCountryCode(countryCode);
  if (normalized === null) return null;
  if (normalized === PAYSTACK_RAIL.countryCode) return PAYSTACK_RAIL;
  const supported = getStripeSupportedCountry(normalized);
  return supported === null ? null : stripeRail(supported);
}

interface SavedPayoutCountryInput {
  /** `brands.payment_provider`. */
  paymentProvider?: string | null;
  /** Country of the brand's card-rail account, when one exists. */
  cardAccountCountry?: string | null;
  /** `brands.default_currency`; null/undefined/blank = not set. */
  defaultCurrency?: string | null;
  /** The brand's ADDRESS country: only ever a tie-breaker, never a choice. */
  addressCountryCode?: string | null;
  /**
   * `brands.payout_country`: the country the organiser PICKED, remembered for
   * display. Trusted only while it agrees with the brand's currency.
   */
  payoutCountry?: string | null;
}

/**
 * #3645 — the payout country a saved brand has ALREADY chosen, or null.
 *
 * A country counts as chosen only when the brand row carries evidence of a
 * choice: it is on the Nigerian rail, it has a card-rail account in a country,
 * or it has a currency. The address alone is never a choice. A currency shared
 * by several countries (the euro) names a country only when the address
 * country uses that currency or exactly one supported country does.
 */
export function resolveSavedPayoutCountry(
  input: SavedPayoutCountryInput,
): BankConnectRail | null {
  const provider = typeof input.paymentProvider === "string"
    ? input.paymentProvider.trim().toLowerCase()
    : null;
  if (provider === "paystack") return PAYSTACK_RAIL;

  const accountRail = resolveBankConnectRailForCountry(input.cardAccountCountry);
  if (accountRail !== null && accountRail.provider === "stripe") {
    return accountRail;
  }

  const currency = typeof input.defaultCurrency === "string"
    ? input.defaultCurrency.trim().toUpperCase()
    : "";
  if (currency.length === 0) return null;

  // #3645 — the remembered pick comes before any derivation: a euro brand that
  // picked Ireland is Ireland, whatever its address says. It is display-only,
  // so it is believed only while it matches the currency the brand actually
  // has (a stale pick never names a country the brand is not paid in), and it
  // never puts a brand on the Nigerian rail: only the provider does that.
  const rememberedRail = resolveBankConnectRailForCountry(input.payoutCountry);
  if (
    rememberedRail !== null &&
    rememberedRail.provider === "stripe" &&
    rememberedRail.currency === currency
  ) {
    return rememberedRail;
  }

  const addressRail = resolveBankConnectRailForCountry(input.addressCountryCode);
  if (addressRail !== null && addressRail.currency === currency) {
    // A Nigerian address with naira but no Nigerian rail is not a saved pick.
    return addressRail.provider === "stripe" ? addressRail : null;
  }
  const matches = STRIPE_SUPPORTED_COUNTRIES.filter(
    (country) => country.defaultCurrency === currency,
  );
  return matches.length === 1 ? stripeRail(matches[0]!) : null;
}

interface BankSetupSeedInput extends SavedPayoutCountryInput {
  /** An explicit `?country=` hint from the screen that sent the host here. */
  countryHint?: string | null;
}

/**
 * #3645 — the country a bank-setup screen opens on, or null for "nothing
 * chosen yet". One order, for every entry:
 *
 *   1. an explicit country hint (a card-rail country the previous screen named);
 *   2. the country of the brand's payment account, when one exists;
 *   3. the payout country the brand has saved or its currency implies
 *      (`resolveSavedPayoutCountry`, which reads the remembered pick first).
 *
 * There is no fourth step. The brand's address is never a choice and there is
 * no default country: with none of the above the screen shows "Choose a
 * country" and its primary button stays disabled.
 */
export function resolveBankSetupSeedCountry(
  input: BankSetupSeedInput,
): BankConnectRail | null {
  const provider = typeof input.paymentProvider === "string"
    ? input.paymentProvider.trim().toLowerCase()
    : null;
  // A brand on the Nigerian rail is on the Nigerian rail; a hint cannot move it.
  if (provider === "paystack") return PAYSTACK_RAIL;
  const hintRail = resolveBankConnectRailForCountry(input.countryHint);
  if (hintRail !== null && hintRail.provider === "stripe") return hintRail;
  return resolveSavedPayoutCountry(input);
}
