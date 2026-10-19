// #3040 design H-08/H-09 (Appendix A §5) — the Finish step's clock, counted
// from `sourceUploadedAt`: from 60 s the sub reads "Taking a little longer"
// (delayed); from 120 s the card turns into the H-09 warning (breached).
// These were 30 s / 60 s, which put the warning card up a minute early.
export const EVENT_COVER_VIDEO_DELAYED_MS = 60_000;
export const EVENT_COVER_VIDEO_SLO_MS = 120_000;

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

// #3040 D2 / design H-08 — the provider's encode % is shown ONLY while it is a
// real reading that is moving. Bunny's progress is sampled when a webhook
// lands, so a job can report 5 % from the first encode webhook until it
// finishes; observed 2026-10-19 as "Preparing at Mingla · 5%" for a whole
// minute. A first reading proves nothing (it may already be frozen); only a
// later, higher reading does, and a reading that has not risen for
// PROVIDER_PROGRESS_STALE_MS stops counting. Otherwise the card falls back to
// the indeterminate bar with the elapsed timer.
export const PROVIDER_PROGRESS_STALE_MS = 15_000;

export type ProviderProgressTracker = {
  jobId: string;
  lastPercent: number;
  movedAtMs: number | null;
};

export const trackProviderProgress = (
  previous: ProviderProgressTracker | null,
  jobId: string,
  reading: number | null,
  nowMs = Date.now(),
): { tracker: ProviderProgressTracker | null; percent: number | null } => {
  const real = typeof reading === "number" && Number.isFinite(reading) && reading > 0 && reading <= 100
    ? reading
    : null;
  const sameJob = previous !== null && previous.jobId === jobId ? previous : null;
  if (real === null) return { tracker: sameJob, percent: null };
  const tracker: ProviderProgressTracker = sameJob === null
    ? { jobId, lastPercent: real, movedAtMs: null }
    : real > sameJob.lastPercent
      ? { jobId, lastPercent: real, movedAtMs: nowMs }
      : sameJob;
  const moving = tracker.movedAtMs !== null && nowMs - tracker.movedAtMs < PROVIDER_PROGRESS_STALE_MS;
  return { tracker, percent: moving ? tracker.lastPercent : null };
};
