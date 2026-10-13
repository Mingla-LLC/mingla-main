/**
 * Issue #3645 — the server's note that a draft's prices were cleared because
 * the brand's currency changed (`theme.business_draft
 * .pricesClearedForCurrencyChange`, written by migration 20270829003645).
 *
 * It is not a draft field: it is a one-time message. The draft service records
 * it here when it reads a server row; the wizard reads it, tells the host once
 * and clears it. The wizard's next save rebuilds the draft JSON without the
 * note, so it does not come back. Kept in memory only, like the cover base in
 * utils/draftCoverBase: nothing fetched from the server is persisted here.
 */
import { currencyCodeOrNull } from "./currency";

export interface PricesClearedNote {
  from: string | null;
  to: string;
}

const notes = new Map<string, PricesClearedNote>();
const madeByThisDevice = new Set<string>();
const listeners = new Set<() => void>();

const emit = (): void => {
  listeners.forEach((listener) => listener());
};

/** Anything that is not `{ to: "<currency>" }` is no note. */
export const pricesClearedNoteFromTheme = (theme: unknown): PricesClearedNote | null => {
  if (typeof theme !== "object" || theme === null) return null;
  const businessDraft = (theme as { business_draft?: unknown }).business_draft;
  if (typeof businessDraft !== "object" || businessDraft === null) return null;
  const raw = (businessDraft as { pricesClearedForCurrencyChange?: unknown })
    .pricesClearedForCurrencyChange;
  if (typeof raw !== "object" || raw === null) return null;
  const { from, to } = raw as { from?: unknown; to?: unknown };
  const toCode = currencyCodeOrNull(typeof to === "string" ? to : null);
  if (toCode === null) return null;
  return {
    from: currencyCodeOrNull(typeof from === "string" ? from : null),
    to: toCode,
  };
};

/** Record (or, with no note in the row, forget) what a server row says. */
export const recordPricesClearedNote = (draftId: string, theme: unknown): void => {
  const note = pricesClearedNoteFromTheme(theme);
  const had = notes.get(draftId) ?? null;
  if (note === null) {
    // A row without a note does not erase a note this device made itself.
    if (had === null || madeByThisDevice.has(draftId)) return;
    notes.delete(draftId);
    emit();
    return;
  }
  if (had !== null && had.to === note.to && had.from === note.from) return;
  notes.set(draftId, note);
  madeByThisDevice.delete(draftId);
  emit();
};

/**
 * Set a note this device produced itself: a save that moved a draft to the
 * brand's currency and cleared its prices. The server never saw a note for it.
 */
export const setPricesClearedNote = (draftId: string, note: PricesClearedNote): void => {
  notes.set(draftId, note);
  madeByThisDevice.add(draftId);
  emit();
};

/**
 * True when the note waiting for this draft was produced by a save on THIS
 * device, not read from the server. Such a note only has to be shown: the
 * server holds nothing to resolve, so no further save is owed for it.
 */
export const isPricesClearedNoteFromThisDevice = (draftId: string): boolean =>
  madeByThisDevice.has(draftId);

export const getPricesClearedNote = (draftId: string): PricesClearedNote | null =>
  notes.get(draftId) ?? null;

export const clearPricesClearedNote = (draftId: string): void => {
  madeByThisDevice.delete(draftId);
  if (notes.delete(draftId)) emit();
};

export const subscribePricesClearedNotes = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return (): void => {
    listeners.delete(listener);
  };
};

/** Sign-out: no note learned for one account is kept for the next. */
export const clearAllPricesClearedNotes = (): void => {
  notes.clear();
  madeByThisDevice.clear();
  emit();
};

/** Test seam. */
export const resetPricesClearedNotesForTest = (): void => {
  notes.clear();
  madeByThisDevice.clear();
  listeners.clear();
};
