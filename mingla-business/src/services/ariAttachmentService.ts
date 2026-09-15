/** Issue #3429 — typed client for Ari's private attachment lifecycle. */

import { Linking, Platform } from "react-native";

import type { AriPickedFile } from "../components/ari/ariAttachmentPicker";
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

interface FinalizeOutcome {
  attachment_id: string;
  filename?: string;
  state: "ready" | "failed";
  verified_mime?: string;
  file_type?: AriAttachmentFileType;
  size_bytes?: number;
  code?: string;
  message?: string;
}

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
    sizeBytes: picked.size,
    state: "preparing",
    errorCode: null,
    errorMessage: null,
    ...(picked.webFile ? { webFile: picked.webFile } : {}),
  };
}

async function uploadBody(draft: AriAttachmentDraft): Promise<Blob | File> {
  if (draft.webFile) return draft.webFile;
  const result = await fetch(draft.uri);
  if (!result.ok) throw new Error("local_file_read_failed");
  return result.blob();
}

function stableFailure(code: string, name: string): string {
  if (code === "CONTEXT_LIMIT_EXCEEDED") {
    return "Ari couldn’t use this file because it contains too much information for one message. Remove it and attach a shorter version.";
  }
  if (code === "UNSUPPORTED_TYPE" || code === "MIME_MISMATCH") {
    return "That file isn’t supported. Add a JPG, PNG, WebP, HEIC, PDF, DOCX, TXT, or CSV file up to 10 MB.";
  }
  if (code === "FILE_TOO_LARGE") return "That file is larger than 10 MB. Choose a smaller file.";
  if (code === "DUPLICATE_FILE") return `${name} is already attached.`;
  return `Ari couldn’t read ${name}. Remove password protection or choose a different file.`;
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
    const message = data?.message ?? "Couldn’t prepare these files. Try again.";
    args.drafts.forEach((draft) => args.onUpdate(draft.localId, {
      state: "failed",
      errorCode: data?.code ?? "PREPARE_FAILED",
      errorMessage: message,
    }));
    return;
  }

  const readyForFinalize: { draft: AriAttachmentDraft; attachmentId: string }[] = [];
  for (let index = 0; index < args.drafts.length; index += 1) {
    const draft = args.drafts[index];
    const outcome = data.outcomes[index];
    if (!outcome || outcome.state !== "prepared" || !outcome.attachment_id || !outcome.upload_token) {
      const code = outcome?.code ?? "PREPARE_FAILED";
      args.onUpdate(draft.localId, {
        state: "failed",
        errorCode: code,
        errorMessage: outcome?.message ?? stableFailure(code, draft.name),
      });
      continue;
    }
    args.onUpdate(draft.localId, {
      attachmentId: outcome.attachment_id,
      state: "uploading",
      errorCode: null,
      errorMessage: null,
    });
    const storagePath = `${userId}/${args.brandId}/${outcome.attachment_id}/source`;
    try {
      const body = await uploadBody(draft);
      const { error: uploadError } = await supabase.storage
        .from("ari-chat-attachments")
        .uploadToSignedUrl(storagePath, outcome.upload_token, body, {
          contentType: draft.mimeType,
        });
      if (uploadError) throw uploadError;
      readyForFinalize.push({ draft, attachmentId: outcome.attachment_id });
    } catch {
      args.onUpdate(draft.localId, {
        state: "failed",
        attachmentId: outcome.attachment_id,
        errorCode: "UPLOAD_INCOMPLETE",
        errorMessage: `${draft.name} couldn’t upload. Nothing was sent to Ari.`,
      });
    }
  }
  if (readyForFinalize.length === 0) return;
  const { data: finalized, error: finalizeError } = await supabase.functions.invoke<{
    outcomes?: FinalizeOutcome[];
  }>("agent-attachments", {
    body: {
      action: "finalize",
      attachment_ids: readyForFinalize.map((entry) => entry.attachmentId),
    },
  });
  if (finalizeError || !finalized?.outcomes) {
    readyForFinalize.forEach(({ draft, attachmentId }) => args.onUpdate(draft.localId, {
      state: "failed",
      attachmentId,
      errorCode: "FINALIZE_FAILED",
      errorMessage: `Ari couldn’t read ${draft.name}. Remove password protection or choose a different file.`,
    }));
    return;
  }
  readyForFinalize.forEach(({ draft, attachmentId }) => {
    const outcome = finalized.outcomes?.find((item) => item.attachment_id === attachmentId);
    if (outcome?.state === "ready") {
      args.onUpdate(draft.localId, {
        state: "ready",
        attachmentId,
        mimeType: outcome.verified_mime ?? draft.mimeType,
        fileType: outcome.file_type ?? draft.fileType,
        sizeBytes: outcome.size_bytes ?? draft.sizeBytes,
        errorCode: null,
        errorMessage: null,
      });
    } else {
      const code = outcome?.code ?? "FINALIZE_FAILED";
      args.onUpdate(draft.localId, {
        state: "failed",
        attachmentId,
        errorCode: code,
        errorMessage: outcome?.message ?? stableFailure(code, draft.name),
      });
    }
  });
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
