/**
 * #3872 round 2 — the Mingla spacing rule for Host program screens, in one
 * place, plus the keyboard rule every program form follows. Pure values and
 * functions so the rules are testable without mounting a screen.
 *
 * Spacing rule (approved 26 Oct):
 * - Screen gutter 16pt; headings, cards, lists, fields and buttons all start on it.
 * - Cards and lists are full width inside the gutter, 16pt radius, no inset of
 *   their own; ONE inner padding set once by the card; rows at least 52pt.
 * - 12pt between blocks; a section label sits 8pt above its card.
 * - Main button 48pt, full width, pinned to the bottom, hidden while typing.
 * - Numbers: one strip of up to three, never tile grids.
 */
export const PROGRAM_GUTTER = 16;
export const PROGRAM_CARD_PADDING = 16;
export const PROGRAM_BLOCK_GAP = 12;
export const PROGRAM_LABEL_GAP = 8;
export const PROGRAM_ROW_MIN_HEIGHT = 52;
export const PROGRAM_MAIN_BUTTON_HEIGHT = 48;
export const PROGRAM_STRIP_MAX = 3;

/**
 * The keyboard rule for every program form (brief editor, offer editor,
 * invite, review reply, counter, hire): while the keyboard is open the
 * pinned footer button hides (so it never rides up over the field and the
 * screen does not jump) and the title bar offers Done to close the keyboard.
 */
export function programFormChrome(input: {
  keyboardVisible: boolean;
  hasFooter: boolean;
}): { showFooter: boolean; showDone: boolean } {
  return {
    showFooter: input.hasFooter && !input.keyboardVisible,
    showDone: input.keyboardVisible,
  };
}

/** Up to three numbers for a stat strip; anything past three is dropped. */
export function stripItems<T>(items: ReadonlyArray<T | null | undefined | false>): T[] {
  return items
    .filter((item): item is T => Boolean(item))
    .slice(0, PROGRAM_STRIP_MAX);
}
