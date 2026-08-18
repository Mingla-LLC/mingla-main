// #2107 — the ONLY module in this app that imports expo-updates.
//
// It supersedes the same claim previously made by src/hooks/useOtaUpdates.ts,
// which now consumes the bridge below instead of calling Updates directly. The
// invariant is enforced by .github/scripts/strict-grep/issue-2107-mandatory-js-update.mjs
// rather than by a comment nobody could fail.
//
// Everything here is effects-only. All decision logic lives in the pure
// otaUpdatePolicy.ts so the adversarial suite can drive it without a device.

import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Updates from "expo-updates";
import { Platform } from "react-native";
import {
  OTA_POLICY_APP_ID,
  OtaGateCoordinator,
  getAcknowledgementCacheKey,
  parseOtaPolicy,
  POLICY_CHECK_TIMEOUT_MS,
  type AppOtaPolicy,
  type OtaPlatform,
  type OtaUpdateBridge,
} from "./otaUpdatePolicy";
import { supabaseUrl } from "./supabase";

export function getOtaPlatform(): OtaPlatform | null {
  return Platform.OS === "ios" || Platform.OS === "android"
    ? Platform.OS
    : null;
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
    checkForUpdate: async () => {
      const result = await Updates.checkForUpdateAsync();
      return {
        isAvailable: result.isAvailable,
        isRollBackToEmbedded: result.isRollBackToEmbedded === true,
        updateId: result.isAvailable ? result.manifest.id : null,
      };
    },
    fetchUpdate: async () => {
      await Updates.fetchUpdateAsync();
    },
    reload: async () => {
      await Updates.reloadAsync();
    },
  };
}

export async function fetchOtaPolicy(
  runtimeVersion: string,
): Promise<AppOtaPolicy> {
  const platform = getOtaPlatform();
  if (platform === null) throw new Error("ota_platform_unavailable");
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
  const cacheKey = platform !== null && updates.runtimeVersion !== null
    ? getAcknowledgementCacheKey(platform, updates.runtimeVersion)
    : "mingla.otaAcknowledgement.unavailable";
  return new OtaGateCoordinator({
    platform,
    updates,
    fetchPolicy: fetchOtaPolicy,
    loadAcknowledgement: () => AsyncStorage.getItem(cacheKey),
    saveAcknowledgement: (updateId) => AsyncStorage.setItem(cacheKey, updateId),
    report: (event, detail) => {
      console.warn(
        `[ota-update-gate] ${event}${
          detail === undefined ? "" : ` ${JSON.stringify(detail)}`
        }`,
      );
    },
  });
}
