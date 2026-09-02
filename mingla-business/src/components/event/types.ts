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
  /**
   * issue #2590 — the event's FIRST occurrence, ISO-8601 UTC, when one exists.
   *
   * Threaded to `TicketTierEditSheet` for a single caution: a sale window that
   * closes before the doors open turns away everyone who tries on the day.
   * Optional and null in the create wizard, where the date may not be set yet —
   * the caution simply does not render, which is correct there.
   */
  eventStartsAtIso?: string | null;
  /** issue #2590 — the event's LAST occurrence END, ISO-8601 UTC. */
  eventEndsAtIso?: string | null;
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
  /**
   * Cycle 13a J-T6 G2: when false, ticket price input is uneditable with a
   * helper hint pointing the operator at finance_manager+. Defaults to true
   * for the create-flow + non-rank-aware callers.
   */
  canEditTicketPrice?: boolean;
  /**
   * issue #2160 — render the multi-day PRICING MODE control on the When step.
   *
   * Opt-IN rather than opt-out, and gated by a prop rather than by inspecting
   * the draft, because `CreatorStep2When` is ALSO the experience wizard's when
   * step (ExperienceCreatorWizard lifts it). Experiences have their own
   * checkout that never sends a day set, so `events.multi_date_pricing_mode`
   * governs nothing there and showing the control would be a lie. Only
   * EventCreatorWizard passes this.
   */
  showMultiDatePricingMode?: boolean;
  /**
   * issue #2160 — TRUE when this event already holds a live ticket, so the
   * pricing mode can no longer change. The database trigger
   * `events_multi_date_pricing_mode_locked` is the authority and is
   * fail-closed; this prop exists so the organiser SEES the locked state
   * rather than tapping a control and eating a database error.
   */
  multiDatePricingModeLocked?: boolean;
  /**
   * Supabase events.id used for cover uploads. Create/edit draft flows use
   * draft.id; edit-after-publish passes LiveEvent.serverEventId because the
   * local live id is le_* and is not the storage/database event id.
   */
  coverMediaEventId?: string | null;
  /**
   * issue #3040 — resolve (creating if needed) the SERVER `events` row this
   * draft maps to, and reconcile the host route onto it. Supplied by the
   * create routes; ABSENT on EditPublishedScreen, where the row already exists.
   * Resolves with the server uuid, or REJECTS with an error the Cover step
   * renders as a visible, retryable message. Never resolves a `d_*` id.
   */
  onRequireServerDraft?: () => Promise<string>;
  /** Brand default currency used when legacy/local drafts have null currency. */
  brandDefaultCurrency?: string | null;
  /**
   * Event cover video processing mode. Draft creation can auto-apply to the
   * server draft once processed; published editing waits for the explicit
   * Save changes action so the live cover is not replaced mid-edit.
   */
  coverMediaApplyMode?: "draft_auto" | "published_manual";
  /** Lets parent flows block publish/save while a video cover is still processing. */
  onCoverVideoProcessingChange?: (isProcessing: boolean) => void;
  /**
   * META-ORCH-1059 — when true, the recurring "Ends" picker offers a third
   * "Never ends" option (open-ended recurrence). Only the EXPERIENCE wizard
   * passes this; events still require a bounded end (count<=52 / until-date).
   */
  allowNeverEnds?: boolean;
  /**
   * ORCH-1150 — when true (RSVP wizard only), CreatorStep2When hides the
   * single/recurring/multi_date mode tabs and renders ONLY the single-date
   * body (steering #4). Default false; the event wizard never passes it, so
   * the event path is byte-identical.
   */
  lockSingleDate?: boolean;
  /**
   * ORCH-1335 — provider-aware RSVP chip-in payout readiness. ONLY the RSVP
   * chip-in authoring step (RsvpStep5Setup) reads this; it swaps the "Connect
   * your bank" nudge for a positive "Payouts are on" confirmation when the brand
   * is already payout-ready. Computed once at the wizard/edit-screen level via
   * isChipInPayoutReady(brand, freshStripeStatus) and threaded through the shared
   * base/step props spread. Optional + undefined-safe: every other step ignores
   * it transparently, and undefined (loading) falls to the neutral nudge (no
   * false-positive). Does NOT touch the publish-time pg_brand_can_collect gate.
   */
  chipInPayoutReady?: boolean;
  // ORCH-0892-A: legacy wizard-scroll-ref prop removed. CoverPicker
  // now relies on the keyboard-controller library's KeyboardAvoidingView
  // wrap for search-input visibility above the keyboard.
}

export const errorForKey = (
  errors: ValidationError[],
  fieldKey: string,
): string | undefined => errors.find((e) => e.fieldKey === fieldKey)?.message;
