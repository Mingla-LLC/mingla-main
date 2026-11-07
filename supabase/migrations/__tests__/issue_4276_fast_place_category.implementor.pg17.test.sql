-- Issue #4276 (fix b): implementor proof for 20280419004276_issue_4276_fast_place_category.sql.
--
-- MINGLA-INVARIANT: I-4276-PLACE-CATEGORY-CHEAP | issue #4276 | A place's category is read by an inlinable SQL computed column over the one mapping (pg_map_primary_type_to_mingla_category), with the same answers as before, so admin lists never build the whole place row to learn it
--
--   C-SAME     the new mapping gives the old plpgsql mapping's answer for every
--              mapped type as primary_type, for each as a fallback behind an unmapped
--              primary_type, for mixed and ordered arrays, and for nulls and empties
--   C-ONE      the computed column answers the same as the mapping on real rows
--   C-INLINE   the computed column has no SET clause and is inlined: a query on it
--              never passes the whole row (p.*) to a function
--   C-SQL      the mapping and the computed column are LANGUAGE sql
--   C-INDEX    the five admin list indexes exist, partial on active places, and the
--              category filter with newest first is served by its index, unsorted
--
-- FAILS-ON-REVERT: restore the plpgsql mapping and the SET search_path wrapper
-- (20280410014276) and C-INLINE and C-SQL fail; drop the indexes and C-INDEX fails.
--
-- Run from the repository root as supabase_admin. Everything is rolled back.

\set ON_ERROR_STOP on
begin;

-- The mapping as it stood before this migration, copied verbatim from
-- 20260505000000_baseline_squash_orch_0729.sql, as a temporary function to compare with.
create function pg_temp.old_map("p_primary_type" "text", "p_types" "text"[]) RETURNS "text"
    LANGUAGE "plpgsql" IMMUTABLE PARALLEL SAFE
    AS $$
DECLARE
  v_type text;
  v_result text;
BEGIN
  -- Try primary_type first (single match)
  IF p_primary_type IS NOT NULL THEN
    v_result := CASE
      -- Nature & Views (slug 'nature')
      WHEN p_primary_type IN ('beach','botanical_garden','garden','hiking_area','national_park',
                              'nature_preserve','park','scenic_spot','state_park','observation_deck',
                              'tourist_attraction','picnic_ground','vineyard','wildlife_park','wildlife_refuge',
                              'woods','mountain_peak','river','island','city_park','fountain','lake','marina')
        THEN 'nature'
      -- Icebreakers (slug 'icebreakers')
      WHEN p_primary_type IN ('cafe','bowling_alley','coffee_shop','miniature_golf_course','art_gallery',
                              'tea_house','video_arcade','museum','book_store','amusement_center',
                              'bakery','go_karting_venue','cultural_center','dessert_shop','karaoke',
                              'plaza','ice_cream_shop','comedy_club','art_museum','juice_shop',
                              'paintball_center','donut_shop','dance_hall','breakfast_restaurant','brunch_restaurant')
        THEN 'icebreakers'
      -- Drinks & Music (slug 'drinks_and_music')
      WHEN p_primary_type IN ('bar','cocktail_bar','wine_bar','brewery','pub','beer_garden','brewpub',
                              'lounge_bar','night_club','live_music_venue','coffee_roastery','coffee_stand')
        THEN 'drinks_and_music'
      -- Movies & Theatre (slug 'movies_theatre') — combines former 'movies' + 'theatre' helper buckets
      WHEN p_primary_type IN ('movie_theater','drive_in',
                              'performing_arts_theater','opera_house','auditorium','amphitheatre','concert_hall')
        THEN 'movies_theatre'
      -- Brunch, Lunch & Casual (slug 'brunch_lunch_casual') — combines former 'brunch' + 'casual_food' helper buckets
      WHEN p_primary_type IN ('american_restaurant','bistro','gastropub','diner',
                              'mexican_restaurant','thai_restaurant','pizza_restaurant','sandwich_shop',
                              'mediterranean_restaurant','indian_restaurant','chinese_restaurant',
                              'vietnamese_restaurant','korean_restaurant','japanese_restaurant',
                              'lebanese_restaurant','greek_restaurant','italian_restaurant',
                              'ramen_restaurant','noodle_shop','hamburger_restaurant','deli',
                              'barbecue_restaurant','seafood_restaurant','vegan_restaurant',
                              'vegetarian_restaurant','turkish_restaurant','spanish_restaurant',
                              'french_restaurant','sushi_restaurant','buffet_restaurant','food_court',
                              'afghani_restaurant','african_restaurant','asian_restaurant',
                              'brazilian_restaurant','indonesian_restaurant','middle_eastern_restaurant',
                              'hot_pot_restaurant','dim_sum_restaurant','argentinian_restaurant',
                              'basque_restaurant','persian_restaurant','scandinavian_restaurant',
                              'filipino_restaurant','soul_food_restaurant','cuban_restaurant',
                              'hawaiian_restaurant','ethiopian_restaurant','moroccan_restaurant',
                              'peruvian_restaurant','cajun_restaurant','fusion_restaurant',
                              'korean_barbecue_restaurant','tapas_restaurant')
        THEN 'brunch_lunch_casual'
      -- Upscale & Fine Dining (slug 'upscale_fine_dining')
      WHEN p_primary_type IN ('fine_dining_restaurant','steak_house','oyster_bar_restaurant',
                              'fondue_restaurant','swiss_restaurant','european_restaurant',
                              'australian_restaurant','british_restaurant')
        THEN 'upscale_fine_dining'
      -- Creative & Arts (slug 'creative_arts')
      WHEN p_primary_type IN ('art_studio','history_museum','sculpture','cultural_landmark')
        THEN 'creative_arts'
      -- Play (slug 'play')
      WHEN p_primary_type IN ('amusement_park','roller_coaster','water_park','ferris_wheel',
                              'casino','planetarium','golf_course','indoor_golf_course',
                              'adventure_sports_center','ice_skating_rink')
        THEN 'play'
      -- Groceries (slug 'groceries') — MUST come BEFORE 'flowers' since grocery_store + supermarket
      -- belong here per canonical taxonomy. Flowers is florist-only.
      WHEN p_primary_type IN ('grocery_store','supermarket')
        THEN 'groceries'
      -- Flowers (slug 'flowers') — florist ONLY (no grocery absorption)
      WHEN p_primary_type = 'florist'
        THEN 'flowers'
      ELSE NULL
    END;

    IF v_result IS NOT NULL THEN
      RETURN v_result;
    END IF;
  END IF;

  -- Fallback: scan types[] in order, return first match.
  -- Recursion safe because depth is bounded by types[] length and IMMUTABLE
  -- marker prevents planner re-entry.
  IF p_types IS NOT NULL THEN
    FOREACH v_type IN ARRAY p_types LOOP
      v_result := pg_temp.old_map(v_type, NULL);
      IF v_result IS NOT NULL THEN
        RETURN v_result;
      END IF;
    END LOOP;
  END IF;

  RETURN NULL;
END;
$$;

do $$
declare
  v_type text;
  v_primary text;
  v_types text[];
  v_checked int := 0;
begin
  -- Every mapped type, on its own and as a fallback behind an unmapped primary type.
  for v_type in select jsonb_object_keys(public.pg_mingla_category_type_map()) loop
    if public.pg_map_primary_type_to_mingla_category(v_type, null) is distinct from pg_temp.old_map(v_type, null) then
      raise exception 'C-SAME: % as primary: new %, old %', v_type,
        public.pg_map_primary_type_to_mingla_category(v_type, null), pg_temp.old_map(v_type, null);
    end if;
    if public.pg_map_primary_type_to_mingla_category('restaurant', array['point_of_interest', v_type, 'establishment'])
       is distinct from pg_temp.old_map('restaurant', array['point_of_interest', v_type, 'establishment']) then
      raise exception 'C-SAME: % as fallback differs', v_type;
    end if;
    v_checked := v_checked + 2;
  end loop;
  if v_checked < 280 then
    raise exception 'C-SAME: only % checks; the type table looks short', v_checked;
  end if;

  -- Ordered and mixed arrays, nulls and empties, unmapped everything.
  foreach v_primary in array array[null, 'restaurant', 'bar', 'spa', 'florist', 'supermarket', 'unknown_type', ''] loop
    foreach v_types slice 1 in array array[
      array['spa', 'wellness_center', 'health', 'x'],
      array['grocery_store', 'florist', 'x', 'x'],
      array['florist', 'grocery_store', 'x', 'x'],
      array['meal_takeaway', 'chicken_restaurant', 'fast_food_restaurant', 'x'],
      array['point_of_interest', 'establishment', 'x', 'x'],
      array['x', 'x', 'park', 'bar'],
      array['discount_supermarket', 'grocery_store', 'food_delivery', 'bakery']
    ] loop
      if public.pg_map_primary_type_to_mingla_category(v_primary, v_types) is distinct from pg_temp.old_map(v_primary, v_types) then
        raise exception 'C-SAME: (%, %) new %, old %', v_primary, v_types,
          public.pg_map_primary_type_to_mingla_category(v_primary, v_types), pg_temp.old_map(v_primary, v_types);
      end if;
    end loop;
    if public.pg_map_primary_type_to_mingla_category(v_primary, null) is distinct from pg_temp.old_map(v_primary, null)
       or public.pg_map_primary_type_to_mingla_category(v_primary, array[]::text[]) is distinct from pg_temp.old_map(v_primary, array[]::text[]) then
      raise exception 'C-SAME: (%, null or empty) differs', v_primary;
    end if;
  end loop;
end $$;

-- C-ONE: on real rows the computed column is the mapping.
insert into public.seeding_cities (id, google_place_id, name, country, country_code, center_lat, center_lng, bbox_sw_lat, bbox_sw_lng, bbox_ne_lat, bbox_ne_lng, status)
values ('c4276b00-0000-4000-a000-000000000001', 'gp-city-c4276b', 'Category City 4276', 'Testland', 'TL', 1, 1, 0, 0, 2, 2, 'draft');
insert into public.place_pool (id, google_place_id, name, lat, lng, types, primary_type, is_active, city_id, fetched_via)
values
  ('c4276b00-0000-4000-b000-000000000001', 'gp-c4276b-1', 'Pub', 1, 1, array['pub', 'bar'], 'pub', true, 'c4276b00-0000-4000-a000-000000000001', 'nearby_search'),
  ('c4276b00-0000-4000-b000-000000000002', 'gp-c4276b-2', 'Spa cafe', 1, 1, array['spa', 'cafe'], 'spa', true, 'c4276b00-0000-4000-a000-000000000001', 'nearby_search'),
  ('c4276b00-0000-4000-b000-000000000003', 'gp-c4276b-3', 'Nothing', 1, 1, array['store'], 'store', true, 'c4276b00-0000-4000-a000-000000000001', 'nearby_search');

do $$
declare v_wrong int;
begin
  select count(*) into v_wrong from public.place_pool p
   where p.city_id = 'c4276b00-0000-4000-a000-000000000001'
     and public.place_pool_derived_category(p) is distinct from pg_temp.old_map(p.primary_type, p.types);
  if v_wrong <> 0 then raise exception 'C-ONE: % rows differ', v_wrong; end if;
  if (select string_agg(coalesce(public.place_pool_derived_category(p), 'null'), ',' order by p.name)
        from public.place_pool p where p.city_id = 'c4276b00-0000-4000-a000-000000000001') <> 'null,drinks_and_music,icebreakers' then
    raise exception 'C-ONE: unexpected categories';
  end if;
end $$;

-- C-SQL and C-INLINE.
do $$
declare
  v_plan text := '';
  v_line text;
begin
  if (select l.lanname from pg_proc p join pg_language l on l.oid = p.prolang
       where p.oid = 'public.pg_map_primary_type_to_mingla_category(text,text[])'::regprocedure) <> 'sql' then
    raise exception 'C-SQL: the mapping is not LANGUAGE sql';
  end if;
  if (select l.lanname from pg_proc p join pg_language l on l.oid = p.prolang
       where p.oid = 'public.place_pool_derived_category(public.place_pool)'::regprocedure) <> 'sql' then
    raise exception 'C-SQL: the computed column is not LANGUAGE sql';
  end if;
  if (select proconfig from pg_proc where oid = 'public.place_pool_derived_category(public.place_pool)'::regprocedure) is not null then
    raise exception 'C-INLINE: the computed column has a SET clause, so it is never inlined';
  end if;
  for v_line in execute $q$explain (verbose, costs off) select public.place_pool_derived_category(p) from public.place_pool p where public.place_pool_derived_category(p) = 'nature'$q$ loop
    v_plan := v_plan || v_line || E'\n';
  end loop;
  if v_plan ~ 'place_pool_derived_category' or v_plan ~ '\mp\.\*' then
    raise exception E'C-INLINE: the whole row still reaches a function:\n%', v_plan;
  end if;
end $$;

-- C-INDEX.
do $$
declare
  v_name text;
  v_plan text := '';
  v_line text;
begin
  foreach v_name in array array['place_pool_admin_newest_idx', 'place_pool_admin_city_newest_idx',
    'place_pool_admin_category_newest_idx', 'place_pool_admin_city_category_newest_idx', 'place_pool_admin_excluded_name_idx'] loop
    if not exists (select 1 from pg_indexes where schemaname = 'public' and tablename = 'place_pool' and indexname = v_name and indexdef ~ 'WHERE \(+is_active = true') then
      raise exception 'C-INDEX: % is missing or not partial on active places', v_name;
    end if;
  end loop;
  set local enable_seqscan = off;
  set local enable_bitmapscan = off;
  for v_line in execute $q$explain (costs off) select p.id from public.place_pool p where p.is_active = true and public.place_pool_derived_category(p) = 'nature' order by p.created_at desc limit 20$q$ loop
    v_plan := v_plan || v_line || E'\n';
  end loop;
  if v_plan !~ 'place_pool_admin_(city_)?category_newest_idx' or v_plan ~ 'Sort' then
    raise exception E'C-INDEX: the category filter is not served in order by its index:\n%', v_plan;
  end if;
end $$;

select 'issue_4276_fast_place_category: all checks passed' as result;
rollback;
