import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import {
  APP_VERSION_APP_ID,
  APP_VERSION_SCHEMA,
  getInstalledNativeVersion,
  getNativeAppPlatform,
  type NativeAppPlatform,
} from "./appVersionIdentity";

export const POLICY_CHECK_TIMEOUT_MS = 1_500;

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
  report: (outcome: string) => void;
  timeoutMs?: number;
};

export function compareSemver(a: string, b: string): number | null {
  const left = SEMVER_PATTERN.exec(a);
  const right = SEMVER_PATTERN.exec(b);
  if (!left || !right) return null;
  for (let index = 1; index <= 3; index += 1) {
    const delta = Number(left[index]) - Number(right[index]);
    if (delta !== 0) return delta > 0 ? 1 : -1;
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
  return comparison < 0
    ? {
        state: "required",
        minimumVersion: policy.minimumVersion,
        storeUrl: policy.storeUrl,
        message: policy.message,
      }
    : { state: "allowed" };
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

  check(blocking: boolean): Promise<VersionGateSnapshot> {
    if (this.dependencies.platform === null)
      return Promise.resolve(this.snapshot);
    if (this.inFlight !== null) return this.inFlight;
    const generation = ++this.generation;
    if (blocking && this.snapshot.phase !== "required") {
      this.publish({ phase: "checking", decision: this.snapshot.decision });
    }
    const timeoutMs = this.dependencies.timeoutMs ?? POLICY_CHECK_TIMEOUT_MS;
    let cachedRequired: UpdateDecision | null =
      this.snapshot.decision.state === "required"
        ? this.snapshot.decision
        : null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const pipeline = (async (): Promise<VersionGateSnapshot> => {
      try {
        const cachedRaw = await this.dependencies.loadCache();
        if (generation !== this.generation) return this.snapshot;
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
            const cachedDecision = decidePolicy(
              cachedPolicy,
              this.dependencies.installedVersion,
            );
            if (cachedDecision.state === "required") {
              cachedRequired = cachedDecision;
              this.publish({ phase: "required", decision: cachedDecision });
            }
          }
        }
        const policy = await this.dependencies.fetchPolicy();
        if (generation !== this.generation) return this.snapshot;
        const decision = decidePolicy(
          policy,
          this.dependencies.installedVersion,
        );
        this.persistPolicy(policy);
        if (decision.state === "required") {
          cachedRequired = decision;
          this.dependencies.report("required");
          return this.publish({ phase: "required", decision });
        }
        if (decision.state === "allowed") {
          this.dependencies.report("allowed");
          return this.publish({ phase: "allowed", decision });
        }
        this.dependencies.report("installed_version_unavailable");
        return this.publish({ phase: "allowed", decision });
      } catch (error) {
        if (generation !== this.generation) return this.snapshot;
        this.dependencies.report(
          error instanceof Error ? error.message : "policy_check_failed",
        );
        return cachedRequired?.state === "required"
          ? this.publish({ phase: "required", decision: cachedRequired })
          : this.publish({ phase: "allowed", decision: { state: "unknown" } });
      }
    })();
    const timeout = new Promise<VersionGateSnapshot>((resolve) => {
      timer = setTimeout(() => {
        if (generation !== this.generation) return resolve(this.snapshot);
        this.generation += 1;
        this.dependencies.report("policy_check_timeout");
        resolve(
          cachedRequired?.state === "required"
            ? this.publish({ phase: "required", decision: cachedRequired })
            : this.publish({
                phase: "allowed",
                decision: { state: "unknown" },
              }),
        );
      }, timeoutMs);
    });
    this.inFlight = Promise.race([pipeline, timeout]).finally(() => {
      if (timer !== null) clearTimeout(timer);
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
  const timer = setTimeout(() => controller.abort(), POLICY_CHECK_TIMEOUT_MS);
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
    report: (outcome) => console.warn(`[app-version-policy] ${outcome}`),
  });
}
