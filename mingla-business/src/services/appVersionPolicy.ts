import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import {
  APP_VERSION_APP_ID,
  APP_VERSION_SCHEMA,
  getInstalledNativeVersion,
  getNativeAppPlatform,
  type NativeAppPlatform,
} from "./appVersionIdentity";
import { reportUpdateGateEvent } from "./updateGateTelemetry";

/**
 * #2107 A1 — how long the cold-launch veil waits for the server before letting
 * the person in. 4 s with no cached policy (first launch); 1.5 s when a valid
 * cached policy exists. Either way the answer is still applied when it lands.
 */
export const POLICY_CHECK_TIMEOUT_MS = 4_000;
export const POLICY_CHECK_CACHED_TIMEOUT_MS = 1_500;
/** Cap on the local cache read before the network deadline starts anyway. */
export const POLICY_CACHE_READ_CAP_MS = 3_000;
/**
 * The network request itself is allowed to outlive the veil deadline by a long
 * way: that is what lets a slow-network answer arrive late and still block.
 */
export const POLICY_FETCH_ABORT_MS = 20_000;

const SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const POLICY_KEYS = [
  "appId",
  "enforcementMode",
  "message",
  "minimumVersion",
  "platform",
  "storeUrl",
  "updatedAt",
] as const;

export type AppVersionPolicy = {
  appId: typeof APP_VERSION_APP_ID;
  platform: NativeAppPlatform;
  minimumVersion: string;
  storeUrl: string;
  message: string;
  enforcementMode: "observe" | "enforce";
  updatedAt: string;
};

export type UpdateDecision =
  | {
      state: "required";
      minimumVersion: string;
      storeUrl: string;
      message: string;
    }
  | {
      /** #2107 A3 — below the floor, but the policy is in `observe` mode. */
      state: "observe_would_block";
      minimumVersion: string;
    }
  | { state: "allowed" | "unknown" };

export type VersionGateSnapshot = {
  phase: "checking" | "allowed" | "required";
  decision: UpdateDecision;
};

export type VersionPolicyCoordinatorDependencies = {
  platform: NativeAppPlatform | null;
  installedVersion: string | null;
  loadCache: () => Promise<string | null>;
  saveCache: (value: string) => Promise<void>;
  fetchPolicy: () => Promise<AppVersionPolicy>;
  report: (
    outcome: string,
    detail?: Record<string, string | number | boolean | null>,
  ) => void;
  timeoutMs?: number;
  cachedTimeoutMs?: number;
  cacheTimeoutMs?: number;
};

export function compareSemver(a: string, b: string): number | null {
  const left = SEMVER_PATTERN.exec(a);
  const right = SEMVER_PATTERN.exec(b);
  if (!left || !right) return null;
  for (let index = 1; index <= 3; index += 1) {
    const leftSegment = left[index];
    const rightSegment = right[index];
    if (leftSegment.length !== rightSegment.length) {
      return leftSegment.length > rightSegment.length ? 1 : -1;
    }
    if (leftSegment !== rightSegment) {
      return leftSegment > rightSegment ? 1 : -1;
    }
  }
  return 0;
}

export function parsePolicy(
  input: unknown,
  expectedPlatform: NativeAppPlatform,
): AppVersionPolicy | null {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    return null;
  }
  const record = input as Record<string, unknown>;
  if (
    Object.keys(record).sort().join("|") !==
      [...POLICY_KEYS].sort().join("|") ||
    record.appId !== APP_VERSION_APP_ID ||
    record.platform !== expectedPlatform ||
    typeof record.minimumVersion !== "string" ||
    !SEMVER_PATTERN.test(record.minimumVersion) ||
    typeof record.storeUrl !== "string" ||
    !record.storeUrl.startsWith("https://") ||
    typeof record.message !== "string" ||
    record.message.trim().length === 0 ||
    (record.enforcementMode !== "observe" &&
      record.enforcementMode !== "enforce") ||
    typeof record.updatedAt !== "string" ||
    !Number.isFinite(Date.parse(record.updatedAt))
  ) {
    return null;
  }
  return record as AppVersionPolicy;
}

export function decidePolicy(
  policy: AppVersionPolicy,
  installedVersion: string | null,
): UpdateDecision {
  if (installedVersion === null) return { state: "unknown" };
  const comparison = compareSemver(installedVersion, policy.minimumVersion);
  if (comparison === null) return { state: "unknown" };
  if (comparison >= 0) return { state: "allowed" };
  // #2107 A3 — only `enforce` blocks. `observe` is a dry run: it reports who
  // WOULD be blocked and lets them in.
  if (policy.enforcementMode !== "enforce") {
    return { state: "observe_would_block", minimumVersion: policy.minimumVersion };
  }
  return {
    state: "required",
    minimumVersion: policy.minimumVersion,
    storeUrl: policy.storeUrl,
    message: policy.message,
  };
}

export type GateLayout =
  | "veil"
  | "store_screen"
  | "app"
  | "app_with_store_overlay";

/**
 * #2107 A2 — what MandatoryUpdateGate renders. Once the app tree has mounted
 * it is NEVER unmounted by the gate: a foreground recheck keeps it, and a
 * confirmed `required` covers it as an overlay. Before the first mount, the
 * cold-launch veil and a cold `required` render alone, so the app never boots
 * behind a store screen.
 */
export function resolveGateLayout(
  phase: VersionGateSnapshot["phase"],
  appMounted: boolean,
): GateLayout {
  if (phase === "allowed") return "app";
  if (!appMounted) return phase === "required" ? "store_screen" : "veil";
  return phase === "required" ? "app_with_store_overlay" : "app";
}

export function getPolicyCacheKey(
  platform: NativeAppPlatform,
  installedVersion: string,
): string {
  return [
    "mingla.appVersionPolicy",
    APP_VERSION_APP_ID,
    platform,
    installedVersion,
    `schema${APP_VERSION_SCHEMA}`,
  ].join(".");
}

export class VersionGateCoordinator {
  private snapshot: VersionGateSnapshot;
  private listeners = new Set<(snapshot: VersionGateSnapshot) => void>();
  private inFlight: Promise<VersionGateSnapshot> | null = null;
  private cacheWrite: Promise<void> = Promise.resolve();
  private generation = 0;
  /** Newest check whose server answer has been applied. Older answers lose. */
  private answeredGeneration = 0;

  constructor(
    private readonly dependencies: VersionPolicyCoordinatorDependencies,
  ) {
    this.snapshot =
      dependencies.platform === null
        ? { phase: "allowed", decision: { state: "allowed" } }
        : { phase: "checking", decision: { state: "unknown" } };
  }

  getSnapshot = (): VersionGateSnapshot => this.snapshot;

  subscribe = (
    listener: (snapshot: VersionGateSnapshot) => void,
  ): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /**
   * `blocking` is the cold-launch check: it may show the veil. Foreground
   * rechecks pass false and never publish `checking`, so the app tree stays
   * mounted underneath; only a confirmed `required` changes what is on screen.
   */
  check(blocking: boolean): Promise<VersionGateSnapshot> {
    if (this.dependencies.platform === null) {
      return Promise.resolve(this.snapshot);
    }
    if (this.inFlight !== null) return this.inFlight;

    const generation = ++this.generation;
    if (blocking && this.snapshot.phase !== "required") {
      this.publish({ phase: "checking", decision: this.snapshot.decision });
    }

    let cachedRequired: UpdateDecision | null =
      this.snapshot.decision.state === "required"
        ? this.snapshot.decision
        : null;
    let hadValidCache = false;
    let timedOut = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let markCacheHydrated!: () => void;
    const cacheHydrated = new Promise<void>((resolve) => {
      markCacheHydrated = resolve;
    });
    // A storage read that never settles must not hold the veil forever.
    const hydrateCap = setTimeout(
      () => markCacheHydrated(),
      this.dependencies.cacheTimeoutMs ?? POLICY_CACHE_READ_CAP_MS,
    );

    const pipeline = (async (): Promise<VersionGateSnapshot> => {
      try {
        let cachedRaw: string | null = null;
        try {
          cachedRaw = await this.dependencies.loadCache();
        } catch (error) {
          this.dependencies.report(
            error instanceof Error ? error.message : "policy_cache_read_failed",
          );
        }
        if (cachedRaw !== null) {
          let cachedPolicy: AppVersionPolicy | null = null;
          try {
            cachedPolicy = parsePolicy(
              JSON.parse(cachedRaw) as unknown,
              this.dependencies.platform as NativeAppPlatform,
            );
          } catch {
            this.dependencies.report("invalid_cached_policy");
          }
          if (cachedPolicy !== null) {
            hadValidCache = true;
            const cachedDecision = decidePolicy(
              cachedPolicy,
              this.dependencies.installedVersion,
            );
            if (cachedDecision.state === "required") {
              cachedRequired = cachedDecision;
              if (generation > this.answeredGeneration) {
                this.publish({ phase: "required", decision: cachedDecision });
              }
            }
          }
        }
        markCacheHydrated();

        const policy = await this.dependencies.fetchPolicy();
        // A1: an answer is NEVER thrown away for being late. It is saved, and if
        // it says required the store screen appears now — unless a newer check
        // has already applied a fresher server answer.
        if (generation < this.answeredGeneration) return this.snapshot;
        this.answeredGeneration = generation;
        this.persistPolicy(policy);
        const decision = decidePolicy(
          policy,
          this.dependencies.installedVersion,
        );
        const late = timedOut;
        if (decision.state === "required") {
          cachedRequired = decision;
          this.dependencies.report(
            late ? "version_gate_late_required" : "version_gate_required",
            { minimum_version: decision.minimumVersion },
          );
          return this.publish({ phase: "required", decision });
        }
        if (decision.state === "observe_would_block") {
          this.dependencies.report("version_gate_observe_would_block", {
            minimum_version: decision.minimumVersion,
          });
          return this.publish({ phase: "allowed", decision });
        }
        if (decision.state === "allowed") {
          this.dependencies.report("allowed", { late });
          return this.publish({ phase: "allowed", decision });
        }
        this.dependencies.report("installed_version_unavailable");
        return this.publish({ phase: "allowed", decision });
      } catch (error) {
        markCacheHydrated();
        const failure =
          error instanceof Error ? error.message : "policy_check_failed";
        // Console-only: the raw message carries no captured prefix.
        this.dependencies.report(failure);
        if (timedOut || generation < this.answeredGeneration) {
          return this.snapshot;
        }
        if (cachedRequired?.state === "required") {
          this.dependencies.report("version_gate_offline_cached_required", {
            minimum_version: cachedRequired.minimumVersion,
          });
          return this.publish({ phase: "required", decision: cachedRequired });
        }
        // F1 (#2107 device test): "let in because we could not ask" is a
        // fail-open like any other, so it reaches PostHog as a captured outcome.
        this.dependencies.report("version_gate_unreachable", {
          error: failure,
          had_cached_policy: hadValidCache,
        });
        return this.publish({ phase: "allowed", decision: { state: "unknown" } });
      }
    })();

    const timeout = cacheHydrated.then(
      () =>
        new Promise<VersionGateSnapshot>((resolve) => {
          const timeoutMs = hadValidCache
            ? (this.dependencies.cachedTimeoutMs ?? POLICY_CHECK_CACHED_TIMEOUT_MS)
            : (this.dependencies.timeoutMs ?? POLICY_CHECK_TIMEOUT_MS);
          timer = setTimeout(() => {
            if (generation < this.answeredGeneration) {
              return resolve(this.snapshot);
            }
            // Fail open for now, but keep listening: the pipeline above still
            // persists and applies the answer whenever it arrives.
            timedOut = true;
            this.dependencies.report("version_gate_timeout", {
              had_cached_policy: hadValidCache,
            });
            if (cachedRequired?.state === "required") {
              this.dependencies.report("version_gate_offline_cached_required", {
                minimum_version: cachedRequired.minimumVersion,
              });
              return resolve(
                this.publish({ phase: "required", decision: cachedRequired }),
              );
            }
            resolve(
              this.publish({ phase: "allowed", decision: { state: "unknown" } }),
            );
          }, timeoutMs);
        }),
    );

    this.inFlight = Promise.race([pipeline, timeout]).finally(() => {
      if (timer !== null) clearTimeout(timer);
      clearTimeout(hydrateCap);
      this.inFlight = null;
    });
    return this.inFlight;
  }

  private publish(snapshot: VersionGateSnapshot): VersionGateSnapshot {
    this.snapshot = snapshot;
    for (const listener of this.listeners) listener(snapshot);
    return snapshot;
  }

  private persistPolicy(policy: AppVersionPolicy): void {
    this.cacheWrite = this.cacheWrite
      .catch(() => undefined)
      .then(() => this.dependencies.saveCache(JSON.stringify(policy)))
      .catch(() => {
        this.dependencies.report("policy_cache_write_failed");
      });
  }
}

async function fetchPolicy(): Promise<AppVersionPolicy> {
  const platform = getNativeAppPlatform();
  if (platform === null) throw new Error("native_platform_unavailable");
  const extra = Constants.expoConfig?.extra as
    Record<string, string | undefined> | undefined;
  const supabaseUrl =
    extra?.EXPO_PUBLIC_SUPABASE_URL ||
    process.env.EXPO_PUBLIC_SUPABASE_URL ||
    "";
  if (supabaseUrl.length === 0) throw new Error("policy_endpoint_unavailable");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), POLICY_FETCH_ABORT_MS);
  try {
    const response = await fetch(
      `${supabaseUrl}/functions/v1/app-version-policy?app_id=${APP_VERSION_APP_ID}&platform=${platform}`,
      {
        method: "GET",
        headers: { "Cache-Control": "no-store" },
        signal: controller.signal,
      },
    );
    const body: unknown = await response.json();
    const policy = parsePolicy(body, platform);
    if (!response.ok || policy === null)
      throw new Error("invalid_policy_response");
    return policy;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The coordinator keeps its "allowed" outcome name (the #2443 identity suite
 * pins it); analytics captures that outcome as `version_gate_allowed` so it
 * carries the captured prefix. Every other outcome passes through unchanged.
 */
export function capturedVersionGateOutcome(outcome: string): string {
  return outcome === "allowed" ? "version_gate_allowed" : outcome;
}

export function createAppVersionCoordinator(): VersionGateCoordinator {
  const platform = getNativeAppPlatform();
  const installedVersion = getInstalledNativeVersion();
  const cacheKey =
    platform !== null && installedVersion !== null
      ? getPolicyCacheKey(platform, installedVersion)
      : "mingla.appVersionPolicy.unavailable";
  return new VersionGateCoordinator({
    platform,
    installedVersion,
    loadCache: () => AsyncStorage.getItem(cacheKey),
    saveCache: (value) => AsyncStorage.setItem(cacheKey, value),
    fetchPolicy,
    report: (outcome, detail) =>
      reportUpdateGateEvent(
        "app-version-policy",
        capturedVersionGateOutcome(outcome),
        {
          app_id: APP_VERSION_APP_ID,
          platform,
          installed_version: installedVersion,
          ...(detail ?? {}),
        },
      ),
  });
}
