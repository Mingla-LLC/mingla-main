/**
 * #1719 approved physical-device amendment — implementor happy path.
 *
 * FAILS-ON-REVERT: removing the additive lifecycle migration, shared eligibility
 * guard, readiness endpoint, or either Share gate turns at least one named test
 * red; restoring the implementation returns the same assertions to green.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8');
const require = createRequire(import.meta.url);
const sharing = require(path.join(ROOT, 'packages/sharing'));
const migration = read('supabase/migrations/20270228001719_issue_1719_recipient_lifecycle_and_readiness.sql');
const delivery = read('app-mobile/src/services/contentShareDeliveryService.ts');
const connections = read('app-mobile/src/components/ConnectionsPage.tsx');
const consumer = read('app-mobile/src/components/share/UnifiedShareProvider.tsx');
const business = read('mingla-business/src/components/ui/ShareModalContent.tsx');
const readiness = read('mingla-marketing/lib/content-share-readiness.ts');

test('A-H1 lifecycle is server-owned, private to authenticated callers, and migrated once without invented deletes', () => {
  assert.match(migration, /ADD COLUMN IF NOT EXISTS hidden_at timestamptz NULL/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS archived_at timestamptz NULL/);
  assert.match(migration, /set_conversation_lifecycle[\s\S]*WHERE conversation_id=p_conversation_id AND user_id=v_user/);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.set_conversation_lifecycle\(uuid,text\) FROM PUBLIC,anon/);
  assert.match(migration, /leave_group_conversation[\s\S]*WHERE conversation_id=p_conversation_id AND user_id=v_user/);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.leave_group_conversation\(uuid\) FROM PUBLIC,anon/);
  assert.match(connections, /archived_chats_server_migrated/);
  assert.match(connections, /messagingService\.setConversationLifecycle\(conversationId, 'archive'\)/);
  assert.doesNotMatch(connections, /getConversationsCacheKey/);
  assert.match(connections, /Remove chat\?/);
  assert.match(connections, /Chat removed\./);
  assert.match(connections, /Leave group\?/);
});

test('A-H2 list, Connections and send consume one complete eligibility owner', () => {
  assert.match(migration, /FUNCTION public\.content_share_recipient_candidates/);
  assert.match(migration, /f\.status='accepted' AND f\.deleted_at IS NULL/);
  assert.match(migration, /FROM public\.pairings pairing/);
  assert.match(migration, /p\.active IS TRUE AND p\.visibility_mode IN \('public','friends'\)/);
  assert.match(migration, /cs\.status IN \('active','voting','locked'\)/);
  assert.match(migration, /e\.status IN \('scheduled','live'\)/);
  assert.match(migration, /o\.payment_status IN \('paid','partial_refund'\)/);
  assert.match(migration, /NOT EXISTS \(SELECT 1 FROM direct_rows d WHERE d\.person_user_id=p\.id\)/);
  assert.match(migration, /list_content_share_recipients[\s\S]*content_share_recipient_candidates\(auth\.uid\(\),false,false\)/);
  assert.match(migration, /list_connection_conversation_access[\s\S]*content_share_recipient_candidates\(auth\.uid\(\),true,false\)/);
  assert.match(migration, /guard_content_share_delivery_target[\s\S]*content_share_recipient_candidates\(NEW\.sender_id,false,false\)/);
  assert.match(read('app-mobile/src/services/messagingService.ts'), /rpc\('list_connection_conversation_access'\)/);
});

test('A-H3 hidden reopens only for another human, never archive, and only while canonically eligible', () => {
  const trigger = migration.slice(migration.indexOf('tg_reopen_hidden_conversation_on_human_message'), migration.indexOf('guard_content_share_delivery_target'));
  assert.match(trigger, /NEW\.sender_id IS NULL OR NEW\.deleted_at IS NOT NULL/);
  assert.match(trigger, /cp\.user_id<>NEW\.sender_id/);
  assert.match(trigger, /cp\.hidden_at IS NOT NULL AND cp\.archived_at IS NULL/);
  assert.match(trigger, /content_share_recipient_candidates\(cp\.user_id,false,true\)/);
  assert.match(trigger, /SET hidden_at=NULL/);
  assert.doesNotMatch(trigger, /archived_at=NULL/);
});

test('A-H4 activity tiers are server ordered and the client validates without sorting', () => {
  assert.match(migration, /max\(m\.created_at\)[\s\S]*m\.deleted_at IS NULL AND m\.sender_id IS NOT NULL/);
  assert.match(migration, /CASE WHEN d\.meaningful_activity_at IS NULL THEN 2 ELSE 1 END/);
  assert.match(migration, /3::integer/);
  assert.match(migration, /ORDER BY recipient_tier,[\s\S]*meaningful_activity_at END DESC[\s\S]*conversation_created_at END DESC[\s\S]*lower\(display_name\),target_kind,key/);
  assert.match(delivery, /malformed_recipient_order/);
  assert.match(delivery, /nonmonotonic_recipient_order/);
  const list = delivery.slice(delivery.indexOf('export async function listContentShareRecipients'), delivery.indexOf('async function notifyInsertedDelivery'));
  assert.doesNotMatch(list, /\.sort\(/);
});

test('A-H5 exact readiness is coalesced, bounded, and validates canonical HTML plus portrait identity', async () => {
  assert.match(readiness, /const flights = new Map/);
  assert.match(readiness, /4_000/);
  assert.match(readiness, /setTimeout\(resolve, 200\)/);
  assert.match(readiness, /content-page/);
  assert.match(readiness, /content-image/);
  assert.match(readiness, /og:image:secure_url/);
  assert.match(readiness, /state: 'ready'/);
  assert.match(readiness, /state: 'terminal'/);
  assert.match(readiness, /state: 'transient'/);
  const calls = [];
  const fetchImpl = async (url) => { calls.push(url); return { status: 200 }; };
  const [left, right] = await Promise.all([
    sharing.checkContentShareReadiness('Aa0Bb1Cc2Dd3Ee4F', 1, fetchImpl),
    sharing.checkContentShareReadiness('Aa0Bb1Cc2Dd3Ee4F', 1, fetchImpl),
  ]);
  assert.equal(left, 'ready'); assert.equal(right, 'ready'); assert.equal(calls.length, 1);
});

test('A-H6 public endpoint status/cache semantics never turn renderer faults into absence', () => {
  const image = read('mingla-business/api/content-share-image.js');
  const html = read('mingla-business/api/content-share.js');
  const proxy = read('mingla-marketing/lib/shared-card-proxy.ts');
  assert.match(image, /catch \{ return failClosed\(res, 502\); \}/);
  assert.match(html, /catch \{ return sendSharedHtml\(res, renderNotFoundHtml\("Shared page unavailable"\), 503\); \}/);
  assert.match(proxy, /MAX_CONTENT_SHARE_JPEG_BYTES = 200_000/);
  assert.match(proxy, /metadata\.format !== 'jpeg' \|\| metadata\.width !== 1080 \|\| metadata\.height !== 1350/);
  assert.match(proxy, /IMMUTABLE_CACHE/);
  assert.match(proxy, /private, no-store/);
  assert.match(read('mingla-business/server/socialPreview.js'), /og:image:secure_url/);
});

test('A-H7 Consumer and Business gate only native Share while Copy/internal work remain independent', () => {
  for (const source of [consumer, business]) {
    assert.match(source, /checkContentShareReadiness/);
    assert.match(source, /prepared\.media === null \|\| readiness === 'ready'/);
    assert.match(source, /Preparing preview…/);
    assert.match(source, /Checking preview…/);
    assert.match(source, /Preview is still preparing\./);
    assert.match(source, /Connect to finish preparing the preview\./);
    assert.match(source, /Couldn't prepare the preview\./);
    assert.match(source, /This share is no longer available\./);
    assert.match(source, /readinessRow:\{minHeight:44/);
  }
  assert.match(consumer, /disabled=\{!shareReady \|\| sending\}/);
  assert.match(consumer, /disabled=\{!prepared \|\| sending\}[\s\S]*copyLink/);
  assert.match(consumer, /No one available in Mingla yet/);
  assert.match(consumer, /Pending requests appear after they're accepted/);
  assert.match(business, /disabled=\{!shareReady \|\| busy\}/);
});

test('A-H8 lifecycle invalidation refreshes an open sheet and transactional invalid targets are removed', () => {
  assert.match(delivery, /subscribeContentShareRecipientInvalidation/);
  assert.match(connections, /invalidateContentShareRecipients\(\)/);
  assert.match(consumer, /subscribeContentShareRecipientInvalidation/);
  assert.match(delivery, /message\.includes\('target_unavailable'\)/);
  assert.match(consumer, /result\.unavailableKeys/);
  assert.match(consumer, /Some chats are no longer available\. Choose another\./);
  assert.match(consumer, /That selected chat is no longer available\./);
  assert.match(consumer, /selected chats are no longer available\./);
  assert.match(business, /addEventListener\?\.\('online'/);
  assert.match(business, /disabled=\{readiness === 'offline' && !online\}/);
});
