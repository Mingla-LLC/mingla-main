export type ModifierMaximumDraftResult =
  | { kind: "blank"; value: null }
  | { kind: "valid"; value: number }
  | { kind: "invalid"; reason: "format" | "range" };

export const MODIFIER_MAXIMUM_ERROR_COPY = {
  format: "Enter a whole number from 1 to 20.",
  range: "The maximum must be between 1 and 20.",
} as const;

const MAX_SAFE_INTEGER_TEXT = String(Number.MAX_SAFE_INTEGER);

/** Parse the complete multi-choice maximum draft without numeric coercion. */
export const parseModifierMaximumDraft = (
  draft: string,
): ModifierMaximumDraftResult => {
  const trimmed = draft.trim();
  if (trimmed.length === 0) return { kind: "blank", value: null };
  if (!/^\d+$/.test(trimmed)) {
    return { kind: "invalid", reason: "format" };
  }

  const normalizedDigits = trimmed.replace(/^0+(?=\d)/, "");
  if (
    normalizedDigits.length > MAX_SAFE_INTEGER_TEXT.length ||
    (normalizedDigits.length === MAX_SAFE_INTEGER_TEXT.length &&
      normalizedDigits > MAX_SAFE_INTEGER_TEXT)
  ) {
    return { kind: "invalid", reason: "format" };
  }
  if (
    normalizedDigits.length > 2 ||
    (normalizedDigits.length === 2 && normalizedDigits > "20")
  ) {
    return { kind: "invalid", reason: "range" };
  }

  const value = Number(normalizedDigits);
  return value >= 1 && value <= 20
    ? { kind: "valid", value }
    : { kind: "invalid", reason: "range" };
};

export const modifierMaximumDraftError = (
  result: ModifierMaximumDraftResult,
): string | null =>
  result.kind === "invalid" ? MODIFIER_MAXIMUM_ERROR_COPY[result.reason] : null;
