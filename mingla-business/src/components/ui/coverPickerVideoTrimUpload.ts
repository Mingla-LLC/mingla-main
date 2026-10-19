import type { EventCoverVideoUploadFile } from "../../hooks/useEventCoverVideoUpload";

export type VideoTrimFinishPayload = {
  outputPath: string;
  duration: number;
  startTime: number;
  endTime: number;
};

type FileInfoForUpload = { exists: boolean; size?: number };

export const normalizePickerDurationMs = (duration?: number | null): number => {
  if (typeof duration !== "number" || !Number.isFinite(duration)) return 0;
  // ORCH-1308: the result feeds the INTEGER source_duration_ms / trim_end_ms
  // columns via the upload intent. A browser/picker duration can be fractional
  // (seconds → ms), so round to a whole millisecond — a non-integer makes the
  // job INSERT fail ("invalid input syntax for type integer").
  const ms = duration > 0 && duration < 1000 ? duration * 1000 : duration;
  return Math.round(ms);
};

export const normalizeLocalFileUri = (path: string): string =>
  path.startsWith("file://") ? path : `file://${path}`;

// ORCH-1303 — resolve the upload uri for the RAW (un-trimmed) picked clip.
// On NATIVE the picker returns a real filesystem path that must be prefixed
// with `file://` (normalizeLocalFileUri). On WEB the picker returns a browser
// object URL (`blob:https://…`) that is already fetch-able as-is; prefixing
// `file://` corrupts it to `file://blob:…`, which the web TUS upload's
// `fetch(input.uri)` rejects ("Failed to fetch") — see the ORCH-1303
// investigation. So on web the blob uri MUST pass through UNMANGLED.
export const resolveRawClipUploadUri = (assetUri: string, isWeb: boolean): string =>
  isWeb ? assetUri : normalizeLocalFileUri(assetUri);

// #3040 B-C13 [A-13b] — the trimmer is a keyframe STREAM COPY
// (`enablePreciseTrimming: false`, issue #1350), so the real file can run up
// to one GOP past the window the host dragged. Declaring the WINDOW let a
// "60 s" trim reach the provider at 60.9 s and fail `processed_duration_over_cap`
// after the whole upload and encode. The output is now MEASURED.
export const TRIM_MAX_DECLARED_MS = 60_000;
export const TRIM_MEASURE_TOLERANCE_MS = 500;

/** The measured trim is still over a minute (design H-14a). */
export class TrimOverCapError extends Error {
  readonly code = "trim_over_cap" as const;
  readonly measuredMs: number;
  constructor(measuredMs: number) {
    super("This trimmed clip is still over 1 minute. Trim it again a little shorter.");
    this.name = "TrimOverCapError";
    this.measuredMs = measuredMs;
  }
}

const TRIM_MIME_BY_EXTENSION: Record<string, string> = {
  mp4: "video/mp4",
  m4v: "video/x-m4v",
  mov: "video/quicktime",
  webm: "video/webm",
};

const basenameOf = (path: string): string => path.split("/").pop() ?? path;

/**
 * The duration to DECLARE for a trimmed output: the measured length, with a
 * measurement up to 500 ms over the minute declared as exactly one minute.
 * Anything longer is refused before a byte is uploaded.
 */
export const resolveTrimmedDeclaredDurationMs = (
  measuredMs: number | null,
  windowMs: number,
): number => {
  if (measuredMs === null || !Number.isFinite(measuredMs) || measuredMs <= 0) return windowMs;
  if (measuredMs <= TRIM_MAX_DECLARED_MS) return measuredMs;
  if (measuredMs <= TRIM_MAX_DECLARED_MS + TRIM_MEASURE_TOLERANCE_MS) return TRIM_MAX_DECLARED_MS;
  throw new TrimOverCapError(measuredMs);
};

export const buildTrimmedVideoUploadFile = async (input: {
  trimResult: VideoTrimFinishPayload;
  /** @deprecated #3040 — the OUTPUT's own name and type are used (B-C13c). */
  originalFileName?: string | null;
  /** @deprecated #3040 — the OUTPUT's own name and type are used (B-C13c). */
  originalMimeType?: string | null;
  statFile: (uri: string) => Promise<FileInfoForUpload>;
  /**
   * #3040 B-C13b — measure the real output length (react-native-compressor
   * `getVideoMetaData`, normalised to ms). Absent or failing ⇒ the window.
   */
  measureDurationMs?: (uri: string) => Promise<number | null>;
}): Promise<EventCoverVideoUploadFile> => {
  const windowMs = normalizePickerDurationMs(
    input.trimResult.endTime - input.trimResult.startTime,
  );
  if (windowMs <= 0) {
    throw new Error("Could not read this video's duration. Try another clip.");
  }

  const uploadUri = normalizeLocalFileUri(input.trimResult.outputPath);
  const fileInfo = await input.statFile(uploadUri);
  const bytes = fileInfo.exists && typeof fileInfo.size === "number" ? fileInfo.size : 0;
  if (bytes <= 0) {
    throw new Error("Could not read this video's size. Try another clip.");
  }

  let measuredMs: number | null = null;
  if (input.measureDurationMs !== undefined) {
    try {
      const raw = await input.measureDurationMs(uploadUri);
      measuredMs = typeof raw === "number" ? normalizePickerDurationMs(raw) : null;
    } catch {
      measuredMs = null;
    }
  }
  const durationMs = resolveTrimmedDeclaredDurationMs(measuredMs, windowMs);

  // #3040 B-C13c — the trimmed file's OWN name and type. The output is an
  // MP4 even when the original was a .MOV; declaring the original's name and
  // `video/quicktime` made prepare refuse it or mislabel it.
  const fileName = basenameOf(input.trimResult.outputPath) || "trimmed-video.mp4";
  const extension = /\.([a-z0-9]+)$/i.exec(fileName)?.[1]?.toLowerCase() ?? "mp4";
  return {
    bytes,
    durationMs,
    fileName,
    mimeType: TRIM_MIME_BY_EXTENSION[extension] ?? "video/mp4",
    trimEndMs: durationMs,
    trimStartMs: 0,
    uri: uploadUri,
  };
};
