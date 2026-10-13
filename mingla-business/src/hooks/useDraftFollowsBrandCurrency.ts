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

import { fetchDraftCurrencyTruth } from "../services/draftCurrencyTruth";
import { useDraftEventStore, type DraftEvent } from "../store/draftEventStore";
import {
  adoptBrandCurrencyForDraft,
  pricesClearedNotice,
} from "../utils/draftFollowsBrandCurrency";
import { currencyCodeOrNull } from "../utils/currency";
import {
  clearPricesClearedNote,
  getPricesClearedNote,
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
  const draftId = draft?.id ?? null;

  // What the SERVER says this draft's currency should be, asked once per
  // draft when it opens. Never the brand list cached on this device: that
  // list can be older than the draft, and trusting it let a second device
  // clear a correctly re-priced draft. A draft that only exists on this
  // device (d_*) has no server row to ask about; its first save is checked
  // against the server instead. Until the answer arrives, and if it cannot be
  // had, nothing is adopted here.
  const [serverTruth, setServerTruth] = useState<{
    draftId: string;
    currency: string | null;
  } | null>(null);
  useEffect(() => {
    if (draftId === null || draftId.startsWith("d_")) return undefined;
    let live = true;
    const ask = async (): Promise<void> => {
      try {
        const currency = await fetchDraftCurrencyTruth(draftId);
        if (live) setServerTruth({ draftId, currency });
      } catch (error) {
        console.warn("[useDraftFollowsBrandCurrency] could not read the draft's currency", {
          draftId,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    };
    void ask();
    return (): void => {
      live = false;
    };
  }, [draftId]);
  const serverCurrency =
    serverTruth !== null && serverTruth.draftId === draftId
      ? serverTruth.currency
      : null;

  const serverNote = useSyncExternalStore(
    subscribePricesClearedNotes,
    () => (draftId === null ? null : getPricesClearedNote(draftId)),
    () => null,
  );
  const serverNoteTo = serverNote?.to ?? null;

  useEffect(() => {
    if (draft === null) return;
    const plan = planDraftCurrencyFollow(draft, serverCurrency, serverNote);
    if (plan === null) return;
    clearPricesClearedNote(draft.id);
    // Same shape as a wizard edit: a new revision, marked dirty, then saved.
    // The wizard keeps its own counter at or above the draft's, so its next
    // edit follows on from this one.
    const nextRevision = (draft.clientRevision ?? 0) + 1;
    markDraftDirty(draft.id, nextRevision);
    updateDraft(draft.id, { ...plan.patch, clientRevision: nextRevision });
    const fresh = useDraftEventStore.getState().getDraft(draft.id);
    onSave(fresh ?? { ...draft, ...plan.patch, clientRevision: nextRevision });
    if (plan.notice !== null && !noticedDraftIdsRef.current.has(draft.id)) {
      noticedDraftIdsRef.current.add(draft.id);
      onNotice(plan.notice);
    }
    // `draft` is read fresh on the render these keys change in; listing the
    // whole object would re-run this on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftId, draft?.currency, draft?.status, serverCurrency, serverNoteTo]);
};
