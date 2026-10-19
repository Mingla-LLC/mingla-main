export declare const VIDEO_LIMITS: Readonly<{
  MAX_DURATION_MS: 60000;
  SOURCE_DURATION_TOLERANCE_MS: 500;
  SOURCE_MAX_BYTES: 104857600;
  AD_MIN_DURATION_MS: 5000;
  FINAL_MAX_BYTES: 67108864;
  MAX_RENDITION_HEIGHT: 1080;
  NATIVE_COMPRESSION_MAX_EDGE_PX: 1920;
  NATIVE_COMPRESSION_BITRATE_BPS: 8000000;
  NATIVE_COMPRESSION_MIN_SOURCE_BYTES: 5242880;
  TUS_CHUNK_NATIVE_BYTES: 2097152;
  TUS_CHUNK_WEB_BYTES: 8388608;
  ACK_DEADLINE_MS: 150000;
  WATCH_DEADLINE_MS: 660000;
}>;

export type VideoUploadErrorCode =
  | "source_upload_cancelled"
  | "source_upload_failed"
  | "transport_integrity_failed"
  | "source_too_large"
  | "source_unreadable";

export declare class VideoUploadError extends Error {
  constructor(code: VideoUploadErrorCode, message: string, detail?: string);
  readonly code: VideoUploadErrorCode;
  readonly detail: string | undefined;
}

export declare const resolveRawClipDurationMs: (ms: number | null | undefined) => number;
export declare const isAdVideoTooShort: (durationMs: number | null | undefined) => boolean;
export declare const tusMetadata: (
  metadata: { filetype?: string; title?: string; sha256?: string } | undefined,
) => string;

type SubtleLike = { digest: (algorithm: string, data: ArrayBuffer) => Promise<ArrayBuffer> };
type BlobLike = { size: number; arrayBuffer: () => Promise<ArrayBuffer>; slice: (start?: number, end?: number) => unknown };

export declare const sha256OfBlob: (blob: BlobLike, subtle?: SubtleLike) => Promise<string>;

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; signal?: AbortSignal }) => Promise<{
  ok: boolean;
  status: number;
  headers: { get: (name: string) => string | null };
}>;

export declare const headTusOffset: (input: {
  url: string;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  fetchImpl?: FetchLike;
}) => Promise<number>;

export declare const patchTusChunkXhr: (input: {
  url: string;
  headers?: Record<string, string>;
  blob: unknown;
  offset: number;
  onProgress?: (loadedBytes: number) => void;
  signal?: AbortSignal;
  XhrImpl?: unknown;
}) => Promise<number | null>;

export declare const projectUploadPercent: (input: {
  confirmedBytes: number;
  inflightLoaded?: number;
  total: number;
}) => number;

export type VideoUploadProgress = {
  percent: number;
  confirmedBytes: number;
  totalBytes: number;
  final: boolean;
};

export declare const uploadSourceWeb: (input: {
  file: BlobLike;
  transport: { url: string; headers: Record<string, string> };
  signal?: AbortSignal;
  onProgress?: (progress: VideoUploadProgress) => void;
  chunkBytes?: number;
  fetchImpl?: FetchLike;
  XhrImpl?: unknown;
}) => Promise<{ confirmedBytes: number; totalBytes: number }>;
