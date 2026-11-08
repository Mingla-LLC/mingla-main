-- Issue #4276 (live runs): implementor proof for
-- 20280428004276_issue_4276_live_runs.sql.
--
-- MINGLA-INVARIANT: I-4276-LIVE-RUNS-ADMIN-ONLY | issue #4276 | admin_city_pipeline_live shows every in-progress and recently finished city run with in-stage progress, to admins only, in one read
-- MINGLA-INVARIANT: I-4276-RATE-LIMIT-WAIT-NOT-TICKED | issue #4276 | A run waiting out a function rate limit (next_attempt_at ahead) is neither claimed nor kicked until that time
--
--   T-REFUSE   a signed-in non-admin and an anonymous caller are refused (42501)
--   T-GRANTS   authenticated may call it; anon and service_role may not
--   T-WINDOW   active runs and runs finished inside p_days are listed; older ones are not
--   T-ORDER    active runs come first, newest first, then finished runs
--   T-SHAPE    every run carries exactly the keys the admin page reads
--   T-FILL     search progress adds up both seeding runs the stage started; the status
--              is the current child's
--   T-PHOTOS   photo progress reads the cursor's photo run
--   T-INTEL    intelligence progress reads the cursor's run, with Serper requests
--   T-CHECK    pre_check progress reads cursor.processed; score reads its cursor
--   T-SPEND    spent_usd and serper_requests come from city_pipeline_spend_ledger;
--              held_places from city_pipeline_place_counts
--   T-CLAIM    claim_tick skips a running run whose next_attempt_at is ahead, and
--              claims it (returning its lease) once that time has passed
--   T-KICK     the cron kicker does not post while the only running run is waiting
--
-- FAILS-ON-REVERT: without the migration the function and columns do not exist; drop
-- the next_attempt_at clause from claim_tick and T-CLAIM fails; drop it from the kicker
-- and T-KICK fails; drop is_admin_user() and T-REFUSE fails; sum only the current
-- seeding run and T-FILL fails.
--
-- Run from the repository root as supabase_admin. Everything is rolled back.

\set ON_ERROR_STOP on
begin;

-- nothing here may leave the database
create or replace function net.http_post(url text, body jsonb default '{}'::jsonb, params jsonb default '{}'::jsonb, headers jsonb default '{}'::jsonb, timeout_milliseconds integer default 5000)
returns bigint language plpgsql as $$
begin
  perform set_config('t4276l.posts', (coalesce(nullif(current_setting('t4276l.posts', true), ''), '0')::int + 1)::text, true);
  return 1;
end $$;

select vault.create_secret('https://local.test', 'supabase_url') where not exists (select 1 from vault.secrets where name = 'supabase_url');
select vault.create_secret('local-key', 'service_role_key') where not exists (select 1 from vault.secrets where name = 'service_role_key');

-- No other run may be active, so the claim and kick checks see only these.
update public.city_pipeline_runs set status = 'cancelled', completed_at = now() - interval '400 days'
 where status in ('queued', 'running', 'paused', 'awaiting_approval');

insert into public.admin_users (id, email, status)
values ('a4276800-0000-4000-e000-000000000001', 'admin.live4276@test.local', 'active')
on conflict (email) do update set status = 'active';

insert into auth.users (id, email, aud, role)
values ('a4276800-0000-4000-c000-000000000001', 'admin.live4276@test.local', 'authenticated', 'authenticated'),
       ('a4276800-0000-4000-c000-000000000002', 'nobody.live4276@test.local', 'authenticated', 'authenticated');

insert into public.seeding_cities (id, google_place_id, name, country, country_code, center_lat, center_lng, bbox_sw_lat, bbox_sw_lng, bbox_ne_lat, bbox_ne_lng, status)
values ('a4276800-0000-4000-a000-000000000001', 'gp-4276live-a', 'Live A', 'Testland', 'TL', 1, 1, 0, 0, 2, 2, 'draft'),
       ('a4276800-0000-4000-a000-000000000002', 'gp-4276live-b', 'Live B', 'Testland', 'TL', 3, 3, 2.5, 2.5, 3.5, 3.5, 'draft'),
       ('a4276800-0000-4000-a000-000000000003', 'gp-4276live-c', 'Live C', 'Testland', 'TL', 5, 5, 4.5, 4.5, 5.5, 5.5, 'draft'),
       ('a4276800-0000-4000-a000-000000000004', 'gp-4276live-d', 'Live D', 'Testland', 'TL', 7, 7, 6.5, 6.5, 7.5, 7.5, 'draft');

-- Two seeding rounds for city A: the first finished, the second is the cursor's.
insert into public.seeding_runs (id, city_id, selected_categories, total_tiles, total_batches, status,
                                 completed_batches, failed_batches, total_places_new, total_places_duped, total_cost_usd)
values ('a4276800-0000-4000-d000-000000000001', 'a4276800-0000-4000-a000-000000000001', array['nature'], 1, 100, 'completed', 90, 10, 300, 50, 3.2),
       ('a4276800-0000-4000-d000-000000000002', 'a4276800-0000-4000-a000-000000000001', array['nature'], 1, 40, 'running', 5, 1, 20, 7, 0.19);

insert into public.photo_backfill_runs (id, city, country, total_places, total_batches, status, completed_batches, failed_batches, total_succeeded, total_failed, actual_cost_usd)
values ('a4276800-0000-4000-d000-000000000003', 'Live B', 'Testland', 120, 12, 'running', 7, 1, 68, 4, 0.5);

insert into public.place_intelligence_runs (id, city_id, city_name, mode, sample_size, total_count, processed_count, succeeded_count, failed_count, status, cost_so_far_usd, estimated_cost_usd, estimated_minutes, prompt_version, model, serper_requests)
values ('a4276800-0000-4000-d000-000000000004', 'a4276800-0000-4000-a000-000000000002', 'Live B', 'remainder', null, 4400, 3120, 3100, 20, 'running', 2.5, 4, 30, 'v4', 'm', 9000);

-- A: running in fill, waiting out a rate limit. B: paused in intelligence. C: finished
-- an hour ago, and newer than both. D: finished 30 days ago.
insert into public.city_pipeline_runs (id, city_id, status, scope, spend_limit_usd, started_by, current_stage, created_at, started_at, completed_at,
                                       last_progress_at, last_outcome, next_attempt_at, error_streak, last_error)
values
  ('a4276800-0000-4000-f000-000000000001', 'a4276800-0000-4000-a000-000000000001', 'running', 'new_only', 50, 'a4276800-0000-4000-e000-000000000001', 'fill',
   now() - interval '2 hours', now() - interval '2 hours', null,
   now() - interval '10 seconds', '{"kind":"wait","why":"function_rate_limit","retry_after_ms":32000,"calls":41}'::jsonb, now() + interval '30 seconds', 0, 'earlier problem'),
  ('a4276800-0000-4000-f000-000000000002', 'a4276800-0000-4000-a000-000000000002', 'paused', 'new_only', 20, 'a4276800-0000-4000-e000-000000000001', 'intelligence',
   now() - interval '1 hour', now() - interval '1 hour', null, null, null, null, 0, null),
  ('a4276800-0000-4000-f000-000000000003', 'a4276800-0000-4000-a000-000000000003', 'complete', 'new_only', 20, 'a4276800-0000-4000-e000-000000000001', null,
   now() - interval '10 minutes', now() - interval '10 minutes', now() - interval '1 hour', null, null, null, 0, null),
  ('a4276800-0000-4000-f000-000000000004', 'a4276800-0000-4000-a000-000000000004', 'complete', 'new_only', 20, 'a4276800-0000-4000-e000-000000000001', null,
   now() - interval '31 days', now() - interval '31 days', now() - interval '30 days', null, null, null, 0, null);

insert into public.city_pipeline_stages (run_id, stage, ord, status, refs, cursor, result)
values
  ('a4276800-0000-4000-f000-000000000001', 'box', 1, 'complete', '{}', '{}', null),
  ('a4276800-0000-4000-f000-000000000001', 'fill', 2, 'running',
   '{"seeding_run_ids":["a4276800-0000-4000-d000-000000000001","a4276800-0000-4000-d000-000000000002"]}',
   '{"seeding_run_id":"a4276800-0000-4000-d000-000000000002","fill_rounds":2}', null),
  ('a4276800-0000-4000-f000-000000000001', 'pre_check', 5, 'pending', '{}', '{}', null),
  ('a4276800-0000-4000-f000-000000000002', 'pre_check', 5, 'complete', '{}', '{"processed":1800}', '{"processed":2000}'),
  ('a4276800-0000-4000-f000-000000000002', 'photos', 6, 'complete',
   '{"photo_run_ids":["a4276800-0000-4000-d000-000000000003"]}', '{"photo_run_id":"a4276800-0000-4000-d000-000000000003"}', null),
  ('a4276800-0000-4000-f000-000000000002', 'intelligence', 8, 'running',
   '{"intel_run_ids":["a4276800-0000-4000-d000-000000000004"]}', '{"intel_run_id":"a4276800-0000-4000-d000-000000000004"}', null),
  ('a4276800-0000-4000-f000-000000000002', 'score', 9, 'pending', '{}', '{"signals":["a","b","c"],"signal_index":1,"written":40}', null);

-- One held place for city B, never judged.
insert into public.place_pool (id, google_place_id, name, lat, lng, types, primary_type, is_active, serving_hold, city_id, fetched_via)
values ('a4276800-0000-4000-b000-000000000001', 'gp-4276live-held', 'Live Held', 3, 3, array['bar'], 'bar', true, true, 'a4276800-0000-4000-a000-000000000002', 'nearby_search');

create temp table expected_ledger as
select (public.city_pipeline_spend_ledger('a4276800-0000-4000-a000-000000000002', 'a4276800-0000-4000-f000-000000000002')) as b;
grant select on expected_ledger to authenticated;

-- ── T-KICK and T-CLAIM, as the service side ─────────────────────────────────
do $$
declare
  v_claimed public.city_pipeline_runs;
begin
  perform public.tg_kick_city_pipeline();
  if coalesce(nullif(current_setting('t4276l.posts', true), ''), '0')::int <> 0 then
    raise exception 'T-KICK: the kicker posted while the only running run waits out a rate limit';
  end if;

  select * into v_claimed from public.city_pipeline_claim_tick(170);
  if v_claimed.id is not null then
    raise exception 'T-CLAIM: a run waiting out its next_attempt_at was claimed: %', v_claimed.id;
  end if;

  update public.city_pipeline_runs set next_attempt_at = now() - interval '1 second'
   where id = 'a4276800-0000-4000-f000-000000000001';

  perform public.tg_kick_city_pipeline();
  if coalesce(nullif(current_setting('t4276l.posts', true), ''), '0')::int <> 1 then
    raise exception 'T-KICK: the kicker did not post once the wait was over';
  end if;

  select * into v_claimed from public.city_pipeline_claim_tick(170);
  if v_claimed.id is distinct from 'a4276800-0000-4000-f000-000000000001'::uuid then
    raise exception 'T-CLAIM: the run was not claimed after its wait: %', v_claimed.id;
  end if;
  if v_claimed.lease_until is null or v_claimed.lease_until <= now() then
    raise exception 'T-CLAIM: the claim did not return its lease: %', v_claimed.lease_until;
  end if;

  -- Put the wait back for the read below.
  update public.city_pipeline_runs set lease_until = null, next_attempt_at = now() + interval '30 seconds'
   where id = 'a4276800-0000-4000-f000-000000000001';
end $$;

-- ── The read, as an admin ───────────────────────────────────────────────────
set local role authenticated;
select set_config('request.jwt.claim.sub', 'a4276800-0000-4000-c000-000000000001', true);
select set_config('request.jwt.claims', '{"sub":"a4276800-0000-4000-c000-000000000001","role":"authenticated","email":"admin.live4276@test.local"}', true);

do $$
declare
  v jsonb := public.admin_city_pipeline_live(7);
  mine jsonb;
  ids text[];
  a jsonb;
  b jsonb;
  st jsonb;
  led jsonb;
  k text;
  want_keys text[] := array['id','city_id','city_name','country','status','current_stage','pause_reason','pause_detail',
    'spend_limit_usd','spent_usd','serper_requests','last_tick_at','last_progress_at','last_outcome','next_attempt_at',
    'error_streak','last_error','rules_only','created_at','started_at','completed_at','held_places','stages'];
  want_stage_keys text[] := array['stage','ord','status','started_at','completed_at','estimate','result','approval','progress'];
begin
  if v ? 'generated_at' is not true or jsonb_typeof(v -> 'runs') <> 'array' then
    raise exception 'T-SHAPE: top level is wrong: %', v;
  end if;

  select jsonb_agg(r order by o), array_agg(r ->> 'id' order by o) into mine, ids
    from jsonb_array_elements(v -> 'runs') with ordinality as t (r, o)
   where r ->> 'id' like 'a4276800-%';

  -- T-WINDOW and T-ORDER.
  if ids is distinct from array['a4276800-0000-4000-f000-000000000002', 'a4276800-0000-4000-f000-000000000001', 'a4276800-0000-4000-f000-000000000003'] then
    raise exception 'T-ORDER/T-WINDOW: got %', ids;
  end if;

  -- T-SHAPE.
  a := mine -> 1;
  b := mine -> 0;
  foreach k in array want_keys loop
    if not (a ? k) then raise exception 'T-SHAPE: run is missing %', k; end if;
  end loop;
  if (select count(*) from jsonb_object_keys(a)) <> array_length(want_keys, 1) then
    raise exception 'T-SHAPE: run has extra keys: %', (select array_agg(x) from jsonb_object_keys(a) x);
  end if;
  foreach k in array want_stage_keys loop
    if not ((a -> 'stages' -> 0) ? k) then raise exception 'T-SHAPE: stage is missing %', k; end if;
  end loop;
  if a ->> 'city_name' <> 'Live A' or a ->> 'country' <> 'Testland' or a ->> 'status' <> 'running'
     or a -> 'last_outcome' ->> 'why' <> 'function_rate_limit' or a ->> 'next_attempt_at' is null
     or a ->> 'last_error' <> 'earlier problem' then
    raise exception 'T-SHAPE: run A fields wrong: %', a;
  end if;

  -- T-FILL: both rounds add up; the status is the cursor's child.
  select s into st from jsonb_array_elements(a -> 'stages') s where s ->> 'stage' = 'fill';
  if st -> 'progress' is distinct from jsonb_build_object(
       'kind', 'search', 'done', 95, 'failed', 11, 'total', 140, 'places_new', 320, 'places_duped', 57,
       'cost_usd', 3.39, 'child_status', 'running') then
    raise exception 'T-FILL: %', st -> 'progress';
  end if;
  select s into st from jsonb_array_elements(a -> 'stages') s where s ->> 'stage' = 'pre_check';
  if st -> 'progress' <> 'null'::jsonb then
    raise exception 'T-CHECK: a pending check shows progress: %', st;
  end if;
  if (select array_agg(s ->> 'stage' order by o) from jsonb_array_elements(a -> 'stages') with ordinality s(s, o))
     is distinct from array['box', 'fill', 'pre_check'] then
    raise exception 'T-SHAPE: stages are not in order: %', a -> 'stages';
  end if;

  -- T-PHOTOS.
  select s into st from jsonb_array_elements(b -> 'stages') s where s ->> 'stage' = 'photos';
  if st -> 'progress' is distinct from jsonb_build_object(
       'kind', 'photos', 'done', 7, 'failed', 1, 'total', 12, 'places_total', 120, 'succeeded', 68,
       'failed_places', 4, 'cost_usd', 0.5, 'child_status', 'running') then
    raise exception 'T-PHOTOS: %', st -> 'progress';
  end if;

  -- T-INTEL.
  select s into st from jsonb_array_elements(b -> 'stages') s where s ->> 'stage' = 'intelligence';
  if st -> 'progress' is distinct from jsonb_build_object(
       'kind', 'intelligence', 'done', 3120, 'total', 4400, 'succeeded', 3100, 'failed', 20,
       'cost_usd', 2.5, 'serper_requests', 9000, 'child_status', 'running') then
    raise exception 'T-INTEL: %', st -> 'progress';
  end if;

  -- T-CHECK.
  select s into st from jsonb_array_elements(b -> 'stages') s where s ->> 'stage' = 'pre_check';
  if st -> 'progress' is distinct from '{"kind":"check","processed":1800}'::jsonb then
    raise exception 'T-CHECK: %', st -> 'progress';
  end if;
  select s into st from jsonb_array_elements(b -> 'stages') s where s ->> 'stage' = 'score';
  if st -> 'progress' is distinct from '{"kind":"score","signal_index":1,"signals":3,"written":40}'::jsonb then
    raise exception 'T-CHECK: score %', st -> 'progress';
  end if;

  -- T-SPEND.
  select e.b into led from expected_ledger e;
  if (b ->> 'spent_usd')::numeric <> (led ->> 'known_actual_usd')::numeric
     or (b ->> 'serper_requests')::bigint <> (led ->> 'serper_requests')::bigint
     or (b ->> 'serper_requests')::bigint <> 9000 then
    raise exception 'T-SPEND: % against ledger %', b, led;
  end if;
  if (b ->> 'held_places')::int <> 1 or (a ->> 'held_places')::int <> 0 then
    raise exception 'T-SPEND: held places wrong: B % A %', b ->> 'held_places', a ->> 'held_places';
  end if;

  -- A run finished 30 days ago shows with a wider window.
  if not exists (select 1 from jsonb_array_elements(public.admin_city_pipeline_live(31) -> 'runs') r
                  where r ->> 'id' = 'a4276800-0000-4000-f000-000000000004') then
    raise exception 'T-WINDOW: p_days is not honoured';
  end if;
end $$;

-- T-REFUSE: a signed-in user who is not an admin.
select set_config('request.jwt.claim.sub', 'a4276800-0000-4000-c000-000000000002', true);
select set_config('request.jwt.claims', '{"sub":"a4276800-0000-4000-c000-000000000002","role":"authenticated","email":"nobody.live4276@test.local"}', true);
do $$
begin
  perform public.admin_city_pipeline_live(7);
  raise exception 'T-REFUSE: a non-admin read the live runs';
exception when insufficient_privilege then
  null;
end $$;

-- T-REFUSE: anonymous callers cannot even call it.
reset role;
set local role anon;
do $$
begin
  perform public.admin_city_pipeline_live(7);
  raise exception 'T-REFUSE: anon read the live runs';
exception when insufficient_privilege then
  null;
end $$;

reset role;

-- T-GRANTS.
do $$
begin
  if not has_function_privilege('authenticated', 'public.admin_city_pipeline_live(integer)', 'EXECUTE') then
    raise exception 'T-GRANTS: authenticated cannot call it';
  end if;
  if has_function_privilege('service_role', 'public.admin_city_pipeline_live(integer)', 'EXECUTE') then
    raise exception 'T-GRANTS: service_role can call a function that always refuses it';
  end if;
  if has_function_privilege('anon', 'public.admin_city_pipeline_live(integer)', 'EXECUTE') then
    raise exception 'T-GRANTS: anon can call it';
  end if;
  if has_function_privilege('authenticated', 'public.city_pipeline_claim_tick(integer)', 'EXECUTE') then
    raise exception 'T-GRANTS: authenticated can claim a tick';
  end if;
end $$;

select 'issue_4276_live_runs: all checks passed' as result;
rollback;
