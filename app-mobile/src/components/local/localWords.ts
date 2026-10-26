/**
 * #3872 — Mingla Local in human words: month status, the Pick · Visit ·
 * Review · Paid step bar, and application status. Never a raw key.
 */
export const LOCAL_STEPS = ['Pick', 'Visit', 'Review', 'Paid'] as const;

/** Index of the current step (0–3), or 4 when paid. */
export function localStepIndex(status: string | null | undefined): number {
  switch (status) {
    case null: case undefined: case '': return 0;
    case 'picked': case 'confirmed': return 1;
    case 'visited': case 'changes_requested': case 'submitted': return 2;
    case 'approved': case 'published': return 3;
    case 'paid': return 4;
    default: return 0;
  }
}

export function localMonthWords(status: string | null | undefined): string {
  switch (status) {
    case 'picked': case 'confirmed': return 'Place picked · visit next';
    case 'visited': return 'Visited · write your review';
    case 'changes_requested': return 'Changes requested';
    case 'submitted': return 'Review in review';
    case 'approved': return 'Approved · pay on the way';
    case 'published': return 'Published · pay on the way';
    case 'paid': return 'Paid';
    case 'missed': return 'Missed';
    case 'void': return 'Cancelled';
    default: return 'Pick a place';
  }
}

/** Money word for a month: On the way until paid (approved/published), Paid when paid. */
export function localMoneyWord(status: string | null | undefined): string | null {
  if (status === 'paid') return 'Paid';
  if (status === 'approved' || status === 'published') return 'On the way';
  return null;
}

export const APPLICATION_COPY: Record<string, { pill: string; title: string; text: string }> = {
  submitted: { pill: 'In review', title: 'We’ve got your application', text: 'We’ll tell you here and by email, usually within a week.' },
  shortlisted: { pill: 'Shortlisted', title: 'You’re shortlisted', text: 'Mingla is reviewing your samples. We’ll be in touch soon.' },
  waitlisted: { pill: 'Waitlisted', title: 'You’re on the waitlist', text: 'All seats in this city are taken right now. You’ll move up when a seat opens.' },
  rejected: { pill: 'Not selected', title: 'Not selected this time', text: 'Thanks for applying. You can apply again in 90 days.' },
  accepted: { pill: 'Accepted', title: 'You’re in', text: 'Pull down to open your Local home.' },
};

export const SPEND_BANDS = [
  { key: 'budget', label: 'Budget' }, { key: 'moderate', label: 'Moderate' }, { key: 'premium', label: 'Premium' }, { key: 'splurge', label: 'Splurge' },
] as const;
