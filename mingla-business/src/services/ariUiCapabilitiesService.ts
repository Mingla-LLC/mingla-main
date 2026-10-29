/**
 * #3355 — capability negotiation owned by Ari's hooks rather than the shared
 * agent transport. This keeps Host-only negotiation out of non-Ari callers and
 * lets those callers retain the legacy response contract.
 */

import Constants from "expo-constants";
import { Platform } from "react-native";

import {
  buildAriUiCapabilities,
  type AriUiCapabilitiesV2,
} from "../components/ari/renditions/ariRenditionCapabilities";

export function currentAriUiCapabilities(): AriUiCapabilitiesV2 {
  // Some embedded hosts and test harnesses intentionally expose only a
  // partial Expo/React Native runtime. Capability negotiation must never stop
  // a chat turn, so missing metadata degrades to the protocol's explicit
  // `unknown` values rather than throwing before transport.
  const appVersion = Constants?.expoConfig?.version ?? null;
  const configuredRuntime = Constants?.expoConfig?.runtimeVersion;
  const runtimeVersion =
    typeof configuredRuntime === "string"
      ? configuredRuntime
      : appVersion;
  return buildAriUiCapabilities({
    platform: Platform?.OS ?? "unknown",
    appVersion,
    runtimeVersion,
  });
}
