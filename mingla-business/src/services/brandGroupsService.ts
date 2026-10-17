import { Platform } from "react-native";
import { createBinaryUploadTask, getFileInfoAsync } from "../utils/platformFileSystem";
import { supabase, supabaseProjectUrl, supabasePublicAnonKey } from "./supabase";

export interface BrandGroupSummary {
  conversation_id: string;
  brand_id: string;
  brand_name: string;
  brand_slug: string;
  brand_photo_url: string | null;
  last_message_at: string | null;
  last_message_preview: string;
  unread_count: number;
  member_count: number;
  access_kind: "brand" | "support";
  push_enabled: boolean;
}

export interface BrandGroupMessage {
  id: string;
  conversation_id: string;
  sender_id: string | null;
  content: string;
  created_at: string;
  reply_to_id: string | null;
  related_message_ids: string[];
  sender_display_name: string;
  sender_role: string | null;
  reply_content: string | null;
  reply_sender_display_name: string | null;
  message_type: "text" | "image" | "video" | "file";
  file_id: string | null;
  file_name: string | null;
  file_size: number | null;
  file_mime: string | null;
}

export interface BrandGroupPickedFile {
  uri: string;
  name: string;
  mimeType: string | null;
  size: number | null;
  webFile?: File;
}

export interface PreparedBrandGroupFile {
  fileId: string;
  storagePath: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  local: BrandGroupPickedFile;
}

function errorMessage(error: { message?: string } | null, fallback: string): string | null {
  return error ? error.message || fallback : null;
}

export async function listBrandGroups(): Promise<{
  groups: BrandGroupSummary[];
  error: string | null;
}> {
  const { data, error } = await supabase.rpc("issue_3720_list_brand_groups");
  return {
    groups: ((data ?? []) as BrandGroupSummary[]).map((group) => ({
      ...group,
      unread_count: Number(group.unread_count || 0),
      member_count: Number(group.member_count || 0),
    })),
    error: errorMessage(error, "Couldn't load Brand groups"),
  };
}

export async function listBrandGroupMessages(
  conversationId: string,
): Promise<{ messages: BrandGroupMessage[]; error: string | null }> {
  const { data, error } = await supabase.rpc("issue_3720_list_brand_group_messages", {
    p_conversation_id: conversationId,
    p_limit: 120,
    p_before: null,
  });
  return {
    messages: ((data ?? []) as BrandGroupMessage[]).slice().reverse(),
    error: errorMessage(error, "Couldn't load this Brand group"),
  };
}

export async function markBrandGroupRead(conversationId: string): Promise<void> {
  const { error } = await supabase.rpc("issue_3720_mark_brand_group_read", {
    p_conversation_id: conversationId,
  });
  if (error) throw new Error(error.message || "Couldn't mark the Brand group read");
}

export async function setBrandGroupWatch(
  conversationId: string,
  enabled: boolean,
): Promise<boolean> {
  const { data, error } = await supabase.rpc("issue_3720_set_brand_group_watch", {
    p_conversation_id: conversationId,
    p_enabled: enabled,
  });
  if (error) throw new Error(error.message || "Couldn't update Brand group notifications");
  return data === true;
}

export async function sendBrandGroupMessage(input: {
  conversationId: string;
  content: string;
  replyToId?: string | null;
  relatedMessageIds?: string[];
  actorMode: "brand" | "support";
}): Promise<string> {
  const { data, error } = await supabase.rpc("issue_3720_send_brand_group_message", {
    p_conversation_id: input.conversationId,
    p_content: input.content,
    p_reply_to_id: input.replyToId ?? null,
    p_related_message_ids: input.relatedMessageIds ?? [],
    p_actor_mode: input.actorMode,
  });
  if (error) throw new Error(error.message || "Couldn't send the message");
  return String(data);
}

const ALLOWED_FILE_MIMES = new Set([
  "image/jpeg", "image/png", "image/webp", "image/heic", "image/heif", "image/gif",
  "video/mp4", "video/quicktime", "video/webm",
  "audio/mpeg", "audio/mp4", "audio/wav", "audio/x-m4a",
  "application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/plain", "text/csv", "application/csv",
]);

const MIME_BY_EXTENSION: Record<string, string> = {
  csv: "text/csv", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  gif: "image/gif", heic: "image/heic", heif: "image/heif", jpeg: "image/jpeg", jpg: "image/jpeg",
  m4a: "audio/x-m4a", mov: "video/quicktime", mp3: "audio/mpeg", mp4: "video/mp4",
  pdf: "application/pdf", png: "image/png", txt: "text/plain", wav: "audio/wav",
  webm: "video/webm", webp: "image/webp",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

async function normalizeBrandGroupPickedFile(file: BrandGroupPickedFile): Promise<BrandGroupPickedFile & { mimeType: string; size: number }> {
  const extension = file.name.toLowerCase().split(".").pop() ?? "";
  const mimeType = String(file.mimeType || MIME_BY_EXTENSION[extension] || "").split(";", 1)[0].toLowerCase();
  let size = Number(file.size || 0);
  if (!size && Platform.OS !== "web") {
    const info = await getFileInfoAsync(file.uri);
    size = typeof info.size === "number" ? info.size : 0;
  }
  if (!ALLOWED_FILE_MIMES.has(mimeType)) throw new Error(`${file.name} is not a supported file type.`);
  if (!Number.isFinite(size) || size < 1) throw new Error(`We couldn't read ${file.name}.`);
  if (size > 100 * 1024 * 1024) throw new Error(`${file.name} is larger than 100 MB.`);
  return { ...file, mimeType, size };
}

export async function prepareBrandGroupFiles(input: {
  conversationId: string;
  actorMode: "brand" | "support";
  files: BrandGroupPickedFile[];
}): Promise<PreparedBrandGroupFile[]> {
  if (input.files.length < 1 || input.files.length > 10) throw new Error("Choose up to 10 files at a time.");
  const normalized = await Promise.all(input.files.map(normalizeBrandGroupPickedFile));
  if (normalized.reduce((total, file) => total + file.size, 0) > 250 * 1024 * 1024) {
    throw new Error("Choose files totaling no more than 250 MB.");
  }
  const { data, error } = await supabase.rpc("issue_3720_prepare_brand_group_files", {
    p_conversation_id: input.conversationId,
    p_actor_mode: input.actorMode,
    p_files: normalized.map((file) => ({ name: file.name, mime_type: file.mimeType, size_bytes: file.size })),
  });
  if (error) throw new Error(error.message || "Couldn't prepare those files");
  const prepared = (data ?? []) as { file_id: string; storage_path: string; name: string; mime_type: string; size_bytes: number }[];
  if (prepared.length !== normalized.length) throw new Error("Couldn't prepare every file");
  return prepared.map((record, index) => ({
    fileId: record.file_id,
    storagePath: record.storage_path,
    name: record.name,
    mimeType: record.mime_type,
    sizeBytes: Number(record.size_bytes),
    local: normalized[index],
  }));
}

async function uploadWeb(
  target: string,
  file: File,
  headers: Record<string, string>,
  onProgress: (fraction: number) => void,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", target);
    Object.entries(headers).forEach(([name, value]) => xhr.setRequestHeader(name, value));
    xhr.upload.onprogress = (event): void => {
      if (event.lengthComputable && event.total > 0) onProgress(event.loaded / event.total);
    };
    xhr.onerror = (): void => reject(new Error("Upload interrupted. Try again."));
    xhr.onload = (): void => (xhr.status >= 200 && xhr.status < 300) || xhr.status === 409
      ? resolve()
      : reject(new Error("Upload failed. Try again."));
    xhr.send(file);
  });
}

export async function uploadPreparedBrandGroupFile(
  prepared: PreparedBrandGroupFile,
  onProgress: (fraction: number) => void,
): Promise<void> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Sign in again to upload files.");
  const target = `${supabaseProjectUrl}/storage/v1/object/brand-group-file-staging/${prepared.storagePath.split("/").map(encodeURIComponent).join("/")}`;
  const headers = {
    Authorization: `Bearer ${token}`,
    apikey: supabasePublicAnonKey,
    "Content-Type": prepared.mimeType,
    "x-upsert": "false",
  };
  if (Platform.OS === "web") {
    if (!prepared.local.webFile) throw new Error("We couldn't read this browser file.");
    await uploadWeb(target, prepared.local.webFile, headers, onProgress);
  } else {
    const task = await createBinaryUploadTask(
      target,
      prepared.local.uri,
      { httpMethod: "POST", headers },
      (event) => onProgress(event.totalBytesExpectedToSend > 0 ? event.totalBytesSent / event.totalBytesExpectedToSend : 0),
    );
    const result = await task.uploadAsync() as { status?: number } | null;
    if (!result?.status || ((result.status < 200 || result.status >= 300) && result.status !== 409)) {
      throw new Error("Upload failed. Try again.");
    }
  }
  onProgress(1);
}

export async function finalizeBrandGroupFile(fileId: string): Promise<string | null> {
  const { data, error } = await supabase.functions.invoke("brand-group-files", {
    body: { action: "finalize", file_id: fileId },
  });
  if (error) throw new Error(error.message || "Couldn't finish this file");
  if (data?.code) throw new Error(data.code === "DRIVE_NOT_READY" ? "Your shared folder is still being prepared. Try again shortly." : "Couldn't finish this file. Try again.");
  return typeof data?.message_id === "string" ? data.message_id : null;
}

export async function uploadBrandGroupFile(
  prepared: PreparedBrandGroupFile,
  onProgress: (fraction: number) => void,
): Promise<string | null> {
  await uploadPreparedBrandGroupFile(prepared, onProgress);
  return await finalizeBrandGroupFile(prepared.fileId);
}

export async function brandGroupFilePreviewRequest(fileId: string): Promise<{ uri: string; headers: Record<string, string> }> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Sign in again to view this file.");
  return {
    uri: `${supabaseProjectUrl}/functions/v1/brand-group-files?file_id=${encodeURIComponent(fileId)}`,
    headers: { Authorization: `Bearer ${token}`, apikey: supabasePublicAnonKey },
  };
}

export async function createBrandMessageProductSignal(input: {
  clientRequestId: string;
  sourceId: string;
  signalKind: "question" | "account" | "bug" | "feature" | "trust_safety";
  title: string;
  problemStatement: string;
  productArea: string;
  userJourney: string;
  impactSummary: string;
  affectedPeople: number;
  priority: "low" | "normal" | "high" | "urgent";
  nextUpdateAt: string;
  nextStep: string;
  customerReplyDraft: string;
}): Promise<string> {
  const { data, error } = await supabase.rpc("issue_3720_create_brand_message_product_signal", {
    p_client_request_id: input.clientRequestId,
    p_source_id: input.sourceId,
    p_signal_kind: input.signalKind,
    p_title: input.title,
    p_problem_statement: input.problemStatement,
    p_product_area: input.productArea,
    p_user_journey: input.userJourney,
    p_impact_summary: input.impactSummary,
    p_affected_people: input.affectedPeople,
    p_priority: input.priority,
    p_next_update_at: input.nextUpdateAt,
    p_next_step: input.nextStep,
    p_customer_reply_draft: input.customerReplyDraft,
  });
  if (error) throw new Error(error.message || "Couldn't create the Product signal");
  return String(data);
}
