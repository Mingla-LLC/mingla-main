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
  /** Patches the draft via draftEventStore.updateDraft (create-flow) or local state setter (edit-published flow). */
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
  /**
   * When provided, the step body is in edit-after-publish mode (ORCH-0704 v2).
   * Currently only Step 5 reads this for tier price/capacity/delete lock UX.
   * Other steps ignore it transparently.
   *
   * In ORCH-0704 stub mode the soldCountByTier map is always empty
   * (useOrderStore not yet built — Cycle 9c flips to live counts).
   *
   * Per ORCH-0704 v2 spec §3.4.1.
   */
  editMode?: {
    soldCountByTier: Record<string, number>;
  };
}

export const errorForKey = (
  errors: ValidationError[],
  fieldKey: string,
): string | undefined => errors.find((e) => e.fieldKey === fieldKey)?.message;
