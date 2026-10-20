-- Issue #3980 synced program, fixes from the full proof pass, on the fully
-- replayed PG17 schema.
--
-- What it proves (each check is recorded and reported together):
--   P1-2  when the sync token is refused a status post, exactly one
--         "The sync token cannot post commit statuses" card is made (its
--         key has the auto_key shape), a second run makes no second card,
--         an hour without a new refusal does not close it, and the next
--         successful status post closes it
--   P2-2  a promised event changes to weekly in place (same row, the same
--         id, never cancelled) and a venue's promo moment can be saved
--   P2-3  the rolling card of a repeating host names the series' next date
--         that is not live, with that date's plain state, never the
--         series' first date or a live date
--   P2-4  a host card's first owner also owns the automatic cards for that
--         host that have no owner; a card someone owns is never taken, and
--         another host's cards are left alone
--   P2-5  a host or creator card that has owners keeps at least one
--         (refused in plain words); a card with none can still be saved
--         with none
--   P3-4  "What just happened" on a host card says a brand link once
--   P3-5  closing a "Feature Guide: ... is Live" card tells nobody again
--
-- Run from the repository root as supabase_admin. Everything is rolled back.

\set ON_ERROR_STOP on
begin;

alter table auth.users add column if not exists email_confirmed_at timestamptz;
alter table auth.users add column if not exists phone text;
alter table auth.users add column if not exists banned_until timestamptz;
alter table auth.users add column if not exists deleted_at timestamptz;
create table if not exists auth.identities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  provider text not null,
  identity_data jsonb
);
create schema if not exists supabase_migrations;
create table if not exists supabase_migrations.schema_migrations (version text primary key);

create temp table t3980pf_people (who text primary key, id uuid not null, email text not null) on commit drop;
insert into t3980pf_people (who, id, email) values
  ('owner',   '39930000-0000-4000-a000-000000000001', 'ed.pf3980@test.local'),
  ('growth',  '39930000-0000-4000-a000-000000000003', 'ada.pf3980@test.local'),
  ('growth2', '39930000-0000-4000-a000-000000000004', 'bo.pf3980@test.local');
insert into auth.users (id, email, email_confirmed_at) select id, email, now() from t3980pf_people;
insert into public.admin_users (email, role, status, accepted_at) values
  ('ed.pf3980@test.local', 'owner', 'active', now());
insert into public.admin_team_members (email, role, status, accepted_at) values
  ('ada.pf3980@test.local', 'growth', 'active', now()),
  ('bo.pf3980@test.local', 'growth', 'active', now());

create temp table t3980pf_results (seq serial primary key, test text, label text, ok boolean, detail text) on commit drop;

create function pg_temp.pf_as(p_who text, p_sql text) returns text
language plpgsql as $fn$
declare v_id uuid; v_email text; v_out text;
begin
  if p_who <> 'service' then
    select id, email into strict v_id, v_email from t3980pf_people where who = p_who;
  end if;
  begin
    if p_who = 'service' then
      set local role service_role;
      perform set_config('request.jwt.claim.sub', '', true);
      perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
    else
      set local role authenticated;
      perform set_config('request.jwt.claim.sub', v_id::text, true);
      perform set_config('request.jwt.claim.email', v_email, true);
      perform set_config('request.jwt.claims', json_build_object('sub', v_id, 'email', v_email, 'role', 'authenticated')::text, true);
    end if;
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

-- A person in a browser session: earlier agent request rows belong to a
-- finished request.
create function pg_temp.pf_person(p_who text, p_sql text) returns text
language plpgsql as $fn$
begin
  update public.team_agent_calls set xact_id = '3'::xid8, started_at = started_at - interval '5 minutes' where xact_id <> '3'::xid8;
  return pg_temp.pf_as(p_who, p_sql);
end;
$fn$;

create function pg_temp.pf_check(p_test text, p_label text, p_got text, p_want text) returns void
language plpgsql as $fn$
begin
  insert into t3980pf_results (test, label, ok, detail)
  values (p_test, p_label, p_got is not distinct from p_want,
          format('got %s, want %s', coalesce(left(p_got, 600), '<null>'), coalesce(p_want, '<null>')));
end;
$fn$;

create function pg_temp.pf_like(p_test text, p_label text, p_got text, p_pattern text) returns void
language plpgsql as $fn$
begin
  insert into t3980pf_results (test, label, ok, detail)
  values (p_test, p_label, coalesce(p_got like p_pattern, false),
          format('got %s, want like %s', coalesce(left(p_got, 600), '<null>'), p_pattern));
end;
$fn$;

create function pg_temp.pf_j(p text) returns jsonb
language plpgsql as $fn$
begin
  return p::jsonb;
exception when others then
  return jsonb_build_object('unreadable', left(p, 300));
end;
$fn$;

create function pg_temp.pf_today() returns date language sql as $fn$ select (now() AT TIME ZONE 'UTC')::date $fn$;

-- The owners of a card, as a sorted comma list ('-' for none).
create function pg_temp.pf_owners(p_card uuid) returns text
language sql as $fn$
  select coalesce(string_agg(p.email, ',' order by p.email), '-') from public.ops_work_people p where p.card_id = p_card and p.role = 'owner'
$fn$;

create function pg_temp.pf_card(p_key text) returns public.ops_work_cards
language sql as $fn$ select w.* from public.ops_work_cards w where w.auto_key = p_key order by w.number desc limit 1 $fn$;

-- ---------------------------------------------------------------------------
-- P1-2: the status-token card is made once and closes after a good post.
-- ---------------------------------------------------------------------------
insert into public.ops_release_records (pr, title, pr_url, merged_at, merge_sha, deploy_marker)
values (88001, 'PF status record', 'https://github.com/Mingla-LLC/mingla-main/pull/88001', now() - interval '3 days', repeat('a', 40), false);

do $p12$
declare v text; c public.ops_work_cards;
begin
  v := pg_temp.pf_as('service', 'select public.ops_release_status_refused()::text');
  perform pg_temp.pf_check('P1-2', 'the bridge records that the status post was refused', coalesce(nullif(v, ''), 'ok'), 'ok');
  v := pg_temp.pf_as('service', 'select public.ops_engineering_cards_sync()::text');
  perform pg_temp.pf_check('P1-2', 'the run makes the card (no refusal of its key)', pg_temp.pf_j(v)->>'added', '1');
  c := pg_temp.pf_card('eng_status_token:sync');
  perform pg_temp.pf_check('P1-2', 'exactly one open "The sync token cannot post commit statuses" card, for the owner',
    (select count(*) from public.ops_work_cards w where w.auto_key like 'eng\_status\_token%' and w.status <> 'done')::text
      || '/' || coalesce(c.title, '-') || '/' || pg_temp.pf_owners(c.id),
    '1/The sync token cannot post commit statuses/ed.pf3980@test.local');
  perform pg_temp.pf_check('P1-2', 'its key has the automatic-card shape', (c.auto_key ~ '^[a-z_]+:[A-Za-z0-9:_-]{1,120}$')::text, 'true');
  v := pg_temp.pf_as('service', 'select public.ops_engineering_cards_sync()::text');
  perform pg_temp.pf_check('P1-2', 'a second run makes no second card',
    (select count(*) from public.ops_work_cards w where w.auto_key like 'eng\_status\_token%')::text, '1');
  -- An hour later, no new refusal (no status was due) and no good post yet.
  -- (The agent log is append-only; the fixture moves the refusal back in
  -- time with triggers off, as if two hours had passed.)
  set local session_replication_role = replica;
  update public.ops_agent_log set at = at - interval '2 hours' where action = 'release_record' and detail ? 'status_refused';
  set local session_replication_role = origin;
  v := pg_temp.pf_as('service', 'select public.ops_engineering_cards_sync()::text');
  perform pg_temp.pf_check('P1-2', 'an hour without a new refusal does not close it: no status has been posted yet',
    (select status from public.ops_work_cards where id = c.id), 'todo');
  -- The next status post succeeds.
  v := pg_temp.pf_as('service', $q$select public.ops_release_status_posted(88001, 'success')::text$q$);
  v := pg_temp.pf_as('service', 'select public.ops_engineering_cards_sync()::text');
  perform pg_temp.pf_check('P1-2', 'the next successful post closes it, in words',
    (select status || '/' || close_kind || '/' || close_reason from public.ops_work_cards where id = c.id),
    'done/system/A migrations status was posted.');
end;
$p12$;

-- ---------------------------------------------------------------------------
-- Fixtures for P2-2, P2-3, P2-4 and P2-5.
-- ---------------------------------------------------------------------------
set local session_replication_role = replica;
insert into public.brands (id, account_id, name, slug, city) values
  ('39930000-0000-4000-b100-000000000001', '39930000-0000-4000-b300-000000000001', 'PF Supper Brand', 'pf-supper-brand', 'Lagos');
insert into public.events (id, brand_id, title, slug, visibility, status, timezone, published_at, event_type) values
  ('39930000-0000-4000-b400-000000000001', '39930000-0000-4000-b100-000000000001', 'PF Supper Club live', 'pf-supper-club-live', 'discover', 'scheduled', 'UTC', now() - interval '20 days', 'event');
insert into public.event_dates (event_id, start_at, end_at, is_master) values
  ('39930000-0000-4000-b400-000000000001', date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' + interval '3 days 20 hours',
   date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' + interval '3 days 23 hours', true);
set local session_replication_role = origin;

insert into public.crm_records (id, pipeline, name, stage, icp, brand_id, created_by, updated_by) values
  ('39930000-0000-4000-c100-000000000001', 'hosts', 'PF Supper Host', 'onboarded', 'event_organizer', '39930000-0000-4000-b100-000000000001', 'pf', 'pf'),
  ('39930000-0000-4000-c100-000000000002', 'hosts', 'PF New Host', 'onboarded', 'event_organizer', null, 'pf', 'pf'),
  ('39930000-0000-4000-c100-000000000003', 'hosts', 'PF Other Host', 'onboarded', 'event_organizer', null, 'pf', 'pf'),
  ('39930000-0000-4000-c100-000000000004', 'hosts', 'PF Owned Host', 'contacted', 'event_organizer', null, 'pf', 'pf'),
  ('39930000-0000-4000-c100-000000000005', 'creators', 'PF Owned Creator', 'identified', null, null, 'pf', 'pf'),
  ('39930000-0000-4000-c100-000000000006', 'hosts', 'PF Venue Host', 'onboarded', 'restaurant_bar', null, 'pf', 'pf');
insert into public.crm_record_owners (record_id, owner_email, added_by) values
  ('39930000-0000-4000-c100-000000000001', 'ada.pf3980@test.local', 'pf'),
  ('39930000-0000-4000-c100-000000000004', 'ada.pf3980@test.local', 'pf'),
  ('39930000-0000-4000-c100-000000000005', 'ada.pf3980@test.local', 'pf'),
  ('39930000-0000-4000-c100-000000000006', 'ada.pf3980@test.local', 'pf');
-- Supper: a weekly series that started four days ago. Its date in three days
-- is live (the public event above); the date after is not.
insert into public.ops_expected_events (id, record_id, title, event_type, expected_on, repeats, created_by, updated_by) values
  ('39930000-0000-4000-d100-000000000001', '39930000-0000-4000-c100-000000000001', 'PF Supper Club', 'event', (now() AT TIME ZONE 'UTC')::date - 4, 'week', 'pf', 'pf'),
  ('39930000-0000-4000-d100-000000000002', '39930000-0000-4000-c100-000000000002', 'PF Launch Night', 'event', (now() AT TIME ZONE 'UTC')::date + 40, 'none', 'pf', 'pf');
update public.ops_settings set value = 'true'::jsonb where key = 'auto_steps';

-- ---------------------------------------------------------------------------
-- P2-3: the rolling card names the next date that is not live.
-- ---------------------------------------------------------------------------
do $p23$
declare c public.ops_work_cards; a jsonb;
begin
  perform public.ops_auto_steps(null, null);
  c := pg_temp.pf_card('series:39930000-0000-4000-d100-000000000001');
  perform pg_temp.pf_check('P2-3', 'the repeating host has its one rolling card', c.status, 'todo');
  a := public.ops_card_json(c, pg_temp.pf_today())->'anchor';
  perform pg_temp.pf_check('P2-3', 'the card is counted from the series',
    (a->>'kind') || '/' || (a->>'title'), 'expected/PF Supper Club');
  perform pg_temp.pf_check('P2-3', 'it names the next date that is not live (ten days out), not the first date or the live one',
    a->>'start_on', (pg_temp.pf_today() + 10)::text);
  perform pg_temp.pf_check('P2-3', 'and says it is a series with that date''s own plain state',
    (a->>'series') || '/' || (a->'state'->>'k') || '/' || (a->'state'->>'name'), 'true/late/Too late for promo');
  perform pg_temp.pf_check('P2-3', 'its runway is counted from that date too',
    (a->'runway'->>'start_on'), (pg_temp.pf_today() + 10)::text);
  -- A one-off promised event is shown as before.
  c := pg_temp.pf_card('golive:expected:39930000-0000-4000-d100-000000000002');
  a := public.ops_card_json(c, pg_temp.pf_today())->'anchor';
  perform pg_temp.pf_check('P2-3', 'a one-off promised event keeps its own date and no series mark',
    (a->>'start_on') || '/' || coalesce(a->>'series', 'none'), (pg_temp.pf_today() + 40)::text || '/none');
end;
$p23$;

-- ---------------------------------------------------------------------------
-- P2-4: the first owner of a host also owns its ownerless automatic cards.
-- ---------------------------------------------------------------------------
do $p24$
declare v text; c_ask public.ops_work_cards; c_go public.ops_work_cards; c_other public.ops_work_cards;
begin
  -- PF New Host has no owner: its go-live card is ownerless. PF Other Host
  -- (no owner, nothing upcoming) has an ownerless "Ask ..." card.
  c_go := pg_temp.pf_card('golive:expected:39930000-0000-4000-d100-000000000002');
  c_other := pg_temp.pf_card('ask:39930000-0000-4000-c100-000000000003');
  perform pg_temp.pf_check('P2-4', 'before: both automatic cards have no owner',
    pg_temp.pf_owners(c_go.id) || '|' || pg_temp.pf_owners(c_other.id), '-|-');
  -- A second automatic card for PF New Host already owned by someone.
  perform public.ops_auto_card_upsert('ask:39930000-0000-4000-c100-000000000002', jsonb_build_object(
    'title', 'Ask PF New Host for their next event and date', 'instructions', 'Set it on their host card.',
    'done_means', 'A next event is set.', 'owners', jsonb_build_array('bo.pf3980@test.local'), 'watchers', '[]'::jsonb,
    'due_on', pg_temp.pf_today() + 3, 'links', jsonb_build_array(jsonb_build_object('kind', 'host', 'id', '39930000-0000-4000-c100-000000000002'))),
    'task', null);
  c_ask := pg_temp.pf_card('ask:39930000-0000-4000-c100-000000000002');
  perform pg_temp.pf_check('P2-4', 'before: the go-live card shows under Needs attention > No owner',
    (select count(*) from jsonb_array_elements(pg_temp.pf_j(pg_temp.pf_person('growth', 'select public.ops_attention(null)::text'))->'groups'->'noowner') i
      where i->>'id' = c_go.id::text)::text, '1');
  -- Ada takes the host card (Assign to me).
  v := pg_temp.pf_person('growth', format('select public.crm_record_set_owners(%L, %L::text[])::text',
         '39930000-0000-4000-c100-000000000002', array['ada.pf3980@test.local']));
  perform pg_temp.pf_check('P2-4', 'Assign to me on the host card saves', pg_temp.pf_j(v)->>'changed', 'true');
  perform pg_temp.pf_check('P2-4', 'the ownerless go-live card for that host is now Ada''s too', pg_temp.pf_owners(c_go.id), 'ada.pf3980@test.local');
  perform pg_temp.pf_check('P2-4', 'a card someone already owns is never taken from them', pg_temp.pf_owners(c_ask.id), 'bo.pf3980@test.local');
  perform pg_temp.pf_check('P2-4', 'another host''s ownerless card is left alone', pg_temp.pf_owners(c_other.id), '-');
  perform pg_temp.pf_check('P2-4', 'the card''s history says who owns it and why',
    (select count(*) from public.ops_work_events e where e.card_id = c_go.id and e.action = 'people' and e.body like 'Owned by % with the host card PF New Host.')::text, '1');
  perform pg_temp.pf_check('P2-4', 'it shows no longer under Needs attention > No owner',
    (select count(*) from jsonb_array_elements(pg_temp.pf_j(pg_temp.pf_person('growth', 'select public.ops_attention(null)::text'))->'groups'->'noowner') i
      where i->>'id' = c_go.id::text)::text, '0');
  -- Adding a second owner later adopts nothing new (only a first owner does).
  delete from public.ops_work_people where card_id = c_go.id;
  v := pg_temp.pf_person('growth', format('select public.crm_record_set_owners(%L, %L::text[])::text',
         '39930000-0000-4000-c100-000000000002', array['ada.pf3980@test.local', 'bo.pf3980@test.local']));
  perform pg_temp.pf_check('P2-4', 'a second owner added later changes no card', pg_temp.pf_owners(c_go.id), '-');
end;
$p24$;

-- ---------------------------------------------------------------------------
-- P2-5: the last owner of a host or creator card stays.
-- ---------------------------------------------------------------------------
do $p25$
declare v text;
begin
  v := pg_temp.pf_person('growth', format('select public.crm_record_set_owners(%L, %L::text[])::text', '39930000-0000-4000-c100-000000000004', '{}'::text[]));
  perform pg_temp.pf_check('P2-5', 'removing a host card''s last owner is refused in plain words', v,
    'ERR:22023:last_owner: A card always keeps one owner. Add someone else first, then remove this one.');
  v := pg_temp.pf_person('owner', format('select public.crm_record_set_owners(%L, %L::text[])::text', '39930000-0000-4000-c100-000000000005', '{}'::text[]));
  perform pg_temp.pf_like('P2-5', 'removing a creator card''s last owner is refused too, for the owner as well', v, 'ERR:22023:last_owner:%');
  perform pg_temp.pf_check('P2-5', 'and nothing changed',
    (select string_agg(owner_email, ',' order by owner_email) from public.crm_record_owners
      where record_id in ('39930000-0000-4000-c100-000000000004', '39930000-0000-4000-c100-000000000005')),
    'ada.pf3980@test.local,ada.pf3980@test.local');
  v := pg_temp.pf_person('growth', format('select public.crm_record_set_owners(%L, %L::text[])::text', '39930000-0000-4000-c100-000000000004',
         array['bo.pf3980@test.local']));
  perform pg_temp.pf_check('P2-5', 'swapping the owner for another person still works', pg_temp.pf_j(v)->>'changed', 'true');
  v := pg_temp.pf_person('growth', format('select public.crm_record_set_owners(%L, %L::text[])::text', '39930000-0000-4000-c100-000000000003', '{}'::text[]));
  perform pg_temp.pf_check('P2-5', 'a card with no owner can still be saved with none', pg_temp.pf_j(v)->>'changed', 'false');
end;
$p25$;

-- ---------------------------------------------------------------------------
-- P2-2: a promised event becomes weekly in place; a promo moment saves.
-- ---------------------------------------------------------------------------
do $p22$
declare v text; v_rev bigint;
begin
  select revision into v_rev from public.ops_expected_events where id = '39930000-0000-4000-d100-000000000002';
  v := pg_temp.pf_person('growth', format('select public.ops_expected_event_set(%L::jsonb, %L)::text',
         jsonb_build_object('record_id', '39930000-0000-4000-c100-000000000002', 'id', '39930000-0000-4000-d100-000000000002', 'repeats', 'week'),
         'pf-repeat-0001'));
  perform pg_temp.pf_check('P2-2', 'a promised one-off event changes to weekly in place',
    (select status || '/' || repeats || '/' || (revision - v_rev)::text from public.ops_expected_events where id = '39930000-0000-4000-d100-000000000002'),
    'open/week/1');
  perform pg_temp.pf_check('P2-2', 'never cancelled and added again: still one promised event on the card',
    (select count(*) from public.ops_expected_events where record_id = '39930000-0000-4000-c100-000000000002')::text, '1');
  v := pg_temp.pf_person('growth', format('select public.ops_expected_event_set(%L::jsonb, %L)::text',
         jsonb_build_object('record_id', '39930000-0000-4000-c100-000000000006', 'title', 'PF Detty December menu',
                            'event_type', 'promo_moment', 'expected_on', pg_temp.pf_today() + 45, 'repeats', 'none'), 'pf-moment-0001'));
  perform pg_temp.pf_check('P2-2', 'a venue''s promo moment is saved',
    (select event_type from public.ops_expected_events where record_id = '39930000-0000-4000-c100-000000000006'), 'promo_moment');
  v := pg_temp.pf_person('growth', format('select public.ops_expected_event_set(%L::jsonb, %L)::text',
         jsonb_build_object('record_id', '39930000-0000-4000-c100-000000000002', 'id', '39930000-0000-4000-d100-000000000002', 'repeats', 'fortnight'),
         'pf-repeat-0002'));
  perform pg_temp.pf_like('P2-2', 'an unknown repeat is refused with the same words as the person''s save', v, '%Repeats must be none, week or month.%');
end;
$p22$;

-- ---------------------------------------------------------------------------
-- P3-4 and P3-5.
-- ---------------------------------------------------------------------------
do $p3$
declare v text; v_res jsonb;
begin
  perform public.ops_log_write('system@usemingla.com', 'system', 'brand_linked', 'info', NULL, 'crm_record', '39930000-0000-4000-c100-000000000004',
    'Brand PF Brand linked by itself to PF Owned Host: same email.', '{}'::jsonb);
  insert into public.crm_activity (record_id, kind, actor_email, via, body)
  values ('39930000-0000-4000-c100-000000000004', 'note', null, 'system', 'Brand PF Brand linked by itself: same email as this card.');
  v := pg_temp.pf_person('growth', format($q$select public.ops_recent_changes('host', %L, 72)::text$q$, '39930000-0000-4000-c100-000000000004'));
  perform pg_temp.pf_check('P3-4', 'What just happened says the brand link once',
    (select count(*) from jsonb_array_elements(pg_temp.pf_j(v)->'items') i where i->>'words' like 'Brand PF Brand linked by itself%')::text, '1');

  v_res := public.ops_auto_card_upsert('guide_live:pf-entry:pr-88001', jsonb_build_object(
    'title', 'Feature Guide: PF entry is Live', 'instructions', 'PF entry turned Live in the Feature Guide.',
    'done_means', 'Support knows the entry is Live.', 'owners', jsonb_build_array('ed.pf3980@test.local'),
    'watchers', jsonb_build_array('ada.pf3980@test.local'), 'due_on', pg_temp.pf_today()), 'task', null);
  perform public.ops_auto_card_close((v_res->>'id')::uuid, 'PF entry is Live in the Feature Guide.', '[]'::jsonb);
  perform pg_temp.pf_check('P3-5', 'Support is told once that an entry is Live: added yes, closed never',
    (select count(*) filter (where m.body_excerpt like 'Mingla added:%')::text || '/' || count(*) filter (where m.body_excerpt like 'Mingla closed:%')::text
       from public.team_mentions m join public.ops_work_events e on e.id = m.source_id
      where m.source_kind = 'work_card' and e.card_id = (v_res->>'id')::uuid and m.target_user_id = '39930000-0000-4000-a000-000000000003'),
    '1/0');
end;
$p3$;

-- ---------------------------------------------------------------------------
-- Report.
-- ---------------------------------------------------------------------------
do $report$
declare r record; v_fail integer := 0; v_total integer := 0;
begin
  for r in select * from t3980pf_results order by seq loop
    v_total := v_total + 1;
    if r.ok then raise notice 'PASS [%] %', r.test, r.label;
    else v_fail := v_fail + 1; raise warning 'FAIL [%] % -- %', r.test, r.label, r.detail; end if;
  end loop;
  if v_total = 0 then raise exception 'issue 3980 proof fixes: no checks ran'; end if;
  if v_fail > 0 then raise exception 'issue 3980 proof fixes: % of % checks failed', v_fail, v_total; end if;
  raise notice 'issue 3980 proof fixes: all % checks passed', v_total;
end;
$report$;

rollback;
