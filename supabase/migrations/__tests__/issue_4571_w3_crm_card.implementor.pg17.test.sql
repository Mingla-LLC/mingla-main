-- Issue #4571 W3 (host and creator card, contacts, watchers, tile, "My calls
-- today") -- implementor suite for
-- 20281130034571_issue_4571_w3_crm_card_watchers_contacts.sql on the fully
-- replayed PG17 schema. Everything is rolled back.
--
-- INVARIANT crm-record-watchers-optional-not-owner | gate crm_record_set_people, crm_4571_people_overlap (crm_record_set_owners) | test this file
-- INVARIANT crm-calls-queue-order | gate crm_calls_queue | test this file
--
--   WEB      a website is stored in its normal form (host and path, lower
--            case, no trailing slash); a second record with it is refused;
--            a link that is not http(s) is refused.
--   FOLLOW   a person sets a handle's followers; never on a website; never
--            an agent.
--   PEOPLE   watchers are optional (0 to 10); one person cannot own and
--            watch; set_owners refuses a watcher; a stale write is PT409.
--   NOTICE   a watcher hears about a stage move (push) and a call (Admin
--            only); the actor is never told.
--   WORK     crm_record_work lists cards and subtasks that point at a host or
--            a creator (host or creator link, call link), not ones closed
--            more than 14 days ago; open_work and last_touch are on the card.
--   QUEUE    "My calls today": the caller's own hosts due today or earlier,
--            Replied and Demo booked pinned first, then Contacted, Prospect,
--            oldest due first, then name; deleted and other people's excluded.
--   CONNECTOR set_owners takes watcher_emails through the real gateway; my_day
--            carries calls_due.
--   FILES    a host or creator file uses the Work card files table, bucket,
--            limits (25 MB, 50, types), upload and read checks and signed
--            links; never on a card and a record at once; an agent only on a
--            card its person owns or watches; a deleted record's files stop.
--
-- FAILS-ON-REVERT: on W2 the website kind, crm_record_watchers,
-- crm_record_set_people, crm_record_work and crm_calls_queue do not exist.
--
-- Run from the repository root as supabase_admin.

\set ON_ERROR_STOP on
begin;

alter table auth.users add column if not exists email_confirmed_at timestamptz;
alter table auth.users add column if not exists banned_until timestamptz;

create temp table tx_people (who text primary key, id uuid not null, email text not null) on commit drop;
insert into tx_people (who, id, email) values
  ('seth', '45730000-0000-4000-c000-000000000001', 'seth.w34571@test.local'),
  ('tao',  '45730000-0000-4000-c000-000000000002', 'tao.w34571@test.local'),
  ('abi',  '45730000-0000-4000-c000-000000000003', 'abi.w34571@test.local'),
  ('kemi', '45730000-0000-4000-c000-000000000004', 'kemi.w34571@test.local');
insert into auth.users (id, email, email_confirmed_at) select id, email, now() from tx_people;
insert into public.admin_users (email, role, status, accepted_at) values
  ('seth.w34571@test.local', 'owner', 'active', now()), ('abi.w34571@test.local', 'admin', 'active', now());
insert into public.admin_team_members (email, role, status, accepted_at)
  select email, 'growth', 'active', now() from tx_people where who not in ('seth', 'abi');

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
create function pg_temp.rk() returns text language sql as $fn$ select 'w3-' || md5(random()::text || clock_timestamp()::text) $fn$;
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
create function pg_temp.call_as(p_who text, p_sql text) returns text
language sql as $fn$ select pg_temp.person(p_who, p_sql) $fn$;


-- Fixtures. tao owns four hosts with due dates; seth owns one; one is deleted.
-- #4571 W4: Demo Lounge and Onboarded Place sit past the Demo booked rule as
-- grandfathered cards (the rule refuses an insert there; issue_4571_w4_*).
alter table public.crm_records disable trigger crm_4571_demo_stage_guard;
insert into public.crm_records (id, pipeline, name, stage, due_on, created_by, updated_by, deleted_at, deleted_by) values
  ('45730000-0000-4000-d000-000000000001', 'hosts', 'Island Vinyl', 'contacted', current_date - 2, 'seth.w34571@test.local', 'seth.w34571@test.local', null, null),
  ('45730000-0000-4000-d000-000000000002', 'hosts', 'Palm Court Kitchen', 'prospect', current_date - 5, 'seth.w34571@test.local', 'seth.w34571@test.local', null, null),
  ('45730000-0000-4000-d000-000000000003', 'hosts', 'Bar Replied', 'replied', current_date, 'seth.w34571@test.local', 'seth.w34571@test.local', null, null),
  ('45730000-0000-4000-d000-000000000004', 'hosts', 'Demo Lounge', 'meeting', current_date - 1, 'seth.w34571@test.local', 'seth.w34571@test.local', null, null),
  ('45730000-0000-4000-d000-000000000005', 'hosts', 'Aaa Prospect', 'prospect', current_date - 5, 'seth.w34571@test.local', 'seth.w34571@test.local', null, null),
  ('45730000-0000-4000-d000-000000000006', 'hosts', 'Tomorrow Cafe', 'contacted', current_date + 3, 'seth.w34571@test.local', 'seth.w34571@test.local', null, null),
  ('45730000-0000-4000-d000-000000000007', 'hosts', 'Gone Bar', 'contacted', current_date - 1, 'seth.w34571@test.local', 'seth.w34571@test.local', now(), 'seth.w34571@test.local'),
  ('45730000-0000-4000-d000-000000000008', 'hosts', 'Seths Own', 'contacted', current_date - 1, 'seth.w34571@test.local', 'seth.w34571@test.local', null, null),
  ('45730000-0000-4000-d000-000000000009', 'hosts', 'Onboarded Place', 'onboarded', current_date - 1, 'seth.w34571@test.local', 'seth.w34571@test.local', null, null),
  ('45730000-0000-4000-d000-000000000010', 'creators', 'Ngozi Creates', 'identified', null, 'seth.w34571@test.local', 'seth.w34571@test.local', null, null);
update public.crm_records set demo_rule_exempt_at = now() where id::text like '45730000-0000-4000-d000-%' and stage in ('meeting', 'onboarded');
alter table public.crm_records enable trigger crm_4571_demo_stage_guard;
select pg_temp.keep('iv', '45730000-0000-4000-d000-000000000001'), pg_temp.keep('pc', '45730000-0000-4000-d000-000000000002'),
       pg_temp.keep('br', '45730000-0000-4000-d000-000000000003'), pg_temp.keep('dl', '45730000-0000-4000-d000-000000000004'),
       pg_temp.keep('ap', '45730000-0000-4000-d000-000000000005'), pg_temp.keep('cr', '45730000-0000-4000-d000-000000000010');
insert into public.crm_record_owners (record_id, owner_email, added_by)
  select r.id, case when r.name = 'Seths Own' then 'seth.w34571@test.local' else 'tao.w34571@test.local' end, 'seth.w34571@test.local'
    from public.crm_records r where r.id::text like '45730000-0000-4000-d000-%';

-- ───────────────────────────── WEB ─────────────────────────────
do $t$
declare v text;
begin
  v := pg_temp.call_as('tao', format($q$select public.crm_record_update(%L::uuid, %L::jsonb)::text$q$, pg_temp.id('iv'),
         jsonb_build_object('identifiers', jsonb_build_array(
           jsonb_build_object('kind', 'website', 'value', 'https://IslandVinyl.example/Menu/?utm=x'),
           jsonb_build_object('kind', 'handle', 'value', '@islandvinyl', 'platform', 'instagram')))));
  perform pg_temp.chk('WEB', 'a website is kept as typed with its normal form',
    (select string_agg(i->>'kind' || '=' || (i->>'key'), ',' order by i->>'kind') from jsonb_array_elements((v::jsonb)->'record'->'identifiers') i),
    'handle=islandvinyl,website=islandvinyl.example/menu');
  perform pg_temp.chk('WEB', 'the normal form drops the scheme, query and trailing slash',
    public.crm_ident_key('website', 'http://www.Example.com/a/b/#top'), 'www.example.com/a/b');
  perform pg_temp.chk('WEB', 'a link that is not http(s) is no website', public.crm_ident_key('website', 'ftp://example.com'), null);
  perform pg_temp.chk('WEB', 'a bare word is no website', public.crm_ident_key('website', 'islandvinyl'), null);
  v := pg_temp.call_as('tao', format($q$select public.crm_record_update(%L::uuid, %L::jsonb)::text$q$, pg_temp.id('pc'),
         jsonb_build_object('identifiers', jsonb_build_array(jsonb_build_object('kind', 'website', 'value', 'https://islandvinyl.example/menu')))));
  perform pg_temp.lk('WEB', 'a second record with the same website is refused like any shared contact', v, 'ERR:%Island Vinyl%');
  v := pg_temp.call_as('tao', format($q$select public.crm_record_update(%L::uuid, %L::jsonb)::text$q$, pg_temp.id('pc'),
         jsonb_build_object('identifiers', jsonb_build_array(jsonb_build_object('kind', 'website', 'value', 'mailto:hi@pc.example')))));
  perform pg_temp.lk('WEB', 'a website that is not a link is refused with what to send', v, 'ERR:22023:invalid_identifier:%starts with http://%');
  v := pg_temp.call_as('tao', format($q$select public.crm_record_update(%L::uuid, %L::jsonb)::text$q$, pg_temp.id('pc'),
         jsonb_build_object('identifiers', jsonb_build_array(jsonb_build_object('kind', 'website', 'value', 'https://pc.example', 'platform', 'instagram')))));
  perform pg_temp.lk('WEB', 'a platform on a website is refused', v, 'ERR:22023:invalid_identifiers: A platform goes with a handle only%');
end;
$t$;

-- ───────────────────────────── FOLLOW ─────────────────────────────
do $t$
declare v text; v_h uuid; v_w uuid;
begin
  select id into v_h from public.crm_record_identifiers where record_id = pg_temp.id('iv') and kind = 'handle';
  select id into v_w from public.crm_record_identifiers where record_id = pg_temp.id('iv') and kind = 'website';
  v := pg_temp.call_as('tao', format('select public.crm_identifier_set_followers(%L::uuid, 12400)::text', v_h));
  perform pg_temp.chk('FOLLOW', 'a person sets a handle''s followers; the card shows them',
    (select (i->>'followers') || '/' || (i->>'followers_at' is not null)::text from jsonb_array_elements((v::jsonb)->'record'->'identifiers') i where i->>'kind' = 'handle'),
    '12400/true');
  v := pg_temp.call_as('tao', format('select public.crm_identifier_set_followers(%L::uuid, 10)::text', v_w));
  perform pg_temp.lk('FOLLOW', 'a website has no followers', v, 'ERR:22023:invalid_value: Only a social handle%');
  v := pg_temp.call_as('tao', format('select public.crm_identifier_set_followers(%L::uuid, -1)::text', v_h));
  perform pg_temp.lk('FOLLOW', 'a negative count is refused', v, 'ERR:22023:%');
  v := pg_temp.agent('tao', format('select public.crm_identifier_set_followers(%L::uuid, 99)::text', v_h));
  perform pg_temp.lk('FOLLOW', 'an agent cannot set followers', v, 'ERR:42501:needs_a_person:%');
  perform pg_temp.chk('FOLLOW', 'the agent changed nothing', (select followers::text from public.crm_record_identifiers where id = v_h), '12400');
  v := pg_temp.call_as('tao', format('select public.crm_identifier_set_followers(%L::uuid, null)::text', v_h));
  perform pg_temp.chk('FOLLOW', 'clearing it leaves nothing to show',
    (select coalesce(followers::text, 'null') || '/' || coalesce(followers_at::text, 'null') from public.crm_record_identifiers where id = v_h), 'null/null');
  begin
    update public.crm_record_identifiers set followers = 5, followers_at = now() where id = v_w;
    perform pg_temp.chk('FOLLOW', 'the table refuses followers on a website', 'stored', 'refused');
  exception when check_violation then
    perform pg_temp.chk('FOLLOW', 'the table refuses followers on a website', 'refused', 'refused');
  end;
end;
$t$;

-- ───────────────────────────── PEOPLE ─────────────────────────────
do $t$
declare v text; v_upd timestamptz;
begin
  perform pg_temp.chk('PEOPLE', 'a record starts with nobody watching',
    (select (public.crm_record_json(r)->'watchers')::text from public.crm_records r where r.id = pg_temp.id('iv')), '[]');
  v := pg_temp.call_as('tao', format($q$select public.crm_record_set_people(%L::uuid, array[%L, %L], array[%L])::text$q$,
         pg_temp.id('iv'), pg_temp.email('tao'), pg_temp.email('seth'), pg_temp.email('seth')));
  perform pg_temp.lk('PEOPLE', 'one person cannot own and watch', v, 'ERR:22023:owner_and_watcher:%cannot own and watch%');
  v := pg_temp.call_as('tao', format($q$select public.crm_record_set_people(%L::uuid, array[%L], array[%L, %L])::text$q$,
         pg_temp.id('iv'), pg_temp.email('tao'), pg_temp.email('seth'), pg_temp.email('kemi')));
  perform pg_temp.chk('PEOPLE', 'owners and watchers are written in one step',
    ((v::jsonb)->'record'->'owners')::text || ' ' || ((v::jsonb)->'record'->'watchers')::text,
    '["tao.w34571@test.local"] ["kemi.w34571@test.local", "seth.w34571@test.local"]');
  v := pg_temp.call_as('tao', format($q$select public.crm_record_set_owners(%L::uuid, array[%L, %L])::text$q$,
         pg_temp.id('iv'), pg_temp.email('tao'), pg_temp.email('kemi')));
  perform pg_temp.lk('PEOPLE', 'set_owners refuses an owner who is watching', v, 'ERR:22023:owner_and_watcher:%');
  v := pg_temp.call_as('tao', format($q$select public.crm_record_set_people(%L::uuid, array[%L], array[%L])::text$q$,
         pg_temp.id('iv'), pg_temp.email('tao'), 'nobody@example.com'));
  perform pg_temp.lk('PEOPLE', 'a watcher must be on the team', v, 'ERR:22023:unknown_watcher:%');
  v := pg_temp.call_as('tao', format($q$select public.crm_record_set_people(%L::uuid, array[%L], array[]::text[])::text$q$,
         pg_temp.id('pc'), pg_temp.email('tao')));
  perform pg_temp.chk('PEOPLE', 'watchers are optional (none is fine)', (v::jsonb)->>'changed', 'false');
  v := pg_temp.call_as('tao', format($q$select public.crm_record_set_people(%L::uuid, array[]::text[], array[%L])::text$q$,
         pg_temp.id('pc'), pg_temp.email('seth')));
  perform pg_temp.lk('PEOPLE', 'the last owner stays', v, 'ERR:22023:last_owner:%');
  v := pg_temp.call_as('tao', format($q$select public.crm_record_set_people(%L::uuid, array[%L], array[%L], '2001-01-01 00:00+00')::text$q$,
         pg_temp.id('pc'), pg_temp.email('tao'), pg_temp.email('seth')));
  perform pg_temp.lk('PEOPLE', 'a stale write changes nothing (PT409)', v, 'ERR:PT409:stale:%');
  select updated_at into v_upd from public.crm_records where id = pg_temp.id('pc');
  v := pg_temp.call_as('tao', format($q$select public.crm_record_set_people(%L::uuid, array[%L], array[%L], %L)::text$q$,
         pg_temp.id('pc'), pg_temp.email('tao'), pg_temp.email('seth'), v_upd));
  perform pg_temp.chk('PEOPLE', 'a fresh write with the card''s updated_at goes through', (v::jsonb)->>'changed', 'true');
  perform pg_temp.chk('PEOPLE', 'the table has no client access',
    (has_table_privilege('authenticated', 'public.crm_record_watchers', 'SELECT') or has_table_privilege('anon', 'public.crm_record_watchers', 'SELECT'))::text, 'false');
end;
$t$;

-- ───────────────────────────── NOTICE ─────────────────────────────
do $t$
declare v text; v_act uuid;
begin
  -- iv: owner tao, watchers kemi and seth. tao moves it: both watchers hear, with push.
  v := pg_temp.call_as('tao', format($q$select public.crm_record_move_stage(%L::uuid, 'replied', null, 'contacted')::text$q$, pg_temp.id('iv')));
  v_act := ((v::jsonb)->>'activity_id')::uuid;
  perform pg_temp.chk('NOTICE', 'a stage move tells each watcher, with push',
    (select string_agg(p.who || ':' || m.event_kind || ':' || m.push::text, ',' order by p.who)
       from public.team_mentions m join tx_people p on p.id = m.target_user_id
      where m.source_kind = 'crm_record' and m.source_id = v_act),
    'kemi:status:true,seth:status:true');
  perform pg_temp.lk('NOTICE', 'the notice says who moved what where',
    (select min(body_excerpt) from public.team_mentions where source_kind = 'crm_record' and source_id = v_act), '% moved Island Vinyl to Replied');
  perform pg_temp.chk('NOTICE', 'the move queued the email and the Host app push',
    (select string_agg(category_key, ',' order by category_key) from public.notification_outbox
      where user_id = pg_temp.uid('kemi') and payload->>'source_id' = v_act::text),
    'admin.team_mention,business.team_mention');
  -- seth (a watcher) logs a call: kemi sees it in Admin only; seth is not told.
  v := pg_temp.log('seth', 'iv', jsonb_build_object('kind', 'touch', 'channel', 'phone', 'direction', 'outbound', 'outcome', 'no_answer'));
  v_act := ((v::jsonb)->'activity'->>'id')::uuid;
  perform pg_temp.chk('NOTICE', 'a call is an Admin-only notice for the other watcher, never the actor',
    (select string_agg(p.who || ':' || m.event_kind || ':' || m.push::text, ',' order by p.who)
       from public.team_mentions m join tx_people p on p.id = m.target_user_id
      where m.source_kind = 'crm_record' and m.source_id = v_act),
    'kemi:edit:false');
  perform pg_temp.chk('NOTICE', 'an Admin-only notice queues nothing',
    (select count(*)::text from public.notification_outbox where payload->>'source_id' = v_act::text), '0');
  perform pg_temp.chk('NOTICE', 'the call notice names the outcome, never a number',
    (select body_excerpt ~ 'No answer' and body_excerpt !~ '[0-9]{4}' from public.team_mentions where source_kind = 'crm_record' and source_id = v_act)::text, 'true');
  -- the last touch is on the card
  perform pg_temp.chk('NOTICE', 'the card carries the last touch with who, channel and outcome',
    (select (public.crm_record_json(r)->'last_touch')->>'channel' || '/' || ((public.crm_record_json(r)->'last_touch')->>'outcome')
          || '/' || ((public.crm_record_json(r)->'last_touch')->>'actor_name' is not null)::text
       from public.crm_records r where r.id = pg_temp.id('iv')), 'phone/no_answer/true');
  perform pg_temp.chk('NOTICE', 'a record never touched has no last touch',
    (select coalesce(public.crm_record_json(r)->>'last_touch', 'null') from public.crm_records r where r.id = pg_temp.id('ap')), 'null');
end;
$t$;

-- ───────────────────────────── WORK ─────────────────────────────
do $t$
declare v text; v_call uuid;
begin
  v := pg_temp.add('crcard', 'W3 card for the creator', null, jsonb_build_array(jsonb_build_object('kind', 'creator', 'id', pg_temp.id('cr'))));
  if v like 'ERR:%' then raise exception 'creator card refused: %', v; end if;
  v := pg_temp.add('crsub', 'W3 subtask for the creator', 'crcard');
  v := pg_temp.add('other', 'W3 card for nobody');
  v := pg_temp.log('seth', 'cr', jsonb_build_object('kind', 'touch', 'channel', 'phone', 'direction', 'outbound', 'outcome', 'call_back',
         'work_card_id', pg_temp.id('other')));
  if v like 'ERR:%' then raise exception 'creator call refused: %', v; end if;
  v := pg_temp.add('old', 'W3 old card for the creator', null, jsonb_build_array(jsonb_build_object('kind', 'creator', 'id', pg_temp.id('cr'))));
  -- a fixture closed long ago (the review guard is a person's path; this is history)
  set local session_replication_role = replica;
  update public.ops_work_cards set status = 'done', closed_at = now() - interval '20 days', closed_by = 'seth.w34571@test.local', close_kind = 'done' where id = pg_temp.id('old');
  set local session_replication_role = origin;
  v := pg_temp.call_as('tao', format('select public.crm_record_work(%L::uuid)::text', pg_temp.id('cr')));
  perform pg_temp.chk('WORK', 'a creator card lists its Work: the card, its subtask and a card its call is linked to',
    (select string_agg(c->>'title' || coalesce(' <' || (c->>'parent_number' is not null)::text, ''), '|' order by c->>'title') from jsonb_array_elements((v::jsonb)->'cards') c),
    'W3 card for nobody <false|W3 card for the creator <false|W3 subtask for the creator <true');
  perform pg_temp.chk('WORK', 'a card closed 20 days ago is not listed; the open count is 3', (v::jsonb)->>'open_count', '3');
  perform pg_temp.chk('WORK', 'people are names only, never an address', (((v::jsonb)->'cards')::text ~ '@')::text, 'false');
  perform pg_temp.chk('WORK', 'open_work on the card follows the same rule',
    (select public.crm_record_json(r)->>'open_work' from public.crm_records r where r.id = pg_temp.id('cr')), '3');
  v := pg_temp.call_as('tao', format('select public.crm_record_work(%L::uuid)::text', pg_temp.id('pc')));
  perform pg_temp.chk('WORK', 'a host with no Work has an empty list', ((v::jsonb)->'cards')::text || '/' || ((v::jsonb)->>'open_count'), '[]/0');
  v := pg_temp.agent('tao', format('select public.crm_record_work(%L::uuid)::text', pg_temp.id('cr')));
  perform pg_temp.chk('WORK', 'an agent may read it', (v not like 'ERR:%')::text, 'true');
end;
$t$;

-- ───────────────────────────── QUEUE ─────────────────────────────
do $t$
declare v text;
begin
  v := pg_temp.call_as('tao', 'select public.crm_calls_queue()::text');
  perform pg_temp.chk('QUEUE', 'Replied and Demo booked first, then Contacted, Prospect; oldest due, then name',
    (select string_agg(r->>'name' || case when (r->>'pinned')::boolean then '*' else '' end, ', ' order by o)
       from jsonb_array_elements((v::jsonb)->'records') with ordinality x(r, o)),
    'Island Vinyl*, Bar Replied*, Demo Lounge*, Aaa Prospect, Palm Court Kitchen');
  perform pg_temp.chk('QUEUE', 'the count matches the list', (v::jsonb)->>'count', '5');
  v := pg_temp.call_as('seth', 'select public.crm_calls_queue()::text');
  perform pg_temp.chk('QUEUE', 'each person sees only their own cards',
    (select string_agg(r->>'name', ', ') from jsonb_array_elements((v::jsonb)->'records') r), 'Seths Own');
  v := pg_temp.call_as('tao', format('select public.crm_calls_queue(%L::date)::text', current_date + 3));
  perform pg_temp.chk('QUEUE', 'a day far from today is not trusted (the person''s day is today)',
    (select count(*)::text from jsonb_array_elements((v::jsonb)->'records') r where r->>'name' = 'Tomorrow Cafe'), '0');
end;
$t$;

-- ───────────────────────────── GRANTS and TIME ─────────────────────────────
do $t$
declare v_fn text;
begin
  foreach v_fn in array array['public.crm_record_set_people(uuid,text[],text[],timestamptz)', 'public.crm_record_work(uuid)',
                              'public.crm_calls_queue(date)', 'public.crm_identifier_set_followers(uuid,integer)'] loop
    perform pg_temp.chk('GRANTS', v_fn || ': signed-in people and the server only',
      has_function_privilege('anon', v_fn, 'EXECUTE')::text || '/' || has_function_privilege('authenticated', v_fn, 'EXECUTE')::text
        || '/' || has_function_privilege('service_role', v_fn, 'EXECUTE')::text, 'false/true/true');
  end loop;
  foreach v_fn in array array['public.crm_4571_people_overlap(uuid,text[],text[])', 'public.crm_notify_watchers(uuid,uuid,text,text,text)',
                              'public.crm_record_work_ids(uuid)'] loop
    perform pg_temp.chk('GRANTS', v_fn || ': internal, the server only',
      has_function_privilege('anon', v_fn, 'EXECUTE')::text || '/' || has_function_privilege('authenticated', v_fn, 'EXECUTE')::text, 'false/false');
  end loop;
  insert into public.book_call_leads (id, booking_key, audience, name, email, venue, icp, social_platform, social_url, call_at) values
    ('45730000-0000-4000-f000-000000000001', 'slot:w3-4571-demo', 'host', 'Ada Obi', 'ada@w3.test', 'Island Vinyl Bar', 'restaurants',
     'instagram', 'https://instagram.com/islandvinyl', '2026-11-24 23:30:00+00');
  perform pg_temp.chk('TIME', 'a booking label ends in its UTC instant, so each reader shows their own time (Lagos reads 25 Nov 00:30)',
    public.ops_link_label('booking', '45730000-0000-4000-f000-000000000001'), 'Demo · Island Vinyl Bar · 2026-11-24T23:30Z');
end;
$t$;

-- ───────────────────────────── CONNECTOR ─────────────────────────────
create function pg_temp.gw(p_key text, p_tool text, p_args jsonb) returns text
language plpgsql as $fn$
declare v_out text;
begin
  perform pg_temp.next_request();
  begin
    set local role service_role;
    execute format('select public.team_agent_call(%L, %L, %L::jsonb, %L)::text',
      encode(sha256(convert_to(p_key, 'UTF8')), 'hex'), p_tool, p_args, 'w34571-test/1.0') into v_out;
    reset role;
    return v_out;
  exception when others then
    reset role;
    return 'ERR:' || sqlstate || ':' || sqlerrm;
  end;
end;
$fn$;
do $t$
declare v text; v_key text;
begin
  v := pg_temp.person('tao', $q$select public.team_agent_key_create('claude')::text$q$);
  if v like 'ERR:%' then raise exception 'key not made: %', v; end if;
  v_key := (v::jsonb)->>'key';
  v := pg_temp.gw(v_key, 'set_owners', jsonb_build_object('items', jsonb_build_array(jsonb_build_object(
         'id', pg_temp.id('pc'), 'owner_emails', jsonb_build_array(pg_temp.email('tao')),
         'watcher_emails', jsonb_build_array(pg_temp.email('kemi'), pg_temp.email('abi'))))));
  perform pg_temp.chk('CONNECTOR', 'set_owners with watcher_emails writes owners and watchers in one step',
    (v::jsonb)->>'ok' || '/' || ((v::jsonb)#>>'{result,results,0,status}') || '/' ||
    (select string_agg(watcher_email, ',' order by watcher_email) from public.crm_record_watchers where record_id = pg_temp.id('pc')),
    'true/updated/abi.w34571@test.local,kemi.w34571@test.local');
  v := pg_temp.gw(v_key, 'set_owners', jsonb_build_object('items', jsonb_build_array(jsonb_build_object(
         'id', pg_temp.id('pc'), 'owner_emails', jsonb_build_array(pg_temp.email('tao'), pg_temp.email('kemi'))))));
  perform pg_temp.lk('CONNECTOR', 'set_owners without watcher_emails keeps the watchers and refuses an owner who watches',
    (v::jsonb)#>>'{result,results,0,error}', '%owner_and_watcher%');
  v := pg_temp.gw(v_key, 'set_owners', jsonb_build_object('items', jsonb_build_array(jsonb_build_object(
         'id', pg_temp.id('pc'), 'owner_emails', jsonb_build_array(pg_temp.email('tao')), 'watcher_emails', 'kemi'))));
  perform pg_temp.lk('CONNECTOR', 'watcher_emails must be a list', v, '%invalid_watchers%');
  v := pg_temp.gw(v_key, 'my_day', '{}'::jsonb);
  perform pg_temp.chk('CONNECTOR', 'my_day carries calls_due, the same count as My calls today',
    (v::jsonb)#>>'{result,calls_due}', (pg_temp.person('tao', 'select public.crm_calls_queue()::text')::jsonb)->>'count');
end;
$t$;

-- ───────────────────────────── FILES ─────────────────────────────
create function pg_temp.as_check(p_who text, p_sql text) returns text
language plpgsql as $fn$
declare v_id uuid; v_email text; v_out text;
begin
  select id, email into strict v_id, v_email from tx_people where who = p_who;
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', v_id::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_id, 'email', v_email, 'role', 'authenticated')::text, true);
  execute p_sql into v_out;
  reset role;
  return v_out;
end;
$fn$;
do $t$
declare v text; v_img uuid; v_path text; v_link uuid; i int;
begin
  v := pg_temp.person('tao', format($q$select public.ops_record_file_add(%L::uuid, '{"kind":"image","name":"Island menu.png","mime":"image/png","size_bytes":2048}'::jsonb, %L)::text$q$, pg_temp.id('iv'), pg_temp.rk()));
  v_img := ((v::jsonb)#>>'{file,id}')::uuid; v_path := (v::jsonb)#>>'{upload,path}';
  perform pg_temp.chk('FILES', 'a picture goes to the Work card bucket, under the record, with the same 25 MB cap',
    ((v::jsonb)#>>'{upload,bucket}') || '|' || (v_path like pg_temp.id('iv')::text || '/' || v_img::text || '/Island_menu.png')::text
      || '|' || ((v::jsonb)#>>'{upload,max_bytes}') || '|' || ((v::jsonb)#>>'{file,record_id}'),
    'ops-work-files|true|26214400|' || pg_temp.id('iv')::text);
  perform pg_temp.chk('FILES', 'the row lives in ops_work_files with no card',
    (select coalesce(card_id::text, 'none') || '/' || record_id::text from public.ops_work_files where id = v_img), 'none/' || pg_temp.id('iv')::text);
  perform pg_temp.chk('FILES', 'the bucket takes that path from the person who added it',
    pg_temp.as_check('tao', format('select public.ops_file_can_upload(%L)::text', v_path)), 'true');
  perform pg_temp.chk('FILES', 'and from nobody else', pg_temp.as_check('kemi', format('select public.ops_file_can_upload(%L)::text', v_path)), 'false');
  perform pg_temp.chk('FILES', 'an upload not yet there is not listed on the card',
    (select jsonb_array_length((pg_temp.person('tao', format('select public.crm_record_get(%L::uuid)::text', pg_temp.id('iv')))::jsonb)->'files'))::text, '0');
  insert into storage.objects (bucket_id, name) values ('ops-work-files', v_path);
  perform pg_temp.chk('FILES', 'once uploaded the card lists it and any teammate may read it',
    (select string_agg(f->>'name', ',') from jsonb_array_elements((pg_temp.person('tao', format('select public.crm_record_get(%L::uuid)::text', pg_temp.id('iv')))::jsonb)->'files') f)
      || '|' || pg_temp.as_check('kemi', format('select public.ops_file_can_read(%L)::text', v_path)), 'Island menu.png|true');
  v := pg_temp.person('kemi', format('select public.ops_file_sign(%L::uuid)::text', v_img));
  perform pg_temp.chk('FILES', 'it opens through a 5-minute signed link', ((v::jsonb)->>'bucket') || '|' || ((v::jsonb)->>'expires_in'), 'ops-work-files|300');
  v := pg_temp.person('tao', format($q$select public.ops_record_file_add(%L::uuid, '{"kind":"document","name":"Deck.pdf","mime":"application/pdf","size_bytes":26214401}'::jsonb, %L)::text$q$, pg_temp.id('iv'), pg_temp.rk()));
  perform pg_temp.lk('FILES', 'over 25 MB is refused as on a Work card', v, 'ERR:22023:file_too_big:%');
  v := pg_temp.person('tao', format($q$select public.ops_record_file_add(%L::uuid, '{"kind":"document","name":"Run.exe","mime":"application/x-msdownload","size_bytes":10}'::jsonb, %L)::text$q$, pg_temp.id('iv'), pg_temp.rk()));
  perform pg_temp.lk('FILES', 'a type a Work card refuses is refused', v, 'ERR:22023:invalid_file: Documents can be%');
  v := pg_temp.person('tao', format($q$select public.ops_record_file_add(%L::uuid, '{"kind":"link","url":"https://drive.example/folder"}'::jsonb, %L)::text$q$, pg_temp.id('iv'), pg_temp.rk()));
  v_link := ((v::jsonb)#>>'{file,id}')::uuid;
  perform pg_temp.chk('FILES', 'a link is stored with no upload', ((v::jsonb)->'upload')::text, 'null');
  v := pg_temp.agent('abi', format($q$select public.ops_record_file_add(%L::uuid, '{"kind":"link","url":"https://x.example/a"}'::jsonb, %L)::text$q$, pg_temp.id('iv'), pg_temp.rk()));
  perform pg_temp.lk('FILES', 'an agent cannot add a file to a card its person neither owns nor watches', v, 'ERR:42501:not_your_card:%');
  v := pg_temp.person('abi', format('select public.ops_file_archive(%L::uuid)::text', v_link));
  perform pg_temp.chk('FILES', 'an admin may remove it', (v::jsonb)->>'changed', 'true');
  v := pg_temp.person('kemi', format('select public.ops_file_archive(%L::uuid)::text', v_img));
  perform pg_temp.lk('FILES', 'a watcher who did not add it may not', v, 'ERR:42501:forbidden:%');
  -- the picture plus 49 links: 50 live files (the removed link does not count)
  for i in 1..49 loop
    insert into public.ops_work_files (record_id, kind, name, url, added_by) values (pg_temp.id('iv'), 'link', 'L' || i, 'https://x.example/' || i, 'tao.w34571@test.local');
  end loop;
  v := pg_temp.person('tao', format($q$select public.ops_record_file_add(%L::uuid, '{"kind":"link","url":"https://x.example/over"}'::jsonb, %L)::text$q$, pg_temp.id('iv'), pg_temp.rk()));
  perform pg_temp.lk('FILES', 'a record holds 50 files, as a card does', v, 'ERR:22023:too_many_files:%');
  begin
    insert into public.ops_work_files (card_id, record_id, kind, name, url, added_by)
    values ((select id from public.ops_work_cards limit 1), pg_temp.id('iv'), 'link', 'Both', 'https://x.example/both', 'tao.w34571@test.local');
    perform pg_temp.chk('FILES', 'a file is on a card or a record, never both', 'stored', 'refused');
  exception when check_violation then
    perform pg_temp.chk('FILES', 'a file is on a card or a record, never both', 'refused', 'refused');
  end;
  update public.crm_records set deleted_at = now(), deleted_by = 'seth.w34571@test.local' where id = pg_temp.id('iv');
  perform pg_temp.chk('FILES', 'a deleted record''s files stop being served', pg_temp.as_check('kemi', format('select public.ops_file_can_read(%L)::text', v_path)), 'false');
  update public.crm_records set deleted_at = null, deleted_by = null where id = pg_temp.id('iv');
  perform pg_temp.chk('FILES', 'no client may touch the table directly',
    (has_table_privilege('authenticated', 'public.ops_work_files', 'SELECT') or has_table_privilege('anon', 'public.ops_work_files', 'INSERT'))::text, 'false');
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
  if v_all < 40 then raise exception '#4571 W3 implementor recorded only % checks', v_all; end if;
  if v_fail > 0 then raise exception '#4571 W3 implementor: % of % checks failed', v_fail, v_all; end if;
  raise notice '#4571 W3 implementor: % of % checks passed', v_all, v_all;
end;
$r$;

rollback;
