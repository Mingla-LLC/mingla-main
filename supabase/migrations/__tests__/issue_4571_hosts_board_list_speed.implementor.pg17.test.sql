-- Issue #4571: the Hosts board loads in one pass --
-- implementor suite for 20281202174571_issue_4571_hosts_board_list_speed.sql
-- on the fully replayed PG17 schema. Everything is rolled back.
--
-- INVARIANT crm-board-json-matches-card-json | gate crm_4571_records_json (crm_records_list, crm_records_archived_list) | test this file
--
--   EQUAL    every card crm_records_list and crm_records_archived_list return
--            (about 2,000 host cards and 150 creator cards, with links, calls,
--            demos, brands, events, emails and merges) is identical to
--            crm_record_json(card).
--   COVER    the seed reaches every branch of the card JSON (open work, the
--            demo gate locked and open, needs linking, a cancelled demo, the
--            next demo, suggest-replied, the cadence, a merged card, a brand).
--   WORK     crm_record_work_ids(card) returns exactly the cards the old
--            four-branch OR rule (20281130034571) returns, for every card.
--   SHAPE    truncated, archived_count, total and the order are unchanged;
--            archived cards are not on the board (crm-archived-not-on-board).
--   AUTH     a signed-in person outside the team is refused.
--   SPEED    crm_records_list('hosts') for about 1,900 live host cards, as a
--            signed-in teammate, finishes in under 4 s (production's
--            statement timeout is 8 s; it took about 0.2 s locally, against
--            7.9 s for the per-card crm_record_json path it replaces).
--
-- FAILS-ON-REVERT: without 20281202174571, SPEED fails (about 8 s locally).
--
-- Run from the repository root as supabase_admin.


\set ON_ERROR_STOP on
begin;

alter table auth.users add column if not exists email_confirmed_at timestamptz;
alter table auth.users add column if not exists banned_until timestamptz;

create temp table tx_people (who text primary key, id uuid not null, email text not null) on commit drop;
insert into tx_people (who, id, email) values
  ('seth', '45710000-0000-4000-d000-000000000001', 'seth.s4571@test.local'),
  ('tao',  '45710000-0000-4000-d000-000000000002', 'speed.owner@test.local'),
  ('kim',  '45710000-0000-4000-d000-000000000003', 'kim.s4571@test.local');
insert into auth.users (id, email, email_confirmed_at) select id, email, now() from tx_people;
insert into public.admin_users (email, role, status, accepted_at) values ('seth.s4571@test.local', 'owner', 'active', now());
insert into public.admin_team_members (email, role, status, accepted_at) values ('speed.owner@test.local', 'growth', 'active', now());

create temp table tx_results (seq serial primary key, test text, label text, ok boolean, detail text) on commit drop;
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
create function pg_temp.chk(p_test text, p_label text, p_got text, p_want text) returns void
language sql as $fn$
  insert into tx_results (test, label, ok, detail)
  values (p_test, p_label, p_got is not distinct from p_want,
          format('got %s, want %s', coalesce(left(p_got, 600), '<null>'), coalesce(p_want, '<null>')));
$fn$;
-- The work-card rule before this migration (20281130034571), kept here to
-- prove crm_record_work_ids still returns the same cards.
create function pg_temp.old_work_ids(p_id uuid) returns setof uuid
language sql stable as $fn$
  WITH r AS (SELECT c.id, c.pipeline, c.brand_id FROM public.crm_records c WHERE c.id = p_id),
  recs AS (SELECT x.id FROM public.crm_records x, r
            WHERE x.deleted_at IS NULL AND x.pipeline = r.pipeline
              AND (x.id = r.id OR (r.pipeline = 'hosts' AND r.brand_id IS NOT NULL AND x.brand_id = r.brand_id))
           UNION SELECT r.id FROM r)
  SELECT w.id FROM public.ops_work_cards w, r
   WHERE w.archived_at IS NULL
     AND (EXISTS (SELECT 1 FROM public.ops_work_links l
                   WHERE l.card_id = w.id AND l.kind = CASE r.pipeline WHEN 'hosts' THEN 'host' ELSE 'creator' END
                     AND l.target_id IN (SELECT recs.id FROM recs))
          OR EXISTS (SELECT 1 FROM public.ops_work_links l JOIN public.crm_activity a ON a.id = l.target_id
                      WHERE l.card_id = w.id AND l.kind = 'call' AND a.record_id IN (SELECT recs.id FROM recs))
          OR (r.pipeline = 'hosts' AND w.anchor_kind = 'expected'
              AND w.anchor_id IN (SELECT z.id FROM public.ops_expected_events z WHERE z.record_id IN (SELECT recs.id FROM recs)))
          OR (r.pipeline = 'hosts' AND w.anchor_kind = 'event' AND r.brand_id IS NOT NULL
              AND w.anchor_id IN (SELECT e.id FROM public.events e WHERE e.brand_id = r.brand_id)))
$fn$;

-- ───────────────────────────── seed ─────────────────────────────
-- ~2,000 host cards and 150 creator cards with production-like links.
set local session_replication_role = replica;
create temp table sp_brand on commit drop as
  select gen_random_uuid() as id, g as n from generate_series(1, 60) g;
insert into public.brands (id, account_id, name, slug, city)
  select id, gen_random_uuid(), 'Speed Brand ' || n, 'speed4571-brand-' || n, 'Lagos' from sp_brand;
insert into public.brands (id, account_id, name, slug, city, deleted_at)
  values ('45710000-0000-4000-b000-00000000dead', gen_random_uuid(), 'Speed Deleted Brand', 'speed4571-brand-dead', 'Lagos', now());
create temp table sp_rec on commit drop as
  select gen_random_uuid() as id, g as n,
         case when g <= 2000 then 'hosts' else 'creators' end as pipeline,
         case when g <= 2000 then (array['prospect','contacted','replied','meeting','onboarded','live','prospect','contacted'])[1 + g % 8]
              else (array['identified','contacted'])[1 + g % 2] end as stage
    from generate_series(1, 2150) g;
insert into public.crm_records (id, pipeline, name, stage, created_by, updated_by, created_at, updated_at, brand_id, due_on,
                                demo_rule_exempt_at, archived_at, archived_by, archived_reason)
  select r.id, r.pipeline, 'Speed Card ' || r.n, r.stage, 'speed.owner@test.local', 'speed.owner@test.local',
         now() - (r.n || ' hours')::interval, now() - (r.n || ' minutes')::interval,
         case when r.pipeline = 'hosts' and r.n % 15 = 0 then (select b.id from sp_brand b where b.n = 1 + (r.n / 15) % 60)
              when r.pipeline = 'hosts' and r.n = 1999 then '45710000-0000-4000-b000-00000000dead'::uuid end,
         current_date + (r.n % 9) - 4,
         case when r.n % 37 = 0 then now() - interval '3 days' end,
         case when r.n % 23 = 0 then now() - interval '1 day' end,
         case when r.n % 23 = 0 then 'speed.owner@test.local' end,
         case when r.n % 23 = 0 then 'Duplicate of another card' end
    from sp_rec r;
insert into public.crm_record_owners (record_id, owner_email, added_by)
  select id, 'speed.owner@test.local', 'speed.owner@test.local' from sp_rec where n % 4 <> 0;
insert into public.crm_record_watchers (record_id, watcher_email, added_by)
  select id, 'speed.watch@test.local', 'speed.owner@test.local' from sp_rec where n % 6 = 0;
insert into public.crm_record_identifiers (record_id, kind, value, value_key, created_by)
  select id, 'email', 'speed' || n || '@venue.test', public.crm_ident_key('email', 'speed' || n || '@venue.test'), 'speed.owner@test.local' from sp_rec
  union all
  select id, 'phone', '+23480' || lpad(n::text, 8, '0'), public.crm_ident_key('phone', '+23480' || lpad(n::text, 8, '0')), 'speed.owner@test.local' from sp_rec where n % 2 = 0;
-- Activity: ~5 lines per card (touches out and in, a stage move, a note).
insert into public.crm_activity (record_id, kind, actor_email, channel, direction, occurred_at, created_at, stage_at, from_stage, to_stage, body)
  select r.id, k.kind, 'speed.owner@test.local',
         case when k.kind = 'touch' then (array['phone','email','whatsapp'])[1 + (r.n + k.i) % 3] end,
         case when k.kind = 'touch' then case when k.i = 4 then 'inbound' else 'outbound' end end,
         date '2026-11-23' + ((r.n * 7 + k.i * 13) % 40 || ' hours')::interval,
         date '2026-11-23' + ((r.n * 7 + k.i * 13) % 40 || ' hours')::interval,
         case when r.pipeline = 'hosts' then (array['prospect','contacted'])[1 + k.i % 2] else 'contacted' end,
         case when k.kind = 'stage_move' then 'prospect' end, case when k.kind = 'stage_move' then 'contacted' end,
         case when k.kind = 'note' then 'Speed note ' || r.n end
    from sp_rec r
    cross join lateral (values (1, 'touch'), (2, 'touch'), (3, 'stage_move'), (4, 'touch'), (5, 'note')) k(i, kind)
   where r.n % 5 <> 0 or k.i < 3;
insert into public.crm_email_log (message_id, record_id, matched_address, direction, mailbox, from_address, sent_at, stage_at, logged_by)
  select 'speed-' || n || '-' || d, id, 'speed' || n || '@venue.test', case when d = 3 then 'inbound' else 'outbound' end,
         'hello@usemingla.com', 'speed' || n || '@venue.test', date '2026-11-23' + (d || ' days')::interval + (n % 20 || ' hours')::interval,
         'contacted', 'speed.owner@test.local'
    from sp_rec, generate_series(1, 3) d where n % 7 = 0;
-- Demos: booked, moved, cancelled.
create temp table sp_demo on commit drop as
  select gen_random_uuid() as bid, r.id as rid, r.n from sp_rec r where r.pipeline = 'hosts' and r.n % 11 = 0;
insert into public.book_call_leads (id, booking_key, audience, name, email, venue, icp, social_platform, social_url, call_at, status)
  select bid, 'slot:speed4571-' || n, 'host', 'Speed Booker ' || n, 'booker' || n || '@venue.test', 'Speed Venue ' || n, 'restaurants', 'instagram',
         'https://instagram.com/speed' || n, now() + ((n % 50) - 10 || ' hours')::interval,
         (array['booked','moved','cancelled','declined'])[1 + n % 4]
    from sp_demo;
insert into public.crm_record_demos (booking_id, record_id, link_source) select bid, rid, 'card_link' from sp_demo;
-- Expected events (hosts) and real events (brands).
create temp table sp_exp on commit drop as
  select gen_random_uuid() as id, r.id as rid, r.n from sp_rec r where r.pipeline = 'hosts' and r.n % 40 = 0;
insert into public.ops_expected_events (id, record_id, title, event_type, expected_on, created_by, updated_by)
  select id, rid, 'Speed expected ' || n, 'event', current_date + 10, 'speed.owner@test.local', 'speed.owner@test.local' from sp_exp;
create temp table sp_ev on commit drop as
  select gen_random_uuid() as id, b.id as bid, b.n from sp_brand b;
insert into public.events (id, brand_id, title, slug) select id, bid, 'Speed Event ' || n, 'speed4571-ev-' || n from sp_ev;
-- Work cards: 4,000 (open, done, archived), linked by host/creator link, call link,
-- expected anchor and event anchor, plus unlinked noise.
create temp table sp_card on commit drop as
  select gen_random_uuid() as id, g as n from generate_series(1, 4000) g;
insert into public.ops_work_cards (id, number, title, instructions, done_means, due_on, due_source, sprint_id, status_id,
                                   created_by, updated_by, status, closed_at, closed_by, close_kind,
                                   archived_at, archived_by, archive_reason, anchor_kind, anchor_id, kind)
  overriding system value
  select c.id, 4571000000 + c.n, 'Speed work ' || c.n, 'Do the speed work carefully.', 'The work is done.', current_date, 'explicit',
         gen_random_uuid(), null, 'speed.owner@test.local', 'speed.owner@test.local',
         case when c.n % 5 = 0 then 'done' else 'todo' end,
         case when c.n % 5 = 0 then now() end, case when c.n % 5 = 0 then 'speed.owner@test.local' end, case when c.n % 5 = 0 then 'done' end,
         case when c.n % 17 = 0 then now() end, case when c.n % 17 = 0 then 'speed.owner@test.local' end, case when c.n % 17 = 0 then 'Old card' end,
         case when c.n between 3001 and 3100 then 'expected' when c.n between 3101 and 3300 then 'event' end,
         case when c.n between 3001 and 3100 then (select e.id from sp_exp e where e.n = 40 * (1 + c.n % 50))
              when c.n between 3101 and 3300 then (select v.id from sp_ev v where v.n = 1 + c.n % 60) end,
         case when c.n between 3101 and 3300 then 'promo' else 'task' end
    from sp_card c;
insert into public.ops_work_links (card_id, kind, target_id, label, added_by)
  select c.id, case when r.pipeline = 'hosts' then 'host' else 'creator' end, r.id, r.pipeline, 'speed.owner@test.local'
    from sp_card c join sp_rec r on r.n = 1 + (c.n * 7) % 2150 where c.n <= 1500
  union all
  select c.id, 'call', (select a.id from public.crm_activity a where a.record_id = r.id and a.kind = 'touch' order by a.id limit 1),
         'call', 'speed.owner@test.local'
    from sp_card c join sp_rec r on r.n = 1 + (c.n * 13) % 2150 where c.n between 1501 and 1900 and r.n % 5 <> 0;
-- A few archived cards merged into a live one.
update public.crm_records m set merged_into_id = k.id
  from sp_rec s, sp_rec ks, public.crm_records k
 where m.id = s.id and s.n % 23 = 0 and s.n % 2 = 0 and s.n <= 600
   and ks.n = s.n + 1 and k.id = ks.id;
set local session_replication_role = origin;
analyze public.crm_records; analyze public.crm_activity; analyze public.ops_work_cards; analyze public.ops_work_links;
analyze public.crm_record_demos; analyze public.book_call_leads; analyze public.crm_record_identifiers;
analyze public.crm_record_owners; analyze public.crm_record_watchers; analyze public.crm_email_log;
analyze public.ops_expected_events; analyze public.events; analyze public.brands;

-- ───────────────────────────── tests ─────────────────────────────
create temp table tx_lists (k text primary key, j jsonb, ms numeric) on commit drop;
do $t$
declare v_t0 timestamptz; v_out text;
begin
  v_t0 := clock_timestamp();
  v_out := pg_temp.as_('tao', $q$select public.crm_records_list('hosts')::text$q$);
  insert into tx_lists values ('hosts', case when v_out like 'ERR:%' then to_jsonb(v_out) else v_out::jsonb end,
                               extract(epoch from clock_timestamp() - v_t0) * 1000);
  v_out := pg_temp.as_('tao', $q$select public.crm_records_list('creators')::text$q$);
  insert into tx_lists values ('creators', case when v_out like 'ERR:%' then to_jsonb(v_out) else v_out::jsonb end, null);
  v_out := pg_temp.as_('tao', $q$select public.crm_records_archived_list('hosts')::text$q$);
  insert into tx_lists values ('archived', case when v_out like 'ERR:%' then to_jsonb(v_out) else v_out::jsonb end, null);
end;
$t$;
select format('SPEED crm_records_list(hosts): %s ms for %s cards', round(ms), jsonb_array_length(j->'records')) as timing
  from tx_lists where k = 'hosts';

-- SPEED
select pg_temp.chk('SPEED', 'the hosts list answers (no error)', jsonb_typeof(j), 'object') from tx_lists where k = 'hosts';
select pg_temp.chk('SPEED', 'the hosts list finishes in under 4 s', (ms < 4000)::text, 'true') from tx_lists where k = 'hosts';

-- SHAPE
select pg_temp.chk('SHAPE', 'every live host card is on the board',
  jsonb_array_length(j->'records')::text,
  (select count(*)::text from public.crm_records where pipeline = 'hosts' and deleted_at is null and archived_at is null))
  from tx_lists where k = 'hosts';
select pg_temp.chk('SHAPE', 'no archived card is on the board',
  (select count(*)::text from jsonb_array_elements(j->'records') e where e->>'archived_at' is not null), '0')
  from tx_lists where k = 'hosts';
select pg_temp.chk('SHAPE', 'truncated is false', j->>'truncated', 'false') from tx_lists where k = 'hosts';
select pg_temp.chk('SHAPE', 'archived_count counts archived host cards', j->>'archived_count',
  (select count(*)::text from public.crm_records where pipeline = 'hosts' and deleted_at is null and archived_at is not null))
  from tx_lists where k = 'hosts';
select pg_temp.chk('SHAPE', 'the board keys are pipeline, records, truncated, archived_count',
  (select string_agg(k, ',' order by k) from jsonb_object_keys(j) k), 'archived_count,pipeline,records,truncated')
  from tx_lists where k = 'hosts';
select pg_temp.chk('SHAPE', 'the board is newest-updated first',
  (select string_agg(e->>'id', ',' order by o) from jsonb_array_elements(j->'records') with ordinality x(e, o)),
  (select string_agg(id::text, ',' order by updated_at desc, id) from public.crm_records
    where pipeline = 'hosts' and deleted_at is null and archived_at is null))
  from tx_lists where k = 'hosts';
select pg_temp.chk('SHAPE', 'the archived list has every archived host card, newest archived first',
  (select string_agg(e->>'id', ',' order by o) from jsonb_array_elements(j->'records') with ordinality x(e, o)),
  (select string_agg(id::text, ',' order by archived_at desc, id) from public.crm_records
    where pipeline = 'hosts' and deleted_at is null and archived_at is not null))
  from tx_lists where k = 'archived';
select pg_temp.chk('SHAPE', 'the archived list total and truncated', (j->>'total') || '/' || (j->>'truncated'),
  (select count(*)::text from public.crm_records where pipeline = 'hosts' and deleted_at is null and archived_at is not null) || '/false')
  from tx_lists where k = 'archived';
select pg_temp.chk('SHAPE', 'the creators board has every live creator card', jsonb_array_length(j->'records')::text,
  (select count(*)::text from public.crm_records where pipeline = 'creators' and deleted_at is null and archived_at is null))
  from tx_lists where k = 'creators';

-- EQUAL
select pg_temp.chk('EQUAL', l.k || ': every card equals crm_record_json(card)',
  (select count(*)::text from jsonb_array_elements(l.j->'records') e
     join public.crm_records r on r.id = (e->>'id')::uuid
    where e is distinct from public.crm_record_json(r)), '0')
  from tx_lists l;
select pg_temp.chk('EQUAL', 'all three lists together cover more than 2,000 cards',
  ((select sum(jsonb_array_length(j->'records')) from tx_lists) > 2000)::text, 'true');

-- COVER: the comparison above is not trivial.
create temp table tx_all on commit drop as
  select e from tx_lists l, jsonb_array_elements(l.j->'records') e;
select pg_temp.chk('COVER', 'cards with open work', ((select count(*) from tx_all where (e->>'open_work')::int > 0) > 100)::text, 'true');
select pg_temp.chk('COVER', 'open work through a brand-mate, a call, an expected event and an event',
  ((select count(*) from tx_all where (e->>'open_work')::int > 1) > 10)::text, 'true');
select pg_temp.chk('COVER', 'a locked demo gate', ((select count(*) from tx_all where (e->'demo_gate'->>'locked')::boolean) > 0)::text, 'true');
select pg_temp.chk('COVER', 'an open demo gate on a host below the band',
  ((select count(*) from tx_all where e->>'stage' in ('prospect', 'contacted', 'replied') and not (e->'demo_gate'->>'locked')::boolean) > 0)::text, 'true');
select pg_temp.chk('COVER', 'needs linking', ((select count(*) from tx_all where (e->'demo_gate'->>'needs_linking')::boolean) > 0)::text, 'true');
select pg_temp.chk('COVER', 'a cancelled demo', ((select count(*) from tx_all where (e->'demo_gate'->>'demo_cancelled')::boolean) > 0)::text, 'true');
select pg_temp.chk('COVER', 'an exempt card', ((select count(*) from tx_all where (e->'demo_gate'->>'exempt')::boolean) > 0)::text, 'true');
select pg_temp.chk('COVER', 'a linked brand', ((select count(*) from tx_all where e->>'brand_name' is not null) > 0)::text, 'true');
select pg_temp.chk('COVER', 'a deleted brand is not linked',
  ((select count(*) from tx_all where e->>'brand_id' = '45710000-0000-4000-b000-00000000dead' and not (e->'demo_gate'->>'brand_linked')::boolean) = 1)::text, 'true');
select pg_temp.chk('COVER', 'a next demo', ((select count(*) from tx_all where jsonb_typeof(e->'next_demo') = 'object') > 0)::text, 'true');
select pg_temp.chk('COVER', 'a suggested reply', ((select count(*) from tx_all where jsonb_typeof(e->'suggest_replied') = 'object') > 0)::text, 'true');
select pg_temp.chk('COVER', 'an email suggested reply', ((select count(*) from tx_all where e->'suggest_replied'->>'channel' = 'email') > 0)::text, 'true');
select pg_temp.chk('COVER', 'a cadence', ((select count(*) from tx_all where jsonb_typeof(e->'cadence') = 'object') > 0)::text, 'true');
select pg_temp.chk('COVER', 'a cadence with email days', ((select count(*) from tx_all where (e->'cadence'->>'email_days')::int > 0) > 0)::text, 'true');
select pg_temp.chk('COVER', 'a last touch with a name', ((select count(*) from tx_all where e->'last_touch'->>'actor_name' is not null) > 0)::text, 'true');
select pg_temp.chk('COVER', 'a merged card', ((select count(*) from tx_all where jsonb_typeof(e->'merged_into') = 'object') > 0)::text, 'true');
select pg_temp.chk('COVER', 'identifiers, owners and watchers',
  ((select count(*) from tx_all where jsonb_array_length(e->'identifiers') = 2 and jsonb_array_length(e->'owners') = 1
                                     and jsonb_array_length(e->'watchers') = 1) > 0)::text, 'true');

-- WORK
select pg_temp.chk('WORK', 'crm_record_work_ids matches the old rule for every card',
  (select count(*)::text from public.crm_records r
    where array(select x from public.crm_record_work_ids(r.id) x order by x)
          is distinct from array(select x from pg_temp.old_work_ids(r.id) x order by x)), '0');
select pg_temp.chk('WORK', 'crm_record_work_ids of an unknown id is empty',
  (select count(*)::text from public.crm_record_work_ids(gen_random_uuid())), '0');

-- AUTH
select pg_temp.chk('AUTH', 'a person outside the team is refused',
  (pg_temp.as_('kim', $q$select public.crm_records_list('hosts')::text$q$) like 'ERR:%')::text, 'true');
select pg_temp.chk('AUTH', 'a bad pipeline is refused',
  pg_temp.as_('tao', $q$select public.crm_records_list('venues')::text$q$), 'ERR:22023:invalid_pipeline: Use hosts or creators.');
select pg_temp.chk('AUTH', 'the batch helpers are not callable by a signed-in person',
  (has_function_privilege('authenticated', 'public.crm_4571_records_json(uuid[])', 'execute')
   or has_function_privilege('authenticated', 'public.crm_4571_record_work_pairs(uuid[])', 'execute'))::text, 'false');
select pg_temp.chk('AUTH', 'the board stays callable by a signed-in person',
  has_function_privilege('authenticated', 'public.crm_records_list(text)', 'execute')::text, 'true');

-- ───────────────────────────── report ─────────────────────────────
do $r$
declare r record; v_fail integer := 0; v_all integer := 0;
begin
  for r in select * from tx_results order by seq loop
    v_all := v_all + 1;
    if r.ok then raise notice 'PASS % %', r.test, r.label;
    else v_fail := v_fail + 1; raise notice 'FAIL % % (%)', r.test, r.label, coalesce(r.detail, ''); end if;
  end loop;
  if v_all < 30 then raise exception '#4571 hosts-board speed implementor recorded only % checks', v_all; end if;
  if v_fail > 0 then raise exception '#4571 hosts-board speed implementor: % of % checks failed', v_fail, v_all; end if;
  raise notice '#4571 hosts-board speed implementor: % of % checks passed', v_all, v_all;
end;
$r$;

rollback;
