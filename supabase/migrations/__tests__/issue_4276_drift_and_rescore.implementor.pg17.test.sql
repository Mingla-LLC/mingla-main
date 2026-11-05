-- Issue #4276 wave 1, S1 and S2. Implementor happy path on the fully replayed PG17
-- schema, for 20280410004276_issue_4276_drift_modes_and_rescore_queue.sql.
--
-- MINGLA-INVARIANT: I-4276-DRIFT-NEVER-ABORTS-PLACE-UPDATE | issue #4276 | A queue failure in the place_pool drift trigger warns and records; it never aborts the place update
-- MINGLA-INVARIANT: I-4276-RESCORE-QUEUE-NO-PERMANENT-HEAD | issue #4276 | A vetoed or already-seen (place, signal) pair never enters the re-score sweep, and a newer AI result always goes first
--
--   R-MODES   both run modes are admitted, with sample_size 1, and an unknown mode
--             is still refused
--   R-DRIFT   changing a scored place's status queues one parent and one child
--   R-ACTIVE  a city already running: the update stands, the skip is recorded
--   R-FAIL    a place with no city cannot have a parent run: the update stands,
--             the failure is recorded, no parent or child is left behind
--   R-QUEUE   vetoed-no-row, already-seen, admin-held and pre-hold pairs are out;
--             new, stale, and vetoed-with-a-row pairs are in, newest first
--
-- FAILS-ON-REVERT: without the migration, R-MODES fails on the mode check, and
-- R-DRIFT and R-FAIL abort the place UPDATE. Reverting only the selector fails
-- R-QUEUE. Verified by replacing each function body with its previous one.
--
-- Run from the repository root as supabase_admin. Everything is rolled back.

\set ON_ERROR_STOP on
begin;

insert into public.seeding_cities (id, google_place_id, name, country, country_code, center_lat, center_lng, bbox_sw_lat, bbox_sw_lng, bbox_ne_lat, bbox_ne_lng, status)
values ('42760000-0000-4000-a000-000000000001', 'gp-city-4276-1', 'Test City A 4276', 'Testland', 'TL', 1, 1, 0, 0, 2, 2, 'draft'),
       ('42760000-0000-4000-a000-000000000002', 'gp-city-4276-2', 'Test City B 4276', 'Testland', 'TL', 2, 2, 1, 1, 3, 3, 'draft');

-- The replayed schema has no signal rows; the sweep joins to the active ones.
insert into public.signal_definitions (id, label, kind, is_active)
values ('drinks', 'Drinks', 'type-grounded', true)
on conflict (id) do update set is_active = true;
with v as (
  insert into public.signal_definition_versions (signal_id, version_label, config)
  values ('drinks', 'test-4276', '{}'::jsonb) returning id
)
update public.signal_definitions set current_version_id = (select id from v) where id = 'drinks';

create temp table tr_pl (who text primary key, id uuid not null) on commit drop;
insert into tr_pl values
  ('drift',  '42760000-0000-4000-b000-000000000001'),
  ('nocity', '42760000-0000-4000-b000-000000000002'),
  ('active', '42760000-0000-4000-b000-000000000003');

insert into public.place_pool (id, google_place_id, name, lat, lng, types, primary_type, is_active, is_servable, city_id, business_status, ai_signal_scores, fetched_via)
select id, 'gp-4276-' || who, 'Place ' || who, 1, 1, array['cafe'], 'cafe', true, true,
       case who when 'nocity' then null
                when 'active' then '42760000-0000-4000-a000-000000000002'::uuid
                else '42760000-0000-4000-a000-000000000001'::uuid end,
       'OPERATIONAL', '{}'::jsonb, 'nearby_search'
from tr_pl;

-- ── R-MODES ─────────────────────────────────────────────────────────────────
do $$
declare v_id uuid;
begin
  insert into public.place_intelligence_runs (city_id, city_name, mode, sample_size, total_count, estimated_cost_usd, estimated_minutes, prompt_version, model, status)
  values ('42760000-0000-4000-a000-000000000001', 'x', 'admin_reeval', 1, 1, 0.01, 1, 'v4', 'm', 'complete') returning id into v_id;
  delete from public.place_intelligence_runs where id = v_id;
  insert into public.place_intelligence_runs (city_id, city_name, mode, sample_size, total_count, estimated_cost_usd, estimated_minutes, prompt_version, model, status)
  values ('42760000-0000-4000-a000-000000000001', 'x', 'drift_reeval', 1, 1, 0.01, 1, 'v4', 'm', 'complete') returning id into v_id;
  delete from public.place_intelligence_runs where id = v_id;
  begin
    insert into public.place_intelligence_runs (city_id, city_name, mode, sample_size, total_count, estimated_cost_usd, estimated_minutes, prompt_version, model, status)
    values ('42760000-0000-4000-a000-000000000001', 'x', 'made_up', 1, 1, 0.01, 1, 'v4', 'm', 'complete');
    raise exception 'R-MODES: an unknown mode was admitted';
  exception when check_violation then null;
  end;
end $$;

-- ── R-DRIFT ─────────────────────────────────────────────────────────────────
update public.place_pool set business_status = 'CLOSED_TEMPORARILY'
 where id = '42760000-0000-4000-b000-000000000001';
do $$
begin
  if (select business_status from public.place_pool where id = '42760000-0000-4000-b000-000000000001') <> 'CLOSED_TEMPORARILY' then
    raise exception 'R-DRIFT: the place update did not stand';
  end if;
  if (select count(*) from public.place_intelligence_runs where city_id = '42760000-0000-4000-a000-000000000001' and mode = 'drift_reeval' and status = 'running') <> 1 then
    raise exception 'R-DRIFT: expected one running parent';
  end if;
  if (select count(*) from public.place_intelligence_trial_runs where place_pool_id = '42760000-0000-4000-b000-000000000001' and source = 'auto-refresh-drift' and status = 'pending') <> 1 then
    raise exception 'R-DRIFT: expected one pending child';
  end if;
end $$;

-- A second drift event while one is queued adds nothing and does not record a skip.
update public.place_pool set editorial_summary = 'new words'
 where id = '42760000-0000-4000-b000-000000000001';
do $$
begin
  if (select count(*) from public.place_intelligence_trial_runs where place_pool_id = '42760000-0000-4000-b000-000000000001') <> 1 then
    raise exception 'R-DRIFT: a second event queued a second re-evaluation';
  end if;
  if exists (select 1 from public.place_drift_queue_events where place_id = '42760000-0000-4000-b000-000000000001') then
    raise exception 'R-DRIFT: a covered event was recorded as a problem';
  end if;
end $$;

-- ── R-ACTIVE ────────────────────────────────────────────────────────────────
insert into public.place_intelligence_runs (city_id, city_name, mode, total_count, estimated_cost_usd, estimated_minutes, prompt_version, model, status)
values ('42760000-0000-4000-a000-000000000002', 'b', 'full_city', 1, 0.01, 1, 'v4', 'm', 'running');
update public.place_pool set business_status = 'CLOSED_TEMPORARILY'
 where id = '42760000-0000-4000-b000-000000000003';
do $$
begin
  if (select business_status from public.place_pool where id = '42760000-0000-4000-b000-000000000003') <> 'CLOSED_TEMPORARILY' then
    raise exception 'R-ACTIVE: the place update did not stand';
  end if;
  if (select count(*) from public.place_drift_queue_events where place_id = '42760000-0000-4000-b000-000000000003' and outcome = 'skipped_active_run' and drift_kind = 'business_status') <> 1 then
    raise exception 'R-ACTIVE: the skip was not recorded';
  end if;
end $$;

-- ── R-FAIL ──────────────────────────────────────────────────────────────────
update public.place_pool set business_status = 'CLOSED_TEMPORARILY'
 where id = '42760000-0000-4000-b000-000000000002';
do $$
begin
  if (select business_status from public.place_pool where id = '42760000-0000-4000-b000-000000000002') <> 'CLOSED_TEMPORARILY' then
    raise exception 'R-FAIL: the place update did not stand';
  end if;
  if (select count(*) from public.place_drift_queue_events where place_id = '42760000-0000-4000-b000-000000000002' and outcome = 'queue_failed' and sqlstate = '23502') <> 1 then
    raise exception 'R-FAIL: the failure was not recorded with its code';
  end if;
  if exists (select 1 from public.place_intelligence_trial_runs where place_pool_id = '42760000-0000-4000-b000-000000000002') then
    raise exception 'R-FAIL: a child row was left behind';
  end if;
end $$;

-- The trigger cannot be fooled by the recording table failing either.
alter table public.place_drift_queue_events rename to place_drift_queue_events_gone;
update public.place_pool set editorial_summary = 'still fine'
 where id = '42760000-0000-4000-b000-000000000002';
alter table public.place_drift_queue_events_gone rename to place_drift_queue_events;
do $$
begin
  if (select editorial_summary from public.place_pool where id = '42760000-0000-4000-b000-000000000002') <> 'still fine' then
    raise exception 'R-FAIL: an unrecordable failure aborted the update';
  end if;
end $$;

-- ── R-QUEUE ─────────────────────────────────────────────────────────────────
-- One place per case. Every AI slice is after the hold except 'pre_hold'.
create temp table tr_q (who text primary key, id uuid not null, sig text not null, veto boolean not null, ev timestamptz not null, expected boolean not null, rank int) on commit drop;
insert into tr_q values
  ('new_pair',       '42760000-0000-4000-c000-000000000001', 'drinks', false, '2026-12-01', true,  2),
  ('veto_no_row',    '42760000-0000-4000-c000-000000000002', 'drinks', true,  '2026-12-05', false, null),
  ('already_seen',   '42760000-0000-4000-c000-000000000003', 'drinks', false, '2026-12-05', false, null),
  ('admin_held',     '42760000-0000-4000-c000-000000000004', 'drinks', false, '2026-12-05', false, null),
  ('stale_rule',     '42760000-0000-4000-c000-000000000005', 'drinks', false, '2026-12-03', true,  1),
  ('veto_with_row',  '42760000-0000-4000-c000-000000000006', 'drinks', true,  '2026-11-20', true,  3),
  ('pre_hold',       '42760000-0000-4000-c000-000000000007', 'drinks', false, '2026-06-01', false, null),
  ('old_slice',      '42760000-0000-4000-c000-000000000008', 'drinks', false, '2026-11-10', true,  4);

insert into public.place_pool (id, google_place_id, name, lat, lng, types, primary_type, is_active, is_servable, city_id, ai_signal_scores, fetched_via)
select id, 'gp-4276q-' || who, who, 1, 1, array['cafe'], 'cafe', true, true, '42760000-0000-4000-a000-000000000001',
       jsonb_build_object(sig, jsonb_build_object('score_0_to_100', 50, 'inappropriate_for', veto, 'reasoning', 'r', 'evaluated_at', ev, 'prompt_version', 'v4', 'model', 'm')),
       'nearby_search'
from tr_q;

-- A signal the scorer would refuse could only ever sit in the queue.
update public.place_pool
   set ai_signal_scores = ai_signal_scores || jsonb_build_object('not_a_signal_4276', jsonb_build_object('evaluated_at', '2026-12-09', 'inappropriate_for', false))
 where id = '42760000-0000-4000-c000-000000000001';

insert into public.place_scores (place_id, signal_id, score, contributions, scored_at, ai_signal_scores_at)
select id, sig, 10,
  case who when 'admin_held' then '{"_admin_pin": 1}'::jsonb
           when 'already_seen' then '{"_ineligible": 0, "_reason": "min_rating"}'::jsonb
           else '{}'::jsonb end,
  case who when 'already_seen' then '2026-12-06'::timestamptz
           when 'old_slice' then '2026-11-11'::timestamptz
           else '2026-06-01'::timestamptz end,
  case who when 'old_slice' then '2026-06-01'::timestamptz end
from tr_q where who in ('already_seen', 'admin_held', 'stale_rule', 'veto_with_row', 'pre_hold', 'old_slice');

do $$
declare v_got text; v_want text;
begin
  select string_agg(q.who, ',' order by ord) into v_got
    from (select place_id, row_number() over () ord from public.pg_meta_orch_1009_sub_d_select_stale_pairs(99999)) s
    join tr_q q on q.id = s.place_id;
  select string_agg(who, ',' order by rank) into v_want from tr_q where expected;
  if v_got is distinct from v_want then
    raise exception 'R-QUEUE: expected [%], got [%]', v_want, v_got;
  end if;
  if exists (select 1 from public.pg_meta_orch_1009_sub_d_select_stale_pairs(99999) where signal_id = 'not_a_signal_4276') then
    raise exception 'R-QUEUE: a signal the scorer refuses entered the queue';
  end if;
end $$;

-- Permanent entries can't hold the head: a new result outranks everything at limit 1.
do $$
begin
  if (select place_id from public.pg_meta_orch_1009_sub_d_select_stale_pairs(1)) <> '42760000-0000-4000-c000-000000000005' then
    raise exception 'R-QUEUE: the newest AI result is not at the head';
  end if;
end $$;

rollback;
\echo 'issue 4276 drift and rescore: all checks passed'
