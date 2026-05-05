/**
 * usePermissionWithFallback — Cycle 16a (DEC-098 J-X6).
 *
 * Consolidates permission request + denial-fallback UX for camera +
 * image-picker (notifications + location DEFERRED per DEC-098 — speculative
 * without surfaces). Replaces one-off scanner pattern + Cycle 14 image-picker
 * inline error handling.
 *
 * Memory rule: ConfirmDialog renders inside consumer's component tree per
 * feedback_rn_sub_sheet_must_render_inside_parent.
 *
 * Per Cycle 16a SPEC §3.4.1.
 */

import { useCallback, useState } from "react";
import { Linking } from "react-native";

export type PermissionStatus =
  | "undetermined"
  | "granted"
  | "denied"
  | "blocked";

export interface PermissionRequestResult {
  granted: boolean;
  canAskAgain: boolean;
}

export interface UsePermissionWithFallbackOpts {
  /**
   * Caller's permission request fn (e.g. camera's requestPermission OR
   * image-picker's requestMediaLibraryPermissionsAsync). MUST return
   * { granted, canAskAgain } shape (callers may need to map upstream
   * library response shapes).
   */
  request: () => Promise<PermissionRequestResult>;
  /** Human-readable label for ConfirmDialog title (e.g. "Camera"). */
  permissionLabel: string;
  /** Why we need it — appears in ConfirmDialog description. */
  permissionRationale: string;
}

export interface UsePermissionWithFallbackReturn {
  /** Current dialog visibility state — render ConfirmDialog with this. */
  settingsDialogVisible: boolean;
  /**
   * Request permission. If granted → returns true. If denied with
   * canAskAgain=false → opens settings dialog + returns false.
   * If denied with canAskAgain=true → returns false (caller may retry).
   */
  requestWithFallback: () => Promise<boolean>;
  /** Confirm action of settings dialog — opens OS Settings + dismisses dialog. */
  openSettings: () => void;
  /** Cancel action of settings dialog — just dismisses dialog. */
  dismissSettingsDialog: () => void;
  /** ConfirmDialog title text (consumer passes to ConfirmDialog). */
  dialogTitle: string;
  /** ConfirmDialog description text (consumer passes to ConfirmDialog). */
  dialogDescription: string;
}

export const usePermissionWithFallback = (
  opts: UsePermissionWithFallbackOpts,
): UsePermissionWithFallbackReturn => {
  const [settingsDialogVisible, setSettingsDialogVisible] = useState(false);

  const requestWithFallback = useCallback(async (): Promise<boolean> => {
    const result = await opts.request();
    if (result.granted) return true;
    // Denied path: if can't ask again → show settings dialog (deeplink path).
    // If still askable, caller decides whether to retry or surface its own UX.
    if (!result.canAskAgain) {
      setSettingsDialogVisible(true);
    }
    return false;
  }, [opts]);

  const openSettings = useCallback((): void => {
    setSettingsDialogVisible(false);
    void Linking.openSettings().catch(() => {
      // No-op — Settings app unavailable (extremely rare, e.g. headless or
      // restricted device). Constitution #3 documented exemption: this is
      // a fallback flow, not a primary path; the user can manually navigate
      // to Settings if Linking.openSettings doesn't resolve.
    });
  }, []);

  const dismissSettingsDialog = useCallback((): void => {
    setSettingsDialogVisible(false);
  }, []);

  const dialogTitle = `${opts.permissionLabel} access needed`;
  const dialogDescription = `${opts.permissionRationale} Open Settings to enable ${opts.permissionLabel.toLowerCase()} access.`;

  return {
    settingsDialogVisible,
    requestWithFallback,
    openSettings,
    dismissSettingsDialog,
    dialogTitle,
    dialogDescription,
  };
};
