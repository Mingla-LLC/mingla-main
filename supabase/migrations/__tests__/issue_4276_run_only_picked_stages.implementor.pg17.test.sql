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
--              review, keeps out ones with reviews, ones Google says have none, ones that
--              are not servable and other cities' places
--   G-GRANTS   both functions belong to the service role only
--
-- FAILS-ON-REVERT: without the migration neither function exists. Drop the skipped
-- update and S-PLAN fails; drop the cursor update and S-REDO fails.
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

-- R-NONE
insert into public.place_pool (id, google_place_id, name, lat, lng, types, primary_type, is_active, city_id, fetched_via, is_servable)
values
  ('a4276600-0000-4000-b000-000000000001', 'gp-plan4276-1', 'No reviews', 1, 1, array['cafe'], 'cafe', true, 'a4276600-0000-4000-a000-000000000001', 'nearby_search', true),
  ('a4276600-0000-4000-b000-000000000002', 'gp-plan4276-2', 'Has reviews', 1, 1, array['cafe'], 'cafe', true, 'a4276600-0000-4000-a000-000000000001', 'nearby_search', true),
  ('a4276600-0000-4000-b000-000000000003', 'gp-plan4276-3', 'None on Google', 1, 1, array['cafe'], 'cafe', true, 'a4276600-0000-4000-a000-000000000001', 'nearby_search', true),
  ('a4276600-0000-4000-b000-000000000004', 'gp-plan4276-4', 'Left out', 1, 1, array['cafe'], 'cafe', true, 'a4276600-0000-4000-a000-000000000001', 'nearby_search', false),
  ('a4276600-0000-4000-b000-000000000005', 'gp-plan4276-5', 'Other city', 5, 5, array['cafe'], 'cafe', true, 'a4276600-0000-4000-a000-000000000002', 'nearby_search', true),
  ('a4276600-0000-4000-b000-000000000006', 'gp-plan4276-6', 'Fetch failed', 1, 1, array['cafe'], 'cafe', true, 'a4276600-0000-4000-a000-000000000001', 'nearby_search', true);
insert into public.place_external_reviews (place_pool_id, source, source_review_id, review_text, rating)
values ('a4276600-0000-4000-b000-000000000002', 'serper', 'r-plan4276-2', 'Lovely', 5);
insert into public.place_review_fetch_state (place_id, outcome, review_count, last_checked_at)
values ('a4276600-0000-4000-b000-000000000003', 'none_on_google', 0, now()),
       ('a4276600-0000-4000-b000-000000000006', 'failed', 0, now());

do $$
declare v uuid[] := public.place_intel_places_without_reviews('a4276600-0000-4000-a000-000000000001');
begin
  if v is distinct from array['a4276600-0000-4000-b000-000000000001', 'a4276600-0000-4000-b000-000000000006']::uuid[] then
    raise exception 'R-NONE: got %', v;
  end if;
  if public.place_intel_places_without_reviews('a4276600-0000-4000-a000-0000000000ff') <> array[]::uuid[] then
    raise exception 'R-NONE: an unknown city should give an empty list';
  end if;
end $$;

-- G-GRANTS
do $$
begin
  if has_function_privilege('authenticated', 'public.city_pipeline_start_plan(uuid,uuid,text,numeric,text[],boolean,boolean)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.place_intel_places_without_reviews(uuid)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.city_pipeline_start_plan(uuid,uuid,text,numeric,text[],boolean,boolean)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.place_intel_places_without_reviews(uuid)', 'EXECUTE') then
    raise exception 'G-GRANTS: wrong grants';
  end if;
end $$;

select 'issue_4276_run_only_picked_stages: all checks passed' as result;
rollback;
