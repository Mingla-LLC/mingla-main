/**
 * #4238 — mirror of supabase/functions/_shared/adMoneyFormat.ts, the ONE way
 * Host ad money is written ("NGN 1,500,000.00"). Keep byte-equal: the parity
 * test issue_4238_retest3_fixes.implementor.test.ts compares the two.
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
