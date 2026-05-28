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
  return duration > 0 && duration < 1000 ? duration * 1000 : duration;
};

export const normalizeLocalFileUri = (path: string): string =>
  path.startsWith("file://") ? path : `file://${path}`;

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
