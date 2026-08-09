import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read=(path)=>readFileSync(new URL(`../../${path}`,import.meta.url),'utf8');
const migration=read('supabase/migrations/20270301001719_issue_1719_native_content_card_snapshots.sql');
const mapper=read('supabase/functions/_shared/contentShare.ts');
const service=read('supabase/functions/_shared/contentShareService.ts');
const message=read('app-mobile/src/components/MessageInterface.tsx');
const bubble=read('app-mobile/src/components/chat/MessageBubble.tsx');
const saved=read('app-mobile/src/services/savedCardsService.ts');

test('native snapshot is immutable, private, bounded, atomic, and part of version identity',()=>{
  assert.match(migration,/FORCE ROW LEVEL SECURITY/);
  assert.match(migration,/REVOKE ALL ON public\.content_share_native_snapshots FROM PUBLIC, anon, authenticated/);
  assert.match(migration,/snapshot_bytes BETWEEN 2 AND 262144/);
  assert.match(migration,/v_native_fingerprint[\s\S]+v_fingerprint/);
  assert.match(migration,/INSERT INTO public\.content_share_versions[\s\S]+INSERT INTO public\.content_share_native_snapshots/);
  assert.match(migration,/immutable_native_content_card_snapshot/);
});

test('message descriptor is small and participant resolver is capped',()=>{
  assert.match(migration,/content_share_message_envelope_too_large/);
  assert.match(migration,/octet_length\(convert_to\(NEW\.card_payload::text,'UTF8'\)\)>5120/);
  assert.match(migration,/cardinality\(p_message_ids\) NOT BETWEEN 1 AND 50/);
  assert.match(migration,/JOIN public\.conversation_participants cp[\s\S]+cp\.user_id=v_user/);
  assert.match(migration,/'nativeCard'.+'native_content_card_v1'/s);
});

test('served source identity wins and sanitizer is explicit',()=>{
  assert.match(saved,/sourceRecordId: record\.id/);
  assert.match(mapper,/sourceScope === "collaboration"[\s\S]+session_participants[\s\S]+has_accepted/);
  assert.match(mapper,/buildNativeContentCardSnapshot/);
  assert.doesNotMatch(mapper,/nativeSnapshot\s*=\s*card/);
  assert.match(service,/upsert_content_share_version_with_native_snapshot/);
});

test('both entry points and both bubble generations converge',()=>{
  assert.match(message,/handleSelectCardToShare[\s\S]+prepareContentShare[\s\S]+sendContentShareToRecipients/);
  assert.match(message,/nativeContentCardSnapshotService\.resolve/);
  assert.match(message,/cardPayloadToExpandedCardData\(card\)/);
  assert.ok((bubble.match(/<PlaceCuratedChatCard/g)||[]).length>=2);
  assert.match(message,/router\.push\(`\/s\/\$\{payload\.shareCode\}`/); // six public kinds + old builds
});
