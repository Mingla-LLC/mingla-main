// ORCH-1123 [Hub multi-select draft delete] — batch delete-dispatch hook.
//
// ONE owner of the bulk-delete dispatch (one-owner-per-truth). It (a) calls the
// batch RPC for server-backed ids, (b) applies kind-specific cache invalidation,
// and (c) returns the per-row tally for the caller to toast. Kind-aware because
// the cache keys differ per tab, but it is the single owner of the dispatch.
//
// EVENTS partition trap (Q4): local-only draft ids (d_* / serverSlug===null) are
// deleted from Zustand ONLY (never sent to the RPC — they'd 404); server ids go
// through the RPC + Zustand removal + RQ invalidate. Trips/experiences pass only
// serverEventIds.

import {
  useMutation,
  useQueryClient,
  type UseMutationResult,
} from "@tanstack/react-query";

import {
  discardOfferingDrafts,
  type DraftDiscardRow,
} from "../services/offeringDrafts";
import { eventDraftKeys } from "./useServerDraftEvents";
import { tripKeys } from "./useTrips";
import { experienceKeys } from "./useExperiencesByBrand";
import { brandKeys } from "./useBrands";
import { useDraftEventStore } from "../store/draftEventStore";

export type OfferingKind = "event" | "trip" | "experience";

export interface DiscardOfferingDraftsInput {
  kind: OfferingKind;
  brandId: string;
  /** Server-backed draft ids to discard via the RPC. */
  serverEventIds: string[];
  /**
   * EVENTS ONLY: local-only draft ids (d_* / serverSlug===null) to delete
   * from the Zustand store WITHOUT calling the RPC. Empty for trips/experiences.
   */
  localOnlyDraftIds?: string[];
}

export interface DiscardOfferingDraftsResult {
  rows: DraftDiscardRow[]; // server outcomes
  localDeletedCount: number; // events local-only deletions
}

export const useDiscardOfferingDrafts = (): UseMutationResult<
  DiscardOfferingDraftsResult,
  Error,
  DiscardOfferingDraftsInput
> => {
  const queryClient = useQueryClient();
  const deleteLocalDraft = useDraftEventStore((s) => s.deleteDraft);

  return useMutation<
    DiscardOfferingDraftsResult,
    Error,
    DiscardOfferingDraftsInput
  >({
    mutationFn: async ({ serverEventIds, localOnlyDraftIds }) => {
      const rows = await discardOfferingDrafts(serverEventIds);
      return { rows, localDeletedCount: (localOnlyDraftIds ?? []).length };
    },
    onSuccess: (result, { kind, brandId, localOnlyDraftIds }) => {
      const deletedServerIds = new Set(
        result.rows
          .filter((r) => r.outcome === "deleted")
          .map((r) => r.eventId),
      );

      // EVENTS: also remove local-only ids from Zustand (no RPC was called for
      // them) AND remove server-deleted ids from Zustand (single path does both).
      if (kind === "event") {
        for (const id of localOnlyDraftIds ?? []) deleteLocalDraft(id);
        for (const id of deletedServerIds) deleteLocalDraft(id);
        // optimistic list-cache prune (mirror removeDraftFromListCache)
        queryClient.setQueryData<unknown[]>(
          eventDraftKeys.list(brandId),
          (prev) =>
            ((prev as Array<{ id: string }> | undefined) ?? []).filter(
              (d) => !deletedServerIds.has(d.id),
            ),
        );
        for (const id of deletedServerIds)
          queryClient.removeQueries({ queryKey: eventDraftKeys.detail(id) });
        queryClient.invalidateQueries({
          queryKey: eventDraftKeys.list(brandId),
        });
      }

      if (kind === "trip") {
        for (const id of deletedServerIds)
          queryClient.removeQueries({ queryKey: tripKeys.detail(id) });
        queryClient.invalidateQueries({
          queryKey: tripKeys.listByBrand(brandId),
        });
      }

      if (kind === "experience") {
        queryClient.invalidateQueries({
          queryKey: experienceKeys.listByBrand(brandId),
        });
      }

      // ALL kinds: refresh offering counts (universal empty-state + Hub To-Do).
      queryClient.invalidateQueries({
        queryKey: brandKeys.offeringCounts(brandId),
      });
    },
  });
};
