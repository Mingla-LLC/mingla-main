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
    case 'approved': return { title: 'Post your video', text: 'Post on the agreed platforms with the disclosure, then add the live links here once it’s up.', cta: 'Add my links' };
    case 'posting': return { title: 'Add your live links', text: 'Paste the link to each post. Mingla’s team checks the links, usually within a day.', cta: 'Add links' };
    case 'posts_submitted': return { title: 'Checking your posts', text: 'Mingla’s team is checking your links. You’re paid 48 hours after they pass.', cta: null };
    case 'posts_failed': return { title: 'One of your posts needs a fix', text: 'Edit the post or the link, then submit the link again.', cta: 'Update links' };
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
  hold_captured: 'Payment held by Mingla',
  accepted: 'You accepted the offer',
  accept: 'You accepted the offer',
  declined: 'Offer declined',
  expired: 'Offer expired',
  cancelled: 'Contract cancelled',
  shoot_plan_proposed: 'Shoot time suggested',
  shoot_plan_confirmed: 'Shoot time confirmed',
  plan_confirmed: 'Shoot time confirmed',
  shoot_planned: 'Shoot planned',
  start_script: 'Script started',
  script_drafting: 'Script started',
  script_saved: 'Script draft saved',
  script_sent: 'Script sent',
  send_script: 'Script sent',
  script_locked: 'Script approved',
  lock_script: 'Script approved',
  auto_lock: 'Script approved automatically',
  request_script_changes: 'Script changes requested',
  delivery_submitted: 'Video sent',
  delivered: 'Video sent to the host',
  fix_requested: 'Host asked for a technical fix',
  request_fix: 'Fix requested',
  approved: 'Video approved',
  approve: 'Video approved',
  auto_approved: 'Video approved automatically',
  auto_approve: 'Video approved automatically',
  posting: 'Posting started',
  start_posting: 'Posting started',
  posts_submitted: 'Links added',
  posts_passed: 'All posts checked',
  posts_verified: 'All posts checked',
  posts_failed: 'A post needs a fix',
  gig_release_recorded: 'Payment released',
  release: 'Payment released',
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
  counter_sent: 'Counter-offer sent',
  counter_accepted: 'Counter-offer accepted',
  counter_declined: 'Counter-offer declined',
  offer_payment_abandoned: 'Unpaid offer closed',
};

const ACTOR_WORDS: Record<string, string> = { host: 'Host', creator: 'You', system: 'Mingla', admin: 'Mingla' };

/** A timeline line, e.g. "Script sent to the host". Unknown kinds never leak. */
export function eventWords(kind: string, data?: Record<string, unknown> | null, money?: (minor: number, currency: string) => string): string {
  if (kind === 'post_reviewed') return data?.result === 'failed' ? 'Post checked: failed' : 'Post checked: passed';
  if (kind === 'refund_recorded' && money && data && typeof data.refund_minor === 'number' && typeof data.currency === 'string') return `Refund of ${money(data.refund_minor, data.currency)} recorded`;
  if (EVENT_WORDS[kind]) return EVENT_WORDS[kind];
  if (kind.startsWith('dispute_offer_')) return 'Settlement answered';
  if (kind.startsWith('dispute_')) return 'Dispute updated';
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

const CHECK_WORDS: Record<string, string> = { pending: 'Being checked', passed: 'Passed', failed: 'Needs a fix', unverifiable: 'Being checked' };
export function postCheckWords(status: string): string {
  return CHECK_WORDS[status] ?? 'Being checked';
}

/** The reason Mingla's team gave for a failed post, from the post's check detail (or the timeline). */
export function failedPostReason(post: { check_detail?: unknown } | null | undefined, events: Array<{ kind: string; data: Record<string, unknown> }> = []): string | null {
  const detail = post?.check_detail;
  const own = detail && typeof detail === 'object' ? (detail as { reason?: unknown }).reason : null;
  if (typeof own === 'string' && own.trim()) return own.trim();
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const e = events[i];
    if (e.kind === 'post_reviewed' && e.data?.result === 'failed' && typeof e.data.reason === 'string' && e.data.reason.trim()) return e.data.reason.trim();
  }
  return null;
}

/** The screen polls (every 20 s) while the next move is the other side's. Creator waits on these. */
export function creatorWaitsOnHost(state: string, ctx: { openCounter?: boolean; pendingTopup?: boolean; creatorProposedShoot?: boolean } = {}): boolean {
  if (state === 'offered') return Boolean(ctx.openCounter || ctx.pendingTopup);
  if (state === 'accepted' || state === 'shoot_planned') return Boolean(ctx.creatorProposedShoot);
  return ['script_sent', 'delivered', 'posts_submitted', 'disputed'].includes(state);
}

export const WAITING_POLL_MS = 20_000;
/** react-query refetchInterval for the contract screen: 20 s while waiting on the other side, otherwise off. */
export function contractRefetchInterval(waiting: boolean): number | false {
  return waiting ? WAITING_POLL_MS : false;
}

const SECTION_WORDS: Record<string, string> = {
  hook: 'Hook', arrival: 'Arrival', reaction: 'Reaction', cta: 'End card', atmosphere: 'Atmosphere', experience: 'Experience',
  price_hook: 'Price hook', included: 'What’s included', value: 'The value', people: 'The people', craft: 'The craft', reasons: 'Three reasons', mood: 'The mood', plan: 'The plan',
  middle: 'Middle', invite: 'Invite',
};
/** A gig-format beat key → its words ("cta" → "End card"). */
export function sectionWord(key: string): string {
  return SECTION_WORDS[key] ?? key.charAt(0).toUpperCase() + key.slice(1).replace(/_/g, ' ');
}

export type ScriptPartSpec = { key: string; title: string; placeholder: string };
const LEGACY_PARTS: ScriptPartSpec[] = [
  { key: 'hook', title: 'Hook · first 3 seconds', placeholder: 'What stops the scroll?' },
  { key: 'middle', title: 'Middle', placeholder: 'What people see and feel there' },
  { key: 'invite', title: 'Invite', placeholder: 'Why go, and how to book' },
];
/**
 * The script's parts follow the gig format's beats (Hook, Atmosphere, Experience, End card).
 * Only a format with no structure falls back to Hook / Middle / Invite.
 */
export function scriptPartsFor(structure: Array<{ key?: unknown; from?: unknown; to?: unknown }> | null | undefined): ScriptPartSpec[] {
  const beats = (structure ?? []).filter((b): b is { key: string; from?: unknown; to?: unknown } => typeof b?.key === 'string' && b.key.length > 0);
  if (!beats.length) return LEGACY_PARTS;
  return beats.map((b, i) => ({
    key: b.key,
    title: i === 0 ? `${sectionWord(b.key)} · first 3 seconds` : sectionWord(b.key),
    placeholder: i === 0 ? 'What stops the scroll?' : `What people see and say in the ${sectionWord(b.key).toLowerCase()}`,
  }));
}

/** Per-platform example and pattern for a live post link (matches the server check). */
export const POST_URL_RULES: Record<string, { example: string; pattern: RegExp }> = {
  instagram: { example: 'https://www.instagram.com/reel/…', pattern: /^https:\/\/(www\.)?instagram\.com\/(reel|p)\//i },
  tiktok: { example: 'https://www.tiktok.com/@you/video/…', pattern: /^https:\/\/(www\.)?tiktok\.com\/@[^/]+\/video\//i },
  youtube: { example: 'https://www.youtube.com/shorts/…', pattern: /^https:\/\/(www\.)?youtube\.com\/shorts\//i },
  x: { example: 'https://x.com/you/status/…', pattern: /^https:\/\/(www\.)?x\.com\/[^/]+\/status\//i },
};
