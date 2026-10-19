// #2107 — the pure core behind every in-app restart.
//
// WHY: Sentry REACT-NATIVE-1C. Explorer 1.1.6 called Updates.reloadAsync
// from the optional "tap to refresh" banner, and 70 ms later a Supabase upsert
// went out while the bridge was tearing down. RCTNetworking threw
// NSInvalidArgumentException in -[RCTNetworking prioritizedHandlers] and the
// app died. Any network request issued during a reload can do this.
//
// So a restart is never a bare reloadAsync call. It runs, in order:
//   1. pause   — stop app-level network work (the app fence holds new Supabase
//                requests, React Query goes offline and cancels, realtime goes)
//   2. flush   — send analytics once, capped. It has to leave BEFORE the
//                lockdown below, or the lockdown would hold it forever.
//   3. lockdown— hold every other new HTTP send in the JS process.
//   4. settle  — let requests already on the wire finish (a write the person
//                just made is not dropped), capped.
//   5. reload  — only now.
// If the reload throws, or resolves and this process is still alive a while
// later, every step is undone and the app keeps working (fail open).
//
// Every step is best-effort: a throw or a hang in any one of them never blocks
// the reload, and never blocks the app.
//
// This file is byte-identical in app-mobile and mingla-business, enforced by
// .github/scripts/strict-grep/issue-2107-mandatory-js-update.mjs. It imports
// nothing, so it can never pull a native module into either app or into a web
// bundle.

/** Hard ceiling on waiting for requests already on the wire. */
export const SAFE_RELOAD_SETTLE_CAP_MS = 1_500;
/** Ceiling on the one analytics flush. */
export const SAFE_RELOAD_FLUSH_CAP_MS = 400;
/** Ceiling on any single pause / lockdown / resume step. */
export const SAFE_RELOAD_STEP_CAP_MS = 300;
/**
 * reloadAsync resolves just before the restart is posted. If this process is
 * still alive this long afterwards, no restart happened: undo the pause. It is
 * shorter than the critical gate's RELOAD_GRACE_MS (10 s), so the network is
 * back before that gate lets the person in.
 */
export const SAFE_RELOAD_RESTORE_AFTER_MS = 5_000;

export interface SafeReloadStep {
  name: string;
  pause: () => void | Promise<void>;
  resume?: () => void | Promise<void>;
}

export interface SafeReloadFlush {
  name: string;
  run: () => void | Promise<void>;
}

export interface SafeReloadDependencies {
  /** Stop app-level network work. Undone, in reverse, if the reload fails. */
  pause: SafeReloadStep[];
  /** Run once after the pause and before the lockdown. */
  flush: SafeReloadFlush[];
  /** Hold every remaining new send. Undone first if the reload fails. */
  lockdown: SafeReloadStep[];
  /** Resolves when no request is on the wire. Raced against the settle cap. */
  settle: () => Promise<void>;
  /** The real restart. The only call that may end this process. */
  reload: () => Promise<void>;
  /** Where a failed step is reported. Defaults to console.warn. */
  warn?: (message: string) => void;
  settleCapMs?: number;
  flushCapMs?: number;
  stepCapMs?: number;
  restoreAfterMs?: number;
}

export type SafeReloadPhase =
  | "pause"
  | "flush"
  | "lockdown"
  | "settle"
  | "reload"
  | "restore";

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Runs `work` and resolves when it settles or after `capMs`, whichever comes
 * first. Never rejects: a throw (sync or async) is reported and swallowed here
 * because the restart must go ahead regardless.
 */
async function bounded(
  label: string,
  work: () => void | Promise<void>,
  capMs: number,
  warn: (message: string) => void,
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const cap = new Promise<"cap">((resolve) => {
    timer = setTimeout(() => resolve("cap"), capMs);
  });
  const run = Promise.resolve()
    .then(work)
    .then(
      () => "done" as const,
      (error: unknown) => {
        warn(`[OTA] safeReload ${label} failed: ${describe(error)}`);
        return "failed" as const;
      },
    );
  const outcome = await Promise.race([run, cap]);
  if (timer !== null) clearTimeout(timer);
  if (outcome === "cap") warn(`[OTA] safeReload ${label} hit its ${capMs} ms cap`);
}

/**
 * Builds the one restart function an app routes every reload through.
 * Concurrent calls while a restart is in progress join the same attempt.
 */
export function createSafeReload(
  dependencies: SafeReloadDependencies,
  onPhase?: (phase: SafeReloadPhase, name?: string) => void,
): () => Promise<void> {
  const warn = dependencies.warn ?? ((message: string) => console.warn(message));
  const stepCap = dependencies.stepCapMs ?? SAFE_RELOAD_STEP_CAP_MS;
  let inProgress: Promise<void> | null = null;
  // Set after a reload resolved but before its restore timer fired. A second
  // restart in that window undoes the first pause before applying its own, so a
  // late timer can never reopen the network in the middle of a new attempt.
  let pendingRestore: (() => Promise<void>) | null = null;

  const mark = (phase: SafeReloadPhase, name?: string): void => {
    try {
      onPhase?.(phase, name);
    } catch {
      // An observer is test/diagnostic only; it must never affect a restart.
    }
  };

  const attempt = async (): Promise<void> => {
    if (pendingRestore !== null) await pendingRestore();
    const paused: SafeReloadStep[] = [];
    let restored = false;
    let restoreTimer: ReturnType<typeof setTimeout> | null = null;

    // Undo in reverse order: lockdown first (it was applied last), then pause.
    const restore = async (): Promise<void> => {
      if (restored) return;
      restored = true;
      if (restoreTimer !== null) clearTimeout(restoreTimer);
      if (pendingRestore === restore) pendingRestore = null;
      mark("restore");
      for (const step of [...paused].reverse()) {
        const resume = step.resume;
        if (resume === undefined) continue;
        await bounded(`resume ${step.name}`, resume, stepCap, warn);
      }
    };

    for (const step of dependencies.pause) {
      mark("pause", step.name);
      paused.push(step);
      await bounded(`pause ${step.name}`, step.pause, stepCap, warn);
    }
    for (const flush of dependencies.flush) {
      mark("flush", flush.name);
      await bounded(
        `flush ${flush.name}`,
        flush.run,
        dependencies.flushCapMs ?? SAFE_RELOAD_FLUSH_CAP_MS,
        warn,
      );
    }
    for (const step of dependencies.lockdown) {
      mark("lockdown", step.name);
      paused.push(step);
      await bounded(`lockdown ${step.name}`, step.pause, stepCap, warn);
    }
    mark("settle");
    await bounded(
      "settle",
      dependencies.settle,
      dependencies.settleCapMs ?? SAFE_RELOAD_SETTLE_CAP_MS,
      warn,
    );

    mark("reload");
    try {
      await dependencies.reload();
    } catch (error: unknown) {
      // No restart happened. Put everything back so the app keeps working,
      // then let the caller see the failure it already knows how to handle.
      await restore();
      throw error;
    }
    // A resolved reload normally ends this process before this timer fires. If
    // it fires, the restart did not happen.
    pendingRestore = restore;
    restoreTimer = setTimeout(() => {
      void restore();
    }, dependencies.restoreAfterMs ?? SAFE_RELOAD_RESTORE_AFTER_MS);
  };

  return () => {
    if (inProgress !== null) return inProgress;
    inProgress = attempt().finally(() => {
      inProgress = null;
    });
    return inProgress;
  };
}
