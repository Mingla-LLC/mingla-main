import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
} from "react";
import { useFocusEffect } from "expo-router";
import { QueryClientContext } from "@tanstack/react-query";

import { useAuth } from "../context/AuthContext";
import { useNetInfoSafe } from "../lib/netinfoSafe";
import {
  businessRecentKeys,
  clearBusinessRecentCachedScope,
  newRecentOperationId,
  promoteBusinessRecentPresentationCache,
  recentErrorCategory,
  recordBusinessRecentOpen,
  removeBusinessRecentPresentationCache,
  upsertBusinessRecentPresentationCache,
} from "../services/businessRecentService";
import {
  ensureBusinessRecentStoreHydrated,
  recentScopeKey,
  useBusinessRecentStore,
  type BusinessRecentEntityType,
} from "../store/businessRecentStore";
import { businessRecentDestination } from "../utils/routeForEventRow";

const useBusinessRecentFocusEffect: typeof useFocusEffect =
  typeof useFocusEffect === "function"
    ? useFocusEffect
    : (effect) => useEffect(effect, [effect]);
const MissingBusinessRecentQueryClientContext = createContext<null>(null);

const captureBusinessRecent = (
  event: string,
  properties: Record<string, string | number | boolean>,
): void => {
  const { postHogService } =
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("../services/postHogService") as typeof import("../services/postHogService");
  postHogService.capture(event, properties);
};

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
  void ensureBusinessRecentStoreHydrated();
  const { user } = useAuth();
  const network = useNetInfoSafe();
  const queryClient = useContext(
    QueryClientContext ?? MissingBusinessRecentQueryClientContext,
  );
  const upsert = useBusinessRecentStore((state) => state.upsert);
  const remove = useBusinessRecentStore((state) => state.remove);
  const clearScope = useBusinessRecentStore((state) => state.clearScope);
  const hasHydrated = useBusinessRecentStore((state) => state.hasHydrated);
  const operationRef = useRef<string | null>(null);
  const focusedRef = useRef(false);
  const recordedThisFocusRef = useRef(false);
  const activeIdentityRef = useRef<string | null>(null);
  const recordCurrentRef = useRef<() => void>(() => undefined);

  useBusinessRecentFocusEffect(
    useCallback(() => {
      focusedRef.current = true;
      recordedThisFocusRef.current = false;
      operationRef.current = null;
      recordCurrentRef.current();
      return () => {
        focusedRef.current = false;
        operationRef.current = null;
        activeIdentityRef.current = null;
      };
    }, []),
  );

  const recordCurrentOpen = useCallback(() => {
    if (
      !focusedRef.current ||
      recordedThisFocusRef.current ||
      !hasHydrated ||
      !input.ready ||
      input.brandId === null ||
      input.entityId === null ||
      user === null
    ) {
      return;
    }
    recordedThisFocusRef.current = true;
    const operationId = newRecentOperationId();
    operationRef.current = operationId;
    const openedAt = new Date().toISOString();
    const scope = recentScopeKey(user.id, input.brandId);
    const generation = useBusinessRecentStore.getState().generation;
    const identity = `${scope}:${input.entityType}:${input.entityId}`;
    activeIdentityRef.current = identity;
    const isCurrent = (): boolean => {
      if (!focusedRef.current || operationRef.current !== operationId)
        return false;
      return (
        activeIdentityRef.current === identity &&
        useBusinessRecentStore.getState().generation === generation
      );
    };
    const localDraft = input.entityId.startsWith("d_");
    upsert(scope, {
      entityType: input.entityType,
      entityId: input.entityId,
      lastOpenedAt: openedAt,
      operationId,
      pendingSync: !localDraft,
      localDraft,
    });
    void upsertBusinessRecentPresentationCache(scope, {
      entityType: input.entityType,
      entityId: input.entityId,
      lastOpenedAt: openedAt,
      operationId,
      title: input.title,
      coverUrl: input.coverUrl,
      coverPosterUrl: input.coverPosterUrl,
      coverType: input.coverType,
      status: input.status,
      destination: businessRecentDestination(
        input.entityType,
        localDraft ? "draft" : input.status,
      ),
      pendingSync: !localDraft,
      localDraft,
    }).catch(() => {
      console.warn("[Recent] optimistic presentation cache write failed");
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
          if (!isCurrent()) return;
          if (!result.retained) {
            remove(scope, input.entityType, input.entityId as string);
            void removeBusinessRecentPresentationCache(
              scope,
              input.entityType,
              input.entityId as string,
            ).catch(() => {
              console.warn("[Recent] pruned cache cleanup failed");
            });
            return;
          }
          upsert(scope, {
            entityType: input.entityType,
            entityId: input.entityId as string,
            lastOpenedAt: result.acceptedOpenedAt,
            operationId,
            pendingSync: false,
            localDraft: false,
          });
          void upsertBusinessRecentPresentationCache(scope, {
            entityType: input.entityType,
            entityId: input.entityId as string,
            lastOpenedAt: result.acceptedOpenedAt,
            operationId,
            title: input.title,
            coverUrl: input.coverUrl,
            coverPosterUrl: input.coverPosterUrl,
            coverType: input.coverType,
            status: input.status,
            destination: businessRecentDestination(
              input.entityType,
              input.status,
            ),
            pendingSync: false,
            localDraft: false,
          }).catch(() => {
            console.warn("[Recent] accepted presentation cache write failed");
          });
          void queryClient?.invalidateQueries({
            queryKey: businessRecentKeys.pages(
              user.id,
              input.brandId as string,
            ),
          });
          void queryClient?.invalidateQueries({
            queryKey: businessRecentKeys.index(
              user.id,
              input.brandId as string,
            ),
          });
        })
        .catch(async (error: unknown) => {
          if (!isCurrent()) return;
          const category = recentErrorCategory(error);
          if (category === "entity-permission") {
            remove(scope, input.entityType, input.entityId as string);
            void removeBusinessRecentPresentationCache(
              scope,
              input.entityType,
              input.entityId as string,
            ).catch(() => {
              console.warn("[Recent] forbidden entity cache cleanup failed");
            });
          } else if (category === "permission") {
            clearScope(scope);
            await clearBusinessRecentCachedScope(scope).catch(() => {
              console.warn("[Recent] denied scope cache cleanup failed");
            });
          }
          captureBusinessRecent("business_recent_record_failed", {
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
  }, [
    clearScope,
    hasHydrated,
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
  ]);
  recordCurrentRef.current = recordCurrentOpen;

  useEffect(() => {
    recordCurrentOpen();
  }, [recordCurrentOpen]);

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
  void ensureBusinessRecentStoreHydrated();
  const scope = recentScopeKey(input.userId, input.brandId);
  const operationId = newRecentOperationId();
  useBusinessRecentStore
    .getState()
    .promoteDraft(
      scope,
      input.entityType,
      input.localId,
      input.serverId,
      operationId,
    );
  void promoteBusinessRecentPresentationCache({
    scope,
    entityType: input.entityType,
    localId: input.localId,
    serverId: input.serverId,
    operationId,
  }).catch(() => {
    console.warn("[Recent] draft presentation promotion failed");
  });
}

export function discardBusinessRecentDraft(input: {
  userId: string;
  brandId: string;
  entityType: BusinessRecentEntityType;
  localId: string;
}): void {
  void ensureBusinessRecentStoreHydrated();
  const scope = recentScopeKey(input.userId, input.brandId);
  useBusinessRecentStore
    .getState()
    .remove(scope, input.entityType, input.localId);
  void removeBusinessRecentPresentationCache(
    scope,
    input.entityType,
    input.localId,
  ).catch(() => {
    console.warn("[Recent] discarded draft cache cleanup failed");
  });
}
