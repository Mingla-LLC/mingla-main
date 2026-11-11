-- Issue #4255 (Work board v2 + Mingla team) fix-up -- implementor suite for
-- 20280614044255_issue_4255_team_chat_fixups.sql, on the fully replayed PG17
-- schema.
-- MINGLA-INVARIANT: I-4255-TEAM-EVERYONE-ADMIN-FLAG | issue #4255 | team_badge says admin true only for a confirmed, active owner or admin (team_chat_admin, the rule team_post enforces for @everyone); everyone else, and anyone who is not staff, reads admin false.
-- MINGLA-INVARIANT: I-4255-TEAM-GROUP-PUSH-SPLIT | issue #4255 | a plain message in a group or the Mingla team is queued only as business.team_group_message and only for a member who switched that category's push on (never while muted); a DM is queued only as business.team_message (on by default); neither switch moves the other.
--
--   F-SEED    business.team_group_message is in-app and push, and active
--   F-BADGE   owner and admin read admin true; a growth teammate false; a host
--             (not staff) staff false and admin false; the flag matches who
--             team_post lets mention everyone
--   F-GROUP   group pushes: off by default; the DM switch (old meaning
--             "groups too") no longer turns them on; the group switch does,
--             under its own category and idempotency key; muting still stops
--             them; the Mingla team follows the same switch
--   F-DM      DMs: on by default under business.team_message; switching
--             group pushes on or DMs off does not move the other
--
-- FAILS-ON-REVERT (proved by deleting the fix lines from the migration,
-- re-applying it, running this suite, then restoring): without B2 in
-- team_badge, F-BADGE fails (no admin key); without E1/E2 in
-- team_chat_enqueue, F-GROUP and F-DM fail (groups follow the DM switch and
-- are queued as business.team_message).
--
-- Run from the repository root as supabase_admin. Everything is rolled back.

\set ON_ERROR_STOP on
begin;

alter table auth.users add column if not exists email_confirmed_at timestamptz;

create temp table t44_people (who text primary key, id uuid not null, email text not null) on commit drop;
insert into t44_people (who, id, email) values
  ('owner', '42552000-0000-4000-a0f2-000000000001', 'oz.f4255@test.local'),
  ('admin', '42552000-0000-4000-a0f2-000000000002', 'ade.f4255@test.local'),
  ('gem',   '42552000-0000-4000-a0f2-000000000003', 'gem.f4255@test.local'),
  ('ray',   '42552000-0000-4000-a0f2-000000000004', 'ray.f4255@test.local'),
  ('host',  '42552000-0000-4000-a0f2-000000000005', 'host.f4255@test.local');
insert into auth.users (id, email, email_confirmed_at) select id, email, now() from t44_people;
insert into public.admin_users (email, role, status, accepted_at) values
  ('oz.f4255@test.local', 'owner', 'active', now()),
  ('ade.f4255@test.local', 'admin', 'active', now());
insert into public.admin_team_members (email, role, status, accepted_at) values
  ('gem.f4255@test.local', 'growth', 'active', now()),
  ('ray.f4255@test.local', 'growth', 'active', now());

create temp table t44_results (seq serial primary key, test text, label text, ok boolean, detail text) on commit drop;
create temp table t44_ids (k text primary key, id uuid not null) on commit drop;

create function pg_temp.as_(p_who text, p_sql text) returns text
language plpgsql as $fn$
declare v_id uuid; v_email text; v_out text;
begin
  select id, email into strict v_id, v_email from t44_people where who = p_who;
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
create function pg_temp.person(p_who text, p_sql text) returns text
language plpgsql as $fn$
begin
  update public.team_agent_calls set xact_id = '3'::xid8, started_at = started_at - interval '5 minutes' where xact_id <> '3'::xid8;
  return pg_temp.as_(p_who, p_sql);
end;
$fn$;
create function pg_temp.chk(p_test text, p_label text, p_got text, p_want text) returns void
language sql as $fn$
  insert into t44_results (test, label, ok, detail)
  values (p_test, p_label, p_got is not distinct from p_want,
          format('got %s, want %s', coalesce(left(p_got, 500), '<null>'), coalesce(p_want, '<null>')));
$fn$;
create function pg_temp.keep(p_k text, p_id uuid) returns uuid
language sql as $fn$ insert into t44_ids (k, id) values (p_k, p_id) on conflict (k) do update set id = excluded.id returning id $fn$;
create function pg_temp.id(p_k text) returns uuid language sql as $fn$ select id from t44_ids where k = p_k $fn$;
create function pg_temp.uid(p_who text) returns uuid language sql as $fn$ select id from t44_people where who = p_who $fn$;
create function pg_temp.outbox(p_cat text, p_who text, p_message uuid) returns text
language sql as $fn$
  select count(*)::text from public.notification_outbox o
   where o.category_key = p_cat and o.user_id = pg_temp.uid(p_who) and o.payload->>'message_id' = p_message::text
$fn$;
create function pg_temp.any_outbox(p_message uuid) returns text
language sql as $fn$
  select coalesce(string_agg(o.category_key || ':' || (select who from t44_people where id = o.user_id), ',' order by o.category_key, o.user_id), '')
    from public.notification_outbox o where o.payload->>'message_id' = p_message::text
$fn$;
create function pg_temp.post(p_k text, p_who text, p_thread uuid, p_body text) returns text
language plpgsql as $fn$
declare v text;
begin
  v := pg_temp.person(p_who, format('select public.team_post(%L, %L)::text', p_thread, p_body));
  if v not like 'ERR:%' and p_k is not null then perform pg_temp.keep(p_k, ((v::jsonb)->'message'->>'id')::uuid); end if;
  return v;
end;
$fn$;
create function pg_temp.pref(p_who text, p_cat text, p_channel text, p_on boolean) returns void
language sql as $fn$
  insert into public.notification_channel_prefs (user_id, category_key, channel, enabled)
  values (pg_temp.uid(p_who), p_cat, p_channel, p_on)
  on conflict (user_id, category_key, channel) do update set enabled = excluded.enabled
$fn$;

-- Chats: the Mingla team (synced on list), a group and a DM.
do $t$
declare v text;
begin
  v := pg_temp.person('gem', 'select public.team_list_threads()::text');
  perform pg_temp.keep('team', (select id from public.team_threads where kind = 'team'));
  v := pg_temp.person('gem', format('select public.team_group_create(%L, %L::uuid[])::text', 'Lagos launch', array[pg_temp.uid('ray'), pg_temp.uid('admin')]));
  perform pg_temp.keep('group', ((v::jsonb)->'thread'->>'id')::uuid);
  v := pg_temp.person('gem', format('select public.team_dm_open(%L)::text', pg_temp.uid('ray')));
  perform pg_temp.keep('dm', ((v::jsonb)->'thread'->>'id')::uuid);
end;
$t$;

-- ───────────────────────────── F-SEED ─────────────────────────────
do $t$
begin
  perform pg_temp.chk('F-SEED', 'business.team_group_message is in-app and push, and active',
    (select array_to_string(default_channels, '+') || ':' || active::text || ':' || section from public.notification_categories where key = 'business.team_group_message'),
    'inapp+push:true:team');
end;
$t$;

-- ───────────────────────────── F-BADGE ─────────────────────────────
do $t$
declare v text;
begin
  perform pg_temp.chk('F-BADGE', 'owner and admin read admin true; a growth teammate reads admin false',
    pg_temp.person('owner', $q$select public.team_badge()->>'admin'$q$) || '/' ||
    pg_temp.person('admin', $q$select public.team_badge()->>'admin'$q$) || '/' ||
    pg_temp.person('gem', $q$select public.team_badge()->>'admin'$q$), 'true/true/false');
  perform pg_temp.chk('F-BADGE', 'a host who is not staff reads staff false and admin false',
    pg_temp.person('host', $q$select (public.team_badge()->>'staff') || '/' || (public.team_badge()->>'admin')$q$), 'false/false');
  -- The flag is the rule team_post enforces.
  v := pg_temp.person('gem', format('select public.team_post(%L, %L, %L::uuid[], null, null, true)::text', pg_temp.id('group'), 'Everyone?', '{}'));
  perform pg_temp.chk('F-BADGE', 'a teammate the badge calls not admin is refused @everyone', left(v, 30), 'ERR:42501:forbidden: Only the ');
  v := pg_temp.person('admin', format('select public.team_post(%L, %L, %L::uuid[], null, null, true)::text', pg_temp.id('group'), 'Everyone, hi', '{}'));
  perform pg_temp.chk('F-BADGE', 'an admin the badge calls admin may mention everyone', (v::jsonb)->'message'->>'everyone', 'true');
  perform pg_temp.chk('F-BADGE', 'the badge keeps its other numbers',
    pg_temp.person('ray', $q$select (select string_agg(k, ',' order by k collate "C") from jsonb_object_keys(public.team_badge()) k)$q$),
    'admin,chats,mentions,messages,staff,total');
end;
$t$;

-- ───────────────────────────── F-GROUP ─────────────────────────────
do $t$
declare v text;
begin
  v := pg_temp.post('g1', 'gem', pg_temp.id('group'), 'Plain group update');
  perform pg_temp.chk('F-GROUP', 'a plain group message queues nothing by default', pg_temp.any_outbox(pg_temp.id('g1')), '');
  -- The old meaning of the message switch ("groups too") no longer reaches groups.
  perform pg_temp.pref('ray', 'business.team_message', 'push', true);
  v := pg_temp.post('g2', 'gem', pg_temp.id('group'), 'Second update');
  perform pg_temp.chk('F-GROUP', 'the DM switch alone does not push a group', pg_temp.any_outbox(pg_temp.id('g2')), '');
  perform pg_temp.pref('ray', 'business.team_group_message', 'push', true);
  v := pg_temp.post('g3', 'gem', pg_temp.id('group'), 'Third update');
  perform pg_temp.chk('F-GROUP', 'the group switch queues that person only, as business.team_group_message',
    pg_temp.any_outbox(pg_temp.id('g3')), 'business.team_group_message:ray');
  perform pg_temp.chk('F-GROUP', 'its idempotency key names the group category',
    (select idempotency_key from public.notification_outbox where payload->>'message_id' = pg_temp.id('g3')::text),
    'business.team_group_message:' || pg_temp.id('g3')::text || ':' || pg_temp.uid('ray')::text);
  v := pg_temp.post('t1', 'gem', pg_temp.id('team'), 'Mingla team update');
  perform pg_temp.chk('F-GROUP', 'the Mingla team follows the same group switch',
    pg_temp.any_outbox(pg_temp.id('t1')), 'business.team_group_message:ray');
  v := pg_temp.person('ray', format('select public.team_mute(%L, true)::text', pg_temp.id('group')));
  v := pg_temp.post('g4', 'gem', pg_temp.id('group'), 'Muted update');
  perform pg_temp.chk('F-GROUP', 'muting the group still stops its pushes', pg_temp.any_outbox(pg_temp.id('g4')), '');
  v := pg_temp.person('ray', format('select public.team_mute(%L, false)::text', pg_temp.id('group')));
  perform pg_temp.pref('ray', 'business.team_group_message', 'push', false);
  v := pg_temp.post('g5', 'gem', pg_temp.id('group'), 'Switched off again');
  perform pg_temp.chk('F-GROUP', 'switching the group switch off stops them', pg_temp.any_outbox(pg_temp.id('g5')), '');
end;
$t$;

-- ───────────────────────────── F-DM ─────────────────────────────
do $t$
declare v text;
begin
  delete from public.notification_channel_prefs where user_id = pg_temp.uid('ray');
  v := pg_temp.post('d1', 'gem', pg_temp.id('dm'), 'Quick one');
  perform pg_temp.chk('F-DM', 'a DM pushes by default, as business.team_message', pg_temp.any_outbox(pg_temp.id('d1')), 'business.team_message:ray');
  perform pg_temp.chk('F-DM', 'its idempotency key is unchanged',
    (select idempotency_key from public.notification_outbox where payload->>'message_id' = pg_temp.id('d1')::text),
    'business.team_message:' || pg_temp.id('d1')::text || ':' || pg_temp.uid('ray')::text);
  -- DMs off (push and in-app), groups on: each switch moves only its own kind.
  perform pg_temp.pref('ray', 'business.team_message', 'push', false);
  perform pg_temp.pref('ray', 'business.team_message', 'inapp', false);
  perform pg_temp.pref('ray', 'business.team_group_message', 'push', true);
  v := pg_temp.post('d2', 'gem', pg_temp.id('dm'), 'Another one');
  v := pg_temp.post('g6', 'gem', pg_temp.id('group'), 'Group still pushes');
  perform pg_temp.chk('F-DM', 'DMs off and groups on: no DM row, one group row',
    coalesce(nullif(pg_temp.any_outbox(pg_temp.id('d2')), ''), 'none') || '|' || pg_temp.any_outbox(pg_temp.id('g6')),
    'none|business.team_group_message:ray');
end;
$t$;

-- ───────────────────────────── report ─────────────────────────────
do $r$
declare r record; v_fail integer := 0; v_all integer := 0;
begin
  for r in select * from t44_results order by seq loop
    v_all := v_all + 1;
    if r.ok then raise notice 'PASS % %', r.test, r.label;
    else v_fail := v_fail + 1; raise notice 'FAIL % % (%)', r.test, r.label, coalesce(r.detail, ''); end if;
  end loop;
  if v_all < 15 then raise exception '#4255 team chat fix-up recorded only % checks', v_all; end if;
  if v_fail > 0 then raise exception '#4255 team chat fix-up: % of % checks failed', v_fail, v_all; end if;
  raise notice '#4255 team chat fix-up: % of % checks passed', v_all, v_all;
end;
$r$;

rollback;
