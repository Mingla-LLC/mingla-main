export type ModifierMaximumDraftResult =
  | { kind: "blank"; value: null }
  | { kind: "valid"; value: number }
  | { kind: "invalid"; reason: "format" | "range" };

export const MODIFIER_MAXIMUM_ERROR_COPY = {
  format: "Enter a whole number from 1 to 20.",
  range: "The maximum must be between 1 and 20.",
} as const;

// The stored maximum is at most two significant digits. Four raw digits keep
// established short leading-zero forms (`002`, `0021`) classifiable by value,
// while longer digit-only pastes are malformed in full rather than collapsed.
const MAX_MODIFIER_MAXIMUM_DRAFT_DIGITS = 4;

/** Parse the complete multi-choice maximum draft without numeric coercion. */
export const parseModifierMaximumDraft = (
  draft: string,
): ModifierMaximumDraftResult => {
  const trimmed = draft.trim();
  if (trimmed.length === 0) return { kind: "blank", value: null };
  if (!/^\d+$/.test(trimmed)) {
    return { kind: "invalid", reason: "format" };
  }
  if (trimmed.length > MAX_MODIFIER_MAXIMUM_DRAFT_DIGITS) {
    return { kind: "invalid", reason: "format" };
  }

  const normalizedDigits = trimmed.replace(/^0+(?=\d)/, "");
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
