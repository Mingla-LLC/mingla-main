/**
 * Issue #3645 — ONE owner for "what currency is this draft in, on the server".
 *
 * Everything that learns the answer writes it here: the read made when a
 * draft opens in a wizard, and the result of every draft save (the freshest
 * answer there is). Everything that needs the answer reads it from here. Two
 * readers each keeping their own copy is what made a draft swing between two
 * currencies and save without end: the open-time answer said pounds, each save
 * said naira, and each undid the other.
 *
 * An answer is only replaced by a NEWER one (by the moment it was asked for or
 * received), so a slow read that started before a save cannot overwrite what
 * the save established. An answer belongs to the visit that obtained it: a
 * screen believes only answers recorded after it mounted, drops the draft's
 * answer when it closes, and sign-out clears them all. Kept in memory only;
 * nothing fetched is persisted.
 */
export interface ServerCurrencyAnswer {
  /** Null = the server holds no currency for this draft. */
  currency: string | null;
  at: number;
  /**
   * The position of this answer among ALL answers ever recorded here, for any
   * draft. A screen notes the position when it mounts and believes only
   * answers recorded after it: what an earlier visit to the draft was told is
   * never acted on.
   */
  seq: number;
}

const answers = new Map<string, ServerCurrencyAnswer>();
let sequence = 0;
const listeners = new Set<() => void>();

const normalize = (currency: string | null | undefined): string | null => {
  const code = currency?.trim().toUpperCase();
  return code !== undefined && code.length > 0 ? code : null;
};

/**
 * Record what the server says. `at` is when the answer was asked for (a read)
 * or received (a save result); an answer older than the one held is ignored.
 */
export const setDraftServerCurrency = (
  draftId: string,
  currency: string | null | undefined,
  at: number = Date.now(),
): void => {
  const held = answers.get(draftId);
  if (held !== undefined && held.at > at) return;
  const next = normalize(currency);
  sequence += 1;
  answers.set(draftId, { currency: next, at, seq: sequence });
  if (held === undefined || held.currency !== next) {
    listeners.forEach((listener) => listener());
  }
};

/** `undefined` = nothing is known yet for this draft. */
export const getDraftServerCurrency = (
  draftId: string,
): string | null | undefined => answers.get(draftId)?.currency;

/** The whole answer, with its position; `undefined` = nothing known. */
export const getDraftServerCurrencyAnswer = (
  draftId: string,
): ServerCurrencyAnswer | undefined => answers.get(draftId);

/** The position of the newest answer recorded so far, for any draft. */
export const draftServerCurrencySequence = (): number => sequence;

/** The screen showing this draft has closed: what it was told is dropped. */
export const forgetDraftServerCurrency = (draftId: string): void => {
  if (answers.delete(draftId)) listeners.forEach((listener) => listener());
};

/** Sign-out: nothing learned for one account is kept for the next. */
export const clearDraftServerCurrencies = (): void => {
  answers.clear();
  listeners.forEach((listener) => listener());
};

export const subscribeDraftServerCurrency = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return (): void => {
    listeners.delete(listener);
  };
};

/** Test seam. */
export const resetDraftServerCurrencyForTest = (): void => {
  answers.clear();
  listeners.clear();
};
