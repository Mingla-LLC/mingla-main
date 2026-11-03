/**
 * #4238 — the ONE way Host ad money is written: the currency code, a space,
 * then the amount with thousands separators and two decimals
 * ("NGN 1,500,000.00"). With no known currency, the plain amount.
 *
 * Canonical here (edge functions can bundle it). The Business app reads a
 * byte-equal mirror in mingla-business/src/components/marketing/ads/
 * hostAdMoney.ts; issue_4238_retest3_fixes.implementor.test.ts fails if the
 * two ever disagree. No imports, no locale surprises: separators are added
 * by hand so every runtime prints the same text.
 */
export function formatHostAdMoneyCents(
  value: unknown,
  currency: unknown,
): string | null {
  const cents = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(cents) || cents < 0) return null;
  const code =
    typeof currency === "string" && /^[A-Za-z]{3}$/.test(currency.trim())
      ? currency.trim().toUpperCase()
      : "";
  const whole = Math.floor(cents / 100).toString().replace(
    /\B(?=(\d{3})+(?!\d))/g,
    ",",
  );
  const amount = `${whole}.${String(cents % 100).padStart(2, "0")}`;
  return code ? `${code} ${amount}` : amount;
}
