-- Issue #4276 wave 2, T1 to T9 and B2. Implementor happy path on the fully replayed
-- PG17 schema, for 20280410024276_issue_4276_tile_completeness.sql.
--
-- MINGLA-INVARIANT: I-4276-TILES-NEVER-DELETED | issue #4276 | A tile is taken out of use, never deleted, and every search keeps its history when its tile changes
-- MINGLA-INVARIANT: I-4276-SEARCH-RECORDS-CONFIG | issue #4276 | Every search records the config it ran, and old rows say how that was worked out
-- MINGLA-INVARIANT: I-4276-NO-SILENT-SEARCH-GAP | issue #4276 | A search that never finished, a capped search and an unresolved search are all counted for the city
--
--   R-DELETE  a direct tile delete is refused; deleting a city still cascades
--   R-HISTORY a search survives its tile being replaced, keeping its circle
--   R-CAPPED  capped is generated from places_returned, at exactly 20
--   R-ATTRIB  old rows: first config after the cutoff, position before it, position
--             for a row that never called Google, unknown past the end of the list
--   R-REPLACE retiring takes split children along; new tiles get fresh indexes;
--             an active run refuses with PT409
--   R-UNFIN   configs a repeated search never reached count as never searched, and
--             a failed split search counts until it has a finished twin
--   R-LEVEL   a level lands whole: run, tiles, batches with snapshots, parents marked;
--             a retired tile refuses the whole plan
--   R-STATUS  the city record counts capped, unresolved, dropped and checks
--   R-OUTSIDE places outside a box are counted, for stored and proposed boxes, and
--             nothing is changed
--   R-GRANTS  service role only
--
-- FAILS-ON-REVERT: without the migration none of these columns or functions exist.
-- Removing the trigger fails R-DELETE. Putting ON DELETE CASCADE back fails R-HISTORY.
-- Removing the first_config branch fails R-ATTRIB. Verified by replacing each.
--
-- Run from the repository root as supabase_admin. Everything is rolled back.

\set ON_ERROR_STOP on
begin;

insert into public.seeding_cities (id, google_place_id, name, country, country_code, center_lat, center_lng, bbox_sw_lat, bbox_sw_lng, bbox_ne_lat, bbox_ne_lng, status)
values ('42762000-0000-4000-a000-000000000001', 'gp-4276w2-a', 'W2 A', 'Testland', 'TL', 1, 1, 0, 0, 2, 2, 'draft'),
       ('42762000-0000-4000-a000-000000000002', 'gp-4276w2-b', 'W2 B', 'Testland', 'TL', 1, 1, 0, 0, 2, 2, 'draft'),
       ('42762000-0000-4000-a000-000000000003', 'gp-4276w2-c', 'W2 C', 'Testland', 'TL', 1, 1, 0, 0, 2, 2, 'draft');

insert into public.seeding_tiles (id, city_id, tile_index, center_lat, center_lng, radius_m, row_idx, col_idx)
values ('42762000-0000-4000-b000-000000000001', '42762000-0000-4000-a000-000000000001', 0, 1, 1, 1500, 0, 0),
       ('42762000-0000-4000-b000-000000000002', '42762000-0000-4000-a000-000000000001', 1, 1.1, 1, 1500, 1, 0),
       ('42762000-0000-4000-b000-000000000003', '42762000-0000-4000-a000-000000000003', 0, 1, 1, 1500, 0, 0);

insert into public.seeding_runs (id, city_id, selected_categories, total_tiles, total_batches, status)
values ('42762000-0000-4000-c000-000000000001', '42762000-0000-4000-a000-000000000001', array['nature'], 2, 2, 'completed'),
       ('42762000-0000-4000-c000-000000000003', '42762000-0000-4000-a000-000000000003', array['nature'], 1, 1, 'completed');

-- ── R-DELETE ────────────────────────────────────────────────────────────────
do $$
begin
  begin
    delete from public.seeding_tiles where id = '42762000-0000-4000-b000-000000000001';
    raise exception 'R-DELETE: a tile was deleted';
  exception when sqlstate 'PT409' then null;
  end;
  delete from public.seeding_cities where id = '42762000-0000-4000-a000-000000000003';
  if exists (select 1 from public.seeding_tiles where id = '42762000-0000-4000-b000-000000000003') then
    raise exception 'R-DELETE: deleting a city no longer cascades to its tiles';
  end if;
end $$;

-- ── R-CAPPED ────────────────────────────────────────────────────────────────
insert into public.seeding_batches (id, run_id, city_id, tile_id, tile_index, seeding_category, app_category, batch_index, status, places_returned, search_config_id, center_lat, center_lng, radius_m, google_api_calls)
values
  ('42762000-0000-4000-d000-000000000001', '42762000-0000-4000-c000-000000000001', '42762000-0000-4000-a000-000000000001', '42762000-0000-4000-b000-000000000001', 0, 'nature', 'Nature', 0, 'completed', 20, 'nature_views', 1, 1, 1500, 1),
  ('42762000-0000-4000-d000-000000000002', '42762000-0000-4000-c000-000000000001', '42762000-0000-4000-a000-000000000001', '42762000-0000-4000-b000-000000000002', 1, 'nature', 'Nature', 1, 'completed', 19, 'nature_views', 1.1, 1, 1500, 1);

do $$
begin
  if not (select capped from public.seeding_batches where id = '42762000-0000-4000-d000-000000000001') then
    raise exception 'R-CAPPED: 20 results is capped';
  end if;
  if (select capped from public.seeding_batches where id = '42762000-0000-4000-d000-000000000002') then
    raise exception 'R-CAPPED: 19 results is not capped';
  end if;
end $$;

-- ── R-ATTRIB ────────────────────────────────────────────────────────────────
-- Each case is its own tile group, as old rows are.
create temp table w2_attr (idx int, created timestamptz, cat text, calls int, want text, how text) on commit drop;
insert into w2_attr values
  (0, '2026-05-30', 'brunch_lunch_casual', 1, 'casual_eats', 'first_config'),
  (1, '2026-05-30', 'brunch_lunch_casual', 1, 'casual_eats', 'first_config'),
  (2, '2026-05-30', 'brunch_lunch_casual', 1, 'casual_eats', 'first_config'),
  (3, '2026-04-02', 'nature', 1, 'nature_views', 'batch_order'),
  (4, '2026-04-02', 'nature', 1, 'picnic_park', 'batch_order'),
  (5, '2026-05-30', 'movies_theatre', 0, 'watch', 'planned'),
  (6, '2026-05-30', 'movies_theatre', 0, 'live_performance', 'planned'),
  (7, '2026-04-02', 'play', 1, 'play', 'batch_order'),
  (8, '2026-04-02', 'play', 1, null, 'unknown');

insert into public.seeding_batches (id, run_id, city_id, tile_id, tile_index, seeding_category, app_category, batch_index, status, created_at, google_api_calls)
select ('42762000-0000-4000-e000-00000000000' || a.idx)::uuid, '42762000-0000-4000-c000-000000000001',
       '42762000-0000-4000-a000-000000000001', '42762000-0000-4000-b000-000000000002', 1, a.cat, a.cat, 100 + a.idx,
       case when a.calls = 0 then 'pending' else 'completed' end, a.created, a.calls
from w2_attr a;

do $$
declare v_bad text;
begin
  perform public.seeding_attribute_legacy_batches();
  select string_agg(a.idx::text || ':' || coalesce(b.search_config_id, 'null') || '/' || b.config_attribution, ', ') into v_bad
    from w2_attr a
    join public.seeding_batches b on b.id = ('42762000-0000-4000-e000-00000000000' || a.idx)::uuid
   where b.search_config_id is distinct from a.want or b.config_attribution <> a.how;
  if v_bad is not null then raise exception 'R-ATTRIB: %', v_bad; end if;
  if (select search_config_id from public.seeding_batches where id = '42762000-0000-4000-d000-000000000001') <> 'nature_views' then
    raise exception 'R-ATTRIB: a recorded config was overwritten';
  end if;
end $$;

delete from public.seeding_batches where id::text like '42762000-0000-4000-e000-%';

-- ── R-LEVEL ─────────────────────────────────────────────────────────────────
do $$
declare v jsonb; v_run uuid;
begin
  v := public.seeding_start_search_level(
    '42762000-0000-4000-a000-000000000001', 'split', 1, 0.128,
    jsonb_build_array(
      jsonb_build_object('id', '42762000-0000-4000-b000-000000000011', 'center_lat', 0.99, 'center_lng', 0.99, 'radius_m', 750, 'row_idx', 0, 'col_idx', 0, 'parent_tile_id', '42762000-0000-4000-b000-000000000001', 'level', 1, 'kind', 'split'),
      jsonb_build_object('id', '42762000-0000-4000-b000-000000000012', 'center_lat', 0.99, 'center_lng', 1.01, 'radius_m', 750, 'row_idx', 0, 'col_idx', 1, 'parent_tile_id', '42762000-0000-4000-b000-000000000001', 'level', 1, 'kind', 'split')
    ),
    jsonb_build_array(
      jsonb_build_object('tile_id', '42762000-0000-4000-b000-000000000011', 'seeding_category', 'nature', 'app_category', 'Nature', 'search_config_id', 'nature_views', 'level', 1),
      jsonb_build_object('tile_id', '42762000-0000-4000-b000-000000000012', 'seeding_category', 'nature', 'app_category', 'Nature', 'search_config_id', 'nature_views', 'included_types_override', jsonb_build_array('park', 'zoo'), 'level', 1)
    ),
    array['42762000-0000-4000-d000-000000000001']::uuid[],
    array[]::uuid[]
  );
  v_run := (v ->> 'run_id')::uuid;
  if (v ->> 'batches')::int <> 2 then raise exception 'R-LEVEL: %', v; end if;
  if (select tile_index from public.seeding_tiles where id = '42762000-0000-4000-b000-000000000011') <> 2 then
    raise exception 'R-LEVEL: the new tile did not get the next free index';
  end if;
  if not exists (
    select 1 from public.seeding_batches
     where run_id = v_run and tile_id = '42762000-0000-4000-b000-000000000012'
       and center_lat = 0.99 and center_lng = 1.01 and radius_m = 750 and level = 1
       and included_types_override = array['park', 'zoo'] and config_attribution = 'recorded'
  ) then raise exception 'R-LEVEL: the snapshot or the type override is wrong'; end if;
  if (select split_state from public.seeding_batches where id = '42762000-0000-4000-d000-000000000001') <> 'split' then
    raise exception 'R-LEVEL: the parent was not marked split';
  end if;
  if (select status || total_batches::text || kind from public.seeding_runs where id = v_run) <> 'ready2split' then
    raise exception 'R-LEVEL: the run row is wrong';
  end if;

  -- A second level while this run is active is refused.
  begin
    perform public.seeding_start_search_level('42762000-0000-4000-a000-000000000001', 'fill', 0, 0, '[]', jsonb_build_array(jsonb_build_object('tile_id', '42762000-0000-4000-b000-000000000002', 'seeding_category', 'nature', 'app_category', 'Nature', 'search_config_id', 'picnic_park', 'level', 0)), null, null);
    raise exception 'R-LEVEL: a second run started beside an active one';
  exception when sqlstate 'PT409' then null;
  end;

  -- So is replacing tiles.
  begin
    perform public.seeding_replace_tiles('42762000-0000-4000-a000-000000000001', array['42762000-0000-4000-b000-000000000001']::uuid[], '[]');
    raise exception 'R-REPLACE: tiles changed under an active run';
  exception when sqlstate 'PT409' then null;
  end;

  update public.seeding_runs set status = 'completed' where id = v_run;
  update public.seeding_batches set status = 'completed', google_api_calls = 1
   where run_id = v_run and tile_id = '42762000-0000-4000-b000-000000000011';
  update public.seeding_batches set status = 'failed', google_api_calls = 1
   where run_id = v_run and tile_id = '42762000-0000-4000-b000-000000000012';
end $$;

-- ── R-UNFIN ─────────────────────────────────────────────────────────────────
create temp table w2_cfg on commit drop as
select '[{"id":"nature_views","slug":"nature"},{"id":"picnic_park","slug":"nature"}]'::jsonb as cfg;

do $$
declare v_cfg jsonb := (select cfg from w2_cfg); v_got text;
begin
  -- Tile 1 ran nature_views only, tile 2 likewise, so picnic_park is owed twice.
  -- The failed split search is owed; the finished one isn't; split tiles owe nothing else.
  select string_agg(u.tile_id::text || '/' || u.search_config_id || '/' || u.reason, ' ' order by 1) into v_got
    from public.seeding_unfinished_searches('42762000-0000-4000-a000-000000000001', v_cfg) u;
  if v_got <>
     '42762000-0000-4000-b000-000000000001/picnic_park/never_searched '
     '42762000-0000-4000-b000-000000000002/picnic_park/never_searched '
     '42762000-0000-4000-b000-000000000012/nature_views/failed' then
    raise exception 'R-UNFIN: %', v_got;
  end if;
  -- A later search that finishes clears the failed one.
  insert into public.seeding_batches (run_id, city_id, tile_id, tile_index, seeding_category, app_category, batch_index, status, search_config_id, included_types_override, level, google_api_calls)
  values ('42762000-0000-4000-c000-000000000001', '42762000-0000-4000-a000-000000000001', '42762000-0000-4000-b000-000000000012', 3, 'nature', 'Nature', 500, 'completed', 'nature_views', array['park', 'zoo'], 1, 1);
  if exists (select 1 from public.seeding_unfinished_searches('42762000-0000-4000-a000-000000000001', v_cfg) u where u.tile_id = '42762000-0000-4000-b000-000000000012') then
    raise exception 'R-UNFIN: a finished retry did not clear the failed search';
  end if;
end $$;

-- ── R-STATUS ────────────────────────────────────────────────────────────────
do $$
declare v jsonb;
begin
  update public.seeding_batches set places_returned = 20, split_state = 'unresolved'
   where tile_id = '42762000-0000-4000-b000-000000000011';
  update public.seeding_batches set places_returned = 20
   where id = '42762000-0000-4000-d000-000000000002';
  insert into public.seeding_filtered_results (city_id, google_place_id, reason) values
    ('42762000-0000-4000-a000-000000000001', 'gp-x', 'no_photos'),
    ('42762000-0000-4000-a000-000000000001', 'gp-y', 'closed_permanently');
  insert into public.seeding_completeness_checks (city_id, status, searches_planned, radius_m, missing_share)
  values ('42762000-0000-4000-a000-000000000001', 'completed', 20, 300, 0.25);
  v := public.seeding_city_search_status('42762000-0000-4000-a000-000000000001', (select cfg from w2_cfg));
  if (v #>> '{tiles,active}')::int <> 4 or (v #>> '{tiles,split}')::int <> 2 then raise exception 'R-STATUS tiles: %', v -> 'tiles'; end if;
  if (v #>> '{unfinished,never_searched}')::int <> 2 then raise exception 'R-STATUS unfinished: %', v -> 'unfinished'; end if;
  if (v ->> 'capped_open')::int <> 1 then raise exception 'R-STATUS capped: %', v -> 'capped_open'; end if;
  if jsonb_array_length(v -> 'unresolved') <> 1 then raise exception 'R-STATUS unresolved: %', v -> 'unresolved'; end if;
  if (v #>> '{dropped_at_seed,no_photos}')::int <> 1 or (v #>> '{dropped_at_seed,closed_permanently}')::int <> 1 then raise exception 'R-STATUS dropped'; end if;
  if (v #>> '{last_completeness_check,missing_share}')::float <> 0.25 then raise exception 'R-STATUS check'; end if;
  if jsonb_array_length(v -> 'levels') <> 1 or (v #>> '{levels,0,kind}') <> 'split' then raise exception 'R-STATUS levels: %', v -> 'levels'; end if;
  if v -> 'active_run' <> 'null'::jsonb then raise exception 'R-STATUS active run: %', v -> 'active_run'; end if;
end $$;

-- ── R-REPLACE and R-HISTORY ─────────────────────────────────────────────────
do $$
declare v jsonb; v_max int;
begin
  select max(tile_index) into v_max from public.seeding_tiles where city_id = '42762000-0000-4000-a000-000000000001';
  v := public.seeding_replace_tiles(
    '42762000-0000-4000-a000-000000000001',
    array['42762000-0000-4000-b000-000000000001']::uuid[],
    '[{"center_lat": 5, "center_lng": 5, "radius_m": 2000, "row_idx": 0, "col_idx": 0}]'
  );
  if (v ->> 'retired')::int <> 3 or (v ->> 'inserted')::int <> 1 then raise exception 'R-REPLACE: %', v; end if;
  if exists (select 1 from public.seeding_tiles where id in ('42762000-0000-4000-b000-000000000011', '42762000-0000-4000-b000-000000000012') and retired_at is null) then
    raise exception 'R-REPLACE: a split child outlived its parent';
  end if;
  if (select tile_index from public.seeding_tiles where center_lat = 5 and city_id = '42762000-0000-4000-a000-000000000001') <> v_max + 1 then
    raise exception 'R-REPLACE: the new tile reused an index';
  end if;
  if not exists (select 1 from public.seeding_batches where id = '42762000-0000-4000-d000-000000000001' and center_lat = 1 and radius_m = 1500) then
    raise exception 'R-HISTORY: retiring lost the search';
  end if;
  -- A retired tile owes nothing, and shows in the history.
  if exists (select 1 from public.seeding_unfinished_searches('42762000-0000-4000-a000-000000000001', (select cfg from w2_cfg)) u where u.tile_id = '42762000-0000-4000-b000-000000000001') then
    raise exception 'R-REPLACE: a retired tile still owes searches';
  end if;
  if (public.seeding_retired_tile_history('42762000-0000-4000-a000-000000000001') #>> '{0,tiles}')::int <> 3 then
    raise exception 'R-HISTORY: %', public.seeding_retired_tile_history('42762000-0000-4000-a000-000000000001');
  end if;
  -- Planning a search on a retired tile refuses the whole plan.
  begin
    perform public.seeding_start_search_level('42762000-0000-4000-a000-000000000001', 'fill', 0, 0, '[]', jsonb_build_array(jsonb_build_object('tile_id', '42762000-0000-4000-b000-000000000001', 'seeding_category', 'nature', 'app_category', 'Nature', 'search_config_id', 'picnic_park', 'level', 0)), null, null);
    raise exception 'R-LEVEL: a retired tile was searched';
  exception when raise_exception then
    if sqlerrm like 'R-LEVEL%' then raise; end if;
  end;
  if exists (select 1 from public.seeding_runs where city_id = '42762000-0000-4000-a000-000000000001' and kind = 'fill') then
    raise exception 'R-LEVEL: a refused plan left a run behind';
  end if;
end $$;

-- The foreign key itself: a tile removed through a city-independent path keeps the search.
do $$
begin
  alter table public.seeding_tiles disable trigger seeding_tiles_never_deleted;
  delete from public.seeding_tiles where id = '42762000-0000-4000-b000-000000000002';
  alter table public.seeding_tiles enable trigger seeding_tiles_never_deleted;
  if not exists (select 1 from public.seeding_batches where id = '42762000-0000-4000-d000-000000000002' and tile_id is null and center_lat = 1.1) then
    raise exception 'R-HISTORY: a deleted tile took its search with it';
  end if;
end $$;

-- ── R-OUTSIDE ───────────────────────────────────────────────────────────────
insert into public.place_pool (id, google_place_id, name, lat, lng, types, primary_type, is_active, is_servable, city_id, fetched_via)
values
  ('42762000-0000-4000-f000-000000000001', 'gp-w2-in', 'In', 1, 1, array['cafe'], 'cafe', true, true, '42762000-0000-4000-a000-000000000001', 'nearby_search'),
  ('42762000-0000-4000-f000-000000000002', 'gp-w2-out', 'Out', 5, 5, array['cafe'], 'cafe', true, true, '42762000-0000-4000-a000-000000000001', 'nearby_search'),
  ('42762000-0000-4000-f000-000000000003', 'gp-w2-off', 'Off', 5, 5, array['cafe'], 'cafe', false, false, '42762000-0000-4000-a000-000000000001', 'nearby_search');

do $$
declare v jsonb; rec jsonb;
begin
  v := public.seeding_places_outside_box('42762000-0000-4000-a000-000000000001');
  rec := v -> 0;
  if (rec ->> 'outside_total')::int <> 2 or (rec ->> 'outside_active')::int <> 1 or (rec ->> 'outside_servable')::int <> 1 then
    raise exception 'R-OUTSIDE stored box: %', rec;
  end if;
  -- A proposed box that reaches them, and one that excludes the middle.
  rec := public.seeding_places_outside_box('42762000-0000-4000-a000-000000000001', 0, 0, 6, 6) -> 0;
  if (rec ->> 'outside_total')::int <> 0 then raise exception 'R-OUTSIDE proposed: %', rec; end if;
  rec := public.seeding_places_outside_box('42762000-0000-4000-a000-000000000001', 4, 4, 6, 6) -> 0;
  if (rec ->> 'outside_total')::int <> 1 then raise exception 'R-OUTSIDE proposed: %', rec; end if;
  -- Every city at once, and nothing deleted or changed.
  if not (public.seeding_places_outside_box() @> '[{"name": "W2 A"}]') then raise exception 'R-OUTSIDE all cities'; end if;
  if (select count(*) from public.place_pool where id::text like '42762000-0000-4000-f000-%' and is_active) <> 2 then
    raise exception 'R-OUTSIDE changed a place';
  end if;
end $$;

-- ── R-GRANTS ────────────────────────────────────────────────────────────────
do $$
declare v_fn text;
begin
  foreach v_fn in array array[
    'seeding_replace_tiles(uuid,uuid[],jsonb)',
    'seeding_start_search_level(uuid,text,integer,double precision,jsonb,jsonb,uuid[],uuid[])',
    'seeding_capped_searches_to_split(uuid)',
    'seeding_existing_split_children(uuid)',
    'seeding_unfinished_searches(uuid,jsonb)',
    'seeding_unfinished_searches_json(uuid,jsonb)',
    'seeding_city_search_status(uuid,jsonb)',
    'seeding_active_tiles(uuid)',
    'seeding_retired_tile_history(uuid)',
    'seeding_attribute_legacy_batches()',
    'seeding_places_outside_box(uuid,double precision,double precision,double precision,double precision)'
  ] loop
    if has_function_privilege('anon', 'public.' || v_fn, 'EXECUTE') or has_function_privilege('authenticated', 'public.' || v_fn, 'EXECUTE') then
      raise exception 'R-GRANTS: % is callable by a client', v_fn;
    end if;
    if not has_function_privilege('service_role', 'public.' || v_fn, 'EXECUTE') then
      raise exception 'R-GRANTS: % is not callable by the service role', v_fn;
    end if;
  end loop;
end $$;

rollback;
\echo 'issue 4276 tile completeness: all checks passed'
