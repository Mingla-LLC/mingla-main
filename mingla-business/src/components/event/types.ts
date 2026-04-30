/**
 * Shared types for the event creator wizard.
 *
 * StepBodyProps is the contract every CreatorStepN component honours.
 * Defined here so step body files don't pull from EventCreatorWizard
 * (avoids a circular import between wizard root + steps).
 *
 * Per Cycle 3 spec §3.4.
 */

import type { DraftEvent } from "../../store/draftEventStore";
import type { ValidationError } from "../../utils/draftEventValidation";

export interface StepBodyProps {
  draft: DraftEvent;
  /** Patches the draft via draftEventStore.updateDraft. */
  updateDraft: (
    patch: Partial<Omit<DraftEvent, "id" | "brandId" | "createdAt">>,
  ) => void;
  /** Errors for THIS step only. Empty until first Continue tap on an invalid step. */
  errors: ValidationError[];
  /** True after first Continue tap on an invalid step (gates inline error display). */
  showErrors: boolean;
  /** Triggers a top-of-screen Toast (used for TRANSITIONAL exits). */
  onShowToast: (message: string) => void;
  /**
   * Scrolls the wizard's body ScrollView to the bottom. Bottom-most
   * multiline TextInputs (e.g. Step 1 Description) call this on focus
   * because iOS's `automaticallyAdjustKeyboardInsets` doesn't reliably
   * scroll-to-focused-input for multilines in this nested layout.
   */
  scrollToBottom: () => void;
}

export const errorForKey = (
  errors: ValidationError[],
  fieldKey: string,
): string | undefined => errors.find((e) => e.fieldKey === fieldKey)?.message;
