// ORCH-1167-R6 — WebKit/Safari-robust muted inline autoplay driver for the web
// cover <video>.
//
// THE BUG (proven with Playwright against the live deployed page): on WebKit the
// muted inline cover <video> LOADS fully (readyState 4) but its FIRST play()
// promise REJECTS (NotAllowedError) and the element stays `paused` at
// currentTime 0 FOREVER — Safari then paints its native play-button overlay on
// the paused inline video. Chromium plays on the first attempt. The R5 code did
// a single `video.play().catch(() => undefined)` with NO retry, so on WebKit the
// rejection was swallowed and the cover never started.
//
// THE FIX: keep RE-ATTEMPTING play() until the element actually starts
// (`!video.paused`), across the readiness events WebKit fires late
// (loadedmetadata / loadeddata / canplay / canplaythrough) AND a short bounded
// backoff retry. ALWAYS re-pin `muted = true` immediately before each attempt so
// every retry stays autoplay-eligible. The loop is bounded (no infinite loop,
// no leak), stops the moment the video is playing, and is fully torn down on
// cleanup (unmount / shouldPlay flip / user unmute).
//
// This module is PURE/host-agnostic: the DOM video element and the schedulers
// are injected, so it is unit-testable under node with a fake element + fake
// timers (no jsdom <video> needed). The component wires it to the real
// HTMLVideoElement + window scheduler.

// Minimal surface this driver needs from the cover <video> element. Keeping it
// structural lets the unit test pass a plain fake without a real HTMLVideoElement.
export interface MutedAutoplayVideoLike {
  muted: boolean;
  paused: boolean;
  play: () => unknown;
  load?: () => void;
  addEventListener: (type: string, listener: () => void) => void;
  removeEventListener: (type: string, listener: () => void) => void;
}

export interface MutedAutoplayDriverOptions {
  // Max number of play() attempts before the retry loop gives up. Sized so the
  // loop spans the whole `retryDelayMs * maxAttempts` budget — WebKit can take
  // a beat to grant inline-muted-autoplay eligibility even at readyState 4, so
  // a too-small burst (the R6.0 12×120ms ≈ 1.5s cap) gave up BEFORE WebKit was
  // ready and the cover stayed paused. The budget is bounded (no infinite loop)
  // but generous enough to outlast WebKit's eligibility latency.
  maxAttempts?: number;
  // Delay (ms) between self-scheduled retries while the video is still paused.
  retryDelayMs?: number;
  // Injected schedulers (real `setTimeout`/`requestAnimationFrame` in the app;
  // fake/synchronous in tests).
  setTimeoutFn?: (cb: () => void, ms: number) => unknown;
  clearTimeoutFn?: (id: unknown) => void;
  requestAnimationFrameFn?: (cb: () => void) => unknown;
  cancelAnimationFrameFn?: (id: unknown) => void;
}

// The readiness events WebKit fires (sometimes late) where the element becomes a
// fresh eligibility window for inline muted autoplay.
export const COVER_AUTOPLAY_READY_EVENTS = [
  "loadedmetadata",
  "loadeddata",
  "canplay",
  "canplaythrough",
] as const;

// ~50 attempts × 150ms ≈ 7.5s total budget. WebKit (proven via Playwright)
// rejects the first attempts with NotAllowedError even at readyState 4, then
// grants eligibility a beat later — a sustained, bounded retry over several
// seconds reliably lands the autoplay; a short 1.5s burst gave up too early.
const DEFAULT_MAX_ATTEMPTS = 50;
const DEFAULT_RETRY_DELAY_MS = 150;

/**
 * Drive WebKit-robust muted inline autoplay on a cover <video>.
 *
 * Returns a cleanup function that tears down all listeners + pending timers/rAF.
 * The driver is a no-op once `video.paused` is false (already playing).
 *
 * @param video the cover video element (real or fake structural).
 * @param opts schedulers + bounds (defaults to window timers when available).
 */
export function driveMutedAutoplay(
  video: MutedAutoplayVideoLike,
  opts: MutedAutoplayDriverOptions = {},
): () => void {
  const maxAttempts = opts.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const retryDelayMs = opts.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
  const scheduleTimeout =
    opts.setTimeoutFn ??
    (typeof setTimeout === "function"
      ? (cb: () => void, ms: number) => setTimeout(cb, ms)
      : undefined);
  const clearScheduledTimeout =
    opts.clearTimeoutFn ??
    (typeof clearTimeout === "function"
      ? (id: unknown) => clearTimeout(id as ReturnType<typeof setTimeout>)
      : undefined);
  const scheduleFrame =
    opts.requestAnimationFrameFn ??
    (typeof requestAnimationFrame === "function"
      ? (cb: () => void) => requestAnimationFrame(cb)
      : undefined);
  const cancelFrame =
    opts.cancelAnimationFrameFn ??
    (typeof cancelAnimationFrame === "function"
      ? (id: unknown) => cancelAnimationFrame(id as number)
      : undefined);

  let cancelled = false;
  let attempts = 0;
  let rafId: unknown = null;
  const timeoutIds: unknown[] = [];

  // Still worth attempting only while not torn down AND the video hasn't started.
  // Once `paused` flips false the cover is playing and we stop (the native play
  // button never paints).
  const stillNeedsPlay = (): boolean => !cancelled && video.paused;

  const scheduleRetry = (): void => {
    if (!stillNeedsPlay() || attempts >= maxAttempts) return;
    if (scheduleTimeout === undefined) return;
    const id = scheduleTimeout(attemptPlay, retryDelayMs);
    timeoutIds.push(id);
  };

  function attemptPlay(): void {
    if (!stillNeedsPlay()) return;
    attempts += 1;
    // Re-pin muted on EVERY attempt: inline autoplay without a user gesture is
    // ONLY permitted while muted, and a retry fired after WebKit re-evaluated
    // eligibility must still be muted to be allowed.
    video.muted = true;
    const result = video.play();
    if (
      result !== undefined &&
      result !== null &&
      typeof (result as { then?: unknown }).then === "function"
    ) {
      (result as Promise<void>).then(
        () => undefined,
        () => {
          // Rejected (WebKit NotAllowedError). Self-schedule a bounded backoff
          // retry; the late readiness events below also re-drive attemptPlay.
          scheduleRetry();
        },
      );
    }
  }

  // WebKit sometimes needs the element re-evaluated for eligibility; load()
  // before the first attempt nudges it to re-check. Cheap no-op on Chromium
  // (which already plays on the first attempt regardless).
  if (typeof video.load === "function") {
    try {
      video.load();
    } catch {
      // load() can throw on a detached element; the retry loop still covers it.
    }
  }

  // Drive an attempt on each late readiness event WebKit fires — each is a fresh
  // eligibility window, so re-pin-muted + play() here lands the autoplay the
  // moment the element is truly ready.
  const onReadyEvent = (): void => attemptPlay();
  for (const name of COVER_AUTOPLAY_READY_EVENTS) {
    video.addEventListener(name, onReadyEvent);
  }

  // First attempt immediately, then once more on the next frame (covers the case
  // where the element became eligible synchronously after load()).
  attemptPlay();
  if (scheduleFrame !== undefined) {
    rafId = scheduleFrame(attemptPlay);
  }

  return () => {
    cancelled = true;
    if (rafId !== null && cancelFrame !== undefined) cancelFrame(rafId);
    if (clearScheduledTimeout !== undefined) {
      for (const id of timeoutIds) clearScheduledTimeout(id);
    }
    for (const name of COVER_AUTOPLAY_READY_EVENTS) {
      video.removeEventListener(name, onReadyEvent);
    }
  };
}
