/**
 * Issue #3645 — put the SERVER's currency and prices in place of this
 * device's.
 *
 * Used when this device's copy is priced in a currency the server row is not
 * in and the server did NOT clear the draft's prices (someone re-priced it
 * elsewhere), and after `biz_sync_draft_currency` moved a draft. The numbers
 * on this device were typed in another currency: they are neither kept nor
 * "cleared" here, the server's replace them.
 *
 * ONLY the currency and the money fields come from the server (the ticket
 * list, which is where prices live, and the chip-in amounts). Whatever else
 * the host has typed here and not yet saved (title, description, dates,
 * place, settings) is theirs and is kept; that copy is then owed a save, and
 * is returned so the caller can make it. A copy with nothing unsaved is
 * replaced whole.
 *
 * The usual `upsertServerDraft` refuses a server copy whose revision is lower
 * than this device's. A copy in the wrong currency must not win that way, so
 * the replacement is forced.
 */
import { fetchDraftById } from "./eventDrafts";
import { useDraftEventStore, type DraftEvent } from "../store/draftEventStore";
import { setDraftServerCurrency } from "../utils/draftServerCurrency";

/**
 * Returns the draft that is now owed a save (the host's unsaved text was
 * kept), or null when nothing is owed.
 */
export const replaceLocalDraftWithServer = (serverDraft: DraftEvent): DraftEvent | null => {
  const store = useDraftEventStore.getState();
  const local = store.getDraft(serverDraft.id);
  const hasUnsavedEdits = store.draftEditMeta[serverDraft.id]?.dirty === true;
  setDraftServerCurrency(serverDraft.id, serverDraft.currency);

  if (local === null || !hasUnsavedEdits) {
    if (!store.upsertServerDraft(serverDraft)) {
      const { id: _id, brandId: _brandId, createdAt: _createdAt, ...fields } = serverDraft;
      store.updateDraft(serverDraft.id, fields);
    }
    store.markDraftSaved(serverDraft.id, serverDraft.clientRevision ?? 0);
    return null;
  }

  // The host has unsaved edits: keep them, take only currency and money.
  const revision =
    Math.max(local.clientRevision ?? 0, serverDraft.clientRevision ?? 0) + 1;
  store.markDraftDirty(serverDraft.id, revision);
  store.updateDraft(serverDraft.id, {
    currency: serverDraft.currency,
    tickets: serverDraft.tickets,
    rsvpContributionSuggestedCents: serverDraft.rsvpContributionSuggestedCents,
    rsvpContributionMinCents: serverDraft.rsvpContributionMinCents,
    clientRevision: revision,
  });
  return useDraftEventStore.getState().getDraft(serverDraft.id);
};

/**
 * Read the draft from the server and put its currency and prices in place.
 * Returns the draft owed a save, or null.
 */
export const adoptServerDraftAfterSync = async (
  draftId: string,
): Promise<DraftEvent | null> => {
  const serverDraft = await fetchDraftById(draftId);
  return serverDraft === null ? null : replaceLocalDraftWithServer(serverDraft);
};
