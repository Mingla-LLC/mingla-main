import { supabase } from "./supabase";

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
  // #3720 Brand uploads intentionally have no sender-role snapshot. The
  // conversation authorization already proves this row belongs to the Brand,
  // so normalize that legacy-null shape at the contract boundary.
  const senderRole = value.senderRole === null ? "brand" : value.senderRole;
  if (
    typeof value.fileId !== "string" || typeof value.messageId !== "string" ||
    typeof value.name !== "string" || typeof value.mime !== "string" ||
    typeof value.sizeBytes !== "number" || !Number.isFinite(value.sizeBytes) || value.sizeBytes < 0 ||
    typeof value.createdAt !== "string" || !Number.isFinite(Date.parse(value.createdAt)) || typeof value.senderDisplayName !== "string" ||
    typeof senderRole !== "string" ||
    !["image", "video", "file"].includes(String(value.kind)) ||
    !["pending", "ready", "none"].includes(String(value.thumbState)) ||
    Number.isNaN(durationMs) || (durationMs !== null && durationMs < 0) ||
    Number.isNaN(width) || (width !== null && width <= 0) ||
    Number.isNaN(height) || (height !== null && height <= 0)
  ) return null;
  return { ...value, senderRole } as unknown as BrandGroupMediaRow;
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
