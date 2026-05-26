/**
 * ORCH-0964 hot-fix utility — pure hex commit-gate.
 *
 * Returns the trimmed `#RRGGBB` string if the input is a valid 7-character
 * hex color (with leading `#`), else null. Used by `ThemeEditorSection` to
 * gate when an on-keystroke text change becomes a "real" theme color commit.
 *
 * Critical contract: partial input must return null so the on-keystroke
 * commit handler does NOT overwrite the operator's in-progress text draft.
 * Pre-fix bug: when the function returned `null` AND the input's `value`
 * was bound to the parent's `value?.color ?? ""`, every keystroke that
 * didn't reach a full 7-char hex collapsed the field to empty — making
 * char-by-char typing impossible.
 *
 * This module is pure (no React, no React Native imports) so Jest can
 * unit-test it without a JSX/RN runtime.
 */
export const normalizeHexColor = (
  value: string | null | undefined,
): string | null => {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  return /^#[0-9a-fA-F]{6}$/.test(trimmed) ? trimmed : null;
};
