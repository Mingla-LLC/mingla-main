import type { PayloadRequest } from "payload";
import { callCore, getCore } from "./gateway";
import { studioMediaGrantRequest } from "./studioRequestAuth";
import { MAX_STREAM_VIDEO_UPLOAD_BYTES, isStreamVideoHost } from "../contracts/generated/video.ts";

/*
 * #2829 W6 (AD-9) — Studio's stream-video path (production, when Bunny is
 * configured on Core).
 *
 * 1. `streamVideoCapability`: does Core offer stream video for this site?
 *    (No → Studio uploads the film as a standard file video instead.)
 * 2. `createStreamUploadIntent`: Core creates the Bunny video and presigns a
 *    resumable upload; the media record is created here as UPLOADING with
 *    kind `stream_video`. The browser sends the file straight to Bunny.
 * 3. `refreshStreamVideo`: Core reads the video's status; when Bunny has
 *    finished, the media record becomes READY with its MP4 rendition on the
 *    stream CDN host, its length and size (a failed encode is REJECTED).
 *
 * Every call is signed for the editor's own site; Core binds it again. Bunny
 * keys never reach the CMS or the browser.
 */
export const STREAM_UPLOAD_TYPES = new Set(["video/mp4", "video/quicktime", "video/x-m4v", "video/webm"]);

type Actor = { tenantId?: string; siteId?: string; id?: string };

export type CoreBinding = {
  get: (path: string, siteId: string, operationId: string) => Promise<Record<string, unknown>>;
  post: (path: string, siteId: string, operationId: string, payload: Record<string, unknown>) => Promise<Record<string, unknown>>;
};

const defaultCore: CoreBinding = { get: getCore, post: callCore };

function actorOf(req: PayloadRequest): Required<Pick<Actor, "tenantId" | "siteId">> & Actor {
  const actor = req.user as Actor | null;
  if (!actor?.tenantId || !actor.siteId) throw new Error("FORBIDDEN");
  return actor as Required<Pick<Actor, "tenantId" | "siteId">> & Actor;
}

export async function streamVideoCapability(req: PayloadRequest, core: CoreBinding = defaultCore): Promise<{ stream_video: boolean }> {
  const actor = actorOf(req);
  try {
    const data = await core.get(`/internal/v1/sites/${actor.siteId}/videos/capability`, actor.siteId, crypto.randomUUID());
    return { stream_video: data.stream_video === true };
  } catch {
    // Core unreachable or stream video off: standard file video always works.
    return { stream_video: false };
  }
}

export async function createStreamUploadIntent(
  req: PayloadRequest,
  input: { filename: string; content_type: string; bytes: number },
  core: CoreBinding = defaultCore,
) {
  const actor = actorOf(req);
  if (
    !STREAM_UPLOAD_TYPES.has(input.content_type) ||
    !Number.isInteger(input.bytes) || input.bytes < 1 || input.bytes > MAX_STREAM_VIDEO_UPLOAD_BYTES
  ) throw new Error("MEDIA_REJECTED");
  let intent: Record<string, unknown>;
  try {
    intent = await core.post(`/internal/v1/sites/${actor.siteId}/videos/upload-intent`, actor.siteId, crypto.randomUUID(), {
      content_type: input.content_type,
      bytes: input.bytes,
    });
  } catch (error) {
    if (error instanceof Error && error.message === "STREAM_VIDEO_UNAVAILABLE") throw error;
    throw new Error("SERVICE_TEMPORARILY_UNAVAILABLE");
  }
  const videoId = String(intent.video_id ?? "");
  const upload = intent.upload as Record<string, unknown> | undefined;
  if (!/^[0-9a-f-]{36}$/i.test(videoId) || !upload || upload.endpoint !== "https://video.bunnycdn.com/tusupload") {
    throw new Error("SERVICE_TEMPORARILY_UNAVAILABLE");
  }
  const previous = req.context.minglaMediaGrant;
  req.context.minglaMediaGrant = true;
  try {
    const media = await req.payload.create({
      collection: "media",
      overrideAccess: false,
      req,
      data: {
        tenant: actor.tenantId,
        state: "UPLOADING",
        kind: "stream_video",
        original_filename_safe: input.filename.replace(/[^A-Za-z0-9._ -]/g, "_").slice(0, 160) || "video",
        // Bunny delivers MP4 whatever was uploaded.
        declared_mime: "video/mp4",
        bytes: input.bytes,
        created_by: actor.id,
        stream_video_id: videoId,
      },
    });
    return {
      media_id: String(media.id),
      maximum_bytes: MAX_STREAM_VIDEO_UPLOAD_BYTES,
      upload: {
        endpoint: String(upload.endpoint),
        library_id: String(upload.library_id),
        video_guid: String(upload.video_guid),
        signature: String(upload.signature),
        expires_at: Number(upload.expires_at),
      },
    };
  } finally {
    req.context.minglaMediaGrant = previous;
  }
}

export async function refreshStreamVideo(req: PayloadRequest, mediaId: string, core: CoreBinding = defaultCore) {
  const actor = actorOf(req);
  const grant = studioMediaGrantRequest(req);
  const media = await req.payload.findByID({
    collection: "media",
    id: mediaId,
    overrideAccess: false,
    req: grant,
    depth: 0,
    showHiddenFields: true,
  });
  const tenant = typeof media.tenant === "object" && media.tenant ? String((media.tenant as { id?: unknown }).id) : String(media.tenant);
  if (tenant !== actor.tenantId || media.kind !== "stream_video" || typeof media.stream_video_id !== "string") {
    throw new Error("FORBIDDEN");
  }
  const view = (record: typeof media) => ({
    media_id: String(record.id),
    state: record.state,
    rejection_code: record.rejection_code ?? null,
  });
  if (media.state === "READY" || media.state === "REJECTED") return view(media);
  const status = await core.get(
    `/internal/v1/sites/${actor.siteId}/videos/${media.stream_video_id}/status`,
    actor.siteId,
    crypto.randomUUID(),
  );
  let data: Record<string, unknown>;
  if (status.status === "ready") {
    const renditions = Array.isArray(status.renditions) ? status.renditions as Array<{ url?: unknown; height?: unknown }> : [];
    const host = String(status.cdn_host ?? "");
    const best = renditions.find((item) => {
      try {
        return typeof item.url === "string" && new URL(item.url).hostname === host;
      } catch {
        return false;
      }
    });
    if (!best || !isStreamVideoHost(host) || !Number.isInteger(status.duration_ms)) {
      return view(media);
    }
    const height = Number(best.height) || 0;
    data = {
      state: "READY",
      detected_mime: "video/mp4",
      stream_url: String(best.url),
      stream_host: host,
      duration_ms: Number(status.duration_ms),
      height,
      width: Number.isInteger(status.width) ? Number(status.width) : null,
      quarantine_delete_by: null,
    };
  } else if (status.status === "failed") {
    data = { state: "REJECTED", rejection_code: "PROCESSING_FAILED" };
  } else {
    data = { state: "PROCESSING" };
  }
  const updated = await req.payload.update({
    collection: "media",
    id: mediaId,
    overrideAccess: false,
    req: grant,
    depth: 0,
    data,
  });
  return view(updated);
}
