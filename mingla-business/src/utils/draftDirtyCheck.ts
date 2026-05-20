/**
 * draftDirtyCheck — ORCH-0893 [Eager server-draft on creator entry — replace with client-id + lazy autosave].
 *
 * `isDraftDirty` returns true when a DraftEvent has any user-meaningful
 * deviation from the cold-default produced by `buildDraftEvent(brandId)`.
 * Used by the event edit route to gate the lazy server-insert: client-only
 * `d_<ts36>` drafts that have not yet been touched produce no server row,
 * preventing ghost-draft accumulation in `events`.
 *
 * Pure function. No network. No side effects.
 *
 * Field names verified against `mingla-business/src/store/draftEventStore.ts`
 * DEFAULT_DRAFT_FIELDS + DraftEvent shape (post-ORCH-0824 + ORCH-0841 +
 * ORCH-0877 endsAtUtc).
 */

import type { DraftEvent } from "../store/draftEventStore";

export const isDraftDirty = (draft: DraftEvent): boolean => {
  if (draft.name.trim().length > 0) return true;
  if (draft.description.trim().length > 0) return true;
  if (draft.coverMediaUrl !== null) return true;
  if (draft.tickets.length > 0) return true;
  if (draft.date !== null && draft.date.length > 0) return true;
  if (draft.doorsOpen !== null && draft.doorsOpen.length > 0) return true;
  if (draft.endsAt !== null && draft.endsAt.length > 0) return true;
  if (draft.venueName !== null && draft.venueName.trim().length > 0) return true;
  if (draft.address !== null && draft.address.trim().length > 0) return true;
  if (draft.onlineUrl !== null && draft.onlineUrl.length > 0) return true;
  if (draft.lastStepReached > 0) return true;
  if (Array.isArray(draft.partyTypes) && draft.partyTypes.length > 0) return true;
  if (Array.isArray(draft.vibeTags) && draft.vibeTags.length > 0) return true;
  if (Array.isArray(draft.musicGenres) && draft.musicGenres.length > 0) return true;
  if (draft.format !== "in_person") return true;
  return false;
};
