const COUNTRY_CURRENCY: Record<string, string> = {
  GB: "GBP", US: "USD", CA: "CAD", NG: "NGN", GH: "GHS", KE: "KES",
  AT: "EUR", BE: "EUR", CY: "EUR", DE: "EUR", EE: "EUR", ES: "EUR", FI: "EUR",
  FR: "EUR", GR: "EUR", HR: "EUR", IE: "EUR", IT: "EUR", LT: "EUR", LU: "EUR",
  LV: "EUR", MT: "EUR", NL: "EUR", PT: "EUR", SI: "EUR", SK: "EUR",
};

export function discoverCurrency(countryCode: string | null | undefined, majorityCurrency?: string | null): string {
  const country = countryCode?.trim().toUpperCase();
  if (country && COUNTRY_CURRENCY[country]) return COUNTRY_CURRENCY[country];
  const majority = majorityCurrency?.trim().toUpperCase();
  return majority && /^[A-Z]{3}$/.test(majority) ? majority : "USD";
}
