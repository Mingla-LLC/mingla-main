-- Issue #4571 W6a (Archived and Merge for duplicate cards) -- implementor suite
-- for 20281130064571_issue_4571_w6a_archive_merge.sql on the fully replayed
-- PG17 schema. Everything is rolled back.
--
-- INVARIANT crm-archived-not-on-board | gate crm_records_list + crm_calls_queue | test this file
-- INVARIANT crm-merge-keeps-history | gate crm_record_merge | test this file
--
--   ARCHIVE  a reason is needed; an agent is refused; an archived card leaves
--            the board and My calls today, shows in Show archived, still
--            answers the duplicate check (archived true) and still blocks a
--            card with the same name; Unarchive puts it back.
--   MERGE    touches and notes move (keeper after = sum before + 1 note);
--            stage moves and the created row stay; a duplicate identifier
--            stays, a new one moves; owners and watchers move without
--            overlap; demos, imports, files and Work links move (with a card
--            event); the later stage is taken when the demo rule allows it and
--            refused (keeper's stage kept, with a note) when it does not; the
--            duplicate is archived with merged_into; a repeat with the same
--            key replays; the key with other cards is refused; an agent is
--            refused; other pipelines and archived cards are refused.
--   UNMERGE  every moved row goes back and the duplicate is on the board.
--   PAIRS    shared email and similar name pairs are listed; archived are not.
--   GRANTS   no client reads crm_record_merges.
--
-- FAILS-ON-REVERT: without the archived_at IS NULL lines the board and the
-- calls queue list archived cards; moving every crm_activity row (not only
-- touch and note) changes the kept card's stage history and fails MERGE.
--
-- Run from the repository root as supabase_admin.

\set ON_ERROR_STOP on
begin;

alter table auth.users add column if not exists email_confirmed_at timestamptz;
alter table auth.users add column if not exists banned_until timestamptz;

create temp table tx_people (who text primary key, id uuid not null, email text not null) on commit drop;
insert into tx_people (who, id, email) values
  ('seth', '45760000-0000-4000-c000-000000000001', 'seth.w64571@test.local'),
  ('tao',  '45760000-0000-4000-c000-000000000002', 'tao.w64571@test.local'),
  ('kemi', '45760000-0000-4000-c000-000000000003', 'kemi.w64571@test.local');
insert into auth.users (id, email, email_confirmed_at) select id, email, now() from tx_people;
insert into public.admin_users (email, role, status, accepted_at) values ('seth.w64571@test.local', 'owner', 'active', now());
insert into public.admin_team_members (email, role, status, accepted_at)
  select email, 'growth', 'active', now() from tx_people where who <> 'seth';

create temp table tx_results (seq serial primary key, test text, label text, ok boolean, detail text) on commit drop;
create temp table tx_ids (k text primary key, id uuid not null) on commit drop;
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
  select id, email into strict v_id, v_email from tx_people where who = p_who;
  insert into public.team_agent_calls (key_id, owner_email, actor_uid, agent, tool, xact_id, started_at)
  values (gen_random_uuid(), v_email, v_id, 'claude', 'move_stage', pg_current_xact_id(), clock_timestamp());
  return pg_temp.as_(p_who, p_sql);
end;
$fn$;
create function pg_temp.svc(p_sql text) returns text
language plpgsql as $fn$
declare v_out text;
begin
  begin
    set local role service_role;
    -- Signed out: no person's claims carry over from an earlier call.
    perform set_config('request.jwt.claim.sub', '', true);
    perform set_config('request.jwt.claims', '', true);
    execute p_sql into v_out;
    reset role;
    return v_out;
  exception when others then
    reset role;
    return 'ERR:' || sqlstate || ':' || sqlerrm;
  end;
end;
$fn$;
create function pg_temp.try(p_sql text) returns text
language plpgsql as $fn$
begin
  begin
    execute p_sql;
    return 'OK';
  exception when others then
    return 'ERR:' || sqlstate || ':' || sqlerrm;
  end;
end;
$fn$;
create function pg_temp.chk(p_test text, p_label text, p_got text, p_want text) returns void
language sql as $fn$
  insert into tx_results (test, label, ok, detail)
  values (p_test, p_label, p_got is not distinct from p_want,
          format('got %s, want %s', coalesce(left(p_got, 600), '<null>'), coalesce(p_want, '<null>')));
$fn$;
create function pg_temp.lk(p_test text, p_label text, p_got text, p_pattern text) returns void
language sql as $fn$
  insert into tx_results (test, label, ok, detail)
  values (p_test, p_label, coalesce(p_got like p_pattern, false),
          format('got %s, want like %s', coalesce(left(p_got, 600), '<null>'), p_pattern));
$fn$;
create function pg_temp.keep(p_k text, p_id uuid) returns uuid
language sql as $fn$ insert into tx_ids (k, id) values (p_k, p_id) on conflict (k) do update set id = excluded.id returning id $fn$;
create function pg_temp.id(p_k text) returns uuid language sql as $fn$ select id from tx_ids where k = p_k $fn$;
create function pg_temp.email(p_who text) returns text language sql as $fn$ select email from tx_people where who = p_who $fn$;
create function pg_temp.stage(p_k text) returns text language sql as $fn$ select stage from public.crm_records where id = pg_temp.id(p_k) $fn$;
create function pg_temp.move(p_who text, p_k text, p_to text, p_reason text default null) returns text
language sql as $fn$
  select pg_temp.person(p_who, format('select public.crm_record_move_stage(%L::uuid, %L, %L, null)::text', pg_temp.id(p_k), p_to, p_reason))
$fn$;
-- A host card owned by tao, at a stage below the band (the trigger refuses an insert at meeting or later).
create function pg_temp.host(p_k text, p_name text, p_stage text default 'replied') returns uuid
language plpgsql as $fn$
declare v_id uuid := gen_random_uuid();
begin
  insert into public.crm_records (id, pipeline, name, stage, stage_reason, created_by, updated_by)
  values (v_id, 'hosts', p_name, p_stage, case when p_stage = 'lost' then 'Not now' end, 'seth.w64571@test.local', 'seth.w64571@test.local');
  insert into public.crm_record_owners (record_id, owner_email, added_by) values (v_id, 'tao.w64571@test.local', 'seth.w64571@test.local');
  return pg_temp.keep(p_k, v_id);
end;
$fn$;
-- A host booking (/schedule). Never a staff or test address.
create function pg_temp.booking(p_k text, p_name text, p_email text, p_venue text, p_created timestamptz default now(),
                                p_phone text default null, p_audience text default 'host') returns uuid
language plpgsql as $fn$
declare v_id uuid := gen_random_uuid();
begin
  insert into public.book_call_leads (id, booking_key, audience, name, email, venue, icp, city, creator_makes,
                                      social_platform, social_url, call_at, created_at, phone_e164)
  values (v_id, 'slot:w6-' || p_k, p_audience, p_name, p_email, case when p_audience = 'host' then p_venue end,
          case when p_audience = 'host' then 'restaurants' end, case when p_audience = 'host' then null else 'Lagos' end,
          case when p_audience = 'creator' then 'video' end,
          'instagram', 'https://instagram.com/' || p_k, p_created + interval '2 days', p_created, p_phone);
  return pg_temp.keep(p_k, v_id);
end;
$fn$;
create function pg_temp.link_token(p_booking text, p_card text) returns text
language sql as $fn$
  select pg_temp.svc(format('select public.crm_demo_link_from_token(%L, %L::uuid)::text',
    'slot:w6-' || p_booking, (select schedule_token from public.crm_records where id = pg_temp.id(p_card))))
$fn$;
create function pg_temp.gw(p_key text, p_tool text, p_args jsonb) returns text
language plpgsql as $fn$
declare v_out text;
begin
  perform pg_temp.next_request();
  begin
    set local role service_role;
    execute format('select public.team_agent_call(%L, %L, %L::jsonb, %L)::text',
      encode(sha256(convert_to(p_key, 'UTF8')), 'hex'), p_tool, p_args, 'w64571-test/1.0') into v_out;
    reset role;
    return v_out;
  exception when others then
    reset role;
    return 'ERR:' || sqlstate || ':' || sqlerrm;
  end;
end;
$fn$;
create function pg_temp.call(p_who text, p_card text, p_at timestamptz) returns void
language sql as $fn$
  insert into public.crm_activity (record_id, kind, actor_email, channel, direction, occurred_at, created_at)
  values (pg_temp.id(p_card), 'touch', pg_temp.email(p_who), 'phone', 'outbound', p_at, p_at)
$fn$;

create function pg_temp.rk() returns text language sql as $fn$ select 'w6-' || md5(random()::text || clock_timestamp()::text) $fn$;
create function pg_temp.add(p_k text, p_title text, p_links jsonb default null) returns text
language plpgsql as $fn$
declare v text; v_item jsonb;
begin
  v_item := jsonb_build_object('title', p_title, 'instructions', 'Do the work carefully and say what changed.',
    'done_means', 'It is done and checked.', 'due_on', (now() at time zone 'UTC')::date + 3,
    'owners', jsonb_build_array(pg_temp.email('tao')), 'watchers', jsonb_build_array(pg_temp.email('seth')));
  if p_links is not null then v_item := v_item || jsonb_build_object('links', p_links); end if;
  v := pg_temp.person('seth', format('select public.ops_work_add(%L::jsonb, %L)::text', jsonb_build_array(v_item), pg_temp.rk()));
  if v not like 'ERR:%' and (v::jsonb)->'results'->0->>'status' = 'added' then
    perform pg_temp.keep(p_k, ((v::jsonb)->'results'->0->'card'->>'id')::uuid);
  end if;
  return v;
end;
$fn$;
create function pg_temp.n_act(p_k text, p_kinds text[]) returns text
language sql as $fn$ select count(*)::text from public.crm_activity a where a.record_id = pg_temp.id(p_k) and a.kind = any(p_kinds) $fn$;
create function pg_temp.ident(p_k text, p_kind text, p_value text) returns void
language sql as $fn$
  insert into public.crm_record_identifiers (record_id, kind, value, value_key, created_by)
  values (pg_temp.id(p_k), p_kind, p_value, public.crm_ident_key(p_kind, p_value), 'seth.w64571@test.local')
$fn$;
create function pg_temp.note(p_k text, p_body text) returns void
language sql as $fn$
  insert into public.crm_activity (record_id, kind, actor_email, body) values (pg_temp.id(p_k), 'note', 'tao.w64571@test.local', p_body)
$fn$;
create function pg_temp.board_has(p_k text) returns text
language sql as $fn$
  select (exists (select 1 from jsonb_array_elements((pg_temp.person('tao', $q$select public.crm_records_list('hosts')::text$q$)::jsonb)->'records') r
                  where (r->>'id')::uuid = pg_temp.id(p_k)))::text
$fn$;

-- ───────────────────────────── ARCHIVE ─────────────────────────────
do $t$
declare v text; j jsonb;
begin
  perform pg_temp.host('ar', 'Archive Me Lounge W6', 'contacted');
  update public.crm_records set due_on = (now() at time zone 'Africa/Lagos')::date - 1 where id = pg_temp.id('ar');
  perform pg_temp.chk('ARCHIVE', 'on the board before', pg_temp.board_has('ar'), 'true');
  v := pg_temp.person('tao', format('select public.crm_calls_queue(null)::text'));
  perform pg_temp.chk('ARCHIVE', 'in My calls today before',
    (exists (select 1 from jsonb_array_elements((v::jsonb)->'records') r where (r->>'id')::uuid = pg_temp.id('ar')))::text, 'true');

  v := pg_temp.person('tao', format('select public.crm_record_archive(%L::uuid, %L)::text', pg_temp.id('ar'), '   '));
  perform pg_temp.lk('ARCHIVE', 'a blank reason is refused', v, 'ERR:22023:reason_required:%');
  v := pg_temp.agent('tao', format('select public.crm_record_archive(%L::uuid, %L)::text', pg_temp.id('ar'), 'Pruned'));
  perform pg_temp.lk('ARCHIVE', 'an agent is refused', v, 'ERR:42501:people_only:%');
  v := pg_temp.person('tao', format('select public.crm_record_archive(%L::uuid, %L)::text', pg_temp.id('ar'), 'Pruned in the monthly clean-up'));
  perform pg_temp.chk('ARCHIVE', 'archived', (v::jsonb)->>'changed', 'true');
  perform pg_temp.chk('ARCHIVE', 'the card json carries the reason', (v::jsonb)->'record'->>'archived_reason', 'Pruned in the monthly clean-up');
  perform pg_temp.chk('ARCHIVE', 'a note says so', (select body from public.crm_activity where record_id = pg_temp.id('ar') and kind = 'note' order by created_at desc limit 1), 'Archived: Pruned in the monthly clean-up');
  perform pg_temp.chk('ARCHIVE', 'off the board', pg_temp.board_has('ar'), 'false');
  j := pg_temp.person('tao', $q$select public.crm_records_list('hosts')::text$q$)::jsonb;
  perform pg_temp.chk('ARCHIVE', 'the board counts archived cards', ((j->>'archived_count')::integer >= 1)::text, 'true');
  v := pg_temp.person('tao', format('select public.crm_calls_queue(null)::text'));
  perform pg_temp.chk('ARCHIVE', 'out of My calls today',
    (exists (select 1 from jsonb_array_elements((v::jsonb)->'records') r where (r->>'id')::uuid = pg_temp.id('ar')))::text, 'false');
  v := pg_temp.person('tao', $q$select public.crm_records_archived_list('hosts')::text$q$);
  perform pg_temp.chk('ARCHIVE', 'in Show archived',
    (exists (select 1 from jsonb_array_elements((v::jsonb)->'records') r where (r->>'id')::uuid = pg_temp.id('ar')))::text, 'true');
  v := pg_temp.person('tao', $q$select public.crm_duplicate_check('hosts', 'archive me lounge w6', null)::text$q$);
  perform pg_temp.chk('ARCHIVE', 'the duplicate check still finds it, archived', (v::jsonb)->'exact'->>'archived', 'true');
  v := pg_temp.try($q$insert into public.crm_records (pipeline, name, stage, created_by, updated_by) values ('hosts', 'Archive Me Lounge W6', 'prospect', 'x', 'x')$q$);
  perform pg_temp.lk('ARCHIVE', 'an archived name still blocks a duplicate card', v, 'ERR:23505:%');
  v := pg_temp.person('tao', format('select public.crm_record_unarchive(%L::uuid)::text', pg_temp.id('ar')));
  perform pg_temp.chk('ARCHIVE', 'unarchived', (v::jsonb)->>'changed', 'true');
  perform pg_temp.chk('ARCHIVE', 'back on the board', pg_temp.board_has('ar'), 'true');
  perform pg_temp.chk('ARCHIVE', 'the archive fields are clear',
    (select (archived_at is null and archived_by is null and archived_reason is null)::text from public.crm_records where id = pg_temp.id('ar')), 'true');
  v := pg_temp.try(format($q$update public.crm_records set archived_at = now() where id = %L$q$, pg_temp.id('ar')));
  perform pg_temp.lk('ARCHIVE', 'archived_at without who and why is refused by the table', v, 'ERR:23514:%');
end;
$t$;

-- ───────────────────────────── MERGE ─────────────────────────────
do $t$
declare v text; j jsonb; v_before_keep integer; v_before_drop integer; v_moves_keep integer; v_rk text := 'w6-merge-key-0001';
        v_bk uuid;
begin
  perform pg_temp.host('mk', 'RSVP Lagos W6', 'prospect');
  perform pg_temp.host('md', 'RSVP Restaurant W6', 'prospect');
  -- the duplicate: contacted, then replied (two stage moves), touches, a note.
  perform pg_temp.move('tao', 'md', 'contacted');
  perform pg_temp.move('tao', 'md', 'replied');
  perform pg_temp.call('tao', 'md', now() - interval '3 days');
  perform pg_temp.call('tao', 'md', now() - interval '2 days');
  perform pg_temp.note('md', 'They host jazz on Fridays.');
  perform pg_temp.call('tao', 'mk', now() - interval '1 day');
  perform pg_temp.ident('mk', 'email', 'hello@rsvp-w6.test');
  perform pg_temp.ident('md', 'email', 'hello@rsvp-w6.test');
  perform pg_temp.ident('md', 'phone', '+2348035550199');
  insert into public.crm_record_owners (record_id, owner_email, added_by) values (pg_temp.id('md'), 'kemi.w64571@test.local', 'x');
  insert into public.crm_record_watchers (record_id, watcher_email, added_by) values (pg_temp.id('md'), 'seth.w64571@test.local', 'x');
  insert into public.crm_record_sources (source_system, source_id, source_scope, record_id, linked_by)
  values ('sheet', 'w6-row-1', 'w6', pg_temp.id('md'), 'seth.w64571@test.local');
  insert into public.ops_work_files (kind, name, url, added_by, record_id)
  values ('link', 'Menu', 'https://example.test/menu', 'tao.w64571@test.local', pg_temp.id('md'));
  v_bk := pg_temp.booking('mb', 'Ada', 'ada@rsvp-w6.test', 'RSVP Restaurant');
  insert into public.crm_record_demos (booking_id, record_id, link_source, linked_by) values (v_bk, pg_temp.id('md'), 'picked', 'tao.w64571@test.local');
  v := pg_temp.add('mcard', 'W6 card for the duplicate', jsonb_build_array(jsonb_build_object('kind', 'host', 'id', pg_temp.id('md'))));
  perform pg_temp.lk('MERGE', 'a Work card links the duplicate', v, '%"added"%');

  v_before_keep := pg_temp.n_act('mk', array['touch','note'])::integer;
  v_before_drop := pg_temp.n_act('md', array['touch','note'])::integer;
  v_moves_keep := pg_temp.n_act('mk', array['stage_move','created'])::integer;

  v := pg_temp.agent('tao', format('select public.crm_record_merge(%L::uuid, %L::uuid, %L)::text', pg_temp.id('mk'), pg_temp.id('md'), v_rk));
  perform pg_temp.lk('MERGE', 'an agent is refused', v, 'ERR:42501:people_only:%');
  v := pg_temp.person('seth', format('select public.crm_record_merge(%L::uuid, %L::uuid, %L)::text', pg_temp.id('mk'), pg_temp.id('mk'), v_rk));
  perform pg_temp.lk('MERGE', 'a card with itself is refused', v, 'ERR:22023:invalid_merge:%');

  v := pg_temp.person('seth', format('select public.crm_record_merge(%L::uuid, %L::uuid, %L)::text', pg_temp.id('mk'), pg_temp.id('md'), v_rk));
  perform pg_temp.lk('MERGE', 'merged', v, '{%');
  j := v::jsonb;
  perform pg_temp.chk('MERGE', 'keeper touches and notes = both before + its merge note',
    pg_temp.n_act('mk', array['touch','note']), (v_before_keep + v_before_drop + 1)::text);
  perform pg_temp.chk('MERGE', 'the keeper''s stage moves and created row are unchanged except the stage it took',
    (pg_temp.n_act('mk', array['stage_move','created'])::integer - v_moves_keep)::text, '1');
  perform pg_temp.chk('MERGE', 'the duplicate keeps its two stage moves', pg_temp.n_act('md', array['stage_move','created']), '2');
  perform pg_temp.chk('MERGE', 'moved touches keep the stage they were made in',
    (select string_agg(a.stage_at, ',' order by a.occurred_at) from public.crm_activity a where a.record_id = pg_temp.id('mk') and a.kind = 'touch'), 'replied,replied,prospect');
  perform pg_temp.chk('MERGE', 'the keeper took Replied (allowed)', pg_temp.stage('mk'), 'replied');
  perform pg_temp.chk('MERGE', 'the answer names the stage taken', j->>'stage_to', 'replied');
  perform pg_temp.chk('MERGE', 'the keeper has one email (no duplicate) and the phone',
    (select string_agg(kind, ',' order by kind) from public.crm_record_identifiers where record_id = pg_temp.id('mk')), 'email,phone');
  perform pg_temp.chk('MERGE', 'the duplicate email stays on the archived card',
    (select string_agg(kind, ',' order by kind) from public.crm_record_identifiers where record_id = pg_temp.id('md')), 'email');
  perform pg_temp.chk('MERGE', 'owners moved',
    (select string_agg(owner_email, ',' order by owner_email) from public.crm_record_owners where record_id = pg_temp.id('mk')), 'kemi.w64571@test.local,tao.w64571@test.local');
  perform pg_temp.chk('MERGE', 'watcher moved',
    (select string_agg(watcher_email, ',') from public.crm_record_watchers where record_id = pg_temp.id('mk')), 'seth.w64571@test.local');
  perform pg_temp.chk('MERGE', 'the shared owner (tao) stays on the duplicate',
    (select string_agg(owner_email, ',') from public.crm_record_owners where record_id = pg_temp.id('md')), 'tao.w64571@test.local');
  perform pg_temp.chk('MERGE', 'the demo moved', (select record_id = pg_temp.id('mk') from public.crm_record_demos where booking_id = v_bk)::text, 'true');
  perform pg_temp.chk('MERGE', 'the import moved', (select record_id = pg_temp.id('mk') from public.crm_record_sources where source_id = 'w6-row-1')::text, 'true');
  perform pg_temp.chk('MERGE', 'the file moved', (select count(*)::text from public.ops_work_files where record_id = pg_temp.id('mk')), '1');
  perform pg_temp.chk('MERGE', 'the Work link points at the keeper',
    (select target_id = pg_temp.id('mk') from public.ops_work_links where card_id = pg_temp.id('mcard') and kind = 'host')::text, 'true');
  perform pg_temp.lk('MERGE', 'the Work card has a merge event',
    (select string_agg(body, '|') from public.ops_work_events where card_id = pg_temp.id('mcard') and action = 'links'), '%Merged RSVP Restaurant W6 into RSVP Lagos W6%');
  perform pg_temp.chk('MERGE', 'the duplicate is archived with a pointer',
    (select (archived_at is not null)::text || '/' || (merged_into_id = pg_temp.id('mk'))::text || '/' || archived_reason from public.crm_records where id = pg_temp.id('md')),
    'true/true/Merged into RSVP Lagos W6');
  perform pg_temp.chk('MERGE', 'the duplicate is off the board', pg_temp.board_has('md'), 'false');
  perform pg_temp.chk('MERGE', 'the json says where it went',
    (select public.crm_record_json(c)->'merged_into'->>'name' from public.crm_records c where c.id = pg_temp.id('md')), 'RSVP Lagos W6');
  perform pg_temp.chk('MERGE', 'the merge is logged with what moved',
    (select jsonb_array_length(moved->'activity')::text || '/' || jsonb_array_length(moved->'identifiers')::text from public.crm_record_merges where id = (j->>'merge_id')::uuid), v_before_drop::text || '/1');
  perform pg_temp.chk('MERGE', 'it is audited', (select count(*)::text from public.admin_audit_log where action = 'crm.merge' and target_id = pg_temp.id('mk')::text), '1');
  v := pg_temp.person('seth', format('select public.crm_record_merge(%L::uuid, %L::uuid, %L)::text', pg_temp.id('mk'), pg_temp.id('md'), v_rk));
  perform pg_temp.chk('MERGE', 'the same key replays', (v::jsonb)->>'replayed', 'true');
  perform pg_temp.host('mx', 'Some Other W6', 'prospect');
  v := pg_temp.person('seth', format('select public.crm_record_merge(%L::uuid, %L::uuid, %L)::text', pg_temp.id('mk'), pg_temp.id('mx'), v_rk));
  perform pg_temp.lk('MERGE', 'the key with other cards is refused', v, 'ERR:22023:request_key_reused:%');
  v := pg_temp.person('seth', format('select public.crm_record_merge(%L::uuid, %L::uuid, %L)::text', pg_temp.id('mx'), pg_temp.id('md'), pg_temp.rk()));
  perform pg_temp.lk('MERGE', 'an archived card cannot be merged again', v, 'ERR:22023:archived_card:%');
  v := pg_temp.person('tao', format('select public.crm_record_unarchive(%L::uuid)::text', pg_temp.id('md')));
  perform pg_temp.lk('MERGE', 'a merged card is not unarchived by hand', v, 'ERR:22023:merged_card:%');
  insert into public.crm_records (id, pipeline, name, stage, created_by, updated_by)
  values ('45760000-0000-4000-e000-00000000c001', 'creators', 'Creator W6', 'identified', 'x', 'x');
  v := pg_temp.person('seth', format('select public.crm_record_merge(%L::uuid, %L::uuid, %L)::text', pg_temp.id('mx'), '45760000-0000-4000-e000-00000000c001', pg_temp.rk()));
  perform pg_temp.lk('MERGE', 'another pipeline is refused', v, 'ERR:22023:invalid_merge:%');
  perform pg_temp.chk('MERGE', 'the panel lists the merge with Undo open',
    (select (public.crm_record_merges_json(pg_temp.id('mk')))::text is not null)::text, 'true');
  v := pg_temp.person('tao', format('select public.crm_record_merges_json(%L::uuid)::text', pg_temp.id('mk')));
  perform pg_temp.chk('MERGE', 'can_undo is true', (v::jsonb)->0->>'can_undo', 'true');

  -- ── UNMERGE ──
  v := pg_temp.person('seth', format('select public.crm_record_unmerge(%L::uuid)::text', (j->>'merge_id')::uuid));
  perform pg_temp.lk('UNMERGE', 'undone', v, '{%');
  perform pg_temp.chk('UNMERGE', 'the keeper''s touches and notes are back to before + 2 notes', pg_temp.n_act('mk', array['touch','note']), (v_before_keep + 2)::text);
  perform pg_temp.chk('UNMERGE', 'the duplicate has its touches and notes back (+2 notes)', pg_temp.n_act('md', array['touch','note']), (v_before_drop + 2)::text);
  perform pg_temp.chk('UNMERGE', 'the phone went back',
    (select string_agg(kind, ',' order by kind) from public.crm_record_identifiers where record_id = pg_temp.id('md')), 'email,phone');
  perform pg_temp.chk('UNMERGE', 'kemi owns the duplicate again',
    (select string_agg(owner_email, ',' order by owner_email) from public.crm_record_owners where record_id = pg_temp.id('md')), 'kemi.w64571@test.local,tao.w64571@test.local');
  perform pg_temp.chk('UNMERGE', 'the demo went back', (select record_id = pg_temp.id('md') from public.crm_record_demos where booking_id = v_bk)::text, 'true');
  perform pg_temp.chk('UNMERGE', 'the Work link went back',
    (select target_id = pg_temp.id('md') from public.ops_work_links where card_id = pg_temp.id('mcard') and kind = 'host')::text, 'true');
  perform pg_temp.chk('UNMERGE', 'the duplicate is back on the board', pg_temp.board_has('md'), 'true');
  perform pg_temp.lk('UNMERGE', 'the stage the merge took stays, and the answer says so', (v::jsonb)->>'stage_note', '%stays in Replied%');
  v := pg_temp.person('seth', format('select public.crm_record_unmerge(%L::uuid)::text', (j->>'merge_id')::uuid));
  perform pg_temp.lk('UNMERGE', 'twice is refused', v, 'ERR:22023:already_undone:%');
end;
$t$;

-- The W4 demo rule decides the stage: a duplicate at Demo booked by the
-- grandfather exemption (no linked demo) does not lift the keeper.
do $t$
declare v text;
begin
  perform pg_temp.host('gk', 'Golfview W6', 'contacted');
  perform pg_temp.host('gd', 'The Golfview Hotel W6', 'replied');
  alter table public.crm_records disable trigger crm_4571_demo_stage_guard;
  update public.crm_records set stage = 'meeting', demo_rule_exempt_at = now() where id = pg_temp.id('gd');
  alter table public.crm_records enable trigger crm_4571_demo_stage_guard;
  v := pg_temp.person('seth', format('select public.crm_record_merge(%L::uuid, %L::uuid, %L)::text', pg_temp.id('gk'), pg_temp.id('gd'), pg_temp.rk()));
  perform pg_temp.lk('MERGE', 'merged without a demo', v, '{%');
  perform pg_temp.chk('MERGE', 'the keeper keeps its stage (no linked demo)', pg_temp.stage('gk'), 'contacted');
  perform pg_temp.lk('MERGE', 'the answer says why', (v::jsonb)->>'stage_note', 'Kept Contacted: Demo booked needs%');
end;
$t$;

-- ───────────────────────────── PAIRS ─────────────────────────────
do $t$
declare v text; j jsonb;
begin
  perform pg_temp.host('pa', 'Pulse W6x', 'prospect');
  perform pg_temp.host('pb', 'Pulse W6x Events', 'prospect');
  perform pg_temp.host('pc', 'Lekki Corner W6', 'prospect');
  perform pg_temp.host('pd', 'Harbour Point W6', 'prospect');
  perform pg_temp.ident('pc', 'email', 'desk@lekki-w6.test');
  perform pg_temp.ident('pd', 'email', 'desk@lekki-w6.test');
  perform pg_temp.host('pe', 'Pulse W6x Archived', 'prospect');
  update public.crm_records set archived_at = now(), archived_by = 'x', archived_reason = 'old' where id = pg_temp.id('pe');
  v := pg_temp.person('tao', $q$select public.crm_duplicate_pairs('hosts')::text$q$);
  j := v::jsonb;
  perform pg_temp.chk('PAIRS', 'the shared email pair is listed as shared_email',
    (select p->>'reason' from jsonb_array_elements(j->'pairs') p
      where (p->'a'->>'id')::uuid in (pg_temp.id('pc'), pg_temp.id('pd')) and (p->'b'->>'id')::uuid in (pg_temp.id('pc'), pg_temp.id('pd'))), 'shared_email');
  perform pg_temp.chk('PAIRS', 'the similar names are listed',
    (select p->>'reason' from jsonb_array_elements(j->'pairs') p
      where (p->'a'->>'id')::uuid in (pg_temp.id('pa'), pg_temp.id('pb')) and (p->'b'->>'id')::uuid in (pg_temp.id('pa'), pg_temp.id('pb'))), 'similar_name');
  perform pg_temp.chk('PAIRS', 'an archived card is never in a pair',
    (select count(*)::text from jsonb_array_elements(j->'pairs') p
      where (p->'a'->>'id')::uuid = pg_temp.id('pe') or (p->'b'->>'id')::uuid = pg_temp.id('pe')), '0');
  perform pg_temp.chk('PAIRS', 'no email address in a pair', (j::text like '%desk@lekki%')::text, 'false');
end;
$t$;

-- ───────────────────────────── GRANTS ─────────────────────────────
do $t$
begin
  perform pg_temp.chk('GRANTS', 'authenticated cannot read crm_record_merges', has_table_privilege('authenticated', 'public.crm_record_merges', 'select')::text, 'false');
  perform pg_temp.chk('GRANTS', 'anon cannot merge', has_function_privilege('anon', 'public.crm_record_merge(uuid,uuid,text)', 'execute')::text, 'false');
  perform pg_temp.chk('GRANTS', 'the people-only helper is the server''s', has_function_privilege('authenticated', 'public.crm_4571_person_ctx()', 'execute')::text, 'false');
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
  if v_all < 60 then raise exception '#4571 W6a implementor recorded only % checks', v_all; end if;
  if v_fail > 0 then raise exception '#4571 W6a implementor: % of % checks failed', v_fail, v_all; end if;
  raise notice '#4571 W6a implementor: % of % checks passed', v_all, v_all;
end;
$r$;

rollback;
