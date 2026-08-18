// #2107 — JavaScript (OTA) update policy + the acknowledgement state machine.
//
// PURE MODULE. No react-native, no expo-updates, no network client imports —
// every effect arrives through injected dependencies. That is what lets the
// adversarial suite drive every branch of a boot-critical path directly.
//
// CANONICAL SOURCE. This file is mirrored byte-for-byte into
// mingla-business/src/services/otaUpdatePolicy.ts except for OTA_POLICY_APP_ID,
// and .github/scripts/strict-grep/issue-2107-mandatory-js-update.mjs fails the
// build if the two drift. #2075 shipped two copies of the equivalent file with
// no parity gate and they had already diverged by 30 lines when #2107 read them.
//
// THE ONE RULE THIS FILE EXISTS TO HOLD: blocking is only ever the result of a
// successfully parsed, explicitly blocking policy. Every failure, timeout,
// malformed body, unknown mode and missing row resolves to `silent`. A bug that
// blocks cannot be fixed by OTA for anyone it has already blocked.

export const OTA_POLICY_APP_ID = "business" as const;
export const OTA_POLICY_SCHEMA = 1 as const;

/** Bounded attempts before force_restart gives up and lets the user in. */
export const FORCE_RESTART_MAX_ATTEMPTS = 2;

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

export type OtaGatePhase = "open" | "acknowledge" | "installing";

export type OtaGateSnapshot = {
  phase: OtaGatePhase;
  mode: OtaUpdateMode;
  message: string;
  updateId: string | null;
};

export type OtaUpdateCheck = {
  isAvailable: boolean;
  isRollBackToEmbedded: boolean;
  updateId: string | null;
};

export type OtaUpdateBridge = {
  isEnabled: boolean;
  runtimeVersion: string | null;
  checkForUpdate: () => Promise<OtaUpdateCheck>;
  fetchUpdate: () => Promise<void>;
  reload: () => Promise<void>;
};

export type OtaGateDependencies = {
  platform: OtaPlatform | null;
  updates: OtaUpdateBridge;
  fetchPolicy: (runtimeVersion: string) => Promise<AppOtaPolicy>;
  loadAcknowledgement: () => Promise<string | null>;
  saveAcknowledgement: (updateId: string) => Promise<void>;
  report: (event: string, detail?: Record<string, string | number>) => void;
  timeoutMs?: number;
};

export const POLICY_CHECK_TIMEOUT_MS = 2_500;

const OPEN: OtaGateSnapshot = {
  phase: "open",
  mode: "silent",
  message: "",
  updateId: null,
};

export function isOtaUpdateMode(value: unknown): value is OtaUpdateMode {
  return value === "silent" || value === "acknowledge" ||
    value === "force_restart";
}

/**
 * Exact-key-set validation, matching #2075's parsePolicy discipline. An unknown
 * mode string is NOT a parse failure in the eyes of the server, but it is
 * treated as one here — a client that cannot name the mode must not act on it.
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

export function getAcknowledgementCacheKey(
  platform: OtaPlatform,
  runtimeVersion: string,
): string {
  return [
    "mingla.otaAcknowledgement",
    OTA_POLICY_APP_ID,
    platform,
    runtimeVersion,
    `schema${OTA_POLICY_SCHEMA}`,
  ].join(".");
}

function withTimeout<T>(
  work: Promise<T>,
  timeoutMs: number,
  onTimeout: () => void,
): Promise<T | null> {
  return new Promise<T | null>((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      onTimeout();
      resolve(null);
    }, timeoutMs);
    work.then(
      (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(null);
      },
    );
  });
}

export class OtaGateCoordinator {
  private snapshot: OtaGateSnapshot = OPEN;
  private listeners = new Set<(snapshot: OtaGateSnapshot) => void>();
  private inFlight: Promise<OtaGateSnapshot> | null = null;
  private forceRestartAttempts = 0;
  private acknowledging = false;

  constructor(private readonly dependencies: OtaGateDependencies) {}

  getSnapshot = (): OtaGateSnapshot => this.snapshot;

  subscribe = (
    listener: (snapshot: OtaGateSnapshot) => void,
  ): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  check(): Promise<OtaGateSnapshot> {
    if (this.inFlight !== null) return this.inFlight;
    // Never re-arm over a layer the user is already looking at, and never
    // interrupt an in-progress force_restart install.
    if (this.snapshot.phase !== "open") {
      return Promise.resolve(this.snapshot);
    }
    this.inFlight = this.resolve().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  /**
   * The single action on the blocking layer. Idempotent: a second tap while the
   * first is still working is a no-op, not a second fetch.
   */
  acknowledge = async (): Promise<void> => {
    if (this.acknowledging) return;
    if (this.snapshot.phase !== "acknowledge") return;
    this.acknowledging = true;
    const { updateId, mode } = this.snapshot;
    try {
      if (updateId !== null) {
        try {
          await this.dependencies.saveAcknowledgement(updateId);
        } catch {
          // A device that cannot persist the acknowledgement still gets through.
          // Re-prompting next launch is annoying; refusing to release is not
          // recoverable by OTA.
          this.dependencies.report("acknowledgement_persist_failed");
        }
      }
      if (mode === "force_restart") {
        await this.installAndReload();
        return;
      }
      this.dependencies.report("acknowledged");
      // Fire-and-forget. The user is released the instant they tap; the bytes
      // land in the background and expo-updates applies them on next launch.
      void this.dependencies.updates.fetchUpdate().then(
        () => this.dependencies.report("background_fetch_succeeded"),
        () => this.dependencies.report("background_fetch_failed"),
      );
      this.publish(OPEN);
    } finally {
      this.acknowledging = false;
    }
  };

  private async installAndReload(): Promise<void> {
    this.publish({ ...this.snapshot, phase: "installing" });
    while (this.forceRestartAttempts < FORCE_RESTART_MAX_ATTEMPTS) {
      this.forceRestartAttempts += 1;
      try {
        await this.dependencies.updates.fetchUpdate();
        this.dependencies.report("force_restart_reloading", {
          attempt: this.forceRestartAttempts,
        });
        await this.dependencies.updates.reload();
        return;
      } catch {
        this.dependencies.report("force_restart_attempt_failed", {
          attempt: this.forceRestartAttempts,
        });
      }
    }
    // BOUNDED THEN OPEN. If the update this policy demands cannot be installed
    // on this runtime, the operator raised a requirement nobody published for
    // it. Holding the user here would brick every install on the lane with no
    // OTA path out; the correct fix is publishing the missing update.
    this.dependencies.report("force_restart_exhausted_failing_open");
    this.publish(OPEN);
  }

  private async resolve(): Promise<OtaGateSnapshot> {
    const { platform, updates, report } = this.dependencies;
    if (platform === null || !updates.isEnabled) return this.publish(OPEN);

    const runtimeVersion = updates.runtimeVersion;
    if (runtimeVersion === null || !SEMVER_PATTERN.test(runtimeVersion)) {
      report("runtime_version_unavailable");
      return this.publish(OPEN);
    }

    const timeoutMs = this.dependencies.timeoutMs ?? POLICY_CHECK_TIMEOUT_MS;
    const policy = await withTimeout(
      this.dependencies.fetchPolicy(runtimeVersion),
      timeoutMs,
      () => report("policy_timeout"),
    );

    // EVERY non-answer is silent. This is the inverse of #2075's native gate,
    // which deliberately replays a cached `required` — a stale native block
    // still has a working store exit, a stale JS block does not.
    if (policy === null || policy.mode === "silent") {
      report(policy === null ? "policy_unavailable_silent" : "silent");
      return this.publish(OPEN);
    }

    const check = await withTimeout(
      updates.checkForUpdate(),
      timeoutMs,
      () => report("update_check_timeout"),
    );
    if (check === null) return this.publish(OPEN);

    // A roll-back-to-embedded is an operator recovery action, not an update the
    // user should be held for.
    if (check.isRollBackToEmbedded || !check.isAvailable) {
      report("nothing_to_adopt");
      return this.publish(OPEN);
    }

    const acknowledged = await withTimeout(
      this.dependencies.loadAcknowledgement(),
      timeoutMs,
      () => report("acknowledgement_read_timeout"),
    );
    if (
      check.updateId !== null && acknowledged !== null &&
      acknowledged === check.updateId
    ) {
      report("already_acknowledged");
      return this.publish(OPEN);
    }

    report("blocking", { mode: policy.mode });
    return this.publish({
      phase: "acknowledge",
      mode: policy.mode,
      message: policy.message.trim().length > 0
        ? policy.message
        : "A required update is ready.",
      updateId: check.updateId,
    });
  }

  private publish(snapshot: OtaGateSnapshot): OtaGateSnapshot {
    this.snapshot = snapshot;
    for (const listener of this.listeners) listener(snapshot);
    return snapshot;
  }
}
