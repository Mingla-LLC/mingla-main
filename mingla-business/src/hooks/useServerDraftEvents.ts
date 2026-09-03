import { useCallback, useEffect, useMemo, useState } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
  type UseQueryResult,
} from "@tanstack/react-query";

import {
  autosaveServerDraft,
  createServerDraft,
  discardServerDraft,
  fetchDraftById,
  fetchDraftsForBrand,
  isDraftRevisionConflictError,
  isServerDraftLifecycleError,
} from "../services/eventDrafts";
import {
  useDraftEventStore,
  type DraftEvent,
} from "../store/draftEventStore";
import type { LiveEvent } from "../store/liveEventStore";
import { useAuth } from "../context/AuthContext";
import {
  isBusinessAuthNotReadyError,
  requireBusinessAuthReady,
} from "../utils/authReadiness";
// ORCH-0893 cycle 2 [Eager server-draft on creator entry — replace with
// client-id + lazy autosave]: gate the legacy d_<ts36> migration loop on
// `isDraftDirty` so freshly-minted untouched drafts from /event/create
// are NOT auto-migrated out from under the edit route. The autosave
// wrapper at app/event/[id]/edit.tsx handles dirty d_* drafts via its
// own first-edit-triggered lazy insert.
import { isDraftDirty } from "../utils/draftDirtyCheck";
// Issue #976 [event-name-focus] — ALL d_*→server promotions route through the
// single-flight registry (one createServerDraft per d_* id, live-merge swap),
// and the loop never promotes the draft that is actively being edited.
import {
  isPromotionBackedOff,
  promoteLegacyDraftOnce,
  PromotionSourceMissingError,
} from "../utils/draftPromotion";

const STALE_TIME_MS = 30 * 1000;
const DISABLED_KEY = ["event-drafts-disabled"] as const;

const logMutationError = (label: string, error: Error): void => {
  console.error(`[${label}] Operation failed:`, error);
};

const isLocalOnlyDraftId = (draftId: string): boolean => draftId.startsWith("d_");

const removeDraftFromListCache = (
  queryClient: QueryClient,
  draft: DraftEvent,
): void => {
  queryClient.setQueryData<DraftEvent[]>(
    eventDraftKeys.list(draft.brandId),
    (prev) => (prev ?? []).filter((d) => d.id !== draft.id),
  );
};

export const eventDraftKeys = {
  all: ["event-drafts"] as const,
  lists: (): readonly ["event-drafts", "list"] =>
    [...eventDraftKeys.all, "list"] as const,
  list: (brandId: string): readonly ["event-drafts", "list", string] =>
    [...eventDraftKeys.lists(), brandId] as const,
  details: (): readonly ["event-drafts", "detail"] =>
    [...eventDraftKeys.all, "detail"] as const,
  detail: (draftId: string): readonly ["event-drafts", "detail", string] =>
    [...eventDraftKeys.details(), draftId] as const,
};

export const reconcilePublishedEventDrafts = (
  queryClient: QueryClient,
  brandId: string,
  authoritativeLiveEvents: readonly Pick<LiveEvent, "id">[],
  localDrafts: DraftEvent[],
  deleteDraft: (draftId: string) => void,
): string[] => {
  const liveEventIds = new Set(authoritativeLiveEvents.map((event) => event.id));
  const staleDraftIds: string[] = [];
  for (const draft of localDrafts) {
    if (
      draft.brandId === brandId &&
      !isLocalOnlyDraftId(draft.id) &&
      liveEventIds.has(draft.id)
    ) {
      staleDraftIds.push(draft.id);
    }
  }

  if (staleDraftIds.length === 0) return [];

  const staleIdSet = new Set(staleDraftIds);
  staleDraftIds.forEach((draftId) => {
    deleteDraft(draftId);
    queryClient.removeQueries({ queryKey: eventDraftKeys.detail(draftId) });
  });
  queryClient.setQueryData<DraftEvent[]>(
    eventDraftKeys.list(brandId),
    (previous) =>
      (previous ?? []).filter((draft) => !staleIdSet.has(draft.id)),
  );

  return staleDraftIds;
};

export const useReconcilePublishedEventDrafts = (
  brandId: string | null,
  authoritativeLiveEvents: LiveEvent[] | undefined,
): void => {
  const queryClient = useQueryClient();
  const localDrafts = useDraftEventStore((state) => state.drafts);
  const deleteDraft = useDraftEventStore((state) => state.deleteDraft);

  useEffect(() => {
    if (brandId === null || authoritativeLiveEvents === undefined) return;
    reconcilePublishedEventDrafts(
      queryClient,
      brandId,
      authoritativeLiveEvents,
      localDrafts,
      deleteDraft,
    );
  }, [authoritativeLiveEvents, brandId, deleteDraft, localDrafts, queryClient]);
};

export const useServerDraftsForBrand = (
  brandId: string | null,
): UseQueryResult<DraftEvent[]> => {
  const { isAuthReady } = useAuth();
  const enabled = brandId !== null && isAuthReady;
  const upsertServerDrafts = useDraftEventStore((s) => s.upsertServerDrafts);
  const localDrafts = useDraftEventStore((s) => s.drafts);
  // Issue #976 — the draft currently open in a creator wizard (beginDraftEdit /
  // markDraftDirty / endDraftEdit). Subscribed (not just getState-read) so the
  // migration effect re-runs the moment the wizard unmounts and the
  // abandoned-draft migration below is not deferred.
  const activeDraftId = useDraftEventStore((s) => s.activeDraftId);
  const queryClient = useQueryClient();

  const query = useQuery<DraftEvent[]>({
    queryKey: enabled && brandId !== null ? eventDraftKeys.list(brandId) : DISABLED_KEY,
    enabled,
    staleTime: STALE_TIME_MS,
    queryFn: async (): Promise<DraftEvent[]> => {
      if (!enabled || brandId === null) return [];
      return fetchDraftsForBrand(brandId);
    },
  });

  useEffect(() => {
    if (query.data !== undefined) {
      upsertServerDrafts(query.data);
    }
  }, [query.data, upsertServerDrafts]);

  useEffect(() => {
    if (!enabled || brandId === null || query.data === undefined) return;
    const migratedLegacyIds = new Set(
      query.data
        .map((draft) =>
          typeof draft.id === "string" && draft.id.startsWith("d_")
            ? draft.id
            : null,
        )
        .filter((id): id is string => id !== null),
    );
    const serverLegacyIds = new Set(
      query.data
        .map((draft) => {
          const legacy = (draft as DraftEvent & { legacyLocalDraftId?: string })
            .legacyLocalDraftId;
          return typeof legacy === "string" ? legacy : null;
        })
        .filter((id): id is string => id !== null),
    );
    localDrafts
      .filter(
        (draft) =>
          draft.brandId === brandId &&
          draft.id.startsWith("d_") &&
          // ORCH-0893 cycle 2: skip untouched d_* drafts. /event/create
          // mints a fresh d_<ts36> synchronously then router.replace's to
          // /event/[id]/edit; if the legacy loop migrates it before the
          // user types anything, replaceDraft removes d_* from Zustand
          // and the edit route's bounce-home guard fires ("wizard shows
          // up then immediately closes"). The autosave wrapper at
          // app/event/[id]/edit.tsx handles dirty d_* drafts via its
          // own first-edit-triggered createServerDraft path.
          isDraftDirty(draft) &&
          // Issue #976 [event-name-focus] — NEVER promote the draft that is
          // actively being edited (I-PROPOSED-0976-NO-BACKGROUND-PROMOTION-OF-
          // ACTIVE-DRAFT). This effect depends on `drafts`, so it re-ran on the
          // FIRST dirty keystroke of a create session and promoted the d_*
          // draft from list-hook instances mounted behind the wizard —
          // swapping a stale first-keystroke snapshot under the focused name
          // input (keyboard drop + typed-text loss + duplicate rows, proven on
          // the physical Samsung). The loop's legitimate job — migrating
          // ABANDONED dirty local drafts — is preserved: endDraftEdit clears
          // activeDraftId on wizard unmount and this draft becomes eligible.
          draft.id !== activeDraftId,
      )
      .forEach((draft) => {
        if (
          migratedLegacyIds.has(draft.id) ||
          serverLegacyIds.has(draft.id)
        ) {
          return;
        }
        // Issue #976 — fire-time re-checks against stale closures: skip while
        // the registry is backing off a recent failure (this effect re-runs
        // per keystroke — no offline request spam), and re-read activeDraftId
        // from the store in case a wizard mounted since this effect ran.
        if (
          isPromotionBackedOff(draft.id) ||
          useDraftEventStore.getState().activeDraftId === draft.id
        ) {
          return;
        }
        void promoteLegacyDraftOnce({ queryClient, brandId, draftId: draft.id })
          .catch((error) => {
            if (isBusinessAuthNotReadyError(error)) return;
            if (error instanceof PromotionSourceMissingError) return;
            if (__DEV__) {
              console.error("[eventDrafts] legacy migration failed", error);
            }
          });
      });
  }, [activeDraftId, brandId, enabled, localDrafts, query.data, queryClient]);

  return query;
};

export const useServerDraftById = (
  draftId: string | null,
): UseQueryResult<DraftEvent | null> => {
  const { isAuthReady } = useAuth();
  const enabled = draftId !== null && isAuthReady;
  const upsertServerDraft = useDraftEventStore((s) => s.upsertServerDraft);
  const query = useQuery<DraftEvent | null>({
    queryKey:
      enabled && draftId !== null ? eventDraftKeys.detail(draftId) : DISABLED_KEY,
    enabled,
    staleTime: STALE_TIME_MS,
    queryFn: async (): Promise<DraftEvent | null> => {
      if (!enabled || draftId === null) return null;
      return fetchDraftById(draftId);
    },
  });

  useEffect(() => {
    if (query.data !== undefined && query.data !== null) {
      upsertServerDraft(query.data);
    }
  }, [query.data, upsertServerDraft]);

  return query;
};

export interface ServerDraftAutosaveState {
  saveDraft: (draft: DraftEvent) => void;
  saveDraftAsync: (draft: DraftEvent) => Promise<DraftEvent>;
  isSaving: boolean;
  hasError: boolean;
  lastSavedAt: string | null;
}

export const useServerDraftAutosave = (): ServerDraftAutosaveState => {
  const { authStatus, isAuthReady, session } = useAuth();
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const upsertServerDraft = useDraftEventStore((s) => s.upsertServerDraft);
  const deleteDraft = useDraftEventStore((s) => s.deleteDraft);
  const markDraftSaved = useDraftEventStore((s) => s.markDraftSaved);
  const mutation = useMutation<DraftEvent, Error, DraftEvent>({
    mutationFn: async (draft) => {
      requireBusinessAuthReady(authStatus, session);
      return autosaveServerDraft(draft);
    },
    onSuccess: (draft) => {
      const accepted = upsertServerDraft(draft);
      if (!accepted) return;
      const revision = draft.clientRevision ?? 0;
      markDraftSaved(draft.id, revision);
      queryClient.setQueryData(eventDraftKeys.detail(draft.id), draft);
      queryClient.setQueryData<DraftEvent[]>(
        eventDraftKeys.list(draft.brandId),
        (prev) => {
          const next = (prev ?? []).filter((d) => d.id !== draft.id);
          return [draft, ...next];
        },
      );
      setLastSavedAt(new Date().toISOString());
    },
    onError: (error, draft) => {
      // Issue #3065 — a revision conflict is a RECONCILE, not a failure. The
      // service has already pulled the authoritative server draft; adopting it
      // moves the store (and the wizard's monotonic clientRevisionRef) onto the
      // server's revision so the NEXT edit saves. Before this, the counters
      // could never reconverge: the losing revision was resent forever, which
      // is how one wedged device put 3,400+ failing statements a minute into
      // production. Deliberately NOT routed through logMutationError — there is
      // nothing for the user to do and nothing broken once we have resynced.
      if (isDraftRevisionConflictError(error)) {
        const serverDraft = error.serverDraft;
        if (serverDraft !== null) {
          upsertServerDraft(serverDraft);
          queryClient.setQueryData(
            eventDraftKeys.detail(serverDraft.id),
            serverDraft,
          );
        }
        if (__DEV__) {
          console.info("[useServerDraftAutosave] Revision resynced:", {
            draftId: error.draftId,
            serverRevision: serverDraft?.clientRevision ?? null,
            attemptedRevision: draft.clientRevision ?? 0,
          });
        }
        return;
      }
      if (isServerDraftLifecycleError(error)) {
        if (!isLocalOnlyDraftId(draft.id)) {
          deleteDraft(draft.id);
          queryClient.removeQueries({ queryKey: eventDraftKeys.detail(draft.id) });
          removeDraftFromListCache(queryClient, draft);
          queryClient.invalidateQueries({ queryKey: eventDraftKeys.list(draft.brandId) });
        }
        if (__DEV__) {
          console.info("[useServerDraftAutosave] Draft retired:", {
            code: error.code,
            draftId: error.draftId,
          });
        }
        return;
      }
      if (isBusinessAuthNotReadyError(error)) {
        if (__DEV__) {
          console.info("[useServerDraftAutosave] Deferred until auth ready:", {
            code: error.code,
            authStatus: error.authStatus,
          });
        }
        return;
      }
      logMutationError("useServerDraftAutosave", error);
    },
  });

  const saveDraft = useCallback(
    (draft: DraftEvent): void => {
      if (!isAuthReady) {
        if (__DEV__) {
          console.info("[useServerDraftAutosave] draft-save-deferred", {
            authStatus,
            draftId: draft.id,
          });
        }
        return;
      }
      mutation.mutate(draft);
    },
    [authStatus, isAuthReady, mutation],
  );

  return useMemo(
    () => ({
      saveDraft,
      saveDraftAsync: mutation.mutateAsync,
      isSaving: mutation.isPending,
      hasError:
        mutation.isError &&
        !isDraftRevisionConflictError(mutation.error) &&
        !isServerDraftLifecycleError(mutation.error) &&
        !isBusinessAuthNotReadyError(mutation.error),
      lastSavedAt,
    }),
    [
      lastSavedAt,
      mutation.error,
      mutation.isError,
      mutation.isPending,
      mutation.mutateAsync,
      saveDraft,
    ],
  );
};

export const useCreateServerDraft = (): {
  createDraft: (brandId: string) => Promise<DraftEvent>;
  isPending: boolean;
  error: Error | null;
} => {
  const { authStatus, session } = useAuth();
  const queryClient = useQueryClient();
  const upsertDraft = useDraftEventStore((s) => s.upsertDraft);
  const mutation = useMutation<DraftEvent, Error, string>({
    mutationFn: (brandId) => {
      requireBusinessAuthReady(authStatus, session);
      // orch-strict-grep-allow single-promotion-owner — useCreateServerDraft mints a FRESH server draft (no d_* source argument); it is not a d_*→server promotion, so the issue #976 registry does not own it.
      return createServerDraft(brandId);
    },
    onSuccess: (draft) => {
      upsertDraft(draft);
      queryClient.setQueryData(eventDraftKeys.detail(draft.id), draft);
      queryClient.invalidateQueries({ queryKey: eventDraftKeys.list(draft.brandId) });
    },
    onError: (error) => {
      if (isBusinessAuthNotReadyError(error)) {
        if (__DEV__) {
          console.info("[useCreateServerDraft] draft-create-auth-not-ready", {
            authStatus: error.authStatus,
            code: error.code,
          });
        }
        return;
      }
      logMutationError("useCreateServerDraft", error);
    },
  });

  return {
    createDraft: mutation.mutateAsync,
    isPending: mutation.isPending,
    error: mutation.error,
  };
};

export const useDiscardServerDraft = (): {
  discardDraft: (draft: DraftEvent) => Promise<void>;
  isPending: boolean;
  error: Error | null;
} => {
  const queryClient = useQueryClient();
  const deleteDraft = useDraftEventStore((s) => s.deleteDraft);
  const mutation = useMutation<void, Error, DraftEvent>({
    mutationFn: async (draft) => {
      try {
        await discardServerDraft(draft.id);
      } catch (error) {
        if (isServerDraftLifecycleError(error)) return;
        throw error;
      }
    },
    onSuccess: (_void, draft) => {
      deleteDraft(draft.id);
      queryClient.removeQueries({ queryKey: eventDraftKeys.detail(draft.id) });
      removeDraftFromListCache(queryClient, draft);
      queryClient.invalidateQueries({ queryKey: eventDraftKeys.list(draft.brandId) });
    },
    onError: (error) => {
      logMutationError("useDiscardServerDraft", error);
    },
  });

  return {
    discardDraft: mutation.mutateAsync,
    isPending: mutation.isPending,
    error: mutation.error,
  };
};
