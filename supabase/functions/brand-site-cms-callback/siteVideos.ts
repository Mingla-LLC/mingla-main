/*
 * #2829 W6 (AD-9) — stream videos for Mingla Sites, through Core.
 *
 * Bunny's keys are Core secrets. Studio (the CMS) never calls Bunny's API: it
 * asks Core over the signed CMS -> Core envelope, and Core
 *   - creates the Bunny video and presigns a resumable (TUS) upload the
 *     browser sends the file to directly (`upload-intent`), and
 *   - reads the video's status back from Bunny when asked (`status`), keeping
 *     it in `brand_site_videos` (no webhook change to the event-cover lane).
 *
 * The Bunny calls are the shared helpers in `_shared/bunnyStream.ts` (the
 * same ones the event-cover video lane uses; that lane is not modified).
 *
 * INERT WHEN BUNNY IS NOT CONFIGURED: with any of the library id, stream key
 * or CDN hostname missing, every route answers `STREAM_VIDEO_UNAVAILABLE`
 * before touching Bunny or the database, and the capability route says so, so
 * Studio uses standard (file) video hosting instead.
 */
import {
  type BunnyTusPresign,
  type BunnyVideo,
  bunnyCreateVideo,
  bunnyGetVideo,
  bunnyMp4Candidates,
  bunnyPresignTusUpload,
  bunnyThumbnailUrl,
  mapBunnyStatusFromApiVideo,
} from "../_shared/bunnyStream.ts";
import { requireUuid, sitesJson } from "../_shared/sitesContracts.ts";

export const STREAM_VIDEO_TYPES = new Set(["video/mp4", "video/quicktime", "video/x-m4v", "video/webm"]);
export const MAX_STREAM_VIDEO_BYTES = 100 * 1024 * 1024;
const MAX_RENDITION_HEIGHT = 1080;
const UPLOAD_SIGNATURE_SECONDS = 3600;

export type SiteVideoRow = {
  id: string;
  site_id: string;
  brand_id: string;
  provider_guid: string;
  status: "created" | "uploading" | "processing" | "ready" | "failed";
  duration_ms: number | null;
  width: number | null;
  height: number | null;
  renditions: Array<{ url: string; height: number }>;
};

export type SiteVideoStore = {
  siteBrand(siteId: string): Promise<string | null>;
  insert(row: { site_id: string; brand_id: string; provider_guid: string; status: SiteVideoRow["status"] }): Promise<SiteVideoRow>;
  load(siteId: string, videoId: string): Promise<SiteVideoRow | null>;
  update(videoId: string, patch: Partial<SiteVideoRow>): Promise<SiteVideoRow>;
};

export type SiteVideoBunny = {
  configured(): boolean;
  cdnHost(): string;
  createVideo(title: string): Promise<{ ok: true; guid: string } | { ok: false; reason: string; retryable: boolean }>;
  presign(guid: string): Promise<BunnyTusPresign>;
  getVideo(guid: string): Promise<{ ok: true; video: BunnyVideo } | { ok: false; status: number; reason: string }>;
};

/** The production Bunny binding (env-configured; `fetchImpl` lets tests mock Bunny's API). */
export function bunnyBinding(fetchImpl?: typeof fetch): SiteVideoBunny {
  return {
    configured: () =>
      Boolean(Deno.env.get("BUNNY_STREAM_LIBRARY_ID")) &&
      Boolean(Deno.env.get("BUNNY_STREAM_API_KEY")) &&
      Boolean(Deno.env.get("BUNNY_STREAM_CDN_HOSTNAME")),
    cdnHost: () => (Deno.env.get("BUNNY_STREAM_CDN_HOSTNAME") ?? "").trim().toLowerCase(),
    createVideo: (title) => bunnyCreateVideo(title, { fetchImpl }),
    presign: (guid) => bunnyPresignTusUpload(guid, UPLOAD_SIGNATURE_SECONDS),
    getVideo: (guid) => bunnyGetVideo(guid, { fetchImpl }),
  };
}

const unavailable = () => sitesJson({ ok: false, error: { code: "STREAM_VIDEO_UNAVAILABLE" } }, 404);
const notFound = () => sitesJson({ ok: false, error: { code: "NOT_FOUND" } }, 404);
const invalid = () => sitesJson({ ok: false, error: { code: "VALIDATION_FAILED" } }, 400);

function publicView(row: SiteVideoRow, bunny: SiteVideoBunny) {
  return {
    video_id: row.id,
    status: row.status,
    duration_ms: row.duration_ms,
    width: row.width,
    height: row.height,
    renditions: row.renditions,
    cdn_host: bunny.cdnHost(),
    poster_url: row.status === "ready" ? bunnyThumbnailUrl(row.provider_guid) : null,
  };
}

/**
 * The stream-video routes, or null when the path is not one of them. The
 * caller has already verified the signed envelope; the URL site must be the
 * envelope's site (throws TENANT_MISMATCH otherwise, like every site route).
 */
export async function handleSiteVideoRoute(
  input: { method: string; path: string; body: Record<string, unknown>; envelopeSiteId: string },
  deps: { store: SiteVideoStore; bunny: SiteVideoBunny },
): Promise<Response | null> {
  const capability = input.path.match(/^\/internal\/v1\/sites\/([^/]+)\/videos\/capability$/);
  const intent = input.path.match(/^\/internal\/v1\/sites\/([^/]+)\/videos\/upload-intent$/);
  const status = input.path.match(/^\/internal\/v1\/sites\/([^/]+)\/videos\/([^/]+)\/status$/);
  const match = capability ?? intent ?? status;
  if (!match) return null;
  const siteId = requireUuid(match[1]);
  if (siteId !== input.envelopeSiteId) throw new Error("TENANT_MISMATCH");
  const { store, bunny } = deps;

  if (capability && input.method === "GET") {
    const configured = bunny.configured();
    return sitesJson({ ok: true, data: { stream_video: configured, cdn_host: configured ? bunny.cdnHost() : null } });
  }
  if (intent && input.method === "POST") {
    if (!bunny.configured()) return unavailable();
    const contentType = input.body.content_type;
    const bytes = input.body.bytes;
    if (
      typeof contentType !== "string" || !STREAM_VIDEO_TYPES.has(contentType) ||
      typeof bytes !== "number" || !Number.isInteger(bytes) || bytes < 1 || bytes > MAX_STREAM_VIDEO_BYTES
    ) return invalid();
    const brandId = await store.siteBrand(siteId);
    if (!brandId) return notFound();
    const created = await bunny.createVideo(`mingla-site:${siteId}:${crypto.randomUUID()}`);
    if (!created.ok) {
      return sitesJson({ ok: false, error: { code: "SERVICE_TEMPORARILY_UNAVAILABLE" } }, 503);
    }
    const row = await store.insert({ site_id: siteId, brand_id: brandId, provider_guid: created.guid, status: "uploading" });
    const upload = await bunny.presign(created.guid);
    return sitesJson({
      ok: true,
      data: {
        video_id: row.id,
        maximum_bytes: MAX_STREAM_VIDEO_BYTES,
        upload: {
          endpoint: upload.tusEndpoint,
          library_id: upload.libraryId,
          video_guid: upload.videoId,
          signature: upload.authorizationSignature,
          expires_at: upload.authorizationExpire,
        },
      },
    });
  }
  if (status && input.method === "GET") {
    if (!bunny.configured()) return unavailable();
    const videoId = requireUuid(status[2]);
    const row = await store.load(siteId, videoId);
    if (!row) return notFound();
    if (row.status === "ready" || row.status === "failed") return sitesJson({ ok: true, data: publicView(row, bunny) });
    const read = await bunny.getVideo(row.provider_guid);
    if (!read.ok) {
      // Bunny unreachable: report what we know, never a guess.
      return sitesJson({ ok: true, data: publicView(row, bunny) });
    }
    const lifecycle = mapBunnyStatusFromApiVideo(read.video.status);
    if (lifecycle === "failed") {
      return sitesJson({ ok: true, data: publicView(await store.update(row.id, { status: "failed" }), bunny) });
    }
    if (lifecycle === "ready") {
      const host = bunny.cdnHost();
      const renditions = bunnyMp4Candidates(read.video, MAX_RENDITION_HEIGHT)
        .filter((item) => new URL(item.url).hostname === host)
        .map((item) => ({ url: item.url, height: item.heightP }));
      // A "finished" video with no MP4 rendition yet (or no length) stays
      // processing: the site only ever points at a file that exists.
      if (renditions.length && typeof read.video.length === "number") {
        const updated = await store.update(row.id, {
          status: "ready",
          duration_ms: Math.round(read.video.length * 1000),
          height: renditions[0]!.height,
          renditions,
        });
        return sitesJson({ ok: true, data: publicView(updated, bunny) });
      }
    }
    // Created (0) means the upload has not landed yet; anything else is processing.
    const next = read.video.status === 0 ? "uploading" : "processing";
    const current = row.status === next ? row : await store.update(row.id, { status: next });
    return sitesJson({ ok: true, data: publicView(current, bunny) });
  }
  return sitesJson({ ok: false }, 405);
}

/** The production store over the service-role client. */
// deno-lint-ignore no-explicit-any
export function serviceVideoStore(service: any): SiteVideoStore {
  const columns = "id,site_id,brand_id,provider_guid,status,duration_ms,width,height,renditions";
  return {
    async siteBrand(siteId) {
      const { data, error } = await service.from("brand_sites").select("brand_id").eq("id", siteId).maybeSingle();
      if (error) throw new Error("SERVICE_TEMPORARILY_UNAVAILABLE");
      return data?.brand_id ?? null;
    },
    async insert(row) {
      const { data, error } = await service.from("brand_site_videos").insert(row).select(columns).single();
      if (error || !data) throw new Error("SERVICE_TEMPORARILY_UNAVAILABLE");
      return data as SiteVideoRow;
    },
    async load(siteId, videoId) {
      const { data, error } = await service.from("brand_site_videos").select(columns).eq("id", videoId).eq("site_id", siteId)
        .maybeSingle();
      if (error) throw new Error("SERVICE_TEMPORARILY_UNAVAILABLE");
      return (data as SiteVideoRow | null) ?? null;
    },
    async update(videoId, patch) {
      const { data, error } = await service.from("brand_site_videos").update(patch).eq("id", videoId).select(columns).single();
      if (error || !data) throw new Error("SERVICE_TEMPORARILY_UNAVAILABLE");
      return data as SiteVideoRow;
    },
  };
}
