/**
 * #1559 [shared-venue-screen] — `formatMinorCurrency` and `formatSourceRange`
 * MOVED to `packages/brand-rendering/venueMoney.ts` and are re-exported here.
 *
 * WHY: the public venue page's typical-spend lede formats a range, and that
 * renderer now lives in `packages/brand-rendering` so both surfaces draw it.
 * A package may not import app `src/` (I-MOR-0827-PACKAGE-ISOLATION), so the
 * owner moved and this file re-exports — one implementation, every existing
 * import path unchanged, no fork. `parseMajorToMinor` / `minorToMajorInput` are
 * authoring-side (business-only) and stay here.
 */
export {
  formatMinorCurrency,
  formatSourceRange,
} from "@mingla/brand-rendering/venueMoney";

export interface CurrencyMetadata {
  code: string;
  minorUnitExponent: number;
  railSource: string;
}

export function parseMajorToMinor(
  input: string,
  exponent: number,
): number | null {
  const trimmed = input.trim();
  if (!/^\d+(?:\.\d+)?$/.test(trimmed)) return null;
  const [whole, fraction = ""] = trimmed.split(".");
  if (fraction.length > exponent) return null;
  const minorText = `${whole}${fraction.padEnd(exponent, "0")}`.replace(
    /^0+(?=\d)/,
    "",
  );
  const minor = Number(minorText.length === 0 ? "0" : minorText);
  return Number.isSafeInteger(minor) && minor >= 0 ? minor : null;
}

export function minorToMajorInput(
  amountMinor: number,
  exponent: number,
): string {
  if (!Number.isSafeInteger(amountMinor) || amountMinor < 0) return "";
  if (exponent === 0) return String(amountMinor);
  const padded = String(amountMinor).padStart(exponent + 1, "0");
  const whole = padded.slice(0, -exponent);
  const fraction = padded.slice(-exponent).replace(/0+$/, "");
  return fraction.length > 0 ? `${whole}.${fraction}` : whole;
}
