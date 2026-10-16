/**
 * Issue #3645 — when a draft opens in a wizard, it follows its brand's currency.
 *
 * Mounted by the draft ROUTES (app/event/[id]/edit, app/rsvp/[id]/edit), not
 * by the wizards: several suites compile the wizards against a closed list of
 * imports, and the route already owns the draft, the brand, the save and the
 * toast.
 *
 * Two things can have happened since the host last saw the draft:
 *   1. The copy kept on this device still carries the brand's OLD currency.
 *      It takes the currency the SERVER reports (one read when the draft
 *      opens, never a brand list cached here); paid prices and chip-in
 *      amounts are cleared (see adoptBrandCurrencyForDraft). A copy already in
 *      the server's currency is never cleared.
 *   2. The server already moved the draft and cleared its prices, and left a
 *      note saying so (utils/draftPricesClearedNote).
 * Either way the host is told once, in plain words, why the price fields are
 * empty. Nothing changes silently. The note is removed by the same update, so
 * the next save drops it and the notice does not come back.
 *
 * A draft with no currency yet is left alone here: the save stamps it and its
 * typed prices stay, with no notice.
 */
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import { fetchDraftOpenState, stopDraftOpenReads } from "../services/draftCurrencyTruth";
import { adoptServerDraftAfterSync } from "../services/draftServerReconcile";
import { useDraftEventStore, type DraftEvent } from "../store/draftEventStore";
import {
  adoptBrandCurrencyForDraft,
  pricesClearedNotice,
} from "../utils/draftFollowsBrandCurrency";
import { currencyCodeOrNull } from "../utils/currency";
import {
  draftServerCurrencySequence,
  forgetDraftServerCurrency,
  getDraftServerCurrencyAnswer,
  nextDraftServerCurrencyStamp,
  setDraftServerCurrency,
  subscribeDraftServerCurrency,
} from "../utils/draftServerCurrency";
import {
  clearPricesClearedNote,
  getPricesClearedNote,
  isPricesClearedNoteFromThisDevice,
  pricesClearedNoteFromTheme,
  recordPricesClearedNote,
  subscribePricesClearedNotes,
  type PricesClearedNote,
} from "../utils/draftPricesClearedNote";

type DraftPatch = Partial<Omit<DraftEvent, "id" | "brandId" | "createdAt">>;

export interface DraftFollowsBrandCurrencyInput {
  /** The draft the route resolved; null while it loads or for a live event. */
  draft: DraftEvent | null;
  /** The route's own draft save (promotion-aware). */
  onSave: (draft: DraftEvent) => void;
  /** The route's own toast. */
  onNotice: (message: string) => void;
}

export interface DraftCurrencyFollowPlan {
  patch: DraftPatch;
  /** The message to show once, or null when nothing was cleared. */
  notice: string | null;
}

/** Pure decision, exported for tests. Null = nothing to do. */
export const planDraftCurrencyFollow = (
  draft: DraftEvent,
  brandCurrency: string | null | undefined,
  serverNote: PricesClearedNote | null = null,
): DraftCurrencyFollowPlan | null => {
  if (draft.status !== "draft") return null;
  const hadOtherCurrency = currencyCodeOrNull(draft.currency) !== null;
  const adoption = adoptBrandCurrencyForDraft(draft, brandCurrency);
  const movedHere = adoption.changed && hadOtherCurrency;
  if (!movedHere && serverNote === null) return null;

  // An empty patch still saves: that save rebuilds the draft JSON without the
  // server's note, so the notice is shown once and not on the next device.
  const patch: DraftPatch = {};
  if (movedHere) {
    patch.currency = adoption.draft.currency;
    patch.tickets = adoption.draft.tickets;
    patch.rsvpContributionSuggestedCents =
      adoption.draft.rsvpContributionSuggestedCents;
    patch.rsvpContributionMinCents = adoption.draft.rsvpContributionMinCents;
  }
  const noticeCurrency: string | null =
    movedHere && adoption.pricesCleared
      ? currencyCodeOrNull(adoption.draft.currency)
      : serverNote?.to ?? null;
  return {
    patch,
    notice: noticeCurrency === null ? null : pricesClearedNotice(noticeCurrency),
  };
};

export const useDraftFollowsBrandCurrency = ({
  draft,
  onSave,
  onNotice,
}: DraftFollowsBrandCurrencyInput): void => {
  const updateDraft = useDraftEventStore((s) => s.updateDraft);
  const markDraftDirty = useDraftEventStore((s) => s.markDraftDirty);
  // One notice per draft per mount, even if the server copy is re-read before
  // the adopting save lands.
  const noticedDraftIdsRef = useRef<Set<string>>(new Set());
  const reconcilingRef = useRef<Set<string>>(new Set());
  const confirmedClearsRef = useRef<Set<string>>(new Set());
  const [confirmTick, setConfirmTick] = useState(0);
  const draftId = draft?.id ?? null;

  // THIS VISIT ONLY. What the server said about this draft is believed only
  // if it was learned while this screen is mounted: by this mount's own read
  // (kept in this hook's state), or by a save or server read made since (the
  // shared answer, but only one recorded after this mount began). An answer
  // left from an earlier visit is never acted on: between two visits the
  // brand may have changed currency and someone may have re-priced the draft,
  // and acting on the old answer cleared those new prices.
  const mountSequenceRef = useRef<number | null>(null);
  if (mountSequenceRef.current === null) {
    mountSequenceRef.current = draftServerCurrencySequence();
  }
  const [ownAnswer, setOwnAnswer] = useState<{
    draftId: string;
    currency: string | null;
  } | null>(null);

  // Nothing started here outlives the screen: once it has closed, a read that
  // comes back late changes nothing, saves nothing and logs nothing.
  const closedRef = useRef(false);
  useEffect(() => {
    closedRef.current = false;
    return (): void => {
      closedRef.current = true;
    };
  }, []);

  useEffect(() => {
    if (draftId === null || draftId.startsWith("d_")) return undefined;
    let live = true;
    const askedAt = nextDraftServerCurrencyStamp();
    const ask = async (): Promise<void> => {
      try {
        const open = await fetchDraftOpenState(draftId);
        if (!live) return;
        // The row's own "prices were cleared" note, read by this visit.
        recordPricesClearedNote(draftId, open.theme);
        setDraftServerCurrency(draftId, open.currency, askedAt);
        setOwnAnswer({ draftId, currency: open.currency });
      } catch (error) {
        if (!live) return;
        console.warn("[useDraftFollowsBrandCurrency] could not read the draft's currency", {
          draftId,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    };
    void ask();
    return (): void => {
      live = false;
      stopDraftOpenReads(draftId);
      // The screen is closing: what it was told goes with it.
      forgetDraftServerCurrency(draftId);
      clearPricesClearedNote(draftId);
    };
  }, [draftId]);

  const sharedAnswer = useSyncExternalStore(
    subscribeDraftServerCurrency,
    () => (draftId === null ? undefined : getDraftServerCurrencyAnswer(draftId)),
    () => undefined,
  );
  const serverCurrency: string | null =
    sharedAnswer !== undefined && sharedAnswer.seq > mountSequenceRef.current
      ? sharedAnswer.currency
      : ownAnswer !== null && ownAnswer.draftId === draftId
        ? ownAnswer.currency
        : null;

  const serverNote = useSyncExternalStore(
    subscribePricesClearedNotes,
    () => (draftId === null ? null : getPricesClearedNote(draftId)),
    () => null,
  );
  const serverNoteTo = serverNote?.to ?? null;

  useEffect(() => {
    if (draft === null || draft.status !== "draft") return;
    const localCurrency = currencyCodeOrNull(draft.currency);

    // INVARIANT (issue #3645): this device clears its own prices ONLY when the
    // server row it read carries the cleared state (the note), never because
    // two currencies differ. A copy priced in another currency than a row the
    // server did not clear is a copy of a draft someone has since re-priced:
    // the server's currency and prices replace this device's. Nothing is
    // cleared and the host is told nothing. Whatever else the host typed here
    // and has not saved (title, dates, ...) is kept, and is then saved.
    // (A copy that holds no price has nothing to clear; it takes the server's
    // currency through the ordinary path below.)
    if (
      serverNote === null &&
      localCurrency !== null &&
      serverCurrency !== null &&
      localCurrency !== serverCurrency &&
      adoptBrandCurrencyForDraft(draft, serverCurrency).pricesCleared
    ) {
      const key = `${draft.id}:${serverCurrency}`;
      if (reconcilingRef.current.has(key)) return;
      reconcilingRef.current.add(key);
      void adoptServerDraftAfterSync(draft.id)
        .then((owedSave) => {
          if (owedSave !== null && !closedRef.current) onSave(owedSave);
        })
        .catch((error: unknown) => {
          if (closedRef.current) return;
          console.warn("[useDraftFollowsBrandCurrency] could not read the server's copy of the draft", {
            draftId: draft.id,
            message: error instanceof Error ? error.message : String(error),
          });
        })
        .finally(() => {
          reconcilingRef.current.delete(key);
        });
      return;
    }

    // "The row it JUST read": a note held here may be older than the row. It
    // was read when the server had cleared the draft; since then someone may
    // have entered prices again, and clearing on the strength of the old note
    // wiped them (seen about once in twenty runs of a random-turn test). So
    // before this device clears a price because of the SERVER's note, the row
    // is read once more. Still cleared and still in that currency: go ahead.
    // Otherwise the note is dropped and the server's copy replaces this
    // device's.
    if (
      serverNote !== null &&
      localCurrency !== null &&
      serverCurrency !== null &&
      localCurrency !== serverCurrency &&
      adoptBrandCurrencyForDraft(draft, serverCurrency).pricesCleared &&
      !isPricesClearedNoteFromThisDevice(draft.id)
    ) {
      const confirmDraftId = draft.id;
      const key = `${confirmDraftId}:${serverCurrency}:${serverNote.from ?? ""}`;
      if (!confirmedClearsRef.current.has(key)) {
        if (reconcilingRef.current.has(key)) return;
        reconcilingRef.current.add(key);
        const confirm = async (): Promise<void> => {
          const now = await fetchDraftOpenState(confirmDraftId);
          if (closedRef.current) return;
          if (
            pricesClearedNoteFromTheme(now.theme) !== null &&
            now.currency === serverCurrency
          ) {
            confirmedClearsRef.current.add(key);
            setConfirmTick((tick) => tick + 1);
            return;
          }
          clearPricesClearedNote(confirmDraftId);
          setDraftServerCurrency(confirmDraftId, now.currency);
          const owedSave = await adoptServerDraftAfterSync(confirmDraftId);
          if (owedSave !== null && !closedRef.current) onSave(owedSave);
        };
        void confirm()
          .catch((error: unknown) => {
            if (closedRef.current) return;
            console.warn("[useDraftFollowsBrandCurrency] could not confirm the draft is still cleared", {
              draftId: confirmDraftId,
              message: error instanceof Error ? error.message : String(error),
            });
          })
          .finally(() => {
            reconcilingRef.current.delete(key);
          });
        return;
      }
      confirmedClearsRef.current.delete(key);
    }

    const plan = planDraftCurrencyFollow(draft, serverCurrency, serverNote);
    if (plan === null) return;
    // A note this device made itself (its own save cleared the prices) only
    // has to be shown: the server holds nothing to resolve. A save is owed
    // only when the draft itself changes here, or the SERVER's note has to be
    // written back as resolved. This is what lets the saves come to rest.
    const noteNeedsNoSave = isPricesClearedNoteFromThisDevice(draft.id);
    const changesDraft = Object.keys(plan.patch).length > 0;
    clearPricesClearedNote(draft.id);
    if (changesDraft || !noteNeedsNoSave) {
      // Same shape as a wizard edit: a new revision, marked dirty, then saved.
      // The wizard keeps its own counter at or above the draft's, so its next
      // edit follows on from this one.
      const nextRevision = (draft.clientRevision ?? 0) + 1;
      markDraftDirty(draft.id, nextRevision);
      updateDraft(draft.id, { ...plan.patch, clientRevision: nextRevision });
      const fresh = useDraftEventStore.getState().getDraft(draft.id);
      onSave(fresh ?? { ...draft, ...plan.patch, clientRevision: nextRevision });
    }
    if (plan.notice !== null && !noticedDraftIdsRef.current.has(draft.id)) {
      noticedDraftIdsRef.current.add(draft.id);
      onNotice(plan.notice);
    }
    // `draft` is read fresh on the render these keys change in; listing the
    // whole object would re-run this on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftId, draft?.currency, draft?.status, serverCurrency, serverNoteTo, confirmTick]);
};
