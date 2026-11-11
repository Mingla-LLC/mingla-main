-- Issue #4383 -- Admin Communications scheduling
-- (20280608004383_issue_4383_communications_scheduling.sql), on the fully
-- replayed PG17 schema.
-- MINGLA-INVARIANT: I-4383-FIRE-ONCE | issue #4383 | A scheduled push, announcement, roadmap card or roadmap notice fires at most once: one campaign per (kind, request_key) and the status leaves scheduled under a row lock in the same transaction it fires in.
-- MINGLA-INVARIANT: I-4383-NO-EARLY-SEND | issue #4383 | Nothing scheduled fires before its saved instant, and a time less than a minute ahead is refused by the server (scheduled_time_past).
-- MINGLA-INVARIANT: I-4383-SCHEDULE-ONE-OWNER | issue #4383 | Each scheduled item's time lives only on its own row; issue_4383_scheduled_communications only reads those rows.
--
--   T7   push save with a past time -> 22023 scheduled_time_past
--   T8   push edit with a stale revision -> PT409 stale_revision
--   T9   a growth teammate gets 42501 from every push RPC
--   T10  the runner fires a due push: sent, campaign kind admin_push, one
--        outbox row per recipient per app (hosts business.mingla_update,
--        explorers explorer.mingla_update), deep links from the destination
--        table, paced next_attempt_at (12 a minute)
--   T11  a push due in five minutes is untouched
--   T12  running twice fires once (one campaign, no duplicate rows)
--   T13  cancel after the runner has it -> PT409 already_sending
--   T14  one push forced to fail is failed with last_error; the good one sends
--   T15  a scheduled announcement is invisible to hosts until it fires, then
--        published once with the Publish-now audience
--   T16  a draft roadmap card with a past go-live time is published
--   T17  a roadmap notice due within 60 s of another stays scheduled
--   T18  every teammate sees scheduled emails, with no body and no recipient email
--   T23  delivery status reads a push campaign by id; no id is still the
--        latest announcement
--   +    send now, test to me, unschedule, Overview and Needs attention
--   R1   (tester P1-1) publishing or archiving a card by any path clears its
--        go-live time; back to draft it never re-arms; hosts never read it
--   R2   (tester P2-1) two pushes fired in one pass share one pace: never more
--        than 12 Admin push rows claimable in any minute; a retry joins it
--   R3   (tester P2-2) a card whose publish fails is recorded, cleared and
--        listed under Needs attention, and the rest of the pass still runs
--
-- FAILS-ON-REVERT: replay without 20280608004383 -> every RPC is missing and
-- the suite stops at T7. Dropping the runner's "scheduled_for <= now()" guard
-- fails T11; dropping the campaign lookup in issue_4383_fire_push_internal
-- (fire once) fails T12.
--
-- Run from the repository root as supabase_admin. Everything is rolled back.

\set ON_ERROR_STOP on
begin;

-- The replayed stack runs production's cron jobs; none may touch this suite.
update cron.job set active = false where active;

create temp table t4383_people (who text primary key, id uuid not null, email text not null) on commit drop;
insert into t4383_people (who, id, email) values
  ('admin',  '43830000-0000-4000-a000-000000000001', 'ada.c4383@test.local'),
  ('growth', '43830000-0000-4000-a000-000000000002', 'gus.c4383@test.local'),
  ('host1',  '43830000-0000-4000-a000-000000000003', 'hana.c4383@test.local'),
  ('host2',  '43830000-0000-4000-a000-000000000004', 'hugo.c4383@test.local'),
  ('gone',   '43830000-0000-4000-a000-000000000005', 'gone.c4383@test.local'),
  ('exp1',   '43830000-0000-4000-a000-000000000006', 'eve.c4383@test.local'),
  ('exp2',   '43830000-0000-4000-a000-000000000007', 'eli.c4383@test.local');
insert into auth.users (id, email) select id, email from t4383_people;
insert into public.admin_users (email, role, status, accepted_at) values ('ada.c4383@test.local', 'owner', 'active', now());
insert into public.admin_team_members (email, role, status, accepted_at) values ('gus.c4383@test.local', 'growth', 'active', now());
-- Explorer accounts: both hosts, the removed host and two explorers.
insert into public.profiles (id, display_name)
select id, initcap(who) from t4383_people where who in ('host1', 'host2', 'gone', 'exp1', 'exp2');
insert into public.creator_accounts (id, created_at) values ('43830000-0000-4000-a000-000000000003', now());
insert into public.brands (id, account_id, name, slug, default_currency, payment_provider, payment_country, created_at, updated_at)
values ('43830000-0000-4000-b000-000000000001', '43830000-0000-4000-a000-000000000003', 'Issue 4383 Brand', 'issue4383brand', 'USD', 'stripe', 'US', now(), now());
-- Creating the brand already adds its owner (host1) as a team member.
insert into public.brand_team_members (brand_id, user_id, role, accepted_at, invited_at, removed_at) values
  ('43830000-0000-4000-b000-000000000001', '43830000-0000-4000-a000-000000000003', 'brand_owner', now(), now(), null),
  ('43830000-0000-4000-b000-000000000001', '43830000-0000-4000-a000-000000000004', 'brand_admin', now(), now(), null),
  ('43830000-0000-4000-b000-000000000001', '43830000-0000-4000-a000-000000000005', 'brand_admin', now(), now(), now())
on conflict do nothing;
update public.brand_team_members set accepted_at = coalesce(accepted_at, now()), removed_at = null
where user_id = '43830000-0000-4000-a000-000000000003';

create temp table t4383_results (seq serial primary key, test text, label text, ok boolean, detail text) on commit drop;
grant all on t4383_results to authenticated;
grant usage, select on sequence t4383_results_seq_seq to authenticated;
create function pg_temp.chk(p_test text, p_label text, p_ok boolean, p_detail text default null) returns void
language sql as $fn$ insert into t4383_results (test, label, ok, detail) values (p_test, p_label, coalesce(p_ok, false), p_detail); $fn$;
create function pg_temp.uid(p_who text) returns uuid
language sql as $fn$ select id from t4383_people where who = p_who; $fn$;
-- Become a person for the next statements (reset role afterwards).
create function pg_temp.act(p_who text) returns void
language plpgsql as $fn$
begin
  perform set_config('request.jwt.claim.sub', pg_temp.uid(p_who)::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', pg_temp.uid(p_who), 'role', 'authenticated')::text, true);
end;
$fn$;
-- The SQLSTATE and message a statement raises, or 'ok'.
create function pg_temp.err(p_sql text) returns text
language plpgsql as $fn$
begin
  execute p_sql;
  return 'ok';
exception when others then
  return sqlstate || ' ' || sqlerrm;
end;
$fn$;
grant execute on function pg_temp.err(text) to authenticated;
grant execute on function pg_temp.chk(text, text, boolean, text) to authenticated;

-- ───────────────────────────── T7 / T8 / save ─────────────────────────────
do $t$
declare v jsonb; v_id uuid; v_e text;
begin
  perform pg_temp.act('admin');
  set local role authenticated;
  v_e := pg_temp.err($$select public.issue_4383_push_save(null, 'Hi', 'There', 'both', 'explore', 'community', now() - interval '1 minute', 'Africa/Lagos', null)$$);
  perform pg_temp.chk('T7', 'past time refused', v_e like '22023 scheduled_time_past%', v_e);
  v_e := pg_temp.err($$select public.issue_4383_push_save(null, 'Hi', 'There', 'both', 'explore', 'community', now() + interval '30 seconds', 'Africa/Lagos', null)$$);
  perform pg_temp.chk('T7', 'under a minute ahead refused', v_e like '22023 scheduled_time_past%', v_e);
  v_e := pg_temp.err($$select public.issue_4383_push_save(null, 'Hi', 'There', 'both', 'explore', 'community', now() + interval '1 hour', 'Mars/Olympus', null)$$);
  perform pg_temp.chk('T7', 'unknown timezone refused', v_e like '22023 invalid_timezone%', v_e);
  v_e := pg_temp.err($$select public.issue_4383_push_save(null, 'Hi', 'There', 'both', 'connections', 'community', null, 'UTC', null)$$);
  perform pg_temp.chk('T7', 'a destination outside the table refused', v_e like '22023 invalid_destination%', v_e);
  v_e := pg_temp.err($$select public.issue_4383_push_save(null, repeat('x', 66), 'There', 'both', 'explore', 'community', null, 'UTC', null)$$);
  perform pg_temp.chk('T7', 'a 66-character title refused', v_e like '22023 invalid_title%', v_e);

  v := public.issue_4383_push_save(null, ' Weekend in Lagos ', 'See what is on.', 'both', 'discover', 'home', now() + interval '2 hours', 'Africa/Lagos', null);
  v_id := (v->>'id')::uuid;
  perform pg_temp.chk('save', 'a time makes it scheduled, trimmed, revision 1',
    v->>'status' = 'scheduled' and v->>'title' = 'Weekend in Lagos' and (v->>'revision')::int = 1 and v->>'timezone' = 'Africa/Lagos', v::text);
  v := public.issue_4383_push_save(v_id, 'Weekend in Lagos!', 'See what is on.', 'both', 'discover', 'home', now() + interval '3 hours', 'Africa/Lagos', 1);
  perform pg_temp.chk('save', 'an edit with the current revision moves the time', (v->>'revision')::int = 2, v::text);
  v_e := pg_temp.err(format($$select public.issue_4383_push_save(%L, 'Old', 'Copy', 'both', 'explore', 'community', null, 'UTC', 1)$$, v_id));
  perform pg_temp.chk('T8', 'stale revision is PT409', v_e like 'PT409 stale_revision%', v_e);
  v := public.issue_4383_push_save(v_id, 'Weekend in Lagos!', 'See what is on.', 'both', 'discover', 'home', null, 'Africa/Lagos', 2);
  perform pg_temp.chk('save', 'no time makes it a draft again', v->>'status' = 'draft', v::text);
  v := public.issue_4383_push_preview();
  perform pg_temp.chk('save', 'preview counts: 2 hosts (removed one excluded), 5 explorers, 5 people',
    (v->>'hosts')::int = 2 and (v->>'explorers')::int = 5 and (v->>'both')::int = 5, v::text);
  reset role;
end;
$t$;

-- ───────────────────────────── T9 non-admin ─────────────────────────────
do $t$
declare v_e text; v_sql text; v_all boolean := true; v_bad text := '';
begin
  perform pg_temp.act('growth');
  set local role authenticated;
  foreach v_sql in array array[
    $$select public.issue_4383_push_preview()$$,
    $$select public.issue_4383_push_save(null, 'Hi', 'There', 'both', 'explore', 'community', null, 'UTC', null)$$,
    $$select public.issue_4383_push_send_now(gen_random_uuid(), 1)$$,
    $$select public.issue_4383_push_cancel(gen_random_uuid())$$,
    $$select public.issue_4383_push_test_to_me(gen_random_uuid())$$,
    $$select public.issue_4383_push_list()$$,
    $$select public.issue_4383_announcement_schedule(gen_random_uuid(), now() + interval '1 day', 'UTC')$$,
    $$select public.issue_4383_announcement_unschedule(gen_random_uuid())$$,
    $$select public.issue_4383_roadmap_schedule_card(gen_random_uuid(), now() + interval '1 day', 'UTC')$$,
    $$select public.issue_4383_roadmap_unschedule_card(gen_random_uuid())$$,
    $$select public.issue_4383_roadmap_schedule_notice(now() + interval '1 day', 'UTC')$$,
    $$select public.issue_4383_roadmap_cancel_notice(gen_random_uuid())$$,
    $$select public.issue_4383_roadmap_scheduled_list()$$,
    $$select public.issue_4383_communications_failures()$$
  ] loop
    v_e := pg_temp.err(v_sql);
    if v_e not like '42501%' then v_all := false; v_bad := v_bad || v_sql || ' -> ' || v_e || '; '; end if;
  end loop;
  perform pg_temp.chk('T9', 'growth gets 42501 from every admin RPC', v_all, v_bad);
  -- The internals are not callable by any signed-in person.
  v_e := pg_temp.err($$select public.issue_4383_fire_due_communications()$$);
  perform pg_temp.chk('T9', 'the runner is not callable by authenticated', v_e like '42501%', v_e);
  v_e := pg_temp.err($$select public.issue_4383_fire_push_internal(gen_random_uuid())$$);
  perform pg_temp.chk('T9', 'the push fan-out is not callable by authenticated', v_e like '42501%', v_e);
  v_e := pg_temp.err($$select count(*) from public.admin_push_campaigns$$);
  perform pg_temp.chk('T9', 'the push table is not readable by authenticated', v_e like '42501%', v_e);
  reset role;
end;
$t$;

-- ───────────────────────────── T10 / T11 / T12 / T14 runner ─────────────────────────────
-- Seed due and not-due pushes directly (the RPC refuses past times on purpose).
insert into public.admin_push_campaigns (id, title, body, audience, explorer_target, host_target, status, scheduled_for, timezone, created_by)
values
  ('43830000-0000-4000-c000-000000000001', 'Due now', 'Both apps', 'both', 'likes', 'home', 'scheduled', now() - interval '1 second', 'Africa/Lagos', '43830000-0000-4000-a000-000000000001'),
  ('43830000-0000-4000-c000-000000000002', 'Later', 'Not yet', 'hosts', 'explore', 'community', 'scheduled', now() + interval '5 minutes', 'UTC', '43830000-0000-4000-a000-000000000001'),
  ('43830000-0000-4000-c000-000000000003', 'Broken', 'Will fail', 'explorers', 'explore', 'community', 'scheduled', now() - interval '2 seconds', 'UTC', '43830000-0000-4000-a000-000000000001');

-- Force one push to fail inside the outbox insert (T14).
create function pg_temp.t4383_break() returns trigger language plpgsql as $fn$
begin
  if new.payload->>'push_id' = '43830000-0000-4000-c000-000000000003' then
    raise exception 'forced failure for T14';
  end if;
  return new;
end;
$fn$;
create trigger t4383_break before insert on public.notification_outbox for each row execute function pg_temp.t4383_break();

do $t$
declare v jsonb; v2 jsonb; p record; v_n int; v_paced int; v_links text;
begin
  v := public.issue_4383_fire_due_communications();
  perform pg_temp.chk('T10', 'runner summary: one sent, one failed', (v->>'pushes_sent')::int = 1 and (v->>'pushes_failed')::int = 1, v::text);

  select * into p from public.admin_push_campaigns where id = '43830000-0000-4000-c000-000000000001';
  perform pg_temp.chk('T10', 'due push is sent with a campaign and a count', p.status = 'sent' and p.campaign_id is not null and p.audience_count = 7 and p.fired_at is not null, row_to_json(p)::text);
  perform pg_temp.chk('T10', 'campaign kind admin_push, request key = push id',
    exists (select 1 from public.community_notification_campaigns c where c.id = p.campaign_id and c.kind = 'admin_push' and c.request_key = p.id and c.source_id = p.id), null);
  select count(*) into v_n from public.notification_outbox where payload->>'push_id' = p.id::text and category_key = 'business.mingla_update';
  perform pg_temp.chk('T10', 'two host rows (the removed host is left out)', v_n = 2, v_n::text);
  select count(*) into v_n from public.notification_outbox where payload->>'push_id' = p.id::text and category_key = 'explorer.mingla_update';
  perform pg_temp.chk('T10', 'five explorer rows', v_n = 5, v_n::text);
  select string_agg(distinct category_key || '=' || (payload->>'deep_link'), ',' order by category_key || '=' || (payload->>'deep_link')) into v_links
  from public.notification_outbox where payload->>'push_id' = p.id::text;
  perform pg_temp.chk('T10', 'deep links come from the destination table',
    v_links = 'business.mingla_update=mingla-business://(tabs)/home,explorer.mingla_update=mingla://likes', v_links);
  perform pg_temp.chk('T10', 'idempotency key is category:push:user',
    not exists (select 1 from public.notification_outbox o where o.payload->>'push_id' = p.id::text
      and o.idempotency_key <> o.category_key || ':' || p.id::text || ':' || o.user_id::text), null);
  perform pg_temp.chk('T10', 'payload carries campaign_id, push_id, title, body, deep_link',
    not exists (select 1 from public.notification_outbox o where o.payload->>'push_id' = p.id::text
      and (o.payload->>'campaign_id' <> p.campaign_id::text or o.payload->>'title' <> 'Due now' or o.payload->>'body' <> 'Both apps' or o.payload->>'deep_link' is null)), null);
  perform pg_temp.chk('T10', 'rows wait in retry_wait (paced), all as pending to the status',
    not exists (select 1 from public.notification_outbox o where o.payload->>'push_id' = p.id::text and o.status <> 'retry_wait'), null);
  select count(*) into v_paced from public.notification_outbox o
  where o.payload->>'push_id' = p.id::text and o.next_attempt_at = now();
  perform pg_temp.chk('T10', 'the first 12 rows (all 7 here) are claimable now', v_paced = 7, v_paced::text);

  select * into p from public.admin_push_campaigns where id = '43830000-0000-4000-c000-000000000002';
  perform pg_temp.chk('T11', 'a push due in five minutes is untouched', p.status = 'scheduled' and p.campaign_id is null, p.status);
  perform pg_temp.chk('T11', 'and has no outbox rows', not exists (select 1 from public.notification_outbox where payload->>'push_id' = p.id::text), null);

  select * into p from public.admin_push_campaigns where id = '43830000-0000-4000-c000-000000000003';
  perform pg_temp.chk('T14', 'the broken push is failed with its reason', p.status = 'failed' and p.last_error like '%forced failure for T14%', coalesce(p.last_error, p.status));
  perform pg_temp.chk('T14', 'and left no campaign or rows behind',
    not exists (select 1 from public.community_notification_campaigns where kind = 'admin_push' and request_key = p.id)
    and not exists (select 1 from public.notification_outbox where payload->>'push_id' = p.id::text), null);
  perform pg_temp.chk('T14', 'both outcomes are in the audit log',
    exists (select 1 from public.community_audit_log where action = 'fire_scheduled_push' and entity_id = '43830000-0000-4000-c000-000000000001')
    and exists (select 1 from public.community_audit_log where action = 'fail_scheduled_push' and entity_id = p.id), null);

  -- T12: run again; and call the fan-out again directly.
  v2 := public.issue_4383_fire_due_communications();
  perform pg_temp.chk('T12', 'a second run fires nothing', (v2->>'pushes_sent')::int = 0 and (v2->>'pushes_failed')::int = 0, v2::text);
  v2 := public.issue_4383_fire_push_internal('43830000-0000-4000-c000-000000000001');
  perform pg_temp.chk('T12', 'the fan-out is idempotent', (v2->>'duplicate')::boolean, v2::text);
  select count(*) into v_n from public.notification_outbox where payload->>'push_id' = '43830000-0000-4000-c000-000000000001';
  perform pg_temp.chk('T12', 'still exactly 7 rows and one campaign', v_n = 7
    and (select count(*) from public.community_notification_campaigns where kind = 'admin_push' and request_key = '43830000-0000-4000-c000-000000000001') = 1, v_n::text);
end;
$t$;
drop trigger t4383_break on public.notification_outbox;

-- Pacing over a larger audience: 30 explorers -> minutes 0, 1, 2.
do $t$
declare v jsonb; v_minutes text;
begin
  insert into auth.users (id, email) select ('43830000-0000-4000-d000-' || lpad(g::text, 12, '0'))::uuid, 'bulk' || g || '.c4383@test.local' from generate_series(1, 25) g;
  insert into public.profiles (id) select ('43830000-0000-4000-d000-' || lpad(g::text, 12, '0'))::uuid from generate_series(1, 25) g;
  insert into public.admin_push_campaigns (id, title, body, audience, status, scheduled_for, created_by)
  values ('43830000-0000-4000-c000-000000000004', 'Big', 'Paced', 'explorers', 'scheduled', now() - interval '1 second', '43830000-0000-4000-a000-000000000001');
  v := public.issue_4383_fire_due_communications();
  select string_agg(m || ':' || c, ',' order by m) into v_minutes from (
    select extract(epoch from (next_attempt_at - now()))::int / 60 as m, count(*) as c
    from public.notification_outbox where payload->>'push_id' = '43830000-0000-4000-c000-000000000004' group by 1) x;
  -- The first push's 7 rows still wait in minute 0, so this push fills that
  -- minute to 12 and goes on: one shared pace (tester P2-1).
  perform pg_temp.chk('T10', '30 rows paced 12 a minute after the 7 already queued', v_minutes = '0:5,1:12,2:12,3:1', v_minutes);
end;
$t$;

-- ───────────────────────────── T13 cancel / send now / test ─────────────────────────────
do $t$
declare v jsonb; v_e text; v_id uuid;
begin
  perform pg_temp.act('admin');
  set local role authenticated;
  v_e := pg_temp.err($$select public.issue_4383_push_cancel('43830000-0000-4000-c000-000000000001')$$);
  perform pg_temp.chk('T13', 'cancelling a push that already went is PT409 already_sending', v_e like 'PT409 already_sending%', v_e);
  v_e := pg_temp.err($$select public.issue_4383_push_save('43830000-0000-4000-c000-000000000001', 'x', 'y', 'both', 'explore', 'community', null, 'UTC', 1)$$);
  perform pg_temp.chk('T13', 'editing it is PT409 already_sending', v_e like 'PT409 already_sending%', v_e);
  v := public.issue_4383_push_cancel('43830000-0000-4000-c000-000000000002');
  perform pg_temp.chk('T13', 'a scheduled push cancels', v->>'status' = 'cancelled', v::text);

  v := public.issue_4383_push_save(null, 'Test me', 'Only me', 'both', 'explore', 'community', null, 'UTC', null);
  v_id := (v->>'id')::uuid;
  v := public.issue_4383_push_test_to_me(v_id);
  perform pg_temp.chk('test', 'a test goes to me in both apps', (v->>'queued')::int = 2, v::text);
  v_e := pg_temp.err(format($$select public.issue_4383_push_test_to_me(%L)$$, v_id));
  perform pg_temp.chk('test', 'a second test in the same minute is refused', v_e like 'P0001 test_rate_limited%', v_e);
  reset role;
  perform pg_temp.chk('test', 'test rows are mine only and carry no campaign',
    (select count(*) from public.notification_outbox where payload->>'push_id' = v_id::text) = 2
    and not exists (select 1 from public.notification_outbox where payload->>'push_id' = v_id::text and (user_id <> pg_temp.uid('admin') or payload ? 'campaign_id')), null);

  perform pg_temp.act('admin');
  set local role authenticated;
  -- The runner fired two pushes inside this transaction (now() is fixed), so
  -- the 60-second limit between Admin pushes applies.
  v_e := pg_temp.err(format($$select public.issue_4383_push_send_now(%L, 1)$$, v_id));
  perform pg_temp.chk('send', 'send now within 60 s of another push is rate limited', v_e like 'P0001 push_rate_limited%', v_e);
  reset role;
  update public.admin_push_campaigns set fired_at = now() - interval '2 minutes' where fired_at is not null;
  perform pg_temp.act('admin');
  set local role authenticated;
  v_e := pg_temp.err(format($$select public.issue_4383_push_send_now(%L, 9)$$, v_id));
  perform pg_temp.chk('send', 'send now with a stale revision is PT409', v_e like 'PT409 stale_revision%', v_e);
  v := public.issue_4383_push_send_now(v_id, 1);
  perform pg_temp.chk('send', 'send now fires: sent, 32 rows (2 hosts + 30 explorers)', v->>'status' = 'sent' and (v->>'audience_count')::int = 2 + 30, v::text);
  v := public.issue_4383_push_list();
  perform pg_temp.chk('list', 'the list carries each sent push''s delivery state',
    exists (select 1 from jsonb_array_elements(v) e where e->>'id' = v_id::text and e->'delivery'->>'state' = 'queued'), left(v::text, 400));
  perform pg_temp.chk('list', 'the list names who made it', exists (select 1 from jsonb_array_elements(v) e where e->>'id' = v_id::text and e ? 'created_by_name'), null);
  reset role;
end;
$t$;

-- ───────────────────────────── T23 delivery status ─────────────────────────────
do $t$
declare v jsonb; v_campaign uuid;
begin
  select campaign_id into v_campaign from public.admin_push_campaigns where id = '43830000-0000-4000-c000-000000000001';
  insert into public.community_announcements (id, title, body_md, status, published_at) values ('43830000-0000-4000-e000-000000000099', 'Old', 'Old body', 'published', now() - interval '1 day');
  insert into public.community_notification_campaigns (kind, source_id, request_key, created_at) values ('announcement', '43830000-0000-4000-e000-000000000099', '43830000-0000-4000-e000-000000000099', now() - interval '1 day');
  perform pg_temp.act('admin');
  set local role authenticated;
  v := public.community_get_announcement_notification_status(v_campaign);
  perform pg_temp.chk('T23', 'a push campaign reads by id', v->>'campaign_id' = v_campaign::text and (v->'outbox'->>'pending')::int = 7, v::text);
  v := public.community_get_announcement_notification_status(null);
  perform pg_temp.chk('T23', 'no id is still the latest announcement', v->>'source_id' = '43830000-0000-4000-e000-000000000099', v::text);
  reset role;
end;
$t$;

-- ───────────────────────────── T15 announcements ─────────────────────────────
do $t$
declare v jsonb; v_id uuid; v_e text; v_seen int;
begin
  perform pg_temp.act('admin');
  set local role authenticated;
  v_id := public.issue_3720_admin_upsert_announcement(null, 'Payouts arrive a day after each sale', 'Here is what changed.', null, null);
  v_e := pg_temp.err(format($$select public.issue_4383_announcement_schedule(%L, now() - interval '1 minute', 'Africa/Lagos')$$, v_id));
  perform pg_temp.chk('T15', 'scheduling in the past is refused', v_e like '22023 scheduled_time_past%', v_e);
  v := public.issue_4383_announcement_schedule(v_id, now() + interval '1 day', 'Africa/Lagos');
  perform pg_temp.chk('T15', 'scheduled with its zone', v->>'status' = 'scheduled' and v->>'scheduled_timezone' = 'Africa/Lagos', v::text);
  perform public.issue_3720_admin_upsert_announcement(v_id, 'Payouts arrive about a day after each sale', 'Here is what changed.', null, null);
  perform pg_temp.chk('T15', 'a scheduled announcement can still be edited',
    (select title from public.community_announcements where id = v_id) = 'Payouts arrive about a day after each sale', null);
  reset role;

  -- A host cannot see it.
  perform pg_temp.act('host1');
  set local role authenticated;
  select count(*) into v_seen from public.community_announcements where id = v_id;
  reset role;
  perform pg_temp.chk('T15', 'hosts cannot see a scheduled announcement', v_seen = 0, v_seen::text);

  -- Make it due, then fire.
  update public.community_announcements set scheduled_at = now() - interval '1 second' where id = v_id;
  v := public.issue_4383_fire_due_communications();
  perform pg_temp.chk('T15', 'the runner publishes it', (v->>'announcements_published')::int = 1, v::text);
  perform pg_temp.chk('T15', 'published, scheduled_at cleared',
    (select status = 'published' and published_at is not null and scheduled_at is null from public.community_announcements where id = v_id), null);
  perform pg_temp.chk('T15', 'the Publish-now audience: one business.community_announcement row per accepted host',
    (select count(*) from public.notification_outbox where category_key = 'business.community_announcement' and payload->>'announcement_id' = v_id::text) = 2, null);
  perform pg_temp.chk('T15', 'the campaign is credited to whoever scheduled it',
    (select actor_user_id from public.community_notification_campaigns where kind = 'announcement' and source_id = v_id) = pg_temp.uid('admin'), null);
  v := public.issue_4383_fire_due_communications();
  perform pg_temp.chk('T15', 'and publishes exactly once', (v->>'announcements_published')::int = 0
    and (select count(*) from public.community_notification_campaigns where kind = 'announcement' and source_id = v_id) = 1, v::text);

  perform pg_temp.act('host1');
  set local role authenticated;
  select count(*) into v_seen from public.community_announcements where id = v_id;
  reset role;
  perform pg_temp.chk('T15', 'hosts see it once it fires', v_seen = 1, v_seen::text);

  perform pg_temp.act('admin');
  set local role authenticated;
  v_e := pg_temp.err(format($$select public.issue_3720_admin_upsert_announcement(%L, 'Changed', 'After publish', null, null)$$, v_id));
  perform pg_temp.chk('T15', 'a published announcement can no longer be edited', v_e like '22023 not_editable%', v_e);
  v_e := pg_temp.err(format($$select public.issue_4383_announcement_unschedule(%L)$$, v_id));
  perform pg_temp.chk('T15', 'unschedule after it published is PT409', v_e like 'PT409 already_published%', v_e);
  v_id := public.issue_3720_admin_upsert_announcement(null, 'Another', 'Body', null, null);
  perform public.issue_4383_announcement_schedule(v_id, now() + interval '2 days', 'UTC');
  v := public.issue_4383_announcement_unschedule(v_id);
  perform pg_temp.chk('T15', 'unschedule goes back to draft', v->>'status' = 'draft'
    and (select scheduled_at is null from public.community_announcements where id = v_id), v::text);
  reset role;
end;
$t$;

-- ───────────────────────────── T16 / T17 roadmap ─────────────────────────────
do $t$
declare v jsonb; v_card uuid; v_live uuid; v_e text; v_n1 uuid; v_n2 uuid;
begin
  insert into public.community_roadmap_cards (id, public_title, lane, status) values
    ('43830000-0000-4000-f000-000000000001', 'Host Advance for campus hosts', 'next', 'draft'),
    ('43830000-0000-4000-f000-000000000002', 'Recurring events', 'later', 'draft');
  perform pg_temp.act('admin');
  set local role authenticated;
  v := public.issue_4383_roadmap_schedule_card('43830000-0000-4000-f000-000000000002', now() + interval '1 day', 'Africa/Lagos');
  perform pg_temp.chk('T16', 'a draft card takes a go-live time', v->>'go_live_timezone' = 'Africa/Lagos', v::text);
  v := public.issue_4383_roadmap_unschedule_card('43830000-0000-4000-f000-000000000002');
  perform pg_temp.chk('T16', 'and can be unscheduled', v->'go_live_at' = 'null'::jsonb, v::text);
  v_n1 := (public.issue_4383_roadmap_schedule_notice(now() + interval '1 day', 'Africa/Lagos')->>'id')::uuid;
  v_n2 := (public.issue_4383_roadmap_schedule_notice(now() + interval '1 day', 'Africa/Lagos')->>'id')::uuid;
  v := public.issue_4383_roadmap_cancel_notice(v_n2);
  perform pg_temp.chk('T17', 'a scheduled notice cancels', v->>'status' = 'cancelled', v::text);
  reset role;

  -- Make the card and the first notice due.
  update public.community_roadmap_cards set go_live_at = now() - interval '1 second', go_live_timezone = 'UTC' where id = '43830000-0000-4000-f000-000000000001';
  update public.community_roadmap_notices_scheduled set scheduled_for = now() - interval '1 second' where id = v_n1;
  -- Another roadmap notice went out within the last 60 seconds.
  insert into public.community_notification_campaigns (kind, request_key, created_at) values ('roadmap_update', gen_random_uuid(), now() - interval '10 seconds');
  v := public.issue_4383_fire_due_communications();
  perform pg_temp.chk('T16', 'the runner publishes the card', (v->>'roadmap_cards_live')::int = 1
    and (select status = 'published' and go_live_at is null from public.community_roadmap_cards where id = '43830000-0000-4000-f000-000000000001'), v::text);
  perform pg_temp.chk('T17', 'the notice waits behind the 60 s limit', (v->>'roadmap_notices_waiting')::int = 1
    and (select status = 'scheduled' from public.community_roadmap_notices_scheduled where id = v_n1), v::text);
  update public.community_notification_campaigns set created_at = now() - interval '2 minutes' where kind = 'roadmap_update';
  v := public.issue_4383_fire_due_communications();
  perform pg_temp.chk('T17', 'it fires on a later minute', (v->>'roadmap_notices_sent')::int = 1
    and (select status = 'sent' and campaign_id is not null from public.community_roadmap_notices_scheduled where id = v_n1), v::text);
  perform pg_temp.chk('T17', 'with the existing roadmap notice to each host',
    (select count(*) from public.notification_outbox o join public.community_roadmap_notices_scheduled n on o.payload->>'campaign_id' = n.campaign_id::text
      where n.id = v_n1 and o.category_key = 'business.community_roadmap_updated') = 2, null);
  perform pg_temp.act('admin');
  set local role authenticated;
  v_e := pg_temp.err(format($$select public.issue_4383_roadmap_cancel_notice(%L)$$, v_n1));
  perform pg_temp.chk('T17', 'cancelling a sent notice is PT409', v_e like 'PT409 already_sent%', v_e);
  v_e := pg_temp.err($$select public.issue_4383_roadmap_unschedule_card('43830000-0000-4000-f000-000000000001')$$);
  perform pg_temp.chk('T16', 'unscheduling a card that went live is PT409', v_e like 'PT409 already_published%', v_e);
  v := public.issue_4383_roadmap_scheduled_list();
  perform pg_temp.chk('T16', 'the 3720 column contract holds: go-live columns readable, internal_note not',
    has_column_privilege('authenticated', 'public.community_roadmap_cards', 'go_live_at', 'SELECT')
    and not has_column_privilege('authenticated', 'public.community_roadmap_cards', 'internal_note', 'SELECT'), null);
  perform pg_temp.chk('T17', 'the scheduled list shows the sent notice and no live card',
    jsonb_array_length(v->'cards') = 0 and exists (select 1 from jsonb_array_elements(v->'notices') n where n->>'id' = v_n1::text and n->>'status' = 'sent'), v::text);
  reset role;
end;
$t$;

-- ───────────────────────────── T18 email scheduled list ─────────────────────────────
do $t$
declare v jsonb; v_e text;
begin
  insert into public.admin_email_log (id, subject, body, recipient_type, recipient_email, status, scheduled_for, timezone, audience, recipient_count, sent_by, processing_started_at)
  values
    ('43830000-0000-4000-9000-000000000001', 'Your December checklist', 'SECRET BODY', 'bulk', null, 'scheduled', now() + interval '1 day', 'Africa/Lagos', '{"mode":"segment","filters":{"userType":"host"}}', 49, pg_temp.uid('admin'), null),
    ('43830000-0000-4000-9000-000000000002', 'Locals welcome pack', 'SECRET BODY', 'individual', 'private@test.local', 'scheduled', now() + interval '2 hours', 'UTC', '{"mode":"person","email":"private@test.local"}', 1, pg_temp.uid('admin'), now()),
    ('43830000-0000-4000-9000-000000000003', 'Already sent', 'SECRET BODY', 'bulk', null, 'sent', null, 'UTC', '{"mode":"everyone"}', 10, pg_temp.uid('admin'), null);
  perform pg_temp.act('growth');
  set local role authenticated;
  v := public.issue_4383_email_scheduled_list();
  perform pg_temp.chk('T18', 'a growth teammate sees the two scheduled emails, soonest first',
    jsonb_array_length(v) = 2 and v->0->>'subject' = 'Locals welcome pack', v::text);
  perform pg_temp.chk('T18', 'no body and no recipient email in the list', position('SECRET' in v::text) = 0 and position('private@test.local' in v::text) = 0, v::text);
  perform pg_temp.chk('T18', 'one that started sending cannot change', (v->0->>'can_change')::boolean = false and (v->1->>'can_change')::boolean = true, v::text);
  perform pg_temp.chk('T18', 'who scheduled it is named', v->1->>'sent_by_name' = 'ada.c4383', v::text);
  v := public.issue_4383_scheduled_communications();
  perform pg_temp.chk('overview', 'a teammate''s Overview lists emails only (no pushes, announcements or roadmap)',
    not exists (select 1 from jsonb_array_elements(v) i where i->>'kind' not in ('email', 'blog'))
    and (select count(*) from jsonb_array_elements(v) i where i->>'kind' = 'email') = 2, v::text);
  v_e := pg_temp.err($$select public.issue_4383_communications_failures()$$);
  perform pg_temp.chk('overview', 'Needs attention is admin-only', v_e like '42501%', v_e);
  reset role;

  perform pg_temp.act('host1');
  set local role authenticated;
  v_e := pg_temp.err($$select public.issue_4383_email_scheduled_list()$$);
  perform pg_temp.chk('T18', 'a host (not a teammate) is refused', v_e like '42501%', v_e);
  v_e := pg_temp.err($$select public.issue_4383_scheduled_communications()$$);
  perform pg_temp.chk('overview', 'a host gets no Overview', v_e like '42501%', v_e);
  reset role;
end;
$t$;

-- ───────────────────────────── Overview and Needs attention (admin) ─────────────────────────────
do $t$
declare v jsonb;
begin
  -- A scheduled push left behind by a stopped runner, and one in the future.
  insert into public.admin_push_campaigns (id, title, body, audience, status, scheduled_for, timezone, created_by) values
    ('43830000-0000-4000-c000-000000000005', 'Stuck', 'Late', 'hosts', 'scheduled', now() - interval '10 minutes', 'UTC', pg_temp.uid('admin')),
    ('43830000-0000-4000-c000-000000000006', 'Friday drop', 'Soon', 'explorers', 'scheduled', now() + interval '3 days', 'Africa/Lagos', pg_temp.uid('admin'));
  perform pg_temp.act('admin');
  set local role authenticated;
  v := public.issue_4383_scheduled_communications();
  perform pg_temp.chk('overview', 'admin Overview lists pushes and emails, soonest first, each with its zone and screen',
    exists (select 1 from jsonb_array_elements(v) i where i->>'id' = '43830000-0000-4000-c000-000000000006' and i->>'timezone' = 'Africa/Lagos' and i->>'href' = '#/push')
    and exists (select 1 from jsonb_array_elements(v) i where i->>'kind' = 'email')
    and (v->0->>'scheduled_for')::timestamptz <= (v->(jsonb_array_length(v) - 1)->>'scheduled_for')::timestamptz, left(v::text, 500));
  v := public.issue_4383_communications_failures();
  perform pg_temp.chk('attention', 'the failed push is listed with its reason',
    exists (select 1 from jsonb_array_elements(v) i where i->>'id' = '43830000-0000-4000-c000-000000000003' and i->>'problem' = 'failed' and i->>'detail' like '%forced failure%'), left(v::text, 500));
  perform pg_temp.chk('attention', 'a push whose time passed five minutes ago is late',
    exists (select 1 from jsonb_array_elements(v) i where i->>'id' = '43830000-0000-4000-c000-000000000005' and i->>'problem' = 'late'), left(v::text, 500));
  perform pg_temp.chk('attention', 'a future push is not listed', not exists (select 1 from jsonb_array_elements(v) i where i->>'id' = '43830000-0000-4000-c000-000000000006'), null);
  reset role;
  perform pg_temp.chk('I-4383-SCHEDULE-ONE-OWNER', 'the Overview function only reads (STABLE)',
    (select provolatile = 's' from pg_proc where oid = 'public.issue_4383_scheduled_communications()'::regprocedure), null);
  perform pg_temp.chk('cron', 'the every-minute job is registered as pure SQL',
    exists (select 1 from cron.job where jobname = 'issue_4383_communications_due' and schedule = '* * * * *' and command like '%issue_4383_fire_due_communications%' and command not like '%net.http%'), null);
  perform pg_temp.chk('security', 'RLS is on for both new tables',
    (select bool_and(relrowsecurity) from pg_class where oid in ('public.admin_push_campaigns'::regclass, 'public.community_roadmap_notices_scheduled'::regclass)), null);
  perform pg_temp.chk('security', 'no anon EXECUTE on any issue_4383 function',
    not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname like 'issue_4383_%' and has_function_privilege('anon', p.oid, 'EXECUTE')), null);
  perform pg_temp.chk('security', 'every issue_4383 function pins search_path',
    not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname like 'issue_4383_%' and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')), null);
  perform pg_temp.chk('categories', 'both categories exist, inapp + push, default on (transactional)',
    (select count(*) from public.notification_categories where key in ('explorer.mingla_update', 'business.mingla_update')
      and is_transactional and default_channels = array['inapp', 'push']::text[] and active) = 2, null);
end;
$t$;


-- ───────────────────────────── R1 / R2 / R3 (tester rework) ─────────────────────────────
do $t$
declare v jsonb; v_minutes text; v_max int; v_campaign uuid; v_card uuid := '43830000-0000-4000-f000-0000000000d1';
begin
  insert into public.community_roadmap_cards (id, public_title, lane, status, sort_order) values (v_card, 'Card R1', 'next', 'draft', 9101);
  perform pg_temp.act('admin');
  set local role authenticated;
  perform public.issue_4383_roadmap_schedule_card(v_card, now() + interval '2 hours', 'Europe/London');
  perform public.community_upsert_roadmap_card(v_card, 'Card R1', null, null, 'next', 'published');
  reset role;
  perform pg_temp.chk('R1', 'a manual publish clears the go-live time and zone',
    (select go_live_at is null and go_live_timezone is null from public.community_roadmap_cards where id = v_card), null);
  perform pg_temp.act('admin');
  set local role authenticated;
  perform public.community_upsert_roadmap_card(v_card, 'Card R1', null, null, 'next', 'draft');
  reset role;
  v := public.issue_4383_fire_due_communications();
  perform pg_temp.chk('R1', 'back to draft, the runner does not republish it',
    (select status = 'draft' from public.community_roadmap_cards where id = v_card) and (v->>'roadmap_cards_live')::int = 0, v::text);
  -- Any writer: a direct status change clears it too.
  update public.community_roadmap_cards set go_live_at = now() + interval '1 day', go_live_timezone = 'UTC' where id = v_card;
  update public.community_roadmap_cards set status = 'archived' where id = v_card;
  perform pg_temp.chk('R1', 'archiving clears it as well',
    (select go_live_at is null and go_live_timezone is null from public.community_roadmap_cards where id = v_card), null);

  -- R2: clear earlier admin pushes' rows so this measures only what follows.
  delete from public.notification_outbox where category_key in ('explorer.mingla_update', 'business.mingla_update');
  insert into public.admin_push_campaigns (id, title, body, audience, status, scheduled_for, created_by) values
    ('43830000-0000-4000-c000-0000000000d1', 'R2a', 'x', 'explorers', 'scheduled', now() - interval '2 seconds', pg_temp.uid('admin')),
    ('43830000-0000-4000-c000-0000000000d2', 'R2b', 'y', 'explorers', 'scheduled', now() - interval '1 second', pg_temp.uid('admin'));
  v := public.issue_4383_fire_due_communications();
  select max(c) into v_max from (select next_attempt_at, count(*) c from public.notification_outbox
    where category_key in ('explorer.mingla_update', 'business.mingla_update') group by 1) x;
  select string_agg(m || ':' || c, ',' order by m) into v_minutes from (
    select extract(epoch from (next_attempt_at - now()))::int / 60 as m, count(*) as c
    from public.notification_outbox where category_key in ('explorer.mingla_update', 'business.mingla_update') group by 1) x;
  perform pg_temp.chk('R2', 'two pushes in one pass: at most 12 a minute across both', (v->>'pushes_sent')::int = 2 and v_max <= 12, coalesce(v_minutes, ''));
  perform pg_temp.chk('R2', 'and they follow each other (60 rows over minutes 0..4)', v_minutes = '0:12,1:12,2:12,3:12,4:12', v_minutes);
  -- A retry of failed rows joins the same pace instead of re-queueing at now().
  update public.notification_outbox set status = 'failed'
  where payload->>'push_id' = '43830000-0000-4000-c000-0000000000d1';
  select campaign_id into v_campaign from public.admin_push_campaigns where id = '43830000-0000-4000-c000-0000000000d1';
  perform pg_temp.act('admin');
  set local role authenticated;
  perform public.issue_3720_admin_retry_announcement(v_campaign);
  reset role;
  select max(c) into v_max from (select next_attempt_at, count(*) c from public.notification_outbox
    where category_key in ('explorer.mingla_update', 'business.mingla_update') and status in ('pending', 'retry_wait') group by 1) x;
  perform pg_temp.chk('R2', 'a retry re-queues on the shared pace (never more than 12 in a minute)', v_max <= 12, v_max::text);
  perform pg_temp.chk('R2', 'a retried row never comes before the rows already queued',
    (select min(next_attempt_at) from public.notification_outbox where payload->>'push_id' = '43830000-0000-4000-c000-0000000000d1')
      >= (select max(next_attempt_at) from public.notification_outbox where payload->>'push_id' = '43830000-0000-4000-c000-0000000000d2'), null);
end;
$t$;

-- R3: one card whose publish raises.
create function pg_temp.t4383_card_break() returns trigger language plpgsql as $fn$
begin
  if new.id = '43830000-0000-4000-f000-0000000000d3' and new.status = 'published' then raise exception 'forced card failure'; end if;
  return new;
end;
$fn$;
create trigger t4383_card_break before update on public.community_roadmap_cards for each row execute function pg_temp.t4383_card_break();
do $t$
declare v jsonb; v_list jsonb;
begin
  insert into public.community_roadmap_cards (id, public_title, lane, status, sort_order, go_live_at, go_live_timezone)
  values ('43830000-0000-4000-f000-0000000000d3', 'Card R3', 'next', 'draft', 9103, now() - interval '1 minute', 'UTC');
  insert into public.admin_push_campaigns (id, title, body, audience, status, scheduled_for, created_by) values
    ('43830000-0000-4000-c000-0000000000d3', 'R3', 'z', 'hosts', 'scheduled', now() - interval '1 second', pg_temp.uid('admin'));
  v := public.issue_4383_fire_due_communications();
  perform pg_temp.chk('R3', 'the runner finishes: the card failed, the push in the same pass sent',
    (v->>'roadmap_cards_failed')::int = 1 and (v->>'pushes_sent')::int = 1
    and (select status = 'sent' from public.admin_push_campaigns where id = '43830000-0000-4000-c000-0000000000d3'), v::text);
  perform pg_temp.chk('R3', 'the card stays a draft with its time cleared (not retried every minute)',
    (select status = 'draft' and go_live_at is null from public.community_roadmap_cards where id = '43830000-0000-4000-f000-0000000000d3'), null);
  v := public.issue_4383_fire_due_communications();
  perform pg_temp.chk('R3', 'the next pass does not try it again', (v->>'roadmap_cards_failed')::int = 0, v::text);
  perform pg_temp.act('admin');
  set local role authenticated;
  v_list := public.issue_4383_communications_failures();
  reset role;
  perform pg_temp.chk('R3', 'Needs attention lists the card with its reason',
    exists (select 1 from jsonb_array_elements(v_list) i where i->>'id' = '43830000-0000-4000-f000-0000000000d3' and i->>'problem' = 'failed' and i->>'detail' like '%forced card failure%'), left(v_list::text, 400));
end;
$t$;
drop trigger t4383_card_break on public.community_roadmap_cards;

-- P3-1: the Admin pickers offer mingla-admin/src/lib/serverTimeZones.js; a
-- sample of it must be real here, and a zone newer than this tzdata refused.
do $t$
declare v_e text;
begin
  perform pg_temp.chk('P3-1', 'the picker sample zones exist in pg_timezone_names',
    (select count(*) from pg_catalog.pg_timezone_names where name in ('Africa/Lagos', 'America/New_York', 'Europe/Helsinki', 'Asia/Kolkata', 'UTC')) = 5, null);
  v_e := pg_temp.err($$select public.issue_4383_check_schedule(now() + interval '1 day', 'America/Coyhaique')$$);
  perform pg_temp.chk('P3-1', 'a zone the database does not know is refused', v_e like '22023 invalid_timezone%', v_e);
end;
$t$;

-- ───────────────────────────── report ─────────────────────────────
do $r$
declare r record; v_fail integer := 0; v_all integer := 0;
begin
  for r in select * from t4383_results order by seq loop
    v_all := v_all + 1;
    if r.ok then raise notice 'PASS % %', r.test, r.label;
    else v_fail := v_fail + 1; raise notice 'FAIL % % (%)', r.test, r.label, coalesce(r.detail, ''); end if;
  end loop;
  if v_all < 60 then raise exception '#4383 recorded only % checks', v_all; end if;
  if v_fail > 0 then raise exception '#4383 communications scheduling: % of % checks failed', v_fail, v_all; end if;
  raise notice '#4383 communications scheduling: % of % checks passed', v_all, v_all;
end;
$r$;

rollback;
