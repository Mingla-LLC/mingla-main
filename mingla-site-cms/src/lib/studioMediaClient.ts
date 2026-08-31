export const STUDIO_MEDIA_MAX_BYTES = 20 * 1024 * 1024;
export const STUDIO_MEDIA_MAX_PIXELS = 40_000_000;
export const STUDIO_MEDIA_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

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
  state: "UPLOADING" | "PROCESSING" | "READY" | "REJECTED" | "RETRYABLE_FAILED";
  rejection_code: string | null;
}

interface StudioMediaBindings {
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

export function validateStudioMediaFile(file: Pick<File, "type" | "size">): string | null {
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

function stateProgress(status: MediaStatus): StudioMediaProgress {
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
      message: status.rejection_code ?? "This image can’t be used.",
    };
  }
  if (status.state === "RETRYABLE_FAILED") {
    return {
      phase: "retryable_failed",
      progress: 1,
      mediaId: status.media_id,
      message: "Processing paused. Retry this image.",
    };
  }
  return {
    phase: "processing",
    progress: 0.9,
    mediaId: status.media_id,
    message: "Removing metadata and creating responsive images…",
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
  if (grant.maximum_bytes !== STUDIO_MEDIA_MAX_BYTES) {
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
    message: "Checking and preparing this image…",
  });
  try {
    const completed = await envelope<MediaStatus>(
      await bindings.request(`/api/mingla/media/${grant.media_id}/complete`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ checksum, bytes: file.size }),
      }),
    );
    const immediate = stateProgress(completed);
    onProgress(immediate);
    if (immediate.phase !== "processing") return immediate;
  } catch (error) {
    const replayed = error instanceof Error && error.message === "INVALID_STATE";
    const rejected = error instanceof Error && error.message === "MEDIA_REJECTED";
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
    const next = stateProgress(status);
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
