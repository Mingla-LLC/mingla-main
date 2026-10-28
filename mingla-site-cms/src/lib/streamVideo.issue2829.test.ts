/*
 * #2829 W6 (AD-9) — Studio's stream-video path, with Core (and so Bunny)
 * MOCKED: no real Core or Bunny call is made.
 *
 *  - capability is false whenever Core says so or cannot be reached, so Studio
 *    falls back to standard file video;
 *  - an upload intent is signed for the editor's own site, checks type/size,
 *    and creates the media record as an UPLOADING stream video;
 *  - status: ready -> READY with the CDN rendition, length and size; failed ->
 *    REJECTED; another site's media is refused;
 *  - the browser's resumable upload goes only to the stream service, in
 *    pieces, trusting the service's offset.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("./config", () => ({ cmsConfig: () => ({}) }));
vi.mock("./observability", () => ({ emitCmsObservation: async () => {} }));

import { createStreamUploadIntent, refreshStreamVideo, streamVideoCapability, type CoreBinding } from "./streamVideo";
import { tusUpload, validateStudioMediaFile, studioRejectionMessage } from "./studioMediaClient";

const TENANT = "00000000-0000-4000-8000-000000000f01";
const SITE = "00000000-0000-4000-8000-000000000f02";
const VIDEO_ID = "00000000-0000-4000-8000-000000000f03";
const MEDIA = "00000000-0000-4000-8000-000000000f04";
const MiB = 1024 * 1024;

type Doc = Record<string, unknown>;

function request(row: Doc | null = null) {
  const writes: Doc[] = [];
  let current = row;
  const req = {
    context: {} as Record<string, unknown>,
    user: { id: "u1", tenantId: TENANT, siteId: SITE },
    payload: {
      create: vi.fn(async (input: { data: Doc }) => {
        current = { id: MEDIA, ...input.data };
        writes.push(input.data);
        return current;
      }),
      findByID: vi.fn(async () => current),
      update: vi.fn(async (input: { data: Doc }) => {
        current = { ...current, ...input.data };
        writes.push(input.data);
        return current;
      }),
    },
  };
  return { req, writes, row: () => current };
}

const core = (get: CoreBinding["get"], post: CoreBinding["post"] = vi.fn()): CoreBinding => ({ get, post });

describe("#2829 Studio stream video (Core mocked)", () => {
  it("is off when Core says so or cannot be reached", async () => {
    const { req } = request();
    expect(await streamVideoCapability(req as never, core(async () => ({ stream_video: false })))).toEqual({ stream_video: false });
    expect(await streamVideoCapability(req as never, core(async () => {
      throw new Error("CORE_UNAVAILABLE");
    }))).toEqual({ stream_video: false });
    const on = vi.fn(async () => ({ stream_video: true }));
    expect(await streamVideoCapability(req as never, core(on))).toEqual({ stream_video: true });
    expect(on).toHaveBeenCalledWith(`/internal/v1/sites/${SITE}/videos/capability`, SITE, expect.any(String));
  });

  it("creates an UPLOADING stream-video record from Core's intent, signed for the editor's site", async () => {
    const { req, row } = request();
    const post = vi.fn(async () => ({
      video_id: VIDEO_ID,
      upload: { endpoint: "https://video.bunnycdn.com/tusupload", library_id: "1", video_guid: "g", signature: "s", expires_at: 9 },
    }));
    const result = await createStreamUploadIntent(req as never, { filename: "film.mov", content_type: "video/quicktime", bytes: 80 * MiB }, core(vi.fn(), post));
    expect(post).toHaveBeenCalledWith(`/internal/v1/sites/${SITE}/videos/upload-intent`, SITE, expect.any(String), { content_type: "video/quicktime", bytes: 80 * MiB });
    expect(row()).toMatchObject({ tenant: TENANT, state: "UPLOADING", kind: "stream_video", stream_video_id: VIDEO_ID, declared_mime: "video/mp4" });
    expect(result.upload.endpoint).toBe("https://video.bunnycdn.com/tusupload");
    expect(req.context.minglaMediaGrant).toBeUndefined();
  });

  it("refuses a wrong type or size before asking Core, and passes 'unavailable' through", async () => {
    const post = vi.fn();
    for (const input of [{ content_type: "image/png", bytes: 10 }, { content_type: "video/mp4", bytes: 101 * MiB }]) {
      await expect(createStreamUploadIntent(request().req as never, { filename: "x", ...input }, core(vi.fn(), post))).rejects.toThrow("MEDIA_REJECTED");
    }
    expect(post).not.toHaveBeenCalled();
    await expect(createStreamUploadIntent(request().req as never, { filename: "x", content_type: "video/mp4", bytes: 10 }, core(vi.fn(), async () => {
      throw new Error("STREAM_VIDEO_UNAVAILABLE");
    }))).rejects.toThrow("STREAM_VIDEO_UNAVAILABLE");
    await expect(createStreamUploadIntent(request().req as never, { filename: "x", content_type: "video/mp4", bytes: 10 }, core(vi.fn(), async () => ({
      video_id: VIDEO_ID, upload: { endpoint: "https://evil.example/tus" },
    })))).rejects.toThrow("SERVICE_TEMPORARILY_UNAVAILABLE");
  });

  const uploading = { id: MEDIA, tenant: TENANT, state: "UPLOADING", kind: "stream_video", stream_video_id: VIDEO_ID };

  it("becomes READY with the CDN rendition, length and size when Core reports ready", async () => {
    const { req, row } = request({ ...uploading });
    const get = vi.fn(async () => ({
      status: "ready", duration_ms: 9000, width: null, cdn_host: "vz-x.b-cdn.net",
      renditions: [
        { url: "https://vz-x.b-cdn.net/aaaaaaaa-1111-4111-8111-111111111111/play_720p.mp4", height: 720 },
        { url: "https://vz-x.b-cdn.net/aaaaaaaa-1111-4111-8111-111111111111/play_480p.mp4", height: 480 },
      ],
    }));
    const result = await refreshStreamVideo(req as never, MEDIA, core(get));
    expect(get).toHaveBeenCalledWith(`/internal/v1/sites/${SITE}/videos/${VIDEO_ID}/status`, SITE, expect.any(String));
    expect(result).toEqual({ media_id: MEDIA, state: "READY", rejection_code: null });
    expect(row()).toMatchObject({
      state: "READY", detected_mime: "video/mp4", duration_ms: 9000, height: 720,
      stream_url: "https://vz-x.b-cdn.net/aaaaaaaa-1111-4111-8111-111111111111/play_720p.mp4", stream_host: "vz-x.b-cdn.net",
    });
    // A ready record is answered without asking Core again.
    get.mockClear();
    await refreshStreamVideo(req as never, MEDIA, core(get));
    expect(get).not.toHaveBeenCalled();
  });

  it("stays processing while encoding, is REJECTED on failure, ignores off-CDN renditions", async () => {
    const processing = request({ ...uploading });
    await refreshStreamVideo(processing.req as never, MEDIA, core(async () => ({ status: "processing" })));
    expect(processing.row()).toMatchObject({ state: "PROCESSING" });
    const failed = request({ ...uploading });
    await refreshStreamVideo(failed.req as never, MEDIA, core(async () => ({ status: "failed" })));
    expect(failed.row()).toMatchObject({ state: "REJECTED", rejection_code: "PROCESSING_FAILED" });
    const odd = request({ ...uploading });
    await refreshStreamVideo(odd.req as never, MEDIA, core(async () => ({
      status: "ready", duration_ms: 1, cdn_host: "vz-x.b-cdn.net", renditions: [{ url: "https://elsewhere.example/a/play_720p.mp4", height: 720 }],
    })));
    expect(odd.row()).toMatchObject({ state: "UPLOADING" });
  });

  it("refuses another site's media and anything that is not a stream video", async () => {
    await expect(refreshStreamVideo(request({ ...uploading, tenant: "00000000-0000-4000-8000-0000000000aa" }).req as never, MEDIA, core(vi.fn())))
      .rejects.toThrow("FORBIDDEN");
    await expect(refreshStreamVideo(request({ ...uploading, kind: "file_video" }).req as never, MEDIA, core(vi.fn()))).rejects.toThrow("FORBIDDEN");
  });
});

describe("#2829 Studio's browser side", () => {
  it("validates file videos (MP4, 50 MB) and stream uploads (MP4/MOV/M4V/WebM, 100 MB)", () => {
    expect(validateStudioMediaFile({ type: "video/mp4", size: 50 * MiB })).toBeNull();
    expect(validateStudioMediaFile({ type: "video/mp4", size: 50 * MiB + 1 })).toBe("Choose a video no larger than 50 MB.");
    expect(validateStudioMediaFile({ type: "video/quicktime", size: 10 })).toBe("Choose an MP4 video.");
    expect(validateStudioMediaFile({ type: "video/quicktime", size: 99 * MiB }, { stream: true })).toBeNull();
    expect(validateStudioMediaFile({ type: "video/webm", size: 101 * MiB }, { stream: true })).toBe("Choose a video no larger than 100 MB.");
    // #2829 W11 (R1 "cover video ... wrong format"): every listed format, and a plain reason otherwise.
    for (const type of ["video/mp4", "video/quicktime", "video/x-m4v", "video/webm"]) {
      expect(validateStudioMediaFile({ type, size: 100 * MiB }, { stream: true })).toBeNull();
    }
    expect(validateStudioMediaFile({ type: "video/x-msvideo", size: 10 }, { stream: true })).not.toBeNull();
    expect(studioRejectionMessage("VIDEO_NOT_FASTSTART", true)).toBe("Export the video with fast start (web optimised) and upload again");
  });

  it("uploads to the stream service only, in pieces, trusting its offset", async () => {
    const size = 17 * MiB;
    const file = new File([new Uint8Array(size)], "film.mp4", { type: "video/mp4" });
    const calls: Array<{ url: string; init: RequestInit }> = [];
    let offset = 0;
    const requestFn = vi.fn(async (url: string, init: RequestInit = {}) => {
      calls.push({ url, init });
      if (init.method === "POST") return new Response(null, { status: 201, headers: { location: "/tusupload/abc" } });
      offset += (init.body as Blob).size;
      return new Response(null, { status: 204, headers: { "upload-offset": String(offset) } });
    });
    const progress: number[] = [];
    await tusUpload(
      { media_id: MEDIA, maximum_bytes: 100 * MiB, upload: { endpoint: "https://video.bunnycdn.com/tusupload", library_id: "1", video_guid: "g", signature: "sig", expires_at: 9 } },
      file,
      (fraction) => progress.push(fraction),
      requestFn as never,
    );
    expect(calls.map((call) => call.init.method)).toEqual(["POST", "PATCH", "PATCH", "PATCH"]);
    expect(calls.every((call) => call.url.startsWith("https://video.bunnycdn.com/"))).toBe(true);
    expect((calls[0]!.init.headers as Record<string, string>).AuthorizationSignature).toBe("sig");
    expect((calls[0]!.init.headers as Record<string, string>)["Upload-Length"]).toBe(String(size));
    expect(progress.at(-1)).toBe(1);
  });

  it("refuses a redirect of the upload to any other origin", async () => {
    const file = new File([new Uint8Array(10)], "f.mp4", { type: "video/mp4" });
    const requestFn = vi.fn(async () => new Response(null, { status: 201, headers: { location: "https://evil.example/upload" } }));
    await expect(tusUpload(
      { media_id: MEDIA, maximum_bytes: 100 * MiB, upload: { endpoint: "https://video.bunnycdn.com/tusupload", library_id: "1", video_guid: "g", signature: "s", expires_at: 9 } },
      file,
      () => {},
      requestFn as never,
    )).rejects.toThrow("UPLOAD_FAILED");
    expect(requestFn).toHaveBeenCalledTimes(1);
  });
});
