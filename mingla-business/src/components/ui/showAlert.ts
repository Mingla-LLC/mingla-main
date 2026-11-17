/**
 * showAlert — #4420 (Constitution 3: no silent failures). The one web-safe
 * replacement for `Alert.alert`, with the same call shape.
 *
 * WHY. react-native-web implements `Alert.alert` as a no-op: on Host web an
 * error, a validation hint or a destructive confirm raised with it showed
 * NOTHING, and a confirm's onPress never ran (the delete / disconnect button
 * looked dead).
 *
 *   native  — calls `Alert.alert` unchanged (same buttons, same order).
 *   web     — loads `showAlertWeb` on first use: a Toast for information,
 *             the shared ConfirmDialog for a choice (see that file).
 *
 * This file is the eager stub; the web half stays off the boot bundle.
 * No auth, no data: safe on anon buyer routes.
 */

import { Alert, Platform } from "react-native";

import type { ShowAlertButton, ShowAlertOptions } from "./alertHost";

// The types and the host signal live in ./alertHost, which both this stub and
// the lazy web half import, so the two never import each other (no cycle).
export type { ShowAlertButton, ShowAlertOptions } from "./alertHost";
export { requestAlertHost, useAlertHostWanted } from "./alertHost";

export function showAlert(
  title: string,
  message?: string,
  buttons?: readonly ShowAlertButton[],
  options?: ShowAlertOptions,
): void {
  if (Platform.OS !== "web") {
    const nativeOptions = options?.cancelable === undefined ? undefined : { cancelable: options.cancelable };
    // I-4420-NO-RAW-ALERT: the one sanctioned raw call.
    Alert.alert(title, message, buttons as ShowAlertButton[] | undefined, nativeOptions);
    return;
  }
  void import("./showAlertWeb")
    .then((web) => web.showWebAlert(title, message, buttons, options))
    .catch((error: unknown) => {
      // The alert module failed to load (offline chunk fetch): keep it audible.
      console.error(`[showAlert] could not show "${title}":`, error);
    });
}
