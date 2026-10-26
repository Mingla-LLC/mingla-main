/**
 * Issue #4114 QA run 3 — opening a card from a chat sheet.
 *
 * The Plans and Matches sheets are their own iOS RN Modal (`wrapInRNModal`),
 * and ExpandedCardModal is one too. iOS presents one RN Modal at a time: a card
 * presented while its sheet is still up is refused ("already presenting"), and
 * the card state stayed set, so every later open (header strip, thread) set a
 * target on an already-`visible` modal and never presented again.
 *
 * Same rule as ORCH-1371 and ExpandedCardModal's own Share handoff: free the
 * slot first. A sheet row closes the sheet and holds the card as `pending`;
 * the card shows only once the sheet's native window has dismissed. A direct
 * open (no sheet up) shows at once, and an open while a card is still set
 * clears it and re-presents on the next frame, so a refused or stuck present
 * can never swallow the next open. Close and cancel clear everything.
 *
 * Pure and dependency-free so it runs under Deno.
 */

export type SheetCardWait = "none" | "sheetDismissed" | "frame";

export interface SheetCardState<T> {
  /** The card ExpandedCardModal shows (`visible={shown !== null}`). */
  shown: T | null;
  /** A card waiting for the sheet to dismiss, or for the next frame. */
  pending: T | null;
  waitFor: SheetCardWait;
}

export type SheetCardEvent<T> =
  | { type: "open"; target: T }
  | { type: "openFromSheet"; target: T }
  | { type: "sheetDismissed" }
  | { type: "frame" }
  | { type: "close" }
  | { type: "cancel" };

export function initialSheetCardState<T>(): SheetCardState<T> {
  return { shown: null, pending: null, waitFor: "none" };
}

const CLEARED = { shown: null, pending: null, waitFor: "none" } as const;

export function sheetCardReducer<T>(
  state: SheetCardState<T>,
  event: SheetCardEvent<T>,
): SheetCardState<T> {
  switch (event.type) {
    case "open":
      // A card is still set (open, or a present iOS refused): clear it and
      // re-present next frame so `visible` goes false → true and the modal
      // actually presents again.
      if (state.shown !== null) return { shown: null, pending: event.target, waitFor: "frame" };
      return { shown: event.target, pending: null, waitFor: "none" };
    case "openFromSheet":
      return { shown: null, pending: event.target, waitFor: "sheetDismissed" };
    case "sheetDismissed":
      if (state.waitFor !== "sheetDismissed") return state;
      return { shown: state.pending, pending: null, waitFor: "none" };
    case "frame":
      if (state.waitFor !== "frame") return state;
      return { shown: state.pending, pending: null, waitFor: "none" };
    case "close":
    case "cancel":
      return { ...CLEARED };
    default: {
      const never: never = event;
      return never;
    }
  }
}

/**
 * If the sheet's native dismiss never arrives, show the card anyway after this
 * long rather than leave a dead tap; a refused present then re-arms through
 * `open` on the next tap.
 */
export const SHEET_DISMISS_WATCHDOG_MS = 1200;
