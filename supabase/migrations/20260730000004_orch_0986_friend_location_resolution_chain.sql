-- ORCH-0986 location pivot (operator directive 2026-05-28): the paired hero shows a
-- friend's city (profiles.location, e.g. "Raleigh") but recommendations were GPS-only
-- (user_location_history), which is empty for ~all users → every paired section showed
-- the "no recent location" empty state despite a visible city.
--
-- Fix: resolve the recommendation center via a CHAIN of the friend's stored coordinate
-- sources, so recs center where the hero says. Order:
--   1. most recent physical GPS (user_location_history) — "where they truly are"
--   2. preferences.custom_lat/lng     — their explicitly set location (e.g. Ari's Raleigh address)
--   3. preferences.discover_city_lat/lng — their discover city (e.g. "Raleigh")
-- If none exist → return no row → edge fn emits locationStatus:"missing" (honest empty state).
--
-- NOTE (documented fast-follow): users with ONLY a text profiles.location and no stored
-- coords still hit the empty state; geocoding that text needs the Google Geocoding API
-- (external-API scope + I-PROPOSED-EXTERNAL-API-DOCS-VERIFIED) and is deferred to a follow-up.
--
-- Same name as the prior RPC so the edge call + the service-role lock (migration
-- 20260730000003) carry over. CREATE OR REPLACE preserves the ACL; we re-assert the
-- grant below for safety. Consent gate (active pairing) unchanged. Coordinates stay
-- server-side; never returned to the client.

create or replace function public.get_paired_friend_last_location(
  p_viewer_id uuid,
  p_friend_id uuid
)
returns table (
  latitude double precision,
  longitude double precision,
  captured_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_lat double precision;
  v_lng double precision;
  v_ts  timestamptz;
begin
  if p_viewer_id is null or p_friend_id is null then
    return;
  end if;

  -- consent gate: an active pairing must exist in either direction
  if not exists (
    select 1
    from public.pairings p
    where (p.user_a_id = p_viewer_id and p.user_b_id = p_friend_id)
       or (p.user_a_id = p_friend_id and p.user_b_id = p_viewer_id)
  ) then
    return;
  end if;

  -- 1. most recent physical GPS
  select ulh.latitude, ulh.longitude, ulh.created_at
    into v_lat, v_lng, v_ts
  from public.user_location_history ulh
  where ulh.user_id = p_friend_id
  order by ulh.created_at desc
  limit 1;

  if v_lat is not null and v_lng is not null then
    latitude := v_lat; longitude := v_lng; captured_at := v_ts;
    return next;
    return;
  end if;

  -- 2/3. preferences: explicit custom location, then discover-city (cast numeric → double)
  select
    coalesce(pf.custom_lat, pf.discover_city_lat::double precision),
    coalesce(pf.custom_lng, pf.discover_city_lng::double precision)
    into v_lat, v_lng
  from public.preferences pf
  where pf.profile_id = p_friend_id;

  if v_lat is not null and v_lng is not null then
    latitude := v_lat; longitude := v_lng; captured_at := null;
    return next;
    return;
  end if;

  return; -- no usable location → honest empty state
end;
$$;

revoke all on function public.get_paired_friend_last_location(uuid, uuid) from public;
revoke all on function public.get_paired_friend_last_location(uuid, uuid) from anon;
revoke all on function public.get_paired_friend_last_location(uuid, uuid) from authenticated;
grant execute on function public.get_paired_friend_last_location(uuid, uuid) to service_role;
