// @ts-nocheck — node --experimental-strip-types needs the .ts import extension.
// #4402 Explorer polish — pure helpers: zone-labelled times, capitalised months, grouped money,
// the posting deadline, the upload reason, the minimum fee, the payout floor, the Local pick window,
// the typed date of birth, and the contract words / polling rule.
// Each test fails when the fix it covers is removed. TZ is set in the CI step; the zone is passed explicitly anyway.
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import {
  agreedVideoDueZoned, capitalizeFirst, formatMoney, dayToTypedDob, dobWheelStart, doorPassLine, formatInZone, formatMonth, formatShortDate, formatTypedDob,
  groupMoneyTyping, heldBelowFloorText, isBelowMinFee, minFeeError, minFeeHint, moneyInputValue, parseMoneyInput, pickWindowWords, postDeadlineText, postDueSoonLabel,
  postingStatusCopy, signBlockReason, visitedOnBounds, visitedOnError, typedDobToDay, uploadDueReason, waitingToReachText, zoneLabel,
} from '../programFormat.ts';
import {
  contractRefetchInterval, creatorWaitsOnHost, eventWords, failedPostReason, nextActionFor, postCheckWords, scriptPartsFor,
} from '../../components/creator/contract/contractWords.ts';

const NOW = new Date('2026-11-13T10:00:00Z');

test('item 12: a time is shown in the listing zone with "Lagos time", whatever the device zone is', () => {
  assert.equal(zoneLabel('Africa/Lagos'), 'Lagos time');
  assert.equal(zoneLabel('America/Argentina/Buenos_Aires'), 'Buenos Aires time');
  assert.equal(formatInZone('2026-12-15T17:00:00Z', 'Africa/Lagos', NOW), 'Tue Dec 15, 6:00 PM Lagos time');
  assert.equal(formatInZone('2026-12-15T17:00:00Z', 'Europe/London', NOW), 'Tue Dec 15, 5:00 PM London time');
});

test('item 20: months keep their initial capital and money groups its thousands while typing', () => {
  assert.equal(capitalizeFirst('nov'), 'Nov');
  assert.equal(formatShortDate('2026-11-15', NOW), 'Nov 15');
  assert.equal(formatMonth('2026-11-15', 'short'), 'Nov');
  assert.equal(groupMoneyTyping('40000'), '40,000');
  assert.equal(groupMoneyTyping('1200.50'), '1,200.50');
  assert.equal(moneyInputValue(4_000_000, 'NGN'), '40,000');
  assert.equal(parseMoneyInput('40,000', 'NGN'), 4_000_000);
});

test('items 3 and 4: the posting deadline reads 11:59 PM in the listing zone and says when it is near', () => {
  // post-by Tue Dec 15 in Lagos + 24 h grace: the server stores 00:00 on Thu Dec 17 (Lagos).
  assert.equal(postDeadlineText('2026-12-16T23:00:00Z', 'Africa/Lagos', NOW), 'Wed Dec 16, 11:59 PM Lagos time');
  assert.equal(postDueSoonLabel('2026-12-16T23:00:00Z', new Date('2026-12-16T14:30:00Z')), 'Due in 9 hours');
  assert.equal(postDueSoonLabel('2026-12-16T23:00:00Z', new Date('2026-12-10T14:30:00Z')), null);
  const approved = postingStatusCopy('approved', '2026-12-16T23:00:00Z', 'Africa/Lagos', null, NOW);
  assert.equal(approved.text, 'Post by Wed Dec 16, 11:59 PM Lagos time. Add your live links here once it’s up.');
  const posting = postingStatusCopy('posting', '2026-12-16T23:00:00Z', 'Africa/Lagos', null, NOW);
  assert.match(posting.text, /the gig is cancelled and the host is refunded\.$/);
  const failed = postingStatusCopy('posts_failed', '2026-12-18T23:00:00Z', 'Africa/Lagos', 'The post is missing @tolusrooftop', NOW);
  assert.equal(failed.title, 'One of your posts needs a fix');
  assert.match(failed.text, /^The post is missing @tolusrooftop\. Edit the caption, then submit the link again\. Fix by Fri Dec 18, 11:59 PM Lagos time\.$/);
  assert.equal(postingStatusCopy('script_locked', null, null, null), null);
});

test('item 13: the upload date says why it is two days early', () => {
  const text = uploadDueReason({ videoDueAt: '2026-12-13T22:59:00Z', postBy: '2026-12-15' }, 'Africa/Lagos', NOW);
  assert.equal(text, 'Upload by Sun Dec 13 — two days before your post-by date of Tue Dec 15, so the host has time to review.');
  assert.match(uploadDueReason({ videoDueAt: '2026-12-14T10:00:00Z', postBy: '2026-12-15' }, 'Africa/Lagos', NOW), /before your post-by date of Tue Dec 15/);
  assert.equal(uploadDueReason({ videoDueAt: null, postBy: null }, null), null);
});

test('item 7: the door pass is a text card under the creator name', () => {
  assert.equal(doorPassLine(2, 'Ada Obi'), '2 passes under Ada Obi');
  assert.equal(doorPassLine(1, null), '1 pass under your name');
  const due = agreedVideoDueZoned({ video_due_at: '2026-12-13T22:59:00Z', post_by: '2026-12-15' }, null, 'Africa/Lagos', NOW);
  assert.equal(due, 'Sun Dec 13, 11:59 PM Lagos time');
});

test('item 27: the minimum fee per currency, the hint and the error (no minimum elsewhere)', () => {
  assert.equal(isBelowMinFee(9_999, 'NGN'), true);
  assert.equal(isBelowMinFee(10_000, 'NGN'), false);
  assert.equal(isBelowMinFee(999, 'USD'), true);
  assert.equal(isBelowMinFee(1, 'CAD'), false);
  assert.equal(minFeeError('NGN'), 'The minimum creator fee is ₦100.');
  assert.equal(minFeeError('CAD'), '');
  assert.equal(minFeeHint('NGN', 4_000_000, { withBooking: true }), 'Minimum ₦100. The host also pays Mingla’s 15% booking fee on top, so ₦40,000 costs the host ₦46,000.');
  assert.equal(minFeeHint('USD', null), 'Minimum $10.');
});

test('item 31: earnings below the payout floor read from the server floor', () => {
  assert.equal(heldBelowFloorText({ currency: 'NGN', held_minor: 10_000, floor_minor: 100_000 }), '₦100 waiting. Paid once you have ₦1,000 or more in NGN.');
  assert.equal(heldBelowFloorText({ currency: 'USD', held_minor: 200, floor_minor: 500 }), '$2 waiting. Paid once you have $5 or more in USD.');
  assert.equal(waitingToReachText({ currency: 'NGN', held_minor: 10_000, floor_minor: 100_000 }), 'Waiting to reach ₦1,000');
});

test('item 6: the Local pick window words (new seat, admin, closed)', () => {
  const seat = pickWindowWords({ open: true, reason: 'new_seat', open_until: '2026-11-19T00:00:00Z' }, '2026-11-12', NOW);
  assert.equal(seat.headline, 'Pick your place by Wed Nov 18.');
  assert.equal(seat.detail, 'You started on Nov 12, so you get 7 days to pick.');
  const admin = pickWindowWords({ open: true, reason: 'admin', open_until: '2026-11-20T12:00:00' }, null, NOW);
  assert.equal(admin.headline, 'Pick your place by Fri Nov 20.');
  const closed = pickWindowWords({ open: false, opens_on: '2026-12-01' }, null, NOW);
  assert.equal(closed.open, false);
  assert.equal(closed.headline, 'Picks for this month are closed. The next window opens on Tue Dec 1.');
  // No window from an older server: nothing is invented on the phone.
  assert.equal(pickWindowWords(null, null, NOW).open, true);
});

test('E25/E26: typed date of birth, the wheel start, and the sign button reason', () => {
  assert.equal(formatTypedDob('15032001'), '15 / 03 / 2001');
  assert.equal(formatTypedDob('15'), '15');
  assert.equal(typedDobToDay('15 / 03 / 2001'), '2001-03-15');
  assert.equal(typedDobToDay('31 / 02 / 2001'), null);
  assert.equal(typedDobToDay('15 / 03'), null);
  assert.equal(dayToTypedDob('2001-03-15'), '15 / 03 / 2001');
  const start = dobWheelStart(new Date('2026-11-13T12:00:00'));
  assert.equal(start.getFullYear(), 2005);
  assert.equal(start.getMonth(), 10);
  assert.equal(start.getDate(), 13);
  assert.equal(signBlockReason({ hasVersion: true, birthDate: null, agreed: true }), 'Add your date of birth to sign.');
  assert.equal(signBlockReason({ hasVersion: true, birthDate: '2015-01-01', agreed: true }, NOW), 'You need to be 18 or older to join as a creator.');
  assert.equal(signBlockReason({ hasVersion: true, birthDate: '2001-03-15', agreed: false }, NOW), 'Tick the box to agree, then sign.');
  assert.equal(signBlockReason({ hasVersion: true, birthDate: '2001-03-15', agreed: true }, NOW), null);
});

test('item 16: every timeline event has words, the fallback is only for unknown kinds', () => {
  const kinds = {
    offer_created: 'Offer sent to you', hold_captured: 'Payment held by Mingla', accept: 'You accepted the offer', plan_confirmed: 'Shoot time confirmed', start_script: 'Script started',
    send_script: 'Script sent', lock_script: 'Script approved', auto_lock: 'Script approved automatically', delivery_submitted: 'Video sent', approve: 'Video approved',
    auto_approve: 'Video approved automatically', request_fix: 'Fix requested', start_posting: 'Posting started', posts_submitted: 'Links added', posts_passed: 'All posts checked',
    posts_failed: 'A post needs a fix', release: 'Payment released', counter_sent: 'Counter-offer sent', offer_payment_abandoned: 'Unpaid offer closed', dispute_whatever: 'Dispute updated',
  };
  for (const [kind, words] of Object.entries(kinds)) assert.equal(eventWords(kind), words, kind);
  assert.equal(eventWords('post_reviewed', { result: 'failed' }), 'Post checked: failed');
  assert.equal(eventWords('post_reviewed', { result: 'passed' }), 'Post checked: passed');
  assert.equal(eventWords('refund_recorded', { refund_minor: 4_600_000, currency: 'NGN' }, (m) => `₦${m / 100}`), 'Refund of ₦46000 recorded');
  assert.equal(eventWords('totally_unknown'), 'Contract updated');
});

test('item 2: post check words, the reason from the review, and the Being checked copy', () => {
  assert.equal(postCheckWords('pending'), 'Being checked');
  assert.equal(postCheckWords('failed'), 'Needs a fix');
  assert.equal(failedPostReason({ check_detail: { reason: ' The post is missing @tolusrooftop. ' } }), 'The post is missing @tolusrooftop.');
  assert.equal(failedPostReason({}, [{ kind: 'post_reviewed', data: { result: 'failed', reason: 'Wrong video' } }]), 'Wrong video');
  assert.equal(nextActionFor('posts_submitted').text, 'Mingla’s team is checking your links. You’re paid 48 hours after they pass.');
  assert.match(nextActionFor('posting').text, /Mingla’s team checks the links, usually within a day\./);
});

test('item 8: the contract screen polls every 20 s only while it waits on the other side', () => {
  for (const state of ['script_sent', 'delivered', 'posts_submitted', 'disputed']) assert.equal(contractRefetchInterval(creatorWaitsOnHost(state)), 20_000, state);
  assert.equal(contractRefetchInterval(creatorWaitsOnHost('offered', { openCounter: true })), 20_000);
  assert.equal(contractRefetchInterval(creatorWaitsOnHost('offered')), false);
  assert.equal(contractRefetchInterval(creatorWaitsOnHost('accepted', { creatorProposedShoot: true })), 20_000);
  for (const state of ['accepted', 'script_drafting', 'script_locked', 'fix_requested', 'approved', 'posting', 'posts_failed']) assert.equal(contractRefetchInterval(creatorWaitsOnHost(state)), false, state);
});

test('item 19: script parts follow the format beats and fall back only without a structure', () => {
  const parts = scriptPartsFor([{ key: 'hook', from: 0, to: 3 }, { key: 'atmosphere' }, { key: 'experience' }, { key: 'cta' }]);
  assert.deepEqual(parts.map((p) => p.key), ['hook', 'atmosphere', 'experience', 'cta']);
  assert.deepEqual(parts.map((p) => p.title), ['Hook · first 3 seconds', 'Atmosphere', 'Experience', 'End card']);
  assert.deepEqual(scriptPartsFor([]).map((p) => p.key), ['hook', 'middle', 'invite']);
  assert.deepEqual(scriptPartsFor(null).map((p) => p.key), ['hook', 'middle', 'invite']);
});

test('W3: "Visited on" is never in the future and never before the pick (or the month start)', () => {
  const bounds = visitedOnBounds('2026-11-01', '2026-11-12T09:00:00', new Date('2026-11-14T10:00:00'));
  assert.equal(visitedOnError('2026-11-15', bounds), 'Pick a day that has already happened.');
  assert.equal(visitedOnError('2026-11-14', bounds), null);
  assert.match(visitedOnError('2026-11-10', bounds), /^Pick Nov 12 or later/);
  assert.equal(visitedOnError('2026-11-12', bounds), null);
  const noPick = visitedOnBounds('2026-11-01', null, new Date('2026-11-14T10:00:00'));
  assert.equal(visitedOnError('2026-11-01', noPick), null);
  assert.match(visitedOnError('2026-10-31', noPick), /Nov 1 or later/);
});

test('W1: a successful pick waits for the Local queries to be read again, so the screen moves on by itself', () => {
  const screen = fs.readFileSync(new URL('../../../app/local/index.tsx', import.meta.url), 'utf8');
  assert.match(screen, /const refresh = \(\): Promise<void> => queryClient\.refetchQueries\(\{ queryKey: \['local'\] \}/);
  assert.match(screen, /await localProgramService\.pickPlace\(id, false\); await onPicked\(\);/);
  assert.match(screen, /maximumDate=\{bounds\.max\}/);
});

// #4402 walk (2026-11-13, iPhone sim): Hermes on iOS split formatToParts on punctuation, so
// "Video due" read "Tue Dec 15, undefined:und…", and ignored narrowSymbol so money read "NGN 100".
test('Hermes-shaped Intl: zoned time never prints undefined; known currencies keep their symbol', () => {
  const realParts = Intl.DateTimeFormat.prototype.formatToParts;
  Intl.DateTimeFormat.prototype.formatToParts = function (date) {
    return realParts.call(this, date).filter((p) => !['hour', 'minute', 'dayPeriod'].includes(p.type));
  };
  const nfFormat = Object.getOwnPropertyDescriptor(Intl.NumberFormat.prototype, 'format');
  Object.defineProperty(Intl.NumberFormat.prototype, 'format', {
    configurable: true,
    get() {
      const bound = nfFormat.get.call(this);
      const code = this.resolvedOptions().currency;
      return (n) => (code ? bound(n).replace(/[^\d.,\s-]+/u, `${code}\u00a0`) : bound(n));
    },
  });
  try {
    assert.equal(formatInZone('2026-12-15T17:00:00Z', 'Africa/Lagos', NOW), 'Tue Dec 15, 6:00 PM Lagos time');
    assert.equal(formatMoney(10000, 'NGN'), '₦100');
    assert.equal(formatMoney(4000000, 'NGN'), '₦40,000');
    assert.equal(formatMoney(23000, 'USD'), '$230');
  } finally {
    Intl.DateTimeFormat.prototype.formatToParts = realParts;
    Object.defineProperty(Intl.NumberFormat.prototype, 'format', nfFormat);
  }
  assert.equal(formatMoney(10000, 'NGN'), '₦100');
});
