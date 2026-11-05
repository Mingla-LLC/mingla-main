-- Issue #4276 wave 3, C1 to C9, M1 and recovery. Implementor happy path on the fully
-- replayed PG17 schema, for 20280410034276_issue_4276_city_pipeline_conductor.sql.
--
-- MINGLA-INVARIANT: I-4276-HELD-PLACE-NEVER-SERVED | issue #4276 | While a place is held, is_servable cannot be true and every serving path hides it, and no place that is live can be held
-- MINGLA-INVARIANT: I-4276-SEARCH-CLAIM-ATOMIC | issue #4276 | A search is claimed and finished in one step each, a stale claim comes back, and a late finish counts for nothing
-- MINGLA-INVARIANT: I-4276-RUN-EXISTS-BECAUSE-ADMIN | issue #4276 | A conductor run needs an active admin, and a cron tick with no run does nothing
-- MINGLA-INVARIANT: I-4276-SYSTEM-RUNS-RECOVER | issue #4276 | System runs resume when the provider is healthy, skipped drift is re-queued under a cap, and a stalled run stops holding its city and the limit
--
--   R-HOLD     the verdict is parked and is_servable stays away from true
--   R-LIVE     a live place can't be held, and nothing on it changes
--   R-SERVE    every serving path that reads is_servable hides a held place, passed or
--              never judged, and still shows the live place
--   R-RELEASE  release needs an AI result unless a person chose rules only; a rejected
--              place stops being held and stays unservable
--   R-RUN      a run needs an active admin; one per city, one running at a time
--   R-TICK     no run means no post; a run means one post; a tick leases one run
--   R-CLAIM    two claims never get one search; a stale claim is reclaimed; the first
--              worker's late finish changes nothing; counters count once
--   R-RETRY    a retry replaces the failed attempt's counts
--   R-SPEND    the ledger reads the records; Serper's cost is unknown until a rate is set;
--              automatic re-evaluation has its own row
--   R-RESUME   a paused system run resumes only after a newer healthy check; an operator
--              run never does
--   R-PILE     a paused system run makes further drift wait as an event
--   R-REQUEUE  skipped events drain when the city frees, are marked handled, respect the
--              cap and an unhealthy provider, and skip a place that's no longer eligible
--   R-STALL    a stalled run lets go of its city and of the limit; 4 stuck runs can't
--              starve a fifth
--
-- FAILS-ON-REVERT: dropping the trigger fails R-HOLD and R-SERVE. Removing the claim
-- token check fails R-CLAIM. Removing place_intel_reap_stalled_runs from the kicker
-- fails R-STALL. Verified by replacing each. Removing a query's is_servable filter fails
-- R-SERVE for that path.
--
-- Run from the repository root as supabase_admin. Everything is rolled back.

\set ON_ERROR_STOP on
begin;

-- nothing here may leave the database
create or replace function net.http_post(url text, body jsonb default '{}'::jsonb, params jsonb default '{}'::jsonb, headers jsonb default '{}'::jsonb, timeout_milliseconds integer default 5000)
returns bigint language plpgsql as $$
begin
  perform set_config('t4276.posts', (coalesce(nullif(current_setting('t4276.posts', true), ''), '0')::int + 1)::text, true);
  perform set_config('t4276.last_url', url, true);
  perform set_config('t4276.last_body', body::text, true);
  return 1;
end $$;

select vault.create_secret('https://local.test', 'supabase_url') where not exists (select 1 from vault.secrets where name = 'supabase_url');
select vault.create_secret('local-key', 'service_role_key') where not exists (select 1 from vault.secrets where name = 'service_role_key');

insert into public.seeding_cities (id, google_place_id, name, country, country_code, center_lat, center_lng, bbox_sw_lat, bbox_sw_lng, bbox_ne_lat, bbox_ne_lng, status)
values ('42763000-0000-4000-a000-000000000001', 'gp-4276w3-a', 'W3 A', 'Testland', 'TL', 1, 1, 0, 0, 2, 2, 'draft'),
       ('42763000-0000-4000-a000-000000000002', 'gp-4276w3-b', 'W3 B', 'Testland', 'TL', 3, 3, 2.5, 2.5, 3.5, 3.5, 'draft');

insert into public.admin_users (id, email, status)
values ('42763000-0000-4000-e000-000000000001', 'w3-admin@local.test', 'active'),
       ('42763000-0000-4000-e000-000000000002', 'w3-gone@local.test', 'revoked');

insert into public.signal_definitions (id, label, kind, is_active)
values ('w3_signal', 'W3', 'type-grounded', true);
insert into public.signal_definition_versions (id, signal_id, version_label, config)
values ('42763000-0000-4000-9000-000000000001', 'w3_signal', 'v1', '{}'::jsonb);

-- ── R-HOLD ──────────────────────────────────────────────────────────────────
insert into public.place_pool (id, google_place_id, name, lat, lng, types, primary_type, is_active, is_servable, serving_hold, city_id, stored_photo_urls, fetched_via, rating, review_count, ai_signal_scores)
values
  ('42763000-0000-4000-b000-000000000001', 'gp-w3-live', 'W3 Live Spot', 1, 1, array['bar'], 'bar', true, true, false, '42763000-0000-4000-a000-000000000001', array['https://x.test/1.jpg'], 'nearby_search', 4.5, 100, null),
  ('42763000-0000-4000-b000-000000000002', 'gp-w3-held', 'W3 Held Spot', 1, 1, array['bar'], 'bar', true, null, true, '42763000-0000-4000-a000-000000000001', array['https://x.test/2.jpg'], 'nearby_search', 4.5, 100, null),
  ('42763000-0000-4000-b000-000000000003', 'gp-w3-unjudged', 'W3 Unjudged Spot', 1, 1, array['bar'], 'bar', true, null, true, '42763000-0000-4000-a000-000000000001', array['https://x.test/3.jpg'], 'nearby_search', 4.5, 100, null),
  ('42763000-0000-4000-b000-000000000004', 'gp-w3-rejected', 'W3 Rejected Spot', 1, 1, array['bar'], 'bar', true, null, true, '42763000-0000-4000-a000-000000000001', array['https://x.test/4.jpg'], 'nearby_search', 4.5, 100, null),
  ('42763000-0000-4000-b000-000000000005', 'gp-w3-old-null', 'W3 Old Null', 1, 1, array['bar'], 'bar', true, null, false, '42763000-0000-4000-a000-000000000002', null, 'nearby_search', 4.5, 100, null);

-- run-bouncer writes the verdict exactly as it always has.
update public.place_pool set is_servable = true where id = '42763000-0000-4000-b000-000000000002';
update public.place_pool set is_servable = false where id = '42763000-0000-4000-b000-000000000004';

do $$
declare r record;
begin
  select is_servable, held_final_check_passed into r from public.place_pool where id = '42763000-0000-4000-b000-000000000002';
  if r.is_servable is distinct from false or r.held_final_check_passed is distinct from true then
    raise exception 'R-HOLD: a passing verdict must be parked, got % / %', r.is_servable, r.held_final_check_passed;
  end if;
  select is_servable, held_final_check_passed into r from public.place_pool where id = '42763000-0000-4000-b000-000000000004';
  if r.is_servable is distinct from false or r.held_final_check_passed is distinct from false then
    raise exception 'R-HOLD: a failing verdict must be recorded, got % / %', r.is_servable, r.held_final_check_passed;
  end if;
end $$;

-- ── R-LIVE ──────────────────────────────────────────────────────────────────
do $$
begin
  begin
    update public.place_pool set serving_hold = true where id = '42763000-0000-4000-b000-000000000001';
    raise exception 'R-LIVE: holding a live place must be refused';
  exception when sqlstate 'PT409' then null;
  end;
  if (select public.city_pipeline_hold_unjudged('42763000-0000-4000-a000-000000000001')) <> 0 then
    raise exception 'R-LIVE: only never-judged places outside a hold may be adopted';
  end if;
  if (select is_servable from public.place_pool where id = '42763000-0000-4000-b000-000000000001') is not true then
    raise exception 'R-LIVE: the live place changed';
  end if;
end $$;

-- ── R-SERVE ─────────────────────────────────────────────────────────────────
insert into public.place_scores (place_id, signal_id, score, contributions, signal_version_id, scored_at)
select id, 'w3_signal', 90, '{}'::jsonb, '42763000-0000-4000-9000-000000000001'::uuid, now()
from public.place_pool where id in ('42763000-0000-4000-b000-000000000001', '42763000-0000-4000-b000-000000000002', '42763000-0000-4000-b000-000000000003');

do $$
declare
  v_live uuid := '42763000-0000-4000-b000-000000000001';
  v_ids uuid[] := array['42763000-0000-4000-b000-000000000002', '42763000-0000-4000-b000-000000000003']::uuid[];
  v_seen uuid[];
  v_json jsonb;
begin
  select array_agg(q.place_id) into v_seen from public.query_servable_places_by_signal('w3_signal', 0, 1, 1, 50000, '{}', 50) q;
  if not v_live = any(coalesce(v_seen, '{}')) or v_seen && v_ids then
    raise exception 'R-SERVE query_servable_places_by_signal: %', v_seen;
  end if;

  select array_agg(q.place_id) into v_seen from public.query_servable_places_by_signal_intersection(
    'w3_signal', 0, '[{"lat":1,"lng":1,"radius_m":50000}]'::jsonb, '{}', 50) q;
  if coalesce(v_seen, '{}') && v_ids then
    raise exception 'R-SERVE query_servable_places_by_signal_intersection: %', v_seen;
  end if;

  select array_agg(q.place_id) into v_seen from public.issue_1384_query_servable_places_by_signal('w3_signal', 0, 1, 1, 50000, '{}', 50) q;
  if not v_live = any(coalesce(v_seen, '{}')) or v_seen && v_ids then
    raise exception 'R-SERVE issue_1384_query_servable_places_by_signal: %', v_seen;
  end if;

  select array_agg(q.place_id) into v_seen from public.fetch_local_signal_ranked('w3_signal', 0, 'w3_signal', 0, 2, 0, 2) q;
  if coalesce(v_seen, '{}') && v_ids then
    raise exception 'R-SERVE fetch_local_signal_ranked: %', v_seen;
  end if;

  select array_agg(q.id) into v_seen from public.search_plan_places('W3', 1, 1, 50) q;
  if coalesce(v_seen, '{}') && v_ids then
    raise exception 'R-SERVE search_plan_places: %', v_seen;
  end if;
  if exists (
    select 1 from public.place_discovery_range_for_viewer('42763000-0000-4000-b000-000000000002') r
    where r.price_range_status is distinct from 'unavailable' and r.source_min_minor is not null
  ) then
    raise exception 'R-SERVE place_discovery_range_for_viewer returned a price for a held place';
  end if;

  -- The paths that count a NULL as usable, by source: they must also name the hold.
  if (select prosrc from pg_proc where oid = 'public.local_place_candidates(text)'::regprocedure) not like '%NOT p.serving_hold%' then
    raise exception 'R-SERVE local_place_candidates does not exclude held places';
  end if;
  if (select prosrc from pg_proc where oid = 'public.issue_3872_local_place_conflict(uuid,uuid)'::regprocedure) not like '%v_place.serving_hold%' then
    raise exception 'R-SERVE issue_3872_local_place_conflict does not exclude held places';
  end if;
end $$;

-- ── R-RELEASE ───────────────────────────────────────────────────────────────
do $$
declare v jsonb;
begin
  v := public.city_pipeline_release_places('42763000-0000-4000-a000-000000000001');
  if (v ->> 'released')::int <> 0 or (v ->> 'rejected')::int <> 1 or (v ->> 'unfinished')::int <> 2 then
    raise exception 'R-RELEASE: with no AI result nothing may go live: %', v;
  end if;
  if (select serving_hold from public.place_pool where id = '42763000-0000-4000-b000-000000000004') then
    raise exception 'R-RELEASE: a rejected place should stop being held';
  end if;
  if (select is_servable from public.place_pool where id = '42763000-0000-4000-b000-000000000004') is not false then
    raise exception 'R-RELEASE: a rejected place must stay unservable';
  end if;

  update public.place_pool set ai_signal_scores = '{"w3_signal":{"score_0_to_100":80}}'::jsonb
   where id = '42763000-0000-4000-b000-000000000002';
  v := public.city_pipeline_release_places('42763000-0000-4000-a000-000000000001');
  if (v ->> 'released')::int <> 1 or (v ->> 'unfinished')::int <> 1 then
    raise exception 'R-RELEASE: the finished place should go live: %', v;
  end if;
  if (select is_servable from public.place_pool where id = '42763000-0000-4000-b000-000000000002') is not true then
    raise exception 'R-RELEASE: is_servable should be true after release';
  end if;
  if (select held_final_check_passed from public.place_pool where id = '42763000-0000-4000-b000-000000000002') is not null then
    raise exception 'R-RELEASE: the parked verdict should be cleared';
  end if;

  -- Still never judged: rules only can't invent a pass.
  v := public.city_pipeline_release_places('42763000-0000-4000-a000-000000000001', true);
  if (v ->> 'released')::int <> 0 or (v ->> 'unfinished')::int <> 1 then
    raise exception 'R-RELEASE: rules only must not release an unjudged place: %', v;
  end if;
  update public.place_pool set is_servable = true where id = '42763000-0000-4000-b000-000000000003';
  v := public.city_pipeline_release_places('42763000-0000-4000-a000-000000000001', true);
  if (v ->> 'released')::int <> 1 or (v ->> 'unfinished')::int <> 0 then
    raise exception 'R-RELEASE: rules only releases a passed place: %', v;
  end if;
end $$;

-- ── R-TICK, before any run ──────────────────────────────────────────────────
do $$
begin
  perform public.tg_kick_city_pipeline();
  if coalesce(nullif(current_setting('t4276.posts', true), ''), '0')::int <> 0 then
    raise exception 'R-TICK: an idle cron must post nothing';
  end if;
end $$;

-- ── R-RUN ───────────────────────────────────────────────────────────────────
do $$
declare v_a uuid; v_b uuid; c public.city_pipeline_runs%rowtype;
begin
  begin
    perform public.city_pipeline_start('42763000-0000-4000-a000-000000000001', '42763000-0000-4000-e000-000000000002', 'new_only', 10);
    raise exception 'R-RUN: a revoked admin must not start a run';
  exception when sqlstate 'PT403' then null;
  end;

  v_a := public.city_pipeline_start('42763000-0000-4000-a000-000000000001', '42763000-0000-4000-e000-000000000001', 'new_only', 10);
  begin
    perform public.city_pipeline_start('42763000-0000-4000-a000-000000000001', '42763000-0000-4000-e000-000000000001', 'new_only', 10);
    raise exception 'R-RUN: one run per city';
  exception when sqlstate 'PT409' then null;
  end;
  if (select count(*) from public.city_pipeline_stages where run_id = v_a) <> 11 then
    raise exception 'R-RUN: every stage should exist';
  end if;

  v_b := public.city_pipeline_start('42763000-0000-4000-a000-000000000002', '42763000-0000-4000-e000-000000000001', 'new_only', 10, true);
  if (select current_stage from public.city_pipeline_runs where id = v_b) <> 'pre_check' then
    raise exception 'R-RUN: skipping searches starts at the pre-check';
  end if;
  if (select count(*) from public.city_pipeline_stages where run_id = v_b and status = 'skipped') <> 4 then
    raise exception 'R-RUN: four search stages should be skipped';
  end if;

  -- R-TICK: a waiting run gets a post, and one lease at a time.
  perform public.tg_kick_city_pipeline();
  if current_setting('t4276.posts', true)::int <> 1 or current_setting('t4276.last_url', true) not like '%/functions/v1/run-city-pipeline' then
    raise exception 'R-TICK: a waiting run should get one post';
  end if;

  select * into c from public.city_pipeline_claim_tick(170);
  if c.id is distinct from v_a or c.status <> 'running' then
    raise exception 'R-TICK: the oldest run should be promoted and leased, got %', c.id;
  end if;
  select * into c from public.city_pipeline_claim_tick(170);
  if c.id is not null then
    raise exception 'R-TICK: a leased run must not be leased twice, and one city runs at a time';
  end if;
  if (select status from public.city_pipeline_runs where id = v_b) <> 'queued' then
    raise exception 'R-RUN: the second city must wait';
  end if;

  update public.city_pipeline_runs set lease_until = now() - interval '1 second' where id = v_a;
  select * into c from public.city_pipeline_claim_tick(170);
  if c.id is distinct from v_a then
    raise exception 'R-TICK: an expired lease should be taken again';
  end if;

  update public.city_pipeline_runs set status = 'cancelled' where id in (v_a, v_b);
end $$;

-- ── R-CLAIM ─────────────────────────────────────────────────────────────────
insert into public.seeding_runs (id, city_id, selected_categories, total_tiles, total_batches, status)
values ('42763000-0000-4000-c000-000000000001', '42763000-0000-4000-a000-000000000001', array['nature'], 1, 3, 'ready');
insert into public.seeding_tiles (id, city_id, tile_index, center_lat, center_lng, radius_m, row_idx, col_idx)
values ('42763000-0000-4000-d000-000000000001', '42763000-0000-4000-a000-000000000001', 9000, 1, 1, 1500, 0, 0);
insert into public.seeding_batches (run_id, city_id, tile_id, tile_index, seeding_category, app_category, search_config_id, batch_index, status)
select '42763000-0000-4000-c000-000000000001', '42763000-0000-4000-a000-000000000001', '42763000-0000-4000-d000-000000000001', 9000, 'nature', 'Nature', 'nature_views', g, 'pending'
from generate_series(0, 2) g;

do $$
declare
  a public.seeding_batches%rowtype;
  b public.seeding_batches%rowtype;
  c public.seeding_batches%rowtype;
  v jsonb;
  r public.seeding_runs%rowtype;
begin
  select * into a from public.seeding_claim_next_batch('42763000-0000-4000-c000-000000000001', 300);
  select * into b from public.seeding_claim_next_batch('42763000-0000-4000-c000-000000000001', 300);
  if a.id = b.id or a.batch_index <> 0 or b.batch_index <> 1 then
    raise exception 'R-CLAIM: two claims must get two searches';
  end if;

  -- The first worker hangs. Its search comes back after the timeout.
  update public.seeding_batches set started_at = now() - interval '10 minutes' where id = a.id;
  select * into c from public.seeding_claim_next_batch('42763000-0000-4000-c000-000000000001', 300);
  if c.id <> a.id or c.claim_token = a.claim_token or c.reclaim_count <> 1 then
    raise exception 'R-CLAIM: a stale search should be reclaimed with a new token';
  end if;

  v := public.seeding_finish_batch(a.id, a.claim_token, 'completed', 1, 0.032, 5, 0, 0, 0, 5, 0, null, null);
  if (v ->> 'applied')::boolean then
    raise exception 'R-CLAIM: the hung worker must finish nothing: %', v;
  end if;
  select * into r from public.seeding_runs where id = '42763000-0000-4000-c000-000000000001';
  if r.completed_batches <> 0 or r.total_places_new <> 0 or r.total_api_calls <> 0 then
    raise exception 'R-CLAIM: a stale finish must count nothing';
  end if;

  v := public.seeding_finish_batch(a.id, c.claim_token, 'completed', 1, 0.032, 5, 0, 0, 0, 5, 0, null, null);
  if not (v ->> 'applied')::boolean or (v ->> 'completed_batches')::int <> 1 then
    raise exception 'R-CLAIM: the holder of the token finishes it: %', v;
  end if;
  v := public.seeding_finish_batch(a.id, c.claim_token, 'completed', 1, 0.032, 5, 0, 0, 0, 5, 0, null, null);
  if (v ->> 'applied')::boolean then
    raise exception 'R-CLAIM: finishing twice must count once';
  end if;
  select * into r from public.seeding_runs where id = '42763000-0000-4000-c000-000000000001';
  if r.completed_batches <> 1 or r.total_places_new <> 5 or r.total_api_calls <> 1 then
    raise exception 'R-CLAIM: counted once expected, got % % %', r.completed_batches, r.total_places_new, r.total_api_calls;
  end if;

  -- ── R-RETRY ──
  v := public.seeding_finish_batch(b.id, b.claim_token, 'failed', 1, 0.032, 0, 0, 0, 0, 0, 0, 'Google API 500', null);
  select * into r from public.seeding_runs where id = '42763000-0000-4000-c000-000000000001';
  if r.failed_batches <> 1 or r.status <> 'paused' then
    raise exception 'R-RETRY: a failure counts and the run waits';
  end if;
  select * into c from public.seeding_claim_next_batch('42763000-0000-4000-c000-000000000001', 300);
  v := public.seeding_finish_batch(c.id, c.claim_token, 'completed', 1, 0.032, 2, 0, 0, 0, 2, 0, null, null);

  select * into c from public.seeding_claim_retry_batch('42763000-0000-4000-c000-000000000001', b.id);
  if c.id is distinct from b.id or not c.is_retry_claim then
    raise exception 'R-RETRY: a failed search can be claimed for retry';
  end if;
  v := public.seeding_finish_batch(c.id, c.claim_token, 'completed', 1, 0.032, 4, 0, 0, 0, 4, 0, null, null);
  select * into r from public.seeding_runs where id = '42763000-0000-4000-c000-000000000001';
  if r.failed_batches <> 0 or r.completed_batches <> 3 or r.total_places_new <> 11 or r.status <> 'completed' then
    raise exception 'R-RETRY: expected a clean finish, got % % % %', r.failed_batches, r.completed_batches, r.total_places_new, r.status;
  end if;
  if r.total_api_calls <> 4 then
    raise exception 'R-RETRY: every call Google was sent counts, got %', r.total_api_calls;
  end if;
end $$;

-- ── R-SPEND ─────────────────────────────────────────────────────────────────
insert into public.api_health_services (service_key, display_name, category)
values ('serper', 'Serper', 'discovery'), ('gemini', 'Gemini', 'ai'), ('google_places', 'Google Places', 'maps')
on conflict (service_key) do nothing;

insert into public.place_intelligence_runs (id, city_id, city_name, mode, sample_size, total_count, processed_count, status, cost_so_far_usd, estimated_cost_usd, estimated_minutes, prompt_version, model, serper_requests)
values
  ('42763000-0000-4000-f000-000000000001', '42763000-0000-4000-a000-000000000001', 'W3 A', 'remainder', null, 10, 10, 'complete', 0.05, 0.089, 5, 'v4', 'm', 30),
  ('42763000-0000-4000-f000-000000000002', '42763000-0000-4000-a000-000000000001', 'W3 A', 'drift_reeval', 1, 1, 1, 'complete', 0.004, 0.0089, 1, 'v4', 'm', 3);

do $$
declare v jsonb; v_row jsonb;
begin
  update public.city_pipeline_settings set serper_usd_per_request = null;
  v := public.city_pipeline_spend_ledger('42763000-0000-4000-a000-000000000001');
  if (v ->> 'serper_cost_known')::boolean or (v ->> 'serper_requests')::int <> 33 then
    raise exception 'R-SPEND: Serper counts requests and its cost stays unknown: %', v;
  end if;
  select r into v_row from jsonb_array_elements(v -> 'rows') r where r ->> 'provider' = 'serper' and r ->> 'stage' = 'intelligence';
  if v_row ->> 'actual_usd' is not null or (v_row ->> 'units')::int <> 30 then
    raise exception 'R-SPEND: no invented rate: %', v_row;
  end if;
  select r into v_row from jsonb_array_elements(v -> 'rows') r where r ->> 'provider' = 'gemini' and r ->> 'stage' = 'automatic_reeval';
  if (v_row ->> 'actual_usd')::numeric <> 0.004 then
    raise exception 'R-SPEND: automatic re-evaluation has its own row: %', v_row;
  end if;
  select r into v_row from jsonb_array_elements(v -> 'rows') r where r ->> 'provider' = 'google' and r ->> 'stage' = 'seed';
  if (v_row ->> 'actual_usd')::numeric < 0.128 then
    raise exception 'R-SPEND: search spend reads the run: %', v_row;
  end if;

  update public.city_pipeline_settings set serper_usd_per_request = 0.001;
  v := public.city_pipeline_spend_ledger('42763000-0000-4000-a000-000000000001');
  select r into v_row from jsonb_array_elements(v -> 'rows') r where r ->> 'provider' = 'serper' and r ->> 'stage' = 'intelligence';
  if (v_row ->> 'actual_usd')::numeric <> 0.030 then
    raise exception 'R-SPEND: a configured rate prices the requests: %', v_row;
  end if;
  update public.city_pipeline_settings set serper_usd_per_request = null;
end $$;

-- ── R-RESUME ────────────────────────────────────────────────────────────────
update public.place_intelligence_runs set status = 'complete'
 where status in ('pending', 'queued', 'running', 'paused', 'cancelling');
delete from public.api_health_checks where service_key in ('serper', 'gemini');

insert into public.place_intelligence_runs (id, city_id, city_name, mode, sample_size, total_count, status, estimated_cost_usd, estimated_minutes, prompt_version, model, error_reason, paused_at)
values
  ('42763000-0000-4000-f000-000000000003', '42763000-0000-4000-a000-000000000001', 'W3 A', 'drift_reeval', 1, 1, 'paused', 0.0089, 1, 'v4', 'm', 'review_provider_out_of_credits', now()),
  ('42763000-0000-4000-f000-000000000004', '42763000-0000-4000-a000-000000000002', 'W3 B', 'remainder', null, 100, 'paused', 0.89, 1, 'v4', 'm', 'review_provider_out_of_credits', now());

insert into public.place_pool (id, google_place_id, name, lat, lng, types, is_active, is_servable, city_id, fetched_via, ai_signal_scores)
values ('42763000-0000-4000-b000-000000000006', 'gp-w3-drift', 'W3 Drift', 1, 1, array['bar'], true, true, '42763000-0000-4000-a000-000000000001', 'nearby_search', '{"w3_signal":{"score_0_to_100":50}}'::jsonb),
       ('42763000-0000-4000-b000-000000000007', 'gp-w3-gone', 'W3 Gone', 1, 1, array['bar'], true, false, '42763000-0000-4000-a000-000000000001', 'nearby_search', null);

do $$
begin
  -- Still out of credits, and an older healthy check doesn't count.
  insert into public.api_health_checks (service_key, layer, status, checked_at) values ('serper', 'synthetic', 'healthy', now() - interval '1 hour');
  if public.place_intel_auto_resume_system_runs() <> 0 then
    raise exception 'R-RESUME: a check older than the pause proves nothing';
  end if;
  insert into public.api_health_checks (service_key, layer, status, http_status, checked_at) values ('serper', 'synthetic', 'down', 400, now() + interval '1 second');
  if public.place_intel_auto_resume_system_runs() <> 0 then
    raise exception 'R-RESUME: still down, so nothing resumes';
  end if;

  -- ── R-PILE: while it waits, more drift becomes an event, not another run. ──
  update public.place_pool set generative_summary = 'new words' where id = '42763000-0000-4000-b000-000000000006';
  if (select count(*) from public.place_intelligence_runs where city_id = '42763000-0000-4000-a000-000000000001' and mode = 'drift_reeval' and status in ('queued', 'paused')) <> 1 then
    raise exception 'R-PILE: at most one waiting system run per city';
  end if;
  if (select count(*) from public.place_drift_queue_events where place_id = '42763000-0000-4000-b000-000000000006' and handled_at is null) <> 1 then
    raise exception 'R-PILE: the drift should wait as an event';
  end if;
  if public.place_intel_requeue_skipped_drift() <> 0 then
    raise exception 'R-REQUEUE: an unhealthy provider must spend nothing';
  end if;

  -- now() is fixed inside a transaction, so this check is dated just after the pause.
  insert into public.api_health_checks (service_key, layer, status, checked_at) values ('serper', 'synthetic', 'healthy', now() + interval '2 seconds');
  if public.place_intel_auto_resume_system_runs() <> 1 then
    raise exception 'R-RESUME: a newer healthy check should resume the system run, and only it';
  end if;
end $$;

do $$
begin
  if (select status from public.place_intelligence_runs where id = '42763000-0000-4000-f000-000000000003') <> 'queued' then
    raise exception 'R-RESUME: the system run should be queued';
  end if;
  if (select next_auto_resume_at from public.place_intelligence_runs where id = '42763000-0000-4000-f000-000000000003') <= now() then
    raise exception 'R-RESUME: a resume sets a backoff for the next try';
  end if;
  if (select status from public.place_intelligence_runs where id = '42763000-0000-4000-f000-000000000004') <> 'paused' then
    raise exception 'R-RESUME: an operator run stays manual';
  end if;
end $$;

-- ── R-REQUEUE ───────────────────────────────────────────────────────────────
insert into public.place_drift_queue_events (place_id, city_id, drift_kind, outcome)
values ('42763000-0000-4000-b000-000000000006', '42763000-0000-4000-a000-000000000001', 'business_status', 'skipped_active_run'),
       ('42763000-0000-4000-b000-000000000007', '42763000-0000-4000-a000-000000000002', 'business_status', 'skipped_active_run');

do $$
begin
  insert into public.api_health_checks (service_key, layer, status, checked_at) values ('gemini', 'synthetic', 'healthy', now());

  -- City A's run still holds it, and B's operator run is paused there too.
  if public.place_intel_requeue_skipped_drift() <> 0 then
    raise exception 'R-REQUEUE: a busy city waits';
  end if;

  update public.place_intelligence_runs set status = 'complete' where id in ('42763000-0000-4000-f000-000000000003', '42763000-0000-4000-f000-000000000004');

  update public.city_pipeline_settings set auto_reeval_daily_cap = 0;
  if public.place_intel_requeue_skipped_drift() <> 0 then
    raise exception 'R-REQUEUE: the daily cap applies';
  end if;
  update public.city_pipeline_settings set auto_reeval_daily_cap = 200;

  if public.place_intel_requeue_skipped_drift() <> 1 then
    raise exception 'R-REQUEUE: the free city''s eligible place should be re-queued';
  end if;
  if exists (select 1 from public.place_drift_queue_events where place_id = '42763000-0000-4000-b000-000000000006' and handled_at is null) then
    raise exception 'R-REQUEUE: every event for that place should be handled together';
  end if;
  if (select handled_outcome from public.place_drift_queue_events where place_id = '42763000-0000-4000-b000-000000000007' limit 1) <> 'not_eligible' then
    raise exception 'R-REQUEUE: a place no longer servable is marked, not re-queued';
  end if;
  if not exists (
    select 1 from public.place_intelligence_trial_runs t
    join public.place_intelligence_runs r on r.id = t.parent_run_id
    where t.place_pool_id = '42763000-0000-4000-b000-000000000006'
      and r.mode = 'drift_reeval' and r.status = 'queued' and t.source = 'auto-refresh-drift'
  ) then
    raise exception 'R-REQUEUE: a queued system run with its child should exist';
  end if;
end $$;

-- ── R-STALL ─────────────────────────────────────────────────────────────────
update public.place_intelligence_runs set status = 'complete'
 where status in ('pending', 'queued', 'running', 'paused', 'cancelling');
delete from public.place_drift_queue_events;

insert into public.seeding_cities (id, google_place_id, name, country, country_code, center_lat, center_lng, bbox_sw_lat, bbox_sw_lng, bbox_ne_lat, bbox_ne_lng, status)
select ('42763000-0000-4000-a000-00000000010' || g)::uuid, 'gp-4276w3-s' || g, 'W3 S' || g, 'Testland', 'TL', 40 + g, 40, 40 + g, 40, 40.5 + g, 40.5, 'draft'
from generate_series(1, 5) g;

insert into public.place_intelligence_runs (id, city_id, city_name, mode, total_count, processed_count, status, estimated_cost_usd, estimated_minutes, prompt_version, model, created_at, started_at, last_progress_at, last_progress_count, last_kicked_at)
select ('42763000-0000-4000-f000-00000000010' || g)::uuid, ('42763000-0000-4000-a000-00000000010' || g)::uuid, 'W3 S' || g, 'remainder', 100, 7, 'running', 1, 1, 'v4', 'm',
       now() - interval '2 hours', now() - interval '2 hours', now() - interval '2 hours', 7, now() - interval '2 hours'
from generate_series(1, 4) g;

insert into public.place_intelligence_runs (id, city_id, city_name, mode, sample_size, total_count, processed_count, status, estimated_cost_usd, estimated_minutes, prompt_version, model, created_at)
values ('42763000-0000-4000-f000-000000000105', '42763000-0000-4000-a000-000000000105', 'W3 S5', 'remainder', null, 5, 0, 'queued', 1, 1, 'v4', 'm', now());

do $$
begin
  perform public.tg_kick_pending_trial_runs();

  if (select count(*) from public.place_intelligence_runs where id::text like '42763000-0000-4000-f000-00000000010%' and status = 'paused' and error_reason = 'stalled_no_progress') <> 4 then
    raise exception 'R-STALL: four stuck operator runs should pause and say why';
  end if;
  if (select status from public.place_intelligence_runs where id = '42763000-0000-4000-f000-000000000105') <> 'running' then
    raise exception 'R-STALL: the waiting run should get a slot';
  end if;

  -- A stuck run that makes progress is not stuck.
  update public.place_intelligence_runs set status = 'running', processed_count = 9, last_progress_at = now() - interval '2 hours', last_progress_count = 7
   where id = '42763000-0000-4000-f000-000000000101';
  perform public.place_intel_reap_stalled_runs();
  if (select status from public.place_intelligence_runs where id = '42763000-0000-4000-f000-000000000101') <> 'running' then
    raise exception 'R-STALL: progress should reset the clock';
  end if;

  -- A stuck system run fails, and its child with it.
  update public.place_intelligence_runs set mode = 'drift_reeval', sample_size = 1, last_progress_at = now() - interval '2 hours'
   where id = '42763000-0000-4000-f000-000000000101';
  insert into public.place_intelligence_trial_runs (run_id, parent_run_id, place_pool_id, city_id, input_payload, status, prompt_version, model, retry_count, source)
  values ('42763000-0000-4000-f000-000000000101', '42763000-0000-4000-f000-000000000101', '42763000-0000-4000-b000-000000000001', '42763000-0000-4000-a000-000000000101', '{}', 'pending', 'v4', 'm', 0, 'auto-refresh-drift');
  perform public.place_intel_reap_stalled_runs();
  if (select status from public.place_intelligence_runs where id = '42763000-0000-4000-f000-000000000101') <> 'failed' then
    raise exception 'R-STALL: a stuck system run should fail';
  end if;
  if exists (select 1 from public.place_intelligence_trial_runs where parent_run_id = '42763000-0000-4000-f000-000000000101' and status = 'pending') then
    raise exception 'R-STALL: its child should not stay pending';
  end if;

  -- Re-kicks go to the least recently kicked, not the oldest created.
  update public.place_intelligence_runs set status = 'complete' where status in ('running', 'queued', 'paused');
  update public.place_intelligence_runs
     set status = 'running', mode = 'remainder', sample_size = null, last_heartbeat_at = now() - interval '10 minutes',
         last_progress_at = now(), last_progress_count = processed_count,
         last_kicked_at = now() - (interval '10 minutes' * (6 - right(id::text, 1)::int))
   where id::text like '42763000-0000-4000-f000-00000000010%';
  update public.place_intelligence_runs set created_at = now() - interval '9 hours' where id = '42763000-0000-4000-f000-000000000105';
  perform public.tg_kick_pending_trial_runs();
  if (select last_kicked_at < now() - interval '1 minute' from public.place_intelligence_runs where id = '42763000-0000-4000-f000-000000000105') is not true then
    raise exception 'R-STALL: the most recently kicked waits its turn, however old';
  end if;
  if (select last_kicked_at >= now() from public.place_intelligence_runs where id = '42763000-0000-4000-f000-000000000101') is not true then
    raise exception 'R-STALL: the longest-waiting run should be kicked';
  end if;
end $$;

-- ── Grants ──────────────────────────────────────────────────────────────────
do $$
declare f text;
begin
  foreach f in array array[
    'public.city_pipeline_start(uuid,uuid,text,numeric,boolean,boolean)',
    'public.city_pipeline_release_places(uuid,boolean)',
    'public.city_pipeline_claim_tick(integer)',
    'public.seeding_finish_batch(uuid,uuid,text,integer,double precision,integer,integer,integer,integer,integer,integer,text,jsonb)',
    'public.tg_kick_city_pipeline()'
  ] loop
    if has_function_privilege('authenticated', f, 'execute') or has_function_privilege('anon', f, 'execute') then
      raise exception 'R-GRANT: % must be out of reach of users', f;
    end if;
  end loop;
end $$;

rollback;
\echo ok issue_4276_city_pipeline
