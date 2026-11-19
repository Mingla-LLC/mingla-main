// #4420 — the native variant of the unsaved-changes guard (Metro resolves it on
// iOS and Android). While `dirty`, Android hardware back runs the screen's own
// close owner (which asks before discarding) instead of popping the route.
// iOS has no hardware back. A native <Modal> (the confirm dialog itself)
// consumes the back press while it is open, so a second press closes the
// dialog, not the screen. Rules: src/utils/unsavedChangesGuard.ts.
import { useEffect, useRef } from "react";
import { BackHandler, Platform } from "react-native";

import type { UnsavedChangesGuardConfig } from "./useUnsavedChangesGuard";

export type { UnsavedChangesGuardConfig } from "./useUnsavedChangesGuard";

/** #4453 — how many mounted screens have unsaved work; see useUnsavedChangesGuard.ts. */
export const unsavedWork = { screens: 0 };

export function useUnsavedChangesGuard({
  dirty,
  onRequestLeave,
  hardwareBack = true,
}: UnsavedChangesGuardConfig): void {
  const leaveRef = useRef(onRequestLeave);
  leaveRef.current = onRequestLeave;
  // #4453 — the brand switcher holds a switch while this screen is dirty.
  useEffect(() => {
    if (!dirty) return undefined;
    unsavedWork.screens += 1;
    return (): void => {
      unsavedWork.screens -= 1;
    };
  }, [dirty]);
  useEffect(() => {
    if (Platform.OS !== "android" || !dirty || !hardwareBack) return;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      leaveRef.current();
      return true;
    });
    return (): void => subscription.remove();
  }, [dirty, hardwareBack]);
}
