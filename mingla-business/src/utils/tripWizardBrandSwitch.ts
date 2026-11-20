/**
 * #4453 — a brand switch while the trip wizard is open. The wizard saves a
 * step only on Continue, Back or Close, so a switch from the top bar used to
 * leave with whatever was typed on the current step unsaved. The switcher now
 * asks the wizard first, and the wizard saves the step the same way Close
 * does (`autosaveCurrentStep`, through the one save queue):
 *   - the trip changed somewhere else: stay (Reload is already offered);
 *   - a save is on the wire: wait for it, never start a second beside it,
 *     and stay if it did not land;
 *   - a new trip nobody has typed into: go (there is nothing to save);
 *   - otherwise save this step, and go only if it landed.
 * True = safe to leave. False = the switcher holds the switch and says why.
 */
export async function saveTripWizardBeforeBrandSwitch(session: {
  conflicted: () => boolean;
  busy: () => boolean;
  waitForSave: () => Promise<boolean>;
  nothingToSave: () => boolean;
  save: () => Promise<void>;
}): Promise<boolean> {
  if (session.conflicted()) return false;
  if (session.busy() && !(await session.waitForSave())) return false;
  if (session.nothingToSave()) return true;
  try {
    await session.save();
    return true;
  } catch {
    // The wizard has already said why (its header and banner); stay.
    return false;
  }
}
