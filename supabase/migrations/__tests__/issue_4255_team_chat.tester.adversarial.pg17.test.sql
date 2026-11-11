-- Issue #4255 -- tester adversarial suite for the Work board v2 and Mingla
-- team chat migrations (20280614004255, 20280614014255, 20280614024255,
-- 20280614034255, 20280614044255), on the fully replayed PG17 schema.
-- Angles the implementor suites do not take:
--
--   A-ID      identity edges: a banned or deleted staff account, a staff row
--             that is not active (invited), a confirmed look-alike whose
--             address only CONTAINS a staff address, a staff address in
--             another case and with spaces (still staff)
--   A-RLS     team_chat_can_read / team_file_can_read answer only for the
--             caller's own threads; a staff member cannot read a thread or a
--             file of a chat they are not in, nor a group they were taken out
--             of; the agent ledger refuses a write
--   A-FORGE   foreign ids: someone else's attachment in my message, my own
--             attachment from another chat, a reply to a message of another
--             chat, a mention of a revoked teammate still in the group, a
--             request key reused in another chat (PT409), mute / remove on a
--             chat I am not in
--   A-EVERY   @everyone plus an explicit mention of the same person tells them
--             once; a revoked admin cannot mention everyone
--   A-TREE    moving a card that has a sub-subtask under another card is too
--             deep; a direct write making a two-card cycle is refused
--   A-COL     archiving a column moves only live cards and keeps each in its
--             group; a non-admin and an agent cannot archive
--   A-FILL    plan-to-subtask backfill on a production-shaped plan (closed
--             card with open steps, removed card, steps out of order, a step
--             over 160 characters, a non-object step): counts, closed and
--             removed states, a second run adds nothing; notes backfill is
--             idempotent
--
-- FAILS-ON-REVERT (each proved by deleting the line in the migration,
-- replaying, and running this suite; see the #4255 tester verdict):
--   * team_chat_staff's banned_until line (A-ID: 4 checks fail)
--   * team_chat_staff's deleted_at line (A-ID: 3 checks fail)
--   * team_post's "a.created_by = v_me" (A-FORGE: someone else's attachment
--     is posted and taken over)
--   * team_post's "r.thread_id <> t.id" (A-FORGE: a cross-chat reply posts)
--   * team_post's request-key thread check (A-FORGE: a key from another chat
--     replays the other chat's message instead of PT409)
--   A-TREE is defence in depth: removing ops_4255_tree_guard's v_below check
--   alone still refuses the move (the cascaded grandchild hits p.depth >= 2).
--
-- Run from the repository root as supabase_admin. Everything is rolled back.

\set ON_ERROR_STOP on
begin;

alter table auth.users add column if not exists email_confirmed_at timestamptz;
alter table auth.users add column if not exists banned_until timestamptz;
alter table auth.users add column if not exists deleted_at timestamptz;

create temp table ta_people (who text primary key, id uuid not null, email text not null) on commit drop;
insert into ta_people (who, id, email) values
  ('owner', '4255a000-0000-4000-a0f2-000000000001', 'oz.a4255@test.local'),
  ('admin', '4255a000-0000-4000-a0f2-000000000002', 'ade.a4255@test.local'),
  ('gem',   '4255a000-0000-4000-a0f2-000000000003', 'gem.a4255@test.local'),
  ('ray',   '4255a000-0000-4000-a0f2-000000000004', 'ray.a4255@test.local'),
  ('ban',   '4255a000-0000-4000-a0f2-000000000005', 'ban.a4255@test.local'),
  ('gone',  '4255a000-0000-4000-a0f2-000000000006', 'gone.a4255@test.local'),
  ('inv',   '4255a000-0000-4000-a0f2-000000000007', 'inv.a4255@test.local'),
  ('look',  '4255a000-0000-4000-a0f2-000000000008', 'gem.a4255@test.local.evil.example'),
  ('case',  '4255a000-0000-4000-a0f2-000000000009', '  Kay.A4255@Test.Local '),
  ('host',  '4255a000-0000-4000-a0f2-00000000000a', 'host.a4255@test.local'),
  ('radm',  '4255a000-0000-4000-a0f2-00000000000b', 'radm.a4255@test.local');
insert into auth.users (id, email, email_confirmed_at) select id, email, now() from ta_people;
insert into public.admin_users (email, role, status, accepted_at) values
  ('oz.a4255@test.local', 'owner', 'active', now()),
  ('ade.a4255@test.local', 'admin', 'active', now()),
  ('radm.a4255@test.local', 'admin', 'active', now());
insert into public.admin_team_members (email, role, status, accepted_at) values
  ('gem.a4255@test.local', 'growth', 'active', now()),
  ('ray.a4255@test.local', 'growth', 'active', now()),
  ('ban.a4255@test.local', 'growth', 'active', now()),
  ('gone.a4255@test.local', 'growth', 'active', now()),
  ('kay.a4255@test.local', 'growth', 'active', now());
insert into public.admin_team_members (email, role, status) values ('inv.a4255@test.local', 'growth', 'invited');
update auth.users set banned_until = now() + interval '30 days' where id = '4255a000-0000-4000-a0f2-000000000005';
update auth.users set deleted_at = now() where id = '4255a000-0000-4000-a0f2-000000000006';

create temp table ta_results (seq serial primary key, test text, label text, ok boolean, detail text) on commit drop;
create temp table ta_ids (k text primary key, id uuid not null) on commit drop;

create function pg_temp.as_(p_who text, p_sql text) returns text
language plpgsql as $fn$
declare v_id uuid; v_email text; v_out text;
begin
  select id, email into strict v_id, v_email from ta_people where who = p_who;
  begin
    set local role authenticated;
    perform set_config('request.jwt.claim.sub', v_id::text, true);
    perform set_config('request.jwt.claim.email', v_email, true);
    perform set_config('request.jwt.claims', json_build_object('sub', v_id, 'email', v_email, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.role', '', true);
    execute p_sql into v_out;
    reset role;
    return v_out;
  exception when others then
    reset role;
    return 'ERR:' || sqlstate || ':' || sqlerrm;
  end;
end;
$fn$;
create function pg_temp.next_request() returns void
language sql as $fn$
  update public.team_agent_calls set xact_id = '3'::xid8, started_at = started_at - interval '5 minutes' where xact_id <> '3'::xid8
$fn$;
create function pg_temp.person(p_who text, p_sql text) returns text
language plpgsql as $fn$
begin
  perform pg_temp.next_request();
  return pg_temp.as_(p_who, p_sql);
end;
$fn$;
create function pg_temp.agent(p_who text, p_sql text) returns text
language plpgsql as $fn$
declare v_id uuid; v_email text;
begin
  perform pg_temp.next_request();
  select id, email into strict v_id, v_email from ta_people where who = p_who;
  insert into public.team_agent_calls (key_id, owner_email, actor_uid, agent, tool, xact_id, started_at)
  values (gen_random_uuid(), v_email, v_id, 'claude', 'update_work', pg_current_xact_id(), clock_timestamp());
  return pg_temp.as_(p_who, p_sql);
end;
$fn$;
create function pg_temp.chk(p_test text, p_label text, p_got text, p_want text) returns void
language sql as $fn$
  insert into ta_results (test, label, ok, detail)
  values (p_test, p_label, p_got is not distinct from p_want,
          format('got %s, want %s', coalesce(left(p_got, 500), '<null>'), coalesce(p_want, '<null>')));
$fn$;
create function pg_temp.lk(p_test text, p_label text, p_got text, p_pattern text) returns void
language sql as $fn$
  insert into ta_results (test, label, ok, detail)
  values (p_test, p_label, coalesce(p_got like p_pattern, false),
          format('got %s, want like %s', coalesce(left(p_got, 500), '<null>'), p_pattern));
$fn$;
create function pg_temp.keep(p_k text, p_id uuid) returns uuid
language sql as $fn$ insert into ta_ids (k, id) values (p_k, p_id) on conflict (k) do update set id = excluded.id returning id $fn$;
create function pg_temp.id(p_k text) returns uuid language sql as $fn$ select id from ta_ids where k = p_k $fn$;
create function pg_temp.uid(p_who text) returns uuid language sql as $fn$ select id from ta_people where who = p_who $fn$;
create function pg_temp.rk() returns text language sql as $fn$ select 'ta-' || md5(random()::text || clock_timestamp()::text) $fn$;
create function pg_temp.today() returns date language sql as $fn$ select (now() AT TIME ZONE 'UTC')::date $fn$;
create function pg_temp.status_id(p_name text) returns uuid
language sql as $fn$ select id from public.ops_work_statuses where name = p_name and archived_at is null $fn$;
create function pg_temp.rev(p_k text) returns bigint
language sql as $fn$ select revision from public.ops_work_cards where id = (select id from ta_ids where k = p_k) $fn$;
-- A file the uploader has put in storage (the bucket write itself is the
-- storage service's; here the object row stands in for it).
create function pg_temp.uploaded(p_att uuid) returns void
language sql as $fn$
  insert into storage.objects (bucket_id, name, owner)
  select 'team-files', a.storage_path, a.created_by from public.team_message_attachments a where a.id = p_att
$fn$;
create function pg_temp.add_file(p_k text, p_who text, p_thread uuid) returns text
language plpgsql as $fn$
declare v text;
begin
  v := pg_temp.person(p_who, format($q$select public.team_attachment_add(%L, '{"kind":"document","name":"plan.pdf","mime":"application/pdf","size_bytes":2048}'::jsonb)::text$q$, p_thread));
  if v not like 'ERR:%' then perform pg_temp.keep(p_k, ((v::jsonb)->'attachment'->>'id')::uuid); perform pg_temp.uploaded(pg_temp.id(p_k)); end if;
  return v;
end;
$fn$;

-- ───────────────────────────── A-ID ─────────────────────────────
do $t$
begin
  perform pg_temp.chk('A-ID', 'control: an active confirmed teammate is staff', public.team_chat_staff(pg_temp.uid('gem'))::text, 'true');
  perform pg_temp.chk('A-ID', 'a banned staff account is not staff', public.team_chat_staff(pg_temp.uid('ban'))::text, 'false');
  perform pg_temp.chk('A-ID', 'a deleted staff account is not staff', public.team_chat_staff(pg_temp.uid('gone'))::text, 'false');
  perform pg_temp.chk('A-ID', 'an invited (not active) staff row gives no access', public.team_chat_staff(pg_temp.uid('inv'))::text, 'false');
  perform pg_temp.chk('A-ID', 'a confirmed address that only contains a staff address is not staff', public.team_chat_staff(pg_temp.uid('look'))::text, 'false');
  perform pg_temp.chk('A-ID', 'a staff address in another case with spaces is still staff', public.team_chat_staff(pg_temp.uid('case'))::text, 'true');
  perform pg_temp.lk('A-ID', 'the banned account is told the space is for the team', pg_temp.person('ban', 'select public.team_list_threads()::text'), 'ERR:42501:team_access_required:%');
  perform pg_temp.chk('A-ID', 'the banned account reads no team rows', pg_temp.person('ban', 'select count(*)::text from public.team_threads'), '0');
  perform pg_temp.chk('A-ID', 'the badge says staff false for the deleted account', pg_temp.person('gone', $q$select public.team_badge()->>'staff'$q$), 'false');
  perform pg_temp.lk('A-ID', 'the invited teammate cannot list chats', pg_temp.person('inv', 'select public.team_list_threads()::text'), 'ERR:42501:%');
  perform pg_temp.lk('A-ID', 'the look-alike cannot list chats', pg_temp.person('look', 'select public.team_list_threads()::text'), 'ERR:42501:%');
  -- One list syncs the Mingla team.
  perform pg_temp.person('gem', 'select public.team_list_threads()::text');
  perform pg_temp.chk('A-ID', 'the Mingla team holds the active confirmed staff of this suite only',
    (select string_agg(p.who, ',' order by p.who) from public.team_thread_members m join public.team_threads t on t.id = m.thread_id and t.kind = 'team'
       join ta_people p on p.id = m.user_id where m.left_at is null),
    'admin,case,gem,owner,radm,ray');
end;
$t$;

-- ───────────────────────────── A-RLS ─────────────────────────────
do $t$
declare v text; v_g uuid;
begin
  v := pg_temp.person('gem', format('select public.team_group_create(%L, array[%L]::uuid[])::text', 'A4255 Launch', pg_temp.uid('ray')));
  v_g := pg_temp.keep('G', ((v::jsonb)->'thread'->>'id')::uuid);
  v := pg_temp.add_file('GF', 'gem', v_g);
  v := pg_temp.person('gem', format('select public.team_post(%L, %L, ''{}''::uuid[], null, array[%L]::uuid[])::text', v_g, 'Here is the plan', pg_temp.id('GF')));
  perform pg_temp.keep('GM', ((v::jsonb)->'message'->>'id')::uuid);
  perform pg_temp.chk('A-RLS', 'control: a member may read the group', pg_temp.person('ray', format('select public.team_chat_can_read(%L)::text', v_g)), 'true');
  perform pg_temp.chk('A-RLS', 'a staff member outside the group gets false from team_chat_can_read', pg_temp.person('admin', format('select public.team_chat_can_read(%L)::text', v_g)), 'false');
  perform pg_temp.chk('A-RLS', 'and false from team_file_can_read for its file',
    pg_temp.person('admin', format('select public.team_file_can_read(%L)::text', (select storage_path from public.team_message_attachments where id = pg_temp.id('GF')))), 'false');
  perform pg_temp.chk('A-RLS', 'and reads no storage object of it',
    pg_temp.person('admin', $q$select count(*)::text from storage.objects where bucket_id = 'team-files' and name like '$q$ || v_g::text || $q$/%'$q$), '0');
  perform pg_temp.chk('A-RLS', 'a member reads the storage object',
    pg_temp.person('ray', $q$select count(*)::text from storage.objects where bucket_id = 'team-files' and name like '$q$ || v_g::text || $q$/%'$q$), '1');
  perform pg_temp.lk('A-RLS', 'an admin outside the group cannot sign its file', pg_temp.person('admin', format('select public.team_attachment_sign(%L)::text', pg_temp.id('GF'))), 'ERR:P0002:%');
  -- Taken out of the group by its owner.
  v := pg_temp.person('gem', format('select public.team_member_remove(%L, %L)::text', v_g, pg_temp.uid('ray')));
  perform pg_temp.chk('A-RLS', 'a teammate taken out reads no message of the group', pg_temp.person('ray', format('select count(*)::text from public.team_messages where thread_id = %L', v_g)), '0');
  perform pg_temp.chk('A-RLS', 'nor its attachments', pg_temp.person('ray', format('select count(*)::text from public.team_message_attachments where thread_id = %L', v_g)), '0');
  perform pg_temp.chk('A-RLS', 'nor the storage object',
    pg_temp.person('ray', $q$select count(*)::text from storage.objects where bucket_id = 'team-files' and name like '$q$ || v_g::text || $q$/%'$q$), '0');
  perform pg_temp.lk('A-RLS', 'and cannot post in it', pg_temp.person('ray', format('select public.team_post(%L, %L)::text', v_g, 'still here?')), 'ERR:P0002:%');
  perform pg_temp.lk('A-RLS', 'nor mute it', pg_temp.person('ray', format('select public.team_mute(%L, true)::text', v_g)), 'ERR:P0002:%');
  perform pg_temp.chk('A-RLS', 'the list no longer shows the group to them',
    pg_temp.person('ray', format($q$select count(*)::text from jsonb_array_elements(public.team_list_threads()->'threads') e where e->>'id' = %L$q$, v_g)), '0');
  -- An agent acting for a teammate.
  perform pg_temp.lk('A-RLS', 'a connected agent cannot post in the group', pg_temp.agent('gem', format('select public.team_post(%L, %L)::text', v_g, 'agent words')), 'ERR:42501:agents_cannot_post:%');
  perform pg_temp.lk('A-RLS', 'nor add an attachment', pg_temp.agent('gem', format($q$select public.team_attachment_add(%L, '{"kind":"link","url":"https://example.com/x"}'::jsonb)::text$q$, v_g)), 'ERR:42501:agents_cannot_post:%');
  perform pg_temp.lk('A-RLS', 'nor react', pg_temp.agent('gem', format($q$select public.team_react(%L, '👍')::text$q$, pg_temp.id('GM'))), 'ERR:42501:agents_cannot_post:%');
  -- Anon on the storage helpers.
  perform pg_temp.chk('A-RLS', 'anon cannot run the storage helpers',
    (has_function_privilege('anon', 'public.team_file_can_read(text)', 'EXECUTE') or has_function_privilege('anon', 'public.team_file_can_upload(text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.ops_file_can_read(text)', 'EXECUTE'))::text, 'false');
  perform pg_temp.chk('A-RLS', 'a host reads no ops-work-files object and no Work v2 table',
    pg_temp.person('host', $q$select (select count(*) from storage.objects where bucket_id = 'ops-work-files')::text || '/' || public.ops_file_can_read('x/y/z')::text$q$), '0/false');
end;
$t$;

-- ───────────────────────────── A-FORGE ─────────────────────────────
do $t$
declare v text; v_g uuid := pg_temp.id('G'); v_g2 uuid; v_dm uuid;
begin
  v := pg_temp.person('admin', format('select public.team_group_create(%L, array[%L]::uuid[])::text', 'A4255 Other', pg_temp.uid('gem')));
  v_g2 := pg_temp.keep('G2', ((v::jsonb)->'thread'->>'id')::uuid);
  -- Someone else's unsent attachment in my message.
  v := pg_temp.add_file('AF', 'admin', v_g2);
  perform pg_temp.lk('A-FORGE', 'a member cannot post another member''s unsent attachment',
    pg_temp.person('gem', format('select public.team_post(%L, %L, ''{}''::uuid[], null, array[%L]::uuid[])::text', v_g2, 'mine now', pg_temp.id('AF'))), 'ERR:22023:invalid_message:%');
  perform pg_temp.chk('A-FORGE', 'the attachment is still unsent', (select (message_id is null)::text from public.team_message_attachments where id = pg_temp.id('AF')), 'true');
  -- My own attachment from another chat.
  v := pg_temp.add_file('MF', 'gem', v_g);
  perform pg_temp.lk('A-FORGE', 'my attachment from another chat is refused here',
    pg_temp.person('gem', format('select public.team_post(%L, %L, ''{}''::uuid[], null, array[%L]::uuid[])::text', v_g2, 'moved file', pg_temp.id('MF'))), 'ERR:22023:invalid_message:%');
  -- Reply to a message of another chat.
  perform pg_temp.lk('A-FORGE', 'a reply to a message of another chat is refused',
    pg_temp.person('gem', format('select public.team_post(%L, %L, ''{}''::uuid[], %L)::text', v_g2, 'cross reply', pg_temp.id('GM'))), 'ERR:P0002:not_found:%');
  -- A request key used in one chat, replayed into another.
  v := pg_temp.person('gem', format('select public.team_post(%L, %L, ''{}''::uuid[], null, null, false, %L)::text', v_g2, 'keyed once', 'ta-key-0000001'));
  perform pg_temp.lk('A-FORGE', 'a request key reused for another chat is PT409',
    pg_temp.person('gem', format('select public.team_post(%L, %L, ''{}''::uuid[], null, null, false, %L)::text', v_g, 'keyed again', 'ta-key-0000001')), 'ERR:PT409:stale_write:%');
  perform pg_temp.chk('A-FORGE', 'and wrote nothing there', (select count(*)::text from public.team_messages where thread_id = v_g and body_md = 'keyed again'), '0');
  -- Mention of a teammate who stays a group member but is revoked as staff.
  v := pg_temp.person('admin', format('select public.team_members_add(%L, array[%L]::uuid[])::text', v_g2, pg_temp.uid('ray')));
  update public.admin_team_members set status = 'revoked' where email = 'ray.a4255@test.local';
  perform pg_temp.lk('A-FORGE', 'a revoked teammate still listed in the group cannot be mentioned',
    pg_temp.person('gem', format('select public.team_post(%L, %L, array[%L]::uuid[])::text', v_g2, 'hey @ray', pg_temp.uid('ray'))), 'ERR:22023:invalid_mention_recipient:%');
  v := pg_temp.person('gem', format('select public.team_post(%L, %L)::text', v_g2, 'plain group message after revoke'));
  perform pg_temp.chk('A-FORGE', 'the revoked teammate gets no outbox row for the group',
    (select count(*)::text from public.notification_outbox where user_id = pg_temp.uid('ray') and category_key like 'business.team_%'), '0');
  perform pg_temp.lk('A-FORGE', 'no DM can be opened with a revoked teammate', pg_temp.person('gem', format('select public.team_dm_open(%L)::text', pg_temp.uid('ray'))), 'ERR:22023:invalid_member:%');
  update public.admin_team_members set status = 'active' where email = 'ray.a4255@test.local';
  -- Remove someone from a group I do not own and am not admin of.
  perform pg_temp.lk('A-FORGE', 'a plain member cannot take the owner out of the group',
    pg_temp.person('gem', format('select public.team_member_remove(%L, %L)::text', v_g2, pg_temp.uid('admin'))), 'ERR:42501:forbidden:%');
  -- A DM key cannot be forged into a group.
  v := pg_temp.person('gem', format('select public.team_dm_open(%L)::text', pg_temp.uid('owner')));
  v_dm := ((v::jsonb)->'thread'->>'id')::uuid;
  perform pg_temp.lk('A-FORGE', 'nobody is added to a DM', pg_temp.person('gem', format('select public.team_members_add(%L, array[%L]::uuid[])::text', v_dm, pg_temp.uid('admin'))), 'ERR:22023:invalid_chat:%');
  perform pg_temp.chk('A-FORGE', 'a staff member outside the DM cannot read it', pg_temp.person('admin', format('select count(*)::text from public.team_thread_members where thread_id = %L', v_dm)), '0');
end;
$t$;

-- ───────────────────────────── A-EVERY ─────────────────────────────
do $t$
declare v text; v_g2 uuid := pg_temp.id('G2'); v_msg uuid;
begin
  delete from public.notification_outbox where category_key like 'business.team_%' and user_id in (select id from ta_people);
  v := pg_temp.person('admin', format('select public.team_post(%L, %L, array[%L]::uuid[], null, null, true)::text', v_g2, '@everyone and @gem', pg_temp.uid('gem')));
  v_msg := ((v::jsonb)->'message'->>'id')::uuid;
  perform pg_temp.chk('A-EVERY', 'a person both mentioned and in @everyone gets one in-app mention',
    (select count(*)::text from public.team_mentions where source_kind = 'team_message' and source_id = v_msg and target_user_id = pg_temp.uid('gem')), '1');
  perform pg_temp.chk('A-EVERY', 'and one push row',
    (select count(*)::text from public.notification_outbox where user_id = pg_temp.uid('gem') and payload->>'message_id' = v_msg::text), '1');
  perform pg_temp.chk('A-EVERY', 'the explicit mention wins the reason',
    (select payload->>'reason' from public.notification_outbox where user_id = pg_temp.uid('gem') and payload->>'message_id' = v_msg::text), 'mention');
  perform pg_temp.chk('A-EVERY', 'the other member hears it as everyone',
    (select payload->>'reason' from public.notification_outbox where user_id = pg_temp.uid('ray') and payload->>'message_id' = v_msg::text), 'everyone');
  -- An admin who is revoked cannot mention everyone (or post at all).
  update public.admin_users set status = 'revoked' where email = 'radm.a4255@test.local';
  perform pg_temp.lk('A-EVERY', 'a revoked admin cannot mention everyone in the Mingla team',
    pg_temp.person('radm', format('select public.team_post(%L, %L, ''{}''::uuid[], null, null, true)::text',
      (select id from public.team_threads where kind = 'team'), 'everyone!')), 'ERR:42501:team_access_required:%');
  perform pg_temp.chk('A-EVERY', 'the badge for the revoked admin says admin false', pg_temp.person('radm', $q$select public.team_badge()->>'admin'$q$), 'false');
end;
$t$;

-- ───────────────────────────── helpers for Work cards ─────────────────────────────
create function pg_temp.add(p_k text, p_who text, p_item jsonb) returns text
language plpgsql as $fn$
declare v text;
begin
  v := pg_temp.person(p_who, format('select public.ops_work_add(%L::jsonb, %L)::text', jsonb_build_array(p_item), pg_temp.rk()));
  if v not like 'ERR:%' and (v::jsonb)->'results'->0->>'status' = 'added' then
    perform pg_temp.keep(p_k, ((v::jsonb)->'results'->0->'card'->>'id')::uuid);
  end if;
  return v;
end;
$fn$;
create function pg_temp.item(p_title text) returns jsonb
language sql as $fn$
  select jsonb_build_object('title', p_title, 'instructions', 'Do the work carefully and say what changed.',
    'done_means', 'It is done and checked.', 'owners', jsonb_build_array('gem.a4255@test.local'), 'due_on', pg_temp.today() + 3);
$fn$;

-- ───────────────────────────── A-TREE ─────────────────────────────
do $t$
declare v text;
begin
  v := pg_temp.add('P', 'gem', pg_temp.item('A4255 Parent card'));
  v := pg_temp.add('C', 'gem', pg_temp.item('A4255 Child card') || jsonb_build_object('parent', pg_temp.id('P')));
  v := pg_temp.add('GC', 'gem', pg_temp.item('A4255 Grandchild card') || jsonb_build_object('parent', pg_temp.id('C')));
  v := pg_temp.add('Q', 'gem', pg_temp.item('A4255 Other top card'));
  perform pg_temp.chk('A-TREE', 'control: depths 0, 1, 2',
    (select string_agg(depth::text, ',' order by depth) from public.ops_work_cards where id in (pg_temp.id('P'), pg_temp.id('C'), pg_temp.id('GC'))), '0,1,2');
  begin
    update public.ops_work_cards set parent_id = pg_temp.id('Q') where id = pg_temp.id('P');
    perform pg_temp.chk('A-TREE', 'a card with a sub-subtask cannot move under another card', 'moved', 'refused');
  exception when others then
    perform pg_temp.lk('A-TREE', 'a card with a sub-subtask cannot move under another card', sqlerrm, 'too_deep:%');
  end;
  begin
    update public.ops_work_cards set parent_id = pg_temp.id('GC') where id = pg_temp.id('Q');
    perform pg_temp.chk('A-TREE', 'nothing goes under a sub-subtask', 'moved', 'refused');
  exception when others then
    perform pg_temp.lk('A-TREE', 'nothing goes under a sub-subtask', sqlerrm, 'too_deep:%');
  end;
  begin
    update public.ops_work_cards set parent_id = pg_temp.id('C') where id = pg_temp.id('P');
    perform pg_temp.chk('A-TREE', 'a two-card cycle is refused', 'moved', 'refused');
  exception when others then
    perform pg_temp.lk('A-TREE', 'a two-card cycle is refused', sqlerrm, 'invalid_parent:%');
  end;
  perform pg_temp.chk('A-TREE', 'after the refusals the tree is unchanged',
    (select string_agg(coalesce(parent_id::text, '-') || ':' || depth, ',' order by depth) from public.ops_work_cards where id in (pg_temp.id('P'), pg_temp.id('C'), pg_temp.id('GC'))),
    '-:0,' || pg_temp.id('P')::text || ':1,' || pg_temp.id('C')::text || ':2');
end;
$t$;

-- ───────────────────────────── A-COL ─────────────────────────────
do $t$
declare v text; v_rev bigint;
begin
  v := pg_temp.person('admin', $q$select public.ops_status_add('A4255 Review', '#c27a12', 'doing')::text$q$);
  v := pg_temp.add('L', 'gem', pg_temp.item('A4255 Live card in review'));
  v := pg_temp.add('R', 'gem', pg_temp.item('A4255 Removed card in review'));
  v := pg_temp.person('gem', format('select public.ops_work_move(%L, %L, %s)::text', pg_temp.id('L'), pg_temp.status_id('A4255 Review'), pg_temp.rev('L')));
  v := pg_temp.person('gem', format('select public.ops_work_move(%L, %L, %s)::text', pg_temp.id('R'), pg_temp.status_id('A4255 Review'), pg_temp.rev('R')));
  update public.ops_work_cards set archived_at = now(), archived_by = 'gem.a4255@test.local', archive_reason = 'duplicate' where id = pg_temp.id('R');
  select revision into v_rev from public.ops_work_statuses where id = pg_temp.status_id('A4255 Review');
  perform pg_temp.lk('A-COL', 'a teammate who is not an admin cannot archive a column',
    pg_temp.person('gem', format('select public.ops_status_archive(%L, %L, %s)::text', pg_temp.status_id('A4255 Review'), pg_temp.status_id('In progress'), v_rev)), 'ERR:42501:forbidden:%');
  perform pg_temp.lk('A-COL', 'nor an agent for an admin',
    pg_temp.agent('admin', format('select public.ops_status_archive(%L, %L, %s)::text', pg_temp.status_id('A4255 Review'), pg_temp.status_id('In progress'), v_rev)), 'ERR:42501:forbidden:%');
  perform pg_temp.lk('A-COL', 'a stale column revision is PT409',
    pg_temp.person('admin', format('select public.ops_status_archive(%L, %L, %s)::text', pg_temp.status_id('A4255 Review'), pg_temp.status_id('In progress'), v_rev - 1)), 'ERR:PT409:%');
  v := pg_temp.person('admin', format('select public.ops_status_archive(%L, %L, %s)::text', pg_temp.status_id('A4255 Review'), pg_temp.status_id('In progress'), v_rev));
  perform pg_temp.chk('A-COL', 'one live card moved', (v::jsonb)->>'moved', '1');
  perform pg_temp.chk('A-COL', 'the live card is in In progress, still doing',
    (select w.status || '/' || s.name from public.ops_work_cards w join public.ops_work_statuses s on s.id = w.status_id where w.id = pg_temp.id('L')), 'doing/In progress');
  perform pg_temp.chk('A-COL', 'every live card sits in a live column',
    (select count(*)::text from public.ops_work_cards w join public.ops_work_statuses s on s.id = w.status_id where w.archived_at is null and s.archived_at is not null), '0');
end;
$t$;

-- ───────────────────────────── A-FILL ─────────────────────────────
do $t$
declare v jsonb; v_closed uuid; v_removed uuid; v_open uuid; v_long text := repeat('Very long step text ', 12);
begin
  -- Production-shaped plans written the way the old board stored them.
  insert into public.ops_work_cards (title, instructions, done_means, status, kind, due_on, due_source, sprint_id, plan, created_by, updated_by)
  values ('A4255 Fill open card', 'Old instructions for the open card.', 'Done means checked.', 'doing', 'task', pg_temp.today() + 2, 'explicit', public.ops_sprint_ensure(pg_temp.today()),
    jsonb_build_array(
      jsonb_build_object('n', 2, 'text', 'Second step for Gem', 'status', 'todo', 'tool', 'person'),
      jsonb_build_object('n', 1, 'text', 'First step', 'status', 'done', 'tool', 'person', 'checked_at', now()::text),
      jsonb_build_object('n', 3, 'text', v_long, 'status', 'todo', 'tool', 'agent'),
      '"a string, not a step"'::jsonb),
    'gem.a4255@test.local', 'gem.a4255@test.local')
  returning id into v_open;
  insert into public.ops_work_cards (title, instructions, done_means, status, kind, due_on, due_source, sprint_id, plan, close_kind, close_reason, closed_at, closed_by, closed_via, created_by, updated_by)
  values ('A4255 Fill closed card', 'Old instructions for the closed card.', 'Done means checked.', 'done', 'task', pg_temp.today() - 2, 'explicit', public.ops_sprint_ensure(pg_temp.today()),
    jsonb_build_array(jsonb_build_object('n', 1, 'text', 'Open step on a closed card', 'status', 'todo'),
                      jsonb_build_object('n', 2, 'text', 'Done step on a closed card', 'status', 'done')),
    'done', 'Closed before plans became subtasks.', now() - interval '1 day', 'gem.a4255@test.local', null, 'gem.a4255@test.local', 'gem.a4255@test.local')
  returning id into v_closed;
  insert into public.ops_work_cards (title, instructions, done_means, status, kind, due_on, due_source, sprint_id, plan, archived_at, archived_by, archive_reason, created_by, updated_by)
  values ('A4255 Fill removed card', 'Old instructions for the removed card.', 'Done means checked.', 'todo', 'task', pg_temp.today() + 5, 'explicit', public.ops_sprint_ensure(pg_temp.today()),
    jsonb_build_array(jsonb_build_object('n', 1, 'text', 'Step on a removed card', 'status', 'todo')),
    now(), 'gem.a4255@test.local', 'duplicate', 'gem.a4255@test.local', 'gem.a4255@test.local')
  returning id into v_removed;
  v := public.ops_4255_plan_to_subtasks();
  perform pg_temp.chk('A-FILL', 'three cards, six object steps become subtasks (the string step is skipped)',
    (v->>'cards') || '/' || (v->>'subtasks'), '3/6');
  perform pg_temp.chk('A-FILL', 'the open card: steps in n order, done step closed, others open',
    (select string_agg(position::text || ':' || status, ',' order by position) from public.ops_work_cards where parent_id = v_open), '0:done,1:todo,2:todo');
  perform pg_temp.chk('A-FILL', 'a step over 160 characters becomes a title of at most 160',
    (select (max(char_length(title)) between 150 and 160)::text from public.ops_work_cards where parent_id = v_open), 'true');
  perform pg_temp.chk('A-FILL', 'the step naming Gem is owned by Gem',
    (select string_agg(p.email, ',') from public.ops_work_cards c join public.ops_work_people p on p.card_id = c.id and p.role = 'owner'
      where c.parent_id = v_open and c.position = 1), 'gem.a4255@test.local');
  perform pg_temp.chk('A-FILL', 'on the closed card every subtask is closed',
    (select string_agg(status || ':' || close_kind, ',' order by position) from public.ops_work_cards where parent_id = v_closed), 'done:system,done:done');
  perform pg_temp.chk('A-FILL', 'on the removed card the subtask is removed too',
    (select string_agg((archived_at is not null)::text, ',') from public.ops_work_cards where parent_id = v_removed), 'true');
  perform pg_temp.chk('A-FILL', 'every plan is emptied', (select count(*)::text from public.ops_work_cards where id in (v_open, v_closed, v_removed) and plan <> '[]'::jsonb), '0');
  perform pg_temp.chk('A-FILL', 'the plan reads back from the subtasks in its old shape',
    (select jsonb_array_length(public.ops_plan_from_subtasks(v_open))::text), '3');
  v := public.ops_4255_plan_to_subtasks();
  perform pg_temp.chk('A-FILL', 'a second run adds nothing', (v->>'subtasks'), '0');
  perform pg_temp.chk('A-FILL', 'the open card still closes past its open plan steps (they close with it)',
    (select count(*)::text from public.ops_work_cards where parent_id = v_open and status <> 'done' and plan_step is null), '0');
  perform pg_temp.chk('A-FILL', 'the notes backfill is idempotent', public.ops_4255_notes_to_messages()::text, '0');
end;
$t$;

-- ───────────────────────────── report ─────────────────────────────
do $r$
declare r record; v_fail integer := 0; v_all integer := 0;
begin
  for r in select * from ta_results order by seq loop
    v_all := v_all + 1;
    if r.ok then raise notice 'PASS % %', r.test, r.label;
    else v_fail := v_fail + 1; raise notice 'FAIL % % (%)', r.test, r.label, coalesce(r.detail, ''); end if;
  end loop;
  if v_all < 60 then raise exception '#4255 tester adversarial recorded only % checks', v_all; end if;
  if v_fail > 0 then raise exception '#4255 tester adversarial: % of % checks failed', v_fail, v_all; end if;
  raise notice '#4255 tester adversarial: % of % checks passed', v_all, v_all;
end;
$r$;

rollback;
