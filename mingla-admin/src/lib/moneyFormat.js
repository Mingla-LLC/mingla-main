const ZERO_DECIMAL_CURRENCIES = new Set([
  "BIF", "CLP", "DJF", "GNF", "JPY", "KMF", "KRW", "MGA", "PYG",
  "RWF", "UGX", "VND", "VUV", "XAF", "XOF", "XPF",
]);

const LOCALE_BY_CURRENCY = {
  GBP: "en-GB",
  USD: "en-US",
  CAD: "en-CA",
  NGN: "en-NG",
  EUR: "en-IE",
  CHF: "de-CH",
};

/** Format stored minor units without inventing a currency or assuming /100. */
export function formatMoneyMinor(minor, currency) {
  if (minor == null || typeof currency !== "string" || currency.trim() === "") return "—";
  const code = currency.trim().toUpperCase();
  const numeric = Number(minor);
  if (!Number.isFinite(numeric)) return "—";
  const amount = numeric / (ZERO_DECIMAL_CURRENCIES.has(code) ? 1 : 100);
  try {
    return new Intl.NumberFormat(LOCALE_BY_CURRENCY[code], {
      style: "currency",
      currency: code,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${amount.toLocaleString()} ${code}`;
  }
}
