// #2107 (U1) — launch-window escalation for a broken OTA, pure core.
//
// Byte-identical in app-mobile and mingla-business (parity-gated by
// .github/scripts/strict-grep/issue-2107-mandatory-js-update.mjs). It imports
// nothing; the runtime (updateLaunchRuntime.ts) supplies every effect.
//
// THE PROBLEM. React Native 0.81 reports a React render error as NON-fatal
// (Libraries/Core/ReactFiberErrorDialog.js:55 calls handleException(error,
// false)), so an update that throws while rendering leaves the process alive on
// a blank screen and expo-updates' native error recovery never hears of it.
//
// WHAT REALLY ROLLS BACK (expo-updates 29.0.17, read from source):
// - Recovery runs only for a FATAL JS error. Android: the fatal reaches
//   ErrorRecovery.onReactInstanceException (ErrorRecovery.kt:56) through
//   ExpoReactHostFactory.handleInstanceException; iOS: RCTFatal reaches the
//   handler ErrorRecovery installs with RCTSetFatalHandler (ErrorRecovery.swift:338).
// - It marks the launch failed ONLY if native content has not appeared yet
//   (ErrorRecoveryHandler.kt:116-122, ErrorRecovery.swift:155-164), and only
//   then can it relaunch the previous update (LAUNCH_CACHED_UPDATE). Content
//   appearing marks the launch SUCCESSFUL and removes both relaunch tasks
//   (ErrorRecoveryHandler.kt:76-82, ErrorRecovery.swift:306-316); a fatal after
//   that only crashes the app, and the update stays launchable for good
//   (UpdateDao.kt:16 keeps any update with successful_launch_count > 0).
// - Android arms recovery once per process (ExpoReactHostFactory.kt:104-106);
//   an in-app reload does not re-arm it, so a fatal after one tears the React
//   host down with nothing to relaunch it.
//
// So this guard escalates ONLY when escalation can roll back: a non-embedded,
// never-confirmed update, in a fresh process (not straight after an in-app
// reload), inside the launch window, before the app's first healthy commit (the
// JS-side proxy for "native content appeared"), and never twice for one update
// id. Everything else gets the branded restart screen instead of a blank one.

export const UPDATE_LAUNCH_WINDOW_MS = 9_000;
/** How long the boundary waits for native recovery before showing the restart screen. */
export const UPDATE_LAUNCH_ESCALATION_HOLD_MS = 8_000;
/** A marker older than this is not the reload that started this process. */
export const IN_APP_RELOAD_MARKER_MAX_AGE_MS = 60_000;
export const MAX_REMEMBERED_UPDATE_IDS = 5;

export type UpdateLaunchFacts = {
  /** `!__DEV__ && Updates.isEnabled`. */
  enabled: boolean;
  updateId: string | null;
  isEmbeddedLaunch: boolean;
  isEmergencyLaunch: boolean;
};

export type UpdateLaunchRecord = {
  escalated: string[];
  confirmed: string[];
  inAppReloadAt: number | null;
};

export type LaunchErrorSource = "root_boundary" | "global_handler";

export type LaunchSkipReason =
  | "updates_disabled"
  | "embedded_launch"
  | "emergency_launch"
  | "window_elapsed"
  | "confirmed_good"
  | "already_escalated"
  | "in_app_reload"
  | "store_unavailable"
  | "escalation_failed";

export type LaunchErrorOutcome =
  | { kind: "escalated" }
  | { kind: "restart_screen"; reason: LaunchSkipReason };

type TelemetryValue = string | number | boolean | null;

export type UpdateLaunchStore = {
  /** Null when nothing is stored yet. Throws when storage is unavailable. */
  read: () => string | null;
  /** Synchronous: the record must be on disk before a fatal error is raised. */
  write: (value: string) => void;
};

export type UpdateLaunchGuardDependencies = {
  now: () => number;
  /** Null when the updates runtime cannot be read. */
  readFacts: () => UpdateLaunchFacts | null;
  store: UpdateLaunchStore;
  /** Raises the error as a fatal JS error. Must be synchronous. */
  escalate: (error: unknown) => void;
  report: (event: string, properties: Record<string, TelemetryValue>) => void;
  setTimer: (callback: () => void, ms: number) => void;
};

export const EMPTY_UPDATE_LAUNCH_RECORD: UpdateLaunchRecord = {
  escalated: [],
  confirmed: [],
  inAppReloadAt: null,
};

function isIdList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

/** Null means "stored but unreadable": the guard must not trust it. */
export function parseUpdateLaunchRecord(raw: string | null): UpdateLaunchRecord | null {
  if (raw === null || raw.trim() === "") return { ...EMPTY_UPDATE_LAUNCH_RECORD };
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const record = parsed as Record<string, unknown>;
    if (!isIdList(record.escalated) || !isIdList(record.confirmed)) return null;
    const at = record.inAppReloadAt;
    if (at !== null && (typeof at !== "number" || !Number.isFinite(at))) return null;
    return { escalated: record.escalated, confirmed: record.confirmed, inAppReloadAt: at };
  } catch {
    return null;
  }
}

function remember(list: string[], id: string): string[] {
  return [...list.filter((item) => item !== id), id].slice(-MAX_REMEMBERED_UPDATE_IDS);
}

export function serializeUpdateLaunchRecord(record: UpdateLaunchRecord): string {
  return JSON.stringify(record);
}

/** The record with the in-app reload marker set; written just before a restart. */
export function withInAppReloadMarked(
  record: UpdateLaunchRecord | null,
  now: number,
): UpdateLaunchRecord {
  return { ...(record ?? EMPTY_UPDATE_LAUNCH_RECORD), inAppReloadAt: now };
}

export function errorClassOf(error: unknown): string {
  if (error instanceof Error) {
    const name = error.constructor?.name || error.name;
    return name.length > 0 ? name.slice(0, 64) : "Error";
  }
  return error === null ? "null" : typeof error;
}

type LaunchState = {
  record: UpdateLaunchRecord;
  startedByInAppReload: boolean;
};

export class UpdateLaunchGuard {
  private readonly startedAt: number;
  private confirmed = false;
  private errorSeen = false;
  private escalated = false;
  private launchState: LaunchState | null | undefined = undefined;
  private lastError: { error: unknown; outcome: LaunchErrorOutcome } | null = null;

  constructor(private readonly dependencies: UpdateLaunchGuardDependencies) {
    this.startedAt = dependencies.now();
  }

  /** Arms the window: a launch that stays healthy for it is confirmed good. */
  start(): void {
    try {
      this.dependencies.setTimer(() => this.confirm("window_elapsed"), UPDATE_LAUNCH_WINDOW_MS);
    } catch {
      // Without a timer the first healthy commit still confirms the launch.
    }
  }

  /** The root rendered and committed without an error: native content is up. */
  noteHealthyCommit(): void {
    this.confirm("first_commit");
  }

  /** A fatal error native recovery already sees; never confirm this launch. */
  noteFatalError(): void {
    this.errorSeen = true;
  }

  isEscalated(): boolean {
    return this.escalated;
  }

  handleError(error: unknown, source: LaunchErrorSource): LaunchErrorOutcome {
    // React can hand the same error to a boundary more than once.
    if (this.lastError !== null && this.lastError.error === error) return this.lastError.outcome;
    const outcome = this.decide(error, source);
    this.lastError = { error, outcome };
    return outcome;
  }

  private decide(error: unknown, source: LaunchErrorSource): LaunchErrorOutcome {
    this.errorSeen = true;
    if (this.escalated) return { kind: "escalated" };

    const facts = this.readFacts();
    const updateId = facts?.updateId ?? null;
    const skip = (reason: LaunchSkipReason): LaunchErrorOutcome => {
      this.dependencies.report("update_launch_error", {
        update_id: updateId,
        error_class: errorClassOf(error),
        source,
        reason,
      });
      return { kind: "restart_screen", reason };
    };

    if (facts === null || !facts.enabled) return skip("updates_disabled");
    if (facts.isEmbeddedLaunch || updateId === null) return skip("embedded_launch");
    if (facts.isEmergencyLaunch) return skip("emergency_launch");
    if (this.dependencies.now() - this.startedAt > UPDATE_LAUNCH_WINDOW_MS) {
      return skip("window_elapsed");
    }
    if (this.confirmed) return skip("confirmed_good");

    const state = this.readLaunchState();
    if (state === null) return skip("store_unavailable");
    if (state.record.confirmed.includes(updateId)) return skip("confirmed_good");
    if (state.record.escalated.includes(updateId)) return skip("already_escalated");
    if (state.startedByInAppReload) return skip("in_app_reload");

    // Persist BEFORE raising: the fatal may end this process, and the same
    // update id must never be escalated again on a later launch.
    const next: UpdateLaunchRecord = {
      ...state.record,
      escalated: remember(state.record.escalated, updateId),
    };
    try {
      this.dependencies.store.write(serializeUpdateLaunchRecord(next));
      state.record = next;
    } catch {
      return skip("store_unavailable");
    }

    this.dependencies.report("critical_update_launch_failed_escalated", {
      update_id: updateId,
      error_class: errorClassOf(error),
      source,
    });
    try {
      this.escalated = true;
      this.dependencies.escalate(error);
    } catch {
      this.escalated = false;
      return skip("escalation_failed");
    }
    return { kind: "escalated" };
  }

  private confirm(reason: "first_commit" | "window_elapsed"): void {
    if (this.confirmed || this.errorSeen) return;
    this.confirmed = true;
    try {
      const facts = this.readFacts();
      const updateId = facts?.updateId ?? null;
      if (facts === null || !facts.enabled || facts.isEmbeddedLaunch || updateId === null) return;
      const state = this.readLaunchState();
      if (state === null || state.record.confirmed.includes(updateId)) return;
      const next: UpdateLaunchRecord = {
        ...state.record,
        confirmed: remember(state.record.confirmed, updateId),
      };
      this.dependencies.store.write(serializeUpdateLaunchRecord(next));
      state.record = next;
      this.dependencies.report("update_launch_confirmed_good", { update_id: updateId, reason });
    } catch {
      // A confirmation that cannot be stored only means a later launch of this
      // update stays eligible; it never blocks the app.
    }
  }

  private readFacts(): UpdateLaunchFacts | null {
    try {
      return this.dependencies.readFacts();
    } catch {
      return null;
    }
  }

  /**
   * Read once per process. The in-app reload marker is consumed here, so it can
   * only ever describe the reload that started this process.
   */
  private readLaunchState(): LaunchState | null {
    if (this.launchState !== undefined) return this.launchState;
    try {
      const record = parseUpdateLaunchRecord(this.dependencies.store.read());
      if (record === null) {
        this.launchState = null;
        return null;
      }
      const at = record.inAppReloadAt;
      const age = at === null ? null : this.startedAt - at;
      const startedByInAppReload = age !== null && age >= -1_000 && age <= IN_APP_RELOAD_MARKER_MAX_AGE_MS;
      const consumed: UpdateLaunchRecord = { ...record, inAppReloadAt: null };
      if (at !== null) {
        try {
          this.dependencies.store.write(serializeUpdateLaunchRecord(consumed));
        } catch {
          // An unconsumed marker ages out on its own.
        }
      }
      this.launchState = { record: consumed, startedByInAppReload };
    } catch {
      this.launchState = null;
    }
    return this.launchState;
  }
}
