-- Issue #4276 wave 4, U2, U3 and U5. Implementor happy path on the fully replayed PG17
-- schema, for 20280413004276_issue_4276_admin_pipeline_screens.sql.
--
-- MINGLA-INVARIANT: I-4276-PIPELINE-SCREENS-SERVER-COUNTED | issue #4276 | The Place pool funnel, readiness gaps and exclusion reasons are counted by admin-only server functions, never by a browser page over a truncated list
--
--   F-STAGES   each stage counts exactly the places that reached it
--   F-GAPS     rules only, no reviews and Intelligence without reviews are counted;
--              "none on Google" counts as reviewed, a failed fetch does not
--   F-HELD     a held place is counted as held, not servable
--   F-NOCITY   an active place with no city has its own row and is in the totals
--   F-DROPPED  results dropped at seed for no photo are counted per city
--   X-RULES    exclusion reasons group by rule, for the pre-check and final check
--   A-ADMIN    a signed-in user who is not an admin is refused both
--
-- FAILS-ON-REVERT: without the migration neither function exists. Drop the
-- none_on_google clause and F-GAPS fails; drop the no-city row and F-NOCITY fails.
--
-- Run from the repository root as supabase_admin. Everything is rolled back.

\set ON_ERROR_STOP on
begin;

insert into public.admin_users (email, status)
values ('admin.w44276@test.local', 'active')
on conflict (email) do update set status = 'active';

-- is_admin_user() reads the caller's email from auth.users by auth.uid().
insert into auth.users (id, email, aud, role)
values ('a4276400-0000-4000-c000-000000000001', 'admin.w44276@test.local', 'authenticated', 'authenticated'),
       ('a4276400-0000-4000-c000-000000000002', 'nobody.w44276@test.local', 'authenticated', 'authenticated');

insert into public.seeding_cities (id, google_place_id, name, country, country_code, center_lat, center_lng, bbox_sw_lat, bbox_sw_lng, bbox_ne_lat, bbox_ne_lng, status)
values ('a4276400-0000-4000-a000-000000000001', 'gp-city-a4276', 'Funnel City 42764', 'Testland', 'TL', 1, 1, 0, 0, 2, 2, 'draft');

-- A: never checked. B: failed the pre-check (no website, no hours). C: passed the
-- pre-check, has photos, failed the final check (photos). D: servable, no reviews, no AI.
-- E: servable, reviews on file, AI, scored. F: servable, AI, review fetch said none on
-- Google. G: servable, AI, review fetch failed. H: held. I: no city.
insert into public.place_pool (id, google_place_id, name, lat, lng, types, primary_type, is_active, city_id, fetched_via,
  pre_photo_bouncer_validated_at, passes_pre_photo_check, pre_photo_bouncer_reason,
  stored_photo_urls, bouncer_validated_at, is_servable, bouncer_reason)
values
  ('a4276400-0000-4000-b000-00000000000a', 'gp-a4276-a', 'A', 1, 1, array['cafe'], 'cafe', true, 'a4276400-0000-4000-a000-000000000001', 'nearby_search', null, null, null, null, null, null, null),
  ('a4276400-0000-4000-b000-00000000000b', 'gp-a4276-b', 'B', 1, 1, array['cafe'], 'cafe', true, 'a4276400-0000-4000-a000-000000000001', 'nearby_search', now(), false, 'B4:no_website;B6:no_hours', null, null, null, null),
  ('a4276400-0000-4000-b000-00000000000c', 'gp-a4276-c', 'C', 1, 1, array['cafe'], 'cafe', true, 'a4276400-0000-4000-a000-000000000001', 'nearby_search', now(), true, null, array['https://x.test/c.jpg'], now(), false, 'B8:no_stored_photos;B1:gas_station'),
  ('a4276400-0000-4000-b000-00000000000d', 'gp-a4276-d', 'D', 1, 1, array['cafe'], 'cafe', true, 'a4276400-0000-4000-a000-000000000001', 'nearby_search', now(), true, null, array['https://x.test/d.jpg'], now(), true, null),
  ('a4276400-0000-4000-b000-00000000000e', 'gp-a4276-e', 'E', 1, 1, array['cafe'], 'cafe', true, 'a4276400-0000-4000-a000-000000000001', 'nearby_search', now(), true, null, array['https://x.test/e.jpg'], now(), true, null),
  ('a4276400-0000-4000-b000-00000000000f', 'gp-a4276-f', 'F', 1, 1, array['cafe'], 'cafe', true, 'a4276400-0000-4000-a000-000000000001', 'nearby_search', now(), true, null, array['https://x.test/f.jpg'], now(), true, null),
  ('a4276400-0000-4000-b000-000000000010', 'gp-a4276-g', 'G', 1, 1, array['cafe'], 'cafe', true, 'a4276400-0000-4000-a000-000000000001', 'nearby_search', now(), true, null, array['https://x.test/g.jpg'], now(), true, null),
  ('a4276400-0000-4000-b000-000000000011', 'gp-a4276-i', 'I', 1, 1, array['cafe'], 'cafe', true, null, 'nearby_search', null, null, null, null, null, null, null);

-- H is held from the start: its passing verdict is parked.
insert into public.place_pool (id, google_place_id, name, lat, lng, types, primary_type, is_active, city_id, fetched_via, serving_hold, is_servable)
values ('a4276400-0000-4000-b000-000000000012', 'gp-a4276-h', 'H', 1, 1, array['cafe'], 'cafe', true, 'a4276400-0000-4000-a000-000000000001', 'nearby_search', true, true);

update public.place_pool set ai_signal_scores = '{"x": {}}'::jsonb
 where id in ('a4276400-0000-4000-b000-00000000000e', 'a4276400-0000-4000-b000-00000000000f', 'a4276400-0000-4000-b000-000000000010');

insert into public.place_external_reviews (place_pool_id, source, source_review_id, review_text, rating)
values ('a4276400-0000-4000-b000-00000000000e', 'serper', 'r-42764-e', 'Lovely', 5);
insert into public.place_review_fetch_state (place_id, outcome, review_count)
values ('a4276400-0000-4000-b000-00000000000f', 'none_on_google', 0),
       ('a4276400-0000-4000-b000-000000000010', 'failed', 0);

insert into public.place_scores (place_id, signal_id, score, contributions)
select 'a4276400-0000-4000-b000-00000000000e', s.id, 50, '{}'::jsonb
from public.signal_definitions s limit 1;

insert into public.seeding_filtered_results (city_id, google_place_id, reason)
values ('a4276400-0000-4000-a000-000000000001', 'gp-a4276-dropped-1', 'no_photos'),
       ('a4276400-0000-4000-a000-000000000001', 'gp-a4276-dropped-2', 'no_photos'),
       ('a4276400-0000-4000-a000-000000000001', 'gp-a4276-closed', 'closed_permanently');

select set_config('request.jwt.claim.sub', 'a4276400-0000-4000-c000-000000000001', true);
select set_config('request.jwt.claims', '{"sub":"a4276400-0000-4000-c000-000000000001","role":"authenticated"}', true);

do $$
declare
  f jsonb := public.admin_place_pipeline_funnel('a4276400-0000-4000-a000-000000000001');
  c jsonb := f -> 'cities' -> 0;
  x jsonb := public.admin_place_excluded_summary('a4276400-0000-4000-a000-000000000001');
  all_f jsonb := public.admin_place_pipeline_funnel(null);
  nocity jsonb;
  scored_expected int := case when exists (select 1 from public.signal_definitions) then 1 else 0 end;
begin
  if jsonb_array_length(f -> 'cities') <> 1 or c ->> 'city_name' <> 'Funnel City 42764' then
    raise exception 'one city expected: %', f -> 'cities';
  end if;
  -- F-STAGES
  if (c ->> 'active')::int <> 8 then raise exception 'F-STAGES active: %', c; end if;
  if (c ->> 'pre_checked')::int <> 6 then raise exception 'F-STAGES pre_checked: %', c; end if;
  if (c ->> 'pre_passed')::int <> 5 then raise exception 'F-STAGES pre_passed: %', c; end if;
  if (c ->> 'with_photos')::int <> 5 then raise exception 'F-STAGES with_photos: %', c; end if;
  if (c ->> 'final_checked')::int <> 5 then raise exception 'F-STAGES final_checked: %', c; end if;
  if (c ->> 'servable')::int <> 4 then raise exception 'F-STAGES servable: %', c; end if;
  if (c ->> 'intelligence')::int <> 3 then raise exception 'F-STAGES intelligence: %', c; end if;
  if (c ->> 'scored')::int <> scored_expected then raise exception 'F-STAGES scored: %', c; end if;
  -- F-GAPS: D has nothing; G's failed fetch is not a review; F's none-on-Google is.
  if (c ->> 'reviews')::int <> 2 then raise exception 'F-GAPS reviews: %', c; end if;
  if (c ->> 'rules_only')::int <> 1 then raise exception 'F-GAPS rules_only: %', c; end if;
  if (c ->> 'no_reviews')::int <> 2 then raise exception 'F-GAPS no_reviews: %', c; end if;
  if (c ->> 'intelligence_without_reviews')::int <> 1 then raise exception 'F-GAPS intelligence_without_reviews: %', c; end if;
  -- F-HELD
  if (c ->> 'held')::int <> 1 then raise exception 'F-HELD: %', c; end if;
  -- F-DROPPED
  if (c ->> 'dropped_no_photos')::int <> 2 then raise exception 'F-DROPPED: %', c; end if;
  if (f -> 'totals' ->> 'active')::int <> 8 then raise exception 'totals: %', f -> 'totals'; end if;

  -- F-NOCITY
  select e into nocity from jsonb_array_elements(all_f -> 'cities') e where e ->> 'city_name' = 'No city';
  if nocity is null or (nocity ->> 'active')::int < 1 then raise exception 'F-NOCITY: no row for places with no city'; end if;
  if (all_f -> 'totals' ->> 'active')::bigint <> (select count(*) from public.place_pool where is_active) then
    raise exception 'F-NOCITY: totals % do not match every active place', all_f -> 'totals' ->> 'active';
  end if;

  -- X-RULES
  if (x ->> 'pre_check_failed')::int <> 1 or (x ->> 'final_check_failed')::int <> 1 then
    raise exception 'X-RULES counts: %', x;
  end if;
  if x -> 'pre_check' <> '[{"rule": "B4", "places": 1}, {"rule": "B6", "places": 1}]'::jsonb then
    raise exception 'X-RULES pre_check: %', x -> 'pre_check';
  end if;
  if x -> 'final_check' <> '[{"rule": "B1", "places": 1}, {"rule": "B8", "places": 1}]'::jsonb then
    raise exception 'X-RULES final_check: %', x -> 'final_check';
  end if;
  if x -> 'cities' -> 0 -> 'pre_check' <> '{"B4": 1, "B6": 1}'::jsonb then
    raise exception 'X-RULES per city: %', x -> 'cities';
  end if;
end $$;

-- A-ADMIN
select set_config('request.jwt.claim.sub', 'a4276400-0000-4000-c000-000000000002', true);
select set_config('request.jwt.claims', '{"sub":"a4276400-0000-4000-c000-000000000002","role":"authenticated"}', true);
do $$
begin
  begin
    perform public.admin_place_pipeline_funnel(null);
    raise exception 'A-ADMIN: a non-admin read the funnel';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.admin_place_excluded_summary(null);
    raise exception 'A-ADMIN: a non-admin read the exclusion summary';
  exception when insufficient_privilege then null;
  end;
  if has_function_privilege('anon', 'public.admin_place_pipeline_funnel(uuid)', 'EXECUTE') then
    raise exception 'A-ADMIN: anon can execute the funnel';
  end if;
end $$;

select 'issue_4276_admin_pipeline_screens: all checks passed' as result;
rollback;
