/**
 * #3872 — how Creator and Local writes fail.
 *
 * Write RPCs that can fail on validation answer `{ ok: false, error, field? }`
 * instead of raising. That response is a FAILURE: it must never reach a
 * success toast. Every service write runs its result through
 * `unwrapProgramResult`, which throws a `ProgramActionError` the screen shows
 * next to the field. Raised RPC errors and edge-function errors are mapped to
 * the same copy, so nobody sees "[object Object]", SQL text or
 * "Edge Function returned a non-2xx status code".
 *
 * Pure on purpose (no imports) so the unit suite runs it under node directly.
 */

export class ProgramActionError extends Error {
  readonly code: string;
  readonly field: string | null;
  readonly reasons: string[];
  constructor(code: string, options: { field?: string | null; reasons?: unknown; message?: string } = {}) {
    super(options.message ?? programErrorMessage(code, { reasons: toReasons(options.reasons) }));
    this.name = 'ProgramActionError';
    this.code = code;
    this.field = options.field ?? null;
    this.reasons = toReasons(options.reasons);
  }
}

function toReasons(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

type OkFalse = { ok: false; error?: unknown; field?: unknown; reasons?: unknown };

export function isOkFalse(value: unknown): value is OkFalse {
  return typeof value === 'object' && value !== null && (value as { ok?: unknown }).ok === false;
}

/** `{ok:false}` → throw; anything else passes through untouched. */
export function unwrapProgramResult<T>(value: T): T {
  if (isOkFalse(value)) {
    const code = typeof value.error === 'string' && value.error ? value.error : 'unknown_error';
    throw new ProgramActionError(code, { field: typeof value.field === 'string' ? value.field : null, reasons: value.reasons });
  }
  return value;
}

const REASON_WORDS: Record<string, string> = {
  phone: 'a phone number', email: 'an email address', url: 'a link', link: 'a link', handle: 'a social handle',
  brand: 'the brand name', brand_name: 'the brand name', place: 'the place name', place_name: 'the place name', address: 'an address', listing: 'the event or place name',
};

function reasonList(reasons: string[]): string {
  const words = Array.from(new Set(reasons.map((r) => REASON_WORDS[r] ?? null).filter((r): r is string => Boolean(r))));
  if (words.length === 0) return 'contact details';
  if (words.length === 1) return words[0];
  return `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
}

const MESSAGES: Record<string, string> = {
  // gig interest
  payout_rail_mismatch: 'This gig pays in a different country’s currency than your payout account. Pick a gig in your payout country.',
  creator_not_ready: 'Finish your Creator setup before sending interest.',
  gig_full: 'This gig just filled up. Look for another one in Find gigs.',
  gig_not_open: 'This gig is no longer open.',
  already_interested: 'You’ve already sent interest for this gig.',
  package_not_owned: 'Add a rate for this format first, then try again.',
  // counter
  counter_open: 'You already have a counter waiting for the host.',
  counter_not_allowed: 'You can only counter while the offer is waiting.',
  counter_same_fee: 'Counter with a different price from the offer.',
  // profile + setup
  authentication_required: 'Sign in again to continue.',
  under_18: 'You must be 18 or older to join Mingla Creator.',
  age_requirement: 'You must be 18 or older to join Mingla Creator.',
  date_of_birth_required: 'Add your date of birth to sign.',
  agreement_version_required: 'The agreement isn’t ready to sign yet. Try again later.',
  approved_agreement_version_required: 'The agreement isn’t ready to sign yet. Try again later.',
  creator_account_required: 'We couldn’t find your Mingla account. Sign out and back in, then try again.',
  creator_profile_required: 'Save your profile first, then come back to this step.',
  agreement_not_available: 'The agreement isn’t ready to sign yet. Try again later.',
  invalid_handle: 'Use letters, numbers, dots, dashes or underscores only, without the @.',
  handle_taken: 'Another creator already verified that account. If it’s yours, contact support.',
  handle_claimed: 'Another creator already verified that account. If it’s yours, contact support.',
  invalid_display_name: 'Use 2 to 40 characters for your name.',
  invalid_price: 'Enter a price above zero.',
  // contract work
  disclosure_required: 'Add #ad or “paid partnership” to the script so viewers know it’s sponsored.',
  invalid_script_shape: 'Fill in at least one section of the script.',
  stale_state: 'This contract changed while you were looking. Pull down to refresh.',
  state_mismatch: 'This contract changed while you were looking. Pull down to refresh.',
  shoot_outside_window: 'Pick a time inside the shoot window.',
  invalid_post_url: 'Paste the full link to your live post, starting with https://.',
  rating_not_open: 'Ratings open when the gig is done.',
  permission_denied: 'You don’t have access to this anymore.',
  creator_only: 'Only the creator can do this.',
  // media
  media_capacity: 'Uploads are paused for a few minutes. Your work is saved; try again shortly.',
  media_unavailable: 'Video uploads aren’t open yet. Try again later.',
  video_too_large: 'Choose a video no larger than 150 MB.',
  video_too_long: 'Choose a video up to 90 seconds long.',
  video_unreadable: 'We couldn’t read that video. Choose it again.',
  upload_failed: 'The upload stopped. Check your connection and try again.',
  picker_cancelled: 'No video chosen.',
  // payout
  country_unsupported: 'Payouts aren’t available in that country yet.',
  payout_country_mismatch: 'Your payout account is set up for a different country. Contact support to change it.',
  verified_email_required: 'Confirm your email address first, then connect your bank.',
  account_unresolved: 'We couldn’t find that account. Check the bank and the 10-digit number.',
  account_number_must_be_10_digits: 'Enter the 10-digit account number.',
  bank_code_required: 'Choose your bank.',
  banks_unavailable: 'We couldn’t load the bank list. Try again in a minute.',
  // locals
  locals_not_open: 'Applications for this city are closed right now.',
  invalid_application: 'Check your sample links (up to 10) and try again.',
  active_local_required: 'This is for active Mingla Locals.',
  pick_window_closed: 'Picks for this month closed on the 7th. You can pick again next month.',
  personal_tie_conflict: 'You can’t review a place where you know the owners or staff. Pick another place.',
  place_not_eligible: 'That place can’t be picked this month. Choose another.',
  invalid_review: 'Check the review: title 3–70 characters and 300–2,000 characters of text.',
  network: 'You’re offline. Check your connection and try again.',
};

export function programErrorMessage(code: string, extra: { reasons?: string[] } = {}): string {
  if (code === 'note_not_anonymous' || code === 'public_brief_not_anonymous') {
    return `Remove ${reasonList(extra.reasons ?? [])} from your note. Notes can’t include contact details until you’re hired.`;
  }
  return MESSAGES[code] ?? 'Something went wrong. Try again in a moment.';
}

const RAISED_CODE = /^[a-z][a-z0-9_]{2,60}$/;

/**
 * Any thrown thing → a ProgramActionError with human copy. Raised RPC errors
 * carry a stable snake_case message; edge errors carry `{ error, detail }` in
 * their response body (pass it as `body`).
 */
export function toProgramError(error: unknown, body?: unknown): ProgramActionError {
  if (error instanceof ProgramActionError) return error;
  const payload = (typeof body === 'object' && body !== null ? body : {}) as { error?: unknown; detail?: unknown; field?: unknown; reasons?: unknown };
  const detail = typeof payload.detail === 'string' && RAISED_CODE.test(payload.detail) ? payload.detail : null;
  const bodyCode = typeof payload.error === 'string' && RAISED_CODE.test(payload.error) ? payload.error : null;
  if (detail && MESSAGES[detail]) return new ProgramActionError(detail, { field: typeof payload.field === 'string' ? payload.field : null });
  if (bodyCode) return new ProgramActionError(bodyCode, { field: typeof payload.field === 'string' ? payload.field : null, reasons: payload.reasons });
  const message = typeof error === 'object' && error !== null && typeof (error as { message?: unknown }).message === 'string'
    ? (error as { message: string }).message.trim()
    : typeof error === 'string' ? error.trim() : '';
  if (RAISED_CODE.test(message)) return new ProgramActionError(message);
  if (/network request failed|failed to fetch|network error/i.test(message)) return new ProgramActionError('network');
  return new ProgramActionError('unknown_error');
}

/** The copy to show for any caught error. */
export function programErrorText(error: unknown): string {
  return toProgramError(error).message;
}
