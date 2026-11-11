/**
 * #4382 Wave 4 — the app and device facts attached to a Host request:
 * app version, OS, OS version, device model and the screen it came from.
 * Never a location. expo-constants already ships in the Host app.
 */
import { Platform } from "react-native";
import Constants from "expo-constants";

import { buildSupportClientMeta, type SupportClientMeta } from "./supportRequestModel";

function deviceModel(): string | null {
  const constants = (Platform as { constants?: Record<string, unknown> }).constants ?? {};
  const model = constants.Model ?? constants.model;
  if (typeof model === "string" && model.length > 0) return model;
  const idiom = constants.interfaceIdiom;
  if (Platform.OS === "ios" && typeof idiom === "string") return idiom === "pad" ? "iPad" : "iPhone";
  return null;
}

export function hostSupportClientMeta(sourceScreen: string): SupportClientMeta {
  return buildSupportClientMeta({
    app_version: Constants.expoConfig?.version ?? null,
    os: Platform.OS,
    os_version: Platform.OS === "web" ? null : String(Platform.Version),
    device_model: deviceModel(),
    source_screen: sourceScreen,
  });
}
