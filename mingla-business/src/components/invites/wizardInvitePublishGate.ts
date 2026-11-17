/**
 * #4420 — when the creation wizards' Publish may go ahead, as far as invites
 * are concerned. One rule for the Event, RSVP, Experience and Trip wizards.
 *
 * Nobody invited: Publish does not depend on the delivery estimate at all
 * (the publish receipt carries only the saved selection, and nothing is
 * sent). Before this, a failed estimate left Publish silently disabled even
 * when no one was invited.
 *
 * People invited: Publish needs the current estimate (the host confirms the
 * reach and cost). If the estimate failed, the Preview step says so inline
 * with Try again (`estimateFailed`), never a silent disabled button.
 *
 * Type-only imports: this sits in each wizard's chunk at no service cost.
 */
import type {
  WizardInvitePlan,
  WizardInviteQuote,
} from "../../services/offeringInvitePlanService";

interface ReadState {
  isPending: boolean;
  isFetching: boolean;
  isError: boolean;
}

export interface WizardInviteGateInput {
  /** The wizard shows the Invite step (flag on, or a saved selection). */
  inviteEnabled: boolean;
  /** The saved selection the wizard holds. */
  plan: WizardInvitePlan | null;
  /** The estimate the wizard holds. */
  quote: WizardInviteQuote | null;
  /** The summary reads (persisted plan and estimate). */
  summary: { plan: ReadState; quote: ReadState };
}

const settled = (state: ReadState): boolean =>
  !state.isPending && !state.isFetching && !state.isError;

/** True when invites do not hold Publish back. */
export function wizardInviteSummaryReady(input: WizardInviteGateInput): boolean {
  if (!input.inviteEnabled) return true;
  const { plan, quote, summary } = input;
  if (plan === null || !settled(summary.plan)) return false;
  if (plan.selectedCount === 0) return true;
  return quote !== null &&
    quote.selectionRevision === plan.selectionRevision &&
    quote.selectionHash === plan.selectionHash &&
    settled(summary.quote);
}

/** True when people are invited and their delivery estimate failed to load. */
export function wizardInviteEstimateFailed(input: WizardInviteGateInput): boolean {
  if (!input.inviteEnabled || input.plan === null) return false;
  return input.plan.selectedCount > 0 && input.summary.quote.isError &&
    !input.summary.quote.isFetching;
}
