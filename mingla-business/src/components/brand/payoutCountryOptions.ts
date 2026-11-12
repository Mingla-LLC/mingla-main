/**
 * #4389 — the bank-country options (flag, name, currency) without the list UI,
 * so the onboard, address and web bank screens can show a country without
 * loading the F2 list (keeps it out of the eager web __common chunk).
 */
import { STRIPE_SUPPORTED_COUNTRIES } from "../../constants/stripeSupportedCountries";

export interface PayoutCountryOption {
  country: string;
  name: string;
  currency: string;
}

/** The one list: 34 card countries + Nigeria (parity with payout_country_rail). */
export const PAYOUT_COUNTRY_OPTIONS: readonly PayoutCountryOption[] = [
  ...STRIPE_SUPPORTED_COUNTRIES.map((c) => ({
    country: c.country,
    name: c.displayName,
    currency: c.defaultCurrency,
  })),
  // orch-strict-grep-allow stripe-country-out-of-scope — Nigeria is the Paystack rail, never Stripe Connect.
  { country: "NG", name: "Nigeria", currency: "NGN" },
].sort((a, b) => a.name.localeCompare(b.name));

export function flagEmoji(country: string): string {
  const cc = country.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(cc)) return "";
  return String.fromCodePoint(...[...cc].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}

export function payoutCountryOption(country: string | null | undefined): PayoutCountryOption | null {
  const cc = (country ?? "").trim().toUpperCase();
  return PAYOUT_COUNTRY_OPTIONS.find((o) => o.country === cc) ?? null;
}

/** The device region, when it is a country Mingla pays out to. */
export function suggestedPayoutCountry(locale: string | null | undefined): PayoutCountryOption | null {
  const region = (locale ?? "").split(/[-_]/)[1] ?? "";
  return payoutCountryOption(region);
}

export function filterPayoutCountries(query: string): readonly PayoutCountryOption[] {
  const q = query.trim().toLowerCase();
  if (q.length === 0) return PAYOUT_COUNTRY_OPTIONS;
  return PAYOUT_COUNTRY_OPTIONS.filter(
    (o) => o.name.toLowerCase().includes(q) || o.country.toLowerCase() === q || o.currency.toLowerCase() === q,
  );
}
