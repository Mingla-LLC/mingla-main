// #4402 — one social handle's state on the Creator setup Socials step, drawn
// from the SERVER's fields (last_check_status, review_required, expires_at),
// so it survives a reload. Pure: no React, no network.
import type { CreatorHandle } from '../../services/creatorProgramService';
import type { PillTone } from '../programs/ProgramUi';
import { followerBandLabel, platformLabel } from '../../utils/programFormat';

export type HandleCheckKind = 'new' | 'pending' | 'review' | 'expired' | 'rejected' | 'verified';
export type HandleCheckView = {
  kind: HandleCheckKind;
  pill: { label: string; tone: PillTone };
  /** The card body, or null for a code that was never checked (the steps show instead). */
  text: string | null;
  noticeTone: 'info' | 'warning' | 'success' | 'error';
  /** Check my bio, Get a new code, or nothing (while a person reviews it). */
  action: 'check' | 'new_code' | null;
};

export const REJECTED_STANDARD_COPY = 'Mingla couldn’t confirm this account. Get a new code and add it to your bio to try again.';

export function handleCheckView(h: CreatorHandle, now: Date = new Date()): HandleCheckView {
  if (h.verified && !h.review_required) {
    return { kind: 'verified', pill: { label: 'Verified', tone: 'success' }, text: 'Verified. You can remove the code from your bio now.', noticeTone: 'success', action: null };
  }
  if (h.review_required) {
    return {
      kind: 'review',
      pill: { label: 'In review', tone: 'warning' },
      text: 'We couldn’t read your profile automatically, so a person at Mingla will check it, usually within a day. Keep the code in your bio until then.',
      noticeTone: 'info',
      action: null,
    };
  }
  if (h.last_check_status === 'rejected') {
    const note = h.rejected_note?.trim();
    return {
      kind: 'rejected',
      pill: { label: 'Not confirmed', tone: 'danger' },
      text: note ? `${REJECTED_STANDARD_COPY}\nNote from Mingla: ${note}` : REJECTED_STANDARD_COPY,
      noticeTone: 'error',
      action: 'new_code',
    };
  }
  const expiresAt = h.expires_at ? new Date(h.expires_at).getTime() : Number.NaN;
  if (h.last_check_status === 'expired' || (Number.isFinite(expiresAt) && expiresAt <= now.getTime())) {
    return { kind: 'expired', pill: { label: 'Code expired', tone: 'warning' }, text: 'That code expired. Get a new code and add it to your bio.', noticeTone: 'warning', action: 'new_code' };
  }
  if (h.last_check_status === 'pending') {
    return {
      kind: 'pending',
      pill: { label: 'Code not seen', tone: 'warning' },
      text: 'We couldn’t see the code yet. Make sure your profile is public and the code is in your bio, then check again.',
      noticeTone: 'warning',
      action: 'check',
    };
  }
  return { kind: 'new', pill: { label: 'Code added', tone: 'accent' }, text: null, noticeTone: 'info', action: 'check' };
}

/** "audience 1k–10k · from Instagram" / "· checked by Mingla" / "· self-reported". */
export function audienceLine(h: CreatorHandle): string {
  const band = `audience ${followerBandLabel(h.follower_band)}`;
  if (h.follower_source === 'provider') return `${band} · from ${platformLabel(h.platform)}`;
  if (h.follower_source === 'admin') return `${band} · checked by Mingla`;
  return `${band} · self-reported`;
}
