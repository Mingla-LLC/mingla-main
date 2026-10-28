import { sha256 } from "./crypto";
import { chunkDigests, inspectMp4 } from "./mp4Inspect";
import {
  assertStreamVideoRef,
  MAX_HERO_VIDEO_MS,
  VIDEO_CHUNK_BYTES,
  videoChunkCount,
  type FileVideoIntegrity,
  type StreamVideoRef,
} from "../contracts/generated/video.ts";

/*
 * #2829 W6 (AD-9) — how the publication builder freezes a site's videos.
 *
 * - A `file_video` carries its size, per-1 MiB-chunk SHA-256 digests and its
 *   length. They are computed when the video is approved; a video approved
 *   before W6 has none recorded, so they are computed here from its stored
 *   bytes, after those bytes match the digest recorded at approval (nothing
 *   unverified is ever fingerprinted).
 * - A `stream_video` becomes a stream reference: its MP4 rendition on the
 *   stream CDN host, as Core reported it when the video was ready.
 * - A hero's background video longer than 15 seconds is refused.
 */
type AnyDoc = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export function isStreamVideoRecord(record: AnyDoc | undefined): boolean {
  return !!record && record.state === "READY" && record.kind === "stream_video" && typeof record.stream_url === "string";
}

export function isFileVideoRecord(record: AnyDoc | undefined): boolean {
  return !!record && record.state === "READY" && record.detected_mime === "video/mp4" && record.kind !== "stream_video";
}

function recordedIntegrity(record: AnyDoc): FileVideoIntegrity | null {
  const master = record.rendition_manifest?.master;
  const bytes = Number(master?.bytes);
  const digests = master?.chunk_digests;
  if (
    master?.chunk_size === VIDEO_CHUNK_BYTES && Number.isInteger(bytes) && bytes > 0 &&
    Array.isArray(digests) && digests.length === videoChunkCount(bytes) &&
    digests.every((digest: unknown) => typeof digest === "string" && /^[0-9a-f]{64}$/.test(digest))
  ) {
    return {
      bytes,
      chunk_size: VIDEO_CHUNK_BYTES,
      chunk_digests: [...digests],
      ...(Number.isInteger(record.duration_ms) ? { duration_ms: Number(record.duration_ms) } : {}),
    };
  }
  return null;
}

/** A file video's integrity record (read from storage only when none is recorded). */
export async function fileVideoIntegrity(
  record: AnyDoc,
  readBytes: (key: string) => Promise<Uint8Array>,
): Promise<FileVideoIntegrity> {
  const recorded = recordedIntegrity(record);
  if (recorded) return recorded;
  const master = record.rendition_manifest?.master;
  if (typeof master?.key !== "string" || typeof master?.digest !== "string") throw new Error("MEDIA_PROCESSING");
  const bytes = await readBytes(master.key);
  if ((await sha256(bytes)) !== master.digest) throw new Error("MEDIA_PROCESSING");
  const inspection = inspectMp4(bytes);
  const duration = Number.isInteger(record.duration_ms)
    ? Number(record.duration_ms)
    : inspection.ok ? inspection.durationMs : undefined;
  return {
    bytes: bytes.byteLength,
    chunk_size: VIDEO_CHUNK_BYTES,
    chunk_digests: await chunkDigests(bytes, VIDEO_CHUNK_BYTES),
    ...(duration === undefined ? {} : { duration_ms: duration }),
  };
}

/** A ready stream video as the artifact carries it (refuses anything malformed). */
export function streamVideoRef(record: AnyDoc): StreamVideoRef {
  const ref = {
    id: String(record.id),
    url: String(record.stream_url),
    host: String(record.stream_host ?? ""),
    width: Number.isInteger(record.width) ? Number(record.width) : 0,
    height: Number.isInteger(record.height) ? Number(record.height) : 0,
    duration_ms: Number.isInteger(record.duration_ms) ? Number(record.duration_ms) : 0,
  };
  assertStreamVideoRef(ref);
  return ref;
}

/** True when a video's recorded length may play as a hero background. */
export function fitsHero(durationMs: unknown): boolean {
  return typeof durationMs === "number" && Number.isFinite(durationMs) && durationMs >= 0 && durationMs <= MAX_HERO_VIDEO_MS;
}
