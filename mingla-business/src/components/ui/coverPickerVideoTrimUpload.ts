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

export const buildTrimmedVideoUploadFile = async (input: {
  trimResult: VideoTrimFinishPayload;
  originalFileName?: string | null;
  originalMimeType?: string | null;
  statFile: (uri: string) => Promise<FileInfoForUpload>;
}): Promise<EventCoverVideoUploadFile> => {
  const trimmedDurationMs = normalizePickerDurationMs(
    input.trimResult.endTime - input.trimResult.startTime,
  );
  if (trimmedDurationMs <= 0) {
    throw new Error("Could not read this video's duration. Try another clip.");
  }

  const uploadUri = normalizeLocalFileUri(input.trimResult.outputPath);
  const fileInfo = await input.statFile(uploadUri);
  const bytes = fileInfo.exists && typeof fileInfo.size === "number" ? fileInfo.size : 0;
  if (bytes <= 0) {
    throw new Error("Could not read this video's size. Try another clip.");
  }

  return {
    bytes,
    durationMs: trimmedDurationMs,
    fileName:
      input.originalFileName ??
      input.trimResult.outputPath.split("/").pop() ??
      "trimmed-video.mp4",
    mimeType: input.originalMimeType ?? "video/mp4",
    trimEndMs: trimmedDurationMs,
    trimStartMs: 0,
    uri: uploadUri,
  };
};
