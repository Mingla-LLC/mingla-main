/**
 * #4430 L-3 — "Update review" opens filled in, with Mingla's request on top.
 *
 * Pure on purpose (no imports): the unit suite runs it under Deno directly.
 */

export type ReviewDraftInput = {
  rating: number; title: string; body: string; visited_on: string; spend_band: string | null;
  media_job_ids: string[]; social_post_url: string; changes_requested: string[];
};

export type ReviewFormState = {
  rating: number; title: string; body: string; spend: string | null; visitedOn: string | null;
  link: string; clips: { jobId: string; status: string }[];
  formatConfirmed: boolean; collaborationConfirmed: boolean;
};

export const BLANK_REVIEW_FORM: ReviewFormState = {
  rating: 0, title: '', body: '', spend: null, visitedOn: null, link: '', clips: [],
  formatConfirmed: false, collaborationConfirmed: false,
};

/** The saved review → the form's starting values. Confirmations start unticked so the Local re-confirms. */
export function draftToFormState(draft: ReviewDraftInput | null | undefined): ReviewFormState {
  if (!draft) return { ...BLANK_REVIEW_FORM, clips: [] };
  return {
    rating: draft.rating,
    title: draft.title,
    body: draft.body,
    spend: draft.spend_band,
    visitedOn: draft.visited_on ? String(draft.visited_on).slice(0, 10) : null,
    link: draft.social_post_url ?? '',
    clips: (draft.media_job_ids ?? []).map((jobId) => ({ jobId, status: 'checking' })),
    formatConfirmed: false,
    collaborationConfirmed: false,
  };
}

export type ChangesWords = {
  /** True once the update window has closed. */
  ended: boolean;
  /** "Send your update by Nov 20." or the ended line. */
  line: string;
  /** The first thing Mingla asked for, in the reviewer's words. */
  first: string | null;
  /** "+ 2 more" when there is more than one request. */
  more: string | null;
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function shortDate(value: string | null | undefined, now: Date): string {
  if (!value) return '';
  const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const date = day ? new Date(Number(day[1]), Number(day[2]) - 1, Number(day[3])) : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const base = `${MONTHS[date.getMonth()]} ${date.getDate()}`;
  return date.getFullYear() === now.getFullYear() ? base : `${base}, ${date.getFullYear()}`;
}

/** The home card's words for a changes_requested month. */
export function changesCardWords(
  month: { changes_due_at?: string | null },
  requests: string[] | null | undefined,
  now: Date,
  /** Date AND time in the phone's own time: the caller passes formatInZone(value, null, now). */
  formatDue: (value: string, now: Date) => string,
): ChangesWords {
  const due = month.changes_due_at ? new Date(month.changes_due_at) : null;
  const ended = Boolean(due && !Number.isNaN(due.getTime()) && now.getTime() > due.getTime());
  const list = (requests ?? []).map((r) => r.trim()).filter(Boolean);
  const date = month.changes_due_at ? (formatDue(month.changes_due_at, now) || shortDate(month.changes_due_at, now)) : '';
  return {
    ended,
    line: ended ? 'The time to update this review has ended.' : date ? `Send your update by ${date}.` : 'Send your update soon.',
    first: list[0] ?? null,
    more: list.length > 1 ? `+ ${list.length - 1} more` : null,
  };
}

/** Whether the review should be read (a month that has, or had, a submitted review). */
export function reviewReadEnabled(status: string | null | undefined): boolean {
  return status === 'changes_requested' || status === 'submitted';
}
