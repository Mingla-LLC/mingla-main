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
    if (had === null) return;
    notes.delete(draftId);
    emit();
    return;
  }
  if (had !== null && had.to === note.to && had.from === note.from) return;
  notes.set(draftId, note);
  emit();
};

export const getPricesClearedNote = (draftId: string): PricesClearedNote | null =>
  notes.get(draftId) ?? null;

export const clearPricesClearedNote = (draftId: string): void => {
  if (notes.delete(draftId)) emit();
};

export const subscribePricesClearedNotes = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return (): void => {
    listeners.delete(listener);
  };
};

/** Test seam. */
export const resetPricesClearedNotesForTest = (): void => {
  notes.clear();
  listeners.clear();
};
