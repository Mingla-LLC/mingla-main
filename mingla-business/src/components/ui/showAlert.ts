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

import { useSyncExternalStore } from "react";
import { Alert, Platform } from "react-native";

import type { ToastKind } from "./toastTimings";

export interface ShowAlertButton {
  text?: string;
  style?: "default" | "cancel" | "destructive";
  onPress?: (value?: string) => void | Promise<void>;
}

export interface ShowAlertOptions {
  /** Web only: the toast kind for a button-less alert. Default "error". */
  kind?: ToastKind;
  /** Native only: passed through to `Alert.alert`. */
  cancelable?: boolean;
}

// The root AlertDialogHost mounts the web dialog layer only once a web
// alert with choices has been raised.
let hostWanted = false;
const listeners = new Set<() => void>();

export const requestAlertHost = (): void => {
  if (hostWanted) return;
  hostWanted = true;
  listeners.forEach((listener) => listener());
};

export const useAlertHostWanted = (): boolean =>
  useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => hostWanted,
    () => false,
  );

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
