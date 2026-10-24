import { supabase } from "./supabase";
import { brandGroupFileThumbnailRequest } from "./brandGroupFilesService";

export type BrandGroupMediaKind = "media" | "files";
export type BrandGroupMediaRowKind = "image" | "video" | "file";

export interface BrandGroupMediaCursor {
  createdAt: string;
  id: string;
}

export interface BrandGroupMediaRow {
  fileId: string;
  messageId: string;
  name: string;
  mime: string;
  sizeBytes: number;
  createdAt: string;
  senderDisplayName: string;
  senderRole: string;
  kind: BrandGroupMediaRowKind;
  durationMs: number | null;
  width: number | null;
  height: number | null;
  thumbState: "pending" | "ready" | "none";
}

export interface BrandGroupMediaPage {
  schemaVersion: 1;
  totals: { media: number; files: number };
  rows: BrandGroupMediaRow[];
  nextCursor: BrandGroupMediaCursor | null;
}

const EXACT_ROW_KEYS = [
  "fileId", "messageId", "name", "mime", "sizeBytes", "createdAt",
  "senderDisplayName", "senderRole", "kind", "durationMs", "width", "height", "thumbState",
] as const;

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

function parseRow(value: unknown): BrandGroupMediaRow | null {
  if (!isRecord(value) || !hasExactKeys(value, EXACT_ROW_KEYS)) return null;
  const durationMs = nullableNumber(value.durationMs);
  const width = nullableNumber(value.width);
  const height = nullableNumber(value.height);
  if (
    typeof value.fileId !== "string" || typeof value.messageId !== "string" ||
    typeof value.name !== "string" || typeof value.mime !== "string" ||
    typeof value.sizeBytes !== "number" || !Number.isFinite(value.sizeBytes) || value.sizeBytes < 0 ||
    typeof value.createdAt !== "string" || !Number.isFinite(Date.parse(value.createdAt)) || typeof value.senderDisplayName !== "string" ||
    typeof value.senderRole !== "string" ||
    !["image", "video", "file"].includes(String(value.kind)) ||
    !["pending", "ready", "none"].includes(String(value.thumbState)) ||
    Number.isNaN(durationMs) || (durationMs !== null && durationMs < 0) ||
    Number.isNaN(width) || (width !== null && width <= 0) ||
    Number.isNaN(height) || (height !== null && height <= 0)
  ) return null;
  return value as unknown as BrandGroupMediaRow;
}

export function parseBrandGroupMediaPage(value: unknown): BrandGroupMediaPage {
  if (!isRecord(value) || !hasExactKeys(value, ["schemaVersion", "totals", "rows", "nextCursor"])) {
    throw new Error("brand_group_media_malformed");
  }
  const totals = value.totals;
  const cursor = value.nextCursor;
  const rows = Array.isArray(value.rows) ? value.rows.map(parseRow) : [];
  const validCursor = cursor === null || (
    isRecord(cursor) && hasExactKeys(cursor, ["createdAt", "id"]) &&
    typeof cursor.createdAt === "string" && typeof cursor.id === "string"
  );
  if (
    value.schemaVersion !== 1 || !isRecord(totals) || !hasExactKeys(totals, ["media", "files"]) ||
    !Number.isInteger(totals.media) || (totals.media as number) < 0 ||
    !Number.isInteger(totals.files) || (totals.files as number) < 0 ||
    !Array.isArray(value.rows) || rows.some((row) => row === null) || !validCursor
  ) throw new Error("brand_group_media_malformed");
  return {
    schemaVersion: 1,
    totals: { media: totals.media as number, files: totals.files as number },
    rows: rows as BrandGroupMediaRow[],
    nextCursor: cursor as BrandGroupMediaCursor | null,
  };
}

export async function listBrandGroupMedia(input: {
  conversationId: string;
  kind: BrandGroupMediaKind;
  cursor: BrandGroupMediaCursor | null;
  limit?: number;
}): Promise<BrandGroupMediaPage> {
  const { data, error } = await supabase.rpc("issue_3988_list_brand_group_media", {
    p_conversation_id: input.conversationId,
    p_kind: input.kind,
    p_cursor_created_at: input.cursor?.createdAt ?? null,
    p_cursor_id: input.cursor?.id ?? null,
    p_limit: input.limit ?? (input.kind === "media" ? 60 : 50),
  });
  if (error) throw new Error(error.message || "brand_group_media_failed");
  return parseBrandGroupMediaPage(data);
}

export function parseBrandGroupFileMetaRows(value: unknown): BrandGroupMediaRow[] {
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
      fileId: String(raw.file_id), messageId: "", name: "", mime: "", sizeBytes: 0, createdAt: "",
      senderDisplayName: "", senderRole: "", kind: String(raw.kind) as BrandGroupMediaRowKind,
      durationMs,
      width,
      height,
      thumbState: String(raw.thumb_state) as BrandGroupMediaRow["thumbState"],
    };
  });
}

export async function fileMeta(conversationId: string, fileIds: readonly string[]): Promise<BrandGroupMediaRow[]> {
  if (fileIds.length === 0) return [];
  const { data, error } = await supabase.rpc("issue_3988_brand_group_file_media_meta", {
    p_conversation_id: conversationId,
    p_file_ids: [...fileIds],
  });
  if (error) throw new Error(error.message || "brand_group_media_meta_failed");
  return parseBrandGroupFileMetaRows(data);
}

export const thumbnailRequest = brandGroupFileThumbnailRequest;
