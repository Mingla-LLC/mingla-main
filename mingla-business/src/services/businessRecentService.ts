import AsyncStorage from "@react-native-async-storage/async-storage";

import { supabase } from "./supabase";
import { deriveLiveStatus } from "../utils/eventLifecycle";
import type { LiveEvent } from "../store/liveEventStore";
import {
  mergeRecentPointers,
  promoteBusinessRecentPointers,
} from "../store/businessRecentStore";
import type {
  BusinessRecentEntityType,
  BusinessRecentPointer,
} from "../store/businessRecentStore";

export type BusinessRecentPresentationMutation =
  | {
      kind: "upsert";
      scope: string;
      pointer: BusinessRecentPointer;
    }
  | {
      kind: "remove";
      scope: string;
      entityType: BusinessRecentEntityType;
      entityId: string;
    }
  | {
      kind: "promote";
      scope: string;
      entityType: BusinessRecentEntityType;
      localId: string;
      serverId: string;
      operationId: string;
    }
  | {
      kind: "clear";
      scope: string;
    };

type BusinessRecentPresentationListener = (
  mutation: BusinessRecentPresentationMutation,
) => void;

const presentationListeners = new Set<BusinessRecentPresentationListener>();

export function subscribeBusinessRecentPresentation(
  listener: BusinessRecentPresentationListener,
): () => void {
  presentationListeners.add(listener);
  return () => presentationListeners.delete(listener);
}

export interface BusinessRecentIndexRow {
  pointerId: string;
  entityType: BusinessRecentEntityType;
  entityId: string;
  lastOpenedAt: string;
  lifecycleStatus: string | null;
  rawStatus: string | null;
  startsAt: string | null;
  endsAt: string | null;
  endedAt: string | null;
}

const canonicalLifecycle = (
  row: Omit<BusinessRecentIndexRow, "lifecycleStatus">,
  deriveTripLifecycleStatus: typeof import("../components/trip/TripDetailHeroStatusPill").deriveTripLifecycleStatus,
): string | null => {
  if (row.entityType === "venue") return row.rawStatus;
  if (row.entityType === "trip" || row.entityType === "experience") {
    const status = row.rawStatus;
    if (
      !["draft", "scheduled", "live", "ended", "cancelled"].includes(
        status ?? "",
      )
    )
      return status;
    return deriveTripLifecycleStatus({
      status: status as "draft" | "scheduled" | "live" | "ended" | "cancelled",
      startAt: row.startsAt,
      endAt: row.endsAt,
    });
  }
  return deriveLiveStatus(
    {
      status: row.rawStatus,
      endedAt: row.endedAt,
    } as unknown as LiveEvent,
    row.startsAt,
  );
};

const isLiveIndex = (row: BusinessRecentIndexRow): boolean =>
  row.lifecycleStatus === "live";
export const orderBusinessRecentIndex = (
  rows: BusinessRecentIndexRow[],
): BusinessRecentIndexRow[] =>
  [...rows].sort((a, b) => {
    const live = Number(isLiveIndex(b)) - Number(isLiveIndex(a));
    if (live !== 0) return live;
    const opened = Date.parse(b.lastOpenedAt) - Date.parse(a.lastOpenedAt);
    return opened !== 0 ? opened : b.pointerId.localeCompare(a.pointerId);
  });
export const orderBusinessRecentPointers = (
  pointers: BusinessRecentPointer[],
  indexRows: BusinessRecentIndexRow[],
): BusinessRecentPointer[] => {
  const index = new Map(
    indexRows.map((row) => [`${row.entityType}:${row.entityId}`, row]),
  );
  return [...pointers].sort((a, b) => {
    const ai = index.get(`${a.entityType}:${a.entityId}`);
    const bi = index.get(`${b.entityType}:${b.entityId}`);
    const live =
      Number(bi !== undefined && isLiveIndex(bi)) -
      Number(ai !== undefined && isLiveIndex(ai));
    if (live !== 0) return live;
    const opened = Date.parse(b.lastOpenedAt) - Date.parse(a.lastOpenedAt);
    if (opened !== 0) return opened;
    return (bi?.pointerId ?? `${b.entityType}:${b.entityId}`).localeCompare(
      ai?.pointerId ?? `${a.entityType}:${a.entityId}`,
    );
  });
};

interface IndexRpcRow {
  pointer_id: string;
  entity_type: BusinessRecentEntityType;
  entity_id: string;
  last_opened_at: string;
  raw_status: string | null;
  starts_at: string | null;
  ends_at: string | null;
  ended_at: string | null;
}

interface HydrateResponse {
  items: {
    entityType: BusinessRecentEntityType;
    entityId: string;
    lastOpenedAt: string;
    title: string;
    coverUrl: string | null;
    coverPosterUrl: string | null;
    coverType: "image" | "video" | "gif" | null;
    status: string | null;
    startsAt: string | null;
    endsAt: string | null;
  }[];
  omitted: { entityType: BusinessRecentEntityType; entityId: string }[];
}

export const businessRecentKeys = {
  all: ["business-recent"] as const,
  index: (userId: string, brandId: string) =>
    ["business-recent-index", userId, brandId] as const,
  pages: (userId: string, brandId: string) =>
    ["business-recent-page", userId, brandId] as const,
  page: (userId: string, brandId: string, page: number, cursor: string) =>
    ["business-recent-page", userId, brandId, page, cursor] as const,
};

const CACHE_MANIFEST_KEY = "business-recent-cache-manifest-v1";
const cacheKey = (scope: string): string => `business-recent-cache-v1:${scope}`;
let cacheMutationChain: Promise<void> = Promise.resolve();

const enqueueCacheMutation = (mutation: () => Promise<void>): Promise<void> => {
  const result = cacheMutationChain.catch(() => undefined).then(mutation);
  cacheMutationChain = result.catch(() => undefined);
  return result;
};

const writeBusinessRecentCache = async (
  scope: string,
  pointers: BusinessRecentPointer[],
): Promise<void> => {
  const manifestRaw = await AsyncStorage.getItem(CACHE_MANIFEST_KEY);
  const manifest: string[] =
    manifestRaw === null ? [] : JSON.parse(manifestRaw);
  const nextManifest = Array.from(new Set([...manifest, scope]));
  await AsyncStorage.multiSet([
    [cacheKey(scope), JSON.stringify(pointers.slice(0, 200))],
    [CACHE_MANIFEST_KEY, JSON.stringify(nextManifest)],
  ]);
};

export async function loadBusinessRecentCache(
  scope: string,
): Promise<BusinessRecentPointer[]> {
  const raw = await AsyncStorage.getItem(cacheKey(scope));
  if (raw === null) return [];
  const parsed: unknown = JSON.parse(raw);
  return Array.isArray(parsed)
    ? (parsed as BusinessRecentPointer[]).slice(0, 200)
    : [];
}

export async function saveBusinessRecentCache(
  scope: string,
  pointers: BusinessRecentPointer[],
): Promise<void> {
  await enqueueCacheMutation(() => writeBusinessRecentCache(scope, pointers));
}

export async function upsertBusinessRecentPresentationCache(
  scope: string,
  pointer: BusinessRecentPointer,
): Promise<void> {
  for (const listener of presentationListeners)
    listener({ kind: "upsert", scope, pointer });
  await enqueueCacheMutation(async () => {
    const existing = await loadBusinessRecentCache(scope);
    await writeBusinessRecentCache(
      scope,
      mergeRecentPointers(existing, [pointer]),
    );
  });
}

export async function removeBusinessRecentPresentationCache(
  scope: string,
  entityType: BusinessRecentEntityType,
  entityId: string,
): Promise<void> {
  for (const listener of presentationListeners)
    listener({ kind: "remove", scope, entityType, entityId });
  await enqueueCacheMutation(async () => {
    const existing = await loadBusinessRecentCache(scope);
    await writeBusinessRecentCache(
      scope,
      existing.filter(
        (pointer) =>
          pointer.entityType !== entityType || pointer.entityId !== entityId,
      ),
    );
  });
}

export async function promoteBusinessRecentPresentationCache(input: {
  scope: string;
  entityType: BusinessRecentEntityType;
  localId: string;
  serverId: string;
  operationId: string;
}): Promise<void> {
  for (const listener of presentationListeners)
    listener({ kind: "promote", ...input });
  await enqueueCacheMutation(async () => {
    const existing = await loadBusinessRecentCache(input.scope);
    const promoted = promoteBusinessRecentPointers(existing, input);
    if (promoted === existing) return;
    await writeBusinessRecentCache(input.scope, promoted);
  });
}

export async function clearBusinessRecentCachedUser(
  userId: string,
): Promise<void> {
  await enqueueCacheMutation(async () => {
    const manifestRaw = await AsyncStorage.getItem(CACHE_MANIFEST_KEY);
    if (manifestRaw === null) return;
    const manifest: string[] = JSON.parse(manifestRaw);
    const prefix = `${userId}:`;
    const removed = manifest.filter((scope) => scope.startsWith(prefix));
    const retained = manifest.filter((scope) => !scope.startsWith(prefix));
    await AsyncStorage.multiRemove(removed.map(cacheKey));
    await AsyncStorage.setItem(CACHE_MANIFEST_KEY, JSON.stringify(retained));
  });
}

export async function clearBusinessRecentCachedScope(
  scope: string,
): Promise<void> {
  for (const listener of presentationListeners)
    listener({ kind: "clear", scope });
  await enqueueCacheMutation(async () => {
    const manifestRaw = await AsyncStorage.getItem(CACHE_MANIFEST_KEY);
    const manifest: string[] =
      manifestRaw === null ? [] : JSON.parse(manifestRaw);
    await AsyncStorage.multiRemove([cacheKey(scope)]);
    await AsyncStorage.setItem(
      CACHE_MANIFEST_KEY,
      JSON.stringify(manifest.filter((entry) => entry !== scope)),
    );
  });
}

export function newRecentOperationId(): string {
  const cryptoRef = (globalThis as { crypto?: Crypto }).crypto;
  if (cryptoRef !== undefined && typeof cryptoRef.randomUUID === "function") {
    return cryptoRef.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (char) => {
    const random = (Math.random() * 16) | 0;
    return (char === "x" ? random : (random & 0x3) | 0x8).toString(16);
  });
}

export async function recordBusinessRecentOpen(input: {
  brandId: string;
  entityType: BusinessRecentEntityType;
  entityId: string;
  openedAt: string;
  operationId: string;
}): Promise<{ acceptedOpenedAt: string; retained: boolean }> {
  const { data, error } = await supabase.rpc("biz_record_recent_entity_open", {
    p_brand_id: input.brandId,
    p_entity_type: input.entityType,
    p_entity_id: input.entityId,
    p_opened_at: input.openedAt,
    p_operation_id: input.operationId,
  });
  if (error !== null) throw error;
  if (data === null || typeof data !== "object") {
    throw new Error("Recent open was not acknowledged.");
  }
  const result = data as { acceptedOpenedAt?: unknown; retained?: unknown };
  if (
    typeof result.acceptedOpenedAt !== "string" ||
    typeof result.retained !== "boolean"
  ) {
    throw new Error("Recent open returned an invalid acknowledgement.");
  }
  return {
    acceptedOpenedAt: result.acceptedOpenedAt,
    retained: result.retained,
  };
}

export async function listBusinessRecentIndex(
  brandId: string,
): Promise<BusinessRecentIndexRow[]> {
  const { deriveTripLifecycleStatus } = await import(
    "../components/trip/TripDetailHeroStatusPill"
  );
  const { data, error } = await supabase.rpc("biz_list_recent_entity_index", {
    p_brand_id: brandId,
  });
  if (error !== null) throw error;
  return ((data ?? []) as IndexRpcRow[]).map((row) => {
    const raw = {
      pointerId: row.pointer_id,
      entityType: row.entity_type,
      entityId: row.entity_id,
      lastOpenedAt: row.last_opened_at,
      rawStatus: row.raw_status,
      startsAt: row.starts_at,
      endsAt: row.ends_at,
      endedAt: row.ended_at,
    };
    return {
      ...raw,
      lifecycleStatus: canonicalLifecycle(raw, deriveTripLifecycleStatus),
    };
  });
}

export async function hydrateBusinessRecent(
  brandId: string,
  refs: { entityType: BusinessRecentEntityType; entityId: string }[],
): Promise<{
  pointers: BusinessRecentPointer[];
  omitted: HydrateResponse["omitted"];
}> {
  if (refs.length > 25)
    throw new Error("Recent hydration is limited to 25 items.");
  const { data, error } = await supabase.rpc("biz_hydrate_recent_entities", {
    p_brand_id: brandId,
    p_refs: refs,
  });
  if (error !== null) throw error;
  const payload = data as HydrateResponse | null;
  if (
    payload === null ||
    !Array.isArray(payload.items) ||
    !Array.isArray(payload.omitted)
  ) {
    throw new Error("Recent hydration returned an invalid response.");
  }
  return {
    pointers: payload.items.map((item) => ({
      ...item,
      operationId: "server",
      pendingSync: false,
      localDraft: false,
    })),
    omitted: payload.omitted,
  };
}

export const recentErrorCategory = (
  error: unknown,
): "permission" | "network" | "unknown" => {
  const message = error instanceof Error ? error.message : String(error);
  if (/recent_brand_forbidden|permission|row-level security/i.test(message))
    return "permission";
  if (/network|fetch|offline|timeout/i.test(message)) return "network";
  return "unknown";
};
