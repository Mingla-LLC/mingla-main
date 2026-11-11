-- Issue #4255 -- work card emails (20280524004255_issue_4255_work_card_email.sql),
-- on the fully replayed PG17 schema.
-- MINGLA-INVARIANT: I-4255-CARD-EMAIL-SUBJECT | issue #4255 | Every admin.team_mention email queued for a work card has a subject (payload.title) that names the card title and a payload card_id, so each card is its own email and conversation.
-- MINGLA-INVARIANT: I-4255-AUTO-CARD-NO-EMAIL | issue #4255 | A "Feature Guide is Live" card never queues a work card email, and an automatic card closed in the run that made it leaves no pending email; both still leave the in-app bell item.
-- MINGLA-INVARIANT: I-4255-CARD-EMAIL-DEFAULT-ON | issue #4255 | Work card email (admin.team_mention, email) is on for a current teammate with no saved preference; only an explicit enabled = false turns it off.
-- [TEST-MOD-APPROVED #4255] supersedes I-3720-MENTION-EMAIL-OPT-IN (Seth, 9 Nov 2026: on by default).
--
--   C-SUBJECT  a person's note tells the tagged teammate "<who> tagged you:
--              <card>"; an owner add says "<who> added you as owner: <card>";
--              the payload carries card_id and card_title; the actor is never
--              told
--   C-AUTO     an automatic card added and closed in one run queues no email
--              for its owner or watcher but leaves both bell items; the same
--              card kind closed in a later run still emails its "closed"
--              notice and keeps the earlier "added" emails; a guide_live card
--              left open queues no email
--   C-OPEN     an automatic card that stays open emails its owner
--   C-DEFAULT  no preference row: can_send is true, the preference reads
--              say on (both RPCs), the alert list says default on; an explicit
--              off makes can_send false and the reason preference_off; an
--              explicit on is on
--
-- FAILS-ON-REVERT: replay without 20280524004255 -> C-SUBJECT (title is
-- "<who> on a work card", no card_id), C-AUTO (owner/watcher get emails) and
-- C-DEFAULT (can_send false with no row) fail.
--
-- Run from the repository root as supabase_admin. Everything is rolled back.

\set ON_ERROR_STOP on
begin;

alter table auth.users add column if not exists email_confirmed_at timestamptz;

create temp table t4255_people (who text primary key, id uuid not null, email text not null) on commit drop;
insert into t4255_people (who, id, email) values
  ('owner',  '42550000-0000-4000-a0ce-000000000001', 'oz.c4255@test.local'),
  ('growth', '42550000-0000-4000-a0ce-000000000002', 'gem.c4255@test.local'),
  ('admin',  '42550000-0000-4000-a0ce-000000000003', 'ade.c4255@test.local');
insert into auth.users (id, email, email_confirmed_at) select id, email, now() from t4255_people;
insert into public.admin_users (email, role, status, accepted_at) values
  ('oz.c4255@test.local', 'owner', 'active', now()),
  ('ade.c4255@test.local', 'admin', 'active', now());
insert into public.admin_team_members (email, role, status, accepted_at) values
  ('gem.c4255@test.local', 'growth', 'active', now());

create temp table t4255_results (seq serial primary key, test text, label text, ok boolean, detail text) on commit drop;
create function pg_temp.chk(p_test text, p_label text, p_ok boolean, p_detail text default null) returns void
language sql as $fn$ insert into t4255_results (test, label, ok, detail) values (p_test, p_label, coalesce(p_ok, false), p_detail); $fn$;
create function pg_temp.uid(p_who text) returns uuid
language sql as $fn$ select id from t4255_people where who = p_who; $fn$;
create function pg_temp.email(p_who text) returns text
language sql as $fn$ select email from t4255_people where who = p_who; $fn$;
-- email rows / bell rows for one card and one person
-- [TEST-MOD-APPROVED #4255] rework (20280614054255): card links end with
-- &side=thread:<card> (the card opens with its thread).
create function pg_temp.mails(p_card uuid, p_who text) returns bigint
language sql as $fn$
  select count(*) from public.notification_outbox o
   where o.category_key = 'admin.team_mention' and o.user_id = pg_temp.uid(p_who)
     and o.payload->>'deep_link' like '%card=' || p_card::text || '&side=thread:' || p_card::text;
$fn$;
create function pg_temp.bells(p_card uuid, p_who text) returns bigint
language sql as $fn$
  select count(*) from public.team_mentions m
   where m.source_kind = 'work_card' and m.target_user_id = pg_temp.uid(p_who)
     and m.deep_link like '%card=' || p_card::text || '&side=thread:' || p_card::text;
$fn$;
create function pg_temp.item(p_title text) returns jsonb
language sql as $fn$
  select jsonb_build_object(
    'title', p_title,
    'instructions', 'Check the release and tell the team in plain words.',
    'done_means', 'The team knows.',
    'owners', jsonb_build_array('ade.c4255@test.local'),
    'watchers', jsonb_build_array('gem.c4255@test.local'),
    'due_on', public.ops_today(NULL));
$fn$;

-- ───────────────────────────── C-AUTO / C-OPEN ─────────────────────────────
do $t$
declare v jsonb; v_card uuid; v_guide uuid; v_open uuid; v_later uuid; v_n bigint;
begin
  -- added and closed in one run (a bridge sweep)
  v := public.ops_auto_card_upsert('eng_check:c4255-same-run', pg_temp.item('C4255 Same run card'), 'task', NULL);
  v_card := (v->>'id')::uuid;
  perform pg_temp.chk('C-AUTO', 'same-run card added', v->>'status' = 'added', v::text);
  perform pg_temp.chk('C-AUTO', 'before close the owner email is queued', pg_temp.mails(v_card, 'admin') = 1, pg_temp.mails(v_card, 'admin')::text);
  perform pg_temp.chk('C-AUTO', 'before close the owner push is queued too',
    exists (select 1 from public.notification_outbox where category_key = 'business.team_mention' and user_id = pg_temp.uid('admin') and payload->>'card_id' = v_card::text), NULL);
  perform public.ops_auto_card_close(v_card, 'Checked.', '[{"text":"Checked by Mingla."}]'::jsonb);
  perform pg_temp.chk('C-AUTO', 'same-run close: owner has no email', pg_temp.mails(v_card, 'admin') = 0, pg_temp.mails(v_card, 'admin')::text);
  perform pg_temp.chk('C-AUTO', 'same-run close: watcher has no email', pg_temp.mails(v_card, 'growth') = 0, pg_temp.mails(v_card, 'growth')::text);
  -- [TEST-MOD-APPROVED #4255] W1b: the push queued beside the email goes with it.
  perform pg_temp.chk('C-AUTO', 'same-run close: no Host app push either',
    not exists (select 1 from public.notification_outbox where category_key = 'business.team_mention' and payload->>'card_id' = v_card::text), NULL);
  perform pg_temp.chk('C-AUTO', 'same-run close: owner keeps bell items', pg_temp.bells(v_card, 'admin') >= 1, pg_temp.bells(v_card, 'admin')::text);
  perform pg_temp.chk('C-AUTO', 'same-run close: watcher keeps bell items', pg_temp.bells(v_card, 'growth') >= 1, pg_temp.bells(v_card, 'growth')::text);

  -- a guide_live card that somehow stays open still sends no email
  v := public.ops_auto_card_upsert('guide_live:c4255-entry:pr-1', pg_temp.item('Feature Guide: C4255 entry is Live'), 'task', NULL);
  v_guide := (v->>'id')::uuid;
  perform pg_temp.chk('C-AUTO', 'guide_live card added', v->>'status' = 'added', v::text);
  perform pg_temp.chk('C-AUTO', 'guide_live: watcher has no email', pg_temp.mails(v_guide, 'growth') = 0, pg_temp.mails(v_guide, 'growth')::text);
  perform pg_temp.chk('C-AUTO', 'guide_live: watcher has a bell item', pg_temp.bells(v_guide, 'growth') = 1, pg_temp.bells(v_guide, 'growth')::text);

  -- an automatic card that stays open is a real assignment: it emails
  v := public.ops_auto_card_upsert('eng_check:c4255-open', pg_temp.item('C4255 Open card'), 'task', NULL);
  v_open := (v->>'id')::uuid;
  perform pg_temp.chk('C-OPEN', 'open auto card emails its owner', pg_temp.mails(v_open, 'admin') = 1, pg_temp.mails(v_open, 'admin')::text);
  perform pg_temp.chk('C-OPEN', 'subject names the card',
    (select payload->>'title' from public.notification_outbox where category_key = 'admin.team_mention' and user_id = pg_temp.uid('admin') and payload->>'card_id' = v_open::text) = 'Mingla added: C4255 Open card',
    (select payload::text from public.notification_outbox where category_key = 'admin.team_mention' and user_id = pg_temp.uid('admin') and payload->>'card_id' = v_open::text));
  -- [TEST-MOD-APPROVED #4255] W1b: each email is joined by one Host app push
  -- (business.team_mention); the email's subject check above now names its
  -- category, since the card has two outbox rows per person.
  perform pg_temp.chk('C-OPEN', 'open auto card also pushes its owner once',
    (select count(*) from public.notification_outbox where category_key = 'business.team_mention' and user_id = pg_temp.uid('admin') and payload->>'card_id' = v_open::text) = 1,
    (select string_agg(category_key, ',') from public.notification_outbox where user_id = pg_temp.uid('admin') and payload->>'card_id' = v_open::text));

  -- made in an earlier run, closed now: the close notice emails and the
  -- earlier "added" emails stay
  v := public.ops_auto_card_upsert('eng_check:c4255-later', pg_temp.item('C4255 Later card'), 'task', NULL);
  v_later := (v->>'id')::uuid;
  update public.ops_work_cards set created_at = now() - interval '1 hour' where id = v_later;
  update public.notification_outbox set created_at = now() - interval '1 hour' where payload->>'card_id' = v_later::text;
  perform public.ops_auto_card_close(v_later, 'Checked.', '[{"text":"Checked by Mingla."}]'::jsonb);
  perform pg_temp.chk('C-AUTO', 'later close: owner has added + closed emails', pg_temp.mails(v_later, 'admin') = 2, pg_temp.mails(v_later, 'admin')::text);
  perform pg_temp.chk('C-AUTO', 'later close: subject names the card',
    exists (select 1 from public.notification_outbox where payload->>'card_id' = v_later::text
             and payload->>'title' like 'Mingla closed: C4255 Later card%'),
    (select string_agg(payload->>'title', ' | ') from public.notification_outbox where payload->>'card_id' = v_later::text));

  -- ─────────────────────────── C-SUBJECT ───────────────────────────
  -- a person's note on a person's card (auto_key cleared to make it one)
  update public.ops_work_cards set auto_key = NULL where id = v_open;
  v_n := public.ops_notify_people(v_open,
    public.ops_card_event(v_open, 'oz.c4255@test.local', NULL, 'note', 'Can you check this today?', NULL, NULL, NULL, NULL),
    array['gem.c4255@test.local', 'oz.c4255@test.local'], 'oz.c4255@test.local',
    format('%s on %s: %s', public.ops_actor_label('oz.c4255@test.local', NULL), 'C4255 Open card', 'Can you check this today?'));
  perform pg_temp.chk('C-SUBJECT', 'note tells one teammate (never the actor)', v_n = 1, v_n::text);
  perform pg_temp.chk('C-SUBJECT', 'note subject is "<who> tagged you: <card>"',
    -- The note's own row (same-transaction rows share created_at, so match it
    -- by its body rather than by order).
    (select payload->>'title' from public.notification_outbox where user_id = pg_temp.uid('growth') and payload->>'card_id' = v_open::text
      and payload->>'body' like '%Can you check this today?%')
      = public.ops_actor_label('oz.c4255@test.local', NULL) || ' tagged you: C4255 Open card',
    (select string_agg(payload->>'title', ' | ') from public.notification_outbox where user_id = pg_temp.uid('growth') and payload->>'card_id' = v_open::text));
  perform pg_temp.chk('C-SUBJECT', 'note body keeps the note',
    exists (select 1 from public.notification_outbox where user_id = pg_temp.uid('growth') and payload->>'card_id' = v_open::text
             and payload->>'body' like '%Can you check this today?%'), NULL);
  perform pg_temp.chk('C-SUBJECT', 'payload carries card_title',
    exists (select 1 from public.notification_outbox where payload->>'card_id' = v_open::text and payload->>'card_title' = 'C4255 Open card'), NULL);
  perform pg_temp.chk('C-SUBJECT', 'the actor got nothing', pg_temp.mails(v_open, 'owner') = 0, pg_temp.mails(v_open, 'owner')::text);

  v_n := public.ops_notify_people(v_open,
    public.ops_card_event(v_open, 'oz.c4255@test.local', NULL, 'people', NULL, NULL, NULL, NULL, NULL),
    array['gem.c4255@test.local'], 'oz.c4255@test.local',
    format('%s added you as owner: %s', public.ops_name('oz.c4255@test.local'), 'C4255 Open card'));
  perform pg_temp.chk('C-SUBJECT', 'owner add subject names the card',
    exists (select 1 from public.notification_outbox where user_id = pg_temp.uid('growth') and payload->>'card_id' = v_open::text
             and payload->>'title' = public.ops_name('oz.c4255@test.local') || ' added you as owner: C4255 Open card'),
    (select string_agg(payload->>'title', ' | ') from public.notification_outbox where user_id = pg_temp.uid('growth')));
  perform pg_temp.chk('C-SUBJECT', 'no work card email keeps the old generic subject',
    not exists (select 1 from public.notification_outbox where category_key = 'admin.team_mention'
                 and user_id in (select id from t4255_people) and payload->>'title' like '% on a work card'),
    (select string_agg(payload->>'title', ' | ') from public.notification_outbox where user_id in (select id from t4255_people)));
end;
$t$;

-- ───────────────────────────── C-DEFAULT ─────────────────────────────
do $t$
declare v jsonb; v2 jsonb;
begin
  perform pg_temp.chk('C-DEFAULT', 'no row: can_send is true',
    public.can_send(pg_temp.uid('growth'), 'admin.team_mention', 'email', pg_temp.email('growth')), NULL);
  perform pg_temp.chk('C-DEFAULT', 'alert list: mention default on',
    (select default_on from public.issue_3988_email_alert_categories() where category_key = 'admin.team_mention'), NULL);

  perform set_config('request.jwt.claim.sub', pg_temp.uid('growth')::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', pg_temp.uid('growth'), 'role', 'authenticated')::text, true);
  set local role authenticated;
  v := public.issue_3720_team_notification_preferences();
  v2 := public.issue_3988_my_email_alert_preferences();
  reset role;
  perform pg_temp.chk('C-DEFAULT', 'no row: team preferences read on', v->>'mention_email' = 'true', v::text);
  perform pg_temp.chk('C-DEFAULT', 'no row: alert preferences read on',
    (select (r->>'email_enabled')::boolean from jsonb_array_elements(v2) r where r->>'category_key' = 'admin.team_mention'), v2::text);

  set local role authenticated;
  perform public.issue_3720_set_team_mention_email(false);
  reset role;
  perform pg_temp.chk('C-DEFAULT', 'explicit off: can_send false',
    not public.can_send(pg_temp.uid('growth'), 'admin.team_mention', 'email', pg_temp.email('growth')), NULL);
  perform pg_temp.chk('C-DEFAULT', 'explicit off: reason preference_off',
    public.issue_3720_notification_denial_reason(pg_temp.uid('growth'), 'admin.team_mention', 'email', pg_temp.email('growth')) = 'preference_off', NULL);

  set local role authenticated;
  v := public.issue_3720_team_notification_preferences();
  perform public.issue_3720_set_team_mention_email(true);
  reset role;
  perform pg_temp.chk('C-DEFAULT', 'explicit off reads off', v->>'mention_email' = 'false', v::text);
  perform pg_temp.chk('C-DEFAULT', 'explicit on: can_send true',
    public.can_send(pg_temp.uid('growth'), 'admin.team_mention', 'email', pg_temp.email('growth')), NULL);
end;
$t$;

-- ───────────────────────────── report ─────────────────────────────
do $r$
declare r record; v_fail integer := 0; v_all integer := 0;
begin
  for r in select * from t4255_results order by seq loop
    v_all := v_all + 1;
    if r.ok then raise notice 'PASS % %', r.test, r.label;
    else v_fail := v_fail + 1; raise notice 'FAIL % % (%)', r.test, r.label, coalesce(r.detail, ''); end if;
  end loop;
  if v_all < 20 then raise exception '#4255 recorded only % checks', v_all; end if;
  if v_fail > 0 then raise exception '#4255 work card email: % of % checks failed', v_fail, v_all; end if;
  raise notice '#4255 work card email: % of % checks passed', v_all, v_all;
end;
$r$;

rollback;
