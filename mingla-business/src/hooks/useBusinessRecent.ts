import { useCallback, useEffect, useMemo, useRef } from "react";
import { useFocusEffect } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { useAuth } from "../context/AuthContext";
import { useNetInfoSafe } from "../lib/netinfoSafe";
import { postHogService } from "../services/postHogService";
import {
  businessRecentKeys,
  hydrateBusinessRecent,
  listBusinessRecentIndex,
  newRecentOperationId,
  recentErrorCategory,
  recordBusinessRecentOpen,
  type BusinessRecentIndexRow,
} from "../services/businessRecentService";
import {
  mergeRecentPointers,
  recentScopeKey,
  useBusinessRecentStore,
  type BusinessRecentEntityType,
  type BusinessRecentPointer,
} from "../store/businessRecentStore";

export type BusinessRecentStateKind =
  | "loading"
  | "refreshing"
  | "populated"
  | "empty"
  | "offline-empty"
  | "offline-cached"
  | "error-empty"
  | "error-cached"
  | "permission"
  | "omitted";

const isLiveIndex = (row: BusinessRecentIndexRow, nowMs: number): boolean => {
  if (row.entityType === "venue") return row.lifecycleStatus === "verified";
  if (row.lifecycleStatus === "cancelled" || row.lifecycleStatus === "ended")
    return false;
  const start = row.startsAt === null ? Number.NaN : Date.parse(row.startsAt);
  const end = row.endsAt === null ? Number.NaN : Date.parse(row.endsAt);
  if (row.entityType === "trip") {
    if (Number.isFinite(end) && nowMs > end) return false;
    if (Number.isFinite(start)) return nowMs >= start;
    return row.lifecycleStatus === "live";
  }
  if (!Number.isFinite(start)) return row.lifecycleStatus === "live";
  return (
    nowMs >= start - 4 * 60 * 60 * 1000 && nowMs < start + 24 * 60 * 60 * 1000
  );
};

const orderIndex = (
  rows: BusinessRecentIndexRow[],
): BusinessRecentIndexRow[] => {
  const now = Date.now();
  return [...rows].sort((a, b) => {
    const liveDelta = Number(isLiveIndex(b, now)) - Number(isLiveIndex(a, now));
    if (liveDelta !== 0) return liveDelta;
    const openedDelta = Date.parse(b.lastOpenedAt) - Date.parse(a.lastOpenedAt);
    return openedDelta !== 0
      ? openedDelta
      : b.pointerId.localeCompare(a.pointerId);
  });
};

const withIndexLifecycle = (
  pointer: BusinessRecentPointer,
  index: BusinessRecentIndexRow,
): BusinessRecentPointer => ({
  ...pointer,
  status: index.lifecycleStatus,
  startsAt: index.startsAt,
  endsAt: index.endsAt,
});

export function useBusinessRecent(input: {
  brandId: string | null;
  pageCount?: number;
}): {
  rows: BusinessRecentPointer[];
  total: number;
  state: BusinessRecentStateKind;
  isRefreshing: boolean;
  hasMore: boolean;
  retry: () => Promise<void>;
  refresh: () => Promise<void>;
} {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const network = useNetInfoSafe();
  const isOffline = network?.isConnected === false;
  const pageCount = Math.max(1, Math.min(8, input.pageCount ?? 1));
  const userId = user?.id ?? null;
  const scope =
    userId !== null && input.brandId !== null
      ? recentScopeKey(userId, input.brandId)
      : null;
  const cached = useBusinessRecentStore((state) =>
    scope === null ? [] : (state.scopes[scope] ?? []),
  );
  const replaceScope = useBusinessRecentStore((state) => state.replaceScope);
  const remove = useBusinessRecentStore((state) => state.remove);
  const upsert = useBusinessRecentStore((state) => state.upsert);
  const clearScope = useBusinessRecentStore((state) => state.clearScope);
  const hasHydrated = useBusinessRecentStore((state) => state.hasHydrated);
  const activeScopeRef = useRef(scope);
  const flushingScopeRef = useRef<string | null>(null);
  activeScopeRef.current = scope;

  const query = useQuery({
    queryKey:
      userId !== null && input.brandId !== null
        ? businessRecentKeys.scope(userId, input.brandId)
        : businessRecentKeys.all,
    enabled: userId !== null && input.brandId !== null && !isOffline,
    staleTime: 30_000,
    queryFn: async (): Promise<{
      rows: BusinessRecentPointer[];
      total: number;
      omitted: number;
    }> => {
      if (input.brandId === null || scope === null) {
        return { rows: [], total: 0, omitted: 0 };
      }
      const ordered = orderIndex(await listBusinessRecentIndex(input.brandId));
      const wanted = ordered.slice(0, pageCount * 25);
      const hydrated: BusinessRecentPointer[] = [];
      let omitted = 0;
      for (let offset = 0; offset < wanted.length; offset += 25) {
        const page = wanted.slice(offset, offset + 25);
        const result = await hydrateBusinessRecent(
          input.brandId,
          page.map((row) => ({
            entityType: row.entityType,
            entityId: row.entityId,
          })),
        );
        omitted += result.omitted.length;
        const indexByKey = new Map(
          page.map((row) => [`${row.entityType}:${row.entityId}`, row]),
        );
        hydrated.push(
          ...result.pointers.map((pointer) => {
            const index = indexByKey.get(
              `${pointer.entityType}:${pointer.entityId}`,
            );
            return index === undefined
              ? pointer
              : withIndexLifecycle(pointer, index);
          }),
        );
        for (const omittedPointer of result.omitted) {
          remove(scope, omittedPointer.entityType, omittedPointer.entityId);
        }
      }
      const pending = cached.filter(
        (pointer) => pointer.pendingSync || pointer.localDraft,
      );
      const merged = mergeRecentPointers(hydrated, pending);
      replaceScope(scope, merged);
      postHogService.capture("business_recent_page_loaded", {
        source: pageCount === 1 ? "home" : "recent",
        count_bucket:
          merged.length > 25
            ? "26_plus"
            : merged.length > 10
              ? "11_25"
              : "0_10",
        cache: cached.length > 0,
        offline: false,
        surface: "business",
      });
      return { rows: merged, total: ordered.length, omitted };
    },
  });
  const refetch = query.refetch;

  useFocusEffect(
    useCallback(() => {
      if (userId !== null && input.brandId !== null && !isOffline) {
        void refetch();
      }
    }, [input.brandId, isOffline, refetch, userId]),
  );

  const rows = query.data?.rows ?? cached;
  const errorKind =
    query.error === null ? null : recentErrorCategory(query.error);

  useEffect(() => {
    if (scope !== null && errorKind === "permission") clearScope(scope);
  }, [clearScope, errorKind, scope]);

  useEffect(() => {
    if (
      scope === null ||
      userId === null ||
      input.brandId === null ||
      isOffline ||
      flushingScopeRef.current === scope
    ) {
      return;
    }
    const pending = cached.filter(
      (pointer) => pointer.pendingSync && !pointer.localDraft,
    );
    if (pending.length === 0) return;
    flushingScopeRef.current = scope;
    void (async (): Promise<void> => {
      let permissionDenied = false;
      for (const pointer of pending) {
        try {
          const result = await recordBusinessRecentOpen({
            brandId: input.brandId as string,
            entityType: pointer.entityType,
            entityId: pointer.entityId,
            openedAt: pointer.lastOpenedAt,
            operationId: pointer.operationId,
          });
          if (activeScopeRef.current !== scope) return;
          if (!result.retained) {
            remove(scope, pointer.entityType, pointer.entityId);
            continue;
          }
          upsert(scope, {
            ...pointer,
            lastOpenedAt: result.acceptedOpenedAt,
            pendingSync: false,
          });
        } catch (error: unknown) {
          if (recentErrorCategory(error) === "permission") {
            permissionDenied = true;
            if (activeScopeRef.current === scope) clearScope(scope);
            break;
          }
        }
      }
      if (!permissionDenied && activeScopeRef.current === scope) {
        await queryClient.invalidateQueries({
          queryKey: businessRecentKeys.scope(userId, input.brandId as string),
        });
      }
    })().finally(() => {
      if (flushingScopeRef.current === scope) flushingScopeRef.current = null;
    });
  }, [
    cached,
    clearScope,
    input.brandId,
    isOffline,
    queryClient,
    remove,
    scope,
    upsert,
    userId,
  ]);

  const state: BusinessRecentStateKind = useMemo(() => {
    if (errorKind === "permission") return "permission";
    if (isOffline) return rows.length > 0 ? "offline-cached" : "offline-empty";
    if ((query.isLoading || !hasHydrated) && rows.length === 0)
      return "loading";
    if (query.isError) return rows.length > 0 ? "error-cached" : "error-empty";
    if ((query.data?.omitted ?? 0) > 0 && rows.length === 0) return "omitted";
    if (rows.length === 0) return "empty";
    if (query.isFetching) return "refreshing";
    return "populated";
  }, [
    errorKind,
    hasHydrated,
    isOffline,
    query.data?.omitted,
    query.isError,
    query.isFetching,
    query.isLoading,
    rows.length,
  ]);

  const refresh = useCallback(async (): Promise<void> => {
    if (userId === null || input.brandId === null || isOffline) return;
    await queryClient.invalidateQueries({
      queryKey: businessRecentKeys.scope(userId, input.brandId),
    });
  }, [input.brandId, isOffline, queryClient, userId]);

  return {
    rows,
    total: query.data?.total ?? rows.length,
    state,
    isRefreshing: query.isFetching,
    hasMore: (query.data?.total ?? 0) > pageCount * 25,
    retry: refresh,
    refresh,
  };
}

export function useSuccessfulBusinessRecentOpen(input: {
  brandId: string | null;
  entityType: BusinessRecentEntityType;
  entityId: string | null;
  ready: boolean;
  title?: string;
  coverUrl?: string | null;
  coverPosterUrl?: string | null;
  coverType?: "image" | "video" | "gif" | null;
  status?: string | null;
}): void {
  const { user } = useAuth();
  const network = useNetInfoSafe();
  const queryClient = useQueryClient();
  const upsert = useBusinessRecentStore((state) => state.upsert);
  const remove = useBusinessRecentStore((state) => state.remove);
  const clearScope = useBusinessRecentStore((state) => state.clearScope);
  const operationRef = useRef<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      operationRef.current = null;
      if (
        !input.ready ||
        input.brandId === null ||
        input.entityId === null ||
        user === null
      ) {
        return undefined;
      }
      const operationId = newRecentOperationId();
      operationRef.current = operationId;
      const openedAt = new Date().toISOString();
      const scope = recentScopeKey(user.id, input.brandId);
      const localDraft = input.entityId.startsWith("d_");
      upsert(scope, {
        entityType: input.entityType,
        entityId: input.entityId,
        lastOpenedAt: openedAt,
        operationId,
        title: input.title,
        coverUrl: input.coverUrl,
        coverPosterUrl: input.coverPosterUrl,
        coverType: input.coverType,
        status: input.status,
        pendingSync: !localDraft,
        localDraft,
      });
      if (!localDraft && network?.isConnected !== false) {
        void recordBusinessRecentOpen({
          brandId: input.brandId,
          entityType: input.entityType,
          entityId: input.entityId,
          openedAt,
          operationId,
        })
          .then((result) => {
            if (operationRef.current !== operationId) return;
            if (!result.retained) {
              remove(scope, input.entityType, input.entityId as string);
              return;
            }
            upsert(scope, {
              entityType: input.entityType,
              entityId: input.entityId as string,
              lastOpenedAt: result.acceptedOpenedAt,
              operationId,
              title: input.title,
              coverUrl: input.coverUrl,
              coverPosterUrl: input.coverPosterUrl,
              coverType: input.coverType,
              status: input.status,
              pendingSync: false,
              localDraft: false,
            });
            void queryClient.invalidateQueries({
              queryKey: businessRecentKeys.scope(
                user.id,
                input.brandId as string,
              ),
            });
          })
          .catch((error: unknown) => {
            if (recentErrorCategory(error) === "permission") clearScope(scope);
            postHogService.capture("business_recent_record_failed", {
              entity_type: input.entityType,
              source: "detail",
              error_category: recentErrorCategory(error),
              offline: network?.isConnected === false,
              surface: "business",
            });
            console.warn(
              "[Recent] successful-open sync deferred:",
              recentErrorCategory(error),
            );
          });
      }
      return () => {
        operationRef.current = null;
      };
    }, [
      clearScope,
      input.brandId,
      input.coverPosterUrl,
      input.coverType,
      input.coverUrl,
      input.entityId,
      input.entityType,
      input.ready,
      input.status,
      input.title,
      network?.isConnected,
      queryClient,
      remove,
      upsert,
      user,
    ]),
  );

  useEffect(() => {
    if (user === null) operationRef.current = null;
  }, [user]);
}

export function promoteBusinessRecentDraft(input: {
  userId: string;
  brandId: string;
  entityType: BusinessRecentEntityType;
  localId: string;
  serverId: string;
}): void {
  useBusinessRecentStore
    .getState()
    .promoteDraft(
      recentScopeKey(input.userId, input.brandId),
      input.entityType,
      input.localId,
      input.serverId,
      newRecentOperationId(),
    );
}

export function discardBusinessRecentDraft(input: {
  userId: string;
  brandId: string;
  entityType: BusinessRecentEntityType;
  localId: string;
}): void {
  useBusinessRecentStore
    .getState()
    .remove(
      recentScopeKey(input.userId, input.brandId),
      input.entityType,
      input.localId,
    );
}
