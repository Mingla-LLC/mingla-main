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

-- The Stay engine's own Host screens see only Stay rows. Venue offers on a
-- Stay are stay_offerings rows with an offer kind and reservation groups with
-- a non-NULL offer_kind; they belong to the venue-offer screens and cancel
-- path, never to Rooms & Places, Stay readiness or Stay Reservations.
SELECT pg_temp.issue_4490_patch(
  'public.issue_1387_stay_inventory_snapshot(uuid)'::regprocedure,
  $old$      FROM public.stay_offerings offering
      WHERE offering.venue_id = p_venue_id
    ), '[]'::jsonb)$old$,
  $new$      FROM public.stay_offerings offering
      WHERE offering.venue_id = p_venue_id
        AND offering.kind IN ('room', 'place')
    ), '[]'::jsonb)$new$
);

-- Every Stay inventory write addresses its row by offeringId, mediaId or
-- scheduleRuleId (window, night and schedule writes already filter on room
-- or place). Refuse a venue-offer row before any branch can edit it.
SELECT pg_temp.issue_4490_patch(
  'public.biz_manage_stay_inventory(text,uuid,jsonb,bigint,uuid)'::regprocedure,
  $old$  IF p_request_id IS NOT NULL THEN
    PERFORM set_config('mingla.request_id', p_request_id::text, true);
  END IF;

  IF v_action = 'resolve_currency_reconciliation' THEN$old$,
  $new$  IF p_request_id IS NOT NULL THEN
    PERFORM set_config('mingla.request_id', p_request_id::text, true);
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.stay_offerings venue_offer
    WHERE venue_offer.venue_id = p_venue_id
      AND venue_offer.kind NOT IN ('room', 'place')
      AND (
        venue_offer.id::text = lower(p_payload->>'offeringId')
        OR EXISTS (
          SELECT 1
          FROM public.stay_offering_media offer_media
          WHERE offer_media.offering_id = venue_offer.id
            AND offer_media.id::text = lower(p_payload->>'mediaId')
        )
        OR EXISTS (
          SELECT 1
          FROM public.stay_place_schedule_rules offer_rule
          WHERE offer_rule.offering_id = venue_offer.id
            AND offer_rule.id::text = lower(p_payload->>'scheduleRuleId')
        )
      )
  ) THEN
    RAISE EXCEPTION 'stay_offering_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF v_action = 'resolve_currency_reconciliation' THEN$new$
);

SELECT pg_temp.issue_4490_patch(
  'public.issue_1426_list_staff_stay_reservations(uuid)'::regprocedure,
  $old$      WHERE group_row.venue_id = p_venue_id
    ), '[]'::jsonb)$old$,
  $new$      WHERE group_row.venue_id = p_venue_id
        AND group_row.offer_kind IS NULL
    ), '[]'::jsonb)$new$
);

-- Group-scoped Stay reads and writes refuse a venue-offer group as not found.
-- issue_1426_staff_group_projection also closes every Stay write that returns
-- it (approve, decline, cancel, payment link rotate and revoke).
SELECT pg_temp.issue_4490_patch(
  'public.issue_1426_staff_group_projection(uuid)'::regprocedure,
  $old$  FROM public.stay_reservation_groups
  WHERE id = p_group_id;
  IF NOT FOUND THEN$old$,
  $new$  FROM public.stay_reservation_groups
  WHERE id = p_group_id
    AND offer_kind IS NULL;
  IF NOT FOUND THEN$new$
);

SELECT pg_temp.issue_4490_patch(
  'public.issue_1426_manage_request(text,uuid,bigint,text,uuid)'::regprocedure,
  $old$  FROM public.stay_reservation_groups
  WHERE id = p_group_id;
  IF NOT FOUND THEN$old$,
  $new$  FROM public.stay_reservation_groups
  WHERE id = p_group_id
    AND offer_kind IS NULL;
  IF NOT FOUND THEN$new$
);

SELECT pg_temp.issue_4490_patch(
  'public.issue_4188_cancel_preview(uuid,uuid[],bigint,uuid)'::regprocedure,
  $old$  FROM public.stay_reservation_groups
  WHERE id = p_group_id;$old$,
  $new$  FROM public.stay_reservation_groups
  WHERE id = p_group_id
    AND offer_kind IS NULL;$new$
);

SELECT pg_temp.issue_4490_patch(
  'public.issue_4188_cancel(uuid,text,text,text,uuid)'::regprocedure,
  $old$  WHERE preview.id = p_preview_id;$old$,
  $new$  WHERE preview.id = p_preview_id
    AND reservation_group.offer_kind IS NULL;$new$
);

-- Stay detail reads (staff availability, staff booking sheet, the public Stay
-- page and its "From ... a night") list rooms and places only.
SELECT pg_temp.issue_4490_patch(
  'public.issue_4188_staff_stay_details(uuid)'::regprocedure,
  $old$      WHERE offering.venue_id = p_venue_id
        AND offering.status = 'live'$old$,
  $new$      WHERE offering.venue_id = p_venue_id
        AND offering.status = 'live'
        AND offering.kind IN ('room', 'place')$new$
);

SELECT pg_temp.issue_4490_patch(
  'public.pg_public_stay_details(uuid)'::regprocedure,
  $old$      WHERE offering.venue_id = p_venue_id
        AND offering.status = 'live'$old$,
  $new$      WHERE offering.venue_id = p_venue_id
        AND offering.status = 'live'
        AND offering.kind IN ('room', 'place')$new$
);

-- Same checked patch for a statement that repeats verbatim in one body: the
-- exact occurrence count is a precondition, so drift still fails closed.
CREATE FUNCTION pg_temp.issue_4490_patch_each(
  p_sig regprocedure,
  p_old text,
  p_new text,
  p_expected integer
)
RETURNS void
LANGUAGE plpgsql
AS $patch$
DECLARE
  v_def text := pg_get_functiondef(p_sig);
  v_old_count integer;
BEGIN
  v_old_count := (length(v_def) - length(replace(v_def, p_old, ''))) / length(p_old);
  IF v_old_count <> p_expected THEN
    RAISE EXCEPTION 'issue_4490 stay feature patch precondition failed for %: old % expected %',
      p_sig, v_old_count, p_expected;
  END IF;
  EXECUTE replace(v_def, p_old, p_new);
END;
$patch$;

-- Stay inventory writes resolve every row id from the payload as a uuid once,
-- before any guard or branch: braces, missing hyphens, upper case and any
-- other spelling the uuid type accepts are the same id, and a value the uuid
-- type refuses is the ordinary invalid-payload refusal. The venue-offer guard
-- and every branch then use the same typed values, so the guard checks the
-- exact row the write would touch.
SELECT pg_temp.issue_4490_patch(
  'public.biz_manage_stay_inventory(text,uuid,jsonb,bigint,uuid)'::regprocedure,
  $old$  v_media_id uuid;
$old$,
  $new$  v_media_id uuid;
  v_schedule_rule_id uuid;
$new$
);

SELECT pg_temp.issue_4490_patch_each(
  'public.biz_manage_stay_inventory(text,uuid,jsonb,bigint,uuid)'::regprocedure,
  $old$    v_offering_id := (p_payload->>'offeringId')::uuid;
$old$,
  '',
  10
);

SELECT pg_temp.issue_4490_patch(
  'public.biz_manage_stay_inventory(text,uuid,jsonb,bigint,uuid)'::regprocedure,
  $old$    v_media_id := (p_payload->>'mediaId')::uuid;
$old$,
  ''
);

SELECT pg_temp.issue_4490_patch_each(
  'public.biz_manage_stay_inventory(text,uuid,jsonb,bigint,uuid)'::regprocedure,
  $old$(p_payload->>'scheduleRuleId')::uuid$old$,
  $new$v_schedule_rule_id$new$,
  3
);

SELECT pg_temp.issue_4490_patch(
  'public.biz_manage_stay_inventory(text,uuid,jsonb,bigint,uuid)'::regprocedure,
  $old$  IF EXISTS (
    SELECT 1
    FROM public.stay_offerings venue_offer
    WHERE venue_offer.venue_id = p_venue_id
      AND venue_offer.kind NOT IN ('room', 'place')
      AND (
        venue_offer.id::text = lower(p_payload->>'offeringId')
        OR EXISTS (
          SELECT 1
          FROM public.stay_offering_media offer_media
          WHERE offer_media.offering_id = venue_offer.id
            AND offer_media.id::text = lower(p_payload->>'mediaId')
        )
        OR EXISTS (
          SELECT 1
          FROM public.stay_place_schedule_rules offer_rule
          WHERE offer_rule.offering_id = venue_offer.id
            AND offer_rule.id::text = lower(p_payload->>'scheduleRuleId')
        )
      )
  ) THEN$old$,
  $new$  BEGIN
    v_offering_id := (p_payload->>'offeringId')::uuid;
    v_media_id := (p_payload->>'mediaId')::uuid;
    v_schedule_rule_id := (p_payload->>'scheduleRuleId')::uuid;
  EXCEPTION
    WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'stay_invalid_payload' USING ERRCODE = '22023';
  END;

  IF EXISTS (
    SELECT 1
    FROM public.stay_offerings venue_offer
    WHERE venue_offer.venue_id = p_venue_id
      AND venue_offer.kind NOT IN ('room', 'place')
      AND (
        venue_offer.id = v_offering_id
        OR venue_offer.id = (
          SELECT offer_media.offering_id
          FROM public.stay_offering_media offer_media
          WHERE offer_media.id = v_media_id
        )
        OR venue_offer.id = (
          SELECT offer_rule.offering_id
          FROM public.stay_place_schedule_rules offer_rule
          WHERE offer_rule.id = v_schedule_rule_id
        )
      )
  ) THEN$new$
);

-- Every Stays cancel, approve, decline and pay writer refuses a venue-offer
-- group (offer_kind IS NOT NULL, the same rule as the Stay screens above)
-- before it locks money rows, writes a preview or refund, or changes state.
-- A group's offer_kind is immutable and every preview row names its group, so
-- the group's kind is the minting path: Stays previews exist only for NULL-kind
-- groups and venue-offer previews only for offer groups. The venue-offer
-- executor already refuses NULL-kind groups (offer_cancel_preview_invalid).
SELECT pg_temp.issue_4490_patch(
  'public.issue_1389_cancel_preview(uuid,uuid[],bigint,uuid)'::regprocedure,
  $old$  FROM public.stay_reservation_groups
  WHERE id = p_group_id;
  IF NOT FOUND THEN$old$,
  $new$  FROM public.stay_reservation_groups
  WHERE id = p_group_id
    AND offer_kind IS NULL;
  IF NOT FOUND THEN$new$
);

SELECT pg_temp.issue_4490_patch(
  'public.issue_1389_cancel(uuid,text,text,text,uuid)'::regprocedure,
  $old$    RAISE EXCEPTION 'stay_invalid_payload' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'stay-cancel:' || p_preview_id::text,$old$,
  $new$    RAISE EXCEPTION 'stay_invalid_payload' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.stay_cancel_previews preview
    JOIN public.stay_reservation_groups reservation_group
      ON reservation_group.id = preview.group_id
    WHERE preview.id = p_preview_id
      AND reservation_group.offer_kind IS NULL
  ) THEN
    RAISE EXCEPTION 'stay_cancel_preview_invalid' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'stay-cancel:' || p_preview_id::text,$new$
);

SELECT pg_temp.issue_4490_patch(
  'public.issue_1392_cancel_preview_base(uuid,uuid[],bigint,uuid)'::regprocedure,
  $old$  FROM public.stay_reservation_groups
  WHERE id = p_group_id;
  IF NOT FOUND THEN$old$,
  $new$  FROM public.stay_reservation_groups
  WHERE id = p_group_id
    AND offer_kind IS NULL;
  IF NOT FOUND THEN$new$
);

SELECT pg_temp.issue_4490_patch(
  'public.issue_1392_cancel_base(uuid,text,text,text,uuid)'::regprocedure,
  $old$  FROM public.stay_cancel_previews
  WHERE id = p_preview_id;
  IF NOT FOUND THEN$old$,
  $new$  FROM public.stay_cancel_previews
  WHERE id = p_preview_id
    AND group_id IN (
      SELECT reservation_group.id
      FROM public.stay_reservation_groups reservation_group
      WHERE reservation_group.offer_kind IS NULL
    );
  IF NOT FOUND THEN$new$
);

SELECT pg_temp.issue_4490_patch(
  'public.issue_4188_property_cancel_preview(uuid,uuid[],bigint,uuid)'::regprocedure,
  $old$  FROM public.stay_reservation_groups
  WHERE id = p_group_id;
  IF NOT FOUND THEN$old$,
  $new$  FROM public.stay_reservation_groups
  WHERE id = p_group_id
    AND offer_kind IS NULL;
  IF NOT FOUND THEN$new$
);

SELECT pg_temp.issue_4490_patch(
  'public.issue_4188_property_cancel(uuid,text,text,text,uuid)'::regprocedure,
  $old$  WHERE id = v_preview.group_id
  FOR UPDATE;
  IF NOT FOUND OR v_group.payment_collection <> 'property' THEN$old$,
  $new$  WHERE id = v_preview.group_id
    AND offer_kind IS NULL
  FOR UPDATE;
  IF NOT FOUND OR v_group.payment_collection <> 'property' THEN$new$
);

SELECT pg_temp.issue_4490_patch(
  'public.issue_1388_manage_request(text,uuid,bigint,text,uuid)'::regprocedure,
  $old$  FROM public.stay_reservation_groups
  WHERE id = p_group_id;
  IF NOT FOUND THEN$old$,
  $new$  FROM public.stay_reservation_groups
  WHERE id = p_group_id
    AND offer_kind IS NULL;
  IF NOT FOUND THEN$new$
);

SELECT pg_temp.issue_4490_patch(
  'public.issue_1389_prepare_payment(uuid,text,bigint,uuid)'::regprocedure,
  $old$  WHERE id = p_group_id
  FOR UPDATE;
  IF NOT FOUND OR v_group.user_id IS DISTINCT FROM v_uid THEN$old$,
  $new$  WHERE id = p_group_id
    AND offer_kind IS NULL
  FOR UPDATE;
  IF NOT FOUND OR v_group.user_id IS DISTINCT FROM v_uid THEN$new$
);

-- Ids nested in the payload (mediaIds[], windows[].windowId) and the
-- reconciliation ids go through the same typed parse as the top-level ids: a
-- value the uuid type refuses, or a list that is not a list, is the ordinary
-- invalid-payload refusal before any row is read or written.
SELECT pg_temp.issue_4490_patch(
  'public.biz_manage_stay_inventory(text,uuid,jsonb,bigint,uuid)'::regprocedure,
  $old$    v_schedule_rule_id := (p_payload->>'scheduleRuleId')::uuid;
  EXCEPTION$old$,
  $new$    v_schedule_rule_id := (p_payload->>'scheduleRuleId')::uuid;
    PERFORM NULLIF(p_payload->>'reconciliationId', '')::uuid,
            NULLIF(p_payload->>'fxSnapshotId', '')::uuid;
    IF jsonb_typeof(p_payload->'mediaIds') NOT IN ('array', 'null')
       OR jsonb_typeof(p_payload->'windows') NOT IN ('array', 'null') THEN
      RAISE EXCEPTION 'stay_invalid_payload' USING ERRCODE = '22023';
    END IF;
    PERFORM count((media_id.value #>> '{}')::uuid)
    FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_payload->'mediaIds') = 'array'
                                   THEN p_payload->'mediaIds' ELSE '[]'::jsonb END) media_id;
    PERFORM count((window_item.value->>'windowId')::uuid)
    FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_payload->'windows') = 'array'
                                   THEN p_payload->'windows' ELSE '[]'::jsonb END) window_item;
  EXCEPTION$new$
);

-- R4J-N21: the list fields the capability check reads (fees, items[].fees,
-- nights, windows, units) are read with jsonb_array_* BEFORE the typed id
-- parse below, so `windows` sent as an object or a string surfaced the raw
-- "cannot extract elements from an object/scalar" (edge 500). A present list
-- field that is not a JSON array (JSON null included) is the plain
-- invalid-payload refusal, after auth and before any row is read or written.
SELECT pg_temp.issue_4490_patch(
  'public.biz_manage_stay_inventory(text,uuid,jsonb,bigint,uuid)'::regprocedure,
  $old$  v_requires_finance := v_action IN ($old$,
  $new$  IF (p_payload IS NOT NULL AND jsonb_typeof(p_payload) <> 'object')
     OR EXISTS (
       SELECT 1
       FROM unnest(ARRAY['fees', 'items', 'nights', 'windows', 'units']) list_key
       WHERE p_payload ? list_key
         AND jsonb_typeof(p_payload->list_key) IS DISTINCT FROM 'array'
     )
     OR (
       jsonb_typeof(p_payload->'items') = 'array'
       AND EXISTS (
         SELECT 1
         FROM jsonb_array_elements(p_payload->'items') item
         WHERE jsonb_typeof(item) IS DISTINCT FROM 'object'
            OR (item ? 'fees' AND jsonb_typeof(item->'fees') IS DISTINCT FROM 'array')
       )
     )
     OR (
       jsonb_typeof(p_payload->'nights') = 'array'
       AND EXISTS (
         SELECT 1
         FROM jsonb_array_elements(p_payload->'nights') night
         WHERE jsonb_typeof(night) IS DISTINCT FROM 'object'
       )
     )
     OR (
       jsonb_typeof(p_payload->'windows') = 'array'
       AND EXISTS (
         SELECT 1
         FROM jsonb_array_elements(p_payload->'windows') window_item
         WHERE jsonb_typeof(window_item) IS DISTINCT FROM 'object'
       )
     ) THEN
    RAISE EXCEPTION 'stay_invalid_payload' USING ERRCODE = '22023';
  END IF;
  v_requires_finance := v_action IN ($new$
);

COMMENT ON FUNCTION public.issue_1387_assert_stay_row_integrity() IS
  '#4490 J: rooms and places remain Stay-only; venue offer kinds may also belong to Stay venues.';
COMMENT ON FUNCTION public.issue_1388_assert_reservation_scope() IS
  '#4490 J: NULL offer_kind is the Stay rail; a non-NULL offer_kind is the venue-offer rail on any venue category.';

-- The helpers live in pg_temp for the session: drop them so a later migration
-- applied in the same session (the CLI and CI replay every file in one
-- connection) can define its own helper of the same name.
DROP FUNCTION pg_temp.issue_4490_patch_each(regprocedure, text, text, integer);
DROP FUNCTION pg_temp.issue_4490_patch(regprocedure, text, text);

COMMIT;
