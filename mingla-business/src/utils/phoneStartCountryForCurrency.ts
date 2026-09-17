/**
 * Issue #3380 — the country a buyer's phone picker should start on, from the
 * one brand signal a public event page carries: the currency it charges in.
 *
 * Public event rows expose no brand country, only a currency. A Lagos brand
 * pricing in naira is a Nigerian event, so its checkout starts on +234 even
 * when the guest's phone is set to US English (very common on Nigerian
 * Android phones) — which used to open the field on +1 or +44.
 *
 * ONLY currencies that name one country. The euro and others spanning many
 * countries return null, and the picker falls back to the device's region.
 */
const COUNTRY_BY_CURRENCY: Readonly<Record<string, string>> = {
  NGN: "NG",
  GHS: "GH",
  KES: "KE",
  ZAR: "ZA",
  GBP: "GB",
  USD: "US",
  CAD: "CA",
};

export const phoneStartCountryForCurrency = (
  currency: string | null | undefined,
): string | null =>
  typeof currency === "string"
    ? (COUNTRY_BY_CURRENCY[currency.trim().toUpperCase()] ?? null)
    : null;
