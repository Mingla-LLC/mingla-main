/**
 * #1615 implementor happy path — new append-only suite.
 * FAILS-ON-REVERT: reverting packages/sharing makes every assertion in this
 * file fail because the exact eight-kind executable owner no longer exists.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const sharing = require('..');

const CODE = 'Aa0Bb1Cc2Dd3Ee4F';
const cases = [
  { schemaVersion: 1, kind: 'place', title: 'Namu', category: 'Korean', area: 'Durham', rating: 4.6, route: { placeId: 'ChIJ-public' } },
  { schemaVersion: 1, kind: 'curated', title: 'Saturday in Durham', stopCount: 3, area: 'Downtown', duration: '4 hours', estimate: { minorUnits: 6500, currency: 'USD', disclosure: 'Estimated' } },
  { schemaVersion: 1, kind: 'event', title: 'Jazz Night', localDate: 'Sat, Aug 8', localTime: '8 PM', venue: 'The Yard', route: { eventSlug: 'jazz-night' } },
  { schemaVersion: 1, kind: 'rsvp_event', title: 'Studio Supper', localDate: 'Aug 12', localTime: '7 PM', venue: 'North Star', route: { eventSlug: 'studio-supper' } },
  { schemaVersion: 1, kind: 'trip', title: 'Blue Ridge Weekend', destination: 'Asheville', dateRange: 'Sep 4–6', startingPrice: { minorUnits: 39900, currency: 'USD', disclosure: 'From' }, route: { eventSlug: 'blue-ridge' } },
  { schemaVersion: 1, kind: 'experience', title: 'Clay Workshop', area: 'Raleigh', duration: '2 hours', route: { eventSlug: 'clay-workshop' } },
  { schemaVersion: 1, kind: 'venue', title: 'The Fruit', category: 'Arts venue', area: 'Durham', route: { brandSlug: 'fruit', venueSlug: 'durham' } },
  { schemaVersion: 1, kind: 'brand', title: 'Bull City Nights', category: 'Events', area: 'Durham', upcomingPublicOfferingCount: 4, route: { brandSlug: 'bull-city-nights' } },
];

test('H1 exact eight-kind ShareFactsV1 inputs validate and sanitize', () => {
  assert.deepEqual(sharing.SHARE_ENTITY_KINDS, ['place', 'curated', 'event', 'rsvp_event', 'trip', 'experience', 'venue', 'brand']);
  for (const fixture of cases) {
    const result = sharing.validateShareFactsV1(fixture);
    assert.equal(result.ok, true, `${fixture.kind}: ${JSON.stringify(result)}`);
    assert.equal(result.value.kind, fixture.kind);
    assert.ok(result.value.title);
  }
});

test('H2 every kind builds one bounded deterministic short-link message', () => {
  for (const fixture of cases) {
    const first = sharing.buildShareMessage(fixture, { shortCode: CODE, channel: 'sms' });
    const second = sharing.buildShareMessage(fixture, { shortCode: CODE, channel: 'sms' });
    assert.equal(first, second);
    assert.equal((first.match(/https:\/\/usemingla\.com\/s\//g) || []).length, 1);
    const [body, url] = first.split('\n\n');
    assert.ok(Array.from(body).length <= 180, `${fixture.kind} body budget`);
    assert.ok(Array.from(first).length <= 230, `${fixture.kind} total budget`);
    assert.equal(url, `https://usemingla.com/s/${CODE}`);
  }
});

test('H3 typed fact priority, omission, disclosures and statuses execute', () => {
  assert.deepEqual(sharing.selectRecipientFacts(cases[0]), ['Korean', 'Durham', '4.6/5']);
  assert.deepEqual(sharing.selectPreviewFacts(cases[1]), ['3 stops', 'Downtown', '4 hours', 'Estimated $65']);
  assert.equal(sharing.statusLabel('cancelled'), 'Cancelled');
  const zero = sharing.parseShareFactsV1({ ...cases[7], upcomingPublicOfferingCount: 0 });
  assert.doesNotMatch(sharing.selectRecipientFacts(zero).join(' '), /0 upcoming/);
});

test('H4 strict URL, route, media and private-field rejection contracts execute', () => {
  assert.equal(sharing.buildShortShareUrl(CODE), `https://usemingla.com/s/${CODE}`);
  assert.equal(sharing.buildSharePortraitUrl(CODE, 3), `https://usemingla.com/og/s/${CODE}/v3.png`);
  assert.throws(() => sharing.buildSharePortraitUrl(CODE, 0));
  for (const bad of ['short', '123456789012345-', '12345678901234567', '１２３４５６７８９０１２３４５６']) {
    assert.equal(sharing.isShortShareCode(bad), false);
  }
  assert.throws(() => sharing.buildShortShareUrl('not-valid'));
  assert.equal(sharing.validateShareFactsV1({ ...cases[3], guestEmail: 'private@example.com' }).ok, false);
  assert.equal(sharing.validateShareFactsV1({ ...cases[2], route: { eventSlug: '' } }).ok, false);
  assert.equal(sharing.validateShareFactsV1({ ...cases[2], media: { kind: 'video', url: 'https://cdn.test/a.mp4' } }).ok, false);
  assert.equal(sharing.validateShareFactsV1({ ...cases[2], media: { kind: 'video', url: 'https://cdn.test/a.mp4', posterUrl: 'https://cdn.test/a.jpg' } }).ok, true);
});

test('H5 sender note is sanitized, bounded, visibly authored and never enters facts', () => {
  const input = { ...cases[0] };
  const message = sharing.buildShareMessage(input, { shortCode: CODE, senderNote: '\u202e Meet me there ' });
  assert.match(message, /From the sender: Meet me there/);
  assert.doesNotMatch(message, /\u202e/);
  assert.equal(Object.hasOwn(sharing.parseShareFactsV1(input), 'senderNote'), false);
});

test('H6 route manifest covers every entity and keeps consumer destinations typed', () => {
  assert.deepEqual(Object.keys(sharing.ROUTE_MANIFEST), sharing.SHARE_ENTITY_KINDS);
  for (const kind of sharing.SHARE_ENTITY_KINDS) {
    const route = sharing.routeContractFor(kind);
    assert.ok(route.web);
    assert.ok(route.native);
    assert.ok(Array.isArray(route.required));
  }
});
