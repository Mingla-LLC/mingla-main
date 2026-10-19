// Shared browser implementation for video pickers that feed the canonical
// Bunny lane. Keep this leaf module UI-free so Metro can share it without
// pulling the complete cover picker into the eager web bundle.
const VIDEO_DURATION_ATTEMPT_TIMEOUT_MS = 6000;
const VIDEO_DURATION_RETRY_DELAYS_MS = [900, 1600, 2400];

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
): Promise<number | null> => {
  if (
    typeof providedDurationMs === "number" &&
    Number.isFinite(providedDurationMs) &&
    providedDurationMs > 0
  ) {
    return Math.round(providedDurationMs);
  }
  let result = await readBrowserVideoDurationOnce(uri);
  for (const wait of VIDEO_DURATION_RETRY_DELAYS_MS) {
    if (result !== null && result > 0) return result;
    await delay(wait);
    result = await readBrowserVideoDurationOnce(uri);
  }
  return result;
};
