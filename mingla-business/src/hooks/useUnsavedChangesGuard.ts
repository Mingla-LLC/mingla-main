// #4420 — the web (and jest) variant of the unsaved-changes guard.
//
// While `dirty`, a reload or tab close shows the browser's own "Leave site?"
// prompt. In-app exits ask through the screen's ConfirmDialog. Web has no
// hardware back; the native variant (useUnsavedChangesGuard.native.ts) adds
// Android back. Rules: src/utils/unsavedChangesGuard.ts.
import { useEffect } from "react";

import { registerUnsavedWork } from "../utils/unsavedChangesGuard";

export interface UnsavedChangesGuardConfig {
  /** True while leaving would lose work. */
  dirty: boolean;
  /** The screen's own close owner (it shows the confirm dialog). */
  onRequestLeave: () => void;
  /**
   * Native only. False for a creation wizard: its Android back already runs
   * through useWizardHardwareBack (step back, keyboard first,
   * I-3446-WIZARD-ANDROID-BACK-IS-STEP-BACK), which
   * reaches the same close owner on step 1.
   */
  hardwareBack?: boolean;
}

export function useUnsavedChangesGuard({ dirty }: UnsavedChangesGuardConfig): void {
  // #4453 — the brand switcher holds a switch while this screen is dirty.
  useEffect(() => (dirty ? registerUnsavedWork() : undefined), [dirty]);
  useEffect(() => {
    if (!dirty) return;
    const target = globalThis as {
      addEventListener?: (type: string, fn: (event: BeforeUnloadEvent) => void) => void;
      removeEventListener?: (type: string, fn: (event: BeforeUnloadEvent) => void) => void;
    };
    const guard = (event: BeforeUnloadEvent): void => {
      event.preventDefault();
      event.returnValue = "You have unsaved changes.";
    };
    target.addEventListener?.("beforeunload", guard);
    return (): void => target.removeEventListener?.("beforeunload", guard);
  }, [dirty]);
}
