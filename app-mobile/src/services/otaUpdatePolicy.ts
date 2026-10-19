// #2107 — JavaScript (OTA) critical-update policy + the apply state machine.
//
// PURE MODULE. No react-native, no expo-updates, no network client imports —
// every effect arrives through injected dependencies. That is what lets the
// adversarial suite drive every branch of a boot-critical path directly.
//
// CANONICAL SOURCE. This file is mirrored byte-for-byte into
// mingla-business/src/services/otaUpdatePolicy.ts except for OTA_POLICY_APP_ID,
// and .github/scripts/strict-grep/issue-2107-mandatory-js-update.mjs fails the
// build if the two drift.
//
// WHAT DECIDES "CRITICAL" (2026-10-19 redesign, replaces the per-runtime
// acknowledge prompt). Every store build and every OTA carries an integer
// `extra.criticalIndex` (app.config.js reads it from update-critical-index.json).
// Publishing a critical fix means raising that integer. When the update the
// server offers carries a HIGHER index than the code that is running, the
// update is critical: the app shows a full-screen "Updating" screen, downloads
// it, records the attempt, and restarts into it. Anything else is a normal
// update and stays silent.
//
// The server table (app_ota_policies) is now only a kill switch, and it is ON
// by default: no row for a runtime means critical updates ARE enforced, so a
// new native version can never silently lapse enforcement again (the 1.1.6
// lapse). A row with mode `silent` switches enforcement off for that runtime.
// `acknowledge` and `force_restart` rows both mean "enforce". An unreachable
// policy endpoint also means "enforce": the counter decides, the server can
// only switch it off.
//
// THE ONE RULE THIS FILE EXISTS TO HOLD: blocking is only ever a deliberate,
// bounded branch. Every failure, timeout, throw, offline check, emergency
// launch, previously-failed update and exhausted attempt count lets the person
// in. A gate bug that blocks cannot be fixed by OTA for anyone it has blocked.

export const OTA_POLICY_APP_ID = "explorer" as const;
export const OTA_POLICY_SCHEMA = 1 as const;

/**
 * Restarts into the same critical update before it stops blocking. PERSISTED
 * across restarts — an in-memory counter resets on every reload and is exactly
 * how the old force_restart mode could loop.
 */
export const CRITICAL_UPDATE_MAX_ATTEMPTS = 2;

export const POLICY_CHECK_TIMEOUT_MS = 2_500;
export const UPDATE_CHECK_TIMEOUT_MS = 8_000;
export const UPDATE_DOWNLOAD_TIMEOUT_MS = 30_000;
export const RECORD_IO_TIMEOUT_MS = 2_500;
/** If reloadAsync resolves and the process is still alive after this, give up. */
export const RELOAD_GRACE_MS = 10_000;

/**
 * The server's absent-row default carries this exact timestamp
 * (supabase/functions/_shared/appOtaPolicy.ts ABSENT_POLICY_ROW_UPDATED_AT).
 * It is how this client tells "no row" (enforce) from a real `silent` row (off)
 * without changing the response every shipped client validates.
 */
export const ABSENT_POLICY_ROW_UPDATED_AT = "1970-01-01T00:00:00.000Z";

const SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const POLICY_KEYS = [
  "appId",
  "message",
  "mode",
  "platform",
  "runtimeVersion",
  "updatedAt",
] as const;

export type OtaUpdateMode = "silent" | "acknowledge" | "force_restart";
export type OtaPlatform = "ios" | "android";

export type AppOtaPolicy = {
  appId: typeof OTA_POLICY_APP_ID;
  platform: OtaPlatform;
  runtimeVersion: string;
  mode: OtaUpdateMode;
  message: string;
  updatedAt: string;
};

export type CriticalEnforcement = {
  enforce: boolean;
  source: "policy_unreachable" | "no_row" | "row";
};

export type OtaGatePhase = "open" | "updating";

export type OtaGateSnapshot = {
  phase: OtaGatePhase;
  targetUpdateId: string | null;
};

export type OtaUpdateCheck = {
  isAvailable: boolean;
  isRollBackToEmbedded: boolean;
  updateId: string | null;
  /** The offered update's extra.criticalIndex, null when absent or malformed. */
  criticalIndex: number | null;
  /** expo-updates' not-available reason, e.g. "updatePreviouslyFailed". */
  reason: string | null;
};

export type OtaFetchResult = {
  isNew: boolean;
  updateId: string | null;
};

export type OtaUpdateBridge = {
  isEnabled: boolean;
  runtimeVersion: string | null;
  /** Updates.updateId of the code that is running right now. */
  runningUpdateId: string | null;
  /** criticalIndex baked into the code that is running right now. */
  runningCriticalIndex: number | null;
  isEmergencyLaunch: boolean;
  checkForUpdate: () => Promise<OtaUpdateCheck>;
  fetchUpdate: () => Promise<OtaFetchResult>;
  reload: () => Promise<void>;
};

export type OtaReportDetail = Record<string, string | number | boolean | null>;

export type OtaGateDependencies = {
  platform: OtaPlatform | null;
  updates: OtaUpdateBridge;
  fetchPolicy: (runtimeVersion: string) => Promise<AppOtaPolicy>;
  loadAttemptRecord: () => Promise<string | null>;
  saveAttemptRecord: (value: string) => Promise<void>;
  clearAttemptRecord: () => Promise<void>;
  /**
   * F2 (#2107 device test): a one-shot "this gate just restarted the app"
   * marker, stored apart from the attempt record (which stays the loop cap,
   * unchanged). Set right before reload, consumed on the next launch's first
   * read. Only a launch that consumes a marker for the recorded target reports
   * `critical_update_attempt_failed {stage:"relaunch"}`; later cold starts stay
   * quiet. A record with no marker (written before this existed, or a marker
   * that could not be read) is never reported: fail open.
   * Omitted (unit harnesses only): every mismatched launch reports, as before.
   */
  relaunchMarker?: {
    load: () => Promise<string | null>;
    save: (targetUpdateId: string) => Promise<void>;
    clear: () => Promise<void>;
  };
  report: (event: string, detail?: OtaReportDetail) => void;
  policyTimeoutMs?: number;
  checkTimeoutMs?: number;
  downloadTimeoutMs?: number;
  recordTimeoutMs?: number;
  reloadGraceMs?: number;
};

export type CriticalAttemptRecord = {
  targetUpdateId: string;
  attempts: number;
};

const OPEN: OtaGateSnapshot = { phase: "open", targetUpdateId: null };

export function isOtaUpdateMode(value: unknown): value is OtaUpdateMode {
  return value === "silent" || value === "acknowledge" ||
    value === "force_restart";
}

/**
 * Exact-key-set validation, matching #2075's parsePolicy discipline. An unknown
 * mode string is treated as a parse failure — and a parse failure now resolves
 * to "enforce by counter", because the server can only ever switch enforcement
 * off, never be required to switch it on.
 */
export function parseOtaPolicy(
  input: unknown,
  expectedPlatform: OtaPlatform,
  expectedRuntimeVersion: string,
): AppOtaPolicy | null {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    return null;
  }
  const record = input as Record<string, unknown>;
  if (
    Object.keys(record).sort().join("|") !== [...POLICY_KEYS].sort().join("|") ||
    record.appId !== OTA_POLICY_APP_ID ||
    record.platform !== expectedPlatform ||
    record.runtimeVersion !== expectedRuntimeVersion ||
    typeof record.runtimeVersion !== "string" ||
    !SEMVER_PATTERN.test(record.runtimeVersion) ||
    !isOtaUpdateMode(record.mode) ||
    typeof record.message !== "string" ||
    typeof record.updatedAt !== "string" ||
    !Number.isFinite(Date.parse(record.updatedAt))
  ) {
    return null;
  }
  return record as AppOtaPolicy;
}

/**
 * The kill switch. ON by default: only an explicit `silent` row switches
 * critical-update enforcement off for a runtime.
 */
export function resolveCriticalEnforcement(
  policy: AppOtaPolicy | null,
): CriticalEnforcement {
  if (policy === null) return { enforce: true, source: "policy_unreachable" };
  if (policy.mode === "silent" && policy.updatedAt === ABSENT_POLICY_ROW_UPDATED_AT) {
    return { enforce: true, source: "no_row" };
  }
  return { enforce: policy.mode !== "silent", source: "row" };
}

/** A critical index is a non-negative safe integer. Anything else is absent. */
export function parseCriticalIndex(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
}

function readPath(input: unknown, keys: readonly string[]): unknown {
  let cursor: unknown = input;
  for (const key of keys) {
    if (cursor === null || typeof cursor !== "object" || Array.isArray(cursor)) {
      return undefined;
    }
    cursor = (cursor as Record<string, unknown>)[key];
  }
  return cursor;
}

/** Reads `extra.expoClient.extra.criticalIndex` off an Expo updates manifest. */
export function criticalIndexFromManifest(manifest: unknown): number | null {
  return parseCriticalIndex(
    readPath(manifest, ["extra", "expoClient", "extra", "criticalIndex"]),
  );
}

/** Reads `extra.criticalIndex` off an Expo config (Constants.expoConfig). */
export function criticalIndexFromExpoConfig(config: unknown): number | null {
  return parseCriticalIndex(readPath(config, ["extra", "criticalIndex"]));
}

export function getAttemptRecordKey(
  platform: OtaPlatform,
  runtimeVersion: string,
): string {
  return [
    "mingla.criticalUpdateAttempt",
    OTA_POLICY_APP_ID,
    platform,
    runtimeVersion,
    `schema${OTA_POLICY_SCHEMA}`,
  ].join(".");
}

export function parseAttemptRecord(raw: string | null): CriticalAttemptRecord | null {
  if (raw === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }
  const record = parsed as Record<string, unknown>;
  if (
    typeof record.targetUpdateId !== "string" ||
    record.targetUpdateId.length === 0 ||
    typeof record.attempts !== "number" ||
    !Number.isSafeInteger(record.attempts) ||
    record.attempts < 0
  ) {
    return null;
  }
  return { targetUpdateId: record.targetUpdateId, attempts: record.attempts };
}

type Timed<T> = { ok: true; value: T } | { ok: false; reason: "timeout" | "error" };

function withTimeout<T>(work: Promise<T>, timeoutMs: number): Promise<Timed<T>> {
  return new Promise<Timed<T>>((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve({ ok: false, reason: "timeout" });
    }, timeoutMs);
    work.then(
      (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ ok: true, value });
      },
      () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ ok: false, reason: "error" });
      },
    );
  });
}

export class OtaGateCoordinator {
  private snapshot: OtaGateSnapshot = OPEN;
  private listeners = new Set<(snapshot: OtaGateSnapshot) => void>();
  private inFlight: Promise<OtaGateSnapshot> | null = null;
  private launchVerified = false;

  constructor(private readonly dependencies: OtaGateDependencies) {}

  getSnapshot = (): OtaGateSnapshot => this.snapshot;

  subscribe = (
    listener: (snapshot: OtaGateSnapshot) => void,
  ): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** Cold start and every foreground. Never re-enters an in-progress install. */
  check(): Promise<OtaGateSnapshot> {
    // An install in progress answers immediately with where it is; a resume
    // never waits on, restarts or stacks a second download.
    if (this.snapshot.phase !== "open") {
      return Promise.resolve(this.snapshot);
    }
    if (this.inFlight !== null) return this.inFlight;
    this.inFlight = this.resolve()
      .catch((error: unknown) => {
        // Any unexpected throw anywhere in the pipeline lets the person in.
        this.dependencies.report("critical_update_gate_error", {
          message: error instanceof Error ? error.message : "unknown",
        });
        return this.publish(OPEN);
      })
      .finally(() => {
        this.inFlight = null;
      });
    return this.inFlight;
  }

  private detail(extra: OtaReportDetail = {}): OtaReportDetail {
    const { updates } = this.dependencies;
    return {
      runtime_version: updates.runtimeVersion,
      running_update_id: updates.runningUpdateId,
      running_critical_index: updates.runningCriticalIndex,
      ...extra,
    };
  }

  private async readRecord(): Promise<Timed<CriticalAttemptRecord | null>> {
    const loaded = await withTimeout(
      this.dependencies.loadAttemptRecord(),
      this.dependencies.recordTimeoutMs ?? RECORD_IO_TIMEOUT_MS,
    );
    if (!loaded.ok) {
      this.dependencies.report("critical_update_record_unreadable", {
        reason: loaded.reason,
      });
      return loaded;
    }
    return { ok: true, value: parseAttemptRecord(loaded.value) };
  }

  /**
   * Runs once per process. A pending record means the previous process
   * restarted on purpose to land `targetUpdateId`; this is where we learn
   * whether it did.
   */
  private async verifyLaunch(
    record: CriticalAttemptRecord | null,
  ): Promise<CriticalAttemptRecord | null> {
    const pendingTarget = await this.consumeRelaunchMarker();
    if (record === null) return null;
    const { updates, report } = this.dependencies;
    if (updates.runningUpdateId !== null && updates.runningUpdateId === record.targetUpdateId) {
      report(
        "critical_update_applied_verified",
        this.detail({ target_update_id: record.targetUpdateId, attempts: record.attempts }),
      );
      const cleared = await withTimeout(
        this.dependencies.clearAttemptRecord(),
        this.dependencies.recordTimeoutMs ?? RECORD_IO_TIMEOUT_MS,
      );
      if (!cleared.ok) report("critical_update_record_clear_failed");
      return null;
    }
    // Only the launch right after a restart this gate triggered reports the
    // restart as failed. The record itself is kept: it is the per-target cap.
    if (
      this.dependencies.relaunchMarker !== undefined &&
      pendingTarget !== record.targetUpdateId
    ) {
      return record;
    }
    report(
      "critical_update_attempt_failed",
      this.detail({
        stage: "relaunch",
        target_update_id: record.targetUpdateId,
        attempts: record.attempts,
      }),
    );
    return record;
  }

  /** Reads and clears the one-shot relaunch marker. Unreadable means "none". */
  private async consumeRelaunchMarker(): Promise<string | null> {
    const marker = this.dependencies.relaunchMarker;
    if (marker === undefined) return null;
    const timeoutMs = this.dependencies.recordTimeoutMs ?? RECORD_IO_TIMEOUT_MS;
    const loaded = await withTimeout(marker.load(), timeoutMs);
    const cleared = await withTimeout(marker.clear(), timeoutMs);
    if (!loaded.ok || !cleared.ok) {
      // Console-only diagnostic (no captured prefix): telemetry, not the cap.
      this.dependencies.report("relaunch_marker_io_failed", {
        stage: loaded.ok ? "clear" : "load",
      });
    }
    return loaded.ok ? loaded.value : null;
  }

  private async writeRelaunchMarker(targetUpdateId: string | null): Promise<void> {
    const marker = this.dependencies.relaunchMarker;
    if (marker === undefined) return;
    const written = await withTimeout(
      targetUpdateId === null ? marker.clear() : marker.save(targetUpdateId),
      this.dependencies.recordTimeoutMs ?? RECORD_IO_TIMEOUT_MS,
    );
    if (!written.ok) {
      this.dependencies.report("relaunch_marker_io_failed", {
        stage: targetUpdateId === null ? "clear" : "save",
      });
    }
  }

  private async resolve(): Promise<OtaGateSnapshot> {
    const { platform, updates, report } = this.dependencies;
    if (platform === null || !updates.isEnabled) return this.publish(OPEN);

    const runtimeVersion = updates.runtimeVersion;
    if (runtimeVersion === null || !SEMVER_PATTERN.test(runtimeVersion)) {
      report("runtime_version_unavailable");
      return this.publish(OPEN);
    }

    // The attempt record is the loop cap. A device that cannot read it cannot
    // be loop-capped, so it is never put through a restart.
    const loaded = await this.readRecord();
    if (!loaded.ok) return this.publish(OPEN);
    let record = loaded.value;
    if (!this.launchVerified) {
      this.launchVerified = true;
      record = await this.verifyLaunch(record);
    }

    // expo-updates fell back to the embedded bundle because a downloaded one
    // failed to launch. Holding anyone here could loop a broken update.
    if (updates.isEmergencyLaunch) {
      report("critical_update_emergency_launch", this.detail());
      return this.publish(OPEN);
    }

    const checked = await withTimeout(
      updates.checkForUpdate(),
      this.dependencies.checkTimeoutMs ?? UPDATE_CHECK_TIMEOUT_MS,
    );
    if (!checked.ok) {
      report("critical_update_skipped_offline", this.detail({ stage: "check", reason: checked.reason }));
      return this.publish(OPEN);
    }
    const check = checked.value;
    if (check.reason === "updatePreviouslyFailed") {
      report("critical_update_previously_failed", this.detail());
      return this.publish(OPEN);
    }
    // A roll-back-to-embedded is an operator recovery action, not an update the
    // user should be held for.
    if (check.isRollBackToEmbedded || !check.isAvailable) {
      report("nothing_to_adopt");
      return this.publish(OPEN);
    }

    const offered = check.criticalIndex;
    const running = updates.runningCriticalIndex;
    if (offered === null || running === null) {
      // Cannot compare, so cannot call it critical. expo-updates still picks
      // the update up on a later launch, exactly as before this gate existed.
      report("critical_index_unavailable", this.detail({ offered_critical_index: offered }));
      return this.publish(OPEN);
    }
    if (offered <= running) {
      report("non_critical_update_available", this.detail({ offered_critical_index: offered }));
      return this.publish(OPEN);
    }
    if (check.updateId === null) {
      // Without an id the restart cannot be verified or loop-capped.
      report("critical_update_id_unavailable", this.detail({ offered_critical_index: offered }));
      return this.publish(OPEN);
    }

    const policy = await withTimeout(
      this.dependencies.fetchPolicy(runtimeVersion),
      this.dependencies.policyTimeoutMs ?? POLICY_CHECK_TIMEOUT_MS,
    );
    const enforcement = resolveCriticalEnforcement(policy.ok ? policy.value : null);
    if (!enforcement.enforce) {
      report("critical_update_switched_off", this.detail({ offered_critical_index: offered }));
      return this.publish(OPEN);
    }

    const priorAttempts =
      record !== null && record.targetUpdateId === check.updateId ? record.attempts : 0;
    if (priorAttempts >= CRITICAL_UPDATE_MAX_ATTEMPTS) {
      report(
        "critical_update_attempts_exhausted",
        this.detail({ target_update_id: check.updateId, attempts: priorAttempts }),
      );
      return this.publish(OPEN);
    }

    report(
      "critical_update_offered",
      this.detail({
        target_update_id: check.updateId,
        offered_critical_index: offered,
        attempt: priorAttempts + 1,
        enforcement_source: enforcement.source,
      }),
    );
    this.publish({ phase: "updating", targetUpdateId: check.updateId });
    return this.installAndReload(check.updateId, record);
  }

  private async installAndReload(
    offeredUpdateId: string,
    record: CriticalAttemptRecord | null,
  ): Promise<OtaGateSnapshot> {
    const { updates, report } = this.dependencies;
    const fetched = await withTimeout(
      updates.fetchUpdate(),
      this.dependencies.downloadTimeoutMs ?? UPDATE_DOWNLOAD_TIMEOUT_MS,
    );
    // A failed download consumes NO attempt and records nothing: the next cold
    // start or foreground offers it again.
    if (!fetched.ok) {
      report(
        "critical_update_attempt_failed",
        this.detail({ stage: "download", reason: fetched.reason, target_update_id: offeredUpdateId }),
      );
      return this.publish(OPEN);
    }
    if (!fetched.value.isNew && fetched.value.updateId === null) {
      report(
        "critical_update_attempt_failed",
        this.detail({ stage: "download_not_new", target_update_id: offeredUpdateId }),
      );
      return this.publish(OPEN);
    }

    const targetUpdateId = fetched.value.updateId ?? offeredUpdateId;
    const priorAttempts =
      record !== null && record.targetUpdateId === targetUpdateId ? record.attempts : 0;
    if (priorAttempts >= CRITICAL_UPDATE_MAX_ATTEMPTS) {
      report(
        "critical_update_attempts_exhausted",
        this.detail({ target_update_id: targetUpdateId, attempts: priorAttempts }),
      );
      return this.publish(OPEN);
    }
    const attempts = priorAttempts + 1;

    // PERSIST BEFORE RELOAD. If the restart crashes or lands somewhere else,
    // this record is the only thing that remembers the attempt. A device that
    // cannot write it cannot be loop-capped, so it is not restarted at all.
    const saved = await withTimeout(
      this.dependencies.saveAttemptRecord(JSON.stringify({ targetUpdateId, attempts })),
      this.dependencies.recordTimeoutMs ?? RECORD_IO_TIMEOUT_MS,
    );
    if (!saved.ok) {
      report(
        "critical_update_attempt_failed",
        this.detail({ stage: "persist", reason: saved.reason, target_update_id: targetUpdateId }),
      );
      return this.publish(OPEN);
    }

    // Marks the NEXT launch as "right after a restart this gate triggered".
    await this.writeRelaunchMarker(targetUpdateId);
    report(
      "critical_update_reloading",
      this.detail({ target_update_id: targetUpdateId, attempt: attempts }),
    );
    const reloaded = await withTimeout(updates.reload(), this.dependencies.reloadGraceMs ?? RELOAD_GRACE_MS);
    if (!reloaded.ok && reloaded.reason === "error") {
      // No restart happened, and this failure is reported right here.
      await this.writeRelaunchMarker(null);
      report(
        "critical_update_attempt_failed",
        this.detail({ stage: "reload", target_update_id: targetUpdateId, attempt: attempts }),
      );
      return this.publish(OPEN);
    }
    // reloadAsync resolves just before the restart is posted. If this process
    // is still running a grace period later, the restart did not happen: let
    // the person in. The persisted record still counts the attempt.
    if (reloaded.ok) {
      await new Promise<void>((resolve) =>
        setTimeout(resolve, this.dependencies.reloadGraceMs ?? RELOAD_GRACE_MS),
      );
    }
    // Still alive: no restart, and this failure is reported right here.
    await this.writeRelaunchMarker(null);
    report(
      "critical_update_attempt_failed",
      this.detail({ stage: "reload_did_not_restart", target_update_id: targetUpdateId, attempt: attempts }),
    );
    return this.publish(OPEN);
  }

  private publish(snapshot: OtaGateSnapshot): OtaGateSnapshot {
    this.snapshot = snapshot;
    for (const listener of this.listeners) listener(snapshot);
    return snapshot;
  }
}
