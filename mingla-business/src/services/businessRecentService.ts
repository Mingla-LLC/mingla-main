import { supabase } from "./supabase";
import type {
  BusinessRecentEntityType,
  BusinessRecentPointer,
} from "../store/businessRecentStore";

export interface BusinessRecentIndexRow {
  pointerId: string;
  entityType: BusinessRecentEntityType;
  entityId: string;
  lastOpenedAt: string;
  lifecycleStatus: string | null;
  startsAt: string | null;
  endsAt: string | null;
}

interface IndexRpcRow {
  pointer_id: string;
  entity_type: BusinessRecentEntityType;
  entity_id: string;
  last_opened_at: string;
  lifecycle_status: string | null;
  starts_at: string | null;
  ends_at: string | null;
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
  scope: (userId: string, brandId: string) =>
    [...businessRecentKeys.all, userId, brandId] as const,
};

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
  const { data, error } = await supabase.rpc("biz_list_recent_entity_index", {
    p_brand_id: brandId,
  });
  if (error !== null) throw error;
  return ((data ?? []) as IndexRpcRow[]).map((row) => ({
    pointerId: row.pointer_id,
    entityType: row.entity_type,
    entityId: row.entity_id,
    lastOpenedAt: row.last_opened_at,
    lifecycleStatus: row.lifecycle_status,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
  }));
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
