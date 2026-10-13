/**
 * Issue #3645 — put the SERVER's copy of a draft in place of this device's.
 *
 * Used when this device's copy is in a currency the server row is not in and
 * the server did NOT clear the draft's prices (someone re-priced it elsewhere),
 * and after `biz_sync_draft_currency` moved a draft. In both cases the numbers
 * on this device were typed in another currency: they are neither kept nor
 * "cleared" here, the server's copy simply replaces them.
 *
 * The usual `upsertServerDraft` refuses a server copy whose revision is lower
 * than this device's. A copy in the wrong currency must not win that way, so
 * the replacement is forced.
 */
import { fetchDraftById } from "./eventDrafts";
import { useDraftEventStore, type DraftEvent } from "../store/draftEventStore";
import { setDraftServerCurrency } from "../utils/draftServerCurrency";

export const replaceLocalDraftWithServer = (serverDraft: DraftEvent): void => {
  const store = useDraftEventStore.getState();
  if (!store.upsertServerDraft(serverDraft)) {
    const { id: _id, brandId: _brandId, createdAt: _createdAt, ...fields } = serverDraft;
    store.updateDraft(serverDraft.id, fields);
  }
  store.markDraftSaved(serverDraft.id, serverDraft.clientRevision ?? 0);
  setDraftServerCurrency(serverDraft.id, serverDraft.currency);
};

/** Read the draft from the server and put that copy in place. */
export const adoptServerDraftAfterSync = async (draftId: string): Promise<void> => {
  const serverDraft = await fetchDraftById(draftId);
  if (serverDraft !== null) replaceLocalDraftWithServer(serverDraft);
};
