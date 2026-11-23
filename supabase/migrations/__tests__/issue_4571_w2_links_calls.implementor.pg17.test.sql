-- Issue #4571 W2 (links on subtasks, two new link kinds, call outcomes) --
-- implementor suite for 20281126024571_issue_4571_w2_links_and_call_outcomes.sql
-- on the fully replayed PG17 schema. Everything is rolled back.
--
-- INVARIANT crm-call-outcome-phone-only | gate crm_activity_call_outcome_check, crm_record_log | test this file
-- INVARIANT ops-subtask-inherits-links-not-support | gate ops_validate_card | test this file
-- INVARIANT crm-activity-stage-at-written | gate ops_4571_activity_stage_at (BEFORE INSERT on crm_activity), crm_activity.stage_at NOT NULL | test this file
--
--   KINDS    call and booking links are accepted; labels never carry an @
--            or the digits of a phone number; an email touch is not a call.
--   INHERIT  a subtask under a card with two links starts with both; with
--            links: [] it has none; a support conversation is not copied.
--   REMOVE   removing a parent link leaves the subtask's; asked, it also
--            leaves the open subtasks in one step and lists them; stale is PT409.
--   CALLS    outcome, duration and PressOne link are stored in their fields,
--            not in body; an outcome on an email touch, a seventh outcome and
--            a wrong number with no number are refused; wrong_number marks
--            that phone bad; work_card links the call to the card;
--            suggest_stage is offered, never applied.
--   STAGE    every writer stores stage_at; the backfill reads the history.
--
-- FAILS-ON-REVERT: on W1 the call and booking kinds, the new columns,
-- ops_work_link_remove and the inheritance do not exist.
--
-- Run from the repository root as supabase_admin.

\set ON_ERROR_STOP on
\set w2_backfill `sed -n '/^UPDATE public.crm_activity a$/,/^ WHERE a.stage_at IS NULL;$/p' supabase/migrations/20281126024571_issue_4571_w2_links_and_call_outcomes.sql`
begin;

alter table auth.users add column if not exists email_confirmed_at timestamptz;
alter table auth.users add column if not exists banned_until timestamptz;

create temp table tx_people (who text primary key, id uuid not null, email text not null) on commit drop;
insert into tx_people (who, id, email) values
  ('seth', '45710000-0000-4000-c000-000000000001', 'seth.w24571@test.local'),
  ('tao',  '45710000-0000-4000-c000-000000000002', 'tao.w24571@test.local'),
  ('abi',  '45710000-0000-4000-c000-000000000003', 'abi.w24571@test.local');
insert into auth.users (id, email, email_confirmed_at) select id, email, now() from tx_people;
insert into public.admin_users (email, role, status, accepted_at) values
  ('seth.w24571@test.local', 'owner', 'active', now()), ('abi.w24571@test.local', 'admin', 'active', now());
insert into public.admin_team_members (email, role, status, accepted_at)
  select email, 'growth', 'active', now() from tx_people where who not in ('seth', 'abi');

create temp table tx_results (seq serial primary key, test text, label text, ok boolean, detail text) on commit drop;
create temp table tx_ids (k text primary key, id uuid not null) on commit drop;
create temp table tx_src (k text primary key, sql text not null) on commit drop;
insert into tx_src values ('backfill', :'w2_backfill');
create function pg_temp.as_(p_who text, p_sql text) returns text
language plpgsql as $fn$
declare v_id uuid; v_email text; v_out text;
begin
  select id, email into strict v_id, v_email from tx_people where who = p_who;
  begin
    set local role authenticated;
    perform set_config('request.jwt.claim.sub', v_id::text, true);
    perform set_config('request.jwt.claim.email', v_email, true);
    perform set_config('request.jwt.claims', json_build_object('sub', v_id, 'email', v_email, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.role', '', true);
    execute p_sql into v_out;
    -- #4398 (P0 retest): fire the deferred people check here, still as role authenticated, the way
    -- PostgREST commits a request (Admin and the Host app); a refusal rolls this call back.
    set constraints ops_4571_card_people_people, ops_4571_card_people_cards immediate;
    set constraints ops_4571_card_people_people, ops_4571_card_people_cards deferred;
    reset role;
    return v_out;
  exception when others then
    set constraints ops_4571_card_people_people, ops_4571_card_people_cards deferred;
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
  select id, email into strict v_id, v_email from tx_people where who = p_who;
  insert into public.team_agent_calls (key_id, owner_email, actor_uid, agent, tool, xact_id, started_at)
  values (gen_random_uuid(), v_email, v_id, 'claude', 'close_work', pg_current_xact_id(), clock_timestamp());
  return pg_temp.as_(p_who, p_sql);
end;
$fn$;
-- Runs p_sql, then fires the deferred invariant as a commit would; a
-- refusal is rolled back with the subtransaction.
create function pg_temp.commit_check(p_sql text) returns text
language plpgsql as $fn$
begin
  begin
    execute p_sql;
    set constraints ops_4571_card_people_people, ops_4571_card_people_cards immediate;
    set constraints ops_4571_card_people_people, ops_4571_card_people_cards deferred;
    raise exception 'ok_rollback' using errcode = 'P0001';
  exception when others then
    set constraints ops_4571_card_people_people, ops_4571_card_people_cards deferred;
    return case when sqlerrm = 'ok_rollback' then 'OK' else 'ERR:' || sqlstate || ':' || sqlerrm end;
  end;
end;
$fn$;
create function pg_temp.chk(p_test text, p_label text, p_got text, p_want text) returns void
language sql as $fn$
  insert into tx_results (test, label, ok, detail)
  values (p_test, p_label, p_got is not distinct from p_want,
          format('got %s, want %s', coalesce(left(p_got, 500), '<null>'), coalesce(p_want, '<null>')));
$fn$;
create function pg_temp.lk(p_test text, p_label text, p_got text, p_pattern text) returns void
language sql as $fn$
  insert into tx_results (test, label, ok, detail)
  values (p_test, p_label, coalesce(p_got like p_pattern, false),
          format('got %s, want like %s', coalesce(left(p_got, 500), '<null>'), p_pattern));
$fn$;
create function pg_temp.keep(p_k text, p_id uuid) returns uuid
language sql as $fn$ insert into tx_ids (k, id) values (p_k, p_id) on conflict (k) do update set id = excluded.id returning id $fn$;
create function pg_temp.id(p_k text) returns uuid language sql as $fn$ select id from tx_ids where k = p_k $fn$;
create function pg_temp.uid(p_who text) returns uuid language sql as $fn$ select id from tx_people where who = p_who $fn$;
create function pg_temp.email(p_who text) returns text language sql as $fn$ select email from tx_people where who = p_who $fn$;
create function pg_temp.rev(p_k text) returns bigint
language sql as $fn$ select revision from public.ops_work_cards where id = (select id from tx_ids where k = p_k) $fn$;
create function pg_temp.rk() returns text language sql as $fn$ select 'w2-' || md5(random()::text || clock_timestamp()::text) $fn$;
create function pg_temp.add(p_k text, p_title text, p_parent text default null, p_links jsonb default null) returns text
language plpgsql as $fn$
declare v text; v_item jsonb;
begin
  v_item := jsonb_build_object('title', p_title, 'instructions', 'Do the work carefully and say what changed.',
    'done_means', 'It is done and checked.', 'due_on', (now() at time zone 'UTC')::date + 3,
    'owners', jsonb_build_array(pg_temp.email('tao')), 'watchers', jsonb_build_array(pg_temp.email('seth')));
  if p_parent is not null then v_item := v_item || jsonb_build_object('parent', pg_temp.id(p_parent)); end if;
  if p_links is not null then v_item := v_item || jsonb_build_object('links', p_links); end if;
  v := pg_temp.person('seth', format('select public.ops_work_add(%L::jsonb, %L)::text', jsonb_build_array(v_item), pg_temp.rk()));
  if v not like 'ERR:%' and (v::jsonb)->'results'->0->>'status' = 'added' then
    perform pg_temp.keep(p_k, ((v::jsonb)->'results'->0->'card'->>'id')::uuid);
  end if;
  return v;
end;
$fn$;
create function pg_temp.links(p_k text) returns text
language sql as $fn$
  select coalesce((select string_agg(l.kind, ',' order by l.kind) from public.ops_work_links l where l.card_id = pg_temp.id(p_k)), '<none>')
$fn$;
create function pg_temp.log(p_who text, p_record text, p_entry jsonb) returns text
language sql as $fn$
  select pg_temp.person(p_who, format('select public.crm_record_log(%L::uuid, %L::jsonb, %L)::text', pg_temp.id(p_record), p_entry, pg_temp.rk()))
$fn$;

-- Fixtures: a host with two phones and an email, a creator, a host demo booking.
insert into public.crm_records (id, pipeline, name, stage, created_by, updated_by) values
  ('45710000-0000-4000-d000-000000000001', 'hosts', 'Island Vinyl', 'contacted', 'seth.w24571@test.local', 'seth.w24571@test.local'),
  ('45710000-0000-4000-d000-000000000002', 'hosts', 'Palm Court Kitchen', 'prospect', 'seth.w24571@test.local', 'seth.w24571@test.local'),
  ('45710000-0000-4000-d000-000000000003', 'hosts', 'Lone Phone Bar', 'contacted', 'seth.w24571@test.local', 'seth.w24571@test.local');
select pg_temp.keep('iv', '45710000-0000-4000-d000-000000000001'), pg_temp.keep('pc', '45710000-0000-4000-d000-000000000002'),
       pg_temp.keep('lp', '45710000-0000-4000-d000-000000000003');
insert into public.crm_record_identifiers (id, record_id, kind, value, value_key, created_by) values
  ('45710000-0000-4000-e000-000000000001', pg_temp.id('iv'), 'phone', '+234 803 555 0101', public.crm_ident_key('phone', '+234 803 555 0101'), 'seth.w24571@test.local'),
  ('45710000-0000-4000-e000-000000000002', pg_temp.id('iv'), 'phone', '+234 803 555 0202', public.crm_ident_key('phone', '+234 803 555 0202'), 'seth.w24571@test.local'),
  ('45710000-0000-4000-e000-000000000003', pg_temp.id('iv'), 'email', 'owner@islandvinyl.test', public.crm_ident_key('email', 'owner@islandvinyl.test'), 'seth.w24571@test.local'),
  ('45710000-0000-4000-e000-000000000004', pg_temp.id('lp'), 'phone', '+234 803 555 0303', public.crm_ident_key('phone', '+234 803 555 0303'), 'seth.w24571@test.local');
insert into public.book_call_leads (id, booking_key, audience, name, email, venue, icp, social_platform, social_url, call_at) values
  ('45710000-0000-4000-f000-000000000001', 'slot:w2-4571-demo', 'host', 'Ada Obi', 'ada@islandvinyl.test', 'Island Vinyl Bar', 'restaurants',
   'instagram', 'https://instagram.com/islandvinyl', '2026-11-24 14:30:00+00');

-- ───────────────────────────── KINDS ─────────────────────────────
do $t$
declare v text; v_call uuid; v_mail uuid; v_lbl text;
begin
  v := pg_temp.log('seth', 'iv', jsonb_build_object('kind', 'touch', 'channel', 'phone', 'direction', 'outbound',
         'outcome', 'no_answer', 'duration_seconds', 0, 'message_ref', 'https://app.pressone.co/calls/abc123',
         'occurred_at', '2026-11-20T10:00:00Z'));
  if v like 'ERR:%' then raise exception 'first call log refused: %', v; end if;
  v_call := pg_temp.keep('call1', ((v::jsonb)->'activity'->>'id')::uuid);
  v := pg_temp.log('seth', 'iv', jsonb_build_object('kind', 'touch', 'channel', 'email', 'direction', 'outbound', 'body', 'Hello from Mingla.'));
  v_mail := pg_temp.keep('mail1', ((v::jsonb)->'activity'->>'id')::uuid);
  v_lbl := public.ops_link_label('call', v_call);
  perform pg_temp.chk('KINDS', 'a call is labelled by record, outcome and day', v_lbl, 'Call · Island Vinyl · No answer · 20 Nov');
  perform pg_temp.chk('KINDS', 'a call label holds no @ and no phone digits',
    (v_lbl ~ '@' or v_lbl ~ '555' or v_lbl ~ '0101')::text, 'false');
  perform pg_temp.chk('KINDS', 'an email touch is not a call', public.ops_link_label('call', v_mail), null);
  v_lbl := public.ops_link_label('booking', '45710000-0000-4000-f000-000000000001');
  perform pg_temp.chk('KINDS', 'a host booking is labelled by venue and time', v_lbl, 'Demo · Island Vinyl Bar · 24 Nov 14:30');
  perform pg_temp.chk('KINDS', 'a booking label holds no email', (v_lbl ~ '@')::text, 'false');
  v := public.ops_links_check(jsonb_build_array(jsonb_build_object('kind', 'call', 'id', v_call),
         jsonb_build_object('kind', 'booking', 'id', '45710000-0000-4000-f000-000000000001')))::text;
  perform pg_temp.chk('KINDS', 'ops_links_check accepts call and booking',
    jsonb_array_length((v::jsonb)->'links')::text || '/' || jsonb_array_length((v::jsonb)->'fixes')::text, '2/0');
  v := public.ops_links_check(jsonb_build_array(jsonb_build_object('kind', 'call', 'id', v_mail)))::text;
  perform pg_temp.lk('KINDS', 'an email touch as a call link is refused', (v::jsonb)->'fixes'->0->>'message', 'Linked call % does not exist or was removed.%');
  v := public.ops_links_check(jsonb_build_array(jsonb_build_object('kind', 'phone', 'id', v_mail)))::text;
  perform pg_temp.chk('KINDS', 'the kind message names call and booking', (v::jsonb)->'fixes'->0->>'message',
    'Link kind must be host, creator, brand, event, content, expected, card, call, booking or support_conversation.');
  v := pg_temp.person('tao', 'select public.ops_link_search(''call'', ''Island'')::text');
  perform pg_temp.chk('KINDS', 'search finds the record''s calls only', (select string_agg(r->>'label', '|') from jsonb_array_elements((v::jsonb)->'results') r),
    'Call · Island Vinyl · No answer · 20 Nov');
  v := pg_temp.person('tao', 'select public.ops_link_search(''booking'', ''vinyl'')::text');
  perform pg_temp.chk('KINDS', 'search finds host bookings by venue, without the email',
    (select string_agg(r->>'label', '|') || '/' || (r::text ~ '@')::text from jsonb_array_elements((v::jsonb)->'results') r group by r),
    'Demo · Island Vinyl Bar · 24 Nov 14:30/false');
end;
$t$;

-- ───────────────────────────── INHERIT ─────────────────────────────
do $t$
declare v text;
begin
  v := pg_temp.add('parent', 'W2 parent card for links', null,
    jsonb_build_array(jsonb_build_object('kind', 'host', 'id', pg_temp.id('iv')),
                      jsonb_build_object('kind', 'booking', 'id', '45710000-0000-4000-f000-000000000001')));
  perform pg_temp.chk('INHERIT', 'the parent has two links', pg_temp.links('parent'), 'booking,host');
  -- A support conversation link is set by Support staff; planted here as the database owner.
  insert into public.conversations (id, type, linked_entity_type, name, created_by, created_at, updated_at, last_message_at)
  values ('45710000-0000-4000-f000-000000000009', 'group', 'support', 'W2 4571 help', pg_temp.uid('tao'), now(), now(), now());
  insert into public.support_tickets (id, requester_user_id, requester_segment, subject, conversation_id)
  values ('45710000-0000-4000-f000-00000000000a', pg_temp.uid('tao'), 'business', 'W2 4571 the list will not export', '45710000-0000-4000-f000-000000000009');
  insert into public.ops_work_links (card_id, kind, target_id, label, added_by)
  select pg_temp.id('parent'), 'support_conversation', t.id, 'Conversation ' || t.ticket_number, 'seth.w24571@test.local'
    from public.support_tickets t where t.id = '45710000-0000-4000-f000-00000000000a';
  perform pg_temp.chk('INHERIT', 'the parent also links a support conversation', pg_temp.links('parent'), 'booking,host,support_conversation');
  v := pg_temp.add('sub1', 'W2 subtask that inherits', 'parent');
  perform pg_temp.chk('INHERIT', 'a subtask sent no links starts with the parent''s, not the support conversation', pg_temp.links('sub1'), 'booking,host');
  perform pg_temp.chk('INHERIT', 'the inherited links keep their labels',
    (select string_agg(l.label, '|' order by l.kind) from public.ops_work_links l where l.card_id = pg_temp.id('sub1')),
    'Demo · Island Vinyl Bar · 24 Nov 14:30|Island Vinyl');
  v := pg_temp.add('sub2', 'W2 subtask with no links', 'parent', '[]'::jsonb);
  perform pg_temp.chk('INHERIT', 'links: [] means none', pg_temp.links('sub2'), '<none>');
  v := pg_temp.add('top', 'W2 top level card with no links');
  perform pg_temp.chk('INHERIT', 'a top-level card inherits nothing', pg_temp.links('top'), '<none>');
  v := pg_temp.person('seth', format('select public.ops_work_get(%L::uuid, null)::text', pg_temp.id('parent')));
  perform pg_temp.chk('INHERIT', 'the parent''s subtask rows carry their links',
    (select string_agg(jsonb_array_length(s->'links')::text, ',' order by s->>'number') from jsonb_array_elements((v::jsonb)->'subtasks') s), '2,0');
  v := public.ops_cards_json(ARRAY[pg_temp.id('sub1')], (now() at time zone 'UTC')::date, 'board')::text;
  perform pg_temp.chk('INHERIT', 'the board shape carries each link''s label',
    (select string_agg(l->>'label', '|' order by l->>'kind') from jsonb_array_elements((v::jsonb)->0->'links') l),
    'Demo · Island Vinyl Bar · 24 Nov 14:30|Island Vinyl');
end;
$t$;

-- ───────────────────────────── REMOVE ─────────────────────────────
do $t$
declare v text;
begin
  v := pg_temp.person('seth', format('select public.ops_work_link_remove(%L::uuid, %L, %L::uuid, false, %s)::text',
         pg_temp.id('parent'), 'host', pg_temp.id('iv'), pg_temp.rev('parent')));
  perform pg_temp.chk('REMOVE', 'no cascade: the subtask keeps the link', pg_temp.links('parent') || ' / ' || pg_temp.links('sub1'),
    'booking,support_conversation / booking,host');
  perform pg_temp.chk('REMOVE', 'no subtask is listed', (v::jsonb)->>'subtasks_changed', '[]');
  v := pg_temp.person('seth', format('select public.ops_work_link_remove(%L::uuid, %L, %L::uuid, true, %s)::text',
         pg_temp.id('parent'), 'booking', '45710000-0000-4000-f000-000000000001', pg_temp.rev('parent') - 1));
  perform pg_temp.lk('REMOVE', 'a stale revision is PT409', v, 'ERR:PT409:%');
  v := pg_temp.person('seth', format('select public.ops_work_link_remove(%L::uuid, %L, %L::uuid, true, %s)::text',
         pg_temp.id('parent'), 'booking', '45710000-0000-4000-f000-000000000001', pg_temp.rev('parent')));
  perform pg_temp.chk('REMOVE', 'asked, the link leaves the parent and its subtask in one step', pg_temp.links('parent') || ' / ' || pg_temp.links('sub1'),
    'support_conversation / host');
  perform pg_temp.chk('REMOVE', 'the changed subtask is listed', (v::jsonb)->'subtasks_changed'->>0,
    (select number::text from public.ops_work_cards where id = pg_temp.id('sub1')));
  perform pg_temp.chk('REMOVE', 'one links event on each changed card',
    (select count(*)::text from public.ops_work_events e where e.card_id in (pg_temp.id('parent'), pg_temp.id('sub1')) and e.action = 'links' and e.body like 'Removed %'), '3');
  v := pg_temp.person('tao', format('select public.ops_work_link_remove(%L::uuid, %L, %L::uuid, false, %s)::text',
         pg_temp.id('parent'), 'support_conversation', (select target_id from public.ops_work_links where card_id = pg_temp.id('parent') and kind = 'support_conversation'), pg_temp.rev('parent')));
  perform pg_temp.lk('REMOVE', 'only Support staff remove a support conversation', v, 'ERR:42501:support_required:%');
  perform pg_temp.chk('REMOVE', 'clients may call the remover, not the internal adder',
    has_function_privilege('authenticated', 'public.ops_work_link_remove(uuid,text,uuid,boolean,bigint)', 'execute')::text || '/'
      || has_function_privilege('anon', 'public.ops_work_link_remove(uuid,text,uuid,boolean,bigint)', 'execute')::text || '/'
      || has_function_privilege('authenticated', 'public.ops_work_link_add(uuid,text,uuid,text,text)', 'execute')::text || '/'
      || has_function_privilege('authenticated', 'public.ops_4571_call_outcome_label(text)', 'execute')::text, 'true/false/false/false');
end;
$t$;

-- ───────────────────────────── CALLS ─────────────────────────────
do $t$
declare v text; a public.crm_activity;
begin
  select * into a from public.crm_activity where id = pg_temp.id('call1');
  perform pg_temp.chk('CALLS', 'outcome, duration and PressOne link land in their fields, not body',
    concat_ws('|', a.call_outcome, a.duration_seconds, a.message_ref, coalesce(a.body, '<no body>')), 'no_answer|0|https://app.pressone.co/calls/abc123|<no body>');
  v := pg_temp.log('seth', 'iv', jsonb_build_object('kind', 'touch', 'channel', 'phone', 'direction', 'outbound', 'outcome', 'call_back', 'duration_seconds', 95));
  perform pg_temp.chk('CALLS', 'the timeline entry carries the outcome and length',
    ((v::jsonb)->'activity'->>'outcome') || '/' || ((v::jsonb)->'activity'->>'duration_seconds'), 'call_back/95');
  v := pg_temp.log('seth', 'iv', jsonb_build_object('kind', 'touch', 'channel', 'email', 'direction', 'outbound', 'body', 'Hi', 'outcome', 'no_answer'));
  perform pg_temp.lk('CALLS', 'an outcome on an email touch is refused with a clear message', v, 'ERR:22023:outcome_not_a_call: Only a call you made%');
  v := pg_temp.log('seth', 'iv', jsonb_build_object('kind', 'touch', 'channel', 'phone', 'direction', 'inbound', 'outcome', 'no_answer'));
  perform pg_temp.lk('CALLS', 'an outcome on an inbound call is refused', v, 'ERR:22023:outcome_not_a_call:%');
  v := pg_temp.log('seth', 'iv', jsonb_build_object('kind', 'touch', 'channel', 'phone', 'direction', 'outbound', 'outcome', 'busy'));
  perform pg_temp.lk('CALLS', 'a seventh outcome is refused', v, 'ERR:22023:invalid_outcome:%');
  v := pg_temp.log('seth', 'iv', jsonb_build_object('kind', 'touch', 'channel', 'phone', 'direction', 'outbound', 'duration_seconds', 14401));
  perform pg_temp.lk('CALLS', 'more than four hours is refused', v, 'ERR:22023:invalid_duration:%');
  v := pg_temp.log('seth', 'iv', jsonb_build_object('kind', 'note', 'body', 'A note.', 'duration_seconds', 10));
  perform pg_temp.lk('CALLS', 'a note has no length', v, 'ERR:22023:duration_not_a_call:%');
  v := pg_temp.commit_check(format($q$insert into public.crm_activity (record_id, kind, actor_email, channel, direction, body, call_outcome)
         values (%L, 'touch', 'seth.w24571@test.local', 'email', 'outbound', 'x', 'no_answer')$q$, pg_temp.id('iv')));
  perform pg_temp.lk('CALLS', 'the table refuses an outcome on an email touch from any writer', v, 'ERR:23514:%crm_activity_call_outcome_check%');
  v := pg_temp.log('seth', 'iv', jsonb_build_object('kind', 'touch', 'channel', 'phone', 'direction', 'outbound', 'outcome', 'wrong_number'));
  perform pg_temp.lk('CALLS', 'wrong_number needs the number', v, 'ERR:22023:identifier_required:%');
  v := pg_temp.log('seth', 'iv', jsonb_build_object('kind', 'touch', 'channel', 'phone', 'direction', 'outbound', 'outcome', 'wrong_number',
         'identifier_id', pg_temp.id('pc')));
  perform pg_temp.lk('CALLS', 'a number from another record is refused', v, 'ERR:22023:invalid_identifier:%');
  v := pg_temp.log('seth', 'iv', jsonb_build_object('kind', 'touch', 'channel', 'phone', 'direction', 'outbound', 'outcome', 'wrong_number',
         'identifier_id', '45710000-0000-4000-e000-000000000001'));
  perform pg_temp.chk('CALLS', 'wrong_number marks that phone bad, the other stays ok',
    (select string_agg(i.status || ':' || coalesce(i.bad_reason, '-') || ':' || (i.bad_by is not null)::text, ',' order by i.value)
       from public.crm_record_identifiers i where i.record_id = pg_temp.id('iv') and i.kind = 'phone'), 'bad:wrong_number:true,ok:-:false');
  perform pg_temp.chk('CALLS', 'another usable phone: no suggestion', (v::jsonb)->>'suggest_stage', null);
  perform pg_temp.chk('CALLS', 'the record answer shows the bad number',
    (select string_agg(i->>'status', ',' order by i->>'value') from jsonb_array_elements((v::jsonb)->'record'->'identifiers') i where i->>'kind' = 'phone'), 'bad,ok');
  v := pg_temp.log('seth', 'lp', jsonb_build_object('kind', 'touch', 'channel', 'phone', 'direction', 'outbound', 'outcome', 'wrong_number',
         'identifier', '0803 555 0303'));
  perform pg_temp.chk('CALLS', 'the number as written finds it; no other phone suggests finding one',
    ((v::jsonb)->'suggest_stage'->>'note') || '/' || (select status from public.crm_record_identifiers where id = '45710000-0000-4000-e000-000000000004'),
    'Find a new number./bad');
  v := pg_temp.log('seth', 'iv', jsonb_build_object('kind', 'touch', 'channel', 'phone', 'direction', 'outbound', 'outcome', 'not_interested'));
  perform pg_temp.chk('CALLS', 'not interested suggests Lost and does not move the card',
    ((v::jsonb)->'suggest_stage'->>'stage') || '/' || (select stage from public.crm_records where id = pg_temp.id('iv')), 'lost/contacted');
  v := pg_temp.log('seth', 'iv', jsonb_build_object('kind', 'touch', 'channel', 'phone', 'direction', 'outbound', 'outcome', 'demo_booked'));
  perform pg_temp.lk('CALLS', 'demo booked suggests the scheduler link and no stage',
    coalesce((v::jsonb)->'suggest_stage'->>'stage', 'none') || '/' || ((v::jsonb)->'suggest_stage'->>'note'), 'none/Send the card''s scheduler link%');
  -- A call logged with its Work card.
  v := pg_temp.log('seth', 'iv', jsonb_build_object('kind', 'touch', 'channel', 'phone', 'direction', 'outbound', 'outcome', 'no_answer',
         'occurred_at', '2026-11-20T11:00:00Z', 'work_card', (select number from public.ops_work_cards where id = pg_temp.id('top'))));
  perform pg_temp.chk('CALLS', 'work_card links the call to the card',
    (select string_agg(l.kind || '=' || l.label, '|') from public.ops_work_links l where l.card_id = pg_temp.id('top')),
    'call=Call · Island Vinyl · No answer · 20 Nov');
  perform pg_temp.chk('CALLS', 'the answer names the card and the card logged it',
    ((v::jsonb)->'work_card'->>'number') || '/' || (select count(*)::text from public.ops_work_events e where e.card_id = pg_temp.id('top') and e.action = 'links' and e.body like 'Linked Call%'),
    (select number::text from public.ops_work_cards where id = pg_temp.id('top')) || '/1');
  v := pg_temp.log('seth', 'iv', jsonb_build_object('kind', 'touch', 'channel', 'email', 'direction', 'outbound', 'body', 'x', 'work_card', pg_temp.id('top')));
  perform pg_temp.lk('CALLS', 'an email is not linked as a call', v, 'ERR:22023:work_card_not_a_call:%');
  v := pg_temp.log('seth', 'iv', jsonb_build_object('kind', 'touch', 'channel', 'phone', 'direction', 'outbound', 'work_card', 99999999));
  perform pg_temp.lk('CALLS', 'an unknown card is refused', v, 'ERR:22023:invalid_work_card:%');
end;
$t$;

-- ───────────────────────────── STAGE ─────────────────────────────
do $t$
declare v text;
begin
  perform pg_temp.chk('STAGE', 'crm_record_log stores the stage the record was in',
    (select stage_at from public.crm_activity where id = pg_temp.id('call1')), 'contacted');
  v := pg_temp.person('seth', format('select public.crm_record_move_stage(%L::uuid, %L, null, %L)::text', pg_temp.id('pc'), 'contacted', 'prospect'));
  perform pg_temp.chk('STAGE', 'a stage move is written in the stage it left',
    (select string_agg(stage_at, ',') from public.crm_activity where record_id = pg_temp.id('pc') and kind = 'stage_move'), 'prospect');
  insert into public.crm_activity (record_id, kind, actor_email, body) values (pg_temp.id('pc'), 'note', 'seth.w24571@test.local', 'Raw writer.');
  perform pg_temp.chk('STAGE', 'any other writer gets the record''s stage now',
    (select stage_at from public.crm_activity where record_id = pg_temp.id('pc') and body = 'Raw writer.'), 'contacted');
  perform pg_temp.chk('STAGE', 'no entry is without a stage', (select count(*)::text from public.crm_activity where stage_at is null), '0');
  -- The backfill, run on a fixture history: a touch before any move is in the
  -- first stage, after a move in the stage moved to.
  alter table public.crm_activity alter column stage_at drop not null;
  alter table public.crm_activity disable trigger ops_4571_activity_stage_at;
  insert into public.crm_activity (record_id, kind, actor_email, channel, direction, body, occurred_at) values
    (pg_temp.id('lp'), 'touch', 'seth.w24571@test.local', 'email', 'outbound', 'bf-1', '2026-01-01T10:00:00Z');
  insert into public.crm_activity (record_id, kind, actor_email, from_stage, to_stage, occurred_at) values
    (pg_temp.id('lp'), 'stage_move', 'seth.w24571@test.local', 'prospect', 'contacted', '2026-01-02T10:00:00Z'),
    (pg_temp.id('lp'), 'stage_move', 'seth.w24571@test.local', 'contacted', 'replied', '2026-01-05T10:00:00Z');
  insert into public.crm_activity (record_id, kind, actor_email, channel, direction, body, occurred_at) values
    (pg_temp.id('lp'), 'touch', 'seth.w24571@test.local', 'phone', 'outbound', 'bf-2', '2026-01-03T10:00:00Z'),
    (pg_temp.id('lp'), 'touch', 'seth.w24571@test.local', 'email', 'inbound', 'bf-3', '2026-01-06T10:00:00Z');
  update public.crm_activity set stage_at = null where record_id = pg_temp.id('lp') and occurred_at < '2026-02-01';
  execute (select sql from tx_src where k = 'backfill');
  alter table public.crm_activity enable trigger ops_4571_activity_stage_at;
  alter table public.crm_activity alter column stage_at set not null;
  perform pg_temp.chk('STAGE', 'the backfill reads the stage_move history',
    (select string_agg(coalesce(body, from_stage || '>' || to_stage) || '=' || stage_at, ',' order by occurred_at)
       from public.crm_activity where record_id = pg_temp.id('lp') and occurred_at < '2026-02-01'),
    'bf-1=prospect,prospect>contacted=prospect,bf-2=contacted,contacted>replied=contacted,bf-3=replied');
end;
$t$;

-- ───────────────────────────── report ─────────────────────────────
do $r$
declare r record; v_fail integer := 0; v_all integer := 0;
begin
  for r in select * from tx_results order by seq loop
    v_all := v_all + 1;
    if r.ok then raise notice 'PASS % %', r.test, r.label;
    else v_fail := v_fail + 1; raise notice 'FAIL % % (%)', r.test, r.label, coalesce(r.detail, ''); end if;
  end loop;
  if v_all < 45 then raise exception '#4571 W2 implementor recorded only % checks', v_all; end if;
  if v_fail > 0 then raise exception '#4571 W2 implementor: % of % checks failed', v_fail, v_all; end if;
  raise notice '#4571 W2 implementor: % of % checks passed', v_all, v_all;
end;
$r$;

rollback;
