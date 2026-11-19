/**
 * #4420 — closing a form with unsaved changes asks before discarding them.
 *
 * Which forms need the prompt:
 *   - Published-item edit screens (events, RSVPs, trips, experiences): edits
 *     live only on the screen until Save, so leaving loses them.
 *   - Draft wizards in edit mode autosave to the server draft, so leaving loses
 *     nothing — UNLESS the last autosave failed; then the prompt says so.
 *   - Draft wizards in create mode already confirm through their own discard
 *     dialog (a pristine draft is dropped silently).
 *   - The venue suite has its own save / discard leave guard (#3655).
 *
 * Exits covered: the screen's close control, Android hardware back
 * (useUnsavedChangesGuard.native.ts) and a web reload or tab close
 * (beforeunload, useUnsavedChangesGuard.ts).
 */

export interface UnsavedChangesDialogCopy {
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel: string;
}

export const UNSAVED_CHANGES_DIALOG: UnsavedChangesDialogCopy = {
  title: "Discard your changes?",
  description: "You have changes that aren't saved. If you leave now, they're gone.",
  confirmLabel: "Discard",
  cancelLabel: "Keep editing",
};

export const UNSAVED_AUTOSAVE_FAILED_DIALOG: UnsavedChangesDialogCopy = {
  title: "Your last changes didn't save",
  description: "We couldn't save your latest edits to this draft. If you leave now, they're gone.",
  confirmLabel: "Leave anyway",
  cancelLabel: "Keep editing",
};

/**
 * #4453 — screens with unsaved work, counted while their guard is `dirty`.
 * The brand switcher reads this: switching brand leaves the screen (or swaps
 * the brand under it), so it holds the switch and says why instead of
 * discarding the work silently. `useUnsavedChangesGuard` registers for every
 * screen that uses it; a screen with its own guard can call this directly.
 */
let unsavedScreens = 0;

/** Count this screen as holding unsaved work; call the result to release it. */
export function registerUnsavedWork(): () => void {
  unsavedScreens += 1;
  let released = false;
  return (): void => {
    if (released) return;
    released = true;
    unsavedScreens = Math.max(0, unsavedScreens - 1);
  };
}

/** True while any mounted screen has reported unsaved work. */
export function hasUnsavedWork(): boolean {
  return unsavedScreens > 0;
}

/** Test seam. */
export function resetUnsavedWorkForTest(): void {
  unsavedScreens = 0;
}

/** Ask before leaving only when there is work to lose and nothing is in flight. */
export function shouldConfirmLeave(input: { dirty: boolean; busy?: boolean }): boolean {
  return input.dirty && input.busy !== true;
}

/** The published trip editor's pending changes (EditPublishedTripScreen's computed diff). */
export function hasUnsavedTripEdits(computed: {
  patch: object;
  pricingSwitchesChanged: unknown;
  guestPrivacyChanged: unknown;
  dayDiffs?: readonly unknown[];
  inclusionDiffs?: readonly unknown[];
  pricingTierDiffs?: readonly unknown[];
  droppedDayOrdinals?: readonly unknown[];
  droppedInclusionKeys?: readonly unknown[];
}): boolean {
  return (
    Object.keys(computed.patch).length > 0 ||
    computed.pricingSwitchesChanged !== null ||
    computed.guestPrivacyChanged !== null ||
    (computed.dayDiffs?.length ?? 0) > 0 ||
    (computed.inclusionDiffs?.length ?? 0) > 0 ||
    (computed.pricingTierDiffs?.length ?? 0) > 0 ||
    (computed.droppedDayOrdinals?.length ?? 0) > 0 ||
    (computed.droppedInclusionKeys?.length ?? 0) > 0
  );
}
