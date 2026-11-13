// #4402 — one social handle's state on the Creator setup Socials step, drawn
// from the SERVER's fields (last_check_status, review_required, expires_at),
// so it survives a reload. Pure: no React, no network. A person at Mingla
// verifies every handle; the bio check only records what it saw.
import type { CreatorHandle } from '../../services/creatorProgramService';
import type { PillTone } from '../programs/ProgramUi';
import { followerBandLabel } from '../../utils/programFormat';

export type HandleCheckKind = 'review' | 'expired' | 'rejected' | 'verified';
export type HandleCheckView = {
  kind: HandleCheckKind;
  pill: { label: string; tone: PillTone };
  text: string;
  noticeTone: 'info' | 'warning' | 'success' | 'error';
  /** Check my bio (optional evidence for the reviewer), Get a new code, or nothing. */
  action: 'check' | 'new_code' | null;
};

// Seth, 12 Nov 2026: a person at Mingla verifies every handle. The screen never
// says the account is being checked automatically, and a rejection sticks.
export const REJECTED_STANDARD_COPY = 'Mingla couldn’t confirm this account.';
export const REVIEW_COPY = 'With Mingla for review. A person at Mingla will check your profile for the code, usually within a day. Keep the code in your bio until then.';

const EVIDENCE_COPY: Partial<Record<string, string>> = {
  code_seen: 'We saw the code on your profile.',
  code_not_seen: 'We couldn’t see the code on your profile yet. Make sure your profile is public and the code is in your bio.',
  unreadable: 'We couldn’t open your profile, so the person reviewing it will look for the code themselves.',
};

export function handleCheckView(h: CreatorHandle, now: Date = new Date()): HandleCheckView {
  if (h.last_check_status === 'rejected') {
    const note = h.rejected_note?.trim();
    return {
      kind: 'rejected',
      pill: { label: 'Not confirmed', tone: 'danger' },
      text: note ? `${REJECTED_STANDARD_COPY}\nNote from Mingla: ${note}` : REJECTED_STANDARD_COPY,
      noticeTone: 'error',
      action: null,
    };
  }
  if (h.verified && !h.review_required) {
    return { kind: 'verified', pill: { label: 'Verified', tone: 'success' }, text: 'Verified by Mingla. You can remove the code from your bio now.', noticeTone: 'success', action: null };
  }
  const expiresAt = h.expires_at ? new Date(h.expires_at).getTime() : Number.NaN;
  if (h.last_check_status === 'expired' || (Number.isFinite(expiresAt) && expiresAt <= now.getTime())) {
    return { kind: 'expired', pill: { label: 'Code expired', tone: 'warning' }, text: 'That code expired. Get a new code and add it to your bio.', noticeTone: 'warning', action: 'new_code' };
  }
  const evidence = h.last_check_status ? EVIDENCE_COPY[h.last_check_status] : undefined;
  return {
    kind: 'review',
    pill: { label: 'With Mingla', tone: 'accent' },
    text: evidence ? `${REVIEW_COPY}\n${evidence}` : REVIEW_COPY,
    noticeTone: h.last_check_status === 'code_not_seen' ? 'warning' : 'info',
    action: 'check',
  };
}

/** "audience 1k–10k · checked by Mingla" / "· self-reported". The band comes only from Mingla. */
export function audienceLine(h: CreatorHandle): string {
  const band = `audience ${followerBandLabel(h.follower_band)}`;
  if (h.follower_source === 'admin') return `${band} · checked by Mingla`;
  return `${band} · self-reported`;
}
