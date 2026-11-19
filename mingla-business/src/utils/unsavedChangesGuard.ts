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
