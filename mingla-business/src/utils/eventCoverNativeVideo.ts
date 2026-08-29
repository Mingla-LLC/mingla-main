export type NativeTrimmedVideoValidationCode =
  | "video_uri_missing"
  | "video_duration_unknown"
  | "video_too_long"
  | "video_size_unknown"
  | "video_file_too_large"
  | "video_format_unsupported";

export interface NativeTrimmedVideoAssetInput {
  duration?: number | null;
  fileSize?: number | null;
  uri?: string | null;
  mimeType?: string | null;
  fileName?: string | null;
}

export interface NativeTrimmedVideoLimits {
  maxDurationMs: number;
  maxSourceBytes: number;
  allowWebm?: boolean;
}

export interface NativeTrimmedVideoUploadFields {
  sourceBytes: number;
  sourceDurationMs: number;
  trimEndMs: number;
  trimStartMs: 0;
}

export type NativeTrimmedVideoValidationResult =
  | {
      ok: true;
      uploadFields: NativeTrimmedVideoUploadFields;
    }
  | {
      ok: false;
      code: NativeTrimmedVideoValidationCode;
      message: string;
    };

export const validateNativeTrimmedEventCoverVideo = (
  asset: NativeTrimmedVideoAssetInput,
  limits: NativeTrimmedVideoLimits,
): NativeTrimmedVideoValidationResult => {
  if (typeof asset.uri !== "string" || asset.uri.trim().length === 0) {
    return {
      ok: false,
      code: "video_uri_missing",
      message: "Choose another video with a readable file, length, and size.",
    };
  }

  const durationMs = typeof asset.duration === "number" ? asset.duration : null;
  if (durationMs === null || !Number.isFinite(durationMs) || durationMs <= 0) {
    return {
      ok: false,
      code: "video_duration_unknown",
      message: "Choose another video with a readable file, length, and size.",
    };
  }

  if (durationMs > limits.maxDurationMs) {
    return {
      ok: false,
      code: "video_too_long",
      message: "Trim it to 15 seconds or less, then choose it again.",
    };
  }

  const sourceBytes =
    typeof asset.fileSize === "number" && Number.isFinite(asset.fileSize)
      ? asset.fileSize
      : null;
  if (sourceBytes === null || sourceBytes <= 0) {
    return {
      ok: false,
      code: "video_size_unknown",
      message: "Choose another video with a readable file, length, and size.",
    };
  }

  if (sourceBytes > limits.maxSourceBytes) {
    return {
      ok: false,
      code: "video_file_too_large",
      message: "Choose a smaller video before uploading.",
    };
  }

  const mime = asset.mimeType?.toLowerCase().split(";")[0].trim() ?? "";
  const extension = (asset.fileName ?? asset.uri)?.toLowerCase().match(/\.[a-z0-9]+$/)?.[0] ?? "";
  const allowedMime = new Set([
    "video/mp4",
    "video/quicktime",
    "video/x-m4v",
    ...(limits.allowWebm ? ["video/webm"] : []),
  ]);
  const allowedExtension = new Set([".mp4", ".mov", ".m4v", ...(limits.allowWebm ? [".webm"] : [])]);
  if ((mime.length > 0 && !allowedMime.has(mime)) || (mime.length === 0 && !allowedExtension.has(extension))) {
    return {
      ok: false,
      code: "video_format_unsupported",
      message: limits.allowWebm
        ? "Choose an MP4, MOV, M4V, or WebM video."
        : "Choose an MP4, MOV, or M4V video.",
    };
  }

  return {
    ok: true,
    uploadFields: {
      sourceBytes,
      sourceDurationMs: durationMs,
      trimEndMs: durationMs,
      trimStartMs: 0,
    },
  };
};
