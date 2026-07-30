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

export function formatMinorCurrency(
  amountMinor: number,
  currencyCode: string,
  exponent: number,
  locale?: string,
): string {
  if (!Number.isSafeInteger(amountMinor) || amountMinor < 0) return "—";
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: currencyCode,
    minimumFractionDigits: exponent,
    maximumFractionDigits: exponent,
  }).format(amountMinor / 10 ** exponent);
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

export function formatSourceRange(input: {
  minMinor: number;
  maxMinor: number | null;
  currencyCode: string;
  exponent: number;
  locale?: string;
}): string {
  const min = formatMinorCurrency(
    input.minMinor,
    input.currencyCode,
    input.exponent,
    input.locale,
  );
  if (input.maxMinor === null) return `${min}+ · ${input.currencyCode}`;
  const max = formatMinorCurrency(
    input.maxMinor,
    input.currencyCode,
    input.exponent,
    input.locale,
  );
  return `${min}–${max} · ${input.currencyCode}`;
}
