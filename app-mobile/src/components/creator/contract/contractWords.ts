/**
 * #3872 — the creator's contract in human words: the six-step tracker, the
 * one next action, and timeline lines. Never a raw state or event key.
 */
export const TRACK_STEPS = ['accepted', 'shoot', 'script', 'upload', 'post', 'paid'] as const;
export type TrackStep = (typeof TRACK_STEPS)[number];

export const TRACK_TITLES: Record<TrackStep, string> = {
  accepted: 'Offer accepted', shoot: 'Plan the shoot', script: 'Script', upload: 'Upload video', post: 'Post and add links', paid: 'Get paid',
};

/** Which tracker step a contract state sits on. */
export function currentTrackStep(state: string): TrackStep {
  switch (state) {
    case 'offered':
    case 'accepted':
    case 'shoot_planned': return state === 'offered' ? 'accepted' : 'shoot';
    case 'script_drafting':
    case 'script_sent': return 'script';
    case 'script_locked':
    case 'delivered':
    case 'fix_requested': return 'upload';
    case 'approved':
    case 'posting':
    case 'posts_submitted':
    case 'posts_failed': return 'post';
    default: return 'paid';
  }
}

export type NextAction = { title: string; text: string; cta: string | null };

/** The one next action for the creator, by state. */
export function nextActionFor(state: string, ctx: { fixRoundsUsed?: number; hostProposedShoot?: boolean; creatorProposedShoot?: boolean } = {}): NextAction {
  switch (state) {
    case 'accepted':
      if (ctx.hostProposedShoot) return { title: 'Confirm the shoot time', text: 'The host suggested a time. Confirm it or pick another inside the shoot window.', cta: 'Review the time' };
      if (ctx.creatorProposedShoot) return { title: 'Waiting for the host', text: 'The host confirms your shoot time, then you get your door pass.', cta: 'Change the time' };
      return { title: 'Plan the shoot', text: 'Pick a time inside the shoot window. The host confirms and you get a door pass.', cta: 'Pick a time' };
    case 'shoot_planned': return { title: 'Write the script', text: 'Plan the hook, the middle and the invite. The host reviews it before you film.', cta: 'Start the script' };
    case 'script_drafting': return { title: 'Write the script', text: 'Fill in each part and include #ad or paid partnership, then send it to the host.', cta: 'Open the script' };
    case 'script_sent': return { title: 'Script with the host', text: 'If the host doesn’t answer in 48 hours, it locks and you can film.', cta: null };
    case 'script_locked': return { title: 'Film and upload', text: 'Film to the locked script, then upload your video for the host to review.', cta: 'Upload video' };
    case 'delivered': return { title: 'Video with the host', text: 'The host has three days. If they don’t answer, it’s approved automatically.', cta: null };
    case 'fix_requested': return { title: `Fix requested (${Math.min(2, Math.max(1, ctx.fixRoundsUsed ?? 1))} of 2)`, text: 'Only the technical issues listed need changing. Upload the fixed video.', cta: 'Upload fixed video' };
    case 'approved': return { title: 'Post it and add links', text: 'Post on the agreed platforms with the disclosure, then add the live links.', cta: 'Start posting' };
    case 'posting': return { title: 'Add your live links', text: 'Paste the link to each post. Mingla checks the author, tags, disclosure and date.', cta: 'Add links' };
    case 'posts_submitted': return { title: 'Checking your posts', text: 'This usually takes a few hours. You don’t need to do anything.', cta: null };
    case 'posts_failed': return { title: 'Fix your post links', text: 'A check didn’t pass. Update the post or the link, then submit again.', cta: 'Update links' };
    case 'posts_verified': return { title: 'Posts verified', text: 'Your fee is released in about 48 hours, then sent to your bank.', cta: null };
    case 'released':
    case 'day30': return { title: 'Payment released', text: 'Your fee is on its way to your bank. Keep the posts live for 30 days.', cta: null };
    case 'completed': return { title: 'Done', text: 'Thanks for the great work. Rate the host below; ratings show once both sides rate or after 7 days.', cta: null };
    case 'disputed': return { title: 'In dispute', text: 'You and the host see the same timeline. Settle with an offer, or Mingla decides.', cta: null };
    default: return { title: 'In progress', text: 'Pull down to refresh.', cta: null };
  }
}

const EVENT_WORDS: Record<string, string> = {
  offer_created: 'Offer sent to you',
  hold_captured: 'Host paid into Mingla’s hold',
  accepted: 'You accepted the offer',
  declined: 'Offer declined',
  expired: 'Offer expired',
  cancelled: 'Contract cancelled',
  shoot_plan_proposed: 'Shoot time suggested',
  shoot_plan_confirmed: 'Shoot time confirmed',
  shoot_planned: 'Shoot planned',
  script_drafting: 'Script started',
  script_saved: 'Script draft saved',
  script_sent: 'Script sent to the host',
  script_locked: 'Script locked',
  delivery_submitted: 'Video uploaded',
  delivered: 'Video sent to the host',
  fix_requested: 'Host asked for a technical fix',
  approved: 'Video approved',
  auto_approved: 'Video approved automatically',
  posting: 'Posting started',
  posts_submitted: 'Post links added',
  posts_verified: 'Posts verified',
  posts_failed: 'A post check didn’t pass',
  gig_release_recorded: 'Payment released',
  released: 'Payment released',
  completed: 'Gig complete',
  refund_recorded: 'Host refunded',
  dispute_opened: 'Dispute opened',
  dispute_offer_made: 'Settlement offered',
  dispute_decided: 'Dispute decided',
  dispute_release_recorded: 'Settlement paid',
  terms_change_proposed: 'Change to the terms proposed',
  terms_change_accepted: 'Terms updated',
  terms_change_declined: 'Change to the terms declined',
  counter_sent: 'You sent a counter-offer',
  counter_accepted: 'Counter-offer accepted',
  counter_declined: 'Counter-offer declined',
};

const ACTOR_WORDS: Record<string, string> = { host: 'Host', creator: 'You', system: 'Mingla', admin: 'Mingla' };

/** A timeline line, e.g. "Script sent to the host". Unknown kinds never leak. */
export function eventWords(kind: string): string {
  if (EVENT_WORDS[kind]) return EVENT_WORDS[kind];
  if (kind.startsWith('dispute_offer_')) return 'Settlement answered';
  return 'Contract updated';
}

export function actorWords(actor: string): string {
  return ACTOR_WORDS[actor] ?? 'Mingla';
}

const FIX_WORDS: Record<string, string> = {
  audio: 'Sound', video_quality: 'Picture quality', missing_agreed_element: 'Something agreed is missing', wrong_length_or_format: 'Length or format',
};
export function fixWords(category: string): string {
  return FIX_WORDS[category] ?? 'Technical fix';
}

const CHECK_WORDS: Record<string, string> = { pending: 'Checking', passed: 'Verified', failed: 'Didn’t pass', unverifiable: 'Host checks it' };
export function postCheckWords(status: string): string {
  return CHECK_WORDS[status] ?? 'Checking';
}

/** Per-platform example and pattern for a live post link (matches the server check). */
export const POST_URL_RULES: Record<string, { example: string; pattern: RegExp }> = {
  instagram: { example: 'https://www.instagram.com/reel/…', pattern: /^https:\/\/(www\.)?instagram\.com\/(reel|p)\//i },
  tiktok: { example: 'https://www.tiktok.com/@you/video/…', pattern: /^https:\/\/(www\.)?tiktok\.com\/@[^/]+\/video\//i },
  youtube: { example: 'https://www.youtube.com/shorts/…', pattern: /^https:\/\/(www\.)?youtube\.com\/shorts\//i },
  x: { example: 'https://x.com/you/status/…', pattern: /^https:\/\/(www\.)?x\.com\/[^/]+\/status\//i },
};
