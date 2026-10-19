import { sha256OfBlob, VideoUploadError } from "@mingla/video-upload";
import {
  LaneVideoTypeError,
  resolveLaneVideoType,
  type LaneVideoExtension,
} from "./eventCoverVideoSourceType";

export type PreparedEventCoverVideoSource = {
  uri: string;
  bytes: number;
  durationMs: number;
  fileName: string;
  mimeType: string;
  extension: LaneVideoExtension;
  sha256: string;
  fingerprint: string;
};

export type PrepareProgress = { phase: "preparing"; percent: number };

// Issue #3073 — mirrors the native guard's error so the shared hook can import
// ONE symbol regardless of platform. Web reads the blob through `fetch` and the
// browser's own decoder, which is a different failure surface from the native
// trim editor, so nothing throws this here today; the type exists so the hook's
// `instanceof` branch is not silently unreachable on web.
export class EventCoverVideoSourceHasNoVideoTrackError extends Error {
  constructor() {
    super("The trimmed clip has no video track.");
    this.name = "EventCoverVideoSourceHasNoVideoTrackError";
  }
}

// A NAME check, not `instanceof`. Several suites mock this module partially, so
// the class can be `undefined` at runtime in a test — and `x instanceof
// undefined` THROWS, taking down the whole suite rather than failing one
// assertion. Same shape the repo already uses for PostgREST errors, which
// arrive as plain objects.
export const isEventCoverVideoSourceHasNoVideoTrackError = (
  error: unknown,
): boolean =>
  error !== null && typeof error === "object" &&
  (error as { name?: unknown }).name === "EventCoverVideoSourceHasNoVideoTrackError";

export const prepareEventCoverVideoSource = async (input: {
  uri: string;
  bytes: number;
  durationMs: number;
  fileName?: string | null;
  mimeType?: string | null;
  operationId: string;
  /** Native only (rename instead of copy); the browser never copies. */
  ownedTemporary?: boolean;
  onProgress?: (progress: PrepareProgress) => void;
}): Promise<PreparedEventCoverVideoSource> => {
  const response = await fetch(input.uri);
  if (!response.ok) throw new Error("video_source_unreadable");
  const blob = await response.blob();
  if (blob.size <= 0 || blob.size !== input.bytes) throw new Error("video_source_size_changed");
  // #3040 B-C19 — MIME, then extension, then the first 12 bytes. An empty
  // browser MIME is "unknown", never a type.
  let resolved: ReturnType<typeof resolveLaneVideoType>;
  try {
    resolved = resolveLaneVideoType({ mimeType: input.mimeType, fileName: input.fileName });
  } catch (metadataError) {
    if (metadataError instanceof LaneVideoTypeError && metadataError.code === "video_source_type_unsupported") {
      throw new Error(metadataError.code);
    }
    const head = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
    try {
      resolved = resolveLaneVideoType({ mimeType: input.mimeType, fileName: input.fileName, head });
    } catch (sniffError) {
      throw new Error(sniffError instanceof LaneVideoTypeError ? sniffError.code : "video_source_type_unknown");
    }
  }
  // #3040 — the shared package hashes, and refuses a blob over 100 MB before
  // reading a byte of it.
  let sha256: string;
  try {
    sha256 = await sha256OfBlob(blob);
  } catch (error) {
    if (error instanceof VideoUploadError && error.code === "source_too_large") throw new Error("video_source_too_large");
    throw error;
  }
  input.onProgress?.({ phase: "preparing", percent: 99 });
  return {
    uri: input.uri,
    bytes: blob.size,
    durationMs: input.durationMs,
    fileName: resolved.fileName,
    mimeType: resolved.mimeType,
    extension: resolved.extension,
    sha256,
    fingerprint: `${sha256}:${blob.size}`,
  };
};

export const deletePreparedEventCoverVideoSource = async (uri: string): Promise<void> => {
  if (uri.startsWith("blob:") && typeof URL.revokeObjectURL === "function") {
    URL.revokeObjectURL(uri);
  }
};
