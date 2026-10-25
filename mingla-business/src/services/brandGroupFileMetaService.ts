import { supabase } from "./supabase";
import type { BrandGroupMediaRowKind } from "./brandGroupMediaService";

export interface BrandGroupFileMediaMeta {
  fileId: string;
  kind: BrandGroupMediaRowKind;
  durationMs: number | null;
  width: number | null;
  height: number | null;
  thumbState: "pending" | "ready" | "none";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  return actual.length === keys.length && [...keys].sort().every((key, index) => key === actual[index]);
}

function nullableNumber(value: unknown): number | null {
  return value === null ? null : typeof value === "number" && Number.isFinite(value) ? value : Number.NaN;
}

export function parseBrandGroupFileMetaRows(value: unknown): BrandGroupFileMediaMeta[] {
  if (!Array.isArray(value)) throw new Error("brand_group_media_malformed");
  return value.map((raw) => {
    if (!isRecord(raw) || !hasExactKeys(raw, ["file_id", "kind", "duration_ms", "width", "height", "thumb_state"])) {
      throw new Error("brand_group_media_malformed");
    }
    const durationMs = nullableNumber(raw.duration_ms);
    const width = nullableNumber(raw.width);
    const height = nullableNumber(raw.height);
    if (
      typeof raw.file_id !== "string" ||
      !["image", "video", "file"].includes(String(raw.kind)) ||
      !["pending", "ready", "none"].includes(String(raw.thumb_state)) ||
      Number.isNaN(durationMs) || (durationMs !== null && durationMs < 0) ||
      Number.isNaN(width) || (width !== null && width <= 0) ||
      Number.isNaN(height) || (height !== null && height <= 0)
    ) throw new Error("brand_group_media_malformed");
    return {
      fileId: String(raw.file_id),
      kind: String(raw.kind) as BrandGroupMediaRowKind,
      durationMs,
      width,
      height,
      thumbState: String(raw.thumb_state) as BrandGroupFileMediaMeta["thumbState"],
    };
  });
}

export async function fileMeta(conversationId: string, fileIds: readonly string[]): Promise<BrandGroupFileMediaMeta[]> {
  if (fileIds.length === 0) return [];
  const { data, error } = await supabase.rpc("issue_3988_brand_group_file_media_meta", {
    p_conversation_id: conversationId,
    p_file_ids: [...fileIds],
  });
  if (error) throw new Error(error.message || "brand_group_media_meta_failed");
  return parseBrandGroupFileMetaRows(data);
}
