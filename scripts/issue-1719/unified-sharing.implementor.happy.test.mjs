/**
 * #1719 implementor happy-path oracle.
 * FAILS-ON-REVERT: provider routing, immutable server message, atomic delivery,
 * poster triplets, or Business platform split each have an independent pin.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { assertCoverWriterInventory, scanCoverWriters } from './cover-poster-writer-gate.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8');
const require = createRequire(import.meta.url);
const sharing = require(path.join(ROOT, 'packages/sharing'));

const factsByKind = {
  place: { schemaVersion:1,kind:'place',title:'Yonder Coffee',category:'Coffee shop',area:'Durham',rating:4.6,route:{placeId:'ChIJ-test'} },
  curated: { schemaVersion:1,kind:'curated',title:'Durham afternoon',stopCount:3,area:'Durham',duration:'3 hours' },
  event: { schemaVersion:1,kind:'event',title:'Jazz night',localDate:'Aug 20',localTime:'7 PM',venue:'The Room',route:{eventSlug:'jazz'} },
  rsvp_event: { schemaVersion:1,kind:'rsvp_event',title:'Rooftop mixer',localDate:'Aug 21',venue:'The Roof',route:{eventSlug:'mixer'} },
  trip: { schemaVersion:1,kind:'trip',title:'Blue Ridge weekend',destination:'Asheville',dateRange:'Aug 22–24',route:{eventSlug:'ridge'} },
  experience: { schemaVersion:1,kind:'experience',title:'Pottery class',area:'Durham',nextDate:'Aug 23',route:{eventSlug:'pottery'} },
  venue: { schemaVersion:1,kind:'venue',title:'The Patio',category:'Bar',area:'Durham',route:{brandSlug:'patio',venueSlug:'durham'} },
  brand: { schemaVersion:1,kind:'brand',title:'Bull City Events',category:'Events',area:'Durham',upcomingPublicOfferingCount:2,route:{brandSlug:'bull-city'} },
};

test('H1 all eight kinds produce concise truthful text with exactly one short link', () => {
  for (const [kind, facts] of Object.entries(factsByKind)) {
    const message = sharing.buildShareMessage(facts, { shortCode:'Aa0Bb1Cc2Dd3Ee4F', channel:'generic' });
    assert.equal((message.match(/https:\/\/usemingla\.com\/s\/Aa0Bb1Cc2Dd3Ee4F/g) ?? []).length, 1, kind);
    assert.doesNotMatch(message, /\/p\/|app\.appsflyersdk\.com|business\.usemingla\.com/, kind);
    assert.match(message, new RegExp(facts.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), kind);
  }
});

test('H2 the 120-grapheme law preserves emoji families, flags, modifiers and combining marks', () => {
  const clusters = ['👨‍👩‍👧‍👦', '🇧🇪', '👍🏿', 'e\u0301'];
  assert.equal(sharing.segmentGraphemes(clusters.join('')).length, 4);
  const exact = clusters[0].repeat(117) + clusters.slice(1).join('');
  assert.equal(sharing.normalizeContentShareNote(exact).graphemeCount, 120);
  const clipped = sharing.normalizeContentShareNote(exact + 'x');
  assert.equal(clipped.graphemeCount, 120);
  assert.equal(clipped.note, exact.normalize('NFC'));
});

test('H3 Consumer opens synchronously and keeps preparation and recipients independent', () => {
  const provider = read('app-mobile/src/components/share/UnifiedShareProvider.tsx');
  const open = provider.slice(provider.indexOf('const openContentShare'), provider.indexOf('useEffect(() => { registerContentShareHandler'));
  assert.ok(open.indexOf('setVisible(true)') < open.indexOf('loadShare(nextInput, token)'));
  assert.ok(open.indexOf('setVisible(true)') < open.indexOf('loadRecipients(token)'));
  assert.match(provider, /Share elsewhere[\s\S]*Send in Mingla/);
  assert.match(provider, /Friend · chat starts when sent/);
  assert.match(provider, /Couldn't send yet\. Nothing was duplicated\./);
  assert.doesNotMatch(provider, /WhatsApp|Instagram|Twitter|Copy message|s4Url/);
});

test('H4 one immutable server message feeds external and degraded internal delivery', () => {
  const migration = read('supabase/migrations/20270227001719_issue_1719_unified_content_sharing.sql');
  const edge = read('supabase/functions/_shared/contentShareService.ts');
  const consumer = read('app-mobile/src/services/contentShareAdapter.ts');
  const business = read('mingla-business/src/services/contentShareAdapter.ts');
  assert.match(migration, /content_share_versions ADD COLUMN IF NOT EXISTS message_text/);
  assert.match(migration, /v_content:=concat_ws\([\s\S]*v_version\.message_text/);
  assert.match(migration, /resolve_content_share_message[\s\S]*SELECT v\.message_text/);
  assert.match(edge, /resolve_content_share_message/);
  assert.match(consumer, /message:\s*data\.message/);
  assert.match(business, /message:\s*data\.message/);
  assert.doesNotMatch(consumer + business, /buildShareMessage\s*\(/);
});

test('H5 delivery is authenticated, commit-only, atomic per target and idempotent under concurrency', () => {
  const sql = read('supabase/migrations/20270227001719_issue_1719_unified_content_sharing.sql');
  const service = read('app-mobile/src/services/contentShareDeliveryService.ts');
  assert.match(sql, /v_sender uuid := auth\.uid\(\)/);
  assert.match(sql, /pg_advisory_xact_lock\(hashtextextended\(v_sender::text\|\|':'\|\|p_operation_id/);
  assert.match(sql, /CONSTRAINT content_share_message_deliveries_idempotency UNIQUE/);
  assert.ok(sql.indexOf('SELECT * INTO v_existing') > sql.indexOf('pg_advisory_xact_lock'));
  assert.match(sql, /idempotency_identity_mismatch/);
  assert.match(sql, /blocked_users/);
  assert.match(sql, /can_insert_message_into_conversation/);
  assert.match(service, /beginContentShareOperation/);
  assert.match(service, /p_sender_note_grapheme_count: note\.graphemeCount/);
});

test('H6 every production cover writer discovered by rule carries a stable poster', () => {
  assert.deepEqual(assertCoverWriterInventory(scanCoverWriters(ROOT)), { violations: 0 });
  const picker = read('mingla-business/src/components/ui/CoverPicker.tsx');
  const eventWriter = read('mingla-business/src/services/eventCoverMediaService.ts');
  assert.match(picker, /extractCoverGifPoster/);
  assert.match(picker, /processedPosterUrl/);
  assert.match(eventWriter, /stablePosterUrl === null[\s\S]*fallback image is missing or invalid/);
  assert.match(eventWriter, /data\.cover_media_poster_url !== stablePosterUrl/);
  const migration = read('supabase/migrations/20270227001719_issue_1719_unified_content_sharing.sql');
  assert.match(migration, /assert_cover_media_triplet/);
  assert.match(migration, /biz_create_venue_listing[\s\S]*p_cover_media_poster_url/);
  assert.match(migration, /CASE WHEN v_type='image' THEN v_url END/);
  assert.match(migration, /v_has_cover:=p_payload \? 'cover'[\s\S]*UPDATE public\.events SET cover_media_poster_url=v_poster/);
  assert.match(migration, /biz_create_venue_brand_authoring[\s\S]*venue_creation_moved:update_app/);
});

test('H7 Mingla chat uses a static rich card and opens the exact immutable share', () => {
  const bubble = read('app-mobile/src/components/chat/MessageBubble.tsx');
  const messages = read('app-mobile/src/services/messagingService.ts');
  const surface = bubble.slice(bubble.indexOf('if (isContentShareCardPayload(payload))'), bubble.indexOf('// ORCH-0908: defensive legacy-payload'));
  assert.match(messages, /contract: 'content_share_card_v1'/);
  assert.match(surface, /contentSharePoster/);
  assert.match(surface, /GIF' : 'Video'/);
  assert.doesNotMatch(surface, /VideoView|expo-video|autoPlay|shouldPlay|play-circle/);
  assert.match(read('app-mobile/src/components/MessageInterface.tsx'), /router\.push\(`\/s\/\$\{payload\.shareCode\}`/);
});

test('H8 Business is native Share/Copy and web Share/Copy/QR without provider buttons', () => {
  const modal = read('mingla-business/src/components/ui/ShareModal.tsx');
  assert.match(modal, /canWebShare\(\)/);
  assert.match(modal, /Platform\.OS === 'web'/);
  assert.match(modal, /QRCode value=\{prepared\.url\}/);
  assert.match(modal, /copyPublicUrl\(prepared\.url\)/);
  assert.doesNotMatch(modal, /WhatsApp|Twitter|Instagram|Copy message|raw URL/);
});

test('H9 Consumer and Business ship the same new runtime version', () => {
  const consumer = JSON.parse(read('app-mobile/app.json')).expo.version;
  const business = JSON.parse(read('mingla-business/app.json')).expo.version;
  assert.equal(consumer, '1.1.3');
  assert.equal(business, consumer);
});
