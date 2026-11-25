-- #4490 P1 migration 7 — venue capabilities can be granted, for every venue type.
--
-- 20281203004490 widened the capability CHECKs and issue_4188_has_venue_capability
-- to the venue.* capabilities, but the grant writer still refused them and
-- still accepted only `stay` and `restaurant` venues, so nobody could hold
-- venue.manage_offers (Spaces, hours) and no play, bar, club, cafe, event
-- space, coworking or creative venue could have scoped staff at all.
--
-- issue_4188_set_member_venue_grants (latest body 20280212004188) is redefined
-- with only these rule changes:
--   * a Stay venue: profile front_desk | custom, stay.* capabilities only (unchanged);
--   * every other venue type (the nine-type list, minus stay): profile
--     restaurant_manager | kitchen_bar | custom, capabilities restaurant.* and/or
--     venue.* (was: restaurant venues only, restaurant.* only);
--   * the allowed capability list gains venue.manage_offers, venue.manage_bookings,
--     venue.view_bookings, venue.check_in, venue.manage_money.
-- Authority (brand rank >= brand_admin), the member checks, 1..100 grants, one
-- grant per venue, the replace-all write and the return shape are unchanged.
-- The invite path (edge function invite-brand-member) is widened the same way.
--
-- Static SQL. Local stack only until Seth says otherwise.

BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.issue_4188_set_member_venue_grants(
  p_brand_id uuid,
  p_member_id uuid,
  p_grants jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_member public.brand_team_members%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL
     OR public.biz_brand_effective_rank_for_caller(p_brand_id)
       < public.biz_role_rank('brand_admin') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(p_grants) <> 'array'
     OR jsonb_array_length(p_grants) NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'invalid_venue_grants' USING ERRCODE = '22023';
  END IF;
  IF (
    SELECT count(*) <> count(DISTINCT grant_row->>'venueId')
    FROM jsonb_array_elements(p_grants) grant_row
  ) THEN
    RAISE EXCEPTION 'invalid_venue_grants' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_member
  FROM public.brand_team_members member
  WHERE member.id = p_member_id
    AND member.brand_id = p_brand_id
    AND member.role = 'venue_staff'
    AND member.accepted_at IS NOT NULL
    AND member.removed_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'member_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_grants) grant_row
    WHERE jsonb_typeof(grant_row) <> 'object'
      OR NOT (grant_row ? 'venueId')
      OR NOT (grant_row ? 'profile')
      OR NOT (grant_row ? 'capabilities')
      OR jsonb_typeof(grant_row->'capabilities') <> 'array'
      OR jsonb_array_length(grant_row->'capabilities') = 0
      OR grant_row->>'profile' NOT IN (
        'front_desk', 'restaurant_manager', 'kitchen_bar', 'custom'
      )
      OR NOT EXISTS (
        SELECT 1 FROM public.venue_listings venue
        WHERE venue.id = (grant_row->>'venueId')::uuid
          AND venue.brand_id = p_brand_id
          AND (
            (
              venue.venue_category = 'stay'
              AND grant_row->>'profile' IN ('front_desk', 'custom')
              AND NOT EXISTS (
                SELECT 1
                FROM jsonb_array_elements_text(
                  grant_row->'capabilities'
                ) capability
                WHERE capability NOT LIKE 'stay.%'
              )
            )
            OR (
              -- #4490: every non-stay venue type takes the venue capabilities.
              venue.venue_category IN (
                'restaurant', 'play', 'creative_and_arts', 'bar_lounge',
                'club', 'cafe', 'event_space', 'coworking'
              )
              AND grant_row->>'profile' IN (
                'restaurant_manager', 'kitchen_bar', 'custom'
              )
              AND NOT EXISTS (
                SELECT 1
                FROM jsonb_array_elements_text(
                  grant_row->'capabilities'
                ) capability
                WHERE capability NOT LIKE 'restaurant.%'
                  AND capability NOT LIKE 'venue.%'
              )
            )
          )
      )
      OR EXISTS (
        SELECT 1 FROM jsonb_array_elements_text(grant_row->'capabilities') capability
        WHERE capability <> ALL(ARRAY[
          'stay.view_reservations',
          'stay.create_reservations',
          'stay.manage_reservations',
          'stay.view_availability',
          'restaurant.view_orders',
          'restaurant.manage_orders',
          'restaurant.manage_menu',
          'restaurant.manage_qr',
          'restaurant.manage_reservations',
          'venue.manage_offers',
          'venue.manage_bookings',
          'venue.view_bookings',
          'venue.check_in',
          'venue.manage_money'
        ]::text[])
      )
  ) THEN
    RAISE EXCEPTION 'invalid_venue_grants' USING ERRCODE = '22023';
  END IF;

  DELETE FROM public.brand_team_member_venue_grants
  WHERE member_id = p_member_id;
  INSERT INTO public.brand_team_member_venue_grants (
    member_id, venue_id, access_profile, capabilities
  )
  SELECT
    p_member_id,
    (grant_row->>'venueId')::uuid,
    grant_row->>'profile',
    ARRAY(
      SELECT DISTINCT capability
      FROM jsonb_array_elements_text(grant_row->'capabilities') capability
      ORDER BY capability
    )
  FROM jsonb_array_elements(p_grants) grant_row;

  RETURN jsonb_build_object(
    'memberId', p_member_id,
    'venueCount', jsonb_array_length(p_grants)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.issue_4188_set_member_venue_grants(uuid,uuid,jsonb)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_4188_set_member_venue_grants(uuid,uuid,jsonb)
  TO authenticated;

COMMIT;

-- Reverse (local use only; forward-fix in production): re-run the
-- issue_4188_set_member_venue_grants body from 20280212004188.
