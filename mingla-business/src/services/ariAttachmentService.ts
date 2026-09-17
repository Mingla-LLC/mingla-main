/** Issue #3429 — typed client for Ari's private attachment lifecycle. */

import { Linking, Platform } from "react-native";

import type { AriPickedFile } from "../components/ari/ariAttachmentPickerShared";
import { readAriAttachmentBytes } from "./ariAttachmentFileReader";
import { supabase } from "./supabase";

export const ARI_ATTACHMENT_MAX_FILES = 5;
export const ARI_ATTACHMENT_MAX_FILE_BYTES = 10 * 1024 * 1024;
export const ARI_ATTACHMENT_MAX_TURN_BYTES = 25 * 1024 * 1024;

export type AriAttachmentState =
  | "preparing"
  | "uploading"
  | "ready"
  | "failed";

export type AriAttachmentFileType = "image" | "pdf" | "docx" | "text" | "csv";
export type AriAttachmentCategory = AriAttachmentFileType | "unsupported";

export interface AriAttachmentDraft {
  localId: string;
  attachmentId: string | null;
  uri: string;
  name: string;
  mimeType: string;
  fileType: AriAttachmentCategory;
  sizeBytes: number;
  state: AriAttachmentState;
  errorCode: string | null;
  errorMessage: string | null;
  webFile?: File;
  /** REWORK-1: true once the image was re-encoded on this device/browser. */
  prepared?: boolean;
  /** REWORK-1: what the picker returned, kept so a lost prepared copy can be rebuilt. */
  original?: AriPickedFile;
}

export interface AriSentAttachment {
  id: string;
  original_filename: string;
  verified_mime: string;
  file_type: AriAttachmentFileType;
  verified_size_bytes: number;
  display_order: number;
  state: "ready";
}

interface PrepareOutcome {
  attachment_id?: string;
  filename: string;
  state: "prepared" | "failed";
  upload_token?: string;
  code?: string;
  message?: string;
}

interface LifecycleOutcome {
  attachment_id: string;
  filename?: string;
  state: "ready" | "failed" | "prepared" | "uploaded" | "processing";
  verified_mime?: string;
  file_type?: AriAttachmentFileType;
  size_bytes?: number;
  code?: string;
  message?: string;
}

/**
 * REWORK-1 SC-R1-D4-2 — the one client copy table. It is identical to
 * `ARI_ATTACHMENT_FAILURE_COPY` in `supabase/functions/_shared/agentAttachmentFinalize.ts`;
 * both are pinned to `issue_3429_ari_failure_copy.snapshot.json`. Only
 * ENCRYPTED_FILE may mention password protection.
 */
export const ARI_ATTACHMENT_FAILURE_COPY: Readonly<Record<string, string>> = Object.freeze({
  UNSUPPORTED_TYPE: "That file isn’t supported. Add a JPG, PNG, WebP, HEIC, PDF, DOCX, TXT, or CSV file up to 10 MB.",
  MIME_MISMATCH: "That file isn’t supported. Add a JPG, PNG, WebP, HEIC, PDF, DOCX, TXT, or CSV file up to 10 MB.",
  FILE_TOO_LARGE: "That file is larger than 10 MB. Choose a smaller file.",
  DUPLICATE_FILE: "{filename} is already attached.",
  CONTEXT_LIMIT_EXCEEDED: "Ari couldn’t use this file because it contains too much information for one message. Remove it and attach a shorter version.",
  ENCRYPTED_FILE: "Ari couldn’t read {filename}. Remove password protection or choose a different file.",
  CORRUPT_FILE: "Ari couldn’t read {filename}. Choose a different file.",
  UNREADABLE_FILE: "Ari couldn’t read {filename}. Choose a different file.",
  DECOMPRESSION_BOMB: "Ari couldn’t read {filename}. Choose a different file.",
  IMAGE_UNREADABLE: "Ari couldn’t read {filename}. Choose a different file.",
  UPLOAD_INCOMPLETE: "{filename} couldn’t upload. Nothing was sent to Ari.",
  SIZE_MISMATCH: "{filename} couldn’t upload. Nothing was sent to Ari.",
  STORAGE_REJECTED: "Ari couldn’t save {filename}. Try again.",
  PREPARE_FAILED: "Ari couldn’t save {filename}. Try again.",
  PROCESSING_INTERRUPTED: "Ari couldn’t finish preparing {filename}. Try again.",
  IMAGE_DIMENSIONS_EXCEEDED: "{filename} is too large for Ari to prepare. Choose a smaller image.",
  IMAGE_SOURCE_TOO_LARGE: "{filename} is too large for Ari to prepare. Choose a smaller image.",
  HEIC_NOT_SUPPORTED_IN_BROWSER: "This browser can’t open HEIC photos. Save {filename} as a JPG, or attach it from the Mingla Business app on your phone.",
  ATTACHMENT_SCOPE_DENIED: "Ari couldn’t use {filename}. Remove it and attach it again.",
});

/** Unknown codes are infrastructure outcomes, never the person's file. */
export function stableFailure(code: string, name: string): string {
  const template = ARI_ATTACHMENT_FAILURE_COPY[code] ?? ARI_ATTACHMENT_FAILURE_COPY.PROCESSING_INTERRUPTED;
  return template.split("{filename}").join(name);
}

/** REWORK-1 section 3.3: seconds between status polls (62 s > the 60 s lease). */
export const ARI_ATTACHMENT_STATUS_POLL_DELAYS_MS = Object.freeze([2_000, 4_000, 8_000, 16_000, 32_000]);

function inferMime(name: string, declared: string | null): string {
  const supplied = declared?.toLowerCase().split(";", 1)[0].trim();
  if (supplied && supplied !== "application/octet-stream") return supplied;
  const extension = name.toLowerCase().split(".").pop() ?? "";
  switch (extension) {
    case "jpg":
    case "jpeg": return "image/jpeg";
    case "png": return "image/png";
    case "webp": return "image/webp";
    case "heic": return "image/heic";
    case "heif": return "image/heif";
    case "pdf": return "application/pdf";
    case "docx": return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    case "txt": return "text/plain";
    case "csv": return "text/csv";
    default: return "application/octet-stream";
  }
}

export function ariFileType(mime: string): AriAttachmentFileType | null {
  if (["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"].includes(mime)) {
    return "image";
  }
  if (mime === "application/pdf") return "pdf";
  if (mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") return "docx";
  if (mime === "text/plain") return "text";
  if (mime === "text/csv" || mime === "application/csv") return "csv";
  return null;
}

export function normalizePickedAriFile(
  picked: AriPickedFile,
  localId: string,
): AriAttachmentDraft {
  const mimeType = inferMime(picked.name, picked.mimeType);
  const fileType = ariFileType(mimeType) ?? "unsupported";
  return {
    localId,
    attachmentId: null,
    uri: picked.uri,
    name: picked.name,
    mimeType,
    fileType,
    sizeBytes: picked.size ?? 0,
    state: "preparing",
    errorCode: null,
    errorMessage: null,
    original: picked,
    ...(picked.webFile ? { webFile: picked.webFile } : {}),
  };
}

function failurePatch(code: string, name: string, attachmentId: string | null = null): Partial<AriAttachmentDraft> {
  return {
    state: "failed",
    attachmentId,
    errorCode: code,
    errorMessage: stableFailure(code, name),
  };
}

function waitMs(duration: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, duration));
}

function isTerminal(outcome: LifecycleOutcome | null): outcome is LifecycleOutcome & { state: "ready" | "failed" } {
  return outcome?.state === "ready" || outcome?.state === "failed";
}

async function invokeLifecycle(action: "finalize" | "status", attachmentId: string): Promise<LifecycleOutcome | null> {
  try {
    const { data, error } = await supabase.functions.invoke<{ outcome?: LifecycleOutcome }>(
      "agent-attachments",
      { body: { action, attachment_id: attachmentId } },
    );
    if (error || !data?.outcome) return null;
    return data.outcome;
  } catch {
    // Transport failure is not an outcome; the caller polls canonical status.
    return null;
  }
}

/**
 * Finalize one uploaded file. A non-2xx (including an edge CPU kill, 546) or a
 * transport error keeps the card "Uploading…" and polls `status` at 2, 4, 8,
 * 16 and 32 seconds, stopping at the first terminal state. If no terminal
 * state is ever observed, the card fails PROCESSING_INTERRUPTED with Retry.
 */
async function finalizeOne(attachmentId: string): Promise<LifecycleOutcome & { state: "ready" | "failed" } | null> {
  const finalized = await invokeLifecycle("finalize", attachmentId);
  if (isTerminal(finalized)) return finalized;
  for (const delay of ARI_ATTACHMENT_STATUS_POLL_DELAYS_MS) {
    await waitMs(delay);
    const polled = await invokeLifecycle("status", attachmentId);
    if (isTerminal(polled)) return polled;
  }
  return null;
}

export async function prepareAriAttachments(args: {
  drafts: AriAttachmentDraft[];
  brandId: string;
  conversationId: string | null;
  onUpdate: (localId: string, patch: Partial<AriAttachmentDraft>) => void;
}): Promise<void> {
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id;
  if (!userId) throw new Error("Sign in again to attach files.");
  const { data, error } = await supabase.functions.invoke<{
    outcomes?: PrepareOutcome[];
    code?: string;
    message?: string;
  }>("agent-attachments", {
    body: {
      action: "prepare",
      brand_id: args.brandId,
      conversation_id: args.conversationId,
      files: args.drafts.map((draft, index) => ({
        filename: draft.name,
        mime_type: draft.mimeType,
        size_bytes: draft.sizeBytes,
        display_order: index,
      })),
    },
  });
  if (error || !data?.outcomes) {
    args.drafts.forEach((draft) => args.onUpdate(draft.localId, data?.code === "ATTACHMENT_LIMIT_EXCEEDED"
      ? { state: "failed", errorCode: data.code, errorMessage: data.message ?? "You can attach up to 5 files and 25 MB in one message." }
      : failurePatch(data?.code && ARI_ATTACHMENT_FAILURE_COPY[data.code] ? data.code : "PREPARE_FAILED", draft.name)));
    return;
  }

  // REWORK-1: strictly sequential, one file at a time: upload -> finalize ->
  // next file. A sibling's failure never fails a valid file.
  for (let index = 0; index < args.drafts.length; index += 1) {
    const draft = args.drafts[index];
    const outcome = data.outcomes[index];
    if (!outcome || outcome.state !== "prepared" || !outcome.attachment_id || !outcome.upload_token) {
      args.onUpdate(draft.localId, failurePatch(outcome?.code ?? "PREPARE_FAILED", draft.name));
      continue;
    }
    const attachmentId = outcome.attachment_id;
    args.onUpdate(draft.localId, {
      attachmentId,
      state: "uploading",
      errorCode: null,
      errorMessage: null,
    });
    const storagePath = `${userId}/${args.brandId}/${attachmentId}/source`;
    let bytes: Uint8Array;
    try {
      bytes = await readAriAttachmentBytes({ uri: draft.uri, webFile: draft.webFile });
    } catch {
      args.onUpdate(draft.localId, failurePatch("UPLOAD_INCOMPLETE", draft.name, attachmentId));
      continue;
    }
    // D-3: never send a body whose length differs from what was declared.
    if (bytes.byteLength === 0 || bytes.byteLength !== draft.sizeBytes) {
      args.onUpdate(draft.localId, failurePatch("UPLOAD_INCOMPLETE", draft.name, attachmentId));
      continue;
    }
    try {
      const { error: uploadError } = await supabase.storage
        .from("ari-chat-attachments")
        .uploadToSignedUrl(storagePath, outcome.upload_token, bytes, {
          contentType: draft.mimeType,
          upsert: false,
        });
      if (uploadError) throw uploadError;
    } catch {
      args.onUpdate(draft.localId, failurePatch("UPLOAD_INCOMPLETE", draft.name, attachmentId));
      continue;
    }
    const finalized = await finalizeOne(attachmentId);
    if (finalized?.state === "ready") {
      args.onUpdate(draft.localId, {
        state: "ready",
        attachmentId,
        mimeType: finalized.verified_mime ?? draft.mimeType,
        fileType: finalized.file_type ?? draft.fileType,
        sizeBytes: finalized.size_bytes ?? draft.sizeBytes,
        errorCode: null,
        errorMessage: null,
      });
    } else {
      const code = finalized?.code ?? "PROCESSING_INTERRUPTED";
      args.onUpdate(draft.localId, failurePatch(code, draft.name, attachmentId));
    }
  }
}

export async function discardAriAttachment(attachmentId: string): Promise<void> {
  const { error } = await supabase.functions.invoke("agent-attachments", {
    body: { action: "discard", attachment_id: attachmentId },
  });
  if (error) throw error;
}

export async function openAriAttachment(attachmentId: string): Promise<void> {
  const { data, error } = await supabase.functions.invoke<{ signed_url?: string }>(
    "agent-attachments",
    { body: { action: "open", attachment_id: attachmentId } },
  );
  if (error || !data?.signed_url) throw new Error("Couldn’t open that attachment.");
  if (Platform.OS === "web" && typeof window !== "undefined") {
    window.open(data.signed_url, "_blank", "noopener,noreferrer");
    return;
  }
  await Linking.openURL(data.signed_url);
}
