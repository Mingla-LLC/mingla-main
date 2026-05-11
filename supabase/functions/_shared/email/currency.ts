// ORCH-0785 — Deno-safe currency formatter for transactional email.
// Mirrors mingla-business/src/utils/currency.ts intent but lives here so
// Deno edge functions never cross-import from the React Native bundle.
// Uses Intl.NumberFormat (available in Deno Edge runtime) with en-GB default
// and a currency-coded fallback for non-GBP orders.

export function formatMoneyFromCents(
  totalCents: number,
  currency: string,
): string {
  const code = (currency || "GBP").toUpperCase();
  const amount = (Number(totalCents) || 0) / 100;
  try {
    return new Intl.NumberFormat(code === "GBP" ? "en-GB" : "en-US", {
      style: "currency",
      currency: code,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${code}`;
  }
}

export function formatMoneyOrFree(
  totalCents: number,
  currency: string,
): string {
  if (!totalCents || totalCents <= 0) return "Free";
  return formatMoneyFromCents(totalCents, currency);
}
