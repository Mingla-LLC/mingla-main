/**
 * alertHost — #4420. The pieces showAlert (the eager stub) and showAlertWeb
 * (the lazy web half) share: the alert call types and the "a web dialog has
 * been raised" signal the root AlertDialogHost waits for before mounting the
 * dialog layer. Kept apart so showAlertWeb never imports showAlert back
 * (no require cycle). No React Native, no auth, no data.
 */

import { useSyncExternalStore } from "react";

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
