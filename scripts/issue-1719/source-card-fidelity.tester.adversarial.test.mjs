/**
 * #1719 source-card fidelity — independent tester adversarial oracle.
 *
 * This suite attacks fail-closed boundaries that the implementor happy path
 * does not own: hostile source/descriptor shapes, count and numeric limits,
 * private cache separation, public leakage, response-loss fan-out, and the
 * exact legacy/new renderer convergence.
 *
 * FAILS-ON-REVERT: weakening descriptor validation, source array limits,
 * account-scoped caching, resolver authorization, or the shared visual/tap
 * spine turns a named test red while this file remains unchanged.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  assertNativeSourceIdentity,
  assertSavedCuratedStopsServable,
  buildNativeContentCardSnapshot,
} from '../../supabase/functions/_shared/contentShare.ts';
import sharing from '../../packages/sharing/index.js';

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const source = read('supabase/functions/_shared/contentShare.ts');
const service = read('supabase/functions/_shared/contentShareService.ts');
const migration = read('supabase/migrations/20270301001719_issue_1719_native_content_card_snapshots.sql');
const delivery = read('app-mobile/src/services/contentShareDeliveryService.ts');
const resolver = read('app-mobile/src/services/nativeContentCardSnapshotService.ts');
const message = read('app-mobile/src/components/MessageInterface.tsx');
const bubble = read('app-mobile/src/components/chat/MessageBubble.tsx');
const visual = read('app-mobile/src/components/chat/PlaceCuratedChatCard.tsx');

const safeImage = (suffix = 'cover') => `https://usemingla.com/test/${suffix}.jpg`;
const stop = (index) => ({
  stopNumber: index,
  stopLabel: index === 1 ? 'Start Here' : 'Then',
  placeId: `served-place-${index}`,
  placeName: `Stop ${index}`,
  imageUrl: safeImage(`stop-${index}`),
  imageUrls: [safeImage(`stop-${index}-a`)],
});
const curatedInput = (stops) => ({
  card_data: { id: 'tester-plan', cardType: 'curated', title: 'Tester plan', stops },
});
const descriptor = () => ({
  contract: 'native_content_card_v1', version: 1, kind: 'place',
  snapshotRef: `${'test'.repeat(4)}:v1`, snapshotFingerprint: 'a'.repeat(64),
  preview: { title: 'Tester cafe', cardType: 'single', image: safeImage() },
});

test('F-T1 forged solo/collaboration provenance, kind, and place identity fail closed', () => {
  assert.match(source, /from\("saved_card"\)[\s\S]{0,260}\.eq\("profile_id", userId\)/);
  assert.match(source, /from\("session_participants"\)[\s\S]{0,260}\.eq\("user_id", userId\)\.eq\("has_accepted", true\)/);
  assert.match(source, /else if \(sourceRecordId \|\| sourceScope\) throw new Error\("validation"\)/);
  const solo = { experience_id: 'served-place-1', card_data: { id: 'served-place-1', title: 'Cafe' } };
  assert.doesNotThrow(() => assertNativeSourceIdentity('place', solo, { id: 'pool-1', google_place_id: 'served-place-1' }));
  assert.throws(() => assertNativeSourceIdentity('place', solo, { id: 'pool-2', google_place_id: 'forged-place' }), /validation/);
  assert.throws(() => assertNativeSourceIdentity('curated', solo), /validation/);
  assert.throws(() => assertNativeSourceIdentity('place', curatedInput([stop(1)])), /validation/);
});

test('F-T2 curated authority rejects missing, duplicate, inactive, unservable, and >24 stops', () => {
  const saved = [{ placeId: 'a' }, { placeId: 'b' }];
  const rows = [{ google_place_id: 'b', is_active: true, is_servable: true }, { google_place_id: 'a', is_active: true, is_servable: true }];
  assert.doesNotThrow(() => assertSavedCuratedStopsServable(saved, rows), 'database row order must not rewrite authored stop order');
  assert.throws(() => assertSavedCuratedStopsServable([{ placeId: 'a' }, { placeId: 'a' }], rows), /validation/);
  assert.throws(() => assertSavedCuratedStopsServable(saved, rows.slice(0, 1)), /validation/);
  assert.throws(() => assertSavedCuratedStopsServable(saved, [rows[0], { ...rows[1], is_active: false }]), /validation/);
  assert.throws(() => assertSavedCuratedStopsServable(saved, [rows[0], { ...rows[1], is_servable: false }]), /validation/);
  assert.equal(buildNativeContentCardSnapshot('curated', curatedInput(Array.from({ length: 24 }, (_, i) => stop(i + 1)))).stops.length, 24);
  assert.throws(
    () => buildNativeContentCardSnapshot('curated', curatedInput(Array.from({ length: 25 }, (_, i) => stop(i + 1)))),
    /invalid_native_snapshot/,
    'the signed/public curated contract caps a share at 24 stops',
  );
});

test('F-T3 recipient-safe allowlist rejects unknown keys and never leaks private or relative fields', () => {
  const privateKeys = ['distance', 'distanceKm', 'travelTime', 'travelTimeFromUserMin', 'matchScore', 'matchFactors',
    'recommendationReasons', 'ownerId', 'profileId', 'sessionId', 'orderId', 'providerPayload', 'attribution', 'authToken'];
  const safe = buildNativeContentCardSnapshot('curated', curatedInput([{ ...stop(1), distanceFromUserKm: 9, travelTimeFromPreviousStopMin: 20 }]));
  const serialized = JSON.stringify(safe);
  for (const key of privateKeys) assert.equal(serialized.includes(`"${key}"`), false, key);
  assert.equal(serialized.includes('distanceFromUserKm'), false);
  assert.equal(serialized.includes('travelTimeFromPreviousStopMin'), false);
  assert.throws(() => buildNativeContentCardSnapshot('place', { id: 'p', title: 'Place', unknownPrivateField: 'must-not-pass' }), /invalid_native_snapshot/);
  assert.throws(() => buildNativeContentCardSnapshot('curated', curatedInput([{ ...stop(1), nestedUnknown: 'must-not-pass' }])), /invalid_native_snapshot/);
});

test('F-T4 media/string arrays use established card limits and numeric/Unicode bounds cannot bypass', () => {
  // Existing legacy chat preservation is six gallery images and five highlights;
  // the server must reject excess rather than silently truncate source fidelity.
  assert.equal(buildNativeContentCardSnapshot('place', { id: 'p', title: 'Place', images: Array.from({ length: 6 }, (_, i) => safeImage(`gallery-${i}`)), highlights: Array(5).fill('quiet') }).images.length, 6);
  assert.throws(() => buildNativeContentCardSnapshot('place', { id: 'p', title: 'Place', images: Array.from({ length: 7 }, (_, i) => safeImage(`gallery-${i}`)) }), /invalid_native_snapshot/);
  assert.throws(() => buildNativeContentCardSnapshot('place', { id: 'p', title: 'Place', highlights: Array(6).fill('quiet') }), /invalid_native_snapshot/);
  for (const patch of [{ rating: NaN }, { rating: Infinity }, { lat: 90.001 }, { lng: -180.001 }, { reviewCount: 1.5 }, { utcOffsetMinutes: 840.5 }]) {
    assert.throws(() => buildNativeContentCardSnapshot('place', { id: 'p', title: 'Place', ...patch }), /invalid_native_snapshot/, JSON.stringify(patch));
  }
  assert.throws(() => buildNativeContentCardSnapshot('place', { id: 'p', title: '界'.repeat(161) }), /invalid_native_snapshot/);
  assert.match(source, /new TextEncoder\(\)\.encode\(JSON\.stringify\(snapshot\)\)\.byteLength > 262144/);
  assert.match(migration, /octet_length\(convert_to\(p_native_snapshot::text,'UTF8'\)\)/);
  assert.match(migration, /octet_length\(convert_to\(NEW\.card_payload::text,'UTF8'\)\)>5120/);
});

test('F-T5 malformed additive descriptors degrade instead of accepting unsafe or mismatched previews', () => {
  const valid = descriptor();
  assert.deepEqual(sharing.validateNativeContentCardDescriptorV1(valid), valid);
  const malformed = [
    { ...valid, privateSourceRecordId: 'private-row' },
    { ...valid, preview: { ...valid.preview, privateOwnerId: 'private-user' } },
    { ...valid, preview: { ...valid.preview, image: 'javascript:alert(1)' } },
    { ...valid, preview: { ...valid.preview, stopCount: -1 } },
    { ...valid, preview: { ...valid.preview, stopCount: 1.5 } },
    { ...valid, kind: 'curated', preview: { ...valid.preview, cardType: 'single', stopCount: 2 } },
    { ...valid, kind: 'place', preview: { ...valid.preview, cardType: 'curated', stopCount: 2 } },
  ];
  for (const candidate of malformed) assert.equal(sharing.validateNativeContentCardDescriptorV1(candidate), null, JSON.stringify(candidate));
  assert.match(bubble, /validateNativeContentCardDescriptorV1\(payload\.nativeCard\)/);
});

test('F-T6 all eight kinds keep facts, destination, and media while only publicDetails is stripped', () => {
  for (const kind of ['place', 'curated', 'event', 'rsvp_event', 'trip', 'experience', 'venue', 'brand']) {
    assert.match(service, new RegExp(`"${kind.replace('_', '\\_')}"|${kind}`));
  }
  assert.match(migration, /NEW\.card_payload := NEW\.card_payload - 'publicDetails'/);
  assert.doesNotMatch(migration, /NEW\.card_payload := NEW\.card_payload - '(?:facts|destination|media)'/);
  assert.match(message, /isContentShareCardPayload/);
});

test('F-T7 auth-scoped offline cache cannot cross accounts, fingerprints, or auth transitions', () => {
  const cache = sharing.createNativeContentCardSessionCache();
  cache.set('account-a', 'message-1', 'a'.repeat(64), { title: 'cached exact card' });
  assert.deepEqual(cache.get('account-a', 'message-1', 'a'.repeat(64)), { title: 'cached exact card' });
  assert.equal(cache.get('account-b', 'message-1', 'a'.repeat(64)), null);
  assert.equal(cache.get('account-a', 'message-1', 'b'.repeat(64)), null);
  cache.clear();
  assert.equal(cache.get('account-a', 'message-1', 'a'.repeat(64)), null);
  assert.match(resolver, /onAuthStateChange[\s\S]{0,220}cache\.clear\(\)/);
  assert.match(resolver, /expectedFingerprints\[raw\.message_id\][\s\S]{0,180}native_snapshot_fingerprint_mismatch/);
  assert.doesNotMatch(resolver, /catch[\s\S]{0,160}(?:fabricat|reduc|preview)/i);
});

test('F-T8 response-loss retries are server-locked and only inserted rows fan out notifications', () => {
  assert.match(migration, /PRIMARY KEY \(link_id, version\)/);
  assert.match(delivery, /if \(!result\.inserted\) return/);
  assert.match(delivery, /Promise\.all\(Array\.from\(\{ length: Math\.min\(4, input\.recipients\.length\) \}, worker\)\)/);
  const deliveryMigration = read('supabase/migrations/20270227001719_issue_1719_unified_content_sharing.sql');
  assert.match(deliveryMigration, /pg_advisory_xact_lock\(hashtextextended\(v_sender::text\|\|':'\|\|p_operation_id/);
  assert.match(deliveryMigration, /content_share_message_deliveries_idempotency UNIQUE/);
  assert.match(deliveryMigration, /'inserted',false/);
});

test('F-T9 legacy and additive cards share one exact bubble and native expanded-card spine', () => {
  assert.equal((bubble.match(/<PlaceCuratedChatCard/g) ?? []).length, 2);
  assert.match(message, /const openSnapshot = \(card: LegacyCardPayload\)[\s\S]{0,180}cardPayloadToExpandedCardData\(card\)/);
  assert.match(message, /nativeContentCardSnapshotService\.resolve\(\[messageId\]/);
  assert.match(message, /cardPayloadToExpandedCardData\(payload\)/);
  for (const token of ['aspectRatio: 16 / 10', 'borderRadius: 12', 'fontSize: 14']) assert.match(visual, new RegExp(token.replaceAll(' ', '\\s*').replace('/', '\\/')));
  assert.match(message, /accessibilityLabel=\{`Opening shared \$\{nativeCard\.kind === 'curated' \? 'plan' : 'place'\}`\}/);
  assert.match(message, /Connect to open the full card/);
  assert.match(message, /Couldn't open the full card/);
  assert.match(message, /Open shared link/);
});

test('F-T10 native snapshots and private references never enter public envelopes, logs, or notifications', () => {
  assert.match(migration, /FORCE ROW LEVEL SECURITY/);
  assert.match(migration, /REVOKE ALL ON public\.content_share_native_snapshots FROM PUBLIC, anon, authenticated/);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.resolve_native_content_card_snapshots\(uuid\[\]\) FROM PUBLIC,anon/);
  const publicEnvelopeBody = service.slice(service.indexOf('function publicEnvelope'), service.indexOf('function contentShareMessageEnvelopeFits'));
  assert.doesNotMatch(publicEnvelopeBody, /nativeSnapshot|sourceReference|snapshotFingerprint/);
  const notificationBody = delivery.slice(delivery.indexOf('async function notifyInsertedDelivery'), delivery.indexOf('async function executeContentShareDelivery'));
  assert.doesNotMatch(notificationBody, /snapshot|sourceRecord|senderNote|fingerprint/);
});
