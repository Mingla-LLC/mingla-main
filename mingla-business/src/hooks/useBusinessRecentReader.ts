import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppState, type AppStateStatus } from "react-native";
import { useFocusEffect } from "expo-router";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";

import { useAuth } from "../context/AuthContext";
import { useNetInfoSafe } from "../lib/netinfoSafe";
import {
  isRecentOfflineConfirmed,
  recentOfflineHint,
} from "../utils/recentOfflineConfirmation";
import {
  businessRecentKeys,
  clearBusinessRecentCachedScope,
  hydrateBusinessRecent,
  listBusinessRecentIndex,
  loadBusinessRecentCache,
  orderBusinessRecentIndex,
  orderBusinessRecentPointers,
  recentErrorCategory,
  recordBusinessRecentOpen,
  retainAuthoritativeBusinessRecentPointers,
  removeBusinessRecentPresentationCache,
  saveBusinessRecentCache,
  subscribeBusinessRecentPresentation,
  type BusinessRecentIndexRow,
} from "../services/businessRecentService";
import {
  mergeRecentPointers,
  ensureBusinessRecentStoreHydrated,
  promoteBusinessRecentPointers,
  recentScopeKey,
  useBusinessRecentStore,
  type BusinessRecentPointer,
} from "../store/businessRecentStoreCore";
import { businessRecentDestination } from "../utils/routeForEventRow";

const useBusinessRecentFocusEffect: typeof useFocusEffect =
  typeof useFocusEffect === "function"
    ? useFocusEffect
    : (effect) => useEffect(effect, [effect]);
const captureBusinessRecent = (
  event: string,
  properties: Record<string, string | number | boolean>,
): void => {
  // Analytics is an outcome of a Recent operation, not a detail-route import
  // dependency. Keep registration side-effect-free until capture is required.
  const { postHogService } =
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("../services/postHogService") as typeof import("../services/postHogService");
  postHogService.capture(event, properties);
};

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

const EMPTY_RECENT_POINTERS: BusinessRecentPointer[] = [];

const withIndexLifecycle = (
  pointer: BusinessRecentPointer,
  index: BusinessRecentIndexRow,
): BusinessRecentPointer => ({
  ...pointer,
  status: index.lifecycleStatus,
  destination: businessRecentDestination(index.entityType, index.rawStatus),
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
  isLoadingMore: boolean;
  hasPageError: boolean;
  hasMore: boolean;
  retry: () => Promise<void>;
  refresh: () => Promise<void>;
} {
  void ensureBusinessRecentStoreHydrated();
  const { user, isAuthReady } = useAuth();
  const queryClient = useQueryClient();
  const network = useNetInfoSafe();
  // issue #3347 — the device status is only a HINT. Straight after a cold launch
  // it can say "not connected" while the internet works, and on iOS it may never
  // correct itself. Recent keeps asking the server either way; "offline" is
  // decided further down, once a request has actually failed (`isOffline`).
  const offlineHint = recentOfflineHint(network);
  const pageCount = Math.max(1, Math.min(8, input.pageCount ?? 1));
  const userId = user?.id ?? null;
  const scope =
    userId !== null && input.brandId !== null
      ? recentScopeKey(userId, input.brandId)
      : null;
  const cached = useBusinessRecentStore((state) =>
    scope === null
      ? EMPTY_RECENT_POINTERS
      : (state.scopes[scope] ?? EMPTY_RECENT_POINTERS),
  );
  const remove = useBusinessRecentStore((state) => state.remove);
  const upsert = useBusinessRecentStore((state) => state.upsert);
  const clearScope = useBusinessRecentStore((state) => state.clearScope);
  const hasHydrated = useBusinessRecentStore((state) => state.hasHydrated);
  const activeScopeRef = useRef(scope);
  const flushingScopeRef = useRef<string | null>(null);
  const loadedEventRef = useRef<string | null>(null);
  const cachedSnapshotRef = useRef<string | null>(null);
  const [fallbackRows, setFallbackRows] = useState<BusinessRecentPointer[]>([]);
  const [fallbackReady, setFallbackReady] = useState(false);
  const recentAppStateRef = useRef<AppStateStatus>(AppState.currentState);
  activeScopeRef.current = scope;

  useEffect(() => {
    setFallbackRows([]);
    setFallbackReady(scope === null);
    if (scope === null) return;
    const generation = useBusinessRecentStore.getState().generation;
    const requestedScope = scope;
    void loadBusinessRecentCache(requestedScope)
      .then((rows) => {
        if (
          activeScopeRef.current === requestedScope &&
          useBusinessRecentStore.getState().generation === generation
        ) {
          for (const pointer of rows) {
            if (pointer.pendingSync || pointer.localDraft) {
              useBusinessRecentStore.getState().upsert(requestedScope, pointer);
            }
          }
          setFallbackRows(rows);
        }
      })
      .finally(() => {
        if (
          activeScopeRef.current === requestedScope &&
          useBusinessRecentStore.getState().generation === generation
        ) {
          setFallbackReady(true);
        }
      });
  }, [scope]);

  useEffect(
    () =>
      subscribeBusinessRecentPresentation((mutation) => {
        if (mutation.scope !== activeScopeRef.current) return;
        if (mutation.kind === "upsert") {
          setFallbackRows((current) =>
            mergeRecentPointers(current, [mutation.pointer]),
          );
          return;
        }
        if (mutation.kind === "remove") {
          setFallbackRows((current) =>
            current.filter(
              (pointer) =>
                pointer.entityType !== mutation.entityType ||
                pointer.entityId !== mutation.entityId,
            ),
          );
          return;
        }
        if (mutation.kind === "clear") {
          setFallbackRows([]);
          return;
        }
        setFallbackRows((current) => {
          return promoteBusinessRecentPointers(current, mutation);
        });
      }),
    [],
  );

  const indexQuery = useQuery({
    queryKey:
      userId !== null && input.brandId !== null
        ? businessRecentKeys.index(userId, input.brandId)
        : businessRecentKeys.all,
    enabled: isAuthReady && userId !== null && input.brandId !== null,
    staleTime: 30_000,
    // issue #3347 — with the hint saying offline, one attempt is enough to
    // confirm it (a real disconnect fails at once) or disprove it.
    ...(offlineHint ? { retry: false } : {}),
    queryFn: async (): Promise<BusinessRecentIndexRow[]> => {
      if (input.brandId === null || scope === null) return [];
      const generation = useBusinessRecentStore.getState().generation;
      const requestScope = scope;
      const isCurrent = (): boolean =>
        activeScopeRef.current === requestScope &&
        useBusinessRecentStore.getState().generation === generation;
      const ordered = orderBusinessRecentIndex(
        await listBusinessRecentIndex(input.brandId),
      );
      return isCurrent() ? ordered : [];
    },
  });

  const indexRows = useMemo(() => indexQuery.data ?? [], [indexQuery.data]);
  const indexPages = useMemo(() => {
    const pages: BusinessRecentIndexRow[][] = [];
    let offset = 0;
    while (offset < pageCount * 25) {
      pages.push(indexRows.slice(offset, offset + 25));
      offset += 25;
    }
    return pages;
  }, [indexRows, pageCount]);
  const pageQueries = useQueries({
    queries: indexPages.map((indexPage, pageOffset) => {
      const pageNumber = pageOffset + 1;
      const cursor = indexPage.map((row) => row.pointerId).join(":") || "empty";
      return {
        queryKey:
          userId !== null && input.brandId !== null
            ? businessRecentKeys.page(userId, input.brandId, pageNumber, cursor)
            : businessRecentKeys.all,
        enabled:
          isAuthReady &&
          userId !== null &&
          input.brandId !== null &&
          indexQuery.isSuccess &&
          indexPage.length > 0,
        staleTime: 30_000,
        ...(offlineHint ? { retry: false } : {}),
        placeholderData: (
          previous:
            { rows: BusinessRecentPointer[]; omitted: number } | undefined,
        ) => previous,
        queryFn: async (): Promise<{
          rows: BusinessRecentPointer[];
          omitted: number;
        }> => {
          if (input.brandId === null || scope === null)
            return { rows: [], omitted: 0 };
          const generation = useBusinessRecentStore.getState().generation;
          const requestScope = scope;
          const isCurrent = (): boolean =>
            activeScopeRef.current === requestScope &&
            useBusinessRecentStore.getState().generation === generation;
          const result = await hydrateBusinessRecent(
            input.brandId,
            indexPage.map((row) => ({
              entityType: row.entityType,
              entityId: row.entityId,
            })),
          );
          if (!isCurrent()) return { rows: [], omitted: 0 };
          const indexByKey = new Map(
            indexPage.map((row) => [`${row.entityType}:${row.entityId}`, row]),
          );
          const rows = result.pointers.map((pointer) => {
            const index = indexByKey.get(
              `${pointer.entityType}:${pointer.entityId}`,
            );
            return index === undefined
              ? pointer
              : withIndexLifecycle(pointer, index);
          });
          for (const omittedPointer of result.omitted) {
            remove(scope, omittedPointer.entityType, omittedPointer.entityId);
            setFallbackRows((current) =>
              current.filter(
                (pointer) =>
                  pointer.entityType !== omittedPointer.entityType ||
                  pointer.entityId !== omittedPointer.entityId,
              ),
            );
            void removeBusinessRecentPresentationCache(
              scope,
              omittedPointer.entityType,
              omittedPointer.entityId,
            ).catch(() => {
              console.warn("[Recent] omitted cache cleanup failed");
            });
          }
          return isCurrent()
            ? { rows, omitted: result.omitted.length }
            : { rows: [], omitted: 0 };
        },
      };
    }),
  });

  useBusinessRecentFocusEffect(
    useCallback(() => {
      if (userId !== null && input.brandId !== null) {
        void queryClient.invalidateQueries({
          queryKey: businessRecentKeys.index(userId, input.brandId),
        });
        void queryClient.invalidateQueries({
          queryKey: businessRecentKeys.pages(userId, input.brandId),
        });
      }
    }, [input.brandId, queryClient, userId]),
  );

  const serverRows = pageQueries.flatMap((query) => query.data?.rows ?? []);
  const authoritativeIndexReady =
    indexQuery.isSuccess && !indexQuery.isFetching;
  const currentIndexByKey = new Map(
    indexRows.map((row) => [`${row.entityType}:${row.entityId}`, row]),
  );
  const candidateRows = mergeRecentPointers(
    mergeRecentPointers(fallbackRows, cached),
    serverRows,
  );
  const mergedRows = (
    authoritativeIndexReady
      ? retainAuthoritativeBusinessRecentPointers(candidateRows, indexRows)
      : candidateRows
  ).map((pointer) => {
    const index = currentIndexByKey.get(
      `${pointer.entityType}:${pointer.entityId}`,
    );
    return index === undefined ? pointer : withIndexLifecycle(pointer, index);
  });
  const rows = orderBusinessRecentPointers(mergedRows, indexRows);
  const omitted = pageQueries.reduce(
    (total, query) => total + (query.data?.omitted ?? 0),
    0,
  );
  const queryError =
    indexQuery.error ??
    pageQueries.find((query) => query.error !== null)?.error ??
    null;
  const errorKind =
    queryError === null ? null : recentErrorCategory(queryError);
  // issue #3347 — CONFIRMED offline: the hint says so AND Recent's own latest
  // request failed with a connection error. A server answer clears it.
  const isOffline = isRecentOfflineConfirmed(network, errorKind);

  // issue #3347 — when the hint changes either way, ask the server again: a new
  // "not connected" gets confirmed (or disproved) straight away, and a reconnect
  // reloads Recent, as disabling and re-enabling the queries used to.
  const previousOfflineHintRef = useRef(offlineHint);
  useEffect(() => {
    if (previousOfflineHintRef.current === offlineHint) return;
    previousOfflineHintRef.current = offlineHint;
    if (userId === null || input.brandId === null) return;
    void queryClient.invalidateQueries({
      queryKey: businessRecentKeys.index(userId, input.brandId),
    });
    void queryClient.invalidateQueries({
      queryKey: businessRecentKeys.pages(userId, input.brandId),
    });
  }, [input.brandId, offlineHint, queryClient, userId]);

  useEffect(() => {
    if (scope === null || !authoritativeIndexReady) return;
    const snapshot = orderBusinessRecentPointers(
      retainAuthoritativeBusinessRecentPointers(
        mergeRecentPointers(fallbackRows, serverRows),
        indexRows,
      ),
      indexRows,
    );
    const sourceKey = fallbackRows
      .map((row) => `${row.entityType}:${row.entityId}:${row.lastOpenedAt}`)
      .join("|");
    const snapshotKey = snapshot
      .map((row) => `${row.entityType}:${row.entityId}:${row.lastOpenedAt}`)
      .join("|");
    for (const pointer of cached) {
      if (
        !pointer.pendingSync &&
        !pointer.localDraft &&
        !indexRows.some(
          (row) =>
            row.entityType === pointer.entityType &&
            row.entityId === pointer.entityId,
        )
      ) {
        remove(scope, pointer.entityType, pointer.entityId);
      }
    }
    const reconciliationKey = `${scope}:${sourceKey}=>${snapshotKey}`;
    if (cachedSnapshotRef.current === reconciliationKey) return;
    cachedSnapshotRef.current = reconciliationKey;
    const generation = useBusinessRecentStore.getState().generation;
    const requestScope = scope;
    setFallbackRows(snapshot);
    void saveBusinessRecentCache(requestScope, snapshot).catch(() => {
      if (
        activeScopeRef.current === requestScope &&
        useBusinessRecentStore.getState().generation === generation
      ) {
        console.warn("[Recent] offline presentation cache write failed");
      }
    });
  }, [
    authoritativeIndexReady,
    cached,
    fallbackRows,
    indexRows,
    remove,
    scope,
    serverRows,
  ]);

  useEffect(() => {
    if (
      scope === null ||
      !indexQuery.isSuccess ||
      pageQueries.some((query) => query.isFetching)
    )
      return;
    const eventKey = `${scope}:${pageCount}:${indexRows[0]?.pointerId ?? "empty"}`;
    if (loadedEventRef.current === eventKey) return;
    loadedEventRef.current = eventKey;
    captureBusinessRecent("business_recent_page_loaded", {
      source: pageCount === 1 ? "home" : "recent",
      count_bucket:
        rows.length > 25 ? "26_plus" : rows.length > 10 ? "11_25" : "0_10",
      cache: fallbackRows.length > 0,
      offline: false,
      surface: "business",
    });
  }, [
    fallbackRows.length,
    indexQuery.isSuccess,
    indexRows,
    pageCount,
    pageQueries,
    rows.length,
    scope,
  ]);

  useEffect(() => {
    if (scope !== null && errorKind === "permission") {
      clearScope(scope);
      setFallbackRows([]);
      void clearBusinessRecentCachedScope(scope);
    }
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
    const generation = useBusinessRecentStore.getState().generation;
    const isCurrent = (): boolean =>
      activeScopeRef.current === scope &&
      useBusinessRecentStore.getState().generation === generation;
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
          if (!isCurrent()) return;
          if (!result.retained) {
            remove(scope, pointer.entityType, pointer.entityId);
            setFallbackRows((current) =>
              current.filter(
                (row) =>
                  row.entityType !== pointer.entityType ||
                  row.entityId !== pointer.entityId,
              ),
            );
            await removeBusinessRecentPresentationCache(
              scope,
              pointer.entityType,
              pointer.entityId,
            ).catch(() => {
              console.warn("[Recent] retained=false cache cleanup failed");
            });
            continue;
          }
          upsert(scope, {
            ...pointer,
            lastOpenedAt: result.acceptedOpenedAt,
            pendingSync: false,
          });
        } catch (error: unknown) {
          const category = recentErrorCategory(error);
          if (category === "entity-permission") {
            remove(scope, pointer.entityType, pointer.entityId);
            setFallbackRows((current) =>
              current.filter(
                (row) =>
                  row.entityType !== pointer.entityType ||
                  row.entityId !== pointer.entityId,
              ),
            );
            await removeBusinessRecentPresentationCache(
              scope,
              pointer.entityType,
              pointer.entityId,
            ).catch(() => {
              console.warn("[Recent] forbidden entity cache cleanup failed");
            });
            continue;
          }
          if (category === "permission") {
            permissionDenied = true;
            if (isCurrent()) {
              clearScope(scope);
              setFallbackRows([]);
              await clearBusinessRecentCachedScope(scope).catch(() => {
                console.warn("[Recent] denied scope cache cleanup failed");
              });
            }
            break;
          }
        }
      }
      if (!permissionDenied && isCurrent()) {
        await Promise.all([
          queryClient.invalidateQueries({
            queryKey: businessRecentKeys.index(userId, input.brandId as string),
          }),
          queryClient.invalidateQueries({
            queryKey: businessRecentKeys.pages(userId, input.brandId as string),
          }),
        ]);
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
    const firstHydrationPending =
      indexRows.length > 0 &&
      rows.length === 0 &&
      pageQueries.some(
        (query) => query.isLoading || query.isPending || query.isFetching,
      );
    if (
      (!isAuthReady ||
        indexQuery.isLoading ||
        !hasHydrated ||
        !fallbackReady ||
        firstHydrationPending) &&
      rows.length === 0
    )
      return "loading";
    if (indexQuery.isError || pageQueries.some((query) => query.isError))
      return rows.length > 0 ? "error-cached" : "error-empty";
    if (omitted > 0 && rows.length === 0) return "omitted";
    if (rows.length === 0) return "empty";
    if (indexQuery.isFetching || pageQueries.some((query) => query.isFetching))
      return "refreshing";
    return "populated";
  }, [
    errorKind,
    hasHydrated,
    isAuthReady,
    isOffline,
    fallbackReady,
    indexQuery.isError,
    indexQuery.isFetching,
    indexQuery.isLoading,
    indexRows.length,
    omitted,
    pageQueries,
    rows.length,
  ]);

  const refresh = useCallback(async (): Promise<void> => {
    // issue #3347 — never gated on offline: a refresh is how an unconfirmed or
    // stale offline state gets disproved.
    if (userId === null || input.brandId === null) return;
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: businessRecentKeys.index(userId, input.brandId),
      }),
      queryClient.invalidateQueries({
        queryKey: businessRecentKeys.pages(userId, input.brandId),
      }),
    ]);
  }, [input.brandId, queryClient, userId]);

  const retry = useCallback(async (): Promise<void> => {
    if (userId === null || input.brandId === null) return;
    const failedPages = pageQueries.filter((query) => query.isError);
    if (!indexQuery.isError && failedPages.length === 0) {
      await refresh();
      return;
    }
    await Promise.all([
      ...(indexQuery.isError ? [indexQuery.refetch()] : []),
      ...failedPages.map((query) => query.refetch()),
    ]);
  }, [indexQuery, input.brandId, pageQueries, refresh, userId]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextState) => {
      const previous = recentAppStateRef.current;
      recentAppStateRef.current = nextState;
      if (previous !== "active" && nextState === "active") void refresh();
    });
    return () => subscription.remove();
  }, [refresh]);

  const hasPageError = pageQueries.slice(1).some((query) => query.isError);
  const isLoadingMore =
    pageCount > 1 &&
    pageQueries.slice(1).some((query) => query.isLoading || query.isFetching);

  return {
    rows,
    total: indexRows.length,
    state,
    isRefreshing:
      indexQuery.isFetching || pageQueries.some((query) => query.isFetching),
    isLoadingMore,
    hasPageError,
    hasMore: indexRows.length > pageCount * 25,
    retry,
    refresh,
  };
}
