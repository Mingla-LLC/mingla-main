/**
 * Returns ordinal suffix string for a number.
 * ordinal(1) → "1st", ordinal(2) → "2nd", ordinal(3) → "3rd", ordinal(4) → "4th"
 */
export function ordinal(n: number): string {
  const suffixes = ["th", "st", "nd", "rd"];
  const remainder = n % 100;
  const suffix =
    remainder >= 11 && remainder <= 13
      ? "th"
      : suffixes[n % 10] ?? "th";
  return `${n}${suffix}`;
}
