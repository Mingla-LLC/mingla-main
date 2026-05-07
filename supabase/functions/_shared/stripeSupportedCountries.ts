export interface StripeSupportedCountry {
  country: string;
  defaultCurrency: string;
}

export const STRIPE_SUPPORTED_COUNTRIES: readonly StripeSupportedCountry[] = [
  { country: "US", defaultCurrency: "USD" },
  { country: "GB", defaultCurrency: "GBP" },
  { country: "CA", defaultCurrency: "CAD" },
  { country: "CH", defaultCurrency: "CHF" },
  { country: "AT", defaultCurrency: "EUR" },
  { country: "BE", defaultCurrency: "EUR" },
  { country: "BG", defaultCurrency: "BGN" },
  { country: "CY", defaultCurrency: "EUR" },
  { country: "CZ", defaultCurrency: "CZK" },
  { country: "DE", defaultCurrency: "EUR" },
  { country: "DK", defaultCurrency: "DKK" },
  { country: "EE", defaultCurrency: "EUR" },
  { country: "ES", defaultCurrency: "EUR" },
  { country: "FI", defaultCurrency: "EUR" },
  { country: "FR", defaultCurrency: "EUR" },
  { country: "GR", defaultCurrency: "EUR" },
  { country: "HR", defaultCurrency: "EUR" },
  { country: "HU", defaultCurrency: "HUF" },
  { country: "IE", defaultCurrency: "EUR" },
  { country: "IS", defaultCurrency: "ISK" },
  { country: "IT", defaultCurrency: "EUR" },
  { country: "LI", defaultCurrency: "CHF" },
  { country: "LT", defaultCurrency: "EUR" },
  { country: "LU", defaultCurrency: "EUR" },
  { country: "LV", defaultCurrency: "EUR" },
  { country: "MT", defaultCurrency: "EUR" },
  { country: "NL", defaultCurrency: "EUR" },
  { country: "NO", defaultCurrency: "NOK" },
  { country: "PL", defaultCurrency: "PLN" },
  { country: "PT", defaultCurrency: "EUR" },
  { country: "RO", defaultCurrency: "RON" },
  { country: "SE", defaultCurrency: "SEK" },
  { country: "SI", defaultCurrency: "EUR" },
  { country: "SK", defaultCurrency: "EUR" },
] as const;

const COUNTRY_BY_CODE = new Map(
  STRIPE_SUPPORTED_COUNTRIES.map((entry) => [entry.country, entry]),
);

export function normalizeStripeCountry(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const country = input.trim().toUpperCase();
  return COUNTRY_BY_CODE.has(country) ? country : null;
}

export function defaultCurrencyForCountry(country: string): string {
  const entry = COUNTRY_BY_CODE.get(country.toUpperCase());
  if (!entry) {
    throw new Error(`Unsupported Stripe country: ${country}`);
  }
  return entry.defaultCurrency;
}
