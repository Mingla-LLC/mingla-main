export type NativeTrimmedVideoValidationCode =
  | "video_uri_missing"
  | "video_duration_unknown"
  | "video_too_long"
  | "video_size_unknown"
  | "video_file_too_large";

export interface NativeTrimmedVideoAssetInput {
  duration?: number | null;
  fileSize?: number | null;
  uri?: string | null;
}

export interface NativeTrimmedVideoLimits {
  maxDurationMs: number;
  maxSourceBytes: number;
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
      message: "We couldn't read this video's file. Try another video.",
    };
  }

  const durationMs = typeof asset.duration === "number" ? asset.duration : null;
  if (durationMs === null || !Number.isFinite(durationMs) || durationMs <= 0) {
    return {
      ok: false,
      code: "video_duration_unknown",
      message: "We couldn't read this video's duration. Try another video.",
    };
  }

  if (durationMs > limits.maxDurationMs) {
    return {
      ok: false,
      code: "video_too_long",
      message: "Trim this video to 15 seconds or shorter, then try again.",
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
      message: "We couldn't read this video's file size. Try another video.",
    };
  }

  if (sourceBytes > limits.maxSourceBytes) {
    return {
      ok: false,
      code: "video_file_too_large",
      message: "Choose a video under 500 MB.",
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
