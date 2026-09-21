/**
 * #3173 — elapsed time for the cover-video processing card.
 *
 * A long encode still has to prove it is alive. Bunny hands us no usable
 * percentage for most of the wait: its first encoding webhook carries progress
 * 0, which the status mapper deliberately refuses to treat as determinate (see
 * `supabase/functions/_shared/eventCoverVideo.ts`). The spinner alone is honest
 * but static, and a minute of a static card reads as a hung upload — the exact
 * operator report that opened this issue. Elapsed time is the one signal we can
 * always compute, and a number that visibly moves is what separates "still
 * working" from "frozen".
 *
 * Lives beside CoverPicker rather than inside it because CoverPicker.tsx pulls
 * in expo-video / expo-image-picker / react-native-video-trim and cannot be
 * mounted under jest; split out, this is exercised for real.
 */
import { useEffect, useMemo, useState } from "react";

export const ELAPSED_TICK_MS = 1_000;

/**
 * #3485 — the reading has a plausibility ceiling.
 *
 * Filmed on a Release build (2026-09-20): a card that was still rendering
 * "Processing video…" for a job the server had already applied showed an elapsed
 * value of **4758m**. That number is not a measurement of anything — it is the
 * symptom of a phase that never settled — and printing it tells the host their
 * upload has been running for three days.
 *
 * 12 hours is the server's own stall deadline for a cover job (the reaper gives
 * up there). Past it there is no job left to be timing, so the honest reading is
 * no reading, which is what `useElapsedSince` already returns for a missing or
 * unparseable start. The real fix for the stuck phase lives in
 * `useEventCoverVideoUpload` (the foreground re-check); this is the belt on top
 * of it, for a client that cannot reach the server to learn better.
 */
export const ELAPSED_CEILING_MS = 12 * 60 * 60 * 1_000;

export const formatElapsed = (ms: number): string => {
  // Clock skew between the device and the server can make this negative, and a
  // counter running backwards into the past is worse than no counter at all.
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes === 0
    ? `${seconds}s`
    : `${minutes}m ${String(seconds).padStart(2, "0")}s`;
};

/**
 * Ticks once a second while `active`, and only while `active`: an interval that
 * outlives the phase it describes would keep a closed sheet re-rendering.
 * Returns null — never "0s" — when there is nothing honest to show, so callers
 * can distinguish "no reading" from "just started".
 */
export const useElapsedSince = (
  startedAt: string | null,
  active: boolean,
): string | null => {
  const startedMs = useMemo(
    () => (startedAt === null ? Number.NaN : Date.parse(startedAt)),
    [startedAt],
  );
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  const running = active && Number.isFinite(startedMs);
  useEffect(() => {
    if (!running) return;
    setNowMs(Date.now());
    const timer = setInterval(() => setNowMs(Date.now()), ELAPSED_TICK_MS);
    return () => clearInterval(timer);
  }, [running, startedMs]);
  if (!running) return null;
  const elapsedMs = nowMs - startedMs;
  // #3485 — beyond the ceiling the number is a symptom, not a measurement.
  return elapsedMs > ELAPSED_CEILING_MS ? null : formatElapsed(elapsedMs);
};
