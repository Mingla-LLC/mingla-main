// #2107 (U1) — what a launch error means for the running update, pure core.
//
// Byte-identical in app-mobile and mingla-business (parity-gated by
// .github/scripts/strict-grep/issue-2107-mandatory-js-update.mjs). It imports
// nothing; the runtime (updateLaunchRuntime.ts) supplies every effect.
//
// THE PROBLEM. React Native 0.81 reports a React render error as NON-fatal
// (Libraries/Core/ReactFiberErrorDialog.js:55 calls handleException(error,
// false)), so an update that throws while rendering left the process alive on
// a blank screen. The root boundary now shows the restart screen instead, on
// every launch, and this guard classifies the error for telemetry.
//
// WHY IT NEVER RAISES A FATAL (expo-updates 29.0.17, measured on Android).
// - expo-updates rolls back only on a FATAL error raised before native content
//   appears: content appearing marks the launch successful and drops the
//   cached relaunch (ErrorRecoveryHandler.kt:76-82, 116-122; iOS
//   ErrorRecovery.swift:155-164, 306-316).
// - Content appears before the app's root layout first renders. On a release
//   build (Samsung A72, PR #3985) a React commit probe logged two commits
//   holding a native view (RCTView, from the providers above the root layout)
//   before a first-render throw in the layout reached any boundary. Raising
//   that error as fatal, even with nothing further committed, only crashed the
//   app ("UpdatesErrorRecovery: could not recover from error, crashing") and
//   every later cold start reopened the same update.
// - So escalating a render error adds a crash and never a rollback. It is not
//   done. A module-load throw (before anything renders) is fatal on its own and
//   still rolls back natively; nothing here touches fatal errors.
// - Recovery from a broken update that throws while rendering relies on the
//   release checklist (docs/MINGLA_ENGINEERING_HANDBOOK.md §7.6): smoke-test on
//   a release build, the `silent` off-switch, publishing a rollback.
//
// What it still records: `update_launch_confirmed_good` for a healthy launch,
// and `update_launch_error` with whether the failing launch was a downloaded,
// never-confirmed update (the case a rollback would have been for). The
// in-app reload marker tells a launch started by the app's own restart apart
// from a fresh process.

export const UPDATE_LAUNCH_WINDOW_MS = 9_000;
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
  confirmed: string[];
  inAppReloadAt: number | null;
};

export type LaunchErrorSource = "root_boundary" | "global_handler";

export type LaunchErrorReason =
  | "updates_disabled"
  | "embedded_launch"
  | "emergency_launch"
  | "window_elapsed"
  | "confirmed_good"
  | "in_app_reload"
  | "store_unavailable"
  | "unconfirmed_download";

/** The reasons that mean "a downloaded update that was never confirmed good". */
const UNCONFIRMED_DOWNLOAD_REASONS: readonly LaunchErrorReason[] = [
  "unconfirmed_download",
  "in_app_reload",
  "window_elapsed",
];

/** Every launch error is shown on the restart screen; the reason is telemetry. */
export type LaunchErrorOutcome = { kind: "restart_screen"; reason: LaunchErrorReason };

type TelemetryValue = string | number | boolean | null;

export type UpdateLaunchStore = {
  /** Null when nothing is stored yet. Throws when storage is unavailable. */
  read: () => string | null;
  write: (value: string) => void;
};

export type UpdateLaunchGuardDependencies = {
  now: () => number;
  /** Null when the updates runtime cannot be read. */
  readFacts: () => UpdateLaunchFacts | null;
  store: UpdateLaunchStore;
  report: (event: string, properties: Record<string, TelemetryValue>) => void;
  setTimer: (callback: () => void, ms: number) => void;
};

export const EMPTY_UPDATE_LAUNCH_RECORD: UpdateLaunchRecord = {
  confirmed: [],
  inAppReloadAt: null,
};

function isIdList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

/**
 * Null means "stored but unreadable": the guard must not trust it. A record
 * written by an earlier build may still carry an `escalated` list; it is
 * ignored and dropped on the next write.
 */
export function parseUpdateLaunchRecord(raw: string | null): UpdateLaunchRecord | null {
  if (raw === null || raw.trim() === "") return { ...EMPTY_UPDATE_LAUNCH_RECORD };
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const record = parsed as Record<string, unknown>;
    if (!isIdList(record.confirmed)) return null;
    const at = record.inAppReloadAt;
    if (at !== null && (typeof at !== "number" || !Number.isFinite(at))) return null;
    return { confirmed: record.confirmed, inAppReloadAt: at };
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
  private launchState: LaunchState | null | undefined = undefined;
  private lastError: { error: unknown; outcome: LaunchErrorOutcome } | null = null;

  constructor(private readonly dependencies: UpdateLaunchGuardDependencies) {
    this.startedAt = dependencies.now();
  }

  /**
   * Consumes the in-app reload marker now, on every launch (embedded included),
   * so a marker can only ever describe the reload that started this process.
   * Then arms the window: a launch that stays healthy for it is confirmed good.
   */
  start(): void {
    this.readLaunchState();
    try {
      this.dependencies.setTimer(() => this.confirm("window_elapsed"), UPDATE_LAUNCH_WINDOW_MS);
    } catch {
      // Without a timer the first healthy commit still confirms the launch.
    }
  }

  /** The root rendered and committed without an error. */
  noteHealthyCommit(): void {
    this.confirm("first_commit");
  }

  /** A fatal error passed through untouched; never confirm this launch. */
  noteFatalError(): void {
    this.errorSeen = true;
  }

  /** Classifies and reports a non-fatal launch error. Never raises anything. */
  handleError(error: unknown, source: LaunchErrorSource): LaunchErrorOutcome {
    // React can hand the same error to a boundary more than once.
    if (this.lastError !== null && this.lastError.error === error) return this.lastError.outcome;
    const outcome = this.decide(error, source);
    this.lastError = { error, outcome };
    return outcome;
  }

  private decide(error: unknown, source: LaunchErrorSource): LaunchErrorOutcome {
    this.errorSeen = true;
    const facts = this.readFacts();
    const updateId = facts?.updateId ?? null;
    const outcome = (reason: LaunchErrorReason): LaunchErrorOutcome => {
      this.dependencies.report("update_launch_error", {
        update_id: updateId,
        error_class: errorClassOf(error),
        source,
        reason,
        unconfirmed_download: UNCONFIRMED_DOWNLOAD_REASONS.includes(reason),
      });
      return { kind: "restart_screen", reason };
    };

    if (facts === null || !facts.enabled) return outcome("updates_disabled");
    if (facts.isEmbeddedLaunch || updateId === null) return outcome("embedded_launch");
    if (facts.isEmergencyLaunch) return outcome("emergency_launch");
    if (this.confirmed) return outcome("confirmed_good");
    const state = this.readLaunchState();
    if (state === null) return outcome("store_unavailable");
    if (state.record.confirmed.includes(updateId)) return outcome("confirmed_good");
    if (this.dependencies.now() - this.startedAt > UPDATE_LAUNCH_WINDOW_MS) {
      return outcome("window_elapsed");
    }
    if (state.startedByInAppReload) return outcome("in_app_reload");
    return outcome("unconfirmed_download");
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
   * Read once per process, at start(). The in-app reload marker is consumed
   * here, so it can only ever describe the reload that started this process.
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
