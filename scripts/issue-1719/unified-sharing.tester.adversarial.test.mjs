/**
 * #1719 independent tester adversarial oracle.
 *
 * Distinct from the implementor happy path: this suite attacks hostile RPC
 * identities, authorization/grant boundaries, same-flight canonicalization,
 * poisoned media, raw transport bypasses, and accessibility/responsive laws.
 *
 * FAILS-ON-REVERT: restoring the pre-#1719 animated-cover fallback in
 * supabase/functions/_shared/contentShare.ts changes TA4 from green to red
 * because the authoritative stored poster is no longer served.
 * Live probes run only with ISSUE_1719_LIVE=1; CI pins the corresponding source
 * config and auth guards without making production availability a PR dependency.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { mapServedMediaIdentity } from '../../supabase/functions/_shared/contentShare.ts';
import { validatePublicContentShareEnvelope } from '../../supabase/functions/_shared/contentShareService.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8');
const require = createRequire(import.meta.url);
const migration = read('supabase/migrations/20270227001719_issue_1719_unified_content_sharing.sql');
const consumer = read('app-mobile/src/components/share/UnifiedShareProvider.tsx');
const business = [
  read('mingla-business/src/components/ui/ShareModal.tsx'),
  read('mingla-business/src/components/ui/ShareModalContent.tsx'),
].join('\n');

function sqlFunction(name, nextMarker) {
  const start = migration.indexOf(`CREATE OR REPLACE FUNCTION public.${name}`);
  assert.notEqual(start, -1, `${name} definition missing`);
  const end = migration.indexOf(nextMarker, start);
  assert.notEqual(end, -1, `${name} terminator missing`);
  return migration.slice(start, end);
}

const sendSql = sqlFunction(
  'send_content_share_message',
  'REVOKE ALL ON FUNCTION public.send_content_share_message',
);
const listSql = sqlFunction(
  'list_content_share_recipients',
  'REVOKE ALL ON FUNCTION public.list_content_share_recipients',
);

test('TA1 malicious delivery payloads cannot forge sender, snapshot, target permission, or note identity', () => {
  const signature = sendSql.slice(0, sendSql.indexOf(') RETURNS jsonb'));
  assert.doesNotMatch(signature, /p_(?:(?:sender|user)_id|facts|media|destination|title|message(?:_text)?)(?:\s|,|$)/i);
  assert.match(sendSql, /v_sender uuid := auth\.uid\(\)/);
  assert.match(sendSql, /IF v_sender IS NULL THEN RAISE EXCEPTION 'authentication_required'/);
  assert.match(sendSql, /p_operation_id IS NULL OR p_target_id IS NULL/);
  assert.match(sendSql, /p_target_kind NOT IN \('direct','group','friend'\)/);
  assert.match(sendSql, /p_short_code !~ '\^\[0-9A-Za-z\]\{16\}\$'/);
  assert.match(sendSql, /p_share_version < 1/);
  assert.match(sendSql, /p_sender_note_grapheme_count IS NULL/);
  assert.match(sendSql, /p_sender_note_grapheme_count NOT BETWEEN 0 AND 120/);
  assert.match(sendSql, /char_length\(COALESCE\(v_note,''\)\) > 480/);
  assert.match(sendSql, /octet_length\(COALESCE\(v_note,''\)\) > 2048/);
  assert.match(sendSql, /idempotency_identity_mismatch/);
  assert.match(sendSql, /v_existing\.short_code<>p_short_code/);
  assert.match(sendSql, /v_existing\.share_version<>p_share_version/);
  assert.match(sendSql, /COALESCE\(v_existing\.sender_note,''\)<>COALESCE\(v_note,''\)/);
  assert.match(sendSql, /v_existing\.sender_note_grapheme_count<>p_sender_note_grapheme_count/);
  assert.doesNotMatch(sendSql, /\bEXECUTE\b|format\s*\(/i);

  assert.match(sendSql, /v_version\.facts->>'title'/);
  assert.match(sendSql, /'facts',v_version\.facts/);
  assert.match(sendSql, /'destination',v_version\.destination_manifest-'publicDetails'/);
  assert.match(sendSql, /'media',v_version\.media_identity/);
  assert.doesNotMatch(sendSql, /p_facts|p_media_identity|p_destination_manifest/);
});

test('TA2 revoked, deleted, expired, blocked, inactive, and unauthorized recipients fail closed without privacy detail', () => {
  assert.match(sendSql, /v_link\.state<>'active'/);
  assert.match(sendSql, /v_link\.current_version<>p_share_version/);
  assert.match(sendSql, /v_link\.revoked_at IS NOT NULL/);
  assert.match(sendSql, /v_link\.deleted_at IS NOT NULL/);
  assert.match(sendSql, /v_link\.expires_at IS NOT NULL AND v_link\.expires_at<=now\(\)/);
  assert.match(sendSql, /RAISE EXCEPTION 'share_unavailable'/);
  assert.match(sendSql, /EXISTS \(SELECT 1 FROM public\.conversation_participants cp[\s\S]*cp\.user_id=v_sender\)/);
  assert.match(sendSql, /public\.can_insert_message_into_conversation\(c\.id,v_sender\)/);
  assert.match(sendSql, /c\.linked_entity_type<>'support'/);
  assert.match(sendSql, /v_other=v_sender/);
  assert.match(sendSql, /public\.profiles p WHERE p\.id=v_other AND p\.active IS TRUE/);
  assert.match(sendSql, /public\.blocked_users b WHERE \(b\.blocker_id=v_sender AND b\.blocked_id=v_other\) OR \(b\.blocker_id=v_other AND b\.blocked_id=v_sender\)/);
  assert.match(sendSql, /f\.status='accepted' AND f\.deleted_at IS NULL/);
  assert.match(sendSql, /RAISE EXCEPTION 'target_unavailable'/);
  assert.doesNotMatch(sendSql, /blocked_by|blocker_id'|blocked_id'|friendship_required/);

  assert.match(listSql, /other\.user_id <> caller\.uid/);
  assert.match(listSql, /p\.active IS TRUE/g);
  assert.match(listSql, /NOT EXISTS \(SELECT 1 FROM blocks/);
  assert.match(listSql, /c\.linked_entity_type <> 'support'/);
  assert.match(listSql, /public\.can_insert_message_into_conversation\(c\.id,caller\.uid\)/);
  assert.match(listSql, /f\.status='accepted' AND f\.deleted_at IS NULL/);
  assert.match(listSql, /NOT EXISTS \(SELECT 1 FROM direct_rows d WHERE d\.person_user_id=p\.id\)/);
});

test('TA3 delivery ledger and RPC grants resist anon, cross-user, and direct-write bypasses', () => {
  const ledgerStart = migration.indexOf('CREATE TABLE public.content_share_message_deliveries');
  const ledgerEnd = migration.indexOf('CREATE OR REPLACE FUNCTION public.list_content_share_recipients', ledgerStart);
  const ledger = migration.slice(ledgerStart, ledgerEnd);
  assert.match(ledger, /ENABLE ROW LEVEL SECURITY/);
  assert.match(ledger, /FORCE ROW LEVEL SECURITY/);
  assert.match(ledger, /REVOKE ALL ON public\.content_share_message_deliveries FROM PUBLIC, anon, authenticated/);
  assert.match(ledger, /GRANT SELECT ON public\.content_share_message_deliveries TO authenticated/);
  assert.match(ledger, /CREATE POLICY content_share_message_deliveries_sender_read[\s\S]*FOR SELECT TO authenticated[\s\S]*USING \(sender_id = auth\.uid\(\)\)/);
  assert.equal((ledger.match(/CREATE POLICY/g) ?? []).length, 1, 'no direct INSERT/UPDATE/DELETE policy may exist');

  assert.match(migration, /REVOKE ALL ON FUNCTION public\.list_content_share_recipients\(\) FROM PUBLIC, anon/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.list_content_share_recipients\(\) TO authenticated, service_role/);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.send_content_share_message\(uuid,text,uuid,text,integer,text,integer\) FROM PUBLIC, anon/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.send_content_share_message\(uuid,text,uuid,text,integer,text,integer\) TO authenticated, service_role/);
  for (const source of [listSql, sendSql]) {
    assert.match(source, /SECURITY DEFINER/);
    assert.match(source, /SET search_path = public, pg_temp/);
  }
});

test('TA4 served media and public envelopes reject poisoned hosts, credentials, ports, and private fields', () => {
  const safeImage = 'https://gqnoajqerqhnvulmnyvv.supabase.co/storage/v1/object/public/covers/good.jpg';
  const safeVideo = 'https://vz-a16fce08-6c6.b-cdn.net/video/play_720p.mp4';
  const safePoster = 'https://vz-a16fce08-6c6.b-cdn.net/video/thumbnail.jpg';

  assert.equal(mapServedMediaIdentity({
    cover_media_url: safeVideo,
    cover_media_type: 'video',
    cover_media_poster_url: 'https://attacker.example/poster.jpg',
    title: 'Poisoned video',
  }), null);
  assert.equal(mapServedMediaIdentity({
    cover_media_url: 'https://usemingla.com:444/cover.jpg',
    cover_media_type: 'image',
    cover_media_poster_url: 'https://usemingla.com:444/cover.jpg',
  }), null);
  assert.equal(mapServedMediaIdentity({
    cover_media_url: 'https://mingla:secret@usemingla.com/cover.jpg',
    cover_media_type: 'image',
    cover_media_poster_url: 'https://mingla:secret@usemingla.com/cover.jpg',
  }), null);
  assert.deepEqual(mapServedMediaIdentity({
    cover_media_url: 'https://attacker.example/cover.jpg',
    cover_media_type: 'image',
    profile_photo_url: safeImage,
    title: 'Safe fallback',
  }), { kind:'photo', url:safeImage, posterUrl:safeImage, alt:'Safe fallback' });
  assert.deepEqual(mapServedMediaIdentity({
    cover_media_url: safeVideo,
    cover_media_type: 'video',
    cover_media_poster_url: safePoster,
    title: 'Safe video',
  }), { kind:'video', url:safeVideo, posterUrl:safePoster, alt:'Safe video' });

  const baseEnvelope = {
    state:'active', gone:false, shortCode:'Aa0Bb1Cc2Dd3Ee4F', version:1,
    facts:{ schemaVersion:1, kind:'place', title:'Yonder Coffee', route:{ placeId:'ChIJ-test' } },
    media:null,
    destination:{ kind:'place', placeId:'ChIJ-test' },
    publicDetails:{ kind:'place' },
  };
  assert.ok(validatePublicContentShareEnvelope(baseEnvelope));
  for (const poisoned of [
    { ...baseEnvelope, senderNote:'private note' },
    { ...baseEnvelope, recipientId:'private recipient' },
    { ...baseEnvelope, source_reference:{ private:'id' } },
    { ...baseEnvelope, destination:{ ...baseEnvelope.destination, email:'private@example.com' } },
    { ...baseEnvelope, publicDetails:{ ...baseEnvelope.publicDetails, referralCode:'private' } },
  ]) assert.equal(validatePublicContentShareEnvelope(poisoned), null);
});

function loadDeliveryHarness() {
  const typescript = require(path.join(ROOT, 'app-mobile/node_modules/typescript'));
  const output = typescript.transpileModule(read('app-mobile/src/services/contentShareDeliveryService.ts'), {
    compilerOptions: {
      module: typescript.ModuleKind.CommonJS,
      target: typescript.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
    fileName: 'contentShareDeliveryService.ts',
  }).outputText;
  const storage = new Map();
  const asyncStorage = {
    getItem: (key) => {
      const snapshot = storage.get(key) ?? null;
      return new Promise((resolve) => setImmediate(() => resolve(snapshot)));
    },
    setItem: async (key, value) => { storage.set(key, value); },
    removeItem: async (key) => { storage.delete(key); },
  };
  const rpcCalls = [];
  const supabase = {
    rpc: async (name, args) => {
      assert.equal(name, 'send_content_share_message');
      rpcCalls.push(args);
      return {
        data:{ deliveryId:`d-${rpcCalls.length}`, conversationId:'c-1', messageId:`m-${rpcCalls.length}`, inserted:false },
        error:null,
      };
    },
  };
  const moduleValue = { exports:{} };
  const localRequire = (specifier) => {
    if (specifier === '@react-native-async-storage/async-storage') return { __esModule:true, default:asyncStorage };
    if (specifier === '@mingla/sharing') return require(path.join(ROOT, 'packages/sharing'));
    if (specifier === './supabase') return { supabase };
    throw new Error(`unexpected dependency: ${specifier}`);
  };
  vm.runInNewContext(output, {
    module:moduleValue, exports:moduleValue.exports, require:localRequire,
    console, crypto:globalThis.crypto, setImmediate,
  }, { filename:'contentShareDeliveryService.js' });
  return { service:moduleValue.exports, rpcCalls };
}

test('TA5 normalized notes and shuffled recipients share one flight; a hostile listener cannot split it', async () => {
  const harness = loadDeliveryHarness();
  const alex = { key:'person:alex',targetKind:'friend',targetId:'user-alex',personUserId:'user-alex',displayName:'Alex',username:null,avatarUrl:null,conversationId:null,participantCount:null };
  const sam = { key:'person:sam',targetKind:'friend',targetId:'user-sam',personUserId:'user-sam',displayName:'Sam',username:null,avatarUrl:null,conversationId:null,participantCount:null };
  let hostileListenerCalls = 0;
  const observer = [];
  const [left, right] = await Promise.all([
    harness.service.sendContentShareToRecipients({
      recipients:[alex,sam],shortCode:'Aa0Bb1Cc2Dd3Ee4F',shareVersion:1,senderNote:'  Meet there  ',title:'Plan',
      onSettled:() => { hostileListenerCalls += 1; throw new Error('hostile_listener'); },
    }),
    harness.service.sendContentShareToRecipients({
      recipients:[sam,alex],shortCode:'Aa0Bb1Cc2Dd3Ee4F',shareVersion:1,senderNote:'Meet there',title:'Plan',
      onSettled:(key,state) => observer.push(`${key}:${state}`),
    }),
  ]);
  assert.deepEqual(left, right);
  assert.equal(harness.rpcCalls.length, 2, 'one RPC per unique target');
  assert.equal(new Set(harness.rpcCalls.map((call) => call.p_operation_id)).size, 1);
  assert.equal(hostileListenerCalls, 2);
  assert.deepEqual(new Set(observer), new Set(['person:alex:sent','person:sam:sent']));
});

test('TA6 content share entry points cannot bypass the provider or revive provider-specific UI and long links', () => {
  const adapter = read('app-mobile/src/services/contentShareAdapter.ts');
  const shareContent = adapter.slice(adapter.indexOf('export async function shareContent'));
  assert.match(shareContent, /openUnifiedContentShare\(\{ kind, identity \}\)/);
  assert.doesNotMatch(shareContent, /prepareContentShare|Share\.share|Linking\.openURL|\/p\//);
  assert.doesNotMatch(consumer, /\bShare\.share|Linking\.openURL|whatsapp:\/\/|twitter:\/\/|sms:|mailto:|Copy message|s4Url/);
  assert.doesNotMatch(business, /WhatsApp|Twitter|Instagram|Messages|Copy message|whatsapp:\/\/|twitter:\/\/|sms:|mailto:|\/p\//);

  const consumerEntries = [
    'app-mobile/src/screens/Event/ConsumerEventDetailScreen.tsx',
    'app-mobile/src/screens/Trip/ConsumerTripDetailScreen.tsx',
    'app-mobile/src/screens/Experience/ConsumerExperienceDetailScreen.tsx',
    'app-mobile/src/screens/ConsumerBrandProfileScreen.tsx',
    'app-mobile/app/b/[brandSlug]/v/[venueSlug].tsx',
  ];
  for (const relative of consumerEntries) {
    const source = read(relative);
    assert.match(source, /shareContent\s*\(/, relative);
    assert.doesNotMatch(source, /\bShare\.share|whatsapp:\/\/|twitter:\/\//, relative);
  }
  assert.match(read('app-mobile/app/_layout.tsx'), /UnifiedShareProvider/);
});

function luminance(hex) {
  const channels = [1,3,5].map((index) => Number.parseInt(hex.slice(index,index+2),16) / 255)
    .map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}
function contrast(foreground, background) {
  const values = [luminance(foreground), luminance(background)].sort((a,b) => b-a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

test('TA7 accessibility, theme, contrast, touch targets, and small-screen reachability are explicit', () => {
  for (const source of [consumer,business]) {
    assert.match(source, /useWindowDimensions\(\)/);
    assert.match(source, /fontScale < 1\.4/);
    assert.match(source, /summary:\{minHeight:92/);
    assert.match(source, /poster(?:Wrap)?:\{width:64,height:72/);
    assert.match(source, /header:\{minHeight:60/);
    assert.match(source, /closeTarget:\{position:'absolute',right:8,width:44,height:44/);
    assert.match(source, /accessibilityRole="button"/);
    assert.match(source, /accessibilityLabel=/);
    assert.doesNotMatch(source, /#[Ff]{3,6}[^\n]*backgroundColor:'#EB7825'/);
  }
  assert.match(consumer, /searchWrap:\{minHeight:48/);
  assert.match(consumer, /recipient:\{minHeight:60/);
  assert.match(consumer, /noteCollapsed:\{minHeight:48/);
  assert.match(consumer, /sendButton:\{height:52/);
  assert.match(consumer, /paddingBottom: Math\.max\(insets\.bottom, 12\)/);
  assert.match(consumer, /accessibilityRole="checkbox"/);
  assert.match(consumer, /accessibilityState=\{\{ checked: active, disabled: sent \|\| sending \}\}/);
  assert.match(consumer, /accessibilityLiveRegion="polite"/);
  assert.match(consumer, /snapPoints=\{\['90%'\]\}/);
  assert.match(business, /container:\{width:'100%',maxWidth:480[^}]*paddingHorizontal:16/);
  assert.match(business, /role=\{Platform\.OS === 'web' \? 'dialog'/);
  assert.match(business, /aria-modal=\{Platform\.OS === 'web' \? true/);
  assert.match(business, /event\.key === 'Escape' && !busyRef\.current/);
  assert.match(business, /invokingControl\?\.focus\?\.\(\)/);
  assert.match(business, /const panelBackground = dark \? '#0C0E12' : '#FFFFFF'/);

  for (const [foreground,background,floor] of [
    ['#111827','#F9FAFB',4.5], ['#6B7280','#F9FAFB',4.5],
    ['#0C0E12','#EB7825',4.5], ['#B91C1C','#FFFFFF',4.5],
    ['#FCA5A5','#17191F',4.5], ['#166534','#F0FDF4',4.5],
    ['#86EFAC','#12321F',4.5],
  ]) assert.ok(contrast(foreground,background) >= floor, `${foreground}/${background}`);
});

test('TA8 live function posture is pinned in source and direct public transports enforce their own guards', () => {
  const config = read('supabase/config.toml');
  const expected = {
    'shared-card':false,
    'agent-chat':true,
    'agent-confirm-action':true,
    'run-business-place-authoring-pipeline':true,
    'event-cover-video-apply':true,
    'event-cover-video-cancel':true,
    'event-cover-video-source-uploaded':true,
    'event-cover-video-status':true,
    'event-cover-video-upload-intent':true,
    'event-cover-video-webhook':false,
    'event-cover-video-reaper':false,
  };
  for (const [name,verifyJwt] of Object.entries(expected)) {
    const match = new RegExp(`\\[functions\\.${name}\\]\\s*\\nverify_jwt = (true|false)`).exec(config);
    // Supabase defaults verify_jwt to true. Only public/self-authenticating
    // functions require an explicit false section in config.toml.
    const configured = match ? match[1] === 'true' : true;
    assert.equal(configured, verifyJwt, name);
  }
  const sharedCard = read('supabase/functions/shared-card/index.ts');
  assert.match(sharedCard, /constantTimeEqualSecret/);
  assert.match(sharedCard, /return json\(\{ error: "not_found" \}, 404\)/);
  assert.match(sharedCard, /if \(!serverCreated && !user\) return json\(\{ error: "unauthorized" \}, 401\)/);
  const webhook = read('supabase/functions/event-cover-video-webhook/index.ts');
  assert.match(webhook, /verification\.ok/);
  assert.match(webhook, /unverified_unsigned_webhook/);
  const reaper = read('supabase/functions/event-cover-video-reaper/index.ts');
  assert.match(reaper, /authHeader !== `Bearer \$\{Deno\.env\.get\("SUPABASE_SERVICE_ROLE_KEY"\)\}`/);
  assert.match(reaper, /return jsonResponse\(\{ error: "unauthorized" \}, 401\)/);
});

test('TA9 live unauthenticated callers cannot cross protected Edge or database boundaries', {
  skip: process.env.ISSUE_1719_LIVE !== '1',
}, async () => {
  const base = 'https://gqnoajqerqhnvulmnyvv.supabase.co';
  const supabaseSource = read('app-mobile/src/services/supabase.ts');
  const anonKey = /const supabaseAnonKey = '([^']+)'/.exec(supabaseSource)?.[1];
  assert.ok(anonKey, 'public anon key unavailable');
  const protectedFunctions = [
    'agent-chat','agent-confirm-action','run-business-place-authoring-pipeline',
    'event-cover-video-apply','event-cover-video-cancel','event-cover-video-source-uploaded',
    'event-cover-video-status','event-cover-video-upload-intent',
  ];
  for (const name of protectedFunctions) {
    const response = await fetch(`${base}/functions/v1/${name}`, {
      method:'POST', headers:{ apikey:anonKey,'content-type':'application/json' }, body:'{}',
    });
    assert.equal(response.status, 401, name);
  }

  const hiddenRead = await fetch(`${base}/functions/v1/shared-card?code=Aa0Bb1Cc2Dd3Ee4F`);
  assert.equal(hiddenRead.status, 404);
  const hiddenCreate = await fetch(`${base}/functions/v1/shared-card`, {
    method:'POST',headers:{apikey:anonKey,'content-type':'application/json'},body:'{}',
  });
  assert.equal(hiddenCreate.status, 401);
  const webhook = await fetch(`${base}/functions/v1/event-cover-video-webhook`, {
    method:'POST',headers:{apikey:anonKey,'content-type':'application/json'},body:'{}',
  });
  assert.ok([400,401,403,422].includes(webhook.status), `webhook status ${webhook.status}`);
  const reaper = await fetch(`${base}/functions/v1/event-cover-video-reaper`, {
    method:'POST',headers:{apikey:anonKey,'content-type':'application/json'},body:'{}',
  });
  assert.equal(reaper.status, 401);

  const restHeaders = { apikey:anonKey,Authorization:`Bearer ${anonKey}`,'content-type':'application/json' };
  for (const rpc of ['list_content_share_recipients','send_content_share_message']) {
    const response = await fetch(`${base}/rest/v1/rpc/${rpc}`, {
      method:'POST',headers:restHeaders,body:'{}',
    });
    assert.ok([401,403,404].includes(response.status), `${rpc} status ${response.status}`);
  }
  const ledger = await fetch(`${base}/rest/v1/content_share_message_deliveries?select=id&limit=1`, { headers:restHeaders });
  assert.ok([401,403,404].includes(ledger.status), `delivery ledger status ${ledger.status}`);
});
