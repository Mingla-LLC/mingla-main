/**
 * #1615 RETURN implementor happy path: typed producers and native receiver.
 * FAILS-ON-REVERT: deleting the RETURN client wiring makes C1-C6 fail while
 * the independent server and tester suites remain unchanged.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8');
const require = createRequire(import.meta.url);
const sharing = require(path.join(ROOT, 'packages/sharing'));

test('C1 reusable facts reject sender planning preference', () => {
  const result = sharing.validateShareFactsV1({
    schemaVersion: 1,
    kind: 'place',
    title: 'Public place',
    planningPreference: 'Saturday afternoon',
  });
  assert.equal(result.ok, false);
  assert.deepEqual(result.errors, ['unexpected_field:planningPreference']);
  assert.equal(sharing.formatPlanningPreference({ dayOfWeek: 'weekend', timeOfDay: 'afternoon', planningTimeframe: 'this month' }), 'one weekend afternoon this month');
});

test('C2 both adapters expose nullable S4 only when media exists', () => {
  for (const file of [
    'app-mobile/src/services/contentShareAdapter.ts',
    'mingla-business/src/services/contentShareAdapter.ts',
  ]) {
    const source = read(file);
    assert.match(source, /s4Url:\s*string\s*\|\s*null|string\|null/);
    assert.match(source, /media\s*===\s*null\s*\?\s*null|media==null\?null/);
  }
});

test('C3 consumer preview renders only the canonical prepared message lifecycle', () => {
  const source = read('app-mobile/src/components/ShareModal.tsx');
  for (const state of ['validating', 'creating', 'reusing', 'ready', 'opening', 'returned']) {
    assert.ok(source.includes(`'${state}'`), state);
  }
  assert.match(source, /<Text style=\{styles\.messageText\}>\{sharedCard\.message\}<\/Text>/);
  assert.doesNotMatch(source, /generatePersonalizedMessage|personalizedMessage|star rating|Let me know if you're interested/);
  // [TEST-MOD-APPROVED #1615] The prior assertion pinned the unsafe
  // default-off rollback blocker. The adapter now performs a default-on,
  // response-classified authenticated legacy create for place/curated only.
  assert.doesNotMatch(source, /ENABLE_LEGACY_PRIVATE_SHARE_FALLBACK|EXPO_PUBLIC_ENABLE_LEGACY_SHARE_FALLBACK/);
  assert.match(read('app-mobile/src/services/contentShareAdapter.ts'), /isLegacyRollbackEligible[\s\S]*createSharedCard/);
  assert.match(source, /accessibilityState=\{\{ disabled: true \}\}[\s\S]{0,600}Coming soon/);
  assert.match(source, /sharedCard\?\.s4Url[\s\S]*aspectRatio:\s*4\s*\/\s*5/);
  assert.match(source, /No image preview is available/);
  assert.doesNotMatch(source, /shareAsync\(|s4Url[\s\S]{0,160}sharePreparedContent/);
  assert.match(source, /shareActionPromiseRef[\s\S]*runExclusiveShareAction/);
});

test('C4 receiver consumes exact sanitized place and curated discriminants', () => {
  // [TEST-MOD-APPROVED #1615] The prior assertion required `placeId` inside
  // public curated details, contradicting the binding no-private-ID response.
  const service = read('app-mobile/src/services/contentShareAdapter.ts');
  const route = read('app-mobile/app/s/[code].tsx');
  for (const field of ['directionsUrl', 'utcOffsetMinutes', 'stops', 'imageUrl']) {
    assert.ok(service.includes(field), field);
  }
  assert.doesNotMatch(service, /stops:\s*Array<\{[^}]*placeId/s);
  assert.match(service, /publicDetails:\s*data\.publicDetails\s*\?\?\s*null/);
  assert.match(route, /details\?\.kind === 'place'/);
  assert.match(route, /details\?\.kind === 'curated'/);
  assert.match(route, /details\.stops\.map/);
  assert.match(route, /key=\{`\$\{stop\.title\}:\$\{index\}`\}/);
  assert.doesNotMatch(route, /stop\.placeId|savedCardId|placePoolId|profileId|source_reference/);
});

test('C5 content-share ignores raw referral while retaining exact code navigation', async () => {
  // [TEST-MOD-APPROVED #1615] The prior assertion required native to retain
  // content-share af_sub1, contradicting the binding that installed-direct
  // native stores only opaque {shortCode,version}; web/server attribution stays
  // private. Prove af_sub1 is absent from the destination and persistence path.
  const resolver = read('app-mobile/src/services/oneLinkResolver.ts');
  const dispatch = read('app-mobile/app/index.tsx');
  assert.match(resolver, /kind: 'content_share'; code: string }/);
  assert.doesNotMatch(resolver, /kind: 'content_share'; code: string; referralCode/);
  assert.match(resolver, /REFERRAL_CODE_RE\s*=\s*\/\^\[0-9A-Za-z\]/);
  assert.match(resolver, /sanitizeReferralCode\(data\.af_sub1\)/);
  const runtimeResolver = await import(pathToFileURL(path.join(ROOT, 'app-mobile/src/services/oneLinkResolver.ts')));
  const code = 'Aa0Bb1Cc2Dd3Ee4F';
  assert.deepEqual(
    runtimeResolver.resolveOneLinkDestination({
      deep_link_value: 'content_share',
      deep_link_sub1: code,
      af_sub1: 'REF-PRIVATE',
    }),
    { kind: 'content_share', code },
  );
  const route = read('app-mobile/app/s/[code].tsx');
  // [TEST-MOD-APPROVED #1615] The route and authenticated root now share one
  // exact opaque-state helper; the old assertion pinned a write-only literal.
  assert.match(route, /persistContentShareAttribution\(AsyncStorage, \{ shortCode: next\.shortCode, version: next\.version \}\)/);
  assert.match(read('app-mobile/src/services/contentShareAttribution.ts'), /@mingla_content_share_attribution/);
  assert.doesNotMatch(route, /\bref\b|@mingla_referral_code/);
  assert.doesNotMatch(dispatch, /const referralQuery|\?ref=/);
  const contentShareBranch = dispatch.match(/case 'content_share': \{([\s\S]*?)case 'share':/);
  assert.ok(contentShareBranch);
  assert.match(contentShareBranch[1], /const path = `\/s\/\$\{encodeURIComponent\(dest\.code\)\}`/);
  assert.doesNotMatch(contentShareBranch[1], /referralCode|persistValidatedReferralCode|@mingla_referral_code/);
  assert.doesNotMatch([route, dispatch].join('\n'), /content_share_attribution_v1|claimContentShareAttribution/);
});

test('C6 analytics use only observed success vocabulary plus typed failure', () => {
  // [TEST-MOD-APPROVED #1615] The prior assertion blessed invented
  // `share_link_destination` success after a promise resolution.
  const sources = [
    read('app-mobile/src/components/ShareModal.tsx'),
    read('app-mobile/app/s/[code].tsx'),
    read('mingla-business/src/components/ui/ShareModal.tsx'),
  ].join('\n');
  for (const event of ['share_link_ready', 'share_sheet_opened', 'share_sheet_returned', 'share_native_opened', 'share_destination_action', 'share_failure', 'failure_type']) {
    assert.ok(sources.includes(event), event);
  }
  assert.doesNotMatch(sources, /['"]share_link_open['"]|share_link_destination|share_link_failure|['"]af_share['"]|trackExperienceShared/);
});

test('C7 exact eight-kind message grammar, budgets, planning, and sender-note position execute', () => {
  const code = 'Aa0Bb1Cc2Dd3Ee4F';
  const url = `https://usemingla.com/s/${code}`;
  const fixtures = [
    [{ schemaVersion: 1, kind: 'place', title: 'Namu', category: 'Korean', area: 'Durham' }, `How about Namu in Durham? Korean.\n\n${url}`],
    [{ schemaVersion: 1, kind: 'curated', title: 'Saturday in Durham', stopCount: 3, area: 'Downtown', duration: '4 hours' }, `Saturday in Durham is a 3-stop plan around Downtown. 4 hours.\n\n${url}`],
    [{ schemaVersion: 1, kind: 'event', title: 'Jazz Night', localDate: 'Sat, Aug 8', localTime: '8 PM', venue: 'The Yard' }, `Jazz Night is Sat, Aug 8 at 8 PM at The Yard.\n\n${url}`],
    [{ schemaVersion: 1, kind: 'rsvp_event', title: 'Studio Supper', localDate: 'Aug 12', localTime: '7 PM', venue: 'North Star' }, `Want to join Studio Supper? Aug 12 at 7 PM at North Star.\n\n${url}`],
    [{ schemaVersion: 1, kind: 'trip', title: 'Blue Ridge Weekend', destination: 'Asheville', dateRange: 'Sep 4–6', duration: '3 days' }, `Blue Ridge Weekend runs Sep 4–6 in Asheville. 3 days.\n\n${url}`],
    [{ schemaVersion: 1, kind: 'experience', title: 'Clay Workshop', area: 'Raleigh', duration: '2 hours' }, `How about Clay Workshop in Raleigh? 2 hours.\n\n${url}`],
    [{ schemaVersion: 1, kind: 'venue', title: 'The Fruit', category: 'Arts venue', area: 'Durham' }, `Check out The Fruit in Durham. Arts venue.\n\n${url}`],
    [{ schemaVersion: 1, kind: 'brand', title: 'Bull City Nights', category: 'Events', area: 'Durham', upcomingPublicOfferingCount: 4 }, `See what Bull City Nights has coming up in Durham. 4 upcoming.\n\n${url}`],
  ];
  for (const [facts, expected] of fixtures) assert.equal(sharing.buildShareMessage(facts, { shortCode: code }), expected);
  assert.equal(
    sharing.buildShareMessage({ schemaVersion: 1, kind: 'place', title: 'Namu' }, { shortCode: code, planningPreference: { dayOfWeek: 'weekend', timeOfDay: 'afternoon', planningTimeframe: 'this month' } }),
    `How about Namu? Maybe one weekend afternoon this month.\n\n${url}`,
  );
  assert.equal(
    sharing.buildShareMessage(fixtures[0][0], { shortCode: code, senderNote: '\u202e Meet me there ' }),
    `From the sender: Meet me there\nHow about Namu in Durham? Korean.\n\n${url}`,
  );
});

test('C7b curated estimates have one visible disclosure and reject reversed ranges', () => {
  assert.equal(sharing.formatEstimate('$20–$40'), 'Estimated $20–$40');
  assert.equal(sharing.formatEstimate('Approx. $20–$40'), 'Approx. $20–$40');
  assert.equal(sharing.formatEstimate('Estimated $20–$40'), 'Estimated $20–$40');
  assert.equal(sharing.formatEstimate('$100.00-$0.00'), '');
  const facts = sharing.parseShareFactsV1({ schemaVersion: 1, kind: 'curated', title: 'Durham day', estimate: '$20–$40' });
  assert.equal(facts.estimate, 'Estimated $20–$40');
  assert.deepEqual(sharing.selectPreviewFacts(facts), ['Estimated $20–$40']);
  assert.match(sharing.buildShareMessage(facts, { shortCode: 'Aa0Bb1Cc2Dd3Ee4F' }), /Estimated \$20–\$40\./);
});

test('C8 native receiver is 4:5 and validates every external action', () => {
  const route = read('app-mobile/app/s/[code].tsx');
  assert.match(route, /hero:\s*\{[^}]*aspectRatio:\s*4\s*\/\s*5/);
  assert.match(route, /validatedPublicActionUrl[\s\S]*cleanHttpsUrl[\s\S]*digits\.length\s*<\s*7[\s\S]*digits\.length\s*>\s*15/);
  assert.match(route, /const url = validatedPublicActionUrl\(kind, value\)[\s\S]*if \(url === null\)[\s\S]*Linking\.openURL\(url\)/);
  assert.match(route, /share\.media\s*===\s*null\s*\?\s*null\s*:\s*buildSharePortraitUrl\(share\.shortCode, share\.version\)/);
  assert.match(route, /share_destination_action[\s\S]*short_code:\s*share\.shortCode[\s\S]*outcome:\s*'pressed'[\s\S]*Linking\.openURL\(url\)/);
});

test('C9 Business retains the full binding state machine and exact portrait preview', () => {
  const source = read('mingla-business/src/components/ui/ShareModal.tsx');
  for (const state of ['idle', 'validating', 'creating', 'reusing', 'ready', 'opening', 'returned', 'error']) assert.ok(source.includes(`"${state}"`), state);
  assert.match(source, /preparedValueRef[\s\S]*preparedPromiseRef[\s\S]*actionPromiseRef/);
  assert.match(source, /preparedPreview\?\.s4Url[\s\S]*aspectRatio:\s*4\s*\/\s*5/);
  assert.match(source, /No image preview is available/);
  assert.doesNotMatch(source, /shareAsync\(/);
});

test('C10 Android adapters put the canonical URL in message exactly once', () => {
  const consumer = read('app-mobile/src/services/contentShareAdapter.ts');
  const businessTransport = read('mingla-business/src/utils/sharePublicUrl.ts');
  assert.match(consumer, /Platform\.OS==='android'[\s\S]{0,120}Share\.share\(\{title,message:prepared\.message\}\)/);
  assert.match(businessTransport, /stripUrlFromBody[\s\S]*buildAndroidPublicShareMessage[\s\S]*body\.includes\(url\)\s*\?\s*body\s*:\s*`\$\{body\}\\n\$\{url\}`/);
  const message = sharing.buildShareMessage({ schemaVersion: 1, kind: 'place', title: 'Namu' }, { shortCode: 'Aa0Bb1Cc2Dd3Ee4F' });
  assert.equal((message.match(/https:\/\/usemingla\.com\/s\/Aa0Bb1Cc2Dd3Ee4F/g) ?? []).length, 1);
});

test('C11 flag-off 503 rolls place/curated back to truthful returned /p data', async () => {
  const rollback = await import(pathToFileURL(path.join(ROOT, 'app-mobile/src/services/legacyContentShareRollback.ts')));
  assert.equal(rollback.isLegacyRollbackEligible({ context: { status: 503 } }), true);
  const shareId = 'a'.repeat(36);
  const fields = rollback.prepareLegacyPublicFields({
    kind: 'curated',
    title: 'Durham afternoon',
    metadata: { category: 'Food', location: 'Durham', price: 'Estimated $20–$40', description: 'Three real stops.' },
    stops: [
      { title: 'Namu', placeId: 'private-google-id' },
      { title: 'Museum', source_reference: 'private-source' },
      { title: 'Park' },
    ],
    source_ids: { savedCardId: 'private-card' },
    owner_profile_id: 'private-owner',
    attribution: { referralCode: 'private-referral' },
  }, `https://usemingla.com/p/${shareId}`, `https://usemingla.com/share/${shareId}.png`, 'curated', {
    planningPreference: { dayOfWeek: 'weekend', timeOfDay: 'afternoon', planningTimeframe: 'this month' },
  });
  assert.equal(fields.snapshot.title, 'Durham afternoon');
  assert.equal(fields.snapshot.stops.length, 3);
  assert.equal(fields.message, `Durham afternoon is a 3-stop plan.\nFood · Durham\nThree real stops.\nEstimated $20–$40\nStops: Namu; Museum; Park\nI was thinking one weekend afternoon this month.\n\nhttps://usemingla.com/p/${shareId}`);
  assert.equal(fields.s4Url, `https://usemingla.com/share/${shareId}.png`);
  assert.equal(fields.message.split(`https://usemingla.com/p/${shareId}`).length - 1, 1);
  const serialized = JSON.stringify(fields);
  for (const secret of ['private-google-id', 'private-source', 'private-card', 'private-owner', 'private-referral']) assert.doesNotMatch(serialized, new RegExp(secret));
  const reversed = rollback.prepareLegacyPublicFields({ kind:'curated', title:'Truth', metadata:{ price:'$100.00-$0.00' }, stops:[] }, `https://usemingla.com/p/${shareId}`, null, 'curated');
  assert.doesNotMatch(reversed.message,/\$100\.00|\$0\.00/);
  assert.throws(() => rollback.prepareLegacyPublicFields({ kind:'place', title:'Wrong port', metadata:{}, stops:[] }, `https://usemingla.com:8443/p/${shareId}`, null, 'place'), /legacy_share_invalid/);
  const adapter = read('app-mobile/src/services/contentShareAdapter.ts');
  assert.match(adapter, /kind !== 'place' && kind !== 'curated'/);
  assert.match(adapter, /createSharedCard\(\{[\s\S]*sourceIds:[\s\S]*attribution: \{ channel \}/);
  assert.match(adapter, /contract: 'legacy_shared_card'[\s\S]*legacySnapshot/);
  assert.doesNotMatch(adapter.match(/PreparedLegacyContentShare = \{([\s\S]*?)\n\};/)?.[1] ?? '', /shortCode|version|facts|media|destination|publicDetails/);
});

test('C12 fatal v1 failures cannot downgrade to legacy creation', async () => {
  const rollback = await import(pathToFileURL(path.join(ROOT, 'app-mobile/src/services/legacyContentShareRollback.ts')));
  for (const status of [400, 401, 403, 404, 409, 410, 422]) {
    assert.equal(rollback.isLegacyRollbackEligible({ context: { status } }), false, String(status));
  }
  assert.equal(rollback.isLegacyRollbackEligible(new Error('share_create_failed')), false);
  assert.equal(rollback.isLegacyRollbackEligible({ name: 'FunctionsFetchError', message: 'Failed to send a request to the Edge Function' }), true);
  assert.equal(rollback.isLegacyRollbackEligible({ name: 'FunctionsRelayError', message: 'Relay Error invoking the Edge Function' }), true);
  const adapter = read('app-mobile/src/services/contentShareAdapter.ts');
  assert.match(adapter, /!isLegacyRollbackEligible\(error, response\?\.status\)[\s\S]*throw new Error/);
  assert.match(read('app-mobile/src/components/ShareModal.tsx'), /setShareState\('error'\)[\s\S]*Retry preview/);
});

test('C13 opaque installed-direct state activates once after identity and malformed state fails closed', async () => {
  const attribution = await import(pathToFileURL(path.join(ROOT, 'app-mobile/src/services/contentShareAttribution.ts')));
  const values = new Map();
  const storage = {
    async getItem(key) { return values.get(key) ?? null; },
    async setItem(key, value) { values.set(key, value); },
    async removeItem(key) { values.delete(key); },
  };
  const events = [];
  const capture = (event, properties) => events.push({ event, properties });
  const state = { shortCode: 'Aa0Bb1Cc2Dd3Ee4F', version: 7 };

  // Signed-out open writes only opaque state; later authenticated consumption
  // emits the approved event and deletes before a second attempt can fire.
  assert.equal(await attribution.persistContentShareAttribution(storage, state), true);
  assert.equal(events.length, 0);
  assert.equal(await attribution.consumeContentShareAttributionAfterIdentity(storage, capture), 'consumed');
  assert.equal(values.has(attribution.CONTENT_SHARE_ATTRIBUTION_KEY), false);
  assert.deepEqual(events, [{ event: 'share_native_opened', properties: {
    short_code: state.shortCode,
    version: 7,
    recipient_app: 'consumer',
    recipient_surface: 'native_content_share',
    outcome: 'identified_activation',
  } }]);
  assert.equal(await attribution.consumeContentShareAttributionAfterIdentity(storage, capture), 'empty');
  assert.equal(events.length, 1);

  // Already-identified roots subscribe for a later /s write. Its existing
  // resolved event remains separate and valid; this adds no new event name.
  let identifiedConsume;
  const unsubscribe = attribution.subscribeContentShareAttributionWrites(() => {
    identifiedConsume = attribution.consumeContentShareAttributionAfterIdentity(storage, capture);
  });
  await attribution.persistContentShareAttribution(storage, { ...state, version: 8 });
  assert.ok(identifiedConsume);
  assert.equal(await identifiedConsume, 'consumed');
  unsubscribe();
  assert.equal(events.length, 2);
  const route = read('app-mobile/app/s/[code].tsx');
  assert.match(route, /share_native_opened[\s\S]*outcome: 'resolved'/);

  values.set(attribution.CONTENT_SHARE_ATTRIBUTION_KEY, JSON.stringify({ ...state, version: 9, referralCode: 'RAW-REF' }));
  assert.equal(await attribution.consumeContentShareAttributionAfterIdentity(storage, capture), 'malformed');
  assert.equal(values.has(attribution.CONTENT_SHARE_ATTRIBUTION_KEY), false);
  assert.equal(events.length, 2);
  const root = read('app-mobile/app/index.tsx');
  assert.match(root, /mixpanelService\.trackLogin[\s\S]*consumeContentShareAttributionAfterIdentity\(AsyncStorage/);
  assert.doesNotMatch(read('app-mobile/src/services/contentShareAttribution.ts'), /referral|reward|claim/i);
});
