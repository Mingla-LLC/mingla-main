/**
 * overlayKeyboard — #4420 Graphite Glass. The ONE geometry rule for overlays
 * (sheets, modals, confirm dialogs) and the keyboard. Pure, no RN imports
 * beyond the keyboard-clearance budget, so it is unit-tested directly.
 *
 * Seth's bar (#4420 acceptance):
 *   - No sheet or dialog ever extends off screen: every height clamps to the
 *     window minus the top safe area (and a small breathing gap).
 *   - The keyboard never covers a field. Sheets keep the ORCH-0892-B v2 model:
 *     the panel stays docked and the body's SmartScrollView (keyboard-controller
 *     KeyboardAwareScrollView) scrolls the focused input flush above the Done
 *     bar. Moving the panel as well would double-compensate (the scroll view
 *     measures the input before the panel moves, which leaves a keyboard-high
 *     gap), so the sheet's only keyboard job is to keep enough of itself above
 *     the keyboard to show a field: it rises to `keyboardSheetHeight`.
 *     Centred dialogs (Modal, ConfirmDialog typeToConfirm) have no scroll view
 *     of their own, so they centre in the space ABOVE the keyboard + Done bar.
 */

import { size, space } from "../../constants/designSystem";
import { DONE_BAR_OCCUPIED, MIN_VISIBLE_CLEARANCE } from "../../wrappers/keyboardClearance";

/** Breathing gap between an overlay and the top safe-area edge. */
export const OVERLAY_TOP_GAP = 8;

/**
 * The tallest an overlay may be: the window minus the top safe area and the
 * breathing gap. Never below 0.
 */
export const maxOverlayHeight = (screenHeight: number, topInset: number): number =>
  Math.max(0, screenHeight - Math.max(0, topInset) - OVERLAY_TOP_GAP);

/** Clamp a requested overlay height to the safe area. */
export const clampOverlayHeight = (requested: number, screenHeight: number, topInset: number): number =>
  Math.max(0, Math.min(requested, maxOverlayHeight(screenHeight, topInset)));

/**
 * The room a docked sheet keeps visible ABOVE the keyboard and its Done bar,
 * so a focused field (48) plus its label and breathing room always shows.
 */
export const MIN_SHEET_VISIBLE_ABOVE_KEYBOARD = 200;

/**
 * Sheet height while the keyboard is open. If the docked sheet already shows
 * enough of itself above the keyboard it keeps its height (no movement, so the
 * body's scroll view places the field flush). Otherwise it grows just enough,
 * clamped to the safe area.
 */
export const keyboardSheetHeight = (
  restingHeight: number,
  keyboardHeight: number,
  screenHeight: number,
  topInset: number,
): number => {
  const resting = clampOverlayHeight(restingHeight, screenHeight, topInset);
  if (keyboardHeight <= 0) return resting;
  const covered = keyboardHeight + DONE_BAR_OCCUPIED;
  const needed = covered + MIN_SHEET_VISIBLE_ABOVE_KEYBOARD;
  return resting >= needed ? resting : clampOverlayHeight(needed, screenHeight, topInset);
};

/**
 * #4420 (device round 2) — the docked sheet body's bottom padding while the
 * keyboard is open: the keyboard, its Done bar and the minimum clearance. The
 * panel stays docked at the window bottom (its TOP does not move, so the body's
 * KeyboardAwareScrollView measured the focused field correctly), and the body
 * content now ends above the Done bar, so a pinned footer (Save / Cancel) sits
 * above the keyboard instead of behind it. 0 while closed (the caller keeps its
 * resting padding).
 */
export const sheetKeyboardBottomPad = (keyboardHeight: number): number =>
  keyboardHeight > 0 ? keyboardHeight + DONE_BAR_OCCUPIED + MIN_VISIBLE_CLEARANCE : 0;

/**
 * How far a sheet's body scroll view must place the focused field ABOVE the
 * library's default (keyboard + Done bar + clearance): the gap between the
 * scroll view's bottom and the body's content bottom (a pinned footer), plus the clearance the lifted body
 * keeps above the bar, less how far a short sheet's top rose for the keyboard
 * (the scroll view measured the field before that rise).
 */
export const sheetScrollExtraOffset = (footerGap: number, topShift: number): number =>
  MIN_VISIBLE_CLEARANCE + Math.max(0, footerGap) - Math.max(0, topShift);

/**
 * A multiline field's caret sits on its FIRST line (about 10 above where the
 * shared offset expects a centred single-line caret), and its box keeps its
 * own padding (about 10) below the text frame, and its helper line (count /
 * minimum, about 20) sits right under it. Measured on the iOS sim: Review
 * changes' reason box (TextInput 80 tall) showed its lower edge, then its
 * helper line, under the action row until all three were covered.
 */
const MULTILINE_CARET_AND_BOX_PAD = space[7];

/**
 * #4420 (device round 2) — how much of a focused field lies BELOW the line the
 * keyboard library aligns. The library places the caret's line, and the
 * shared offset already covers a single-line Input (size.input) below it. A
 * taller field (a multiline reason box with the caret on its first line) has
 * the rest of its box below that line, which landed under the sheet's Save
 * row. This is that rest, so the whole box sits above the action row.
 */
export const focusedFieldTail = (inputHeight: number): number =>
  inputHeight > size.input
    ? Math.round(inputHeight - size.input + MULTILINE_CARET_AND_BOX_PAD)
    : 0;

/**
 * Bottom inset for a centred dialog: the keyboard, its Done bar and the
 * minimum clearance while open; 0 while closed.
 */
export const dialogKeyboardInset = (keyboardHeight: number): number =>
  keyboardHeight > 0 ? keyboardHeight + DONE_BAR_OCCUPIED + MIN_VISIBLE_CLEARANCE : 0;

/** The tallest a centred dialog may be with the keyboard up. */
export const dialogMaxHeight = (
  screenHeight: number,
  topInset: number,
  bottomInset: number,
  keyboardHeight: number,
): number => {
  const bottom = keyboardHeight > 0 ? dialogKeyboardInset(keyboardHeight) : Math.max(0, bottomInset) + OVERLAY_TOP_GAP;
  return Math.max(0, screenHeight - Math.max(0, topInset) - OVERLAY_TOP_GAP - bottom);
};
