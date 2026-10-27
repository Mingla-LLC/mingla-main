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

/**
 * #4130: several currencies in one line, never "₦150.00 + -$0.01". A negative
 * amount after the first reads "₦150.00 − $0.01"; a negative first amount
 * reads "−$0.01". Each part is { cents, currency }; currencies are never summed.
 */
export function joinMoneyAmounts(parts) {
  const list = Array.isArray(parts) ? parts.filter((p) => p && p.cents != null && Number.isFinite(Number(p.cents))) : [];
  return list.reduce((out, { cents, currency }, i) => {
    const n = Number(cents);
    const amount = formatMoneyMinor(Math.abs(n), currency);
    if (i === 0) return n < 0 ? `−${amount}` : amount;
    return `${out} ${n < 0 ? "−" : "+"} ${amount}`;
  }, "");
}

/**
 * #4130: one amount on the money page. A cost row (sign < 0) always reads as
 * money going out ("−₦50.00"); any other row that is below zero, such as a
 * loss on the Profit row, reads "−$1.11" with a true minus sign, never "-$1.11".
 */
export function signedMoney(cents, currency, sign = 1) {
  if (cents == null) return "not converted";
  const n = Number(cents);
  if (!Number.isFinite(n)) return "not converted";
  const negative = sign < 0 ? n !== 0 : n < 0;
  const amount = formatMoneyMinor(Math.abs(n), currency);
  return negative ? `−${amount}` : amount;
}
