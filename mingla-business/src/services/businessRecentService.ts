import { deriveLiveStatus } from "../utils/eventLifecycle";
import { ensureSecureRandom } from "../lib/secureRandomSafe";
import type { LiveEvent } from "../store/liveEventStore";
import { businessRecentDestination } from "../utils/routeForEventRow";
import {
  mergeRecentPointers,
  promoteBusinessRecentPointers,
} from "../store/businessRecentStore";
import recentStorage from "./businessRecentStorage";
import type {
  BusinessRecentEntityType,
  BusinessRecentPointer,
} from "../store/businessRecentStore";

const recentSupabase = (): typeof import("./supabase").supabase => {
  // Detail routes may register their Recent writer without instantiating the
  // auth client; the client is needed only when a Recent RPC actually runs.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { supabase } = require("./supabase") as typeof import("./supabase");
  return supabase;
};

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

export const canonicalBusinessRecentLifecycle = (
  row: Omit<BusinessRecentIndexRow, "lifecycleStatus">,
): string | null => {
  if (row.entityType === "venue") return row.rawStatus;
  if (row.entityType === "trip") return row.rawStatus;
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

export const retainAuthoritativeBusinessRecentPointers = (
  pointers: BusinessRecentPointer[],
  indexRows: BusinessRecentIndexRow[],
): BusinessRecentPointer[] => {
  const authoritative = new Set(
    indexRows.map((row) => `${row.entityType}:${row.entityId}`),
  );
  return pointers.filter(
    (pointer) =>
      authoritative.has(`${pointer.entityType}:${pointer.entityId}`) ||
      pointer.pendingSync ||
      pointer.localDraft,
  );
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
  const storage = recentStorage();
  const manifestRaw = await storage.getItem(CACHE_MANIFEST_KEY);
  const manifest: string[] =
    manifestRaw === null ? [] : JSON.parse(manifestRaw);
  const nextManifest = Array.from(new Set([...manifest, scope]));
  await storage.multiSet([
    [cacheKey(scope), JSON.stringify(pointers.slice(0, 200))],
    [CACHE_MANIFEST_KEY, JSON.stringify(nextManifest)],
  ]);
};

export async function loadBusinessRecentCache(
  scope: string,
): Promise<BusinessRecentPointer[]> {
  const raw = await recentStorage().getItem(cacheKey(scope));
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
    const storage = recentStorage();
    const manifestRaw = await storage.getItem(CACHE_MANIFEST_KEY);
    if (manifestRaw === null) return;
    const manifest: string[] = JSON.parse(manifestRaw);
    const prefix = `${userId}:`;
    const removed = manifest.filter((scope) => scope.startsWith(prefix));
    const retained = manifest.filter((scope) => !scope.startsWith(prefix));
    await storage.multiRemove(removed.map(cacheKey));
    await storage.setItem(CACHE_MANIFEST_KEY, JSON.stringify(retained));
  });
}

export async function clearBusinessRecentCachedScope(
  scope: string,
): Promise<void> {
  for (const listener of presentationListeners)
    listener({ kind: "clear", scope });
  await enqueueCacheMutation(async () => {
    const storage = recentStorage();
    const manifestRaw = await storage.getItem(CACHE_MANIFEST_KEY);
    const manifest: string[] =
      manifestRaw === null ? [] : JSON.parse(manifestRaw);
    await storage.multiRemove([cacheKey(scope)]);
    await storage.setItem(
      CACHE_MANIFEST_KEY,
      JSON.stringify(manifest.filter((entry) => entry !== scope)),
    );
  });
}

let fallbackOperationSequence = 0;

export function newRecentOperationId(): string {
  ensureSecureRandom();
  const cryptoRef = (globalThis as { crypto?: Crypto }).crypto;
  if (cryptoRef !== undefined && typeof cryptoRef.randomUUID === "function") {
    return cryptoRef.randomUUID();
  }
  if (typeof cryptoRef?.getRandomValues === "function") {
    const bytes = cryptoRef.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  fallbackOperationSequence = (fallbackOperationSequence + 1) & 0xffff;
  const clock = Date.now().toString(16).padStart(12, "0").slice(-12);
  const sequence = fallbackOperationSequence.toString(16).padStart(4, "0");
  console.warn(
    "[Recent] secure random unavailable; using a collision-bounded local UUID fallback.",
  );
  return `${clock.slice(0, 8)}-${clock.slice(8)}-4${sequence.slice(1)}-8${sequence.slice(1)}-${clock}${sequence}`.slice(
    0,
    36,
  );
}

export async function recordBusinessRecentOpen(input: {
  brandId: string;
  entityType: BusinessRecentEntityType;
  entityId: string;
  openedAt: string;
  operationId: string;
}): Promise<{ acceptedOpenedAt: string; retained: boolean }> {
  const { data, error } = await recentSupabase().rpc("biz_record_recent_entity_open", {
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
  const { data, error } = await recentSupabase().rpc("biz_list_recent_entity_index", {
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
      lifecycleStatus: canonicalBusinessRecentLifecycle(raw),
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
  const { data, error } = await recentSupabase().rpc("biz_hydrate_recent_entities", {
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
      destination: businessRecentDestination(item.entityType, item.status),
      operationId: "server",
      pendingSync: false,
      localDraft: false,
    })),
    omitted: payload.omitted,
  };
}

export const recentErrorCategory = (
  error: unknown,
): "permission" | "entity-permission" | "network" | "unknown" => {
  const message = error instanceof Error ? error.message : String(error);
  if (/recent_entity_forbidden/i.test(message)) return "entity-permission";
  if (/recent_brand_forbidden|permission|row-level security/i.test(message))
    return "permission";
  if (/network|fetch|offline|timeout/i.test(message)) return "network";
  return "unknown";
};
