import Constants from "expo-constants";
import { Platform } from "react-native";

export const APP_VERSION_APP_ID = "business" as const;
export const APP_VERSION_SCHEMA = 1 as const;

export type NativeAppPlatform = "ios" | "android";

const SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export function getNativeAppPlatform(): NativeAppPlatform | null {
  return Platform.OS === "ios" || Platform.OS === "android"
    ? Platform.OS
    : null;
}

export function getInstalledNativeVersion(): string | null {
  if (
    typeof Constants.nativeAppVersion === "string" &&
    SEMVER_PATTERN.test(Constants.nativeAppVersion)
  ) {
    return Constants.nativeAppVersion;
  }

  const developmentVersion = Constants.expoConfig?.version;
  return __DEV__ &&
    typeof developmentVersion === "string" &&
    SEMVER_PATTERN.test(developmentVersion)
    ? developmentVersion
    : null;
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
