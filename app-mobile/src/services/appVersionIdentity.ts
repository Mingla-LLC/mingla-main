import Constants from "expo-constants";
import { Platform } from "react-native";

export const APP_VERSION_APP_ID = "explorer" as const;
export const APP_VERSION_SCHEMA = 1 as const;

export type NativeAppPlatform = "ios" | "android";

const SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

let reportedFallback = false;
let reportedUnavailable = false;

function isStrictSemver(value: unknown): value is string {
  return typeof value === "string" && SEMVER_PATTERN.test(value);
}

function reportIdentityOutcome(
  platform: NativeAppPlatform,
  outcome: "expo_config_fallback" | "unavailable",
): void {
  if (outcome === "expo_config_fallback") {
    if (reportedFallback) return;
    reportedFallback = true;
  } else {
    if (reportedUnavailable) return;
    reportedUnavailable = true;
  }

  try {
    console.warn("[app-version-identity]", {
      appId: APP_VERSION_APP_ID,
      platform,
      outcome,
      severity: outcome === "unavailable" ? "error" : "warning",
    });
  } catch {
    // Identity resolution must survive a diagnostic transport failure.
  }
}

export function getNativeAppPlatform(): NativeAppPlatform | null {
  return Platform.OS === "ios" || Platform.OS === "android"
    ? Platform.OS
    : null;
}

export function getInstalledNativeVersion(): string | null {
  const platform = getNativeAppPlatform();
  if (platform === null) return null;

  if (isStrictSemver(Constants.nativeAppVersion)) {
    return Constants.nativeAppVersion;
  }

  const expoConfigVersion = Constants.expoConfig?.version;
  if (isStrictSemver(expoConfigVersion)) {
    reportIdentityOutcome(platform, "expo_config_fallback");
    return expoConfigVersion;
  }

  reportIdentityOutcome(platform, "unavailable");
  return null;
}

export function getNativeAppVersionHeaders(): Record<string, string> {
  const platform = getNativeAppPlatform();
  if (platform === null) return {};

  return {
    "X-Mingla-App-Id": APP_VERSION_APP_ID,
    "X-Mingla-App-Platform": platform,
    "X-Mingla-App-Version": getInstalledNativeVersion() ?? "",
  };
}
