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

/**
 * #1022 — `#RGB` -> `#RRGGBB` expansion, for the BLUR path ONLY.
 *
 * Seth approved short-hex entry, and the SPEC described it as a "superset" of
 * `normalizeHexColor`. It cannot be one. `#FF1` is simultaneously a valid
 * 3-digit hex AND the fourth keystroke of `#FF1493`. Expanding it on every
 * keystroke would commit `#FFFF11` mid-word and then re-render the field from
 * the committed value — which is precisely the ORCH-0964 bug that made
 * char-by-char typing impossible, and precisely what
 * `ThemeEditorSection.hexInput.orch_0964_hotfix.test.ts` pins (it asserts
 * `#FF1` returns null).
 *
 * So the two contracts are split by MOMENT, not by function:
 *   - on keystroke -> `normalizeHexColor` (strictly 6 digits, unchanged)
 *   - on blur      -> `expandShortHex` first, then `normalizeHexColor`
 *
 * A user typing `#f80` and leaving the field gets `#ff8800`; a user typing
 * `#FF1493` character by character is never interrupted. Both results are
 * 6 digits, satisfying events_theme_color_override_hex_chk.
 *
 * Expansion mirrors utils/buttonAccentContrast.ts's HEX3 branch rather than
 * inventing a second implementation.
 */
export const expandShortHex = (
  value: string | null | undefined,
): string | null => {
  if (value === null || value === undefined) return null;
  const short = value.trim().match(/^#([0-9a-fA-F])([0-9a-fA-F])([0-9a-fA-F])$/);
  if (short === null) return null;
  const [, r, g, b] = short;
  return `#${r}${r}${g}${g}${b}${b}`;
};

/**
 * The blur-time commit gate: accept a full 6-digit hex, or expand a 3-digit
 * one. Returns null when the draft is unusable, so the caller reverts the
 * field to the last committed value.
 */
export const normalizeHexColorOnBlur = (
  value: string | null | undefined,
): string | null => normalizeHexColor(value) ?? expandShortHex(value);
