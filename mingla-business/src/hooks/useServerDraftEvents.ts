import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  isServerDraftLifecycleError,
} from "../services/eventDrafts";
import {
  useDraftEventStore,
  type DraftEvent,
} from "../store/draftEventStore";
import { useAuth } from "../context/AuthContext";
import {
  isBusinessAuthNotReadyError,
  requireBusinessAuthReady,
} from "../utils/authReadiness";

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

export const useServerDraftsForBrand = (
  brandId: string | null,
): UseQueryResult<DraftEvent[]> => {
  const { isAuthReady } = useAuth();
  const enabled = brandId !== null && isAuthReady;
  const upsertServerDrafts = useDraftEventStore((s) => s.upsertServerDrafts);
  const replaceDraft = useDraftEventStore((s) => s.replaceDraft);
  const localDrafts = useDraftEventStore((s) => s.drafts);
  const queryClient = useQueryClient();
  const migratingIdsRef = useRef<Set<string>>(new Set());

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
      .filter((draft) => draft.brandId === brandId && draft.id.startsWith("d_"))
      .forEach((draft) => {
        if (
          migratedLegacyIds.has(draft.id) ||
          serverLegacyIds.has(draft.id) ||
          migratingIdsRef.current.has(draft.id)
        ) {
          return;
        }
        migratingIdsRef.current.add(draft.id);
        void createServerDraft(brandId, draft)
          .then((serverDraft) => {
            replaceDraft(draft.id, serverDraft);
            queryClient.setQueryData<DraftEvent[]>(
              eventDraftKeys.list(brandId),
              (prev) => {
                const next = (prev ?? []).filter((d) => d.id !== serverDraft.id);
                return [serverDraft, ...next];
              },
            );
            queryClient.setQueryData(
              eventDraftKeys.detail(serverDraft.id),
              serverDraft,
            );
          })
          .catch((error) => {
            if (isBusinessAuthNotReadyError(error)) return;
            if (__DEV__) {
              console.error("[eventDrafts] legacy migration failed", error);
            }
          })
          .finally(() => {
            migratingIdsRef.current.delete(draft.id);
          });
      });
  }, [brandId, enabled, localDrafts, query.data, queryClient, replaceDraft]);

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
