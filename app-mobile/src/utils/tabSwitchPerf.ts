/**
 * tabSwitchPerf — `__DEV__`-only tab-switch latency harness for issue #1638.
 *
 * Marker string: `[1638-DIAG]`.
 *
 * WHY THIS EXISTS AND WHY IT STAYS
 * --------------------------------
 * #1638 was filed three times ("the switch happens and the screen catches up later
 * slowly"). Every previous pass reasoned about the switch from source. Source reasoning
 * cannot tell you whether React *yielded politely* for 400ms or *blocked the JS thread*
 * for 400ms — and that distinction is the entire `startTransition` question. This harness
 * makes the claim falsifiable: any future "tab switches are faster/slower" statement can
 * be reproduced with numbers on the same device instead of re-argued.
 *
 * It is compiled out of release builds: every entry point returns immediately when
 * `__DEV__` is false, so the module holds no state and does no work in production.
 *
 * THE TIMELINE (labels match the #1638 investigation's instrumentation plan)
 * -------------------------------------------------------------------------
 *   T0  press          — first line of the nav Pressable's onPress, before any guard.
 *   T2a onNavigate     — parent handler entered.
 *   T2b afterLog       — after the (dev-only) production logger call. T2b − T2a is the
 *                        console.log cost that `__DEV__`-gating removes from RELEASE
 *                        builds; it is still paid here because this build IS a dev build.
 *   T3  schedule       — inside the transition callback, immediately before setCurrentPage.
 *   T4  render         — the destination's render pass has begun (shell probe render).
 *   T6  commit         — the destination subtree is mounted and laid out (probe layout
 *                        effect: child effects run before parent effects, so this fires
 *                        after every descendant's layout effect).
 *   T8  firstFrame     — rAF scheduled from T6; the closest JS-side proxy for first paint.
 *   TS  scaffoldFrame  — first frame on which the DESTINATION'S STRUCTURE is on screen
 *                        (the #1638 pending state). TS − T0 is the new answer to "when
 *                        does the screen change?", and it is the number the old code had
 *                        no equivalent of at all: before this, nothing changed in the
 *                        content area until T8.
 *
 * The three numbers #1638 asks for:
 *   T4 − T3  pure transition-scheduling gap (React did nothing visible; old screen up)
 *   T6 − T4  destination render + commit
 *   T8 − T0  tap to first frame — the number Seth feels
 *
 * JS-THREAD HEARTBEAT
 * -------------------
 * A self-rearming rAF loop records every inter-frame gap. The largest gap inside a switch
 * window IS the JS block, in milliseconds. Wall-clock marks say how long; the heartbeat
 * says whether the thread was actually blocked.
 *
 * OUTPUT
 * ------
 * ONE compact console line per switch, emitted ~1200ms AFTER the switch settles — never
 * per mark. Logging per mark would measure the instrumentation (console.log is itself a
 * native round trip on the hot path). Read it with:
 *   adb logcat -s ReactNativeJS:V | grep 1638-DIAG
 */

const MARKER = '[1638-DIAG]';

/**
 * A run closes this long after T8 — late enough that the emitting console.log never
 * lands on the hot path, early enough to be well inside the driver's tap interval.
 *
 * This is deliberately NOT a "quiet period" re-armed on every mark. A quiet timer
 * truncated every `home -> likes` run in the first pass: Likes renders in many small
 * transition slices, React yields between them, the timer fired in a gap, and the run
 * was closed and printed before its own T6 ever arrived — reporting `T6-T4=NA` for
 * exactly the switch that needed measuring most.
 */
const RUN_SETTLE_MS = 250;

/** Hard ceiling: emit whatever we have, even if the destination never finished. */
const RUN_CEILING_MS = 6000;

/** A gap larger than this many ms means the JS thread could not service a frame. */
const FRAME_BUDGET_MS = 16.7;

type MarkLabel =
  | 'T0.press'
  | 'T2a.onNavigate'
  | 'T2b.afterLog'
  | 'TS.scaffoldFrame'
  | 'T3.schedule'
  | 'T4.render'
  | 'T6.commit'
  | 'T8.firstFrame';

/**
 * Marks that are only meaningful for the DESTINATION page and are therefore gated on it.
 * A shell re-render that still carries the OLD page must not be mistaken for the
 * destination's render — that would report a falsely small T4 − T3.
 */
type PageGatedLabel = Extract<MarkLabel, 'T4.render' | 'T6.commit' | 'T8.firstFrame'>;

type Run = {
  from: string;
  to: string;
  marks: Partial<Record<MarkLabel, number>>;
  /**
   * Destination render passes BEFORE the commit. > 1 proves React discarded and
   * restarted the in-progress transition render (an urgent update landed mid-transition).
   */
  renderPassesPreCommit: number;
  /** Destination render passes AFTER the commit — ordinary post-mount re-renders. */
  renderPassesPostCommit: number;
  /** Largest JS-thread frame gap observed between T0 and flush. */
  maxJsGapMs: number;
  settleTimer: ReturnType<typeof setTimeout> | null;
  ceilingTimer: ReturnType<typeof setTimeout> | null;
};

let activeRun: Run | null = null;

// ── JS-thread heartbeat ────────────────────────────────────────────────────────
let heartbeatRunning = false;
let lastBeatAt = 0;

const beat = (): void => {
  const now = performance.now();
  if (lastBeatAt !== 0 && activeRun) {
    const gap = now - lastBeatAt;
    if (gap > activeRun.maxJsGapMs) activeRun.maxJsGapMs = gap;
  }
  lastBeatAt = now;
  if (heartbeatRunning) requestAnimationFrame(beat);
};

/**
 * Start the JS-thread heartbeat. Idempotent. Called once from the shell on mount.
 * No-op in release builds.
 */
export const startTabSwitchHeartbeat = (): void => {
  if (!__DEV__) return;
  if (heartbeatRunning) return;
  heartbeatRunning = true;
  lastBeatAt = 0;
  requestAnimationFrame(beat);
};

export const stopTabSwitchHeartbeat = (): void => {
  if (!__DEV__) return;
  heartbeatRunning = false;
};

// ── Run lifecycle ──────────────────────────────────────────────────────────────

const round = (n: number): string => n.toFixed(1);

const flush = (run: Run): void => {
  const m = run.marks;
  const at = (label: MarkLabel): number | null => m[label] ?? null;
  const delta = (a: MarkLabel, b: MarkLabel): string => {
    const x = at(a);
    const y = at(b);
    if (x === null || y === null) return 'NA';
    return round(y - x);
  };
  // One line, one console call, well after the switch has painted.
  console.log(
    `${MARKER} ${run.from}->${run.to}` +
      ` T2b-T2a=${delta('T2a.onNavigate', 'T2b.afterLog')}` +
      ` TS-T0=${delta('T0.press', 'TS.scaffoldFrame')}` +
      ` T4-T3=${delta('T3.schedule', 'T4.render')}` +
      ` T6-T4=${delta('T4.render', 'T6.commit')}` +
      ` T8-T6=${delta('T6.commit', 'T8.firstFrame')}` +
      ` T8-T0=${delta('T0.press', 'T8.firstFrame')}` +
      ` passesPre=${run.renderPassesPreCommit}` +
      ` passesPost=${run.renderPassesPostCommit}` +
      ` maxJsGap=${round(run.maxJsGapMs)}` +
      ` jank=${run.maxJsGapMs > FRAME_BUDGET_MS ? 1 : 0}`,
  );
};

const closeRun = (run: Run): void => {
  if (run.settleTimer) clearTimeout(run.settleTimer);
  if (run.ceilingTimer) clearTimeout(run.ceilingTimer);
  run.settleTimer = null;
  run.ceilingTimer = null;
  flush(run);
  if (activeRun === run) activeRun = null;
};

/**
 * Open a measurement run. Called at T0 from the nav Pressable.
 * A run already in flight is flushed immediately (rapid-tap case) so its partial
 * numbers are never silently merged into the next run's.
 */
export const beginTabSwitchRun = (from: string, to: string): void => {
  if (!__DEV__) return;
  if (activeRun) closeRun(activeRun);
  const run: Run = {
    from,
    to,
    marks: { 'T0.press': performance.now() },
    renderPassesPreCommit: 0,
    renderPassesPostCommit: 0,
    maxJsGapMs: 0,
    settleTimer: null,
    ceilingTimer: null,
  };
  run.ceilingTimer = setTimeout(() => closeRun(run), RUN_CEILING_MS);
  activeRun = run;
};

/** Record a timeline mark against the run in flight. No-op if no run is open. */
export const markTabSwitch = (label: MarkLabel): void => {
  if (!__DEV__) return;
  const run = activeRun;
  if (!run) return;
  run.marks[label] = performance.now();
};

/**
 * Record a destination-gated mark. `page` must be the page the shell is actually
 * rendering/committing; marks for any other page are discarded.
 *
 * T4 deliberately counts EVERY matching render pass but keeps only the FIRST timestamp:
 * `renderPasses > 1` proves React discarded and restarted the in-progress transition
 * render (an urgent update arriving mid-transition), which is one of the open questions
 * the #1638 investigation left for the runtime leg.
 */
export const markTabSwitchForPage = (label: PageGatedLabel, page: string): void => {
  if (!__DEV__) return;
  const run = activeRun;
  if (!run) return;
  if (page !== run.to) return;
  if (label === 'T4.render') {
    if (run.marks['T6.commit'] === undefined) run.renderPassesPreCommit += 1;
    else run.renderPassesPostCommit += 1;
    if (run.marks['T4.render'] !== undefined) return;
  }
  run.marks[label] = performance.now();
  if (label === 'T8.firstFrame' && run.settleTimer === null) {
    run.settleTimer = setTimeout(() => closeRun(run), RUN_SETTLE_MS);
  }
};

/**
 * True while a measurement run is open. Used only by the shell probe so it does not
 * schedule a rAF when nothing is being measured.
 */
export const isTabSwitchRunActive = (): boolean => {
  if (!__DEV__) return false;
  return activeRun !== null;
};
