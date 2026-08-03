-- Issue #1425: expose the existing server-owned Room-night and Place-window
-- inventory inside the authorized Stay management snapshot. No public read,
-- direct table write, or restaurant contract changes.

BEGIN;

CREATE OR REPLACE FUNCTION public.issue_1387_stay_inventory_snapshot(
  p_venue_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_venue public.venue_listings%ROWTYPE;
BEGIN
  SELECT * INTO v_venue
  FROM public.venue_listings
  WHERE id = p_venue_id;
  IF NOT FOUND OR v_venue.venue_category <> 'stay' THEN
    RAISE EXCEPTION 'stay_venue_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;
  IF NOT public.issue_1387_has_brand_capability(
    v_venue.brand_id,
    v_uid,
    'read'
  ) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  RETURN jsonb_build_object(
    'venue', jsonb_build_object(
      'id', v_venue.id,
      'brandId', v_venue.brand_id,
      'name', v_venue.name,
      'category', v_venue.venue_category
    ),
    'settings', (
      SELECT to_jsonb(settings)
      FROM public.stay_settings settings
      WHERE settings.venue_id = p_venue_id
    ),
    'offerings', COALESCE((
      SELECT jsonb_agg(
        to_jsonb(offering) || jsonb_build_object(
          'units', COALESCE((
            SELECT jsonb_agg(
              to_jsonb(unit_row)
              ORDER BY unit_row.created_at, unit_row.id
            )
            FROM public.stay_units unit_row
            WHERE unit_row.offering_id = offering.id
          ), '[]'::jsonb),
          'media', COALESCE((
            SELECT jsonb_agg(
              to_jsonb(media)
              ORDER BY media.sort_order, media.id
            )
            FROM public.stay_offering_media media
            WHERE media.offering_id = offering.id
          ), '[]'::jsonb),
          'currentPrice', (
            SELECT to_jsonb(price)
            FROM public.stay_price_versions price
            WHERE price.offering_id = offering.id
              AND price.effective_to IS NULL
          ),
          'currentFees', COALESCE((
            SELECT jsonb_agg(to_jsonb(fee) ORDER BY fee.fee_key)
            FROM public.stay_fee_versions fee
            WHERE fee.offering_id = offering.id
              AND fee.effective_to IS NULL
          ), '[]'::jsonb),
          'currentPolicy', (
            SELECT to_jsonb(policy)
            FROM public.stay_policy_versions policy
            WHERE policy.offering_id = offering.id
              AND policy.effective_to IS NULL
          ),
          'roomNights', CASE
            WHEN offering.kind = 'room' THEN COALESCE((
              SELECT jsonb_agg(
                to_jsonb(night)
                ORDER BY night.local_date
              )
              FROM public.stay_room_nights night
              WHERE night.offering_id = offering.id
                AND night.local_date >= (
                  now() AT TIME ZONE COALESCE((
                    SELECT settings.timezone
                    FROM public.stay_settings settings
                    WHERE settings.venue_id = p_venue_id
                  ), 'UTC')
                )::date
            ), '[]'::jsonb)
            ELSE '[]'::jsonb
          END,
          'placeScheduleRules', CASE
            WHEN offering.kind = 'place' THEN COALESCE((
              SELECT jsonb_agg(
                to_jsonb(rule_row)
                ORDER BY rule_row.created_at, rule_row.id
              )
              FROM public.stay_place_schedule_rules rule_row
              WHERE rule_row.offering_id = offering.id
            ), '[]'::jsonb)
            ELSE '[]'::jsonb
          END,
          'placeWindows', CASE
            WHEN offering.kind = 'place' THEN COALESCE((
              SELECT jsonb_agg(
                to_jsonb(place_window)
                ORDER BY place_window.starts_at, place_window.id
              )
              FROM public.stay_place_windows place_window
              WHERE place_window.offering_id = offering.id
                AND place_window.ends_at > now()
            ), '[]'::jsonb)
            ELSE '[]'::jsonb
          END,
          'nextAvailability', CASE
            WHEN offering.kind = 'room' THEN (
              SELECT min(night.local_date)::text
              FROM public.stay_room_nights night
              WHERE night.offering_id = offering.id
                AND NOT night.stop_sell
                AND night.sellable_quantity > 0
                AND night.local_date >= (
                  now() AT TIME ZONE COALESCE((
                    SELECT settings.timezone
                    FROM public.stay_settings settings
                    WHERE settings.venue_id = p_venue_id
                  ), 'UTC')
                )::date
            )
            ELSE (
              SELECT min(place_window.starts_at)::text
              FROM public.stay_place_windows place_window
              WHERE place_window.offering_id = offering.id
                AND NOT place_window.stop_sell
                AND COALESCE(
                  place_window.sellable_units,
                  place_window.sellable_capacity,
                  0
                ) > 0
                AND place_window.ends_at > now()
            )
          END,
          'hasOpenAvailability', CASE
            WHEN offering.kind = 'room' THEN EXISTS (
              SELECT 1
              FROM public.stay_room_nights night
              WHERE night.offering_id = offering.id
                AND NOT night.stop_sell
                AND night.sellable_quantity > 0
                AND night.local_date >= (
                  now() AT TIME ZONE COALESCE((
                    SELECT settings.timezone
                    FROM public.stay_settings settings
                    WHERE settings.venue_id = p_venue_id
                  ), 'UTC')
                )::date
            )
            ELSE EXISTS (
              SELECT 1
              FROM public.stay_place_windows place_window
              WHERE place_window.offering_id = offering.id
                AND NOT place_window.stop_sell
                AND COALESCE(
                  place_window.sellable_units,
                  place_window.sellable_capacity,
                  0
                ) > 0
                AND place_window.ends_at > now()
            )
          END
        )
        ORDER BY offering.created_at, offering.id
      )
      FROM public.stay_offerings offering
      WHERE offering.venue_id = p_venue_id
    ), '[]'::jsonb)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.issue_1387_stay_inventory_snapshot(uuid)
  FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.issue_1387_stay_inventory_snapshot(uuid)
  FROM anon;
GRANT EXECUTE ON FUNCTION public.issue_1387_stay_inventory_snapshot(uuid)
  TO authenticated;

COMMIT;
