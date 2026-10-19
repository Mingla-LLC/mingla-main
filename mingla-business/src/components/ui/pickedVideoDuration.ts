// Shared browser implementation for video pickers that feed the canonical
// Bunny lane. Keep this leaf module UI-free so Metro can share it without
// pulling the complete cover picker into the eager web bundle.
// #3040 B-C18 [A-21] — the whole read is bounded at 8 s: two attempts of 3 s
// with one 1 s settle between them (ORCH-1312: the retry must not fire inside
// the tab-resume window right after the OS picker closes). It used to be four
// 6 s attempts plus 4.9 s of waits — up to ~29 s of silence with nothing on
// screen. The caller now shows "Reading video…" before the first attempt.
export const VIDEO_DURATION_ATTEMPT_TIMEOUT_MS = 3000;
export const VIDEO_DURATION_RETRY_DELAYS_MS = [1000];
export const VIDEO_DURATION_READ_BUDGET_MS =
  VIDEO_DURATION_ATTEMPT_TIMEOUT_MS * (VIDEO_DURATION_RETRY_DELAYS_MS.length + 1) +
  VIDEO_DURATION_RETRY_DELAYS_MS.reduce((sum, wait) => sum + wait, 0);

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const readBrowserVideoDurationOnce = (uri: string): Promise<number | null> => {
  if (typeof document === "undefined") return Promise.resolve(null);
  return new Promise<number | null>((resolve) => {
    const video = document.createElement("video");
    let settled = false;
    const finiteMs = (): number | null =>
      Number.isFinite(video.duration) && video.duration > 0
        ? Math.round(video.duration * 1000)
        : null;
    const finish = (value: number | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      video.onloadedmetadata = null;
      video.ondurationchange = null;
      video.ontimeupdate = null;
      video.onerror = null;
      video.removeAttribute("src");
      video.load();
      resolve(value);
    };
    const readIfReady = (): void => {
      const durationMs = finiteMs();
      if (durationMs !== null) finish(durationMs);
    };
    video.preload = "metadata";
    video.muted = true;
    video.onloadedmetadata = (): void => {
      const durationMs = finiteMs();
      if (durationMs !== null) {
        finish(durationMs);
        return;
      }
      video.ondurationchange = readIfReady;
      video.ontimeupdate = readIfReady;
      try {
        video.currentTime = Number.MAX_SAFE_INTEGER;
      } catch {
        finish(null);
      }
    };
    video.onerror = (): void => finish(null);
    const timer = setTimeout(
      () => finish(finiteMs()),
      VIDEO_DURATION_ATTEMPT_TIMEOUT_MS,
    );
    video.src = uri;
  });
};

export const readPickedVideoDurationMs = async (
  uri: string,
  providedDurationMs?: number | null,
  /** #3040 B-C18 — fired once, before the first attempt (the "reading" stage). */
  onReading?: () => void,
): Promise<number | null> => {
  if (
    typeof providedDurationMs === "number" &&
    Number.isFinite(providedDurationMs) &&
    providedDurationMs > 0
  ) {
    return Math.round(providedDurationMs);
  }
  onReading?.();
  let result = await readBrowserVideoDurationOnce(uri);
  for (const wait of VIDEO_DURATION_RETRY_DELAYS_MS) {
    if (result !== null && result > 0) return result;
    await delay(wait);
    result = await readBrowserVideoDurationOnce(uri);
  }
  return result;
};
