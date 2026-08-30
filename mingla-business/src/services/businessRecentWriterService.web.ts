import recentStorage from "./businessRecentStorage";
import type {
  BusinessRecentEntityType,
  BusinessRecentPointer,
} from "../store/businessRecentStore";
import {
  mergeRecentPointers,
  promoteBusinessRecentPointers,
} from "../utils/businessRecentPointerMerge";
import { emitBusinessRecentPresentation } from "./businessRecentPresentationBus";
import { enqueueBusinessRecentCacheMutation } from "./businessRecentCacheQueue";

const manifestKey = "business-recent-cache-manifest-v1";
const cacheKey = (scope: string): string => `business-recent-cache-v1:${scope}`;
const supabase = (): typeof import("./supabase").supabase => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return (require("./supabase") as typeof import("./supabase")).supabase;
};

const load = async (scope: string): Promise<BusinessRecentPointer[]> => {
  const raw = await recentStorage().getItem(cacheKey(scope));
  return raw === null ? [] : (JSON.parse(raw) as BusinessRecentPointer[]);
};

const write = async (
  scope: string,
  pointers: BusinessRecentPointer[],
): Promise<void> => {
  const storage = recentStorage();
  const raw = await storage.getItem(manifestKey);
  const manifest: string[] = raw === null ? [] : JSON.parse(raw);
  await storage.multiSet([
    [cacheKey(scope), JSON.stringify(pointers.slice(0, 200))],
    [manifestKey, JSON.stringify(Array.from(new Set([...manifest, scope])))],
  ]);
};

export const recentWriterErrorCategory = (
  error: unknown,
): "permission" | "entity-permission" | "network" | "unknown" => {
  const message = error instanceof Error ? error.message : String(error);
  if (/recent_entity_forbidden/i.test(message)) return "entity-permission";
  if (/recent_brand_forbidden|permission|row-level security/i.test(message))
    return "permission";
  if (/network|fetch|offline|timeout/i.test(message)) return "network";
  return "unknown";
};

export const newWriterOperationId = (): string => {
  const cryptoRef = globalThis.crypto;
  if (typeof cryptoRef?.randomUUID === "function")
    return cryptoRef.randomUUID();
  const bytes = cryptoRef.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes, (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

export async function recordRecentOpen(input: {
  brandId: string;
  entityType: BusinessRecentEntityType;
  entityId: string;
  openedAt: string;
  operationId: string;
}): Promise<{ acceptedOpenedAt: string; retained: boolean }> {
  const { data, error } = await supabase().rpc(
    "biz_record_recent_entity_open",
    {
      p_brand_id: input.brandId,
      p_entity_type: input.entityType,
      p_entity_id: input.entityId,
      p_opened_at: input.openedAt,
      p_operation_id: input.operationId,
    },
  );
  if (error !== null) throw error;
  const result = data as {
    acceptedOpenedAt?: unknown;
    retained?: unknown;
  } | null;
  if (
    typeof result?.acceptedOpenedAt !== "string" ||
    typeof result.retained !== "boolean"
  )
    throw new Error("Recent open returned an invalid acknowledgement.");
  return {
    acceptedOpenedAt: result.acceptedOpenedAt,
    retained: result.retained,
  };
}

export async function upsertRecentCache(
  scope: string,
  pointer: BusinessRecentPointer,
): Promise<void> {
  emitBusinessRecentPresentation({ kind: "upsert", scope, pointer });
  await enqueueBusinessRecentCacheMutation(async () =>
    write(scope, mergeRecentPointers(await load(scope), [pointer])),
  );
}

export async function removeRecentCache(
  scope: string,
  entityType: BusinessRecentEntityType,
  entityId: string,
): Promise<void> {
  emitBusinessRecentPresentation({
    kind: "remove",
    scope,
    entityType,
    entityId,
  });
  await enqueueBusinessRecentCacheMutation(async () =>
    write(
      scope,
      (await load(scope)).filter(
        (pointer) =>
          pointer.entityType !== entityType || pointer.entityId !== entityId,
      ),
    ),
  );
}

export async function promoteRecentCache(input: {
  scope: string;
  entityType: BusinessRecentEntityType;
  localId: string;
  serverId: string;
  operationId: string;
}): Promise<void> {
  emitBusinessRecentPresentation({ kind: "promote", ...input });
  await enqueueBusinessRecentCacheMutation(async () =>
    write(
      input.scope,
      promoteBusinessRecentPointers(await load(input.scope), input),
    ),
  );
}

export async function clearRecentCache(scope: string): Promise<void> {
  emitBusinessRecentPresentation({ kind: "clear", scope });
  await enqueueBusinessRecentCacheMutation(async () => {
    const storage = recentStorage();
    const raw = await storage.getItem(manifestKey);
    const manifest: string[] = raw === null ? [] : JSON.parse(raw);
    await storage.multiRemove([cacheKey(scope)]);
    await storage.setItem(
      manifestKey,
      JSON.stringify(manifest.filter((entry) => entry !== scope)),
    );
  });
}
