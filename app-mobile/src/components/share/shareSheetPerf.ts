/**
 * #4265 — `__DEV__`-only timing for the share sheet. Marker: `[4265-DIAG]`.
 *
 * Same shape as `utils/tabSwitchPerf.ts` ([1638-DIAG]): every entry point returns
 * at once in release builds, and each window prints ONE line after it settles so
 * the logging never sits on the hot path. Strip with `grep -rn 4265-DIAG`.
 *
 * Read on a device:
 *   iOS:     Metro terminal / Xcode console, filter `4265-DIAG`
 *   Android: adb logcat -s ReactNativeJS:V | grep 4265-DIAG
 *
 * Lines:
 *   [4265-DIAG] open  firstFrameMs=… settledMs=… recipientsMs=… (cache|network|none) maxJsGapMs=… (first 1 s)
 *   [4265-DIAG] scroll durationMs=… frames=… maxJsGapMs=… slowFrames=…
 */

const MARKER = '[4265-DIAG]';
const OPEN_WINDOW_MS = 1000;
const FRAME_BUDGET_MS = 16.7;

type OpenRun = {
  startedAt: number;
  firstFrameMs: number | null;
  settledMs: number | null;
  recipientsMs: number | null;
  recipientsSource: 'cache' | 'network' | null;
  maxJsGapMs: number;
  lastBeatAt: number;
  done: boolean;
};

type ScrollRun = { startedAt: number; lastBeatAt: number; frames: number; slowFrames: number; maxJsGapMs: number; active: boolean };

let openRun: OpenRun | null = null;
let scrollRun: ScrollRun | null = null;
let scrollEndTimer: ReturnType<typeof setTimeout> | null = null;

const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());
const round = (value: number | null): string => (value === null ? 'NA' : String(Math.round(value)));

function openBeat(): void {
  const run = openRun;
  if (!run || run.done) return;
  const t = now();
  if (run.lastBeatAt !== 0) run.maxJsGapMs = Math.max(run.maxJsGapMs, t - run.lastBeatAt);
  run.lastBeatAt = t;
  if (t - run.startedAt < OPEN_WINDOW_MS) {
    requestAnimationFrame(openBeat);
    return;
  }
  run.done = true;
  // Give a slow recipients fetch a little longer before printing the line.
  setTimeout(() => {
    console.info(`${MARKER} open firstFrameMs=${round(run.firstFrameMs)} settledMs=${round(run.settledMs)} recipientsMs=${round(run.recipientsMs)} (${run.recipientsSource ?? 'none'}) maxJsGapMs=${round(run.maxJsGapMs)}`);
  }, 1200);
}

/** Call at the very top of the tap handler. */
export function beginShareSheetOpen(): void {
  if (!__DEV__) return;
  openRun = { startedAt: now(), firstFrameMs: null, settledMs: null, recipientsMs: null, recipientsSource: null, maxJsGapMs: 0, lastBeatAt: 0, done: false };
  requestAnimationFrame(openBeat);
}

/** Call from an effect that runs after the visible=true commit. */
export function markShareSheetFirstFrame(): void {
  if (!__DEV__) return;
  const run = openRun;
  if (!run || run.firstFrameMs !== null) return;
  requestAnimationFrame(() => { if (run.firstFrameMs === null) run.firstFrameMs = now() - run.startedAt; });
}

/** The open animation reached its snap point. */
export function markShareSheetSettled(): void {
  if (!__DEV__) return;
  const run = openRun;
  if (!run || run.settledMs !== null) return;
  run.settledMs = now() - run.startedAt;
}

/** Real rows (or the empty state) are on screen. */
export function markShareRecipientsRendered(source: 'cache' | 'network'): void {
  if (!__DEV__) return;
  const run = openRun;
  if (!run || run.recipientsMs !== null) return;
  requestAnimationFrame(() => {
    if (run.recipientsMs !== null) return;
    run.recipientsMs = now() - run.startedAt;
    run.recipientsSource = source;
  });
}

function scrollBeat(): void {
  const run = scrollRun;
  if (!run || !run.active) return;
  const t = now();
  if (run.lastBeatAt !== 0) {
    const gap = t - run.lastBeatAt;
    run.maxJsGapMs = Math.max(run.maxJsGapMs, gap);
    if (gap > FRAME_BUDGET_MS * 1.5) run.slowFrames += 1;
  }
  run.frames += 1;
  run.lastBeatAt = t;
  requestAnimationFrame(scrollBeat);
}

export function beginShareSheetScroll(): void {
  if (!__DEV__) return;
  if (scrollEndTimer) { clearTimeout(scrollEndTimer); scrollEndTimer = null; }
  if (scrollRun?.active) return;
  scrollRun = { startedAt: now(), lastBeatAt: 0, frames: 0, slowFrames: 0, maxJsGapMs: 0, active: true };
  requestAnimationFrame(scrollBeat);
}

/** Debounced so a drag that hands over to momentum counts as one scroll. */
export function endShareSheetScroll(): void {
  if (!__DEV__) return;
  if (scrollEndTimer) clearTimeout(scrollEndTimer);
  scrollEndTimer = setTimeout(() => {
    scrollEndTimer = null;
    const run = scrollRun;
    if (!run || !run.active) return;
    run.active = false;
    console.info(`${MARKER} scroll durationMs=${round(now() - run.startedAt)} frames=${run.frames} maxJsGapMs=${round(run.maxJsGapMs)} slowFrames=${run.slowFrames}`);
  }, 250);
}
