/**
 * #4304 — media speed (B). The sender's own files show in the Brand-group
 * thread the moment they are picked, while they upload and save to the
 * shared Drive folder. Each pending item carries the prepared file id; the
 * server message for that file has the same `file_id`, so the thread hides a
 * pending item in the SAME render that first contains its server message —
 * never both (no duplicate) and never neither (no flicker). A failed item stays
 * visible with Retry until the sender retries or removes it — never a silent
 * drop.
 *
 * Pure: no React, no expo.
 */

export type BrandGroupPendingUploadState = "queued" | "uploading" | "finalizing" | "complete" | "failed";

export interface BrandGroupPendingUpload {
  fileId: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  /** The local file the phone or browser picked; the bubble draws it. */
  localUri: string;
  kind: "image" | "video" | "file";
  state: BrandGroupPendingUploadState;
  progress: number;
  /** The bytes reached storage; a retry only re-runs the Drive save. */
  uploaded: boolean;
  error: string | null;
}

export function brandGroupPendingKind(mimeType: string): BrandGroupPendingUpload["kind"] {
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("video/")) return "video";
  return "file";
}

export function newBrandGroupPendingUpload(input: {
  fileId: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  localUri: string;
}): BrandGroupPendingUpload {
  return {
    ...input,
    kind: brandGroupPendingKind(input.mimeType),
    state: "queued",
    progress: 0,
    uploaded: false,
    error: null,
  };
}

/** The pending items the thread draws: every one whose server message has not arrived yet. */
export function visibleBrandGroupPendingUploads(
  uploads: readonly BrandGroupPendingUpload[],
  messages: readonly { file_id?: string | null }[],
): BrandGroupPendingUpload[] {
  if (uploads.length === 0) return [];
  const delivered = new Set(messages.flatMap((message) => message.file_id ? [message.file_id] : []));
  return uploads.filter((upload) => !delivered.has(upload.fileId));
}

/**
 * Drops items whose server message is in the thread. Returns the same array
 * when nothing changed, so a state setter can skip the re-render.
 */
export function pruneDeliveredBrandGroupUploads(
  uploads: BrandGroupPendingUpload[],
  messages: readonly { file_id?: string | null }[],
): BrandGroupPendingUpload[] {
  const visible = visibleBrandGroupPendingUploads(uploads, messages);
  return visible.length === uploads.length ? uploads : visible;
}

export function brandGroupPendingStatus(upload: BrandGroupPendingUpload): string {
  switch (upload.state) {
    case "queued":
      return "Waiting to send";
    case "uploading":
      return `${Math.round(upload.progress * 100)}% uploaded`;
    case "finalizing":
      return "Saving to the shared Drive folder…";
    case "complete":
      return "Sending…";
    case "failed":
      return upload.error || "Couldn't share this file. Try again.";
    default: {
      const exhaustive: never = upload.state;
      return exhaustive;
    }
  }
}
