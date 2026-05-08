import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from "@tanstack/react-query";

import {
  autosaveServerDraft,
  createServerDraft,
  discardServerDraft,
  fetchDraftById,
  fetchDraftsForBrand,
  markServerDraftPublished,
} from "../services/eventDrafts";
import {
  useDraftEventStore,
  type DraftEvent,
} from "../store/draftEventStore";

const STALE_TIME_MS = 30 * 1000;
const DISABLED_KEY = ["event-drafts-disabled"] as const;

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
  const enabled = brandId !== null;
  const upsertDrafts = useDraftEventStore((s) => s.upsertDrafts);
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
      upsertDrafts(query.data);
    }
  }, [query.data, upsertDrafts]);

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
  const enabled = draftId !== null;
  const upsertDraft = useDraftEventStore((s) => s.upsertDraft);
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
      upsertDraft(query.data);
    }
  }, [query.data, upsertDraft]);

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
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const upsertDraft = useDraftEventStore((s) => s.upsertDraft);
  const mutation = useMutation<DraftEvent, Error, DraftEvent>({
    mutationFn: autosaveServerDraft,
    onSuccess: (draft) => {
      upsertDraft(draft);
      queryClient.setQueryData(eventDraftKeys.detail(draft.id), draft);
      queryClient.invalidateQueries({ queryKey: eventDraftKeys.list(draft.brandId) });
      setLastSavedAt(new Date().toISOString());
    },
  });

  const saveDraft = useCallback(
    (draft: DraftEvent): void => {
      mutation.mutate(draft);
    },
    [mutation],
  );

  return useMemo(
    () => ({
      saveDraft,
      saveDraftAsync: mutation.mutateAsync,
      isSaving: mutation.isPending,
      hasError: mutation.isError,
      lastSavedAt,
    }),
    [
      lastSavedAt,
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
  const queryClient = useQueryClient();
  const upsertDraft = useDraftEventStore((s) => s.upsertDraft);
  const mutation = useMutation<DraftEvent, Error, string>({
    mutationFn: (brandId) => createServerDraft(brandId),
    onSuccess: (draft) => {
      upsertDraft(draft);
      queryClient.setQueryData(eventDraftKeys.detail(draft.id), draft);
      queryClient.invalidateQueries({ queryKey: eventDraftKeys.list(draft.brandId) });
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
} => {
  const queryClient = useQueryClient();
  const deleteDraft = useDraftEventStore((s) => s.deleteDraft);
  const mutation = useMutation<void, Error, DraftEvent>({
    mutationFn: (draft) => discardServerDraft(draft.id),
    onSuccess: (_void, draft) => {
      deleteDraft(draft.id);
      queryClient.removeQueries({ queryKey: eventDraftKeys.detail(draft.id) });
      queryClient.invalidateQueries({ queryKey: eventDraftKeys.list(draft.brandId) });
    },
  });

  return {
    discardDraft: mutation.mutateAsync,
    isPending: mutation.isPending,
  };
};

export const useMarkServerDraftPublished = (): {
  markPublished: (draft: DraftEvent) => Promise<void>;
  isPending: boolean;
} => {
  const queryClient = useQueryClient();
  const mutation = useMutation<void, Error, DraftEvent>({
    mutationFn: markServerDraftPublished,
    onSuccess: (_void, draft) => {
      queryClient.removeQueries({ queryKey: eventDraftKeys.detail(draft.id) });
      queryClient.invalidateQueries({ queryKey: eventDraftKeys.list(draft.brandId) });
    },
  });

  return {
    markPublished: mutation.mutateAsync,
    isPending: mutation.isPending,
  };
};
