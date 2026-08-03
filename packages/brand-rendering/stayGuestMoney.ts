export function formatStayMoney(
  amountMinor: string,
  currencyCode: string,
  locale?: string,
): string {
  if (!/^(0|[1-9]\d*)$/.test(amountMinor) || !/^[A-Z]{3}$/.test(currencyCode)) {
    return "Price unavailable";
  }
  const amount = Number(amountMinor);
  if (!Number.isSafeInteger(amount)) return `${currencyCode} ${amountMinor}`;
  const digits = new Intl.NumberFormat(locale, {
    style: "currency",
    currency: currencyCode,
  }).resolvedOptions().maximumFractionDigits ?? 2;
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: currencyCode,
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(amount / 10 ** digits);
}
