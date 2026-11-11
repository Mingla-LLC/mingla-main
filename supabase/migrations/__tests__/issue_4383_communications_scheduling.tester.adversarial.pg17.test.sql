-- Issue #4383 -- Admin Communications scheduling: INDEPENDENT TESTER
-- adversarial proof, on the fully replayed PG17 schema. It attacks angles the
-- implementor suite does not: the people who are not admins (a host, an
-- explorer, a growth teammate), crafted destinations, every schedule entry
-- point's time and zone checks, a host reading a scheduled roadmap card, a
-- scheduled announcement raced by Publish now, and send-now against a push
-- the runner already sent.
--
-- FAILS-ON-REVERT: delete the is_admin_user() gate from any issue_4383_* RPC
-- -> A1 fails; delete the issue_4383_push_deep_link check in push_save -> A3
-- fails; delete issue_4383_check_schedule from any schedule RPC -> A4 fails;
-- delete the status='scheduled' filter in the announcement loop of the runner,
-- or the published early-return in issue_4383_publish_announcement_internal
-- -> A6 fails.
--
-- Run from the repository root as supabase_admin. Everything is rolled back.

\set ON_ERROR_STOP on
begin;

update cron.job set active = false where active;

create temp table t4383x_people (who text primary key, id uuid not null, email text not null) on commit drop;
insert into t4383x_people (who, id, email) values
  ('admin',   '43839999-0000-4000-a000-000000000001', 'ada.x4383@test.local'),
  ('support', '43839999-0000-4000-a000-000000000002', 'sue.x4383@test.local'),
  ('host',    '43839999-0000-4000-a000-000000000003', 'hal.x4383@test.local'),
  ('explorer','43839999-0000-4000-a000-000000000004', 'exa.x4383@test.local'),
  ('nobody',  '43839999-0000-4000-a000-000000000005', 'nob.x4383@test.local');
insert into auth.users (id, email) select id, email from t4383x_people;
insert into public.admin_users (email, role, status, accepted_at) values ('ada.x4383@test.local', 'owner', 'active', now());
insert into public.admin_team_members (email, role, status, accepted_at) values ('sue.x4383@test.local', 'growth', 'active', now());
insert into public.profiles (id, display_name) select id, initcap(who) from t4383x_people where who in ('host', 'explorer', 'nobody');
insert into public.creator_accounts (id, created_at) values ('43839999-0000-4000-a000-000000000003', now());
insert into public.brands (id, account_id, name, slug, default_currency, payment_provider, payment_country, created_at, updated_at)
values ('43839999-0000-4000-b000-000000000001', '43839999-0000-4000-a000-000000000003', 'Issue 4383 Tester Brand', 'issue4383testerbrand', 'USD', 'stripe', 'US', now(), now());
insert into public.brand_team_members (brand_id, user_id, role, accepted_at, invited_at, removed_at)
values ('43839999-0000-4000-b000-000000000001', '43839999-0000-4000-a000-000000000003', 'brand_owner', now(), now(), null)
on conflict do nothing;
update public.brand_team_members set accepted_at = coalesce(accepted_at, now()), removed_at = null
where user_id = '43839999-0000-4000-a000-000000000003';

create temp table t4383x_results (seq serial primary key, test text, label text, ok boolean, detail text) on commit drop;
grant all on t4383x_results to authenticated;
grant usage, select on sequence t4383x_results_seq_seq to authenticated;
create function pg_temp.chk(p_test text, p_label text, p_ok boolean, p_detail text default null) returns void
language sql as $fn$ insert into t4383x_results (test, label, ok, detail) values (p_test, p_label, coalesce(p_ok, false), p_detail); $fn$;
create function pg_temp.uid(p_who text) returns uuid
language sql as $fn$ select id from t4383x_people where who = p_who; $fn$;
create function pg_temp.act(p_who text) returns void
language plpgsql as $fn$
begin
  perform set_config('request.jwt.claim.sub', pg_temp.uid(p_who)::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', pg_temp.uid(p_who), 'role', 'authenticated')::text, true);
end;
$fn$;
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

-- Fixtures, created as the service: a scheduled push, a scheduled
-- announcement, a draft roadmap card with a go-live time, a scheduled notice,
-- a published card (so the notice check is reachable) and a scheduled email.
insert into public.admin_push_campaigns (id, title, body, audience, status, scheduled_for, timezone, created_by)
values ('43839999-0000-4000-c000-000000000001', 'Secret push', 'Not for hosts yet', 'both', 'scheduled', now() + interval '1 day', 'Africa/Lagos', pg_temp.uid('admin'));
insert into public.community_announcements (id, title, body_md, status, scheduled_at, scheduled_timezone, scheduled_by, author_user_id)
values ('43839999-0000-4000-e000-000000000001', 'Secret announcement', 'Body', 'scheduled', now() + interval '1 day', 'UTC', pg_temp.uid('admin'), pg_temp.uid('admin'));
insert into public.community_roadmap_cards (id, public_title, lane, status, sort_order, go_live_at, go_live_timezone)
values ('43839999-0000-4000-f000-000000000001', 'Secret card', 'next', 'draft', 9001, now() + interval '1 day', 'Europe/London'),
       ('43839999-0000-4000-f000-000000000002', 'Public card', 'now', 'published', 9002, null, null);
insert into public.community_roadmap_notices_scheduled (id, scheduled_for, timezone, created_by)
values ('43839999-0000-4000-f100-000000000001', now() + interval '1 day', 'UTC', pg_temp.uid('admin'));

-- ───────────── A1 every write and admin read refused for non-admins ─────────────
do $t$
declare v_who text; v_sql text; v_e text; v_bad text := ''; v_n int := 0;
begin
  foreach v_who in array array['support', 'host', 'explorer', 'nobody'] loop
    perform pg_temp.act(v_who);
    set local role authenticated;
    foreach v_sql in array array[
      $$select public.issue_4383_push_preview()$$,
      $$select public.issue_4383_push_save(null, 'Hi', 'There', 'both', 'explore', 'community', null, 'UTC', null)$$,
      $$select public.issue_4383_push_save('43839999-0000-4000-c000-000000000001', 'Hijack', 'x', 'both', 'explore', 'community', now() + interval '2 days', 'UTC', 1)$$,
      $$select public.issue_4383_push_send_now('43839999-0000-4000-c000-000000000001', 1)$$,
      $$select public.issue_4383_push_cancel('43839999-0000-4000-c000-000000000001')$$,
      $$select public.issue_4383_push_test_to_me('43839999-0000-4000-c000-000000000001')$$,
      $$select public.issue_4383_push_list()$$,
      $$select public.issue_4383_announcement_schedule('43839999-0000-4000-e000-000000000001', now() + interval '2 days', 'UTC')$$,
      $$select public.issue_4383_announcement_unschedule('43839999-0000-4000-e000-000000000001')$$,
      $$select public.issue_3720_admin_upsert_announcement('43839999-0000-4000-e000-000000000001', 'x', 'y', null, null)$$,
      $$select public.community_publish_announcement('43839999-0000-4000-e000-000000000001')$$,
      $$select * from public.issue_3720_admin_announcement_deliveries()$$,
      $$select public.issue_4383_roadmap_schedule_card('43839999-0000-4000-f000-000000000001', now() + interval '2 days', 'UTC')$$,
      $$select public.issue_4383_roadmap_unschedule_card('43839999-0000-4000-f000-000000000001')$$,
      $$select public.issue_4383_roadmap_schedule_notice(now() + interval '2 days', 'UTC')$$,
      $$select public.issue_4383_roadmap_cancel_notice('43839999-0000-4000-f100-000000000001')$$,
      $$select public.issue_4383_roadmap_scheduled_list()$$,
      $$select public.issue_4383_communications_failures()$$,
      $$select public.community_get_announcement_notification_status(null)$$,
      $$select public.issue_3720_admin_retry_announcement(gen_random_uuid())$$,
      $$select public.issue_4383_fire_due_communications()$$,
      $$select public.issue_4383_fire_push_internal('43839999-0000-4000-c000-000000000001')$$,
      $$select public.issue_4383_publish_announcement_internal('43839999-0000-4000-e000-000000000001', null)$$,
      $$select public.issue_4383_notify_roadmap_internal(gen_random_uuid(), null)$$,
      $$select public.issue_4383_person_label('43839999-0000-4000-a000-000000000001')$$,
      $$select count(*) from public.admin_push_campaigns$$,
      $$select count(*) from public.community_roadmap_notices_scheduled$$
    ] loop
      v_n := v_n + 1;
      v_e := pg_temp.err(v_sql);
      if v_e not like '42501%' then v_bad := v_bad || v_who || ': ' || v_sql || ' -> ' || v_e || E'\n'; end if;
    end loop;
    reset role;
  end loop;
  perform pg_temp.chk('A1', 'growth teammate, host, explorer and a bare account get 42501 from every admin RPC, internal and table (' || v_n || ' calls)', v_bad = '', v_bad);
end;
$t$;
-- Nothing above changed a fixture.
select pg_temp.chk('A1', 'the fixtures are untouched after the refused calls',
  (select status = 'scheduled' and title = 'Secret push' and revision = 1 from public.admin_push_campaigns where id = '43839999-0000-4000-c000-000000000001')
  and (select status = 'scheduled' and title = 'Secret announcement' from public.community_announcements where id = '43839999-0000-4000-e000-000000000001')
  and (select go_live_at is not null from public.community_roadmap_cards where id = '43839999-0000-4000-f000-000000000001')
  and (select status = 'scheduled' from public.community_roadmap_notices_scheduled where id = '43839999-0000-4000-f100-000000000001'), null);

-- ───────────── A2 reads that must not leak ─────────────
do $t$
declare v_e text; v jsonb; v_n int;
begin
  -- Hosts and explorers get no Overview and no scheduled-email list.
  foreach v_e in array array['host', 'explorer', 'nobody'] loop
    perform pg_temp.act(v_e);
    set local role authenticated;
    perform pg_temp.chk('A2', v_e || ' gets no Overview', pg_temp.err($$select public.issue_4383_scheduled_communications()$$) like '42501%', null);
    perform pg_temp.chk('A2', v_e || ' gets no scheduled-email list', pg_temp.err($$select public.issue_4383_email_scheduled_list()$$) like '42501%', null);
    reset role;
  end loop;

  -- A Support teammate's Overview holds no push, announcement or roadmap item.
  perform pg_temp.act('support');
  set local role authenticated;
  v := public.issue_4383_scheduled_communications();
  perform pg_temp.chk('A2', 'a growth teammate''s Overview lists only email/blog kinds',
    not exists (select 1 from jsonb_array_elements(v) e where e->>'kind' in ('push', 'announcement', 'roadmap_card', 'roadmap_notice')), v::text);
  reset role;

  -- A host reading the roadmap: the draft card (and its go-live time) is hidden.
  perform pg_temp.act('host');
  set local role authenticated;
  select count(*) into v_n from public.community_roadmap_cards where id = '43839999-0000-4000-f000-000000000001';
  perform pg_temp.chk('A2', 'a host cannot read the scheduled draft card on the base table', v_n = 0, v_n::text);
  select count(*) into v_n from public.community_roadmap_cards where go_live_at is not null;
  perform pg_temp.chk('A2', 'a host sees no card with a go-live time', v_n = 0, v_n::text);
  select count(*) into v_n from public.community_roadmap_public where id = '43839999-0000-4000-f000-000000000001';
  perform pg_temp.chk('A2', 'a host cannot read it through the public view', v_n = 0, v_n::text);
  perform pg_temp.chk('A2', 'the internal note stays unreadable to a host', pg_temp.err($$select internal_note from public.community_roadmap_cards limit 1$$) like '42501%', null);
  select count(*) into v_n from public.community_announcements where id = '43839999-0000-4000-e000-000000000001';
  perform pg_temp.chk('A2', 'a host cannot read the scheduled announcement', v_n = 0, v_n::text);
  reset role;
end;
$t$;

-- ───────────── A3 crafted destinations ─────────────
do $t$
declare v_args text; v_e text; v_bad text := '';
begin
  perform pg_temp.act('admin');
  set local role authenticated;
  foreach v_args in array array[
    $$'connections', 'community'$$, $$'Discover', 'community'$$, $$' likes', 'community'$$,
    $$'saved', 'community'$$, $$'profile', 'community'$$, $$'mingla://home', 'community'$$, $$'', 'community'$$,
    $$'explore', 'Home'$$, $$'explore', 'home '$$, $$'explore', 'connections'$$, $$'explore', '(tabs)/home'$$,
    $$'explore', 'mingla-business://home'$$, $$'explore', 'community/announcement/x'$$
  ] loop
    foreach v_e in array array['hosts', 'explorers', 'both'] loop
      declare v_r text;
      begin
        v_r := pg_temp.err(format($$select public.issue_4383_push_save(null, 'Hi', 'There', %L, %s, null, 'UTC', null)$$, v_e, v_args));
        if v_r not like '22023 invalid_destination%' then v_bad := v_bad || v_e || ' (' || v_args || ') -> ' || v_r || E'\n'; end if;
      end;
    end loop;
  end loop;
  perform pg_temp.chk('A3', 'every destination outside the five-row table is refused, whatever the audience', v_bad = '', v_bad);
  reset role;
  perform pg_temp.chk('A3', 'the SQL table maps only the five §4.6 rows',
    (select count(*) from (values ('explorer','explore'),('explorer','discover'),('explorer','likes'),('explorer','connections'),('explorer','saved'),
       ('host','community'),('host','home'),('host','explore'),('explorer','home'),('host','likes'),(null,'home'),('host',null)) v(a, t)
     where public.issue_4383_push_deep_link(a, t) is not null) = 5, null);
  -- A row forced past the RPC (only the service can) is refused at the table.
  perform pg_temp.chk('A3', 'the table CHECK refuses explorer_target connections',
    pg_temp.err($$insert into public.admin_push_campaigns (title, body, audience, explorer_target) values ('a', 'b', 'explorers', 'connections')$$) like '23514%', null);
  perform pg_temp.chk('A3', 'the table CHECK refuses host_target home with a different spelling',
    pg_temp.err($$insert into public.admin_push_campaigns (title, body, audience, host_target) values ('a', 'b', 'hosts', 'Home')$$) like '23514%', null);
end;
$t$;

-- ───────────── A4 every schedule entry point checks time and zone ─────────────
do $t$
declare v_sql text; v_e text; v_bad text := '';
begin
  perform pg_temp.act('admin');
  set local role authenticated;
  foreach v_sql in array array[
    -- past, now, 59 s ahead
    $$select public.issue_4383_announcement_schedule('43839999-0000-4000-e000-000000000001', now() - interval '1 hour', 'UTC')|scheduled_time_past$$,
    $$select public.issue_4383_announcement_schedule('43839999-0000-4000-e000-000000000001', now(), 'UTC')|scheduled_time_past$$,
    $$select public.issue_4383_announcement_schedule('43839999-0000-4000-e000-000000000001', now() + interval '59 seconds', 'UTC')|scheduled_time_past$$,
    $$select public.issue_4383_announcement_schedule('43839999-0000-4000-e000-000000000001', null, 'UTC')|scheduled_time_past$$,
    $$select public.issue_4383_roadmap_schedule_card('43839999-0000-4000-f000-000000000001', now() - interval '1 second', 'UTC')|scheduled_time_past$$,
    $$select public.issue_4383_roadmap_schedule_notice(now() - interval '1 day', 'UTC')|scheduled_time_past$$,
    $$select public.issue_4383_push_save('43839999-0000-4000-c000-000000000001', 'x', 'y', 'both', 'explore', 'community', now() - interval '1 day', 'UTC', 1)|scheduled_time_past$$,
    -- zones
    $$select public.issue_4383_announcement_schedule('43839999-0000-4000-e000-000000000001', now() + interval '1 day', 'Lagos')|invalid_timezone$$,
    $$select public.issue_4383_announcement_schedule('43839999-0000-4000-e000-000000000001', now() + interval '1 day', null)|invalid_timezone$$,
    $$select public.issue_4383_roadmap_schedule_card('43839999-0000-4000-f000-000000000001', now() + interval '1 day', 'africa/lagos')|invalid_timezone$$,
    $$select public.issue_4383_roadmap_schedule_notice(now() + interval '1 day', '+01:00')|invalid_timezone$$,
    $$select public.issue_4383_roadmap_schedule_notice(now() + interval '1 day', 'UTC; drop table x')|invalid_timezone$$,
    $$select public.issue_4383_push_save(null, 'x', 'y', 'both', 'explore', 'community', now() + interval '1 day', 'Mars/Base', null)|invalid_timezone$$,
    -- stale revision and finished items
    $$select public.issue_4383_push_save('43839999-0000-4000-c000-000000000001', 'x', 'y', 'both', 'explore', 'community', null, 'UTC', 2)|stale_revision$$,
    $$select public.issue_4383_push_save('43839999-0000-4000-c000-000000000001', 'x', 'y', 'both', 'explore', 'community', null, 'UTC', null)|stale_revision$$,
    $$select public.issue_4383_push_send_now('43839999-0000-4000-c000-000000000001', 0)|stale_revision$$,
    $$select public.issue_4383_roadmap_schedule_card('43839999-0000-4000-f000-000000000002', now() + interval '1 day', 'UTC')|already_published$$
  ] loop
    v_e := pg_temp.err(split_part(v_sql, '|', 1));
    if v_e not like '%' || split_part(v_sql, '|', 2) || '%' then v_bad := v_bad || split_part(v_sql, '|', 1) || ' -> ' || v_e || E'\n'; end if;
  end loop;
  perform pg_temp.chk('A4', 'every schedule RPC refuses past/now/<60 s times, bad zones, stale revisions and finished items', v_bad = '', v_bad);
  reset role;
  perform pg_temp.chk('A4', 'and none of them changed a fixture',
    (select scheduled_at > now() + interval '23 hours' from public.community_announcements where id = '43839999-0000-4000-e000-000000000001')
    and (select revision = 1 from public.admin_push_campaigns where id = '43839999-0000-4000-c000-000000000001')
    and (select count(*) = 1 from public.community_roadmap_notices_scheduled where created_by = pg_temp.uid('admin')), null);
end;
$t$;

-- ───────────── A5 send now on a push the runner already took ─────────────
insert into public.admin_push_campaigns (id, title, body, audience, status, scheduled_for, timezone, created_by)
values ('43839999-0000-4000-c000-000000000002', 'Due', 'Hosts only', 'hosts', 'scheduled', now() - interval '1 second', 'UTC', pg_temp.uid('admin'));
select public.issue_4383_fire_due_communications();
do $t$
declare v_e text; v_n int;
begin
  update public.admin_push_campaigns set fired_at = now() - interval '5 minutes' where id = '43839999-0000-4000-c000-000000000002';
  perform pg_temp.act('admin');
  set local role authenticated;
  v_e := pg_temp.err($$select public.issue_4383_push_send_now('43839999-0000-4000-c000-000000000002', 1)$$);
  perform pg_temp.chk('A5', 'send now on a sent push is PT409 already_sending', v_e like 'PT409 already_sending%', v_e);
  v_e := pg_temp.err($$select public.issue_4383_push_cancel('43839999-0000-4000-c000-000000000002')$$);
  perform pg_temp.chk('A5', 'cancel on a sent push is PT409 already_sending', v_e like 'PT409 already_sending%', v_e);
  reset role;
  select count(*) into v_n from public.notification_outbox where payload->>'push_id' = '43839999-0000-4000-c000-000000000002';
  perform pg_temp.chk('A5', 'exactly one host row and nothing for explorers', v_n = 1
    and not exists (select 1 from public.notification_outbox where payload->>'push_id' = '43839999-0000-4000-c000-000000000002' and category_key <> 'business.mingla_update'), v_n::text);
  perform pg_temp.chk('A5', 'the outbox payload carries exactly body, campaign_id, deep_link, push_id, title',
    not exists (select 1 from public.notification_outbox where payload->>'push_id' = '43839999-0000-4000-c000-000000000002'
      and (select array_agg(k order by k) from jsonb_object_keys(payload) k) <> array['body','campaign_id','deep_link','push_id','title']), null);
end;
$t$;

-- ───────────── A6 a scheduled announcement raced by Publish now publishes once ─────────────
do $t$
declare v jsonb; v_rows int; v_hosts int; v_camp int;
begin
  update public.community_announcements set scheduled_at = now() - interval '1 second' where id = '43839999-0000-4000-e000-000000000001';
  perform pg_temp.act('admin');
  set local role authenticated;
  v := public.community_publish_announcement('43839999-0000-4000-e000-000000000001');
  reset role;
  perform pg_temp.chk('A6', 'Publish now on a scheduled announcement publishes it', v->>'duplicate' = 'false', v::text);
  v := public.issue_4383_fire_due_communications();
  perform pg_temp.chk('A6', 'the runner then publishes nothing more', (v->>'announcements_published')::int = 0 and (v->>'announcements_failed')::int = 0, v::text);
  select count(*) into v_rows from public.notification_outbox where payload->>'announcement_id' = '43839999-0000-4000-e000-000000000001';
  select count(distinct btm.user_id) into v_hosts from public.brand_team_members btm join auth.users u on u.id = btm.user_id where btm.accepted_at is not null and btm.removed_at is null;
  select count(*) into v_camp from public.community_notification_campaigns where kind = 'announcement' and source_id = '43839999-0000-4000-e000-000000000001';
  perform pg_temp.chk('A6', 'one outbox row per host and one campaign', v_rows = v_hosts and v_camp = 1, v_rows || ' rows / ' || v_hosts || ' hosts / ' || v_camp || ' campaigns');
  perform pg_temp.chk('A6', 'it is published with its schedule cleared',
    (select status = 'published' and scheduled_at is null from public.community_announcements where id = '43839999-0000-4000-e000-000000000001'), null);
  perform pg_temp.act('admin');
  set local role authenticated;
  perform pg_temp.chk('A6', 'a published announcement can no longer be edited', pg_temp.err($$select public.issue_3720_admin_upsert_announcement('43839999-0000-4000-e000-000000000001', 'x', 'y', null, null)$$) like '22023 not_editable%', null);
  perform pg_temp.chk('A6', 'nor scheduled again', pg_temp.err($$select public.issue_4383_announcement_schedule('43839999-0000-4000-e000-000000000001', now() + interval '1 day', 'UTC')$$) like 'PT409 already_published%', null);
  perform pg_temp.chk('A6', 'nor unscheduled', pg_temp.err($$select public.issue_4383_announcement_unschedule('43839999-0000-4000-e000-000000000001')$$) like 'PT409%', null);
  reset role;
end;
$t$;

-- ───────────── report ─────────────
do $r$
declare r record; v_fail integer := 0; v_all integer := 0;
begin
  for r in select * from t4383x_results order by seq loop
    v_all := v_all + 1;
    if r.ok then raise notice 'PASS % %', r.test, r.label;
    else v_fail := v_fail + 1; raise notice 'FAIL % % (%)', r.test, r.label, coalesce(r.detail, ''); end if;
  end loop;
  if v_all < 25 then raise exception '#4383 tester recorded only % checks', v_all; end if;
  if v_fail > 0 then raise exception '#4383 tester adversarial: % of % checks failed', v_fail, v_all; end if;
  raise notice '#4383 tester adversarial: % of % checks passed', v_all, v_all;
end;
$r$;

rollback;
