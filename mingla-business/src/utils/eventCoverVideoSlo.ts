export const EVENT_COVER_VIDEO_DELAYED_MS = 30_000;
export const EVENT_COVER_VIDEO_SLO_MS = 60_000;

export type EventCoverVideoProcessingTiming =
  | "normal"
  | "delayed"
  | "breached";

export const coverVideoProcessingTiming = (
  sourceUploadedAt: string | null,
  nowMs = Date.now(),
): EventCoverVideoProcessingTiming => {
  const uploadedMs = sourceUploadedAt === null
    ? Number.NaN
    : Date.parse(sourceUploadedAt);
  if (!Number.isFinite(uploadedMs)) return "normal";
  const elapsedMs = Math.max(0, nowMs - uploadedMs);
  if (elapsedMs >= EVENT_COVER_VIDEO_SLO_MS) return "breached";
  if (elapsedMs >= EVENT_COVER_VIDEO_DELAYED_MS) return "delayed";
  return "normal";
};
