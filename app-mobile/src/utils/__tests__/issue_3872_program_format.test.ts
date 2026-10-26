// #3872 walkthrough build — the one formatter every Creator and Local screen
// uses. Runs under `node --experimental-strip-types --test` (no jest in this app).
//
// Fails before the build: these helpers did not exist; screens printed
// "USD 30000", "2026-11-14", "B2", "10k_50k" and raw states like "script sent".
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  budgetDisplay,
  creatorStateWords,
  deliverableLabel,
  followerBandLabel,
  formatDateRange,
  formatDue,
  formatMoney,
  formatShortDate,
  formatTimeLeft,
  hostsSeeYouAs,
  localRowCopy,
  nicheLabel,
  isAdult,
  latestAdultBirthDate,
  moneyInputValue,
  moneyStateWord,
  parseMoneyInput,
  toDayString,
} from '../programFormat.ts';

const NOW = new Date(2026, 9, 26, 12, 0, 0); // Oct 26 2026, local noon

test('#3872 money: minor units in the record currency, cents only when present', () => {
  assert.equal(formatMoney(30000, 'USD', 'en-US'), '$300');
  assert.equal(formatMoney(475, 'USD', 'en-US'), '$4.75');
  assert.equal(formatMoney(12000000, 'NGN', 'en-US'), '₦120,000');
  assert.equal(formatMoney(500, 'JPY', 'en-US'), '¥500');
  assert.doesNotMatch(formatMoney(30000, 'USD', 'en-US'), /USD|30000|\.00/);
});

test('#3872 money inputs take whole currency and convert to minor units', () => {
  assert.equal(parseMoneyInput('300', 'USD'), 30000);
  assert.equal(parseMoneyInput('$1,200.50', 'USD'), 120050);
  assert.equal(parseMoneyInput('120000', 'NGN'), 12000000);
  assert.equal(parseMoneyInput('500', 'JPY'), 500);
  assert.equal(parseMoneyInput('0', 'USD'), null);
  assert.equal(parseMoneyInput('12.345', 'USD'), null);
  assert.equal(parseMoneyInput('abc', 'USD'), null);
  assert.equal(moneyInputValue(30000, 'USD'), '300');
  assert.equal(moneyInputValue(120050, 'USD'), '1200.50');
});

test('#3872 dates read "Nov 14" and ranges "Nov 14–16", never ISO', () => {
  assert.equal(formatShortDate('2026-11-14', NOW, 'en-US'), 'Nov 14');
  assert.equal(formatShortDate('2027-01-03', NOW, 'en-US'), 'Jan 3, 2027');
  assert.equal(formatDateRange('2026-11-14', '2026-11-16', NOW, 'en-US'), 'Nov 14–16');
  assert.equal(formatDateRange('2026-11-28', '2026-12-02', NOW, 'en-US'), 'Nov 28 – Dec 2');
  assert.equal(formatDateRange('2026-11-20', '2026-11-20', NOW, 'en-US'), 'Nov 20');
  assert.doesNotMatch(formatDateRange('2026-11-14', '2026-11-16', NOW, 'en-US'), /2026-/);
  assert.equal(toDayString(new Date(2026, 10, 4)), '2026-11-04');
});

test('#3872 relative due text and countdowns', () => {
  assert.equal(formatDue(new Date(2026, 9, 26, 18), NOW), 'Due today');
  assert.equal(formatDue('2026-10-27', NOW), 'Due tomorrow');
  assert.equal(formatDue('2026-11-18', NOW, 'en-US'), 'Due Nov 18');
  assert.equal(formatDue('2026-10-20', NOW), 'Overdue');
  assert.equal(formatTimeLeft(new Date(NOW.getTime() + 47 * 3_600_000), NOW), '47 hours left to answer');
  assert.equal(formatTimeLeft(new Date(NOW.getTime() - 1000), NOW), 'Time’s up');
});

test('#3872 follower bands and budgets never show raw keys', () => {
  assert.equal(followerBandLabel('10k_50k'), '10k–50k');
  assert.equal(followerBandLabel('gt1m'), '1M+');
  assert.equal(followerBandLabel('weird_key'), 'Not set');
  const range = budgetDisplay({ budget_band: 'b2', budget_min_minor: 25000, budget_max_minor: 50000, budget_currency: 'USD' });
  assert.deepEqual(range, { kind: 'range', text: '$250–$500' });
  const level = budgetDisplay({ budget_band: 'b2', budget_min_minor: null, budget_max_minor: null, budget_currency: null });
  assert.equal(level.kind, 'level');
  assert.equal(level.kind === 'level' && level.level, 2);
  assert.doesNotMatch(level.text, /b2|B2/);
  assert.equal(deliverableLabel({ platform: 'instagram', kind: 'reel', count: 1 }), '1 Instagram Reel');
});

test('#3872 contract states use the creator column of the status-words table', () => {
  const deadline = new Date(NOW.getTime() + 47 * 3_600_000).toISOString();
  assert.equal(creatorStateWords('offered', { deadlineAt: deadline, now: NOW }), 'Offer waiting · answer in 47h');
  assert.equal(creatorStateWords('accepted'), 'Plan the shoot');
  assert.equal(creatorStateWords('shoot_planned'), 'Plan the shoot');
  assert.equal(creatorStateWords('script_drafting'), 'Write the script');
  assert.equal(creatorStateWords('script_sent'), 'Script with the host');
  assert.equal(creatorStateWords('script_locked'), 'Film and upload');
  assert.equal(creatorStateWords('delivered'), 'Video with the host');
  assert.equal(creatorStateWords('fix_requested', { fixRoundsUsed: 1 }), 'Fix requested (1 of 2)');
  assert.equal(creatorStateWords('approved'), 'Post it and add links');
  assert.equal(creatorStateWords('posting'), 'Post it and add links');
  assert.equal(creatorStateWords('posts_submitted'), 'Checking your posts');
  assert.equal(creatorStateWords('posts_verified'), 'Posts verified · paid in 48h');
  assert.equal(creatorStateWords('released'), 'Payment released');
  assert.equal(creatorStateWords('completed'), 'Done');
  assert.equal(creatorStateWords('disputed'), 'In dispute');
  assert.equal(creatorStateWords('declined'), 'Declined');
  assert.equal(creatorStateWords('expired'), 'Expired');
  assert.equal(creatorStateWords('cancelled'), 'Cancelled');
  assert.equal(creatorStateWords('some_new_state'), 'In progress');
});

test('#3872 money states read On the way · Ready · Paid, and only "paid" says Paid', () => {
  assert.equal(moneyStateWord('on_the_way'), 'On the way');
  assert.equal(moneyStateWord('ready'), 'Ready');
  assert.equal(moneyStateWord('paid'), 'Paid');
  assert.equal(moneyStateWord('released'), 'On the way');
  assert.equal(moneyStateWord(undefined), 'On the way');
});

test('#3872 the creator agreement requires a birth date at least 18 years ago', () => {
  assert.equal(isAdult('2008-10-26', NOW), true, '18th birthday today counts');
  assert.equal(isAdult('2008-10-27', NOW), false, 'one day short of 18');
  assert.equal(isAdult('1990-02-14', NOW), true);
  assert.equal(isAdult('2030-01-01', NOW), false, 'future dates are not birth dates');
  assert.equal(isAdult(null, NOW), false);
  assert.equal(isAdult('1890-01-01', NOW), false, 'implausible ages are rejected');
  const latest = latestAdultBirthDate(NOW);
  assert.equal(toDayString(latest), '2008-10-26');
  assert.equal(isAdult(latest, NOW), true);
});

test('#3872 W1.2 Local row is city-aware: the viewer city rate, else a general line', () => {
  const programs = [
    { city_id: 'ral', city: 'Raleigh', seats: 1, monthly_rate_minor: 15000, payout_currency: 'USD' },
    { city_id: 'lag', city: 'Lagos', seats: 2, monthly_rate_minor: 6000000, payout_currency: 'NGN' },
  ];
  assert.equal(localRowCopy({ enabled: true, programs, applications: [], local: null, viewer_city_id: 'ral' }), 'Get paid $150 a month in Raleigh');
  assert.equal(localRowCopy({ enabled: true, programs, applications: [], local: null, viewer_city_id: 'lag' }), 'Get paid ₦60,000 a month in Lagos');
  assert.equal(localRowCopy({ enabled: true, programs, applications: [], local: null, viewer_city_id: null }), 'Get paid monthly to review one place in your city');
  assert.equal(localRowCopy({ enabled: true, programs, applications: [], local: null, viewer_city_id: 'elsewhere' }), 'Get paid monthly to review one place in your city');
  assert.equal(localRowCopy({ enabled: false, programs: [], applications: [], local: null }), null);
  assert.equal(localRowCopy({ enabled: true, programs, applications: [{ status: 'waitlisted' }], local: null }), 'You’re on the waitlist for the next open seat.');
  assert.equal(localRowCopy({ enabled: true, programs, applications: [], local: { city: 'Raleigh' } }), 'Your Local seat in Raleigh');
});

test('#3872 W1.1 "Hosts see you as" reads name and niches in words', () => {
  assert.equal(hostsSeeYouAs('Ada Films', ['food', 'nightlife'], nicheLabel), 'Ada Films · Food, Nightlife');
  assert.equal(hostsSeeYouAs('Ada Films', [], nicheLabel), 'Ada Films');
});
