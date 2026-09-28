import { minorFromMajor, normalizeCurrency } from "../../utils/currency";

const MAX_MENU_MONEY_CENTS = 100_000_000;
const MAX_MENU_MONEY_CENTS_TEXT = String(MAX_MENU_MONEY_CENTS);

export type MenuMoneyDraftInvalidReason = "format" | "precision" | "range";

export type MenuMoneyDraftResult =
  | { kind: "blank"; cents: null }
  | { kind: "valid"; cents: number }
  | { kind: "invalid"; reason: MenuMoneyDraftInvalidReason };

interface MoneyParts {
  wholeDigits: string;
  fractionDigits: string | null;
}

/**
 * Return the currency scale already owned by the shared currency utility.
 * Deriving it through the exported conversion contract keeps this parser from
 * growing a second zero-decimal-currency list.
 */
export const menuMoneyFractionDigits = (currencyCode: string): 0 | 2 =>
  minorFromMajor(1, normalizeCurrency(currencyCode)) === 1 ? 0 : 2;

const splitMoneyDraft = (draft: string): MoneyParts | null => {
  if (/^\d+$/.test(draft)) {
    return { wholeDigits: draft, fractionDigits: null };
  }

  if (draft.includes(".") && draft.includes(",")) {
    const commaGrouped = /^(\d{1,3}(?:,\d{3})+)\.(\d+)$/.exec(draft);
    if (commaGrouped !== null) {
      return {
        wholeDigits: commaGrouped[1].replace(/,/g, ""),
        fractionDigits: commaGrouped[2],
      };
    }

    const dotGrouped = /^(\d{1,3}(?:\.\d{3})+),(\d+)$/.exec(draft);
    if (dotGrouped !== null) {
      return {
        wholeDigits: dotGrouped[1].replace(/\./g, ""),
        fractionDigits: dotGrouped[2],
      };
    }

    return null;
  }

  if (draft.includes(".")) {
    const decimal = /^(\d+)\.(\d+)$/.exec(draft);
    return decimal === null
      ? null
      : { wholeDigits: decimal[1], fractionDigits: decimal[2] };
  }

  if (draft.includes(",")) {
    const grouped = /^(\d{1,3}(?:,\d{3})+)$/.exec(draft);
    if (grouped !== null) {
      return {
        wholeDigits: grouped[1].replace(/,/g, ""),
        fractionDigits: null,
      };
    }

    const decimal = /^(\d+),(\d+)$/.exec(draft);
    return decimal === null
      ? null
      : { wholeDigits: decimal[1], fractionDigits: decimal[2] };
  }

  return null;
};

const removeLeadingZeroes = (digits: string): string => {
  const normalized = digits.replace(/^0+(?=\d)/, "");
  return normalized.length === 0 ? "0" : normalized;
};

const isAboveMaximum = (centsDigits: string): boolean =>
  centsDigits.length > MAX_MENU_MONEY_CENTS_TEXT.length ||
  (centsDigits.length === MAX_MENU_MONEY_CENTS_TEXT.length &&
    centsDigits > MAX_MENU_MONEY_CENTS_TEXT);

const parseTrimmedMenuMoneyDraft = (
  trimmed: string,
  currencyCode: string,
): MenuMoneyDraftResult => {
  if (trimmed.length === 0) return { kind: "blank", cents: null };

  const parts = splitMoneyDraft(trimmed);
  if (parts === null) return { kind: "invalid", reason: "format" };

  const scale = menuMoneyFractionDigits(currencyCode);
  const fraction = parts.fractionDigits ?? "";
  if (fraction.length > scale) {
    return { kind: "invalid", reason: "precision" };
  }

  const paddedFraction = fraction.padEnd(scale, "0");
  const centsDigits = removeLeadingZeroes(
    `${removeLeadingZeroes(parts.wholeDigits)}${paddedFraction}`,
  );

  if (isAboveMaximum(centsDigits)) {
    return { kind: "invalid", reason: "range" };
  }

  return { kind: "valid", cents: Number(centsDigits) };
};

/**
 * Parse one complete Price/Cost draft into exact integer minor units.
 *
 * The accepted language is intentionally deterministic across native and web:
 * canonical comma grouping with dot decimals, ungrouped comma decimals, and
 * explicit dot grouping with comma decimals. The whole trimmed draft must
 * match; no numeric-prefix coercion or floating-point rounding is used.
 */
export const parseMenuMoneyDraft = (
  draft: string,
  currencyCode: string,
): MenuMoneyDraftResult =>
  parseTrimmedMenuMoneyDraft(draft.trim(), currencyCode);

/**
 * Parse one complete signed modifier-price draft into exact minor units.
 *
 * The unsigned parser remains the Price/Cost owner. This wrapper adds exactly
 * one optional leading ASCII minus without allowing whitespace after the sign
 * or changing any of the unsigned locale, precision, or range rules.
 */
export const parseSignedMenuMoneyDraft = (
  draft: string,
  currencyCode: string,
): MenuMoneyDraftResult => {
  const trimmed = draft.trim();
  if (trimmed.length === 0) return { kind: "blank", cents: null };
  if (!trimmed.startsWith("-")) {
    return parseTrimmedMenuMoneyDraft(trimmed, currencyCode);
  }

  const magnitudeDraft = trimmed.slice(1);
  if (magnitudeDraft.length === 0 || magnitudeDraft.trim() !== magnitudeDraft) {
    return { kind: "invalid", reason: "format" };
  }

  const magnitude = parseTrimmedMenuMoneyDraft(magnitudeDraft, currencyCode);
  if (magnitude.kind !== "valid") {
    return magnitude.kind === "blank"
      ? { kind: "invalid", reason: "format" }
      : magnitude;
  }

  return {
    kind: "valid",
    cents: magnitude.cents === 0 ? 0 : -magnitude.cents,
  };
};
