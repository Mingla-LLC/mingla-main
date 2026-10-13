/**
 * rsvpPublishWithoutChipIns — issue #3645.
 *
 * "Publish without chip-ins for now" must not race its own save.
 *
 * The RSVP publish call sends only the event id: the server publishes whatever
 * is STORED. The first version of this path switched chip-ins off locally,
 * left the save to the 700 ms background autosave, and reopened the publish
 * flow after 340 ms. If that save was slow or failed:
 *   - on a brand that truly cannot collect, the server refused the publish and,
 *     because the local flag was already off, the host was sent to bank setup —
 *     the opposite of what they had just chosen;
 *   - on a brand the client wrongly believed could not collect, the RSVP could
 *     go live with chip-ins still on, after a dialog that said no money is
 *     taken.
 *
 * So the order is fixed here, in one place that can be executed by a test:
 *   1. switch chip-ins off locally;
 *   2. AWAIT the save, and require the STORED draft to have chip-ins off;
 *   3. only then continue to the publish confirmation.
 * If the save fails, nothing is published, nothing navigates, the local flag
 * goes back to what it was (so the screen matches the server), and the reason
 * is shown on the dialog.
 *
 * Pure: every effect is injected, so this module imports nothing.
 */

export const RSVP_CHIP_INS_OFF_FAILED_COPY =
  "We couldn't switch chip-ins off. Check your connection and try again.";

interface ChipInDraft {
  rsvpContributionEnabled: boolean;
}

export interface SwitchChipInsOffDeps<D extends ChipInDraft> {
  /** The local flag as it is right now. */
  getLocalChipIns: () => boolean;
  /** Apply the flag locally and return the draft as it now stands. */
  setLocalChipIns: (enabled: boolean) => D;
  /**
   * Drop any queued background save: the awaited save below carries this
   * draft, and a second write racing it helps nobody.
   */
  cancelQueuedSave: () => void;
  /**
   * The awaited save. Resolves with the draft AS STORED. Undefined means this
   * surface has no awaited save, in which case nothing is attempted.
   */
  saveNow:
    | ((draft: D) => Promise<Partial<ChipInDraft> | null | undefined | void>)
    | undefined;
  setWorking: (working: boolean) => void;
  setError: (message: string | null) => void;
  /** Continue to the publish confirmation. Called only after a stored "off". */
  proceed: () => void;
}

/**
 * Returns true when chip-ins are stored off and the publish flow was continued,
 * false when it was not (the dialog stays open with the error).
 */
export async function switchChipInsOffThenProceed<D extends ChipInDraft>(
  deps: SwitchChipInsOffDeps<D>,
): Promise<boolean> {
  if (deps.saveNow === undefined) {
    // No way to know the server has it: do not pretend, do not publish.
    deps.setError(RSVP_CHIP_INS_OFF_FAILED_COPY);
    return false;
  }
  const before = deps.getLocalChipIns();
  deps.setError(null);
  deps.setWorking(true);
  let storedOff = false;
  try {
    const draft = deps.setLocalChipIns(false);
    deps.cancelQueuedSave();
    const stored = await deps.saveNow(draft);
    // The belt: publish reads the stored draft, so the STORED flag decides.
    storedOff =
      stored !== null &&
      stored !== undefined &&
      stored.rsvpContributionEnabled === false;
  } catch {
    storedOff = false;
  }
  if (!storedOff) {
    // The screen must match the server, which still has what it had.
    try {
      deps.setLocalChipIns(before);
    } catch {
      // Restoring is best effort; the error below is what the host needs.
    }
    deps.setWorking(false);
    deps.setError(RSVP_CHIP_INS_OFF_FAILED_COPY);
    return false;
  }
  deps.setWorking(false);
  deps.proceed();
  return true;
}
