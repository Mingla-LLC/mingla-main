-- Issue #4276 (round 3): implementor proof for 20280419034276_issue_4276_run_only_picked_stages.sql.
--
-- MINGLA-INVARIANT: I-4276-PLANNED-RUN-SKIPS-UNPICKED | issue #4276 | A planned city run is created with every stage it was not asked for already skipped, in the same transaction, and starts at its first planned stage
--
--   S-PLAN     a run planned for pre_check and photos has those two pending, the other
--              nine skipped, and starts at pre_check
--   S-REDO     a redo marks the Intelligence stage's cursor {plan: true, redo: true}; a
--              planned run without a redo marks {plan: true, redo: false}
--   S-BAD      an unknown stage, an empty list, or a redo without Intelligence raise
--              22023 and create nothing
--   S-OLD      city_pipeline_start still starts every stage
--   R-NONE     place_intel_places_without_reviews lists servable places with no stored
--              review that a redo may re-judge, and keeps out ones with reviews, ones
--              Google says have none, ones that are not servable and other cities' places
--   R-HOLD     THE BACKLOG STAYS HELD: a place with an AI slice from before the hold, or
--              whose latest evaluation predates the hold, is never in the redo set
--   R-SAME     a place evaluated after the hold with no review fetch since is not in it
--              (no second Gemini bill); one with a fetch after its evaluation is
--   R-NEW      a place never evaluated is in it
--   R-COUNTS   admin_place_pipeline_redo_counts counts eligible and held per city, for
--              admins only
--   G-GRANTS   both functions belong to the service role only
--
-- FAILS-ON-REVERT: without the migration neither function exists. Drop the skipped
-- update and S-PLAN fails; drop the cursor update and S-REDO fails; restore the round-3
-- place_intel_places_without_reviews (no hold check) and R-HOLD and R-SAME fail.
--
-- Run from the repository root as supabase_admin. Everything is rolled back.

\set ON_ERROR_STOP on
begin;

insert into public.admin_users (id, email, status)
values ('a4276600-0000-4000-c000-000000000001', 'admin.plan4276@test.local', 'active')
on conflict (email) do update set status = 'active';

insert into public.seeding_cities (id, google_place_id, name, country, country_code, center_lat, center_lng, bbox_sw_lat, bbox_sw_lng, bbox_ne_lat, bbox_ne_lng, status)
values ('a4276600-0000-4000-a000-000000000001', 'gp-city-plan4276', 'Plan City 4276', 'Testland', 'TL', 1, 1, 0, 0, 2, 2, 'draft'),
       ('a4276600-0000-4000-a000-000000000002', 'gp-city-plan4276b', 'Other City 4276', 'Testland', 'TL', 5, 5, 4, 4, 6, 6, 'draft');

do $$
declare
  v_admin uuid := (select id from public.admin_users where email = 'admin.plan4276@test.local');
  v_run uuid;
  v_pending text[];
  v_cursor jsonb;
  v_current text;
begin
  -- S-PLAN
  v_run := public.city_pipeline_start_plan('a4276600-0000-4000-a000-000000000001', v_admin, 'new_only', 10, array['pre_check', 'photos'], false, false);
  select array_agg(stage order by ord) into v_pending from public.city_pipeline_stages where run_id = v_run and status = 'pending';
  if v_pending is distinct from array['pre_check', 'photos'] then
    raise exception 'S-PLAN: pending stages %', v_pending;
  end if;
  if (select count(*) from public.city_pipeline_stages where run_id = v_run and status = 'skipped') <> 9 then
    raise exception 'S-PLAN: expected nine skipped stages';
  end if;
  select current_stage into v_current from public.city_pipeline_runs where id = v_run;
  if v_current is distinct from 'pre_check' then raise exception 'S-PLAN: starts at %', v_current; end if;
  select cursor into v_cursor from public.city_pipeline_stages where run_id = v_run and stage = 'intelligence';
  if v_cursor is distinct from '{"plan": true, "redo": false}'::jsonb then raise exception 'S-REDO: no-redo cursor %', v_cursor; end if;
  delete from public.city_pipeline_runs where id = v_run;

  -- S-REDO
  v_run := public.city_pipeline_start_plan('a4276600-0000-4000-a000-000000000001', v_admin, 'new_only', 10,
    array['pre_check', 'photos', 'final_check', 'intelligence', 'score', 'release', 'thumbnails'], true, false);
  select cursor into v_cursor from public.city_pipeline_stages where run_id = v_run and stage = 'intelligence';
  if v_cursor is distinct from '{"plan": true, "redo": true}'::jsonb then raise exception 'S-REDO: cursor %', v_cursor; end if;
  if exists (select 1 from public.city_pipeline_stages where run_id = v_run and stage in ('box', 'fill', 'split', 'completeness') and status <> 'skipped') then
    raise exception 'S-REDO: a search stage would run';
  end if;
  delete from public.city_pipeline_runs where id = v_run;

  -- S-BAD
  begin
    perform public.city_pipeline_start_plan('a4276600-0000-4000-a000-000000000001', v_admin, 'new_only', 10, array['teleport'], false, false);
    raise exception 'S-BAD: unknown stage accepted';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform public.city_pipeline_start_plan('a4276600-0000-4000-a000-000000000001', v_admin, 'new_only', 10, array[]::text[], false, false);
    raise exception 'S-BAD: empty list accepted';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform public.city_pipeline_start_plan('a4276600-0000-4000-a000-000000000001', v_admin, 'new_only', 10, array['photos'], true, false);
    raise exception 'S-BAD: a redo without Intelligence accepted';
  exception when sqlstate '22023' then null;
  end;
  if exists (select 1 from public.city_pipeline_runs where city_id = 'a4276600-0000-4000-a000-000000000001') then
    raise exception 'S-BAD: a refused plan left a run behind';
  end if;

  -- S-OLD
  v_run := public.city_pipeline_start('a4276600-0000-4000-a000-000000000001', v_admin, 'new_only', 10, false, false);
  if (select count(*) from public.city_pipeline_stages where run_id = v_run and status = 'pending') <> 11 then
    raise exception 'S-OLD: an unplanned run no longer starts every stage';
  end if;
  delete from public.city_pipeline_runs where id = v_run;
end $$;

-- R-NONE, R-HOLD, R-SAME, R-NEW
--   1 never evaluated, no reviews                         eligible (R-NEW)
--   2 has reviews                                         not a candidate
--   3 Google has none                                     not a candidate
--   4 not servable                                        not a candidate
--   5 other city                                          not in this city's set
--   6 never evaluated, last fetch failed                  eligible
--   7 AI slice from before the hold                       held (R-HOLD)
--   8 evaluated before the hold, no AI slice kept         held (R-HOLD)
--   9 evaluated after the hold, no fetch since            current (R-SAME)
--  10 evaluated after the hold, reviews fetched since     eligible (R-SAME)
insert into public.place_pool (id, google_place_id, name, lat, lng, types, primary_type, is_active, city_id, fetched_via, is_servable, ai_signal_scores)
values
  ('a4276600-0000-4000-b000-000000000001', 'gp-plan4276-1', 'Never evaluated', 1, 1, array['cafe'], 'cafe', true, 'a4276600-0000-4000-a000-000000000001', 'nearby_search', true, null),
  ('a4276600-0000-4000-b000-000000000002', 'gp-plan4276-2', 'Has reviews', 1, 1, array['cafe'], 'cafe', true, 'a4276600-0000-4000-a000-000000000001', 'nearby_search', true, null),
  ('a4276600-0000-4000-b000-000000000003', 'gp-plan4276-3', 'None on Google', 1, 1, array['cafe'], 'cafe', true, 'a4276600-0000-4000-a000-000000000001', 'nearby_search', true, null),
  ('a4276600-0000-4000-b000-000000000004', 'gp-plan4276-4', 'Left out', 1, 1, array['cafe'], 'cafe', true, 'a4276600-0000-4000-a000-000000000001', 'nearby_search', false, null),
  ('a4276600-0000-4000-b000-000000000005', 'gp-plan4276-5', 'Other city', 5, 5, array['cafe'], 'cafe', true, 'a4276600-0000-4000-a000-000000000002', 'nearby_search', true, null),
  ('a4276600-0000-4000-b000-000000000006', 'gp-plan4276-6', 'Fetch failed', 1, 1, array['cafe'], 'cafe', true, 'a4276600-0000-4000-a000-000000000001', 'nearby_search', true, null),
  ('a4276600-0000-4000-b000-000000000007', 'gp-plan4276-7', 'Backlog slice', 1, 1, array['cafe'], 'cafe', true, 'a4276600-0000-4000-a000-000000000001', 'nearby_search', true,
   jsonb_build_object('sig', jsonb_build_object('score', 50, 'evaluated_at', '2026-09-01T00:00:00Z'))),
  ('a4276600-0000-4000-b000-000000000008', 'gp-plan4276-8', 'Backlog run', 1, 1, array['cafe'], 'cafe', true, 'a4276600-0000-4000-a000-000000000001', 'nearby_search', true, null),
  ('a4276600-0000-4000-b000-000000000009', 'gp-plan4276-9', 'Judged after the hold', 1, 1, array['cafe'], 'cafe', true, 'a4276600-0000-4000-a000-000000000001', 'nearby_search', true,
   jsonb_build_object('sig', jsonb_build_object('score', 60, 'evaluated_at', '2026-11-10T00:00:00Z'))),
  ('a4276600-0000-4000-b000-00000000000a', 'gp-plan4276-a', 'Judged, then fetched', 1, 1, array['cafe'], 'cafe', true, 'a4276600-0000-4000-a000-000000000001', 'nearby_search', true,
   jsonb_build_object('sig', jsonb_build_object('score', 60, 'evaluated_at', '2026-11-10T00:00:00Z')));
insert into public.place_external_reviews (place_pool_id, source, source_review_id, review_text, rating)
values ('a4276600-0000-4000-b000-000000000002', 'serper', 'r-plan4276-2', 'Lovely', 5);
insert into public.place_review_fetch_state (place_id, outcome, review_count, last_checked_at)
values ('a4276600-0000-4000-b000-000000000003', 'none_on_google', 0, now()),
       ('a4276600-0000-4000-b000-000000000006', 'failed', 0, now()),
       ('a4276600-0000-4000-b000-000000000009', 'fetched', 0, '2026-11-09T00:00:00Z'),
       ('a4276600-0000-4000-b000-00000000000a', 'fetched', 0, '2026-11-12T00:00:00Z');
insert into public.place_intelligence_trial_runs (run_id, place_pool_id, input_payload, status, completed_at, city_id)
values
  (gen_random_uuid(), 'a4276600-0000-4000-b000-000000000008', '{}'::jsonb, 'completed', '2026-09-01T00:00:00Z', 'a4276600-0000-4000-a000-000000000001'),
  (gen_random_uuid(), 'a4276600-0000-4000-b000-000000000009', '{}'::jsonb, 'completed', '2026-11-10T00:00:00Z', 'a4276600-0000-4000-a000-000000000001'),
  (gen_random_uuid(), 'a4276600-0000-4000-b000-00000000000a', '{}'::jsonb, 'completed', '2026-11-10T00:00:00Z', 'a4276600-0000-4000-a000-000000000001');

do $$
declare
  v uuid[] := public.place_intel_places_without_reviews('a4276600-0000-4000-a000-000000000001');
  v_state text;
begin
  if v is distinct from array['a4276600-0000-4000-b000-000000000001', 'a4276600-0000-4000-b000-000000000006',
                              'a4276600-0000-4000-b000-00000000000a']::uuid[] then
    raise exception 'R-NONE: got %', v;
  end if;
  if 'a4276600-0000-4000-b000-000000000007'::uuid = any (v) or 'a4276600-0000-4000-b000-000000000008'::uuid = any (v) then
    raise exception 'R-HOLD: a backlog place is in the redo set';
  end if;
  if 'a4276600-0000-4000-b000-000000000009'::uuid = any (v) then
    raise exception 'R-SAME: a place unchanged since its post-hold evaluation is in the redo set';
  end if;
  select state into v_state from public.place_intel_redo_state('a4276600-0000-4000-a000-000000000001') where place_id = 'a4276600-0000-4000-b000-000000000007';
  if v_state <> 'held' then raise exception 'R-HOLD: slice place is %', v_state; end if;
  select state into v_state from public.place_intel_redo_state('a4276600-0000-4000-a000-000000000001') where place_id = 'a4276600-0000-4000-b000-000000000008';
  if v_state <> 'held' then raise exception 'R-HOLD: pre-hold run place is %', v_state; end if;
  select state into v_state from public.place_intel_redo_state('a4276600-0000-4000-a000-000000000001') where place_id = 'a4276600-0000-4000-b000-000000000009';
  if v_state <> 'current' then raise exception 'R-SAME: post-hold place is %', v_state; end if;
  if public.place_intel_places_without_reviews('a4276600-0000-4000-a000-0000000000ff') <> array[]::uuid[] then
    raise exception 'R-NONE: an unknown city should give an empty list';
  end if;
  if public.place_intel_places_without_reviews(null) <> array[]::uuid[] then
    raise exception 'R-NONE: no city must never mean every city';
  end if;
end $$;

-- R-COUNTS
insert into auth.users (id, email, aud, role)
values ('a4276600-0000-4000-c000-000000000002', 'admin.plan4276@test.local', 'authenticated', 'authenticated'),
       ('a4276600-0000-4000-c000-000000000003', 'nobody.plan4276@test.local', 'authenticated', 'authenticated');
set local role authenticated;
select set_config('request.jwt.claim.sub', 'a4276600-0000-4000-c000-000000000002', true);
select set_config('request.jwt.claims', '{"sub":"a4276600-0000-4000-c000-000000000002","role":"authenticated"}', true);
do $$
declare v jsonb := public.admin_place_pipeline_redo_counts() -> 'a4276600-0000-4000-a000-000000000001';
begin
  if v is distinct from '{"reviews_eligible": 3, "reviews_held": 2, "redo_eligible": 1, "redo_held": 1}'::jsonb then
    raise exception 'R-COUNTS: got %', v;
  end if;
end $$;
select set_config('request.jwt.claim.sub', 'a4276600-0000-4000-c000-000000000003', true);
select set_config('request.jwt.claims', '{"sub":"a4276600-0000-4000-c000-000000000003","role":"authenticated"}', true);
do $$
begin
  perform public.admin_place_pipeline_redo_counts();
  raise exception 'R-COUNTS: a non-admin read the counts';
exception when insufficient_privilege then null;
end $$;
reset role;

-- G-GRANTS
do $$
begin
  if has_function_privilege('authenticated', 'public.city_pipeline_start_plan(uuid,uuid,text,numeric,text[],boolean,boolean)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.place_intel_places_without_reviews(uuid)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.city_pipeline_start_plan(uuid,uuid,text,numeric,text[],boolean,boolean)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.place_intel_places_without_reviews(uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.place_intel_redo_state(uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.admin_place_pipeline_redo_counts()', 'EXECUTE') then
    raise exception 'G-GRANTS: wrong grants';
  end if;
end $$;

select 'issue_4276_run_only_picked_stages: all checks passed' as result;
rollback;
