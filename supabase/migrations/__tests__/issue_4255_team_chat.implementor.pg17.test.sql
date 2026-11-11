-- Issue #4255 (Work board v2, wave W1b) -- implementor suite for
-- 20280611004255_issue_4255_team_chat_schema.sql and
-- 20280611014255_issue_4255_team_chat_functions.sql, on the fully replayed
-- PG17 schema.
-- MINGLA-INVARIANT: I-4255-TEAM-CHAT-MEMBER-AND-STAFF | issue #4255 | every team chat row (threads, members, messages, reactions, reads, attachments, team-files objects) is readable only by a live member of its thread whose confirmed address is active Admin staff at the moment of the read; clients never write the tables directly.
-- MINGLA-INVARIANT: I-4255-TEAM-CHAT-CONFIRMED-STAFF | issue #4255 | an account whose address matches a staff row but is not confirmed has no team chat access and never joins the Mingla team.
-- MINGLA-INVARIANT: I-4255-TEAM-CHAT-PT409 | issue #4255 | a team chat write that takes an expected revision refuses a stale one with SQLSTATE PT409 (never 40001).
-- MINGLA-INVARIANT: I-4255-TEAM-MENTION-PUSH | issue #4255 | a work-card notice to a confirmed staff member leaves exactly one in-app row (team_mentions), one email row (admin.team_mention, under the #4255 email rules) and one Host app push row (business.team_mention).
--
--   C-SEED    the three business.team_* categories (in-app and push, active);
--             the private team-files bucket with a 25 MB limit
--   C-SYNC    one Mingla team thread holding exactly the confirmed active
--             staff; a new teammate joins, a revoked one leaves, an account
--             joins when its address is confirmed
--   C-RLS     a host, an unconfirmed look-alike with a staff address, a
--             staff member outside a group, anon, and a revoked teammate
--             read nothing and call nothing; clients cannot write the tables
--   C-POST    post, unread, read, reply, edit (PT409 when stale), delete
--             (PT409 when stale; soft), reactions, a repeated request key
--   C-EVERY   @everyone: owner or admin only, not in a DM, once every 10
--             minutes (deleting does not reset it); each member told once
--   C-NOTIFY  group messages push only to mentions (or to people who switched
--             group message pushes on: business.team_group_message, #4255
--             fix-up 20280612004255); DMs push by default; preferences and mute
--             are respected; payloads carry ids only; deep links
--   C-CARD    a card-thread mention: one in-app, one email, one push row with
--             mingla-business://team/mention/<id>; no push for an
--             unconfirmed account; team_inbox lists team chat mentions
--   C-ATT     attachments: kinds, types, 25 MB, 10 per message, upload path
--             only for the uploader, storage read only for members while the
--             row is live, signed only after the upload, gone on delete
--   C-AGENT   a connected agent cannot post or start chats
--   C-GRANT   internal helpers and tables closed to clients; realtime
--
-- The Mingla team is synced from admin_team_directory() on every chat list
-- and Mingla team post (no trigger on the staff tables: #3802 pins them),
-- and at once when a sign-in account is confirmed or changes address.
--
-- FAILS-ON-REVERT (proved by deleting lines from the migrations, then
-- restoring): without the email_confirmed_at line in team_chat_staff, C-RLS
-- and C-SYNC fail (the look-alike reads the team chat and joins it); without
-- the business.team_mention insert in ops_notify_people, C-CARD fails (no
-- push row).
--
-- Run from the repository root as supabase_admin. Everything is rolled back.

\set ON_ERROR_STOP on
begin;

alter table auth.users add column if not exists email_confirmed_at timestamptz;

create temp table t43_people (who text primary key, id uuid not null, email text not null) on commit drop;
insert into t43_people (who, id, email) values
  ('owner', '42551000-0000-4000-a0f2-000000000001', 'oz.c4255@test.local'),
  ('admin', '42551000-0000-4000-a0f2-000000000002', 'ade.c4255@test.local'),
  ('gem',   '42551000-0000-4000-a0f2-000000000003', 'gem.c4255@test.local'),
  ('ray',   '42551000-0000-4000-a0f2-000000000004', 'ray.c4255@test.local'),
  ('rev',   '42551000-0000-4000-a0f2-000000000005', 'rev.c4255@test.local'),
  ('host',  '42551000-0000-4000-a0f2-000000000006', 'host.c4255@test.local'),
  ('look',  '42551000-0000-4000-a0f2-000000000007', 'tobi.c4255@test.local'),
  ('new',   '42551000-0000-4000-a0f2-000000000008', 'nia.c4255@test.local'),
  ('late',  '42551000-0000-4000-a0f2-000000000009', 'lat.c4255@test.local');
-- Everyone confirmed except the look-alike and the late joiner.
insert into auth.users (id, email, email_confirmed_at)
  select id, email, case when who in ('look', 'late') then null else now() end from t43_people where who <> 'new';
insert into public.admin_users (email, role, status, accepted_at) values
  ('oz.c4255@test.local', 'owner', 'active', now()),
  ('ade.c4255@test.local', 'admin', 'active', now());
-- tobi.c4255 is a real teammate's address who has not signed in yet; the
-- account above is someone else who signed up with it and never confirmed.
insert into public.admin_team_members (email, role, status, accepted_at) values
  ('gem.c4255@test.local', 'growth', 'active', now()),
  ('ray.c4255@test.local', 'growth', 'active', now()),
  ('rev.c4255@test.local', 'growth', 'active', now()),
  ('tobi.c4255@test.local', 'growth', 'active', now()),
  ('lat.c4255@test.local', 'growth', 'active', now());

create temp table t43_results (seq serial primary key, test text, label text, ok boolean, detail text) on commit drop;
create temp table t43_ids (k text primary key, id uuid not null) on commit drop;

create function pg_temp.as_(p_who text, p_sql text) returns text
language plpgsql as $fn$
declare v_id uuid; v_email text; v_out text;
begin
  select id, email into strict v_id, v_email from t43_people where who = p_who;
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

-- Earlier gateway rows belong to a finished request.
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

create function pg_temp.as_anon(p_sql text) returns text
language plpgsql as $fn$
declare v_out text;
begin
  begin
    set local role anon;
    perform set_config('request.jwt.claim.sub', '', true);
    perform set_config('request.jwt.claims', '{"role":"anon"}', true);
    execute p_sql into v_out;
    reset role;
    return v_out;
  exception when others then
    reset role;
    return 'ERR:' || sqlstate || ':' || sqlerrm;
  end;
end;
$fn$;

create function pg_temp.chk(p_test text, p_label text, p_got text, p_want text) returns void
language sql as $fn$
  insert into t43_results (test, label, ok, detail)
  values (p_test, p_label, p_got is not distinct from p_want,
          format('got %s, want %s', coalesce(left(p_got, 500), '<null>'), coalesce(p_want, '<null>')));
$fn$;
create function pg_temp.lk(p_test text, p_label text, p_got text, p_pattern text) returns void
language sql as $fn$
  insert into t43_results (test, label, ok, detail)
  values (p_test, p_label, coalesce(p_got like p_pattern, false),
          format('got %s, want like %s', coalesce(left(p_got, 500), '<null>'), p_pattern));
$fn$;

create function pg_temp.keep(p_k text, p_id uuid) returns uuid
language sql as $fn$ insert into t43_ids (k, id) values (p_k, p_id) on conflict (k) do update set id = excluded.id returning id $fn$;
create function pg_temp.id(p_k text) returns uuid language sql as $fn$ select id from t43_ids where k = p_k $fn$;
create function pg_temp.uid(p_who text) returns uuid language sql as $fn$ select id from t43_people where who = p_who $fn$;
create function pg_temp.rk() returns text language sql as $fn$ select 't43-' || md5(random()::text || clock_timestamp()::text) $fn$;
create function pg_temp.team() returns uuid language sql as $fn$ select id from public.team_threads where kind = 'team' $fn$;
create function pg_temp.mrev(p_id uuid) returns bigint language sql as $fn$ select revision from public.team_messages where id = p_id $fn$;
create function pg_temp.member(p_thread uuid, p_who text) returns text
language sql as $fn$
  select coalesce((select (left_at is null)::text from public.team_thread_members where thread_id = p_thread and user_id = pg_temp.uid(p_who)), 'none')
$fn$;
create function pg_temp.outbox(p_cat text, p_who text, p_message uuid) returns text
language sql as $fn$
  select count(*)::text from public.notification_outbox o
   where o.category_key = p_cat and o.user_id = pg_temp.uid(p_who) and o.payload->>'message_id' = p_message::text
$fn$;
-- Post as a person; keep the message id under p_k.
create function pg_temp.post(p_k text, p_who text, p_thread uuid, p_body text, p_mentions uuid[] default '{}',
                             p_reply uuid default null, p_files uuid[] default null, p_everyone boolean default false) returns text
language plpgsql as $fn$
declare v text;
begin
  v := pg_temp.person(p_who, format('select public.team_post(%L, %L, %L::uuid[], %L, %L::uuid[], %L, %L)::text',
                                    p_thread, p_body, p_mentions, p_reply, p_files, p_everyone, pg_temp.rk()));
  if v not like 'ERR:%' and p_k is not null then perform pg_temp.keep(p_k, ((v::jsonb)->'message'->>'id')::uuid); end if;
  return v;
end;
$fn$;

-- ───────────────────────────── C-SEED ─────────────────────────────
do $t$
begin
  perform pg_temp.chk('C-SEED', 'the three team categories are in-app and push, and active',
    (select string_agg(key || '=' || array_to_string(default_channels, '+') || ':' || active::text, ',' order by key)
       from public.notification_categories where key in ('business.team_message', 'business.team_mention', 'business.team_decision')),
    'business.team_decision=inapp+push:true,business.team_mention=inapp+push:true,business.team_message=inapp+push:true');
  perform pg_temp.chk('C-SEED', 'the drain would send these categories (can_send push, no preference)',
    public.can_send(pg_temp.uid('gem'), 'business.team_mention', 'push', null)::text || '/' ||
    public.can_send(pg_temp.uid('gem'), 'business.team_message', 'push', null)::text || '/' ||
    public.can_send(pg_temp.uid('gem'), 'business.team_decision', 'push', null)::text, 'true/true/true');
  -- The bucket's shape depends on the storage version (the migration probes it).
  perform pg_temp.chk('C-SEED', 'team-files is private with a 25 MB limit',
    (select coalesce(to_jsonb(b)->>'public', 'false') || '/' || coalesce(to_jsonb(b)->>'file_size_limit', '26214400')
       from storage.buckets b where b.id = 'team-files'), 'false/26214400');
end;
$t$;

-- ───────────────────────────── C-SYNC ─────────────────────────────
create function pg_temp.sync() returns void
language plpgsql as $fn$ begin perform pg_temp.person('gem', 'select public.team_list_threads()::text'); end; $fn$;

do $t$
declare v text;
begin
  -- The staff rows above were written after the accounts; the next chat list
  -- brings the Mingla team in line (no trigger sits on the staff tables).
  perform pg_temp.chk('C-SYNC', 'staff rows alone change nothing until a chat is listed', pg_temp.member(pg_temp.team(), 'gem'), 'none');
  perform pg_temp.sync();
  perform pg_temp.chk('C-SYNC', 'there is exactly one Mingla team thread',
    (select count(*)::text || '/' || min(title) from public.team_threads where kind = 'team'), '1/Mingla team');
  perform pg_temp.chk('C-SYNC', 'confirmed active staff are members; the host, the look-alike and the unconfirmed are not',
    pg_temp.member(pg_temp.team(), 'owner') || pg_temp.member(pg_temp.team(), 'admin') || pg_temp.member(pg_temp.team(), 'gem') ||
    pg_temp.member(pg_temp.team(), 'ray') || pg_temp.member(pg_temp.team(), 'rev') || '|' ||
    pg_temp.member(pg_temp.team(), 'host') || pg_temp.member(pg_temp.team(), 'look') || pg_temp.member(pg_temp.team(), 'late'),
    'truetruetruetruetrue|nonenonenone');
  -- A new teammate: the account first, then the staff row.
  insert into auth.users (id, email, email_confirmed_at) values (pg_temp.uid('new'), 'nia.c4255@test.local', now());
  perform pg_temp.chk('C-SYNC', 'an account alone is not a member', pg_temp.member(pg_temp.team(), 'new'), 'none');
  insert into public.admin_team_members (email, role, status, accepted_at) values ('nia.c4255@test.local', 'growth', 'active', now());
  perform pg_temp.sync();
  perform pg_temp.chk('C-SYNC', 'a new active staff row adds them', pg_temp.member(pg_temp.team(), 'new'), 'true');
  update public.admin_team_members set status = 'revoked', updated_at = now() where email = 'nia.c4255@test.local';
  perform pg_temp.sync();
  perform pg_temp.chk('C-SYNC', 'deactivating marks them left', pg_temp.member(pg_temp.team(), 'new'), 'false');
  update public.admin_team_members set status = 'active', updated_at = now() where email = 'nia.c4255@test.local';
  perform pg_temp.sync();
  perform pg_temp.chk('C-SYNC', 'reactivating brings them back', pg_temp.member(pg_temp.team(), 'new'), 'true');
  -- Confirming an address that is on a staff row joins the team at once
  -- (the sign-in account trigger), with no list in between.
  update auth.users set email_confirmed_at = now() where id = pg_temp.uid('late');
  perform pg_temp.chk('C-SYNC', 'confirming an address on a staff row joins the team', pg_temp.member(pg_temp.team(), 'late'), 'true');
  update auth.users set email = 'late.not.staff@test.local' where id = pg_temp.uid('late');
  perform pg_temp.chk('C-SYNC', 'changing to an address with no staff row leaves the team', pg_temp.member(pg_temp.team(), 'late'), 'false');
  v := pg_temp.person('gem', 'select jsonb_array_length(public.team_people())::text');
  perform pg_temp.chk('C-SYNC', 'the people list is the confirmed active staff', v, '6');
end;
$t$;

-- ───────────────────────────── C-POST ─────────────────────────────
do $t$
declare v text; v_team uuid := pg_temp.team(); v_m uuid; v_r uuid;
begin
  v := pg_temp.post('hello', 'gem', v_team, 'Morning team, the **venue** list is up.');
  v_m := pg_temp.id('hello');
  perform pg_temp.chk('C-POST', 'a teammate posts in the Mingla team', (v::jsonb)->'message'->>'body', 'Morning team, the **venue** list is up.');
  perform pg_temp.chk('C-POST', 'others see one unread; the author none',
    pg_temp.person('ray', $q$select (select x->>'unread' from jsonb_array_elements(public.team_list_threads()->'threads') x where x->>'kind' = 'team')$q$) || '/' ||
    pg_temp.person('gem', $q$select (select x->>'unread' from jsonb_array_elements(public.team_list_threads()->'threads') x where x->>'kind' = 'team')$q$), '1/0');
  perform pg_temp.chk('C-POST', 'the list preview names the message',
    pg_temp.person('ray', $q$select (select x->'last_message'->>'preview' from jsonb_array_elements(public.team_list_threads()->'threads') x where x->>'kind' = 'team')$q$),
    'Morning team, the **venue** list is up.');
  v := pg_temp.person('ray', format('select public.team_mark_read(%L)::text', v_team));
  perform pg_temp.chk('C-POST', 'reading clears the unread',
    pg_temp.person('ray', $q$select (select x->>'unread' from jsonb_array_elements(public.team_list_threads()->'threads') x where x->>'kind' = 'team')$q$), '0');
  v := pg_temp.post('reply', 'ray', v_team, 'Thanks!', '{}', v_m);
  v_r := pg_temp.id('reply');
  perform pg_temp.chk('C-POST', 'a reply points at its message', (v::jsonb)->'message'->'reply_to'->>'id', v_m::text);
  perform pg_temp.chk('C-POST', 'replying tells the author once (in-app and push)',
    (select count(*)::text from public.team_mentions where source_kind = 'team_message' and source_id = v_r and target_user_id = pg_temp.uid('gem'))
      || '/' || pg_temp.outbox('business.team_mention', 'gem', v_r), '1/1');
  v := pg_temp.person('gem', format('select public.team_edit(%L, %L, %s)::text', v_m, 'Edited', pg_temp.mrev(v_m) - 1));
  perform pg_temp.lk('C-POST', 'a stale edit is refused with PT409', v, 'ERR:PT409:stale_write:%');
  v := pg_temp.person('ray', format('select public.team_edit(%L, %L, %s)::text', v_m, 'Hijacked', pg_temp.mrev(v_m)));
  perform pg_temp.lk('C-POST', 'only the author edits', v, 'ERR:42501:forbidden:%');
  v := pg_temp.person('gem', format('select public.team_edit(%L, %L, %s)::text', v_m, 'Morning team, the venue list is up (v2).', pg_temp.mrev(v_m)));
  perform pg_temp.chk('C-POST', 'the author edits it', ((v::jsonb)->'message'->>'body') || '/' || ((v::jsonb)->'message'->>'edited_at' is not null)::text,
    'Morning team, the venue list is up (v2)./true');
  v := pg_temp.person('ray', format($q$select public.team_react(%L, '👍')::text$q$, v_m));
  v := pg_temp.person('admin', format($q$select public.team_react(%L, '👍')::text$q$, v_m));
  perform pg_temp.chk('C-POST', 'two reactions count as one emoji twice', (v::jsonb)->'message'->'reactions'->0->>'count', '2');
  v := pg_temp.person('admin', format($q$select public.team_react(%L, '👍', false)::text$q$, v_m));
  perform pg_temp.chk('C-POST', 'a reaction is taken back', (v::jsonb)->'message'->'reactions'->0->>'count', '1');
  v := pg_temp.person('ray', format($q$select public.team_react(%L, 'two words')::text$q$, v_m));
  perform pg_temp.lk('C-POST', 'a reaction is one emoji', v, 'ERR:22023:invalid_reaction:%');
  -- A repeated request key returns the same message, once.
  v := pg_temp.person('admin', format('select public.team_post(%L, %L, null, null, null, false, %L)::text', v_team, 'Once only', 't43-fixed-key-0001'));
  v := pg_temp.person('admin', format('select public.team_post(%L, %L, null, null, null, false, %L)::text', v_team, 'Once only', 't43-fixed-key-0001'));
  perform pg_temp.chk('C-POST', 'a repeated request key is a replay, not a second message',
    ((v::jsonb)->>'replayed') || '/' || (select count(*)::text from public.team_messages where author_id = pg_temp.uid('admin') and body_md = 'Once only'), 'true/1');
  v := pg_temp.person('gem', format('select public.team_post(%L, %L)::text', v_team, ''));
  perform pg_temp.lk('C-POST', 'an empty message is refused', v, 'ERR:22023:invalid_message:%');
  v := pg_temp.person('gem', format('select public.team_post(%L, %L)::text', v_team, repeat('x', 10001)));
  perform pg_temp.lk('C-POST', 'over 10,000 characters is refused', v, 'ERR:22023:invalid_message:%');
  v := pg_temp.person('gem', format('select public.team_delete(%L, %s)::text', v_m, pg_temp.mrev(v_m) - 1));
  perform pg_temp.lk('C-POST', 'a stale delete is refused with PT409', v, 'ERR:PT409:stale_write:%');
  v := pg_temp.person('gem', format('select public.team_delete(%L, %s)::text', v_m, pg_temp.mrev(v_m)));
  perform pg_temp.chk('C-POST', 'deleted: no words, no reactions, a stub in the chat',
    (select (deleted_at is not null)::text || '/' || body_md || '/' || (select count(*) from public.team_message_reactions r where r.message_id = v_m)::text from public.team_messages where id = v_m)
      || '|' || pg_temp.person('ray', format($q$select (select (x->>'deleted') || ':' || coalesce(x->>'body', 'none') from jsonb_array_elements(public.team_get_messages(%L)->'messages') x where (x->>'id')::uuid = %L)$q$, v_team, v_m)),
    'true//0|true:none');
  perform pg_temp.chk('C-POST', 'the reply now quotes a deleted message',
    pg_temp.person('ray', format($q$select (select x->'reply_to'->>'deleted' from jsonb_array_elements(public.team_get_messages(%L)->'messages') x where (x->>'id')::uuid = %L)$q$, v_team, v_r)), 'true');
end;
$t$;

-- ───────────────────────────── groups, DMs ─────────────────────────────
do $t$
declare v text; v_g uuid;
begin
  v := pg_temp.person('gem', format('select public.team_group_create(%L, %L::uuid[])::text', 'Lagos launch', array[pg_temp.uid('ray'), pg_temp.uid('admin')]));
  v_g := pg_temp.keep('group', ((v::jsonb)->'thread'->>'id')::uuid);
  perform pg_temp.chk('C-POST', 'a group has its creator (owner) and the people added',
    (select string_agg(t.who || ':' || m.role, ',' order by t.who) from public.team_thread_members m join t43_people t on t.id = m.user_id where m.thread_id = v_g and m.left_at is null),
    'admin:member,gem:owner,ray:member');
  v := pg_temp.person('gem', format('select public.team_group_create(%L, %L::uuid[])::text', 'With a host', array[pg_temp.uid('host')]));
  perform pg_temp.lk('C-POST', 'a host cannot be put in a team chat', v, 'ERR:22023:invalid_member:%');
  v := pg_temp.person('gem', format('select public.team_group_create(%L, %L::uuid[])::text', 'With a look-alike', array[pg_temp.uid('look')]));
  perform pg_temp.lk('C-POST', 'an unconfirmed look-alike cannot be put in a team chat', v, 'ERR:22023:invalid_member:%');
  v := pg_temp.person('ray', format('select public.team_group_update(%L, %L, %s)::text', v_g, 'Lagos launch week', (select revision from public.team_threads where id = v_g)));
  v := pg_temp.person('gem', format('select public.team_group_update(%L, %L, %s)::text', v_g, 'Stale name', (select revision from public.team_threads where id = v_g) - 1));
  perform pg_temp.lk('C-POST', 'a stale group rename is refused with PT409', v, 'ERR:PT409:stale_write:%');
  perform pg_temp.chk('C-POST', 'the rename stuck', (select title from public.team_threads where id = v_g), 'Lagos launch week');
  v := pg_temp.person('ray', format('select public.team_member_remove(%L, %L)::text', v_g, pg_temp.uid('admin')));
  perform pg_temp.lk('C-POST', 'a plain member cannot take someone else out', v, 'ERR:42501:forbidden:%');
  v := pg_temp.person('ray', format('select public.team_members_add(%L, %L::uuid[])::text', pg_temp.team(), array[pg_temp.uid('host')]));
  perform pg_temp.lk('C-POST', 'nobody adds people to the Mingla team by hand', v, 'ERR:22023:invalid_chat:%');
  v := pg_temp.person('gem', format('select public.team_dm_open(%L)::text', pg_temp.uid('ray')));
  perform pg_temp.keep('dm', ((v::jsonb)->'thread'->>'id')::uuid);
  v := pg_temp.person('ray', format('select public.team_dm_open(%L)::text', pg_temp.uid('gem')));
  perform pg_temp.chk('C-POST', 'a DM is one chat whoever opens it, titled with the other person',
    (((v::jsonb)->'thread'->>'id')::uuid = pg_temp.id('dm'))::text || '/' || ((v::jsonb)->'thread'->>'title'), 'true/Gem');
  v := pg_temp.person('gem', format('select public.team_dm_open(%L)::text', pg_temp.uid('host')));
  perform pg_temp.lk('C-POST', 'no DM with a host', v, 'ERR:22023:invalid_member:%');
  v := pg_temp.person('gem', format('select public.team_dm_open(%L)::text', pg_temp.uid('gem')));
  perform pg_temp.lk('C-POST', 'no DM with yourself', v, 'ERR:22023:invalid_member:%');
end;
$t$;

-- ───────────────────────────── C-RLS ─────────────────────────────
do $t$
declare v text; v_g uuid := pg_temp.id('group'); v_m uuid;
begin
  v := pg_temp.post('gmsg', 'gem', v_g, 'Group only: the budget is 2m.');
  v_m := pg_temp.id('gmsg');
  perform pg_temp.chk('C-RLS', 'a group member reads the group directly',
    pg_temp.person('ray', format('select count(*)::text from public.team_messages where thread_id = %L', v_g)), '1');
  perform pg_temp.chk('C-RLS', 'a staff member outside the group reads nothing of it',
    pg_temp.person('owner', format('select (select count(*) from public.team_messages where thread_id = %L) + (select count(*) from public.team_threads where id = %L) + (select count(*) from public.team_thread_members where thread_id = %L)', v_g, v_g, v_g)), '0');
  perform pg_temp.lk('C-RLS', 'and cannot open it through a function',
    pg_temp.person('owner', format('select public.team_get_messages(%L)::text', v_g)), 'ERR:P0002:not_found:%');
  perform pg_temp.lk('C-RLS', 'or post in it', pg_temp.post(null, 'owner', v_g, 'Let me in'), 'ERR:P0002:not_found:%');
  -- A host who is not staff.
  perform pg_temp.chk('C-RLS', 'a host reads no team chat rows',
    pg_temp.person('host', 'select ((select count(*) from public.team_messages) + (select count(*) from public.team_threads) + (select count(*) from public.team_thread_members) + (select count(*) from public.team_message_reactions) + (select count(*) from public.team_reads) + (select count(*) from public.team_message_attachments))::text'), '0');
  perform pg_temp.lk('C-RLS', 'a host calling the list is told the space is for the team',
    pg_temp.person('host', 'select public.team_list_threads()::text'), 'ERR:42501:team_access_required: This space is for the Mingla team.');
  perform pg_temp.chk('C-RLS', 'a host''s badge says not staff, without an error',
    pg_temp.person('host', 'select public.team_badge()::text'), '{"admin": false, "chats": 0, "staff": false, "total": 0, "mentions": 0, "messages": 0}');
  -- The unconfirmed look-alike with a staff address.
  perform pg_temp.chk('C-RLS', 'the unconfirmed look-alike reads no team chat rows',
    pg_temp.person('look', 'select ((select count(*) from public.team_messages) + (select count(*) from public.team_threads))::text'), '0');
  perform pg_temp.lk('C-RLS', 'the look-alike cannot list, read or post',
    pg_temp.person('look', 'select public.team_list_threads()::text') || '|' ||
    pg_temp.person('look', format('select public.team_get_messages(%L)::text', pg_temp.team())) || '|' ||
    pg_temp.post(null, 'look', pg_temp.team(), 'hello'),
    'ERR:42501:team_access_required%|ERR:42501:team_access_required%|ERR:42501:team_access_required%');
  perform pg_temp.chk('C-RLS', 'the look-alike''s badge says not staff', pg_temp.person('look', $q$select public.team_badge()->>'staff'$q$), 'false');
  -- anon.
  perform pg_temp.lk('C-RLS', 'anon cannot read the tables', pg_temp.as_anon('select count(*)::text from public.team_messages'), 'ERR:42501:%');
  perform pg_temp.lk('C-RLS', 'anon cannot call the functions', pg_temp.as_anon('select public.team_badge()::text'), 'ERR:42501:%');
  -- No client writes.
  perform pg_temp.lk('C-RLS', 'a member cannot insert a message directly',
    pg_temp.person('gem', format($q$insert into public.team_messages (thread_id, author_id, body_md) values (%L, %L, 'direct') returning id::text$q$, v_g, pg_temp.uid('gem'))), 'ERR:42501:%');
  perform pg_temp.lk('C-RLS', 'a member cannot rewrite membership directly',
    pg_temp.person('gem', format($q$update public.team_thread_members set role = 'owner' where thread_id = %L returning 'x'$q$, v_g)), 'ERR:42501:%');
  -- A revoked teammate loses access at once.
  perform pg_temp.chk('C-RLS', 'before: the teammate reads the Mingla team',
    (pg_temp.person('rev', format('select count(*)::text from public.team_messages where thread_id = %L', pg_temp.team()))::integer > 0)::text, 'true');
  update public.admin_team_members set status = 'revoked', updated_at = now() where email = 'rev.c4255@test.local';
  perform pg_temp.chk('C-RLS', 'revoked: reads nothing at once',
    pg_temp.person('rev', format('select count(*)::text from public.team_messages where thread_id = %L', pg_temp.team())), '0');
  perform pg_temp.lk('C-RLS', 'revoked: cannot post or list',
    pg_temp.post(null, 'rev', pg_temp.team(), 'still here?') || '|' || pg_temp.person('rev', 'select public.team_list_threads()::text'),
    'ERR:42501:team_access_required%|ERR:42501:team_access_required%');
  perform pg_temp.chk('C-RLS', 'revoked: still a member row until the next sync, and reads nothing anyway', pg_temp.member(pg_temp.team(), 'rev'), 'true');
  perform pg_temp.sync();
  perform pg_temp.chk('C-RLS', 'revoked: left the Mingla team at the next list', pg_temp.member(pg_temp.team(), 'rev'), 'false');
  -- Even with a live membership row left behind (a group), staff is checked on every read.
  insert into public.team_thread_members (thread_id, user_id, role) values (v_g, pg_temp.uid('rev'), 'member');
  perform pg_temp.chk('C-RLS', 'revoked: a leftover group membership still reads nothing',
    pg_temp.person('rev', format('select count(*)::text from public.team_messages where thread_id = %L', v_g)), '0');
  delete from public.team_thread_members where thread_id = v_g and user_id = pg_temp.uid('rev');
end;
$t$;

-- ───────────────────────────── C-EVERY ─────────────────────────────
do $t$
declare v text; v_team uuid := pg_temp.team(); v_m uuid;
begin
  v := pg_temp.post(null, 'gem', v_team, 'Hello all', '{}', null, null, true);
  perform pg_temp.lk('C-EVERY', 'a growth teammate cannot mention everyone', v, 'ERR:42501:forbidden: Only the owner or an admin can mention everyone.');
  v := pg_temp.person('owner', format('select public.team_dm_open(%L)::text', pg_temp.uid('admin')));
  v := pg_temp.post(null, 'owner', ((v::jsonb)->'thread'->>'id')::uuid, 'x', '{}', null, null, true);
  perform pg_temp.lk('C-EVERY', 'not in a DM', v, 'ERR:22023:invalid_message: Everyone works in a group%');
  v := pg_temp.post('every', 'owner', v_team, 'All hands at 3pm.', '{}', null, null, true);
  v_m := pg_temp.id('every');
  perform pg_temp.chk('C-EVERY', 'the owner mentions everyone: each other member told once (in-app and push)',
    (select count(*)::text from public.team_mentions where source_kind = 'team_message' and source_id = v_m) || '/' ||
    (select count(*)::text from public.notification_outbox where category_key = 'business.team_mention' and payload->>'message_id' = v_m::text) || '/' ||
    (select count(*)::text from public.team_thread_members where thread_id = v_team and left_at is null and user_id <> pg_temp.uid('owner')),
    '4/4/4');
  perform pg_temp.chk('C-EVERY', 'the author is not told', pg_temp.outbox('business.team_mention', 'owner', v_m), '0');
  perform pg_temp.chk('C-EVERY', 'the push says why', (select string_agg(distinct payload->>'reason', ',') from public.notification_outbox where payload->>'message_id' = v_m::text), 'everyone');
  v := pg_temp.post(null, 'owner', v_team, 'Again!', '{}', null, null, true);
  perform pg_temp.lk('C-EVERY', 'a second everyone within 10 minutes is refused', v, 'ERR:22023:too_soon:%');
  v := pg_temp.person('owner', format('select public.team_delete(%L, %s)::text', v_m, pg_temp.mrev(v_m)));
  v := pg_temp.post(null, 'owner', v_team, 'Deleted it, again!', '{}', null, null, true);
  perform pg_temp.lk('C-EVERY', 'deleting the message does not reset the limit', v, 'ERR:22023:too_soon:%');
  update public.team_messages set created_at = created_at - interval '11 minutes' where id = v_m;
  v := pg_temp.post('every2', 'owner', v_team, 'Eleven minutes later.', '{}', null, null, true);
  perform pg_temp.chk('C-EVERY', 'after 10 minutes it works again', (v::jsonb)->'message'->>'everyone', 'true');
  v := pg_temp.post('every3', 'admin', pg_temp.id('group'), 'Group, everyone.', '{}', null, null, true);
  perform pg_temp.chk('C-EVERY', 'an admin mentions everyone in a group they are in', (v::jsonb)->>'told', '2');
end;
$t$;

-- ───────────────────────────── C-NOTIFY ─────────────────────────────
do $t$
declare v text; v_g uuid := pg_temp.id('group'); v_dm uuid := pg_temp.id('dm'); v_m uuid; r record;
begin
  -- Group: a plain message pushes nobody by default.
  v := pg_temp.post('g1', 'gem', v_g, 'Plain group update');
  v_m := pg_temp.id('g1');
  perform pg_temp.chk('C-NOTIFY', 'a plain group message queues nothing by default',
    (select count(*)::text from public.notification_outbox where payload->>'message_id' = v_m::text), '0');
  -- A mention in a group: in-app and push, exactly once.
  v := pg_temp.post('g2', 'gem', v_g, 'Ray, can you check?', array[pg_temp.uid('ray')]);
  v_m := pg_temp.id('g2');
  perform pg_temp.chk('C-NOTIFY', 'a mention in a group: one in-app row and one push, nobody else',
    (select count(*)::text from public.team_mentions where source_kind = 'team_message' and source_id = v_m and target_user_id = pg_temp.uid('ray')) || '/' ||
    pg_temp.outbox('business.team_mention', 'ray', v_m) || '/' ||
    (select count(*)::text from public.notification_outbox where payload->>'message_id' = v_m::text and user_id <> pg_temp.uid('ray')), '1/1/0');
  perform pg_temp.chk('C-NOTIFY', 'running the producer again adds nothing', public.team_chat_enqueue(v_m)::text || '/' || pg_temp.outbox('business.team_mention', 'ray', v_m), '0/1');
  select o.* into r from public.notification_outbox o where o.category_key = 'business.team_mention' and o.payload->>'message_id' = v_m::text;
  perform pg_temp.chk('C-NOTIFY', 'the push carries ids only, no country, and opens the thread',
    (select string_agg(k, ',' order by k collate "C") from jsonb_object_keys(r.payload) k) || '|' || coalesce(r.country_code, 'null') || '|' ||
    ((r.payload->>'deep_link') = 'mingla-business://team/' || v_g::text)::text,
    'actor_user_id,attachment_count,attachment_kind,deep_link,mention_id,message_id,reason,source_kind,thread_id,thread_kind|null|true');
  perform pg_temp.chk('C-NOTIFY', 'the payload never carries the words', (r.payload::text like '%can you check%')::text, 'false');
  v := pg_temp.post(null, 'gem', v_g, 'Mention a host', array[pg_temp.uid('host')]);
  perform pg_temp.lk('C-NOTIFY', 'only people in the chat can be mentioned', v, 'ERR:22023:invalid_mention_recipient:%');
  v := pg_temp.post(null, 'gem', v_g, 'Mention an outsider', array[pg_temp.uid('owner')]);
  perform pg_temp.lk('C-NOTIFY', 'a teammate outside the group cannot be mentioned into it', v, 'ERR:22023:invalid_mention_recipient:%');
  -- Switching group message pushes on (#4255 fix-up: groups have their own
  -- category, business.team_group_message; 20280612004255).
  insert into public.notification_channel_prefs (user_id, category_key, channel, enabled) values (pg_temp.uid('ray'), 'business.team_group_message', 'push', true);
  v := pg_temp.post('g3', 'gem', v_g, 'Second plain update');
  v_m := pg_temp.id('g3');
  perform pg_temp.chk('C-NOTIFY', 'after switching message pushes on, only that person is queued',
    pg_temp.outbox('business.team_group_message', 'ray', v_m) || '/' || pg_temp.outbox('business.team_group_message', 'admin', v_m), '1/0');
  -- Muting the group stops message pushes but not mentions.
  v := pg_temp.person('ray', format('select public.team_mute(%L, true)::text', v_g));
  v := pg_temp.post('g4', 'gem', v_g, 'Muted update');
  v := pg_temp.post('g5', 'gem', v_g, 'Ray, still you', array[pg_temp.uid('ray')]);
  perform pg_temp.chk('C-NOTIFY', 'muted: no message push, but a mention still pushes',
    pg_temp.outbox('business.team_group_message', 'ray', pg_temp.id('g4')) || '/' || pg_temp.outbox('business.team_mention', 'ray', pg_temp.id('g5')), '0/1');
  perform pg_temp.chk('C-NOTIFY', 'a muted chat is left out of the badge chats',
    (pg_temp.person('ray', $q$select (public.team_badge()->>'chats')$q$)::integer
       < pg_temp.person('ray', $q$select count(*)::text from jsonb_array_elements(public.team_list_threads()->'threads') x where (x->>'unread')::int > 0$q$)::integer)::text,
    'true');
  v := pg_temp.person('ray', format('select public.team_mute(%L, false)::text', v_g));
  -- DMs push by default.
  v := pg_temp.post('d1', 'gem', v_dm, 'Quick one');
  perform pg_temp.chk('C-NOTIFY', 'a DM pushes the other person by default',
    pg_temp.outbox('business.team_message', 'ray', pg_temp.id('d1')) || '/' ||
    (select (payload->>'deep_link' = 'mingla-business://team/' || v_dm::text)::text from public.notification_outbox where category_key = 'business.team_message' and payload->>'message_id' = pg_temp.id('d1')::text), '1/true');
  -- Preferences: both kinds of delivery off for DMs means nothing is queued.
  insert into public.notification_channel_prefs (user_id, category_key, channel, enabled) values
    (pg_temp.uid('gem'), 'business.team_message', 'push', false), (pg_temp.uid('gem'), 'business.team_message', 'inapp', false);
  v := pg_temp.post('d2', 'ray', v_dm, 'Reply in the DM');
  perform pg_temp.chk('C-NOTIFY', 'a DM to someone who switched message notices off queues nothing',
    pg_temp.outbox('business.team_message', 'gem', pg_temp.id('d2')), '0');
  insert into public.notification_channel_prefs (user_id, category_key, channel, enabled) values
    (pg_temp.uid('admin'), 'business.team_mention', 'push', false), (pg_temp.uid('admin'), 'business.team_mention', 'inapp', false);
  v := pg_temp.post('g6', 'gem', v_g, 'Admin, a mention', array[pg_temp.uid('admin')]);
  perform pg_temp.chk('C-NOTIFY', 'mention notices off: the in-app mention stays, no outbox row',
    (select count(*)::text from public.team_mentions where source_kind = 'team_message' and source_id = pg_temp.id('g6') and target_user_id = pg_temp.uid('admin')) || '/' ||
    pg_temp.outbox('business.team_mention', 'admin', pg_temp.id('g6')), '1/0');
  -- The badge: unread chats plus unread mentions, and reading clears it.
  perform pg_temp.chk('C-NOTIFY', 'the badge counts unread chats and unread mentions',
    pg_temp.person('ray', $q$select (public.team_badge()->>'total')::int = (public.team_badge()->>'chats')::int + (public.team_badge()->>'mentions')::int and (public.team_badge()->>'mentions')::int >= 2$q$), 'true');
  v := pg_temp.person('ray', format('select public.team_mark_read(%L)::text', v_g));
  perform pg_temp.chk('C-NOTIFY', 'reading the group marks its mentions read', (v::jsonb)->>'mentions_read', '3');
end;
$t$;

-- ───────────────────────────── C-CARD ─────────────────────────────
do $t$
declare v text; v_card uuid; v_ev uuid; v_mention uuid;
begin
  v := pg_temp.person('gem', format('select public.ops_work_add(%L::jsonb, %L)::text',
    jsonb_build_array(jsonb_build_object('title', 'C4255 chat card', 'instructions', 'Do the work carefully and say what changed.',
      'done_means', 'It is done and checked.', 'owners', jsonb_build_array('gem.c4255@test.local'), 'due_on', (now() at time zone 'UTC')::date + 3)), pg_temp.rk()));
  v_card := ((v::jsonb)->'results'->0->'card'->>'id')::uuid;
  v := pg_temp.person('gem', format($q$select public.ops_message_post(%L, 'Ray, the run sheet please', array['ray.c4255@test.local'], null, null, false, %L)::text$q$, v_card, pg_temp.rk()));
  v_ev := ((v::jsonb)->>'event_id')::uuid;
  select id into v_mention from public.team_mentions where source_kind = 'work_card' and source_id = v_ev and target_user_id = pg_temp.uid('ray');
  perform pg_temp.chk('C-CARD', 'a card mention: one in-app, one email, one Host app push',
    (select count(*)::text from public.team_mentions where source_kind = 'work_card' and source_id = v_ev and target_user_id = pg_temp.uid('ray')) || '/' ||
    (select count(*)::text from public.notification_outbox where category_key = 'admin.team_mention' and user_id = pg_temp.uid('ray') and payload->>'source_id' = v_ev::text) || '/' ||
    (select count(*)::text from public.notification_outbox where category_key = 'business.team_mention' and user_id = pg_temp.uid('ray') and payload->>'source_id' = v_ev::text),
    '1/1/1');
  perform pg_temp.chk('C-CARD', 'the push opens Mentions at that mention, ids only',
    (select (payload->>'deep_link') || '|' || (payload->>'card_id') || '|' || (payload ? 'title')::text || '|' || (payload ? 'body')::text
       from public.notification_outbox where category_key = 'business.team_mention' and user_id = pg_temp.uid('ray') and payload->>'source_id' = v_ev::text),
    'mingla-business://team/mention/' || v_mention::text || '|' || v_card::text || '|false|false');
  perform pg_temp.chk('C-CARD', 'the email row is unchanged (#4255 subject)',
    (select payload->>'title' from public.notification_outbox where category_key = 'admin.team_mention' and user_id = pg_temp.uid('ray') and payload->>'source_id' = v_ev::text),
    public.ops_actor_label('gem.c4255@test.local', NULL) || ' tagged you: C4255 chat card');
  -- The look-alike holds a staff address but never confirmed: today's
  -- in-app and email rules are untouched, and no push reaches that account.
  v := pg_temp.person('gem', format($q$select public.ops_message_post(%L, 'Tobi, see this', array['tobi.c4255@test.local'], null, null, false, %L)::text$q$, v_card, pg_temp.rk()));
  v_ev := ((v::jsonb)->>'event_id')::uuid;
  perform pg_temp.chk('C-CARD', 'no Host app push to an unconfirmed account',
    (select count(*)::text from public.notification_outbox where category_key = 'business.team_mention' and payload->>'source_id' = v_ev::text), '0');
  -- team_inbox lists team chat mentions with their chat.
  perform pg_temp.chk('C-CARD', 'team_inbox lists a team chat mention with its chat',
    pg_temp.person('ray', format($q$select (select x->>'thread_id' || '/' || (x->>'kind') from jsonb_array_elements(public.team_inbox()->'mentions') x where x->>'source_kind' = 'team_message' and (x->>'message_id')::uuid = %L)$q$, pg_temp.id('g2'))),
    pg_temp.id('group')::text || '/mention');
  perform pg_temp.chk('C-CARD', 'team_inbox still lists the card mention',
    pg_temp.person('ray', format($q$select count(*)::text from jsonb_array_elements(public.team_inbox()->'mentions') x where (x->>'id')::uuid = %L$q$, v_mention)), '1');
  perform pg_temp.chk('C-CARD', 'team_inbox lists a reply mention while the reply is there',
    pg_temp.person('gem', format($q$select count(*)::text from jsonb_array_elements(public.team_inbox()->'mentions') x where (x->>'message_id')::uuid = %L$q$, pg_temp.id('reply'))), '1');
  v := pg_temp.person('ray', format('select public.team_delete(%L, %s)::text', pg_temp.id('reply'), pg_temp.mrev(pg_temp.id('reply'))));
  perform pg_temp.chk('C-CARD', 'after the delete it is gone from the inbox',
    pg_temp.person('gem', format($q$select count(*)::text from jsonb_array_elements(public.team_inbox()->'mentions') x where (x->>'message_id')::uuid = %L$q$, pg_temp.id('reply'))), '0');
end;
$t$;

-- ───────────────────────────── C-ATT ─────────────────────────────
do $t$
declare v text; v_g uuid := pg_temp.id('group'); v_a uuid; v_path text; v_l uuid; v_ids uuid[] := '{}'; i integer; v_m uuid;
begin
  v := pg_temp.person('gem', format($q$select public.team_attachment_add(%L, '{"kind":"document","name":"Budget.pdf","mime":"application/pdf","size_bytes":26214401}'::jsonb)::text$q$, v_g));
  perform pg_temp.chk('C-ATT', 'a file over 25 MB is refused before upload', v, 'ERR:22023:file_too_big: Budget.pdf is over 25 MB. Share it as a link instead.');
  v := pg_temp.person('gem', format($q$select public.team_attachment_add(%L, '{"kind":"image","name":"poster.svg","mime":"image/svg+xml","size_bytes":2000}'::jsonb)::text$q$, v_g));
  perform pg_temp.lk('C-ATT', 'a picture type chats do not take is refused', v, 'ERR:22023:invalid_file: Photos can be%');
  v := pg_temp.person('gem', format($q$select public.team_attachment_add(%L, '{"kind":"video","name":"clip.mp4","mime":"video/mp4","size_bytes":2000}'::jsonb)::text$q$, v_g));
  perform pg_temp.lk('C-ATT', 'only photos, documents and links', v, 'ERR:22023:invalid_file: An attachment is%');
  v := pg_temp.person('gem', format($q$select public.team_attachment_add(%L, '{"kind":"link","url":"http://example.com"}'::jsonb)::text$q$, v_g));
  perform pg_temp.lk('C-ATT', 'a link must be https', v, 'ERR:22023:invalid_file: Links start with https://%');
  v := pg_temp.person('gem', format($q$select public.team_attachment_add(%L, '{"kind":"image","name":"Stage plan.jpg","mime":"image/jpeg","size_bytes":26214400,"width":1200,"height":800}'::jsonb)::text$q$, v_g));
  v_a := ((v::jsonb)->'attachment'->>'id')::uuid;
  v_path := (v::jsonb)->'upload'->>'path';
  perform pg_temp.chk('C-ATT', 'exactly 25 MB is taken, with a private path that starts with the chat',
    ((v::jsonb)->'upload'->>'bucket') || '/' || (v_path = v_g::text || '/' || v_a::text || '/Stage_plan.jpg')::text, 'team-files/true');
  v := pg_temp.post(null, 'gem', v_g, 'Plan attached', '{}', null, array[v_a]);
  perform pg_temp.lk('C-ATT', 'not postable before the upload is there', v, 'ERR:22023:invalid_message: An attachment is not in this chat%');
  perform pg_temp.lk('C-ATT', 'another member cannot upload to that path',
    pg_temp.person('ray', format($q$insert into storage.objects (bucket_id, name) values ('team-files', %L) returning name$q$, v_path)), 'ERR:42501:%');
  perform pg_temp.lk('C-ATT', 'nobody uploads outside an issued path',
    pg_temp.person('gem', format($q$insert into storage.objects (bucket_id, name) values ('team-files', %L) returning name$q$, v_g::text || '/' || gen_random_uuid()::text || '/x.jpg')), 'ERR:42501:%');
  perform pg_temp.chk('C-ATT', 'the uploader uploads to the issued path',
    pg_temp.person('gem', format($q$insert into storage.objects (bucket_id, name) values ('team-files', %L) returning name$q$, v_path)), v_path);
  perform pg_temp.lk('C-ATT', 'not signed for others before it is posted',
    pg_temp.person('ray', format('select public.team_attachment_sign(%L)::text', v_a)), 'ERR:P0002:%');
  v := pg_temp.person('gem', format($q$select public.team_attachment_add(%L, '{"kind":"link","url":"https://docs.google.com/document/d/abc"}'::jsonb)::text$q$, v_g));
  v_l := ((v::jsonb)->'attachment'->>'id')::uuid;
  perform pg_temp.chk('C-ATT', 'a link is named after its site', (v::jsonb)->'attachment'->>'name', 'docs.google.com');
  v := pg_temp.post('att', 'gem', v_g, '', '{}', null, array[v_a, v_l]);
  v_m := pg_temp.id('att');
  perform pg_temp.chk('C-ATT', 'a message can be attachments only',
    jsonb_array_length((v::jsonb)->'message'->'attachments')::text || '/' || coalesce((v::jsonb)->'message'->>'body', ''), '2/');
  perform pg_temp.chk('C-ATT', 'the chat list says Document for a mixed message with no words',
    pg_temp.person('ray', format($q$select (select x->'last_message'->>'preview' from jsonb_array_elements(public.team_list_threads()->'threads') x where (x->>'id')::uuid = %L)$q$, v_g)), 'Document');
  v := pg_temp.person('ray', format('select public.team_attachment_sign(%L)::text', v_a));
  perform pg_temp.chk('C-ATT', 'a member gets the path to sign for 5 minutes', ((v::jsonb)->>'path' = v_path)::text || '/' || ((v::jsonb)->>'expires_in'), 'true/300');
  perform pg_temp.chk('C-ATT', 'storage lets a member read it',
    pg_temp.person('ray', format($q$select count(*)::text from storage.objects where bucket_id = 'team-files' and name = %L$q$, v_path)), '1');
  perform pg_temp.chk('C-ATT', 'storage does not let a staff member outside the chat read it',
    pg_temp.person('owner', format($q$select count(*)::text from storage.objects where bucket_id = 'team-files' and name = %L$q$, v_path)), '0');
  perform pg_temp.lk('C-ATT', 'nor sign it', pg_temp.person('owner', format('select public.team_attachment_sign(%L)::text', v_a)), 'ERR:P0002:%');
  perform pg_temp.chk('C-ATT', 'storage does not let a host read it',
    pg_temp.person('host', format($q$select count(*)::text from storage.objects where bucket_id = 'team-files' and name = %L$q$, v_path)), '0');
  v := pg_temp.post(null, 'gem', v_g, 'Again', '{}', null, array[v_a]);
  perform pg_temp.lk('C-ATT', 'an attachment goes in one message only', v, 'ERR:22023:invalid_message:%');
  perform pg_temp.chk('C-ATT', 'the push says what was sent, not what is in it',
    (select (payload->>'attachment_count') || '/' || (payload->>'attachment_kind') || '/' || (payload::text like '%docs.google%')::text
       from public.notification_outbox where payload->>'message_id' = v_m::text and user_id = pg_temp.uid('ray')), '2/mixed/false');
  for i in 1..11 loop
    v := pg_temp.person('gem', format($q$select public.team_attachment_add(%L, '{"kind":"link","url":"https://example.com/%s"}'::jsonb)::text$q$, v_g, i));
    v_ids := v_ids || ((v::jsonb)->'attachment'->>'id')::uuid;
  end loop;
  v := pg_temp.post(null, 'gem', v_g, 'Eleven links', '{}', null, v_ids);
  perform pg_temp.lk('C-ATT', 'more than 10 attachments in a message is refused', v, 'ERR:22023:too_many_files:%');
  v := pg_temp.person('gem', format('select public.team_delete(%L, %s)::text', v_m, pg_temp.mrev(v_m)));
  perform pg_temp.chk('C-ATT', 'deleting the message stops its files being served at once',
    pg_temp.person('ray', format('select public.team_attachment_sign(%L)::text', v_a)) || '|' ||
    pg_temp.person('ray', format($q$select count(*)::text from storage.objects where bucket_id = 'team-files' and name = %L$q$, v_path)),
    'ERR:P0002:not_found: That file is no longer here.|0');
end;
$t$;

-- ───────────────────────────── C-AGENT ─────────────────────────────
do $t$
declare v text;
begin
  v := pg_temp.as_('gem', format($q$select public.team_post(%L, 'Agent hello')::text$q$, pg_temp.team()));
  perform pg_temp.chk('C-AGENT', 'control: the person posts', (v not like 'ERR:%')::text, 'true');
  perform pg_temp.next_request();
  insert into public.team_agent_calls (key_id, owner_email, actor_uid, agent, tool, xact_id, started_at)
  values (gen_random_uuid(), 'gem.c4255@test.local', pg_temp.uid('gem'), 'claude', 'post_message', pg_current_xact_id(), clock_timestamp());
  perform pg_temp.lk('C-AGENT', 'a connected agent cannot post, start a DM or a group',
    pg_temp.as_('gem', format($q$select public.team_post(%L, 'Agent hello')::text$q$, pg_temp.team())) || '|' ||
    pg_temp.as_('gem', format('select public.team_dm_open(%L)::text', pg_temp.uid('admin'))) || '|' ||
    pg_temp.as_('gem', $q$select public.team_group_create('Agents')::text$q$),
    'ERR:42501:agents_cannot_post%|ERR:42501:agents_cannot_post%|ERR:42501:agents_cannot_post%');
  perform pg_temp.next_request();
end;
$t$;

-- ───────────────────────────── C-GRANT ─────────────────────────────
do $t$
declare t text; v_bad text;
begin
  foreach t in array array['team_threads','team_thread_members','team_messages','team_message_reactions','team_reads','team_message_attachments'] loop
    perform pg_temp.chk('C-GRANT', t || ': RLS on; clients read only; anon nothing',
      (select relrowsecurity::text from pg_class where oid = ('public.' || t)::regclass) || '/' ||
      has_table_privilege('authenticated', 'public.' || t, 'SELECT')::text || '/' ||
      (has_table_privilege('authenticated', 'public.' || t, 'INSERT') or has_table_privilege('authenticated', 'public.' || t, 'UPDATE')
       or has_table_privilege('authenticated', 'public.' || t, 'DELETE'))::text || '/' ||
      has_table_privilege('anon', 'public.' || t, 'SELECT')::text,
      'true/true/false/false');
  end loop;
  select string_agg(p.oid::regprocedure::text, ', ') into v_bad
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and (p.proname like 'team\_%' or p.proname like 'team_chat%')
     and p.proname not like 'team\_agent%' and p.proname not like 'team\_draft%' and p.proname not like 'team\_inbox%'
     and p.prorettype <> 'pg_catalog.trigger'::regtype and has_function_privilege('anon', p.oid, 'EXECUTE');
  perform pg_temp.chk('C-GRANT', 'anon executes no team chat function', v_bad, null);
  perform pg_temp.chk('C-GRANT', 'internal helpers are not callable by clients',
    has_function_privilege('authenticated', 'public.team_chat_enqueue(uuid)', 'EXECUTE')::text || '/' ||
    has_function_privilege('authenticated', 'public.team_chat_staff(uuid)', 'EXECUTE')::text || '/' ||
    has_function_privilege('authenticated', 'public.team_chat_sync_team()', 'EXECUTE')::text || '/' ||
    has_function_privilege('authenticated', 'public.team_chat_ctx(boolean)', 'EXECUTE')::text || '/' ||
    has_function_privilege('authenticated', 'public.team_post(uuid, text, uuid[], uuid, uuid[], boolean, text)', 'EXECUTE')::text,
    'false/false/false/false/true');
  select string_agg(p.proname, ', ') into v_bad
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname like 'team\_%' and p.prosecdef
     and not exists (select 1 from unnest(coalesce(p.proconfig, '{}'::text[])) c where c like 'search_path=%')
     and p.proname not like 'team\_agent%' and p.proname not like 'team\_draft%';
  perform pg_temp.chk('C-GRANT', 'every SECURITY DEFINER team function pins its search_path', v_bad, null);
  perform pg_temp.chk('C-GRANT', 'realtime publishes the member-scoped tables only',
    case when exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
      (select string_agg(tablename, ',' order by tablename) from pg_publication_tables
        where pubname = 'supabase_realtime' and schemaname = 'public' and tablename like 'team\_%' and tablename <> 'team_mentions')
    else 'team_message_reactions,team_messages,team_thread_members,team_threads' end,
    'team_message_reactions,team_messages,team_thread_members,team_threads');
end;
$t$;

-- ───────────────────────────── report ─────────────────────────────
do $r$
declare r record; v_fail integer := 0; v_all integer := 0;
begin
  for r in select * from t43_results order by seq loop
    v_all := v_all + 1;
    if r.ok then raise notice 'PASS % %', r.test, r.label;
    else v_fail := v_fail + 1; raise notice 'FAIL % % (%)', r.test, r.label, coalesce(r.detail, ''); end if;
  end loop;
  if v_all < 80 then raise exception '#4255 team chat recorded only % checks', v_all; end if;
  if v_fail > 0 then raise exception '#4255 team chat: % of % checks failed', v_fail, v_all; end if;
  raise notice '#4255 team chat: % of % checks passed', v_all, v_all;
end;
$r$;

rollback;
