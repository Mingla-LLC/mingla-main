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

const ROOT = process.env.ISSUE_1719_ROOT
  ? path.resolve(process.env.ISSUE_1719_ROOT)
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
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

test('H10 delivery rejects revoked and deleted links at the mutation boundary', () => {
  const migration = read('supabase/migrations/20270227001719_issue_1719_unified_content_sharing.sql');
  const send = migration.slice(
    migration.indexOf('CREATE OR REPLACE FUNCTION public.send_content_share_message'),
    migration.indexOf('REVOKE ALL ON FUNCTION public.send_content_share_message'),
  );
  assert.match(send, /v_link\.revoked_at IS NOT NULL/);
  assert.match(send, /v_link\.deleted_at IS NOT NULL/);
  assert.match(send, /RAISE EXCEPTION 'share_unavailable'/);
});

test('H11 restored operations reconcile exact live targets and zero-target sends cannot succeed', () => {
  const service = read('app-mobile/src/services/contentShareDeliveryService.ts');
  const provider = read('app-mobile/src/components/share/UnifiedShareProvider.tsx');
  assert.match(service, /reconcileContentShareOperation/);
  assert.match(service, /recipient\?\.targetKind === target\.targetKind && recipient\.targetId === target\.targetId/);
  assert.match(service, /if \(input\.recipients\.length === 0\) throw new Error\('no_available_recipients'\)/);
  assert.match(provider, /if \(!prepared \|\| !recipientsReady\) return/);
  assert.match(provider, /reconcileContentShareOperation\(operation, recipients\)/);
  assert.match(provider, /reconciled\.targets\.filter\(\(target\) => target\.state !== 'sent'\)/);
  const send = provider.slice(provider.indexOf('const send = useCallback'), provider.indexOf('const finishSuccess'));
  assert.ok(send.indexOf('if (targets.length === 0)') < send.indexOf('sendContentShareToRecipients'));
  assert.ok(send.indexOf("setOutcome({ kind: 'success'") > send.indexOf('sendContentShareToRecipients'));
});

test('H12 offline mode preserves prepared external actions and disables only internal send', () => {
  const provider = read('app-mobile/src/components/share/UnifiedShareProvider.tsx');
  assert.match(provider, /useNetInfo\(\)/);
  assert.match(provider, /isConnected === false \|\| netInfo\.isInternetReachable === false/);
  assert.match(provider, /You're offline\. Reconnect to send in Mingla\./);
  assert.match(provider, /disabled=\{!prepared \|\| selected\.size === 0 \|\| sending \|\| isOffline\}/);
  const external = provider.slice(provider.indexOf('<Text style={styles.sectionTitle}>Share elsewhere'), provider.indexOf('{externalError ?'));
  assert.doesNotMatch(external, /isOffline/);
  assert.doesNotMatch(provider, /cached.*(?:shortCode|canonicalUrl)|fabricat/i);
});

test('H13 Business web traps focus, closes on idle Escape, returns focus, and preserves exact actions', () => {
  const modal = read('mingla-business/src/components/ui/ShareModal.tsx');
  const dialogStart = modal.indexOf('<View ref={dialogRef}');
  const dialogOpenTag = modal.slice(dialogStart, modal.indexOf('>', dialogStart) + 1);
  assert.match(modal, /const invokingControl = documentValue\.activeElement/);
  assert.match(modal, /event\.key === 'Escape' && !busyRef\.current/);
  assert.match(modal, /event\.key !== 'Tab'/);
  assert.match(modal, /last\.focus\?\.\(\)/);
  assert.match(modal, /invokingControl\?\.focus\?\.\(\)/);
  assert.match(modal, /canWebShare\(\) \? <Pressable/);
  assert.match(modal, /copyPublicUrl\(prepared\.url\)/);
  assert.match(modal, /QRCode value=\{prepared\.url\}/);
  assert.match(modal, /accessibilityViewIsModal/);
  assert.match(dialogOpenTag, /role=\{Platform\.OS === 'web' \? 'dialog' : undefined\}/);
  assert.match(dialogOpenTag, /aria-modal=\{Platform\.OS === 'web' \? true : undefined\}/);
  assert.doesNotMatch(dialogOpenTag, /\saccessible(?:\s|=)/);
});

test('H14 summaries honor status-first hierarchy and Consumer search has an icon', () => {
  const consumer = read('app-mobile/src/components/share/UnifiedShareProvider.tsx');
  const business = read('mingla-business/src/components/ui/ShareModal.tsx');
  for (const source of [consumer, business]) {
    const summary = source.slice(source.indexOf('<View style={styles.summary}>'), source.indexOf('</View>\n      {prep', source.indexOf('<View style={styles.summary}>')));
    assert.ok(summary.indexOf('status') < summary.indexOf('prepared?.title'));
    assert.ok(summary.indexOf('prepared?.title') < summary.lastIndexOf('facts'));
    assert.match(summary, /numberOfLines=\{2\}/);
  }
  assert.match(consumer, /<Icon name="search-outline"/);
  assert.match(consumer, /accessibilityLabel="Search people and chats"/);
});

test('H15 telemetry failures are isolated and preparation/poster timings are complete', () => {
  const consumerAdapter = read('app-mobile/src/services/contentShareAdapter.ts');
  const businessAdapter = read('mingla-business/src/services/contentShareAdapter.ts');
  const consumer = read('app-mobile/src/components/share/UnifiedShareProvider.tsx');
  const business = read('mingla-business/src/components/ui/ShareModal.tsx');
  assert.match(consumerAdapter, /try \{ mixpanelService\.track/);
  assert.match(consumerAdapter, /try \{ logAppsFlyerEvent/);
  assert.match(businessAdapter, /try\{postHogService\.capture/);
  assert.match(businessAdapter, /try\{captureWeb/);
  assert.match(businessAdapter, /try\{logAppsFlyerEvent/);
  assert.match(business, /share_link_ready'[\s\S]*result_class: 'ready'[\s\S]*duration_ms/);
  assert.match(business, /failure_type: 'prepare'[\s\S]*result_class: 'failed'[\s\S]*duration_ms/);
  for (const source of [consumer, business]) {
    assert.match(source, /share_poster_result'[\s\S]*result_class: 'ready'[\s\S]*duration_ms/);
    assert.match(source, /share_poster_result'[\s\S]*result_class: 'failed'[\s\S]*duration_ms/);
  }
});

test('H16 safe-area, accessibility-size, and recipient-state contracts are explicit', () => {
  const consumer = read('app-mobile/src/components/share/UnifiedShareProvider.tsx');
  const business = read('mingla-business/src/components/ui/ShareModal.tsx');
  const businessSheet = read('mingla-business/src/components/ui/SheetMobile.tsx');
  assert.match(consumer, /paddingBottom: Math\.max\(insets\.bottom, 12\)/);
  assert.match(businessSheet, /paddingBottom: spacing\.lg \+ bottomInset/);
  // [TEST-MOD-APPROVED #1719] Written reason: the second orchestrator review restored the binding
  // 92px/64×72 compact geometry and responsive `Share {title}` header, so the prior plain-Share
  // assertions were wrong at standard text sizes and must now pin both standard and accessibility modes.
  for (const source of [consumer, business]) {
    assert.match(source, /const shareHeading = prepared && fontScale < 1\.4 \? `Share \$\{prepared\.title\}` : 'Share'/);
    assert.match(source, /<Text numberOfLines=\{1\} ellipsizeMode="tail" style=\{styles\.heading\}>\{shareHeading\}<\/Text>/);
    assert.match(source, /summary:\{minHeight:92/);
    assert.match(source, /posterWrap:\{width:64,height:72/);
    assert.match(source, /poster:\{width:64,height:72/);
    assert.match(source, /posterSkeleton:\{width:64,height:72/);
    assert.doesNotMatch(source, /summary:\{minHeight:104|poster(?:Wrap|Skeleton)?:\{width:64,height:80/);
  }
  assert.match(consumer, /posterFallback:\{width:64,height:72/);
  assert.match(business, /noCover:\{width:64,height:72/);
  assert.match(business, /useColorScheme\(\) === 'dark'/);
  assert.match(business, /createStyles\(dark\)/);
  assert.match(business, /const surface = dark \? '#17191F' : '#F9FAFB'/);
  assert.match(business, /const primary = dark \? 'rgba\(255,255,255,\.96\)' : '#111827'/);
  assert.match(business, /const error = dark \? '#FCA5A5' : '#B91C1C'/);
  assert.match(consumer, /accessibilityLabel=\{`\$\{recipient\.displayName\}\. \$\{stateLabel\}`\}/);
  assert.match(consumer, /accessibilityState=\{\{ checked: active, disabled: sent \|\| sending \}\}/);
  assert.match(consumer, /disabled=\{sent \|\| sending\}/);
});

test('H17 one shared compact-fact selector gives status precedence for all eight kinds', () => {
  const duplicateFieldByKind = {
    place: { category:'Sold out' },
    curated: { duration:'Sold out' },
    event: { availability:'Sold out' },
    rsvp_event: { availability:'Sold out' },
    trip: { duration:'Sold out' },
    experience: { availability:'Sold out' },
    venue: { category:'Sold out' },
    brand: { category:'Sold out' },
  };
  for (const [kind, facts] of Object.entries(factsByKind)) {
    const statusFacts = { ...facts, status:'sold_out', ...duplicateFieldByKind[kind] };
    assert.equal(sharing.statusLabel(statusFacts.status), 'Sold out', kind);
    assert.equal(sharing.selectCompactPreviewFacts(statusFacts, 4).includes('Sold out'), false, kind);
  }
  for (const relative of [
    'app-mobile/src/components/share/UnifiedShareProvider.tsx',
    'app-mobile/src/components/chat/MessageBubble.tsx',
    'mingla-business/src/components/ui/ShareModal.tsx',
  ]) {
    const source = read(relative);
    assert.match(source, /selectCompactPreviewFacts/);
    assert.doesNotMatch(source, /selectPreviewFacts/);
  }
});

test('H18 headings are truly centered, Business owns its panel theme, and visible actions expose button roles', () => {
  const consumer = read('app-mobile/src/components/share/UnifiedShareProvider.tsx');
  const business = read('mingla-business/src/components/ui/ShareModal.tsx');
  for (const source of [consumer, business]) {
    assert.match(source, /header:\{minHeight:60,alignItems:'center',justifyContent:'center',paddingHorizontal:60/);
    assert.match(source, /heading:\{width:'100%'[^}]*textAlign:'center'/);
    assert.match(source, /closeTarget:\{position:'absolute',right:8,width:44,height:44/);
  }
  assert.match(business, /const panelBackground = dark \? '#0C0E12' : '#FFFFFF'/);
  assert.match(business, /<Sheet[\s\S]*?panelBackground=\{panelBackground\}/);
  assert.match(business, /canWebShare\(\) \? <Pressable accessibilityRole="button"/);
  assert.match(business, /<Pressable accessibilityRole="button" accessibilityLabel=\{copied/);
  assert.match(business, /Platform\.OS === 'web' \? <Pressable accessibilityRole="button" accessibilityLabel=\{showQr/);
  assert.match(business, /<Pressable accessibilityRole="button" onPress=\{prepare\}>/);
  assert.match(consumer, /<Pressable accessibilityRole="button" onPress=\{\(\) => loadRecipients/);
  assert.match(consumer, /<Pressable accessibilityRole="button" onPress=\{\(\) => setSearch\(''\)\}>/);
});
