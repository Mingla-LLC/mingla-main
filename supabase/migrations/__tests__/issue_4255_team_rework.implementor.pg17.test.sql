-- Issue #4255 (Work board v2 + Mingla team) rework -- implementor suite for
-- 20280624054255_issue_4255_team_rework.sql, on the fully replayed PG17
-- schema.
-- MINGLA-INVARIANT: I-4255-TEAM-DECISION-PRODUCER | issue #4255 | a card that gains a You send, You spend, You publish or Needs your OK tag queues business.team_decision (never business.team_mention) for each of its staff people, under the Decisions for me switches: push or in-app on queues it (in-app off says inapp false), both off queues nothing.
-- MINGLA-INVARIANT: I-4255-TEAM-DUE-DIGEST | issue #4255 | ops_due_digest tells a confirmed staff owner of open cards due today or late once per local day, only when their own clock (profiles.timezone) reads 09:xx: one team_mentions row (work_due, from Mingla) and one business.team_due row under its switches; never a host, never at another hour.
-- MINGLA-INVARIANT: I-4255-THREAD-UNREAD-PER-PERSON | issue #4255 | a card's thread_unread counts messages after the reader's own marker (ops_thread_read on open, or their own post); their own posts and deleted messages never count; an agent never clears its person's marker.
-- MINGLA-INVARIANT: I-4255-TEAM-BADGE-NO-DOUBLE-COUNT | issue #4255 | team_badge mentions counts only Mentions-tab rows (not team chat mentions, which are in their chat's unread count), so total = chats with unread + unread Mentions-tab items.
-- MINGLA-INVARIANT: I-4255-MENTION-OPENS-THREAD | issue #4255 | a work card mention links to #/work-board?card=<id>&side=thread:<id>.
--
--   R-DECIDE  tag -> business.team_decision (deep link to Mentions, ids only);
--             not a team_mention push; in-app off -> inapp false; both off
--             -> nothing queued; a plain mention still team_mention
--   R-LINK    new and existing card mentions open the card's thread
--   R-DUE     09:xx local only, once per day, owners of due/late open cards
--             only, not hosts; switches; from Mingla in team_inbox; cron job
--   R-UNREAD  thread_unread per person; open and post clear it; agent posts
--             count but agents never clear; deletes never count; no client
--             access to the markers
--   R-BADGE   a chat mention is counted once (in its chat), an Admin mention
--             on Mentions
--
-- FAILS-ON-REVERT (proved by deleting the fix lines from the migration,
-- re-applying the earlier bodies, running this suite, then restoring):
-- without A in ops_notify_people R-DECIDE fails (a business.team_mention row,
-- no decision row); without B R-LINK fails; without ops_due_digest R-DUE
-- fails; without D R-UNREAD fails (no thread_unread); without E R-BADGE
-- fails (mentions 1, total 2 for one chat mention).
--
-- Run from the repository root as supabase_admin. Everything is rolled back.

\set ON_ERROR_STOP on
begin;

alter table auth.users add column if not exists email_confirmed_at timestamptz;

create temp table t45_people (who text primary key, id uuid not null, email text not null) on commit drop;
insert into t45_people (who, id, email) values
  ('owner', '42553000-0000-4000-a0f2-000000000001', 'oz.r4255@test.local'),
  ('gem',   '42553000-0000-4000-a0f2-000000000003', 'gem.r4255@test.local'),
  ('ray',   '42553000-0000-4000-a0f2-000000000004', 'ray.r4255@test.local'),
  ('host',  '42553000-0000-4000-a0f2-000000000005', 'host.r4255@test.local');
insert into auth.users (id, email, email_confirmed_at) select id, email, now() from t45_people;
insert into public.admin_users (email, role, status, accepted_at) values
  ('oz.r4255@test.local', 'owner', 'active', now());
insert into public.admin_team_members (email, role, status, accepted_at) values
  ('gem.r4255@test.local', 'growth', 'active', now()),
  ('ray.r4255@test.local', 'growth', 'active', now());
-- Ray lives in Lagos, Gem in New York; the host in Lagos too.
insert into public.profiles (id, timezone) values
  ('42553000-0000-4000-a0f2-000000000004', 'Africa/Lagos'),
  ('42553000-0000-4000-a0f2-000000000003', 'America/New_York'),
  ('42553000-0000-4000-a0f2-000000000005', 'Africa/Lagos')
on conflict (id) do update set timezone = excluded.timezone;

create temp table t45_results (seq serial primary key, test text, label text, ok boolean, detail text) on commit drop;
create temp table t45_ids (k text primary key, id uuid not null) on commit drop;

create function pg_temp.as_(p_who text, p_sql text) returns text
language plpgsql as $fn$
declare v_id uuid; v_email text; v_out text;
begin
  select id, email into strict v_id, v_email from t45_people where who = p_who;
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
  select id, email into strict v_id, v_email from t45_people where who = p_who;
  insert into public.team_agent_calls (key_id, owner_email, actor_uid, agent, tool, xact_id, started_at)
  values (gen_random_uuid(), v_email, v_id, 'claude', 'update_work', pg_current_xact_id(), clock_timestamp());
  return pg_temp.as_(p_who, p_sql);
end;
$fn$;
create function pg_temp.chk(p_test text, p_label text, p_got text, p_want text) returns void
language sql as $fn$
  insert into t45_results (test, label, ok, detail)
  values (p_test, p_label, p_got is not distinct from p_want,
          format('got %s, want %s', coalesce(left(p_got, 500), '<null>'), coalesce(p_want, '<null>')));
$fn$;
create function pg_temp.keep(p_k text, p_id uuid) returns uuid
language sql as $fn$ insert into t45_ids (k, id) values (p_k, p_id) on conflict (k) do update set id = excluded.id returning id $fn$;
create function pg_temp.id(p_k text) returns uuid language sql as $fn$ select id from t45_ids where k = p_k $fn$;
create function pg_temp.uid(p_who text) returns uuid language sql as $fn$ select id from t45_people where who = p_who $fn$;
create function pg_temp.email(p_who text) returns text language sql as $fn$ select email from t45_people where who = p_who $fn$;
create function pg_temp.rev(p_k text) returns bigint
language sql as $fn$ select revision from public.ops_work_cards where id = (select id from t45_ids where k = p_k) $fn$;
create function pg_temp.rk() returns text language sql as $fn$ select 't45-' || md5(random()::text || clock_timestamp()::text) $fn$;
create function pg_temp.pref(p_who text, p_cat text, p_channel text, p_on boolean) returns void
language sql as $fn$
  insert into public.notification_channel_prefs (user_id, category_key, channel, enabled)
  values (pg_temp.uid(p_who), p_cat, p_channel, p_on)
  on conflict (user_id, category_key, channel) do update set enabled = excluded.enabled
$fn$;
create function pg_temp.add(p_k text, p_who text, p_title text, p_owner text) returns text
language plpgsql as $fn$
declare v text;
begin
  v := pg_temp.person(p_who, format('select public.ops_work_add(%L::jsonb, %L)::text',
    jsonb_build_array(jsonb_build_object('title', p_title, 'instructions', 'Do the work carefully and say what changed.',
      'done_means', 'It is done and checked.', 'owners', jsonb_build_array(p_owner), 'due_on', (now() at time zone 'UTC')::date + 3)),
    pg_temp.rk()));
  if v not like 'ERR:%' and (v::jsonb)->'results'->0->>'status' = 'added' then
    perform pg_temp.keep(p_k, ((v::jsonb)->'results'->0->'card'->>'id')::uuid);
  end if;
  return v;
end;
$fn$;
-- What the outbox holds for a person and a card: "category:reason:inapp", in order.
create function pg_temp.queued(p_who text, p_card uuid) returns text
language sql as $fn$
  select coalesce(string_agg(o.category_key || ':' || coalesce(o.payload->>'reason', '') || ':' || coalesce(o.payload->>'inapp', '-'), ',' order by o.category_key), 'none')
    from public.notification_outbox o
   where o.user_id = pg_temp.uid(p_who) and o.payload->>'card_id' = p_card::text and o.category_key like 'business.team_%'
$fn$;
create function pg_temp.tag(p_k text, p_who text, p_reason text) returns text
language sql as $fn$
  select pg_temp.person(p_who, format('select public.ops_work_update(%L, %L::jsonb, %s)::text', pg_temp.id(p_k),
    jsonb_build_object('person_reason', p_reason), pg_temp.rev(p_k)))
$fn$;

-- ───────────────────────────── R-DECIDE ─────────────────────────────
do $t$
declare v text; v_link text; v_mention uuid;
begin
  v := pg_temp.add('D1', 'gem', 'R4255 Send the sponsor deck', pg_temp.email('ray'));
  perform pg_temp.chk('R-DECIDE', 'a card for Ray is added', coalesce((v::jsonb)->'results'->0->>'status', v), 'added');
  delete from public.notification_outbox where user_id = pg_temp.uid('ray');
  v := pg_temp.tag('D1', 'gem', 'send');
  perform pg_temp.chk('R-DECIDE', 'the tag is saved', case when v like 'ERR:%' then v else 'ok' end, 'ok');
  perform pg_temp.chk('R-DECIDE', 'You send queues one business.team_decision for Ray and no business.team_mention',
    pg_temp.queued('ray', pg_temp.id('D1')), 'business.team_decision:decision:true');
  select o.payload->>'deep_link', (o.payload->>'mention_id')::uuid into v_link, v_mention
    from public.notification_outbox o where o.user_id = pg_temp.uid('ray') and o.category_key = 'business.team_decision'
     and o.payload->>'card_id' = pg_temp.id('D1')::text;
  perform pg_temp.chk('R-DECIDE', 'it opens that mention on Mentions in the Host app',
    v_link, 'mingla-business://team/mention/' || v_mention::text);
  perform pg_temp.chk('R-DECIDE', 'the payload holds ids and flags only (no words)',
    (select string_agg(k, ',' order by k) from public.notification_outbox o, jsonb_object_keys(o.payload) k
      where o.user_id = pg_temp.uid('ray') and o.category_key = 'business.team_decision' and o.payload->>'card_id' = pg_temp.id('D1')::text),
    'actor_user_id,card_id,deep_link,inapp,mention_id,reason,source_id,source_kind');
  perform pg_temp.chk('R-DECIDE', 'the Mentions row is the same decision, with the tag''s words',
    (select (body_excerpt like '%· You send')::text from public.team_mentions where id = v_mention), 'true');

  -- In-app off, push on: still pushed, no bell row.
  perform pg_temp.pref('ray', 'business.team_decision', 'inapp', false);
  v := pg_temp.add('D2', 'gem', 'R4255 Approve the venue spend', pg_temp.email('ray'));
  delete from public.notification_outbox where user_id = pg_temp.uid('ray'); -- the "added you as owner" notice
  v := pg_temp.tag('D2', 'gem', 'spend');
  perform pg_temp.chk('R-DECIDE', 'Decisions in-app off: queued with inapp false',
    pg_temp.queued('ray', pg_temp.id('D2')), 'business.team_decision:decision:false');

  -- Both off: nothing queued (the Mentions row and the email stay).
  perform pg_temp.pref('ray', 'business.team_decision', 'push', false);
  v := pg_temp.add('D3', 'gem', 'R4255 Publish the recap post', pg_temp.email('ray'));
  delete from public.notification_outbox where user_id = pg_temp.uid('ray'); -- the "added you as owner" notice
  v := pg_temp.tag('D3', 'gem', 'publish');
  perform pg_temp.chk('R-DECIDE', 'Decisions push and in-app off: no team push queued',
    pg_temp.queued('ray', pg_temp.id('D3')), 'none');
  perform pg_temp.chk('R-DECIDE', 'the Mentions row and the email are still there',
    (select count(*)::text from public.team_mentions tm join public.ops_work_events e on e.id = tm.source_id
      where tm.target_user_id = pg_temp.uid('ray') and e.card_id = pg_temp.id('D3') and tm.body_excerpt like '%· You publish')
    || '/' ||
    (select count(*)::text from public.notification_outbox o where o.user_id = pg_temp.uid('ray') and o.category_key = 'admin.team_mention'
      and o.payload->>'card_id' = pg_temp.id('D3')::text and o.payload->>'body' like '%You publish'),
    '1/1');
  perform pg_temp.pref('ray', 'business.team_decision', 'push', true);
  perform pg_temp.pref('ray', 'business.team_decision', 'inapp', true);

  -- A plain mention is still a mention.
  delete from public.notification_outbox where user_id = pg_temp.uid('ray');
  v := pg_temp.person('gem', format($q$select public.ops_message_post(%L, 'Ray, and the budget', array[%L], null, null, false, %L)::text$q$,
    pg_temp.id('D1'), pg_temp.email('ray'), pg_temp.rk()));
  perform pg_temp.chk('R-DECIDE', 'a mention in the thread is still business.team_mention',
    pg_temp.queued('ray', pg_temp.id('D1')), 'business.team_mention:mention:-');
end;
$t$;

-- ───────────────────────────── R-LINK ─────────────────────────────
do $t$
begin
  perform pg_temp.chk('R-LINK', 'the new mention opens the card with its thread',
    (select string_agg(distinct tm.deep_link, ',') from public.team_mentions tm join public.ops_work_events e on e.id = tm.source_id
      where tm.target_user_id = pg_temp.uid('ray') and e.card_id = pg_temp.id('D1')),
    'https://admin.usemingla.com/#/work-board?card=' || pg_temp.id('D1')::text || '&side=thread:' || pg_temp.id('D1')::text);
  perform pg_temp.chk('R-LINK', 'its email links the same way',
    (select string_agg(distinct o.payload->>'deep_link', ',') from public.notification_outbox o
      where o.user_id = pg_temp.uid('ray') and o.category_key = 'admin.team_mention' and o.payload->>'card_id' = pg_temp.id('D1')::text),
    'https://admin.usemingla.com/#/work-board?card=' || pg_temp.id('D1')::text || '&side=thread:' || pg_temp.id('D1')::text);
  perform pg_temp.chk('R-LINK', 'no card mention anywhere keeps the old link without the thread',
    (select count(*)::text from public.team_mentions where source_kind = 'work_card'
      and deep_link ~ '^https://admin\.usemingla\.com/#/work-board\?card=[0-9a-f-]{36}$'), '0');
end;
$t$;

-- ───────────────────────────── R-DUE ─────────────────────────────
do $t$
declare v text; v_day date := (now() at time zone 'Africa/Lagos')::date; v_at timestamptz; v_n integer; v_mention uuid;
begin
  -- Ray owns: one due today, one late, one next week, one late but done.
  -- Gem (New York) owns one late card. The host owns nothing on the board.
  v := pg_temp.add('T1', 'gem', 'R4255 Book the venue', pg_temp.email('ray'));
  v := pg_temp.add('T2', 'gem', 'R4255 Send the deck', pg_temp.email('ray'));
  v := pg_temp.add('T3', 'gem', 'R4255 Plan next month', pg_temp.email('ray'));
  v := pg_temp.add('T4', 'gem', 'R4255 Old thing', pg_temp.email('ray'));
  v := pg_temp.add('T5', 'owner', 'R4255 Gem late card', pg_temp.email('gem'));
  -- Ray's earlier cards in this suite are not due; only these count.
  update public.ops_work_cards set due_on = v_day + 30 where id in (pg_temp.id('D1'), pg_temp.id('D2'), pg_temp.id('D3'));
  update public.ops_work_cards set due_on = v_day where id = pg_temp.id('T1');
  update public.ops_work_cards set due_on = v_day - 2 where id = pg_temp.id('T2');
  update public.ops_work_cards set due_on = v_day + 7 where id = pg_temp.id('T3');
  update public.ops_work_cards set due_on = v_day - 5 where id = pg_temp.id('T4');
  v := pg_temp.person('gem', format($q$select public.ops_work_move(%L, %L, %s, '[{"kind":"text","text":"Done and checked by hand."}]'::jsonb, null, false)::text$q$,
    pg_temp.id('T4'), (select id from public.ops_work_statuses where grp = 'done' and archived_at is null order by position limit 1), pg_temp.rev('T4')));
  perform pg_temp.chk('R-DUE', 'the old card is closed', (select status from public.ops_work_cards where id = pg_temp.id('T4')), 'done');
  update public.ops_work_cards set due_on = v_day - 1 where id = pg_temp.id('T5');
  delete from public.notification_outbox where category_key = 'business.team_due';

  -- 08:40 in Lagos: too early for Ray.
  v_at := (v_day + time '08:40') at time zone 'Africa/Lagos';
  perform public.ops_due_digest(v_at);
  perform pg_temp.chk('R-DUE', 'at 08:40 Lagos time Ray is not told yet',
    (select count(*)::text from public.team_mentions where source_kind = 'work_due' and target_user_id = pg_temp.uid('ray')), '0');

  -- 09:10 in Lagos: Ray is told once.
  v_at := (v_day + time '09:10') at time zone 'Africa/Lagos';
  perform public.ops_due_digest(v_at);
  select id into v_mention from public.team_mentions where source_kind = 'work_due' and target_user_id = pg_temp.uid('ray');
  perform pg_temp.chk('R-DUE', 'at 09:10 Lagos time Ray gets one Mentions row for his own open cards due today or late',
    (select body_excerpt || ' | ' || deep_link from public.team_mentions where id = v_mention),
    '1 due today · 1 late: R4255 Send the deck, R4255 Book the venue | https://admin.usemingla.com/#/work-board?view=today&who=mine');
  perform pg_temp.chk('R-DUE', 'and one business.team_due push opening it on Mentions (ids and counts only)',
    (select string_agg(o.payload->>'deep_link' || '|' || (o.payload->>'due_today') || '|' || (o.payload->>'late') || '|' || (o.payload->>'inapp') || '|' || coalesce(o.country_code, 'null'), ',')
       from public.notification_outbox o where o.category_key = 'business.team_due' and o.user_id = pg_temp.uid('ray')),
    'mingla-business://team/mention/' || v_mention::text || '|1|1|true|null');
  perform pg_temp.chk('R-DUE', 'Gem (New York, 03:10 there) is not told at that hour',
    (select count(*)::text from public.team_mentions where source_kind = 'work_due' and target_user_id = pg_temp.uid('gem')), '0');
  perform pg_temp.chk('R-DUE', 'a host is never told',
    (select count(*)::text from public.team_mentions where source_kind = 'work_due' and target_user_id = pg_temp.uid('host')), '0');

  -- 09:50 the same day: nothing new.
  perform public.ops_due_digest(v_at + interval '40 minutes');
  perform pg_temp.chk('R-DUE', 'once per day: a second run in the same hour adds nothing',
    (select count(*)::text from public.team_mentions where source_kind = 'work_due' and target_user_id = pg_temp.uid('ray'))
    || '/' || (select count(*)::text from public.notification_outbox where category_key = 'business.team_due' and user_id = pg_temp.uid('ray')), '1/1');

  -- Gem's 09:00 in New York.
  perform public.ops_due_digest((((now() at time zone 'America/New_York')::date) + time '09:05') at time zone 'America/New_York');
  perform pg_temp.chk('R-DUE', 'Gem is told at 09:05 New York time',
    (select count(*)::text from public.team_mentions where source_kind = 'work_due' and target_user_id = pg_temp.uid('gem')), '1');

  -- The next day with both switches off: on Mentions, no push.
  perform pg_temp.pref('ray', 'business.team_due', 'push', false);
  perform pg_temp.pref('ray', 'business.team_due', 'inapp', false);
  v_n := public.ops_due_digest(((v_day + 1) + time '09:01') at time zone 'Africa/Lagos');
  perform pg_temp.chk('R-DUE', 'switches off: the Mentions row is written, no push is queued',
    (select count(*)::text from public.team_mentions where source_kind = 'work_due' and target_user_id = pg_temp.uid('ray'))
    || '/' || (select count(*)::text from public.notification_outbox where category_key = 'business.team_due' and user_id = pg_temp.uid('ray')), '2/1');

  -- In-app off alone: pushed without a bell row.
  perform pg_temp.pref('ray', 'business.team_due', 'push', true);
  v_n := public.ops_due_digest(((v_day + 2) + time '09:01') at time zone 'Africa/Lagos');
  perform pg_temp.chk('R-DUE', 'in-app off alone: queued with inapp false',
    (select count(*) filter (where o.payload->>'inapp' = 'true') || '/' || count(*) filter (where o.payload->>'inapp' = 'false')
       from public.notification_outbox o where o.category_key = 'business.team_due' and o.user_id = pg_temp.uid('ray')), '1/1');

  perform pg_temp.chk('R-DUE', 'team_inbox shows it from Mingla',
    pg_temp.person('ray', $q$select string_agg(distinct m->>'actor_name', ',') from jsonb_array_elements(public.team_inbox(null, 100)->'mentions') m where m->>'source_kind' = 'work_due'$q$),
    'Mingla');
  perform pg_temp.chk('R-DUE', 'the category is in-app and push, and active',
    (select array_to_string(default_channels, '+') || ':' || active::text from public.notification_categories where key = 'business.team_due'),
    'inapp+push:true');
  perform pg_temp.chk('R-DUE', 'nobody but the service role runs the digest',
    (pg_temp.person('ray', 'select public.ops_due_digest()::text') like 'ERR:42501:%')::text, 'true');
  perform pg_temp.chk('R-DUE', 'pg_cron runs it at the top of every hour',
    (select coalesce(string_agg(schedule || ' ' || command, ','), 'no pg_cron') from cron.job where jobname = 'issue_4255_due_digest'),
    '0 * * * * SELECT public.ops_due_digest();');
end;
$t$;

-- ───────────────────────────── R-UNREAD ─────────────────────────────
do $t$
declare v text; v_card uuid; v_msg uuid;
begin
  v := pg_temp.add('U1', 'gem', 'R4255 Thread badge card', pg_temp.email('ray'));
  v_card := pg_temp.id('U1');
  v := pg_temp.person('gem', format($q$select public.ops_message_post(%L, 'First note', '{}', null, null, false, %L)::text$q$, v_card, pg_temp.rk()));
  v_msg := ((v::jsonb)->'message'->>'id')::uuid;
  perform pg_temp.chk('R-UNREAD', 'Ray has one unread; Gem, who posted it, has none',
    pg_temp.person('ray', format($q$select public.ops_work_get(%L)->'card'->>'thread_unread'$q$, v_card)) || '/' ||
    pg_temp.person('gem', format($q$select public.ops_work_get(%L)->'card'->>'thread_unread'$q$, v_card)), '1/0');
  perform pg_temp.chk('R-UNREAD', 'Ray opens the thread: 0',
    pg_temp.person('ray', format($q$select public.ops_thread_read(%L)->>'thread_unread'$q$, v_card)) || '/' ||
    pg_temp.person('ray', format($q$select public.ops_work_get(%L)->'card'->>'thread_unread'$q$, v_card)), '0/0');
  v := pg_temp.person('gem', format($q$select public.ops_message_post(%L, 'Second note', '{}', null, null, false, %L)::text$q$, v_card, pg_temp.rk()));
  v := pg_temp.agent('ray', format($q$select public.ops_message_post(%L, 'Venue confirmed by phone.', '{}', null, null, false, %L)::text$q$, v_card, pg_temp.rk()));
  perform pg_temp.chk('R-UNREAD', 'a new note and Ray''s own agent''s post are unread for Ray; the agent post is unread for Gem too',
    pg_temp.person('ray', format($q$select public.ops_work_get(%L)->'card'->>'thread_unread'$q$, v_card)) || '/' ||
    pg_temp.person('gem', format($q$select public.ops_work_get(%L)->'card'->>'thread_unread'$q$, v_card)), '2/1');
  v := pg_temp.agent('ray', format($q$select public.ops_thread_read(%L)::text$q$, v_card));
  perform pg_temp.chk('R-UNREAD', 'Ray''s agent reading the thread does not clear Ray''s badge',
    pg_temp.person('ray', format($q$select public.ops_work_get(%L)->'card'->>'thread_unread'$q$, v_card)), '2');
  v := pg_temp.person('ray', format($q$select public.ops_message_post(%L, 'Thanks both', '{}', null, null, false, %L)::text$q$, v_card, pg_temp.rk()));
  perform pg_temp.chk('R-UNREAD', 'Ray posting marks it read for Ray',
    pg_temp.person('ray', format($q$select public.ops_work_get(%L)->'card'->>'thread_unread'$q$, v_card)), '0');
  perform pg_temp.chk('R-UNREAD', 'Gem sees Ray''s reply as one more unread (2)',
    pg_temp.person('gem', format($q$select public.ops_work_get(%L)->'card'->>'thread_unread'$q$, v_card)), '2');
  v := pg_temp.person('ray', (select format('select public.ops_message_delete(%L, %s)::text', m.id, m.revision)
                               from public.ops_work_messages m where m.card_id = v_card and m.body_md = 'Thanks both'));
  perform pg_temp.chk('R-UNREAD', 'Ray deletes his reply', case when v like 'ERR:%' then v else 'ok' end, 'ok');
  perform pg_temp.chk('R-UNREAD', 'a deleted message never counts',
    pg_temp.person('gem', format($q$select public.ops_work_get(%L)->'card'->>'thread_unread'$q$, v_card)), '1');
  perform pg_temp.chk('R-UNREAD', 'a host cannot mark a thread read',
    (pg_temp.person('host', format($q$select public.ops_thread_read(%L)::text$q$, v_card)) like 'ERR:%')::text, 'true');
  perform pg_temp.chk('R-UNREAD', 'no signed-in client reads the markers directly',
    (pg_temp.person('ray', 'select count(*)::text from public.ops_work_thread_reads') like 'ERR:42501:%')::text, 'true');
  perform pg_temp.chk('R-UNREAD', 'the markers table has RLS on',
    (select relrowsecurity::text from pg_class where oid = 'public.ops_work_thread_reads'::regclass), 'true');
end;
$t$;

-- ───────────────────────────── R-BADGE ─────────────────────────────
do $t$
declare v text; v_dm uuid;
begin
  update public.team_mentions set read_at = now() where target_user_id = pg_temp.uid('ray') and read_at is null;
  v := pg_temp.person('gem', format('select public.team_dm_open(%L)::text', pg_temp.uid('ray')));
  v_dm := ((v::jsonb)->'thread'->>'id')::uuid;
  v := pg_temp.person('ray', format('select public.team_mark_read(%L)::text', v_dm));
  v := pg_temp.person('gem', format('select public.team_post(%L, %L, %L::uuid[])::text', v_dm, 'Ray, look at this', array[pg_temp.uid('ray')]));
  perform pg_temp.chk('R-BADGE', 'a DM mention made a team chat mention row',
    (select count(*)::text from public.team_mentions where source_kind = 'team_message' and target_user_id = pg_temp.uid('ray') and read_at is null), '1');
  perform pg_temp.chk('R-BADGE', 'the chat mention is counted once: chats 1, mentions 0, total 1',
    pg_temp.person('ray', $q$select (public.team_badge()->>'chats') || '/' || (public.team_badge()->>'mentions') || '/' || (public.team_badge()->>'total')$q$),
    '1/0/1');
  v := pg_temp.person('gem', format($q$select public.ops_message_post(%L, 'Ray, sign off please', array[%L], null, null, false, %L)::text$q$,
    pg_temp.id('U1'), pg_temp.email('ray'), pg_temp.rk()));
  perform pg_temp.chk('R-BADGE', 'an Admin card mention is on Mentions: chats 1, mentions 1, total 2',
    pg_temp.person('ray', $q$select (public.team_badge()->>'chats') || '/' || (public.team_badge()->>'mentions') || '/' || (public.team_badge()->>'total')$q$),
    '1/1/2');
end;
$t$;

-- ───────────────────────────── report ─────────────────────────────
do $r$
declare r record; v_fail integer := 0; v_all integer := 0;
begin
  for r in select * from t45_results order by seq loop
    v_all := v_all + 1;
    if r.ok then raise notice 'PASS % %', r.test, r.label;
    else v_fail := v_fail + 1; raise notice 'FAIL % % (%)', r.test, r.label, coalesce(r.detail, ''); end if;
  end loop;
  if v_all < 30 then raise exception '#4255 rework recorded only % checks', v_all; end if;
  if v_fail > 0 then raise exception '#4255 rework: % of % checks failed', v_fail, v_all; end if;
  raise notice '#4255 rework: % of % checks passed', v_all, v_all;
end;
$r$;

rollback;
