-- Issue #4276 (round 6): implementor proof for 20280419044276_issue_4276_gap_counts_match_the_work.sql.
--
-- MINGLA-INVARIANT: I-4276-GAP-COUNTS-ARE-THE-WORK | issue #4276 | Each gaps-table count is the number of places or searches its stage would really take, counted place by place, never a difference of two totals
--
--   G-PHOTOS   photos_needed counts places that passed the pre-check with no real
--              photos, including ones holding only '__backfill_failed__'; a place with
--              photos that never passed the pre-check is not counted, nor is it allowed
--              to cancel one that is (Miami: 3,638 shown, 3,688 waiting)
--   G-FINAL    final_check_needed counts places with real photos the final check has
--              not judged (is_servable null)
--   G-LEGACY   THE REPEATED-SEARCH BUG STAYS VISIBLE. Three casual_eats searches on a
--              tile recorded 'first_config' are the first config run three times (from
--              2026-04-16 the worker resolved every category to its first config), so
--              casual_eats_world and casual_eats_extended are still owed; two
--              nature_views repeats leave picnic_park owed. A repeated first config never
--              counts as any other config done (London owes 768, not 0)
--   G-ORDER    a search recorded under its own config counts only for that one
--
-- FAILS-ON-REVERT: re-run the 20280413004276 funnel and G-PHOTOS and G-FINAL fail (no
-- such fields). Count k 'first_config' repeats as the slug's first k configs (the
-- round-6 rule) and G-LEGACY fails with tile 1 owing nothing.
--
-- Run from the repository root as supabase_admin. Everything is rolled back.

\set ON_ERROR_STOP on
begin;

insert into public.admin_users (email, status)
values ('admin.gap4276@test.local', 'active')
on conflict (email) do update set status = 'active';
insert into auth.users (id, email, aud, role)
values ('a4276700-0000-4000-c000-000000000001', 'admin.gap4276@test.local', 'authenticated', 'authenticated');

insert into public.seeding_cities (id, google_place_id, name, country, country_code, center_lat, center_lng, bbox_sw_lat, bbox_sw_lng, bbox_ne_lat, bbox_ne_lng, status)
values ('a4276700-0000-4000-a000-000000000001', 'gp-city-gap4276', 'Gap City 4276', 'Testland', 'TL', 1, 1, 0, 0, 2, 2, 'draft');

-- Places:
--   1 passed, no photos                          photos_needed
--   2 passed, only the failed-download marker    photos_needed
--   3 passed, real photos, not final-checked     final_check_needed
--   4 NOT passed, real photos, final-checked     neither (it inflated with_photos)
--   5 passed, real photos, final-checked         neither
insert into public.place_pool (id, google_place_id, name, lat, lng, types, primary_type, is_active, city_id, fetched_via,
  pre_photo_bouncer_validated_at, passes_pre_photo_check, stored_photo_urls, bouncer_validated_at, is_servable)
values
  ('a4276700-0000-4000-b000-000000000001', 'gp-gap4276-1', 'One', 1, 1, array['cafe'], 'cafe', true, 'a4276700-0000-4000-a000-000000000001', 'nearby_search', now(), true, null, null, null),
  ('a4276700-0000-4000-b000-000000000002', 'gp-gap4276-2', 'Two', 1, 1, array['cafe'], 'cafe', true, 'a4276700-0000-4000-a000-000000000001', 'nearby_search', now(), true, array['__backfill_failed__'], null, null),
  ('a4276700-0000-4000-b000-000000000003', 'gp-gap4276-3', 'Three', 1, 1, array['cafe'], 'cafe', true, 'a4276700-0000-4000-a000-000000000001', 'nearby_search', now(), true, array['https://x.test/3.jpg'], null, null),
  ('a4276700-0000-4000-b000-000000000004', 'gp-gap4276-4', 'Four', 1, 1, array['cafe'], 'cafe', true, 'a4276700-0000-4000-a000-000000000001', 'nearby_search', now(), false, array['https://x.test/4a.jpg', 'https://x.test/4b.jpg'], now(), false),
  ('a4276700-0000-4000-b000-000000000005', 'gp-gap4276-5', 'Five', 1, 1, array['cafe'], 'cafe', true, 'a4276700-0000-4000-a000-000000000001', 'nearby_search', now(), true, array['https://x.test/5.jpg'], now(), true);

select set_config('request.jwt.claim.sub', 'a4276700-0000-4000-c000-000000000001', true);
select set_config('request.jwt.claims', '{"sub":"a4276700-0000-4000-c000-000000000001","role":"authenticated"}', true);
set local role authenticated;
do $$
declare
  c jsonb := public.admin_place_pipeline_funnel('a4276700-0000-4000-a000-000000000001') -> 'cities' -> 0;
begin
  -- The old difference: pre_passed 4 - with_photos 4 = 0, though two places wait for photos.
  if (c ->> 'pre_passed')::int - (c ->> 'with_photos')::int <> 0 then raise exception 'fixture: %', c; end if;
  if (c ->> 'photos_needed')::int is distinct from 2 then raise exception 'G-PHOTOS: %', c; end if;
  if (c ->> 'final_check_needed')::int is distinct from 1 then raise exception 'G-FINAL: %', c; end if;
end $$;
reset role;

-- G-LEGACY, G-ORDER: tile 1 has legacy searches (3 casual eats, 1 nature), tile 2 has one
-- search recorded under casual_eats_world itself.
insert into public.seeding_tiles (id, city_id, tile_index, center_lat, center_lng, radius_m, row_idx, col_idx)
values ('a4276700-0000-4000-d000-000000000001', 'a4276700-0000-4000-a000-000000000001', 0, 1, 1, 1500, 0, 0),
       ('a4276700-0000-4000-d000-000000000002', 'a4276700-0000-4000-a000-000000000001', 1, 1.1, 1, 1500, 1, 0);
insert into public.seeding_runs (id, city_id, selected_categories, total_tiles, total_batches, status)
values ('a4276700-0000-4000-e000-000000000001', 'a4276700-0000-4000-a000-000000000001', array['nature'], 2, 5, 'completed');
insert into public.seeding_batches (run_id, city_id, tile_id, tile_index, seeding_category, app_category, batch_index, status, search_config_id, config_attribution, google_api_calls)
values
  ('a4276700-0000-4000-e000-000000000001', 'a4276700-0000-4000-a000-000000000001', 'a4276700-0000-4000-d000-000000000001', 0, 'brunch_lunch_casual', 'x', 0, 'completed', 'casual_eats', 'first_config', 1),
  ('a4276700-0000-4000-e000-000000000001', 'a4276700-0000-4000-a000-000000000001', 'a4276700-0000-4000-d000-000000000001', 0, 'brunch_lunch_casual', 'x', 1, 'completed', 'casual_eats', 'first_config', 1),
  ('a4276700-0000-4000-e000-000000000001', 'a4276700-0000-4000-a000-000000000001', 'a4276700-0000-4000-d000-000000000001', 0, 'brunch_lunch_casual', 'x', 2, 'completed', 'casual_eats', 'first_config', 1),
  ('a4276700-0000-4000-e000-000000000001', 'a4276700-0000-4000-a000-000000000001', 'a4276700-0000-4000-d000-000000000001', 0, 'nature', 'x', 3, 'completed', 'nature_views', 'first_config', 1),
  ('a4276700-0000-4000-e000-000000000001', 'a4276700-0000-4000-a000-000000000001', 'a4276700-0000-4000-d000-000000000001', 0, 'nature', 'x', 5, 'completed', 'nature_views', 'first_config', 1),
  ('a4276700-0000-4000-e000-000000000001', 'a4276700-0000-4000-a000-000000000001', 'a4276700-0000-4000-d000-000000000002', 1, 'brunch_lunch_casual', 'x', 4, 'completed', 'casual_eats_world', 'batch_order', 1);

do $$
declare
  cfg constant jsonb := '[{"id":"nature_views","slug":"nature"},{"id":"picnic_park","slug":"nature"},{"id":"casual_eats","slug":"brunch_lunch_casual"},{"id":"casual_eats_world","slug":"brunch_lunch_casual"},{"id":"casual_eats_extended","slug":"brunch_lunch_casual"}]';
  t1 text[];
  t2 text[];
begin
  select array_agg(u.search_config_id order by u.search_config_id) into t1
    from public.seeding_unfinished_searches('a4276700-0000-4000-a000-000000000001', cfg) u
   where u.tile_id = 'a4276700-0000-4000-d000-000000000001';
  if t1 is distinct from array['casual_eats_extended', 'casual_eats_world', 'picnic_park'] then
    raise exception 'G-LEGACY: repeats of the first config were counted as other configs; tile 1 owes %', t1;
  end if;
  select array_agg(u.search_config_id order by u.search_config_id) into t2
    from public.seeding_unfinished_searches('a4276700-0000-4000-a000-000000000001', cfg) u
   where u.tile_id = 'a4276700-0000-4000-d000-000000000002';
  if t2 is distinct from array['casual_eats', 'casual_eats_extended', 'nature_views', 'picnic_park'] then
    raise exception 'G-ORDER: tile 2 owes %', t2;
  end if;
end $$;

select 'issue_4276_gap_counts_match_the_work: all checks passed' as result;
rollback;
