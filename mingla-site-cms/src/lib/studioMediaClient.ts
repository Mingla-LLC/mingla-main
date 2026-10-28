export const STUDIO_MEDIA_MAX_BYTES = 20 * 1024 * 1024;
export const STUDIO_MEDIA_MAX_PIXELS = 40_000_000;
export const STUDIO_MEDIA_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;
/*
 * #2829 W6 (AD-9) — video. A film or hero loop is uploaded as a standard
 * file video (MP4, H.264/AAC, fast start, up to 50 MB) unless Core offers
 * stream video, which also takes MOV, M4V and WebM up to 100 MB.
 */
export const STUDIO_VIDEO_MAX_BYTES = 50 * 1024 * 1024;
export const STUDIO_STREAM_VIDEO_MAX_BYTES = 100 * 1024 * 1024;
export const STUDIO_STREAM_VIDEO_TYPES = ["video/mp4", "video/quicktime", "video/x-m4v", "video/webm"] as const;
const TUS_CHUNK_BYTES = 8 * 1024 * 1024;

export function isStudioVideoFile(file: Pick<File, "type">): boolean {
  return file.type.startsWith("video/");
}

/** The plain sentence for a refusal code (never a bare code). */
export function studioRejectionMessage(code: string | null, video: boolean): string {
  switch (code) {
    case "VIDEO_NOT_FASTSTART":
      return "Export the video with fast start (web optimised) and upload again";
    case "VIDEO_CODEC":
      return "Export the video as MP4 with H.264 video and AAC audio, and upload again";
    case "TOO_LARGE":
      return video ? "Videos can be up to 50 MB" : "Images can be up to 20 MB";
    case "MIME_MISMATCH":
    case "TYPE_NOT_ALLOWED":
      return video ? "Upload the video as an MP4 file" : "Upload a JPEG, PNG or WebP image";
    case "DIMENSIONS_TOO_LARGE":
      return "Images can be up to 40 megapixels";
    case "PROCESSING_FAILED":
      return video ? "This video could not be prepared. Try exporting it again." : "This image could not be prepared. Try another copy.";
    default:
      return video ? "This video can’t be used." : "This image can’t be used.";
  }
}

export type StudioMediaPhase =
  | "uploading"
  | "processing"
  | "ready"
  | "rejected"
  | "expired"
  | "replayed"
  | "retryable_failed";

export interface StudioMediaProgress {
  phase: StudioMediaPhase;
  progress: number;
  mediaId: string | null;
  message: string;
}

interface UploadGrant {
  media_id: string;
  upload_url: string;
  required_headers: Record<string, string>;
  maximum_bytes: number;
}

interface MediaStatus {
  media_id: string;
  state:
    | "UPLOADING"
    | "QUARANTINED"
    | "PROCESSING"
    | "READY"
    | "TOMBSTONED"
    | "REJECTED"
    | "RETRYABLE_FAILED";
  rejection_code: string | null;
}

export interface StudioMediaBindings {
  request: (url: string, init?: RequestInit) => Promise<Response>;
  put: (
    url: string,
    file: File,
    headers: Record<string, string>,
    onProgress: (fraction: number) => void,
  ) => Promise<void>;
  digest: (file: File) => Promise<string>;
  sleep: (milliseconds: number) => Promise<void>;
}

export interface StudioMediaLibraryItem {
  id: string;
  filename: string;
  state:
    | "UPLOADING"
    | "QUARANTINED"
    | "PROCESSING"
    | "READY"
    | "TOMBSTONED"
    | "REJECTED"
    | "RETRYABLE_FAILED";
  width: number | null;
  height: number | null;
  rejection_code: string | null;
  thumbnail_url: string | null;
  in_use: boolean;
  recoverable_until: string | null;
}

export interface StudioMediaLibraryTarget {
  id: string;
  pageId: string;
  pageTitle: string;
  pageRole: string;
  expectedRevision: string;
  blockIndex: number;
  field: "media" | "images";
  imageIndex: number | null;
  label: string;
  currentMediaId: string | null;
  currentAlt: string;
  decorativeOnly: boolean;
}

export interface StudioMediaLibrary {
  media: StudioMediaLibraryItem[];
  targets: StudioMediaLibraryTarget[];
  close_url: "/admin/collections/pages";
}

export interface StudioMediaAttachment {
  page_id: string;
  media_id: string;
  draft_revision: string;
  state: 8;
  return_url: string;
}

function defaultPut(
  url: string,
  file: File,
  headers: Record<string, string>,
  onProgress: (fraction: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("PUT", url, true);
    for (const [name, value] of Object.entries(headers)) {
      request.setRequestHeader(name, value);
    }
    request.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) {
        onProgress(event.loaded / event.total);
      }
    };
    request.onerror = () => reject(new Error("UPLOAD_FAILED"));
    request.onload = () => {
      if (request.status >= 200 && request.status < 300) resolve();
      else if (request.status === 401 || request.status === 403)
        reject(new Error("UPLOAD_EXPIRED"));
      else reject(new Error("UPLOAD_FAILED"));
    };
    request.send(file);
  });
}

async function defaultDigest(file: File): Promise<string> {
  const result = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return [...new Uint8Array(result)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

const DEFAULT_BINDINGS: StudioMediaBindings = {
  request: (url, init) => fetch(url, init),
  put: defaultPut,
  digest: defaultDigest,
  sleep: (milliseconds) =>
    new Promise((resolve) => window.setTimeout(resolve, milliseconds)),
};

async function envelope<T>(response: Response): Promise<T> {
  const body = (await response.json().catch(() => null)) as
    | { ok?: boolean; data?: T; error?: { code?: string } }
    | null;
  if (response.ok && body?.ok && body.data !== undefined) return body.data;
  throw new Error(body?.error?.code ?? "SERVICE_TEMPORARILY_UNAVAILABLE");
}

export function isStudioSessionEnded(error: unknown): boolean {
  return error instanceof Error &&
    ["SESSION_EXPIRED", "FORBIDDEN"].includes(error.message);
}

export async function loadStudioMediaLibrary(
  bindings: Pick<StudioMediaBindings, "request"> = DEFAULT_BINDINGS,
): Promise<StudioMediaLibrary> {
  return envelope<StudioMediaLibrary>(
    await bindings.request("/api/mingla/media-library", { method: "GET" }),
  );
}

export async function attachStudioMedia(
  mediaId: string,
  target: StudioMediaLibraryTarget,
  input: { altText: string; decorative: boolean },
  bindings: Pick<StudioMediaBindings, "request"> = DEFAULT_BINDINGS,
): Promise<StudioMediaAttachment> {
  if (
    !/^[0-9a-f-]{36}$/i.test(mediaId) ||
    !canSelectStudioMedia({
      state: "READY",
      altText: input.altText,
      decorative: input.decorative,
    }) ||
    (target.decorativeOnly && !input.decorative)
  ) {
    throw new Error("VALIDATION_FAILED");
  }
  const attachment = await envelope<StudioMediaAttachment>(
    await bindings.request(
      `/api/mingla/media/${encodeURIComponent(mediaId)}/attach`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          page_id: target.pageId,
          expected_revision: target.expectedRevision,
          block_index: target.blockIndex,
          field: target.field,
          image_index: target.imageIndex,
          alt: input.decorative ? "" : input.altText.trim(),
          decorative: input.decorative,
        }),
      },
    ),
  );
  const expectedReturn =
    `/admin/collections/pages/${encodeURIComponent(target.pageId)}`;
  if (
    attachment.page_id !== target.pageId ||
    attachment.media_id !== mediaId ||
    attachment.state !== 8 ||
    attachment.return_url !== expectedReturn
  ) {
    throw new Error("VALIDATION_FAILED");
  }
  return attachment;
}

export async function removeUnusedStudioMedia(
  mediaId: string,
  bindings: Pick<StudioMediaBindings, "request"> = DEFAULT_BINDINGS,
): Promise<void> {
  await envelope(
    await bindings.request(
      `/api/mingla/media/${encodeURIComponent(mediaId)}/tombstone`,
      { method: "POST" },
    ),
  );
}

/**
 * #2829 W11 (A11) — why a removal was refused, in words the owner can act on.
 * Nothing is removed in any of these cases.
 */
export function studioMediaRemovalRefusal(error: unknown): string {
  const code = error instanceof Error ? error.message : "";
  if (code === "MEDIA_IN_USE_DRAFT") {
    return "This is still used in your draft website. Take it off the page or entry that uses it, then remove it. Nothing was removed.";
  }
  if (code === "MEDIA_IN_USE_LIVE") {
    return "Your live website (or a version you can restore) still shows this. Publish a version without it, then remove it. Nothing was removed.";
  }
  if (code === "SERVICE_TEMPORARILY_UNAVAILABLE") {
    return "We couldn't check where this is used right now, so nothing was removed. Try again in a moment.";
  }
  return "This couldn't be removed. Nothing was removed; refresh and try again.";
}

export async function restoreStudioMedia(
  mediaId: string,
  bindings: Pick<StudioMediaBindings, "request"> = DEFAULT_BINDINGS,
): Promise<void> {
  if (!/^[0-9a-f-]{36}$/i.test(mediaId)) {
    throw new Error("VALIDATION_FAILED");
  }
  await envelope(
    await bindings.request(
      `/api/mingla/media/${encodeURIComponent(mediaId)}/restore`,
      { method: "POST" },
    ),
  );
}

export function isStudioMediaRecoverable(
  recoverableUntil: string | null,
  nowMs = Date.now(),
): boolean {
  if (!recoverableUntil) return false;
  const deadline = Date.parse(recoverableUntil);
  return Number.isFinite(deadline) && deadline > nowMs;
}

export function validateStudioMediaFile(
  file: Pick<File, "type" | "size">,
  options: { stream?: boolean } = {},
): string | null {
  if (isStudioVideoFile(file)) {
    if (options.stream) {
      if (!STUDIO_STREAM_VIDEO_TYPES.includes(file.type as (typeof STUDIO_STREAM_VIDEO_TYPES)[number])) {
        return "Choose an MP4, MOV, M4V or WebM video.";
      }
      if (!Number.isInteger(file.size) || file.size < 1 || file.size > STUDIO_STREAM_VIDEO_MAX_BYTES) {
        return "Choose a video no larger than 100 MB.";
      }
      return null;
    }
    if (file.type !== "video/mp4") return "Choose an MP4 video.";
    if (!Number.isInteger(file.size) || file.size < 1 || file.size > STUDIO_VIDEO_MAX_BYTES) {
      return "Choose a video no larger than 50 MB.";
    }
    return null;
  }
  if (!STUDIO_MEDIA_TYPES.includes(file.type as (typeof STUDIO_MEDIA_TYPES)[number])) {
    return "Choose a JPEG, PNG or WebP image.";
  }
  if (!Number.isInteger(file.size) || file.size < 1 || file.size > STUDIO_MEDIA_MAX_BYTES) {
    return "Choose an image no larger than 20 MB.";
  }
  return null;
}

export function canSelectStudioMedia(input: {
  state: string;
  altText: string;
  decorative: boolean;
}): boolean {
  return input.state === "READY" &&
    (input.decorative || input.altText.trim().length > 0);
}

function stateProgress(status: MediaStatus, video = false): StudioMediaProgress {
  if (status.state === "READY") {
    return {
      phase: "ready",
      progress: 1,
      mediaId: status.media_id,
      message: "Ready to use",
    };
  }
  if (status.state === "REJECTED") {
    return {
      phase: "rejected",
      progress: 1,
      mediaId: status.media_id,
      message: studioRejectionMessage(status.rejection_code, video),
    };
  }
  if (status.state === "RETRYABLE_FAILED") {
    return {
      phase: "retryable_failed",
      progress: 1,
      mediaId: status.media_id,
      message: video ? "Processing paused. Retry this video." : "Processing paused. Retry this image.",
    };
  }
  return {
    phase: "processing",
    progress: 0.9,
    mediaId: status.media_id,
    message: video ? "Checking the video and preparing it to stream…" : "Removing metadata and creating responsive images…",
  };
}

export async function uploadStudioMedia(
  file: File,
  onProgress: (state: StudioMediaProgress) => void,
  bindings: StudioMediaBindings = DEFAULT_BINDINGS,
): Promise<StudioMediaProgress> {
  const validation = validateStudioMediaFile(file);
  if (validation) throw new Error(validation);
  const grant = await envelope<UploadGrant>(
    await bindings.request("/api/mingla/media/upload-grants", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        filename: file.name,
        content_type: file.type,
        bytes: file.size,
      }),
    }),
  );
  const video = isStudioVideoFile(file);
  if (grant.maximum_bytes !== (video ? STUDIO_VIDEO_MAX_BYTES : STUDIO_MEDIA_MAX_BYTES)) {
    throw new Error("UPLOAD_GRANT_INVALID");
  }
  const uploading: StudioMediaProgress = {
    phase: "uploading",
    progress: 0,
    mediaId: grant.media_id,
    message: "Uploading to the private quarantine area…",
  };
  onProgress(uploading);
  try {
    await bindings.put(
      grant.upload_url,
      file,
      grant.required_headers,
      (fraction) =>
        onProgress({ ...uploading, progress: Math.min(0.8, fraction * 0.8) }),
    );
  } catch (error) {
    const expired = error instanceof Error && error.message === "UPLOAD_EXPIRED";
    const failure: StudioMediaProgress = {
      phase: expired ? "expired" : "retryable_failed",
      progress: 0,
      mediaId: grant.media_id,
      message: expired
        ? "The upload grant expired. Choose Retry for a fresh grant."
        : "The upload stopped. Check your connection and retry.",
    };
    onProgress(failure);
    return failure;
  }
  const checksum = await bindings.digest(file);
  onProgress({
    phase: "processing",
    progress: 0.85,
    mediaId: grant.media_id,
    message: video ? "Checking and preparing this video…" : "Checking and preparing this image…",
  });
  try {
    const completed = await envelope<MediaStatus>(
      await bindings.request(`/api/mingla/media/${grant.media_id}/complete`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ checksum, bytes: file.size }),
      }),
    );
    const immediate = stateProgress(completed, video);
    onProgress(immediate);
    if (immediate.phase !== "processing") return immediate;
  } catch (error) {
    if (isStudioSessionEnded(error)) throw error;
    const replayed = error instanceof Error && error.message === "INVALID_STATE";
    const rejected = error instanceof Error && error.message === "MEDIA_REJECTED";
    // #2829 W6 — a refusal names its reason (fast start, codec, size…).
    if (rejected) {
      let reason: MediaStatus | null = null;
      try {
        reason = await envelope<MediaStatus>(
          await bindings.request(`/api/mingla/media/${grant.media_id}`, { method: "GET" }),
        );
      } catch {
        reason = null; // the generic sentence below still names what is accepted
      }
      if (reason?.state === "REJECTED") {
        const named = stateProgress(reason, video);
        onProgress(named);
        return named;
      }
    }
    const failure: StudioMediaProgress = {
      phase: replayed ? "replayed" : rejected ? "rejected" : "retryable_failed",
      progress: 1,
      mediaId: grant.media_id,
      message: replayed
        ? "This one-time upload was already completed. Replace the image to continue."
        : rejected
          ? "This image can’t be used. Replace it with a JPEG, PNG or WebP within the limits."
        : "Processing could not finish. Retry this image.",
    };
    onProgress(failure);
    return failure;
  }
  for (let attempt = 0; attempt < 10; attempt += 1) {
    await bindings.sleep(1_500);
    const status = await envelope<MediaStatus>(
      await bindings.request(`/api/mingla/media/${grant.media_id}`, {
        method: "GET",
      }),
    );
    const next = stateProgress(status, video);
    onProgress(next);
    if (next.phase !== "processing") return next;
  }
  const timedOut: StudioMediaProgress = {
    phase: "retryable_failed",
    progress: 1,
    mediaId: grant.media_id,
    message: "Processing is taking longer than expected. Retry the status check.",
  };
  onProgress(timedOut);
  return timedOut;
}

/** #2829 W6 — does Core offer stream video for this site? (false on any error) */
export async function loadStudioStreamCapability(
  bindings: Pick<StudioMediaBindings, "request"> = DEFAULT_BINDINGS,
): Promise<boolean> {
  try {
    const data = await envelope<{ stream_video?: boolean }>(
      await bindings.request("/api/mingla/videos/capability", { method: "GET" }),
    );
    return data.stream_video === true;
  } catch {
    return false;
  }
}

interface StreamIntent {
  media_id: string;
  maximum_bytes: number;
  upload: { endpoint: string; library_id: string; video_guid: string; signature: string; expires_at: number };
}

const base64Utf8 = (value: string) => btoa(String.fromCharCode(...new TextEncoder().encode(value)));

/**
 * The resumable (TUS 1.0) upload straight to the stream service, with the
 * signature Core presigned. The file is sent in 8 MB pieces; the service's
 * own offset is trusted, so a dropped piece is resent from where it stopped.
 */
export async function tusUpload(
  intent: StreamIntent,
  file: File,
  onProgress: (fraction: number) => void,
  request: StudioMediaBindings["request"],
): Promise<void> {
  if (intent.upload.endpoint !== "https://video.bunnycdn.com/tusupload") throw new Error("UPLOAD_GRANT_INVALID");
  const auth = {
    AuthorizationSignature: intent.upload.signature,
    AuthorizationExpire: String(intent.upload.expires_at),
    VideoId: intent.upload.video_guid,
    LibraryId: intent.upload.library_id,
    "Tus-Resumable": "1.0.0",
  };
  const created = await request(intent.upload.endpoint, {
    method: "POST",
    headers: {
      ...auth,
      "Upload-Length": String(file.size),
      "Upload-Metadata": `filetype ${base64Utf8(file.type)},title ${base64Utf8(file.name || "video")}`,
    },
  });
  const location = created.headers.get("location");
  if (created.status !== 201 || !location) throw new Error(created.status === 401 || created.status === 403 ? "UPLOAD_EXPIRED" : "UPLOAD_FAILED");
  const target = new URL(location, intent.upload.endpoint);
  if (target.origin !== "https://video.bunnycdn.com") throw new Error("UPLOAD_FAILED");
  let offset = 0;
  let stalls = 0;
  while (offset < file.size) {
    const piece = file.slice(offset, Math.min(offset + TUS_CHUNK_BYTES, file.size));
    const sent = await request(target.toString(), {
      method: "PATCH",
      headers: { ...auth, "Upload-Offset": String(offset), "Content-Type": "application/offset+octet-stream" },
      body: piece,
    });
    if (sent.status === 401 || sent.status === 403) throw new Error("UPLOAD_EXPIRED");
    const next = Number(sent.headers.get("upload-offset"));
    if (sent.status !== 204 || !Number.isInteger(next) || next < offset || next > file.size) throw new Error("UPLOAD_FAILED");
    stalls = next === offset ? stalls + 1 : 0;
    if (stalls > 3) throw new Error("UPLOAD_FAILED");
    offset = next;
    onProgress(offset / file.size);
  }
}

/** #2829 W6 — a video through stream hosting: intent (Core), upload (stream service), status (Core). */
export async function uploadStudioStreamVideo(
  file: File,
  onProgress: (state: StudioMediaProgress) => void,
  bindings: StudioMediaBindings = DEFAULT_BINDINGS,
): Promise<StudioMediaProgress> {
  const validation = validateStudioMediaFile(file, { stream: true });
  if (validation) throw new Error(validation);
  const intent = await envelope<StreamIntent>(
    await bindings.request("/api/mingla/videos/stream-intent", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ filename: file.name, content_type: file.type, bytes: file.size }),
    }),
  );
  if (intent.maximum_bytes !== STUDIO_STREAM_VIDEO_MAX_BYTES) throw new Error("UPLOAD_GRANT_INVALID");
  const uploading: StudioMediaProgress = {
    phase: "uploading",
    progress: 0,
    mediaId: intent.media_id,
    message: "Uploading the video…",
  };
  onProgress(uploading);
  try {
    await tusUpload(intent, file, (fraction) => onProgress({ ...uploading, progress: Math.min(0.8, fraction * 0.8) }), bindings.request);
  } catch (error) {
    const expired = error instanceof Error && error.message === "UPLOAD_EXPIRED";
    const failure: StudioMediaProgress = {
      phase: expired ? "expired" : "retryable_failed",
      progress: 0,
      mediaId: intent.media_id,
      message: expired ? "The upload link expired. Choose the video again." : "The upload stopped. Check your connection and retry.",
    };
    onProgress(failure);
    return failure;
  }
  // Encoding can take a few minutes for a long film.
  for (let attempt = 0; attempt < 120; attempt += 1) {
    await bindings.sleep(attempt === 0 ? 1_000 : 5_000);
    const status = await envelope<MediaStatus>(
      await bindings.request(`/api/mingla/videos/${intent.media_id}/stream-status`, { method: "GET" }),
    );
    const next = stateProgress(status, true);
    onProgress(next);
    if (next.phase !== "processing") return next;
  }
  const timedOut: StudioMediaProgress = {
    phase: "retryable_failed",
    progress: 1,
    mediaId: intent.media_id,
    message: "The video is still being prepared. Check back in a few minutes.",
  };
  onProgress(timedOut);
  return timedOut;
}
