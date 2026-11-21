-- Issue #4490, spec 07 J: a Stay venue keeps its Stays inventory and may
-- independently enable the same venue features as every other venue.
-- Static SQL. Local stack only until Seth approves a production migration.

BEGIN;
SET LOCAL lock_timeout = '5s';

-- Checked patches preserve the cumulative #4490 function bodies. A terminal
-- definition drift must fail the migration instead of silently dropping a
-- later fix.
CREATE FUNCTION pg_temp.issue_4490_patch(
  p_sig regprocedure,
  p_old text,
  p_new text
)
RETURNS void
LANGUAGE plpgsql
AS $patch$
DECLARE
  v_def text := pg_get_functiondef(p_sig);
  v_old_count integer;
BEGIN
  v_old_count := (length(v_def) - length(replace(v_def, p_old, ''))) / length(p_old);
  IF v_old_count <> 1 THEN
    RAISE EXCEPTION 'issue_4490 stay feature patch precondition failed for %: old %',
      p_sig, v_old_count;
  END IF;
  EXECUTE replace(v_def, p_old, p_new);
END;
$patch$;

-- Room/place rows remain Stay-only. Offer rows use the same feature and
-- readiness rules on a Stay as they do on every other venue category.
SELECT pg_temp.issue_4490_patch(
  'public.issue_1387_assert_stay_row_integrity()'::regprocedure,
  $old$  ELSE
    IF v_venue.venue_category = 'stay' THEN
      RAISE EXCEPTION 'offer_not_on_stay_venue' USING ERRCODE = '23514';
    END IF;
    IF TG_TABLE_NAME = 'stay_offerings' THEN$old$,
  $new$  ELSE
    IF TG_TABLE_NAME = 'stay_offerings' THEN$new$
);

-- A NULL offer_kind is still the Stays checkout rail and therefore Stay-only.
-- A non-NULL offer_kind identifies the venue-offer rail on any venue category.
SELECT pg_temp.issue_4490_patch(
  'public.issue_1388_assert_reservation_scope()'::regprocedure,
  $old$          (NEW.offer_kind IS NULL AND v.venue_category = 'stay')
          OR (NEW.offer_kind IS NOT NULL AND v.venue_category <> 'stay')$old$,
  $new$          (NEW.offer_kind IS NULL AND v.venue_category = 'stay')
          OR NEW.offer_kind IS NOT NULL$new$
);

SELECT pg_temp.issue_4490_patch(
  'public.issue_4490_manage_offer(text,uuid,jsonb,bigint,text)'::regprocedure,
  $old$  IF v_venue.venue_category = 'stay' THEN
    RAISE EXCEPTION 'offer_not_on_stay_venue' USING ERRCODE = 'P0001';
  END IF;
  v_settings := public.issue_4490_ensure_booking_settings(p_venue_id);$old$,
  $new$  v_settings := public.issue_4490_ensure_booking_settings(p_venue_id);$new$
);

SELECT pg_temp.issue_4490_patch(
  'public.issue_4490_manage_membership_plan(text,uuid,jsonb,bigint,text)'::regprocedure,
  $old$  IF v_venue.venue_category = 'stay' THEN
    RAISE EXCEPTION 'offer_not_on_stay_venue' USING ERRCODE = 'P0001';
  END IF;
  SELECT upper(COALESCE(NULLIF(btrim(b.default_currency), ''), 'NGN')) INTO v_currency$old$,
  $new$  SELECT upper(COALESCE(NULLIF(btrim(b.default_currency), ''), 'NGN')) INTO v_currency$new$
);

SELECT pg_temp.issue_4490_patch(
  'public.issue_4490_offer_readiness(uuid)'::regprocedure,
  $old$  IF v_venue.venue_category = 'stay' THEN
    v_reasons := v_reasons || 'stay_venue'::text;
  END IF;
  RETURN v_reasons;$old$,
  $new$  RETURN v_reasons;$new$
);

-- Menu keeps its existing preset-or-existing-menu default. Stay no longer
-- changes that default merely because Stays is the venue's primary product.
SELECT pg_temp.issue_4490_patch(
  'public.issue_4490_venue_feature_rows(uuid)'::regprocedure,
  $old$      WHEN 'menu' THEN venue.venue_category <> 'stay'
        AND ('menu' = ANY(COALESCE(public.issue_4490_feature_preset(venue.venue_category), '{}'::text[]))
             OR EXISTS (SELECT 1 FROM public.menus m WHERE m.venue_id = venue.id))$old$,
  $new$      WHEN 'menu' THEN
        'menu' = ANY(COALESCE(public.issue_4490_feature_preset(venue.venue_category), '{}'::text[]))
        OR EXISTS (SELECT 1 FROM public.menus m WHERE m.venue_id = venue.id)$new$
);

-- Stay staff may hold the Stay capabilities and any capability used by an
-- enabled venue feature. Non-Stay venue grant rules stay unchanged.
SELECT pg_temp.issue_4490_patch(
  'public.issue_4188_set_member_venue_grants(uuid,uuid,jsonb)'::regprocedure,
  $old$              venue.venue_category = 'stay'
              AND grant_row->>'profile' IN ('front_desk', 'custom')
              AND NOT EXISTS (
                SELECT 1
                FROM jsonb_array_elements_text(
                  grant_row->'capabilities'
                ) capability
                WHERE capability NOT LIKE 'stay.%'
              )$old$,
  $new$              venue.venue_category = 'stay'
              AND grant_row->>'profile' IN (
                'front_desk', 'restaurant_manager', 'kitchen_bar', 'custom'
              )
              AND NOT EXISTS (
                SELECT 1
                FROM jsonb_array_elements_text(
                  grant_row->'capabilities'
                ) capability
                WHERE capability NOT LIKE 'stay.%'
                  AND capability NOT LIKE 'restaurant.%'
                  AND capability NOT LIKE 'venue.%'
              )$new$
);

COMMENT ON FUNCTION public.issue_1387_assert_stay_row_integrity() IS
  '#4490 J: rooms and places remain Stay-only; venue offer kinds may also belong to Stay venues.';
COMMENT ON FUNCTION public.issue_1388_assert_reservation_scope() IS
  '#4490 J: NULL offer_kind is the Stay rail; a non-NULL offer_kind is the venue-offer rail on any venue category.';

COMMIT;
