// #2107 — the ONLY module in this app that imports expo-updates.
//
// Host had NO in-app updater at all before this issue: expo-updates was a
// dependency and updates.url was configured, and Host OTAs did publish, but not
// one line of Host code checked, reported, or surfaced anything. Adoption was
// unobservable and unenforceable. This is the whole updater.
//
// Everything here is effects-only. All decision logic lives in the pure
// otaUpdatePolicy.ts, which is byte-mirrored with the Consumer copy and held in
// parity by .github/scripts/strict-grep/issue-2107-mandatory-js-update.mjs.

import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import * as Updates from "expo-updates";
import { Platform } from "react-native";
import {
  OTA_POLICY_APP_ID,
  OtaGateCoordinator,
  criticalIndexFromExpoConfig,
  criticalIndexFromManifest,
  getAttemptRecordKey,
  parseOtaPolicy,
  POLICY_CHECK_TIMEOUT_MS,
  type AppOtaPolicy,
  type OtaPlatform,
  type OtaUpdateBridge,
} from "./otaUpdatePolicy";
import { runSafeReload } from "./safeReloadRuntime";
import type { UpdateLaunchFacts } from "./updateLaunchGuard";
import { reportUpdateGateEvent } from "./updateGateTelemetry";

export function getOtaPlatform(): OtaPlatform | null {
  return Platform.OS === "ios" || Platform.OS === "android"
    ? Platform.OS
    : null;
}

/**
 * The criticalIndex baked into the code that is running right now. An OTA
 * launch carries it in its manifest (extra.expoClient.extra); an embedded
 * launch carries it in the binary's expo config. Null when neither has one,
 * which the core treats as "cannot call anything critical".
 */
function readRunningCriticalIndex(): number | null {
  try {
    return (
      criticalIndexFromManifest(Updates.manifest) ??
      criticalIndexFromExpoConfig(Constants.expoConfig)
    );
  } catch {
    return null;
  }
}

/**
 * Every expo-updates call is guarded twice: __DEV__ (the native module throws in
 * development) and Updates.isEnabled (a build with updates switched off). A
 * disabled bridge resolves the whole gate to `open` before any policy is read.
 */
export function createOtaUpdateBridge(): OtaUpdateBridge {
  const enabled = !__DEV__ && Updates.isEnabled;
  return {
    isEnabled: enabled,
    runtimeVersion: enabled ? Updates.runtimeVersion : null,
    runningUpdateId: enabled ? Updates.updateId : null,
    runningCriticalIndex: enabled ? readRunningCriticalIndex() : null,
    isEmergencyLaunch: enabled ? Updates.isEmergencyLaunch === true : false,
    checkForUpdate: async () => {
      const result = await Updates.checkForUpdateAsync();
      if (result.isAvailable) {
        return {
          isAvailable: true,
          isRollBackToEmbedded: false,
          updateId: typeof result.manifest.id === "string" ? result.manifest.id : null,
          criticalIndex: criticalIndexFromManifest(result.manifest),
          reason: null,
        };
      }
      return {
        isAvailable: false,
        isRollBackToEmbedded: result.isRollBackToEmbedded === true,
        updateId: null,
        criticalIndex: null,
        reason: typeof result.reason === "string" ? result.reason : null,
      };
    },
    fetchUpdate: async () => {
      const result = await Updates.fetchUpdateAsync();
      return {
        isNew: result.isNew === true,
        updateId:
          result.isNew === true && typeof result.manifest?.id === "string"
            ? result.manifest.id
            : null,
      };
    },
    // #2107 (Sentry REACT-NATIVE-1C): never a bare reloadAsync. A request
    // issued while the bridge tears down crashes RCTNetworking, so every
    // restart stops network work, flushes analytics, lets in-flight writes
    // finish (capped) and only then reloads. Fails open if no restart happens.
    reload: () => runSafeReload(() => Updates.reloadAsync()),
  };
}

// Host's supabase.ts keeps supabaseUrl module-private, so it is resolved here
// the same way #2075's Host policy service resolves it.
function resolveSupabaseUrl(): string {
  const extra = Constants.expoConfig?.extra as
    | Record<string, string | undefined>
    | undefined;
  return (
    extra?.EXPO_PUBLIC_SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL || ""
  );
}

/**
 * #2107 (U1) — what the launch guard needs to know about the running bundle.
 * Read lazily by updateLaunchRuntime.ts, so this module stays the only
 * expo-updates importer. Same double guard as the bridge above.
 */
export function readUpdateLaunchFacts(): UpdateLaunchFacts {
  const enabled = !__DEV__ && Updates.isEnabled;
  return {
    enabled,
    updateId: enabled ? Updates.updateId : null,
    isEmbeddedLaunch: enabled ? Updates.isEmbeddedLaunch === true : true,
    isEmergencyLaunch: enabled ? Updates.isEmergencyLaunch === true : false,
  };
}

export async function fetchOtaPolicy(
  runtimeVersion: string,
): Promise<AppOtaPolicy> {
  const platform = getOtaPlatform();
  if (platform === null) throw new Error("ota_platform_unavailable");
  const supabaseUrl = resolveSupabaseUrl();
  if (supabaseUrl.length === 0) throw new Error("policy_endpoint_unavailable");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), POLICY_CHECK_TIMEOUT_MS);
  try {
    const response = await fetch(
      `${supabaseUrl}/functions/v1/app-ota-policy?app_id=${OTA_POLICY_APP_ID}` +
        `&platform=${platform}&runtime_version=${encodeURIComponent(runtimeVersion)}`,
      {
        method: "GET",
        headers: { "Cache-Control": "no-store" },
        signal: controller.signal,
      },
    );
    const body: unknown = await response.json();
    const policy = parseOtaPolicy(body, platform, runtimeVersion);
    if (!response.ok || policy === null) {
      throw new Error("invalid_ota_policy_response");
    }
    return policy;
  } finally {
    clearTimeout(timer);
  }
}

export function createOtaGateCoordinator(): OtaGateCoordinator {
  const platform = getOtaPlatform();
  const updates = createOtaUpdateBridge();
  const recordKey = platform !== null && updates.runtimeVersion !== null
    ? getAttemptRecordKey(platform, updates.runtimeVersion)
    : "mingla.criticalUpdateAttempt.unavailable";
  return new OtaGateCoordinator({
    platform,
    updates,
    fetchPolicy: fetchOtaPolicy,
    loadAttemptRecord: () => AsyncStorage.getItem(recordKey),
    saveAttemptRecord: (value) => AsyncStorage.setItem(recordKey, value),
    clearAttemptRecord: () => AsyncStorage.removeItem(recordKey),
    relaunchMarker: {
      load: () => AsyncStorage.getItem(`${recordKey}.relaunchPending`),
      save: (targetUpdateId) =>
        AsyncStorage.setItem(`${recordKey}.relaunchPending`, targetUpdateId),
      clear: () => AsyncStorage.removeItem(`${recordKey}.relaunchPending`),
    },
    report: (event, detail) => {
      reportUpdateGateEvent("ota-update-gate", event, {
        app_id: OTA_POLICY_APP_ID,
        platform,
        ...(detail ?? {}),
      });
    },
  });
}
