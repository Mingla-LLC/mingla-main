/**
 * #2829 AD-9 — video on a Mingla Site, named once.
 *
 * Two kinds:
 * - `file_video`: an MP4 (H.264/AAC, fast start) stored in Sites storage and
 *   served by the runtime's media route with real HTTP Range. Its integrity is
 *   a SHA-256 per 1 MiB chunk, computed when the video is approved and frozen
 *   into the artifact, so a byte range is verified by reading only the chunks
 *   that cover it (never the whole file per request).
 * - `stream_video`: a Bunny Stream video, played from its MP4 rendition on the
 *   stream CDN host (production, when Bunny is configured).
 *
 * Hero background videos are short loops (≤ 15 s); films have no length cap
 * beyond the file size cap.
 */
import { DIGEST_RE, hasOnlyKeys, plainObject, UUID_RE } from "./safety.ts";

export const VIDEO_CHUNK_BYTES = 1024 * 1024;
export const MAX_FILE_VIDEO_BYTES = 50 * 1024 * 1024;
export const MAX_STREAM_VIDEO_UPLOAD_BYTES = 100 * 1024 * 1024;
export const MAX_HERO_VIDEO_MS = 15_000;
/** The most a Range request is answered with in one response (open-ended or larger). */
export const MAX_RANGE_RESPONSE_BYTES = 8 * 1024 * 1024;
export const MAX_STREAM_VIDEOS_PER_ARTIFACT = 100;

/** The plain reasons an owner sees. */
export const HERO_VIDEO_TOO_LONG_MESSAGE = "Hero videos can be up to 15 seconds";
export const VIDEO_NOT_FASTSTART_MESSAGE = "Export the video with fast start (web optimised) and upload again";
export const VIDEO_CODEC_MESSAGE = "Export the video as MP4 with H.264 video and AAC audio, and upload again";
export const VIDEO_TOO_LARGE_MESSAGE = "Videos can be up to 50 MB";

export function videoChunkCount(bytes: number): number {
  return Math.ceil(bytes / VIDEO_CHUNK_BYTES);
}

/** The integrity record of a `file_video` (chunk digests in order). */
export type FileVideoIntegrity = {
  bytes: number;
  chunk_size: number;
  chunk_digests: string[];
  duration_ms?: number;
};

export function isFileVideoIntegrity(value: Record<string, unknown>): boolean {
  const bytes = value.bytes;
  const digests = value.chunk_digests;
  return (
    typeof bytes === "number" && Number.isInteger(bytes) && bytes >= 1 && bytes <= MAX_FILE_VIDEO_BYTES &&
    value.chunk_size === VIDEO_CHUNK_BYTES &&
    Array.isArray(digests) && digests.length === videoChunkCount(bytes) &&
    digests.every((digest) => typeof digest === "string" && DIGEST_RE.test(digest)) &&
    (value.duration_ms === undefined ||
      (typeof value.duration_ms === "number" && Number.isInteger(value.duration_ms) && value.duration_ms >= 0))
  );
}

/** A stream video frozen into the artifact: its MP4 rendition on the stream CDN. */
export type StreamVideoRef = {
  id: string;
  url: string;
  host: string;
  width: number;
  height: number;
  duration_ms: number;
};

const HOSTNAME_RE = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const STREAM_PATH_RE = /^\/[0-9a-f-]{36}\/play_\d{3,4}p\.mp4$/;

export function isStreamVideoHost(value: unknown): value is string {
  return typeof value === "string" && HOSTNAME_RE.test(value);
}

export function assertStreamVideoRef(value: unknown): asserts value is StreamVideoRef {
  let ok = plainObject(value) &&
    hasOnlyKeys(value, ["id", "url", "host", "width", "height", "duration_ms"]) &&
    typeof value.id === "string" && UUID_RE.test(value.id) &&
    isStreamVideoHost(value.host) &&
    Number.isInteger(value.width) && Number(value.width) >= 0 &&
    Number.isInteger(value.height) && Number(value.height) >= 0 &&
    Number.isInteger(value.duration_ms) && Number(value.duration_ms) >= 0 &&
    typeof value.url === "string" && value.url.length <= 2048;
  if (ok) {
    try {
      const url = new URL(String((value as Record<string, unknown>).url));
      ok = url.protocol === "https:" && url.hostname === (value as Record<string, unknown>).host &&
        url.port === "" && url.search === "" && url.hash === "" && url.username === "" && url.password === "" &&
        STREAM_PATH_RE.test(url.pathname);
    } catch {
      ok = false;
    }
  }
  if (!ok) throw new Error("ARTIFACT_MEDIA_MISMATCH");
}
