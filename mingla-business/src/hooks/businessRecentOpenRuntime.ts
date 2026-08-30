import type { QueryClient } from "@tanstack/react-query";

import {
  clearRecentCache,
  newWriterOperationId,
  promoteRecentCache,
  recentWriterErrorCategory,
  recordRecentOpen,
  removeRecentCache,
  upsertRecentCache,
} from "../services/businessRecentWriterService.web";
import type { BusinessRecentEntityType } from "../store/businessRecentStore";
import { businessRecentDestination } from "../utils/routeForEventRow";

export interface SuccessfulBusinessRecentOpenInput {
  brandId: string;
  entityType: BusinessRecentEntityType;
  entityId: string;
  userId: string;
  title?: string;
  coverUrl?: string | null;
  coverPosterUrl?: string | null;
  coverType?: "image" | "video" | "gif" | null;
  status?: string | null;
  online: boolean;
  queryClient: QueryClient | null;
  isCurrent: () => boolean;
}

const recentPagesKey = (userId: string, brandId: string) =>
  ["business-recent-page", userId, brandId] as const;
const recentIndexKey = (userId: string, brandId: string) =>
  ["business-recent-index", userId, brandId] as const;

const captureFailure = (
  entityType: BusinessRecentEntityType,
  error: unknown,
  online: boolean,
): void => {
  const { postHogService } =
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("../services/postHogService") as typeof import("../services/postHogService");
  postHogService.capture("business_recent_record_failed", {
    entity_type: entityType,
    source: "detail",
    error_category: recentWriterErrorCategory(error),
    offline: !online,
    surface: "business",
  });
};

export async function recordSuccessfulBusinessRecentOpen(
  input: SuccessfulBusinessRecentOpenInput,
): Promise<void> {
  if (!input.isCurrent()) return;
  const operationId = newWriterOperationId();
  const openedAt = new Date().toISOString();
  const scope = `${input.userId}:${input.brandId}`;
  const localDraft = input.entityId.startsWith("d_");
  const pointer = {
    entityType: input.entityType,
    entityId: input.entityId,
    lastOpenedAt: openedAt,
    operationId,
    pendingSync: !localDraft,
    localDraft,
  };

  await upsertRecentCache(scope, {
    ...pointer,
    title: input.title,
    coverUrl: input.coverUrl,
    coverPosterUrl: input.coverPosterUrl,
    coverType: input.coverType,
    status: input.status,
    destination: businessRecentDestination(
      input.entityType,
      localDraft ? "draft" : input.status,
    ),
  }).catch(() => {
    console.warn("[Recent] optimistic presentation cache write failed");
  });
  if (!input.isCurrent()) return;
  if (localDraft || !input.online) return;

  try {
    const result = await recordRecentOpen({
      brandId: input.brandId,
      entityType: input.entityType,
      entityId: input.entityId,
      openedAt,
      operationId,
    });
    if (!input.isCurrent()) return;
    if (!result.retained) {
      void removeRecentCache(scope, input.entityType, input.entityId).catch(
        () => undefined,
      );
      return;
    }
    const accepted = { ...pointer, lastOpenedAt: result.acceptedOpenedAt };
    void upsertRecentCache(scope, {
      ...accepted,
      title: input.title,
      coverUrl: input.coverUrl,
      coverPosterUrl: input.coverPosterUrl,
      coverType: input.coverType,
      status: input.status,
      destination: businessRecentDestination(input.entityType, input.status),
      pendingSync: false,
      localDraft: false,
    }).catch(() => undefined);
    void input.queryClient?.invalidateQueries({
      queryKey: recentPagesKey(input.userId, input.brandId),
    });
    void input.queryClient?.invalidateQueries({
      queryKey: recentIndexKey(input.userId, input.brandId),
    });
  } catch (error: unknown) {
    if (!input.isCurrent()) return;
    const category = recentWriterErrorCategory(error);
    if (category === "entity-permission") {
      void removeRecentCache(scope, input.entityType, input.entityId).catch(
        () => undefined,
      );
    } else if (category === "permission") {
      await clearRecentCache(scope).catch(() => undefined);
    }
    captureFailure(input.entityType, error, input.online);
    console.warn("[Recent] successful-open sync deferred:", category);
  }
}

export async function promoteRecentDraft(input: {
  userId: string;
  brandId: string;
  entityType: BusinessRecentEntityType;
  localId: string;
  serverId: string;
}): Promise<void> {
  const scope = `${input.userId}:${input.brandId}`;
  const operationId = newWriterOperationId();
  await promoteRecentCache({
    scope,
    entityType: input.entityType,
    localId: input.localId,
    serverId: input.serverId,
    operationId,
  });
}

export async function discardRecentDraft(input: {
  userId: string;
  brandId: string;
  entityType: BusinessRecentEntityType;
  localId: string;
}): Promise<void> {
  const scope = `${input.userId}:${input.brandId}`;
  await removeRecentCache(scope, input.entityType, input.localId);
}
