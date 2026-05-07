/**
 * Stripe-supported countries — frontend mirror of
 * `supabase/functions/_shared/stripeSupportedCountries.ts`.
 *
 * Per B2a Path C V3 SPEC §3 + DEC-122 + I-PROPOSED-T enforcement:
 * Stripe self-serve cross-border payouts are limited to
 * US/UK/CA/CH + 30 EEA member states (34 total).
 *
 * This file is the SINGLE SOURCE for the BrandStripeCountryPicker UI.
 * AU + LatAm + Asia require separate Stripe platform entities — out of V3 scope.
 *
 * Strict-grep gate `i-proposed-t-stripe-country-allowlist.mjs` exempts this
 * file by name pattern. Any country code added here MUST also be added to
 * the backend mirror + the DB CHECK constraint on `stripe_connect_accounts.country`
 * (migration `20260511000001`) in the SAME ORCH cycle.
 */

export interface StripeSupportedCountry {
  /** ISO 3166-1 alpha-2 country code */
  readonly country: string;
  /** Display name shown in the country picker */
  readonly displayName: string;
  /** Default ISO 4217 currency code per Stripe Connect docs */
  readonly defaultCurrency: string;
  /** Local IBAN/account-number label hint for bank verification UI */
  readonly bankAccountLabel: string;
}

export const STRIPE_SUPPORTED_COUNTRIES: readonly StripeSupportedCountry[] = [
  { country: "US", displayName: "United States", defaultCurrency: "USD", bankAccountLabel: "Routing + account number" },
  { country: "GB", displayName: "United Kingdom", defaultCurrency: "GBP", bankAccountLabel: "Sort code + account number" },
  { country: "CA", displayName: "Canada", defaultCurrency: "CAD", bankAccountLabel: "Transit + institution + account" },
  { country: "CH", displayName: "Switzerland", defaultCurrency: "CHF", bankAccountLabel: "IBAN" },
  { country: "AT", displayName: "Austria", defaultCurrency: "EUR", bankAccountLabel: "IBAN" },
  { country: "BE", displayName: "Belgium", defaultCurrency: "EUR", bankAccountLabel: "IBAN" },
  { country: "BG", displayName: "Bulgaria", defaultCurrency: "BGN", bankAccountLabel: "IBAN" },
  { country: "CY", displayName: "Cyprus", defaultCurrency: "EUR", bankAccountLabel: "IBAN" },
  { country: "CZ", displayName: "Czechia", defaultCurrency: "CZK", bankAccountLabel: "IBAN" },
  { country: "DE", displayName: "Germany", defaultCurrency: "EUR", bankAccountLabel: "IBAN" },
  { country: "DK", displayName: "Denmark", defaultCurrency: "DKK", bankAccountLabel: "IBAN" },
  { country: "EE", displayName: "Estonia", defaultCurrency: "EUR", bankAccountLabel: "IBAN" },
  { country: "ES", displayName: "Spain", defaultCurrency: "EUR", bankAccountLabel: "IBAN" },
  { country: "FI", displayName: "Finland", defaultCurrency: "EUR", bankAccountLabel: "IBAN" },
  { country: "FR", displayName: "France", defaultCurrency: "EUR", bankAccountLabel: "IBAN" },
  { country: "GR", displayName: "Greece", defaultCurrency: "EUR", bankAccountLabel: "IBAN" },
  { country: "HR", displayName: "Croatia", defaultCurrency: "EUR", bankAccountLabel: "IBAN" },
  { country: "HU", displayName: "Hungary", defaultCurrency: "HUF", bankAccountLabel: "IBAN" },
  { country: "IE", displayName: "Ireland", defaultCurrency: "EUR", bankAccountLabel: "IBAN" },
  { country: "IS", displayName: "Iceland", defaultCurrency: "ISK", bankAccountLabel: "IBAN" },
  { country: "IT", displayName: "Italy", defaultCurrency: "EUR", bankAccountLabel: "IBAN" },
  { country: "LI", displayName: "Liechtenstein", defaultCurrency: "CHF", bankAccountLabel: "IBAN" },
  { country: "LT", displayName: "Lithuania", defaultCurrency: "EUR", bankAccountLabel: "IBAN" },
  { country: "LU", displayName: "Luxembourg", defaultCurrency: "EUR", bankAccountLabel: "IBAN" },
  { country: "LV", displayName: "Latvia", defaultCurrency: "EUR", bankAccountLabel: "IBAN" },
  { country: "MT", displayName: "Malta", defaultCurrency: "EUR", bankAccountLabel: "IBAN" },
  { country: "NL", displayName: "Netherlands", defaultCurrency: "EUR", bankAccountLabel: "IBAN" },
  { country: "NO", displayName: "Norway", defaultCurrency: "NOK", bankAccountLabel: "IBAN" },
  { country: "PL", displayName: "Poland", defaultCurrency: "PLN", bankAccountLabel: "IBAN" },
  { country: "PT", displayName: "Portugal", defaultCurrency: "EUR", bankAccountLabel: "IBAN" },
  { country: "RO", displayName: "Romania", defaultCurrency: "RON", bankAccountLabel: "IBAN" },
  { country: "SE", displayName: "Sweden", defaultCurrency: "SEK", bankAccountLabel: "IBAN" },
  { country: "SI", displayName: "Slovenia", defaultCurrency: "EUR", bankAccountLabel: "IBAN" },
  { country: "SK", displayName: "Slovakia", defaultCurrency: "EUR", bankAccountLabel: "IBAN" },
] as const;

const COUNTRY_BY_CODE: ReadonlyMap<string, StripeSupportedCountry> = new Map(
  STRIPE_SUPPORTED_COUNTRIES.map((entry) => [entry.country, entry]),
);

export function isStripeSupportedCountry(input: unknown): input is string {
  return typeof input === "string" && COUNTRY_BY_CODE.has(input.trim().toUpperCase());
}

export function getStripeSupportedCountry(
  code: string,
): StripeSupportedCountry | null {
  return COUNTRY_BY_CODE.get(code.trim().toUpperCase()) ?? null;
}

export function defaultCurrencyForCountry(code: string): string {
  const entry = getStripeSupportedCountry(code);
  if (!entry) {
    throw new Error(
      `defaultCurrencyForCountry: country "${code}" is not in the Mingla Stripe-supported allowlist.`,
    );
  }
  return entry.defaultCurrency;
}
