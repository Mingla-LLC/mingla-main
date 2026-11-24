-- #4490 P4 follow-up — private hire: "Hours you set" with minimum hours,
-- changing a hire's day or party, returning the refundable damage deposit.
--
--   * "Hours you set": a hire may add a flexible rule (opening hours) with a
--     shortest booking (the minimum hours), a longest booking and a step; the
--     guest picks a start and a length (the P5 flexible windows) and a place;
--     a place may be priced per hour (price x hours, half up).
--   * A hire's party or day can change (staff any time before it ends; the
--     guest within the booking's date-change rule): the price follows the
--     row (per guest up to the row's largest group, the extra-guest price
--     above it); a new day must have the same place free (setup and cleanup
--     included); the space claims move in the same transaction (old released,
--     new claimed: the exclusion constraint decides) and the day's entry limit
--     is checked again. The same claim move applies to by-the-hour bookings.
--   * The refundable damage deposit is returned after the event: staff with
--     money rights return it (in full, or keeping part with a reason), or hold
--     it (a claim); otherwise the offer sweep returns it in full
--     damage_deposit_release_days (venue setting, default 7) after the hire
--     ends. Only the damage-deposit part of each payment is refunded and no
--     platform fee is reversed (none was charged on it).
--   * The hire guest list (venue_booking_guests) is not built: the
--     reconciliation keeps guest lists out of the first build; check-in keeps
--     the one booking pass that admits the party.
--
-- No new tables. Static SQL. Local stack only until Seth says otherwise.
-- Reverse (local only): restore the redefined functions from 20281203154490 /
-- 20281203144490 / 20281203164490; drop the new functions.

BEGIN;
SET LOCAL lock_timeout = '5s';

-- A payment allocation that paid the damage deposit (a fee line whose fee
-- version is the damage deposit).
CREATE OR REPLACE FUNCTION public.issue_4490_is_damage_allocation(p_component text, p_component_ref text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT p_component = 'fee' AND EXISTS (
    SELECT 1 FROM public.stay_quote_fee_lines f
    WHERE f.id::text = p_component_ref AND f.snapshot->>'fee_key' = 'damage_deposit');
$function$;

-- Where a hire's damage deposit stands: none | due (not paid yet) |
-- collected (returned automatically at releaseAt) | held_by_venue (a claim) |
-- released (refundedMinor back to the guest, keptMinor kept with a reason).
CREATE OR REPLACE FUNCTION public.issue_4490_damage_deposit_state(p_group_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  WITH g AS (
    SELECT g.* FROM public.stay_reservation_groups g WHERE g.id = p_group_id AND g.offer_kind = 'private_hire'
  ), paid AS (
    SELECT COALESCE(sum(GREATEST(0, a.charged_minor - a.refunded_minor - COALESCE((
             SELECT sum(ra.amount_minor) FROM public.stay_refund_allocations ra
             JOIN public.stay_refunds rr ON rr.id = ra.refund_id
             WHERE ra.payment_allocation_id = a.id AND rr.state IN ('submitted', 'processing', 'manual_reconciliation')), 0))), 0)::bigint AS amount
    FROM public.stay_payment_allocations a
    JOIN public.stay_payment_attempts p ON p.id = a.payment_attempt_id
    WHERE p.group_id = p_group_id AND p.state = 'succeeded'
      AND public.issue_4490_is_damage_allocation(a.component, a.component_ref)
  ), released AS (
    SELECT e.safe_metadata, e.created_at FROM public.stay_reservation_events e
    WHERE e.group_id = p_group_id AND e.event_type = 'stay_offer_deposit_released'
    ORDER BY e.created_at DESC LIMIT 1
  ), held AS (
    SELECT e.safe_metadata, e.created_at FROM public.stay_reservation_events e
    WHERE e.group_id = p_group_id AND e.event_type = 'stay_offer_deposit_held'
    ORDER BY e.created_at DESC LIMIT 1
  ), ends AS (
    SELECT COALESCE(
      (SELECT max(upper(c.booked_range)) FROM public.venue_space_claims c
       WHERE c.group_id = p_group_id AND c.state IN ('held', 'committed')),
      (SELECT (q.inventory_snapshot->>'bookedTo')::timestamptz
       FROM public.stay_reservation_lines l JOIN public.stay_quote_lines q ON q.id = l.quote_line_id
       WHERE l.group_id = p_group_id ORDER BY l.created_at, l.id LIMIT 1)) AS booked_to
  )
  SELECT CASE WHEN g.id IS NULL THEN NULL ELSE jsonb_strip_nulls(jsonb_build_object(
    'amountMinor', COALESCE((g.payment_plan_snapshot->>'damageDepositMinor')::bigint, 0),
    'paidMinor', paid.amount,
    'status', CASE
      WHEN (SELECT 1 FROM released) IS NOT NULL THEN 'released'
      WHEN COALESCE((g.payment_plan_snapshot->>'damageDepositMinor')::bigint, 0) = 0 THEN 'none'
      WHEN paid.amount = 0 THEN 'due'
      WHEN (SELECT 1 FROM held) IS NOT NULL THEN 'held_by_venue'
      ELSE 'collected' END,
    'hireEndsAt', ends.booked_to,
    'releaseAt', CASE WHEN paid.amount > 0 AND (SELECT 1 FROM released) IS NULL AND (SELECT 1 FROM held) IS NULL
                      THEN ends.booked_to + make_interval(days => COALESCE(s.damage_deposit_release_days, 7)) END,
    'heldReason', (SELECT h.safe_metadata->>'reason' FROM held h),
    'refundedMinor', (SELECT (r.safe_metadata->>'refundMinor')::bigint FROM released r),
    'keptMinor', (SELECT (r.safe_metadata->>'keptMinor')::bigint FROM released r),
    'keptReason', (SELECT r.safe_metadata->>'reason' FROM released r),
    'releasedAt', (SELECT r.created_at FROM released r))) END
  FROM (SELECT 1) one
  LEFT JOIN g ON true
  CROSS JOIN paid
  CROSS JOIN ends
  LEFT JOIN public.venue_booking_settings s ON s.venue_id = g.venue_id;
$function$;

-- The largest party a booking change may set: the row's largest group (at
-- most 1,000), or for a hire that sells extra guests, its place's capacity.
CREATE OR REPLACE FUNCTION public.issue_4490_change_guest_max(p_offering_id uuid, p_option_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT CASE
    WHEN o.kind = 'private_hire' AND o.extra_guest_minor IS NOT NULL
      THEN LEAST(public.issue_4490_option_capacity(opt.id), 100000)
    ELSE LEAST(COALESCE(opt.guest_max, 1000), 1000) END
  FROM public.stay_offerings o
  JOIN public.venue_offer_price_options opt ON opt.id = p_option_id
  WHERE o.id = p_offering_id;
$function$;


-- hire authoring: + set_flexible (Hours you set), price rows per hour (from 20281203154490_issue_4490_p4_private_hire.sql)
CREATE OR REPLACE FUNCTION public.issue_4490_manage_hire(
  p_action text,
  p_venue_id uuid,
  p_payload jsonb,
  p_expected_version bigint,
  p_idempotency_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_venue public.venue_listings%ROWTYPE;
  v_settings public.venue_booking_settings%ROWTYPE;
  v_offer public.stay_offerings%ROWTYPE;
  v_option public.venue_offer_price_options%ROWTYPE;
  v_price public.stay_price_versions%ROWTYPE;
  v_hash text;
  v_replay jsonb;
  v_result jsonb;
  v_spaces uuid[];
  v_combos uuid[];
  v_parts uuid[];
  v_space uuid;
  v_combo uuid;
  v_capacity integer;
  v_place text;
  v_weekdays smallint[];
  v_amount bigint;
  v_next integer;
  v_currency text;
  v_opt_id uuid;
  v_session jsonb;
  v_start time;
  v_end time;
  v_minutes integer;
  v_windows integer := 0;
  v_kind text;
  v_value bigint;
  v_days integer;
  v_min integer;
  v_max integer;
  v_step integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  IF p_action NOT IN ('set_spaces', 'set_price_row', 'set_sessions', 'set_terms', 'set_booking', 'set_flexible')
     OR p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'invalid_payload' USING ERRCODE = '22023';
  END IF;
  IF NOT public.issue_4490_flag_on('VENUE_OFFERS_WRITES') THEN
    RAISE EXCEPTION 'offers_not_enabled' USING ERRCODE = 'P0001';
  END IF;
  SELECT * INTO v_venue FROM public.venue_listings WHERE id = p_venue_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'venue_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public.issue_4490_can_manage_venue(p_venue_id, 'venue.manage_offers') THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  v_hash := encode(pg_catalog.sha256(convert_to(jsonb_build_object(
    'action', p_action, 'venue', p_venue_id, 'payload', p_payload, 'expected', p_expected_version)::text, 'UTF8')), 'hex');
  v_replay := public.issue_4490_receipt_lookup('manage_hire:' || p_venue_id::text, p_idempotency_key, v_hash);
  IF v_replay IS NOT NULL THEN
    RETURN v_replay;
  END IF;
  SELECT * INTO v_offer FROM public.stay_offerings
  WHERE id = NULLIF(p_payload->>'offerId', '')::uuid AND venue_id = p_venue_id
    AND kind NOT IN ('room', 'place')
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'offer_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF p_expected_version IS NULL OR v_offer.version <> p_expected_version THEN
    RAISE EXCEPTION 'stale_write' USING ERRCODE = 'PT409';
  END IF;
  IF v_offer.status = 'archived' THEN
    RAISE EXCEPTION 'offer_archived' USING ERRCODE = 'PT409';
  END IF;
  IF v_offer.kind <> 'private_hire' THEN
    RAISE EXCEPTION 'offer_kind_invalid' USING ERRCODE = '22023';
  END IF;
  v_settings := public.issue_4490_ensure_booking_settings(p_venue_id);
  SELECT upper(COALESCE(NULLIF(btrim(b.default_currency), ''), 'NGN')) INTO v_currency
  FROM public.brands b WHERE b.id = v_venue.brand_id;

  IF p_action = 'set_spaces' THEN
    IF jsonb_typeof(COALESCE(p_payload->'spaceIds', '[]'::jsonb)) <> 'array'
       OR jsonb_typeof(COALESCE(p_payload->'combinationIds', '[]'::jsonb)) <> 'array'
       OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(COALESCE(p_payload->'spaceIds', '[]'::jsonb)) x
                  WHERE x !~ '^[0-9a-f-]{36}$')
       OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(COALESCE(p_payload->'combinationIds', '[]'::jsonb)) x
                  WHERE x !~ '^[0-9a-f-]{36}$') THEN
      RAISE EXCEPTION 'hire_spaces_invalid' USING ERRCODE = '22023';
    END IF;
    SELECT COALESCE(array_agg(DISTINCT x::uuid), '{}'::uuid[]) INTO v_spaces
    FROM jsonb_array_elements_text(COALESCE(p_payload->'spaceIds', '[]'::jsonb)) x;
    SELECT COALESCE(array_agg(DISTINCT x::uuid), '{}'::uuid[]) INTO v_combos
    FROM jsonb_array_elements_text(COALESCE(p_payload->'combinationIds', '[]'::jsonb)) x;
    IF cardinality(v_spaces) + cardinality(v_combos) = 0 OR cardinality(v_combos) > 20 THEN
      RAISE EXCEPTION 'hire_spaces_invalid' USING ERRCODE = '22023';
    END IF;
    IF EXISTS (SELECT 1 FROM unnest(v_spaces) s WHERE NOT EXISTS (
         SELECT 1 FROM public.venue_spaces vs WHERE vs.id = s AND vs.venue_id = p_venue_id
           AND vs.is_active AND vs.archived_at IS NULL AND vs.can_be_hired)) THEN
      RAISE EXCEPTION 'hire_space_not_hirable' USING ERRCODE = '22023';
    END IF;
    IF EXISTS (SELECT 1 FROM unnest(v_combos) c WHERE NOT EXISTS (
         SELECT 1 FROM public.venue_space_combinations vc WHERE vc.id = c AND vc.venue_id = p_venue_id
           AND vc.archived_at IS NULL
           AND NOT EXISTS (SELECT 1 FROM unnest(vc.space_ids) p WHERE NOT EXISTS (
             SELECT 1 FROM public.venue_spaces vs WHERE vs.id = p AND vs.is_active AND vs.archived_at IS NULL
               AND vs.can_be_hired)))) THEN
      RAISE EXCEPTION 'hire_space_not_hirable' USING ERRCODE = '22023';
    END IF;
    SELECT COALESCE(array_agg(DISTINCT p), '{}'::uuid[]) INTO v_parts
    FROM (SELECT unnest(v_spaces) p
          UNION SELECT unnest(vc.space_ids) FROM public.venue_space_combinations vc WHERE vc.id = ANY(v_combos)) all_parts;
    -- A price row on a place no longer offered must be archived first.
    IF EXISTS (SELECT 1 FROM public.venue_offer_price_options o
               WHERE o.offering_id = v_offer.id AND o.status = 'active'
                 AND ((o.space_id IS NOT NULL AND NOT o.space_id = ANY(v_spaces))
                      OR (o.combination_id IS NOT NULL AND NOT o.combination_id = ANY(v_combos)))) THEN
      RAISE EXCEPTION 'hire_space_in_use' USING ERRCODE = 'PT409';
    END IF;
    DELETE FROM public.venue_offer_spaces WHERE offering_id = v_offer.id AND NOT space_id = ANY(v_parts);
    INSERT INTO public.venue_offer_spaces (offering_id, space_id, venue_id, brand_id)
    SELECT v_offer.id, p, p_venue_id, v_venue.brand_id FROM unnest(v_parts) p
    ON CONFLICT (offering_id, space_id) DO NOTHING;
    UPDATE public.stay_offerings
    SET hire_combination_ids = v_combos, version = version + 1, updated_at = now(), updated_by = v_uid
    WHERE id = v_offer.id RETURNING * INTO v_offer;

  ELSIF p_action = 'set_price_row' THEN
    IF char_length(btrim(COALESCE(p_payload->>'name', ''))) NOT BETWEEN 1 AND 80 THEN
      RAISE EXCEPTION 'option_name_required' USING ERRCODE = '22023';
    END IF;
    -- #4490 P4 follow-up: a place may be priced per hour (with "Hours you set").
    IF COALESCE(p_payload->>'unit', '') NOT IN ('guest', 'booking', 'hour') THEN
      RAISE EXCEPTION 'option_unit_invalid' USING ERRCODE = '22023';
    END IF;
    v_space := CASE WHEN COALESCE(p_payload->>'spaceId', '') ~ '^[0-9a-f-]{36}$' THEN (p_payload->>'spaceId')::uuid END;
    v_combo := CASE WHEN COALESCE(p_payload->>'combinationId', '') ~ '^[0-9a-f-]{36}$'
                    THEN (p_payload->>'combinationId')::uuid END;
    IF (v_space IS NULL) = (v_combo IS NULL)
       OR (v_space IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.venue_offer_spaces s
             WHERE s.offering_id = v_offer.id AND s.space_id = v_space))
       OR (v_combo IS NOT NULL AND NOT v_combo = ANY(v_offer.hire_combination_ids)) THEN
      RAISE EXCEPTION 'hire_price_space_missing' USING ERRCODE = '22023';
    END IF;
    IF COALESCE(p_payload->>'guestMin', '') !~ '^[0-9]{1,6}$' OR COALESCE(p_payload->>'guestMax', '') !~ '^[0-9]{1,6}$'
       OR (p_payload->>'guestMin')::integer < 1
       OR (p_payload->>'guestMax')::integer < (p_payload->>'guestMin')::integer THEN
      RAISE EXCEPTION 'option_guests_invalid' USING ERRCODE = '22023';
    END IF;
    IF v_space IS NOT NULL THEN
      v_capacity := public.issue_4490_space_capacity(v_space);
      SELECT name INTO v_place FROM public.venue_spaces WHERE id = v_space;
    ELSE
      SELECT COALESCE(sum(public.issue_4490_space_capacity(p)), 0), min(c.name) INTO v_capacity, v_place
      FROM public.venue_space_combinations c, unnest(c.space_ids) p WHERE c.id = v_combo;
    END IF;
    IF (p_payload->>'guestMax')::integer > v_capacity THEN
      -- "More than <Space> holds (N)"
      RAISE EXCEPTION 'option_over_space_capacity' USING ERRCODE = '22023',
        DETAIL = jsonb_build_object('capacity', v_capacity, 'placeName', v_place)::text;
    END IF;
    IF jsonb_typeof(p_payload->'priceMinor') <> 'number' OR (p_payload->>'priceMinor') !~ '^[0-9]{1,12}$' THEN
      RAISE EXCEPTION 'option_price_invalid' USING ERRCODE = '22023';
    END IF;
    v_amount := (p_payload->>'priceMinor')::bigint;
    IF p_payload ? 'weekdays' THEN
      IF jsonb_typeof(p_payload->'weekdays') <> 'array' OR jsonb_array_length(p_payload->'weekdays') NOT BETWEEN 1 AND 7
         OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(p_payload->'weekdays') d WHERE d !~ '^[0-6]$') THEN
        RAISE EXCEPTION 'option_weekdays_invalid' USING ERRCODE = '22023';
      END IF;
      SELECT array_agg(DISTINCT d::smallint ORDER BY d::smallint) INTO v_weekdays
      FROM jsonb_array_elements_text(p_payload->'weekdays') d;
    ELSE
      v_weekdays := '{0,1,2,3,4,5,6}'::smallint[];
    END IF;
    v_opt_id := CASE WHEN COALESCE(p_payload->>'optionId', '') ~ '^[0-9a-f-]{36}$' THEN (p_payload->>'optionId')::uuid END;
    IF v_opt_id IS NULL THEN
      INSERT INTO public.venue_offer_price_options (
        offering_id, venue_id, brand_id, name, unit, guest_min, guest_max, weekdays,
        space_id, combination_id, sort_order, updated_by
      ) VALUES (
        v_offer.id, p_venue_id, v_venue.brand_id, btrim(p_payload->>'name'), p_payload->>'unit',
        (p_payload->>'guestMin')::integer, (p_payload->>'guestMax')::integer, v_weekdays,
        v_space, v_combo,
        COALESCE((p_payload->>'sortOrder')::integer,
                 (SELECT COALESCE(max(sort_order), -1) + 1 FROM public.venue_offer_price_options WHERE offering_id = v_offer.id)),
        v_uid
      ) RETURNING * INTO v_option;
    ELSE
      UPDATE public.venue_offer_price_options
      SET name = btrim(p_payload->>'name'), unit = p_payload->>'unit',
          guest_min = (p_payload->>'guestMin')::integer, guest_max = (p_payload->>'guestMax')::integer,
          weekdays = v_weekdays, space_id = v_space, combination_id = v_combo,
          sort_order = COALESCE((p_payload->>'sortOrder')::integer, sort_order),
          version = version + 1, updated_at = now(), updated_by = v_uid
      WHERE id = v_opt_id AND offering_id = v_offer.id AND status = 'active'
      RETURNING * INTO v_option;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'option_not_found' USING ERRCODE = 'P0002';
      END IF;
    END IF;
    SELECT * INTO v_price FROM public.stay_price_versions
    WHERE offering_id = v_offer.id AND price_option_id = v_option.id AND effective_to IS NULL
    FOR UPDATE;
    IF NOT FOUND OR v_price.amount_minor <> v_amount
       OR v_price.pricing_unit <> public.issue_4490_option_pricing_unit(v_option.unit)
       OR v_price.currency_code <> v_currency THEN
      IF FOUND THEN
        UPDATE public.stay_price_versions SET effective_to = now() WHERE id = v_price.id;
      END IF;
      SELECT COALESCE(max(version_number), 0) + 1 INTO v_next
      FROM public.stay_price_versions WHERE offering_id = v_offer.id;
      INSERT INTO public.stay_price_versions (
        offering_id, brand_id, venue_id, version_number, amount_minor, currency_code,
        pricing_unit, price_option_id, supersedes_version_id, created_by
      ) VALUES (
        v_offer.id, v_offer.brand_id, v_offer.venue_id, v_next, v_amount, v_currency,
        public.issue_4490_option_pricing_unit(v_option.unit), v_option.id,
        CASE WHEN v_price.id IS NULL THEN NULL ELSE v_price.id END, v_uid
      );
    END IF;
    UPDATE public.stay_offerings SET version = version + 1, updated_at = now(), updated_by = v_uid
    WHERE id = v_offer.id RETURNING * INTO v_offer;

  ELSIF p_action = 'set_sessions' THEN
    IF jsonb_typeof(p_payload->'sessions') <> 'array' OR jsonb_array_length(p_payload->'sessions') NOT BETWEEN 1 AND 6 THEN
      RAISE EXCEPTION 'hire_sessions_invalid' USING ERRCODE = '22023';
    END IF;
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_payload->'sessions') s
               WHERE jsonb_typeof(s) <> 'object'
                  OR char_length(btrim(COALESCE(s->>'label', ''))) NOT BETWEEN 1 AND 40
                  OR COALESCE(s->>'startTime', '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
                  OR COALESCE(s->>'endTime', '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
                  OR s->>'startTime' = s->>'endTime')
       OR (SELECT count(DISTINCT lower(btrim(s->>'label'))) FROM jsonb_array_elements(p_payload->'sessions') s)
          <> jsonb_array_length(p_payload->'sessions') THEN
      RAISE EXCEPTION 'hire_sessions_invalid' USING ERRCODE = '22023';
    END IF;
    IF jsonb_typeof(p_payload->'weekdays') <> 'array' OR jsonb_array_length(p_payload->'weekdays') NOT BETWEEN 1 AND 7
       OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(p_payload->'weekdays') d WHERE d !~ '^[0-6]$') THEN
      RAISE EXCEPTION 'schedule_weekdays_invalid' USING ERRCODE = '22023';
    END IF;
    SELECT array_agg(DISTINCT d::smallint ORDER BY d::smallint) INTO v_weekdays
    FROM jsonb_array_elements_text(p_payload->'weekdays') d;
    -- Retire the old sessions: future windows with nothing held or sold stop selling.
    UPDATE public.stay_place_windows w
    SET stop_sell = true, version = version + 1, updated_at = now(), updated_by = v_uid
    WHERE w.offering_id = v_offer.id AND w.starts_at > now() AND NOT w.stop_sell
      AND NOT w.booked_block
      AND NOT public.issue_4490_window_is_flexible(w.id)
      AND NOT EXISTS (
        SELECT 1 FROM public.stay_inventory_hold_slices s
        JOIN public.stay_inventory_holds h ON h.id = s.hold_id
        WHERE s.place_window_id = w.id AND h.state IN ('active', 'reconciliation_required'))
      AND NOT EXISTS (
        SELECT 1 FROM public.stay_inventory_commitments c
        WHERE c.place_window_id = w.id AND c.state = 'active')
      AND NOT EXISTS (
        SELECT 1 FROM public.stay_reservation_lines l
        JOIN public.stay_reservation_groups g ON g.id = l.group_id
        WHERE l.place_window_id = w.id AND g.state IN ('request_pending', 'approved_payment_required'));
    UPDATE public.stay_place_schedule_rules
    SET active = false, version = version + 1, updated_at = now(), updated_by = v_uid
    WHERE offering_id = v_offer.id AND active AND mode <> 'flexible';
    FOR v_session IN SELECT s FROM jsonb_array_elements(p_payload->'sessions') s ORDER BY s->>'startTime'
    LOOP
      v_start := (v_session->>'startTime')::time;
      v_end := (v_session->>'endTime')::time;
      v_minutes := (extract(epoch FROM (v_end - v_start))::integer / 60);
      IF v_minutes <= 0 THEN
        v_minutes := v_minutes + 1440;
      END IF;
      INSERT INTO public.stay_place_schedule_rules (
        offering_id, brand_id, venue_id, mode, timezone, local_start_date, local_end_date, weekdays,
        local_start_time, local_end_time, slot_duration_minutes, slot_interval_minutes,
        full_day_start_time, full_day_end_time, session_label, created_by, updated_by
      ) VALUES (
        v_offer.id, v_offer.brand_id, v_offer.venue_id, 'repeating_windows', v_settings.timezone,
        COALESCE(NULLIF(p_payload->>'startDate', '')::date, (now() AT TIME ZONE v_settings.timezone)::date),
        NULLIF(p_payload->>'endDate', '')::date,
        v_weekdays, v_start, v_end, v_minutes, v_minutes, NULL, NULL,
        btrim(v_session->>'label'), v_uid, v_uid
      );
    END LOOP;
    UPDATE public.stay_offerings SET version = version + 1, updated_at = now(), updated_by = v_uid
    WHERE id = v_offer.id RETURNING * INTO v_offer;
    IF v_offer.status = 'live' THEN
      v_windows := public.issue_4490_materialize_offer_windows(v_offer.id);
    END IF;

  ELSIF p_action = 'set_flexible' THEN
    -- #4490 P4 follow-up: "Hours you set": the guest picks a start and a
    -- length (shortest = the minimum hours) inside these hours.
    IF jsonb_typeof(p_payload->'enabled') <> 'boolean' THEN
      RAISE EXCEPTION 'hire_flexible_invalid' USING ERRCODE = '22023';
    END IF;
    UPDATE public.stay_place_windows w
    SET stop_sell = true, version = w.version + 1, updated_at = now(), updated_by = v_uid
    WHERE w.offering_id = v_offer.id AND NOT w.booked_block AND NOT w.stop_sell
      AND public.issue_4490_window_is_flexible(w.id);
    UPDATE public.stay_place_schedule_rules
    SET active = false, version = version + 1, updated_at = now(), updated_by = v_uid
    WHERE offering_id = v_offer.id AND active AND mode = 'flexible';
    IF (p_payload->>'enabled')::boolean THEN
      IF jsonb_typeof(p_payload->'weekdays') <> 'array' OR jsonb_array_length(p_payload->'weekdays') NOT BETWEEN 1 AND 7
         OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(p_payload->'weekdays') d WHERE d !~ '^[0-6]$') THEN
        RAISE EXCEPTION 'schedule_weekdays_invalid' USING ERRCODE = '22023';
      END IF;
      IF COALESCE(p_payload->>'startTime', '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
         OR COALESCE(p_payload->>'endTime', '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
         OR p_payload->>'startTime' = p_payload->>'endTime'
         OR COALESCE(p_payload->>'stepMinutes', '') NOT IN ('15', '30', '60')
         OR COALESCE(p_payload->>'minMinutes', '') !~ '^[0-9]{1,4}$'
         OR (p_payload ? 'maxMinutes' AND p_payload->'maxMinutes' <> 'null'::jsonb
             AND COALESCE(p_payload->>'maxMinutes', '') !~ '^[0-9]{1,4}$') THEN
        RAISE EXCEPTION 'hire_flexible_invalid' USING ERRCODE = '22023';
      END IF;
      v_step := (p_payload->>'stepMinutes')::integer;
      v_min := (p_payload->>'minMinutes')::integer;
      v_max := NULLIF(p_payload->>'maxMinutes', '')::integer;
      IF v_min < 30 OR v_min > 1440 OR v_min % v_step <> 0
         OR (v_max IS NOT NULL AND (v_max < v_min OR v_max > 1440 OR v_max % v_step <> 0)) THEN
        RAISE EXCEPTION 'hire_flexible_invalid' USING ERRCODE = '22023';
      END IF;
      SELECT array_agg(DISTINCT d::smallint ORDER BY d::smallint) INTO v_weekdays
      FROM jsonb_array_elements_text(p_payload->'weekdays') d;
      INSERT INTO public.stay_place_schedule_rules (
        offering_id, brand_id, venue_id, mode, timezone, local_start_date, local_end_date, weekdays,
        local_start_time, local_end_time, session_label, created_by, updated_by
      ) VALUES (
        v_offer.id, v_offer.brand_id, v_offer.venue_id, 'flexible', v_settings.timezone,
        COALESCE(NULLIF(p_payload->>'startDate', '')::date, (now() AT TIME ZONE v_settings.timezone)::date),
        NULLIF(p_payload->>'endDate', '')::date, v_weekdays,
        (p_payload->>'startTime')::time, (p_payload->>'endTime')::time, 'Hours you set', v_uid, v_uid
      );
      UPDATE public.stay_offerings
      SET booking_length_step_minutes = v_step, booking_length_min_minutes = v_min,
          booking_length_max_minutes = v_max
      WHERE id = v_offer.id;
    END IF;
    UPDATE public.stay_offerings SET version = version + 1, updated_at = now(), updated_by = v_uid
    WHERE id = v_offer.id RETURNING * INTO v_offer;
    IF v_offer.status = 'live' THEN
      v_windows := public.issue_4490_materialize_offer_windows(v_offer.id);
      UPDATE public.stay_place_windows w SET stop_sell = false, version = w.version + 1, updated_at = now()
      FROM public.stay_place_schedule_rules r
      WHERE w.offering_id = v_offer.id AND NOT w.booked_block AND w.stop_sell AND w.starts_at > now()
        AND r.id = w.schedule_rule_id AND r.active AND r.mode = 'flexible';
    END IF;

  ELSIF p_action = 'set_terms' THEN
    IF (p_payload ? 'hireCharge' AND COALESCE(p_payload->>'hireCharge', '') NOT IN ('hire_fee', 'min_spend', 'per_guest'))
       OR (p_payload ? 'setupMinutes' AND (COALESCE(p_payload->>'setupMinutes', '') !~ '^[0-9]{1,4}$'
           OR (p_payload->>'setupMinutes')::integer > 1440))
       OR (p_payload ? 'cleanupMinutes' AND (COALESCE(p_payload->>'cleanupMinutes', '') !~ '^[0-9]{1,4}$'
           OR (p_payload->>'cleanupMinutes')::integer > 1440))
       OR (p_payload ? 'damageDepositMinor' AND COALESCE(p_payload->>'damageDepositMinor', '') !~ '^[0-9]{1,12}$')
       OR (p_payload ? 'minSpendMinor' AND COALESCE(p_payload->>'minSpendMinor', '') !~ '^[0-9]{1,12}$')
       OR (p_payload ? 'extraGuestMinor' AND p_payload->'extraGuestMinor' <> 'null'::jsonb
           AND COALESCE(p_payload->>'extraGuestMinor', '') !~ '^[0-9]{1,12}$')
       OR (p_payload ? 'overtimeMinorPerHour' AND p_payload->'overtimeMinorPerHour' <> 'null'::jsonb
           AND COALESCE(p_payload->>'overtimeMinorPerHour', '') !~ '^[0-9]{1,12}$') THEN
      RAISE EXCEPTION 'hire_terms_invalid' USING ERRCODE = '22023';
    END IF;
    v_kind := COALESCE(p_payload->>'depositKind', v_offer.deposit_kind);
    IF v_kind NOT IN ('none', 'percent', 'fixed') THEN
      RAISE EXCEPTION 'deposit_invalid' USING ERRCODE = '22023';
    END IF;
    IF v_kind <> 'none' THEN
      IF COALESCE(p_payload->>'depositValue', v_offer.deposit_value::text, '') !~ '^[0-9]{1,12}$'
         OR COALESCE(p_payload->>'balanceDueDaysBefore', v_offer.balance_due_days_before::text, '') !~ '^[0-9]{1,3}$'
         OR COALESCE(p_payload->>'balanceDueDaysBefore', v_offer.balance_due_days_before::text)::integer > 365 THEN
        RAISE EXCEPTION 'deposit_invalid' USING ERRCODE = '22023';
      END IF;
      v_value := COALESCE(p_payload->>'depositValue', v_offer.deposit_value::text)::bigint;
      v_days := COALESCE(p_payload->>'balanceDueDaysBefore', v_offer.balance_due_days_before::text)::integer;
      IF (v_kind = 'percent' AND v_value NOT BETWEEN 1 AND 9999) OR (v_kind = 'fixed' AND v_value < 1) THEN
        RAISE EXCEPTION 'deposit_invalid' USING ERRCODE = '22023';
      END IF;
    END IF;
    UPDATE public.stay_offerings
    SET hire_charge = COALESCE(p_payload->>'hireCharge', hire_charge),
        deposit_kind = v_kind,
        deposit_value = CASE WHEN v_kind = 'none' THEN NULL ELSE v_value END,
        balance_due_days_before = CASE WHEN v_kind = 'none' THEN NULL ELSE v_days END,
        buffer_before_minutes = COALESCE((p_payload->>'setupMinutes')::integer, buffer_before_minutes),
        buffer_after_minutes = COALESCE((p_payload->>'cleanupMinutes')::integer, buffer_after_minutes),
        damage_deposit_minor = COALESCE((p_payload->>'damageDepositMinor')::bigint, damage_deposit_minor),
        min_spend_minor = COALESCE((p_payload->>'minSpendMinor')::bigint, min_spend_minor),
        extra_guest_minor = CASE WHEN p_payload ? 'extraGuestMinor' THEN NULLIF(p_payload->>'extraGuestMinor', '')::bigint
                                 ELSE extra_guest_minor END,
        overtime_minor_per_hour = CASE WHEN p_payload ? 'overtimeMinorPerHour'
                                       THEN NULLIF(p_payload->>'overtimeMinorPerHour', '')::bigint
                                       ELSE overtime_minor_per_hour END,
        version = version + 1, updated_at = now(), updated_by = v_uid
    WHERE id = v_offer.id RETURNING * INTO v_offer;
    PERFORM public.issue_4490_sync_offer_damage(v_offer.id);

  ELSIF p_action = 'set_booking' THEN
    IF COALESCE(p_payload->>'mode', COALESCE(v_offer.confirmation_mode, 'request')) NOT IN ('request', 'instant')
       OR (p_payload ? 'requestResponseHours' AND (COALESCE(p_payload->>'requestResponseHours', '') !~ '^[0-9]{1,3}$'
           OR (p_payload->>'requestResponseHours')::integer NOT BETWEEN 1 AND 168))
       OR (p_payload ? 'approvedPaymentMinutes' AND (COALESCE(p_payload->>'approvedPaymentMinutes', '') !~ '^[0-9]{1,5}$'
           OR (p_payload->>'approvedPaymentMinutes')::integer NOT BETWEEN 10 AND 10080)) THEN
      RAISE EXCEPTION 'hire_booking_invalid' USING ERRCODE = '22023';
    END IF;
    IF p_payload ? 'requestResponseHours' OR p_payload ? 'approvedPaymentMinutes' THEN
      -- "Applies to every request at <venue>" (reconciliation conflict 43).
      UPDATE public.venue_booking_settings
      SET request_response_hours = COALESCE((p_payload->>'requestResponseHours')::smallint, request_response_hours),
          approved_payment_minutes = COALESCE((p_payload->>'approvedPaymentMinutes')::integer, approved_payment_minutes),
          version = version + 1, updated_at = now(), updated_by = v_uid
      WHERE venue_id = p_venue_id;
    END IF;
    UPDATE public.stay_offerings
    SET confirmation_mode = COALESCE(p_payload->>'mode', confirmation_mode),
        version = version + 1, updated_at = now(), updated_by = v_uid
    WHERE id = v_offer.id RETURNING * INTO v_offer;
  END IF;

  v_result := public.issue_4490_offer_projection(v_offer.id) || jsonb_build_object('windowsCreated', v_windows);
  PERFORM public.issue_4490_receipt_store('manage_hire:' || p_venue_id::text, p_idempotency_key, v_hash, v_result);
  RETURN v_result || jsonb_build_object('replayed', false);
END;
$function$;


-- readiness: hire rows per hour (from 20281203164490_issue_4490_p5_tables_floor_hour.sql)
CREATE OR REPLACE FUNCTION public.issue_4490_offer_readiness(p_offering_id uuid)
RETURNS text[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_offer public.stay_offerings%ROWTYPE;
  v_venue public.venue_listings%ROWTYPE;
  v_reasons text[] := '{}'::text[];
  v_pool public.venue_capacity_pools%ROWTYPE;
  v_max_guests integer;
BEGIN
  SELECT * INTO v_offer FROM public.stay_offerings WHERE id = p_offering_id;
  IF NOT FOUND THEN
    RETURN ARRAY['not_found'];
  END IF;
  SELECT * INTO v_venue FROM public.venue_listings WHERE id = v_offer.venue_id;
  IF NOT (v_offer.kind = ANY(public.issue_4490_built_offer_kinds())) THEN
    v_reasons := v_reasons || 'kind_not_available_yet'::text;
  END IF;
  IF NOT public.issue_4490_venue_feature_on(v_offer.venue_id, public.issue_4490_offer_kind_feature(v_offer.kind)) THEN
    v_reasons := v_reasons || 'feature_off'::text;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.venue_offer_price_options o
    JOIN public.stay_price_versions p
      ON p.price_option_id = o.id AND p.offering_id = o.offering_id AND p.effective_to IS NULL
    WHERE o.offering_id = v_offer.id AND o.status = 'active'
  ) THEN
    v_reasons := v_reasons || 'no_price_option'::text;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.stay_policy_versions p
    WHERE p.offering_id = v_offer.id AND p.effective_to IS NULL
  ) THEN
    v_reasons := v_reasons || 'no_policy'::text;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.stay_place_schedule_rules r
    WHERE r.offering_id = v_offer.id AND r.active
  ) THEN
    v_reasons := v_reasons || 'no_schedule'::text;
  END IF;
  IF v_offer.kind IN ('entry', 'group_package') THEN
    SELECT * INTO v_pool FROM public.venue_capacity_pools WHERE id = v_offer.capacity_pool_id;
    IF NOT FOUND OR v_pool.archived_at IS NOT NULL THEN
      v_reasons := v_reasons || 'no_day_limit'::text;
    ELSE
      SELECT max(o.guest_max) INTO v_max_guests
      FROM public.venue_offer_price_options o
      WHERE o.offering_id = v_offer.id AND o.status = 'active';
      IF v_max_guests IS NOT NULL AND v_max_guests > v_pool.daily_limit THEN
        v_reasons := v_reasons || 'guest_max_over_capacity'::text;
      END IF;
    END IF;
  END IF;
  IF v_offer.kind IN ('private_hire', 'by_the_hour') AND NOT EXISTS (
    SELECT 1 FROM public.venue_offer_spaces s WHERE s.offering_id = v_offer.id
  ) THEN
    v_reasons := v_reasons || 'no_spaces'::text;
  END IF;
  IF v_offer.deposit_kind <> 'none' AND v_offer.kind NOT IN ('group_package', 'private_hire') THEN
    v_reasons := v_reasons || 'deposit_not_available_yet'::text;
  END IF;
  -- #4490 P3: packages are priced per guest or per booking, and start at set times.
  IF v_offer.kind IN ('group_package', 'private_hire') AND EXISTS (
    SELECT 1 FROM public.venue_offer_price_options o
    WHERE o.offering_id = v_offer.id AND o.status = 'active' AND o.unit NOT IN ('guest', 'booking')
      -- #4490 P4 follow-up: a hire place may be priced per hour.
      AND NOT (v_offer.kind = 'private_hire' AND o.unit = 'hour')
  ) THEN
    v_reasons := v_reasons || 'option_unit_invalid'::text;
  END IF;
  IF v_offer.kind IN ('group_package', 'private_hire') AND EXISTS (
    SELECT 1 FROM public.stay_place_schedule_rules r
    WHERE r.offering_id = v_offer.id AND r.active AND r.mode = 'full_day'
  ) THEN
    v_reasons := v_reasons || 'no_start_times'::text;
  END IF;
  -- #4490 P4: every hire price row names a space or combination of this
  -- offer, and its largest group fits there.
  IF v_offer.kind = 'private_hire' THEN
    IF EXISTS (
      SELECT 1 FROM public.venue_offer_price_options o
      WHERE o.offering_id = v_offer.id AND o.status = 'active'
        AND (public.issue_4490_option_spaces(o.id) IS NULL
             OR EXISTS (SELECT 1 FROM unnest(public.issue_4490_option_spaces(o.id)) p
                        WHERE NOT EXISTS (SELECT 1 FROM public.venue_offer_spaces s
                                          WHERE s.offering_id = v_offer.id AND s.space_id = p)))
    ) THEN
      v_reasons := v_reasons || 'hire_price_space_missing'::text;
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.venue_offer_price_options o
      WHERE o.offering_id = v_offer.id AND o.status = 'active'
        AND public.issue_4490_option_spaces(o.id) IS NOT NULL
        AND o.guest_max > public.issue_4490_option_capacity(o.id)
    ) THEN
      v_reasons := v_reasons || 'guest_max_over_capacity'::text;
    END IF;
  END IF;
  -- #4490 P5: by the hour is priced per hour and sits in opening hours.
  IF v_offer.kind = 'by_the_hour' THEN
    IF EXISTS (SELECT 1 FROM public.venue_offer_price_options o
               WHERE o.offering_id = v_offer.id AND o.status = 'active' AND o.unit <> 'hour') THEN
      v_reasons := v_reasons || 'option_unit_invalid'::text;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.stay_place_schedule_rules r
                   WHERE r.offering_id = v_offer.id AND r.active AND r.mode = 'flexible') THEN
      v_reasons := v_reasons || 'no_hours'::text;
    END IF;
  END IF;
  IF v_venue.venue_category = 'stay' THEN
    v_reasons := v_reasons || 'stay_venue'::text;
  END IF;
  RETURN v_reasons;
END;
$function$;


-- hire quote: price rows per hour (from 20281203154490_issue_4490_p4_private_hire.sql)
CREATE OR REPLACE FUNCTION public.issue_4490_quote_hire_internal(
  p_offering_id uuid,
  p_window_id uuid,
  p_lines jsonb,
  p_actor_key text,
  p_user_id uuid,
  p_idempotency_key text,
  p_extras jsonb,
  p_answers jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_offer public.stay_offerings%ROWTYPE;
  v_window public.stay_place_windows%ROWTYPE;
  v_settings public.venue_booking_settings%ROWTYPE;
  v_policy public.stay_policy_versions%ROWTYPE;
  v_existing public.stay_quotes%ROWTYPE;
  v_option public.venue_offer_price_options%ROWTYPE;
  v_price public.stay_price_versions%ROWTYPE;
  v_fee public.stay_fee_versions%ROWTYPE;
  v_item jsonb;
  v_quote_id uuid := gen_random_uuid();
  v_line_id uuid := gen_random_uuid();
  v_request_hash text;
  v_currency text;
  v_guests integer;
  v_overtime integer := 0;
  v_cap integer;
  v_max integer;
  v_unit bigint;
  v_base bigint;
  v_hire bigint;
  v_extra_guests integer := 0;
  v_extra_guest_minor bigint := 0;
  v_overtime_minor bigint := 0;
  v_extras jsonb := '[]'::jsonb;
  v_extras_minor bigint := 0;
  v_answers jsonb;
  v_tax bigint;
  v_total bigint;
  v_last date;
  v_spaces uuid[];
  v_ranges record;
  v_state record;
  v_mode text;
  v_minutes integer;
BEGIN
  IF p_offering_id IS NULL OR p_window_id IS NULL
     OR COALESCE(p_actor_key, '') !~ '^[a-f0-9]{64}$'
     OR char_length(btrim(COALESCE(p_idempotency_key, ''))) NOT BETWEEN 8 AND 200
     OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) <> 1 THEN
    RAISE EXCEPTION 'offer_invalid_payload' USING ERRCODE = '22023';
  END IF;
  v_item := p_lines->0;
  IF jsonb_typeof(v_item) <> 'object'
     OR COALESCE(v_item->>'priceOptionId', '') !~ '^[0-9a-f-]{36}$'
     OR jsonb_typeof(v_item->'guests') <> 'number' OR (v_item->>'guests') !~ '^[0-9]{1,6}$'
     OR (v_item->>'guests')::integer NOT BETWEEN 1 AND 100000
     OR (v_item ? 'overtimeHours' AND (COALESCE(v_item->>'overtimeHours', '') !~ '^[0-9]{1,2}$'
         OR (v_item->>'overtimeHours')::integer > 12)) THEN
    RAISE EXCEPTION 'offer_invalid_payload' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(COALESCE(p_extras, '[]'::jsonb)) <> 'array' OR jsonb_array_length(COALESCE(p_extras, '[]'::jsonb)) > 20
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(p_extras, '[]'::jsonb)) e
                WHERE jsonb_typeof(e) <> 'object' OR COALESCE(e->>'id', '') !~ '^[a-z0-9][a-z0-9-]{0,39}$'
                   OR (e ? 'qty' AND (COALESCE(e->>'qty', '') !~ '^[0-9]{1,3}$' OR (e->>'qty')::integer NOT BETWEEN 1 AND 100)))
     OR (SELECT count(DISTINCT e->>'id') FROM jsonb_array_elements(COALESCE(p_extras, '[]'::jsonb)) e)
        <> jsonb_array_length(COALESCE(p_extras, '[]'::jsonb))
     OR jsonb_typeof(COALESCE(p_answers, '{}'::jsonb)) <> 'object' THEN
    RAISE EXCEPTION 'offer_invalid_payload' USING ERRCODE = '22023';
  END IF;
  IF NOT public.issue_4490_flag_on('VENUE_OFFERS_WRITES') THEN
    RAISE EXCEPTION 'offers_not_enabled' USING ERRCODE = 'P0001';
  END IF;
  v_request_hash := encode(pg_catalog.sha256(convert_to(jsonb_build_object(
    'offering', p_offering_id, 'window', p_window_id, 'lines', p_lines,
    'extras', COALESCE(p_extras, '[]'::jsonb), 'answers', COALESCE(p_answers, '{}'::jsonb))::text, 'UTF8')), 'hex');
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_actor_key || ':offer-quote:' || btrim(p_idempotency_key), 4490));
  SELECT * INTO v_existing FROM public.stay_quotes
  WHERE actor_key_hash = p_actor_key AND idempotency_key = btrim(p_idempotency_key);
  IF FOUND THEN
    IF v_existing.request_hash <> v_request_hash THEN
      RAISE EXCEPTION 'offer_idempotency_conflict' USING ERRCODE = '23505';
    END IF;
    RETURN public.issue_4490_quote_projection(v_existing.id);
  END IF;

  SELECT o.* INTO v_offer
  FROM public.stay_offerings o
  JOIN public.venue_listings v ON v.id = o.venue_id AND v.claim_status = 'verified'
  JOIN public.brands b ON b.id = v.brand_id AND b.deleted_at IS NULL
  WHERE o.id = p_offering_id AND o.kind = 'private_hire';
  IF NOT FOUND OR v_offer.status <> 'live' OR NOT public.issue_4490_venue_feature_on(v_offer.venue_id, 'private_hire') THEN
    RAISE EXCEPTION 'offer_not_found' USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO v_window FROM public.stay_place_windows WHERE id = p_window_id AND offering_id = v_offer.id;
  IF NOT FOUND OR v_window.stop_sell THEN
    RAISE EXCEPTION 'offer_window_unavailable' USING ERRCODE = 'P0002';
  END IF;
  v_settings := public.issue_4490_ensure_booking_settings(v_offer.venue_id);
  IF v_settings.booking_state <> 'active' OR public.issue_4490_day_closed(v_offer.venue_id, v_window.local_date) THEN
    RAISE EXCEPTION 'offer_day_closed' USING ERRCODE = 'PT409';
  END IF;
  v_last := (now() AT TIME ZONE v_settings.timezone)::date
    + LEAST(v_settings.booking_horizon_days, COALESCE(v_offer.max_advance_days, 730));
  IF v_window.local_date > v_last THEN
    RAISE EXCEPTION 'offer_too_far' USING ERRCODE = 'PT409';
  END IF;
  IF now() >= public.issue_4490_window_cutoff(v_offer.id, v_window.id) THEN
    RAISE EXCEPTION 'offer_too_soon' USING ERRCODE = 'PT409';
  END IF;
  SELECT * INTO v_policy FROM public.stay_policy_versions WHERE offering_id = v_offer.id AND effective_to IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'offer_not_found' USING ERRCODE = 'P0002';
  END IF;
  SELECT upper(COALESCE(NULLIF(btrim(b.default_currency), ''), 'NGN')) INTO v_currency
  FROM public.brands b WHERE b.id = v_offer.brand_id;

  SELECT * INTO v_option FROM public.venue_offer_price_options
  WHERE id = (v_item->>'priceOptionId')::uuid AND offering_id = v_offer.id AND status = 'active';
  v_spaces := public.issue_4490_option_spaces(v_option.id);
  IF NOT FOUND OR v_spaces IS NULL THEN
    RAISE EXCEPTION 'offer_option_unavailable' USING ERRCODE = 'P0002';
  END IF;
  IF public.issue_4490_option_window_reason(v_option.id, v_window.id) IS NOT NULL THEN
    RAISE EXCEPTION 'offer_%', public.issue_4490_option_window_reason(v_option.id, v_window.id) USING ERRCODE = 'PT409';
  END IF;
  v_guests := (v_item->>'guests')::integer;
  v_cap := public.issue_4490_option_capacity(v_option.id);
  v_max := CASE WHEN v_offer.extra_guest_minor IS NOT NULL THEN v_cap ELSE v_option.guest_max END;
  IF v_guests < v_option.guest_min OR v_guests > v_max THEN
    RAISE EXCEPTION 'offer_guests_out_of_range' USING ERRCODE = '22023';
  END IF;
  IF v_item ? 'overtimeHours' AND (v_item->>'overtimeHours')::integer > 0 THEN
    IF v_offer.overtime_minor_per_hour IS NULL THEN
      RAISE EXCEPTION 'offer_overtime_unavailable' USING ERRCODE = '22023';
    END IF;
    v_overtime := (v_item->>'overtimeHours')::integer;
  END IF;
  SELECT * INTO v_price FROM public.stay_price_versions
  WHERE price_option_id = v_option.id AND offering_id = v_offer.id AND effective_to IS NULL;
  IF NOT FOUND OR v_price.currency_code <> v_currency THEN
    RAISE EXCEPTION 'offer_option_unavailable' USING ERRCODE = 'P0002';
  END IF;

  -- Answers: every "guests choose one" answered; occasion, a note, site visit.
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_offer.inclusions) i
             WHERE i->>'kind' = 'choice'
               AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements_text(i->'options') o
                               WHERE o = COALESCE(p_answers->>(i->>'label'), '')))
     OR EXISTS (SELECT 1 FROM jsonb_object_keys(COALESCE(p_answers, '{}'::jsonb)) k
                WHERE k NOT IN ('occasion', 'note', 'siteVisit')
                  AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_offer.inclusions) i
                                  WHERE i->>'kind' = 'choice' AND i->>'label' = k))
     OR (p_answers ? 'occasion' AND (jsonb_typeof(p_answers->'occasion') <> 'string'
         OR char_length(btrim(p_answers->>'occasion')) NOT BETWEEN 1 AND 60))
     OR (p_answers ? 'note' AND (jsonb_typeof(p_answers->'note') <> 'string' OR char_length(p_answers->>'note') > 500))
     OR (p_answers ? 'siteVisit' AND jsonb_typeof(p_answers->'siteVisit') <> 'boolean') THEN
    RAISE EXCEPTION 'offer_answer_required' USING ERRCODE = '22023';
  END IF;
  v_answers := jsonb_strip_nulls(COALESCE(p_answers, '{}'::jsonb)
    || jsonb_build_object('note', NULLIF(btrim(COALESCE(p_answers->>'note', '')), ''),
                          'occasion', NULLIF(btrim(COALESCE(p_answers->>'occasion', '')), '')));
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(p_extras, '[]'::jsonb)) e
             WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_offer.extras) x WHERE x->>'id' = e->>'id')) THEN
    RAISE EXCEPTION 'offer_extra_unavailable' USING ERRCODE = 'P0002';
  END IF;

  -- The place must not be booked; an instant hire also needs it free (a
  -- request may wait behind someone else's hold).
  SELECT * INTO v_ranges FROM public.issue_4490_hire_ranges(v_offer.id, v_window.id, v_overtime * 60);
  SELECT * INTO v_state FROM public.issue_4490_spaces_status(v_spaces, v_ranges.claim, NULL);
  v_mode := CASE WHEN COALESCE(v_offer.confirmation_mode, 'request') = 'instant' THEN 'instant' ELSE 'request' END;
  IF v_state.status = 'taken' OR (v_state.status = 'held' AND v_mode = 'instant') THEN
    RAISE EXCEPTION 'offer_space_taken' USING ERRCODE = 'PT409';
  END IF;

  -- Price: the row (per booking, or per guest), guests above the row, extra
  -- hours, extras.
  v_unit := public.issue_4490_option_price_at(v_option.id, v_window.id);
  v_hire := CASE v_option.unit
    WHEN 'guest' THEN v_unit * LEAST(v_guests, v_option.guest_max)
    -- #4490 P4 follow-up: per hour (half up), for the booked length.
    WHEN 'hour' THEN (v_unit * (extract(epoch FROM (v_window.ends_at - v_window.starts_at))::bigint / 60) + 30) / 60
    ELSE v_unit END;
  IF v_guests > v_option.guest_max THEN
    v_extra_guests := v_guests - v_option.guest_max;
    v_extra_guest_minor := v_extra_guests * v_offer.extra_guest_minor;
  END IF;
  v_overtime_minor := v_overtime * COALESCE(v_offer.overtime_minor_per_hour, 0);
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', x->>'id', 'name', x->>'name', 'per', x->>'per',
           'unitPriceMinor', (x->>'price_minor')::bigint,
           'qty', CASE WHEN x->>'per' = 'guest' THEN v_guests ELSE COALESCE((e->>'qty')::integer, 1) END,
           'amountMinor', (x->>'price_minor')::bigint
              * CASE WHEN x->>'per' = 'guest' THEN v_guests ELSE COALESCE((e->>'qty')::integer, 1) END)
           ORDER BY x->>'name'), '[]'::jsonb)
  INTO v_extras
  FROM jsonb_array_elements(COALESCE(p_extras, '[]'::jsonb)) e
  JOIN jsonb_array_elements(v_offer.extras) x ON x->>'id' = e->>'id';
  SELECT COALESCE(sum((x->>'amountMinor')::bigint), 0) INTO v_extras_minor FROM jsonb_array_elements(v_extras) x;
  v_base := v_hire + v_extra_guest_minor + v_overtime_minor + v_extras_minor;
  IF v_base > 9000000000000000 THEN
    RAISE EXCEPTION 'offer_amount_too_large' USING ERRCODE = 'P0001';
  END IF;
  v_minutes := (extract(epoch FROM (upper(v_ranges.booked) - lower(v_ranges.booked)))::integer / 60);

  INSERT INTO public.stay_quotes (
    id, user_id, actor_key_hash, venue_id, brand_id, currency_code, mode, status,
    source_subtotal_minor, fee_total_minor, tax_total_minor, total_minor,
    request_hash, price_revision_set_hash, inventory_revision_set_hash, policy_snapshot_hash,
    idempotency_key, expires_at, offer_kind
  ) VALUES (
    v_quote_id, p_user_id, p_actor_key, v_offer.venue_id, v_offer.brand_id, v_currency,
    v_mode, 'building', 0, 0, 0, 0,
    v_request_hash, repeat('0', 64), repeat('0', 64), repeat('0', 64),
    btrim(p_idempotency_key), now() + interval '15 minutes', 'private_hire'
  );
  INSERT INTO public.stay_quote_lines (
    id, quote_id, offering_id, kind, confirmation_mode, place_window_id, place_guests,
    base_minor, fee_minor, tax_minor, total_minor, price_version_id, policy_version_id,
    offering_version, inventory_snapshot, offering_snapshot, price_snapshot, policy_snapshot,
    price_option_id, booked_minutes
  ) VALUES (
    v_line_id, v_quote_id, v_offer.id, 'private_hire', v_mode, v_window.id, LEAST(v_guests, 1000),
    v_base, 0, 0, v_base, v_price.id, v_policy.id, v_offer.version,
    jsonb_build_object('resources', jsonb_build_array(jsonb_build_object(
      'resourceType', 'place_window', 'windowId', v_window.id, 'version', v_window.version)),
      'localDate', v_window.local_date, 'spaceIds', to_jsonb(v_spaces), 'combinationId', v_option.combination_id,
      'bookedFrom', lower(v_ranges.booked), 'bookedTo', upper(v_ranges.booked),
      'claimFrom', lower(v_ranges.claim), 'claimTo', upper(v_ranges.claim)),
    jsonb_build_object('name', v_offer.name, 'kind', v_offer.kind, 'venueId', v_offer.venue_id,
      'sessionLabel', (SELECT r.session_label FROM public.stay_place_schedule_rules r WHERE r.id = v_window.schedule_rule_id)),
    jsonb_build_object('optionName', v_option.name, 'unit', v_option.unit, 'unitPriceMinor', v_unit,
      'listPriceMinor', v_price.amount_minor, 'currencyCode', v_currency, 'sortOrder', v_option.sort_order,
      'placeName', public.issue_4490_option_place_name(v_option.id), 'spaceIds', to_jsonb(v_spaces),
      'spaceId', v_option.space_id, 'combinationId', v_option.combination_id,
      'guests', v_guests, 'packageMinor', v_hire,
      'extraGuests', v_extra_guests, 'extraGuestMinor', v_extra_guest_minor,
      'overtimeHours', v_overtime, 'overtimeMinor', v_overtime_minor,
      'extras', v_extras, 'extrasMinor', v_extras_minor, 'answers', v_answers,
      'hireCharge', COALESCE(v_offer.hire_charge, 'hire_fee'), 'minSpendMinor', v_offer.min_spend_minor),
    to_jsonb(v_policy) - 'created_by',
    v_option.id, LEAST(GREATEST(v_minutes, 15), 10080)
  );
  FOR v_fee IN
    SELECT * FROM public.stay_fee_versions
    WHERE offering_id = v_offer.id AND effective_to IS NULL
    ORDER BY fee_key, id
  LOOP
    v_tax := CASE
      WHEN v_fee.calculation = 'percentage_of_line_base' AND v_fee.display_mode = 'included'
        THEN round(v_base::numeric * v_fee.basis_points / (10000 + v_fee.basis_points))::bigint
      WHEN v_fee.calculation = 'percentage_of_line_base'
        THEN round(v_base::numeric * v_fee.basis_points / 10000)::bigint
      WHEN v_fee.calculation = 'fixed_per_place_booking' THEN v_fee.amount_minor
      WHEN v_fee.calculation = 'fixed_per_place_guest' THEN v_fee.amount_minor * v_guests
      ELSE 0 END;
    INSERT INTO public.stay_quote_fee_lines (
      quote_id, quote_line_id, fee_version_id, name, fee_kind, amount_minor,
      included_in_base, refund_treatment, snapshot
    ) VALUES (
      v_quote_id, v_line_id, v_fee.id, v_fee.label, v_fee.fee_kind, v_tax,
      v_fee.display_mode = 'included', v_fee.refund_treatment, to_jsonb(v_fee)
    );
  END LOOP;
  UPDATE public.stay_quote_lines line
  SET fee_minor = totals.fee_minor, tax_minor = totals.tax_minor,
      total_minor = line.base_minor + totals.fee_minor + totals.tax_minor
  FROM (
    SELECT quote_line_id,
      COALESCE(sum(amount_minor) FILTER (WHERE fee_kind = 'mandatory_fee' AND NOT included_in_base), 0) AS fee_minor,
      COALESCE(sum(amount_minor) FILTER (WHERE fee_kind = 'tax' AND NOT included_in_base), 0) AS tax_minor
    FROM public.stay_quote_fee_lines WHERE quote_id = v_quote_id GROUP BY quote_line_id
  ) totals
  WHERE line.id = totals.quote_line_id;
  SELECT total_minor INTO v_total FROM public.stay_quote_lines WHERE id = v_line_id;
  IF v_total > 9000000000000000 THEN
    RAISE EXCEPTION 'offer_amount_too_large' USING ERRCODE = 'P0001';
  END IF;
  UPDATE public.stay_quotes q
  SET status = 'active',
      source_subtotal_minor = l.base_minor, fee_total_minor = l.fee_minor,
      tax_total_minor = l.tax_minor, total_minor = l.total_minor,
      price_revision_set_hash = encode(pg_catalog.sha256(convert_to(
        l.price_version_id::text || ':' || l.price_snapshot::text, 'UTF8')), 'hex'),
      inventory_revision_set_hash = encode(pg_catalog.sha256(convert_to(
        l.offering_id::text || ':' || l.offering_version::text || ':' || l.inventory_snapshot::text, 'UTF8')), 'hex'),
      policy_snapshot_hash = encode(pg_catalog.sha256(convert_to(
        l.policy_version_id::text || ':' || l.policy_snapshot::text, 'UTF8')), 'hex')
  FROM public.stay_quote_lines l
  WHERE q.id = v_quote_id AND l.id = v_line_id;
  RETURN public.issue_4490_quote_projection(v_quote_id) || jsonb_build_object(
    'hire', jsonb_build_object(
      'placeName', public.issue_4490_option_place_name(v_option.id),
      'spaceIds', to_jsonb(v_spaces),
      'guests', v_guests,
      'placeStatus', v_state.status,
      'bookedFrom', lower(v_ranges.booked), 'bookedTo', upper(v_ranges.booked),
      'hireMinor', v_hire, 'extraGuests', v_extra_guests, 'extraGuestMinor', v_extra_guest_minor,
      'overtimeHours', v_overtime, 'overtimeMinor', v_overtime_minor,
      'damageDepositMinor', COALESCE((SELECT sum(f.amount_minor) FROM public.stay_quote_fee_lines f
                                      WHERE f.quote_id = v_quote_id AND f.snapshot->>'fee_key' = 'damage_deposit'), 0),
      'requestResponseHours', v_settings.request_response_hours,
      'payPlan', public.issue_4490_deposit_plan(v_offer.id, v_window.id,
        v_total - COALESCE((SELECT sum(f.amount_minor)::bigint FROM public.stay_quote_fee_lines f
                            WHERE f.quote_id = v_quote_id AND f.snapshot->>'fee_key' = 'damage_deposit'), 0))));
END;
$function$;


-- hire projection: Hours you set (from 20281203154490_issue_4490_p4_private_hire.sql)
CREATE OR REPLACE FUNCTION public.issue_4490_hire_projection(p_offering_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT CASE WHEN o.kind <> 'private_hire' THEN NULL ELSE jsonb_build_object(
    'charge', COALESCE(o.hire_charge, 'hire_fee'),
    'bookingMode', COALESCE(o.confirmation_mode, 'request'),
    'spaces', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', s.id, 'name', s.name, 'setting', s.setting,
        'capacityStanding', s.capacity_standing, 'capacitySeated', s.capacity_seated,
        'capacity', public.issue_4490_space_capacity(s.id)) ORDER BY s.sort_order, s.name)
      FROM public.venue_offer_spaces os JOIN public.venue_spaces s ON s.id = os.space_id
      WHERE os.offering_id = o.id), '[]'::jsonb),
    'combinations', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', c.id, 'name', c.name, 'spaceIds', to_jsonb(c.space_ids),
        'capacity', (SELECT COALESCE(sum(public.issue_4490_space_capacity(p)), 0) FROM unnest(c.space_ids) p))
        ORDER BY c.name)
      FROM public.venue_space_combinations c
      WHERE c.id = ANY(o.hire_combination_ids) AND c.archived_at IS NULL), '[]'::jsonb),
    'rows', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'optionId', opt.id, 'name', opt.name, 'unit', opt.unit,
        'spaceId', opt.space_id, 'combinationId', opt.combination_id,
        'placeName', public.issue_4490_option_place_name(opt.id),
        'capacity', public.issue_4490_option_capacity(opt.id),
        'guestMin', opt.guest_min, 'guestMax', opt.guest_max,
        'weekdays', to_jsonb(opt.weekdays), 'priceMinor', price.amount_minor) ORDER BY opt.sort_order, opt.created_at)
      FROM public.venue_offer_price_options opt
      LEFT JOIN public.stay_price_versions price
        ON price.price_option_id = opt.id AND price.offering_id = opt.offering_id AND price.effective_to IS NULL
      WHERE opt.offering_id = o.id AND opt.status = 'active'), '[]'::jsonb),
    'sessions', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'ruleId', r.id, 'label', r.session_label,
        'startTime', to_char(r.local_start_time, 'HH24:MI'), 'endTime', to_char(r.local_end_time, 'HH24:MI'),
        'pastMidnight', r.local_end_time <= r.local_start_time,
        'minutes', r.slot_duration_minutes, 'weekdays', to_jsonb(r.weekdays),
        'startDate', r.local_start_date, 'endDate', r.local_end_date) ORDER BY r.local_start_time, r.session_label)
      FROM public.stay_place_schedule_rules r
      WHERE r.offering_id = o.id AND r.active AND r.mode = 'repeating_windows'), '[]'::jsonb),
    -- #4490 P4 follow-up: "Hours you set" (null when off).
    'hoursYouSet', (SELECT jsonb_build_object('ruleId', r.id, 'weekdays', to_jsonb(r.weekdays),
                      'startTime', to_char(r.local_start_time, 'HH24:MI'), 'endTime', to_char(r.local_end_time, 'HH24:MI'),
                      'pastMidnight', r.local_end_time <= r.local_start_time,
                      'minMinutes', o.booking_length_min_minutes, 'maxMinutes', o.booking_length_max_minutes,
                      'stepMinutes', COALESCE(o.booking_length_step_minutes, 60))
                    FROM public.stay_place_schedule_rules r
                    WHERE r.offering_id = o.id AND r.active AND r.mode = 'flexible'
                    ORDER BY r.created_at DESC LIMIT 1),
    'damageDepositReleaseDays', COALESCE(s.damage_deposit_release_days, 7),
    'setupMinutes', o.buffer_before_minutes,
    'cleanupMinutes', o.buffer_after_minutes,
    'damageDepositMinor', o.damage_deposit_minor,
    'minSpendMinor', o.min_spend_minor,
    'extraGuestMinor', o.extra_guest_minor,
    'overtimeMinorPerHour', o.overtime_minor_per_hour,
    'requestResponseHours', COALESCE(s.request_response_hours, 48),
    'approvedPaymentMinutes', COALESCE(s.approved_payment_minutes, 4320)
  ) END
  FROM public.stay_offerings o
  LEFT JOIN public.venue_booking_settings s ON s.venue_id = o.venue_id
  WHERE o.id = p_offering_id;
$function$;


-- staff change: a hire may change day and party (from 20281203154490_issue_4490_p4_private_hire.sql)
CREATE OR REPLACE FUNCTION public.issue_4490_change_booking(
  p_group_id uuid,
  p_action text,
  p_payload jsonb,
  p_preview boolean,
  p_expected_version bigint DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_venue uuid;
  v_kind text;
BEGIN
  SELECT g.venue_id, g.offer_kind INTO v_venue, v_kind FROM public.stay_reservation_groups g
  WHERE g.id = p_group_id AND g.offer_kind IS NOT NULL;
  IF auth.uid() IS NULL OR v_venue IS NULL
     OR NOT public.issue_4490_can_manage_venue(v_venue, 'venue.manage_bookings') THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  RETURN public.issue_4490_change_booking_internal(p_group_id, p_action, p_payload, COALESCE(p_preview, true),
    'staff', auth.uid(), NULL, p_expected_version, p_idempotency_key);
END;
$function$;


-- guest change: a hire may change day and party (by its rules) (from 20281203154490_issue_4490_p4_private_hire.sql)
CREATE OR REPLACE FUNCTION public.issue_4490_guest_change_booking(
  p_group_id uuid,
  p_token_hash bytea,
  p_user_id uuid,
  p_action text,
  p_payload jsonb,
  p_preview boolean,
  p_expected_version bigint,
  p_idempotency_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_group public.stay_reservation_groups%ROWTYPE;
BEGIN
  IF NOT public.issue_1389_service_role() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_group FROM public.stay_reservation_groups WHERE id = p_group_id;
  IF NOT FOUND OR NOT public.issue_4490_booking_actor_ok(v_group, p_token_hash, p_user_id) THEN
    RAISE EXCEPTION 'offer_booking_not_found' USING ERRCODE = 'P0002';
  END IF;
  RETURN public.issue_4490_change_booking_internal(p_group_id, p_action, p_payload, COALESCE(p_preview, true),
    'guest', p_user_id, p_token_hash, p_expected_version, p_idempotency_key);
END;
$function$;


-- amendment rail: hire changes allowed (from 20281203154490_issue_4490_p4_private_hire.sql)
CREATE OR REPLACE FUNCTION public.issue_4490_guard_booking_money_insert()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.stay_reservation_groups g WHERE g.id = NEW.group_id AND g.offer_kind IS NOT NULL
  ) OR current_setting('mingla.issue_4490_booking_change', true) IS DISTINCT FROM NEW.group_id::text THEN
    RAISE EXCEPTION 'offer_rail_required' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;


-- change rules: hire follows its date-change rule (from 20281203154490_issue_4490_p4_private_hire.sql)
CREATE OR REPLACE FUNCTION public.issue_4490_change_rules(p_group_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  WITH g AS (
    SELECT g.*, g.payment_plan_snapshot->'dateChangeRule' AS rule,
      (SELECT w.starts_at FROM public.stay_place_windows w WHERE w.id = public.issue_4490_group_window_id(g.id)) AS starts_at,
      COALESCE((SELECT p.admitted_count FROM public.venue_passes p WHERE p.group_id = g.id), 0) AS admitted,
      (SELECT count(*) FROM public.venue_booking_amendments a WHERE a.group_id = g.id AND a.kind = 'move_date') AS moves
    FROM public.stay_reservation_groups g WHERE g.id = p_group_id AND g.offer_kind IS NOT NULL
  ), r AS (
    SELECT g.*,
      CASE WHEN g.rule ? 'allowed_until_minutes_before'
           THEN g.starts_at - make_interval(mins => (g.rule->>'allowed_until_minutes_before')::integer) END AS move_until,
      CASE WHEN g.rule ? 'guest_change_until_minutes_before'
           THEN g.starts_at - make_interval(mins => (g.rule->>'guest_change_until_minutes_before')::integer)
           WHEN g.rule ? 'allowed_until_minutes_before'
           THEN g.starts_at - make_interval(mins => (g.rule->>'allowed_until_minutes_before')::integer) END AS guests_until
    FROM g
  )
  SELECT jsonb_build_object(
    'moveUntil', r.move_until,
    'guestChangeUntil', r.guests_until,
    'maxChanges', (r.rule->>'max_changes')::integer,
    'changesUsed', r.moves,
    'feeBps', COALESCE((r.rule->>'fee_bps')::integer, 0),
    'canMove', r.state = 'confirmed' AND r.admitted = 0 AND r.move_until IS NOT NULL AND now() < r.move_until
               AND (r.rule->>'max_changes' IS NULL OR r.moves < (r.rule->>'max_changes')::integer),
    'canChangeGuests', r.state = 'confirmed' AND r.guests_until IS NOT NULL AND now() < r.guests_until,
    'canAddExtras', r.state = 'confirmed' AND r.guests_until IS NOT NULL AND now() < r.guests_until
                    AND EXISTS (SELECT 1 FROM public.stay_reservation_lines l JOIN public.stay_offerings o ON o.id = l.offering_id
                                WHERE l.group_id = r.id AND jsonb_array_length(o.extras) > 0))
  FROM r;
$function$;


-- booking change: hire party and day (claims move) (from 20281203144490_issue_4490_p3_packages_deposits.sql)
CREATE OR REPLACE FUNCTION public.issue_4490_change_booking_internal(
  p_group_id uuid,
  p_action text,
  p_payload jsonb,
  p_preview boolean,
  p_actor_type text,
  p_actor_user uuid,
  p_token_hash bytea,
  p_expected_version bigint,
  p_idempotency_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_group public.stay_reservation_groups%ROWTYPE;
  v_line public.stay_reservation_lines%ROWTYPE;
  v_offer public.stay_offerings%ROWTYPE;
  v_option public.venue_offer_price_options%ROWTYPE;
  v_cur_window public.stay_place_windows%ROWTYPE;
  v_new_window public.stay_place_windows%ROWTYPE;
  v_settings public.venue_booking_settings%ROWTYPE;
  v_existing public.venue_booking_amendments%ROWTYPE;
  v_money record;
  v_usage record;
  v_rules jsonb;
  v_request_hash text;
  v_line_count integer;
  v_cur_guests integer;
  v_new_guests integer;
  v_party integer;
  v_admitted integer;
  v_needed integer := 0;
  v_left integer;
  v_delta_base bigint := 0;
  v_tax_delta bigint := 0;
  v_policy_fee bigint := 0;
  v_delta_total bigint;
  v_vat_bps integer;
  v_vat_included boolean;
  v_refund_bps integer;
  v_new_total bigint;
  v_refundable bigint;
  v_refund bigint := 0;
  v_extras jsonb := '[]'::jsonb;
  v_summary jsonb;
  v_amend_id uuid;
  v_key text := btrim(COALESCE(p_idempotency_key, ''));
  v_l record;
  v_reason text;
  v_claim_r record;
  v_claim_spaces uuid[];
  v_claim_state record;
BEGIN
  IF p_group_id IS NULL OR p_action NOT IN ('change_guests', 'move_date', 'add_extras')
     OR p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object'
     OR p_actor_type NOT IN ('guest', 'staff')
     OR (NOT p_preview AND (char_length(v_key) NOT BETWEEN 8 AND 200 OR p_expected_version IS NULL)) THEN
    RAISE EXCEPTION 'offer_invalid_payload' USING ERRCODE = '22023';
  END IF;
  IF NOT public.issue_4490_flag_on('VENUE_OFFERS_WRITES') THEN
    RAISE EXCEPTION 'offers_not_enabled' USING ERRCODE = 'P0001';
  END IF;
  IF p_preview THEN
    SELECT * INTO v_group FROM public.stay_reservation_groups WHERE id = p_group_id;
  ELSE
    SELECT * INTO v_group FROM public.stay_reservation_groups WHERE id = p_group_id FOR UPDATE;
  END IF;
  IF NOT FOUND OR v_group.offer_kind IS NULL THEN
    RAISE EXCEPTION 'offer_booking_not_found' USING ERRCODE = 'P0002';
  END IF;
  v_request_hash := encode(pg_catalog.sha256(convert_to(jsonb_build_object(
    'action', p_action, 'payload', p_payload, 'actor', p_actor_type, 'expected', p_expected_version)::text, 'UTF8')), 'hex');
  IF NOT p_preview THEN
    SELECT * INTO v_existing FROM public.venue_booking_amendments
    WHERE group_id = p_group_id AND idempotency_key = v_key;
    IF FOUND THEN
      IF v_existing.request_hash <> v_request_hash THEN
        RAISE EXCEPTION 'offer_idempotency_conflict' USING ERRCODE = '23505';
      END IF;
      RETURN v_existing.summary || jsonb_build_object('changeId', v_existing.id, 'replayed', true,
        'groupVersion', v_group.version);
    END IF;
    IF v_group.version <> p_expected_version THEN
      RAISE EXCEPTION 'stale_write' USING ERRCODE = 'PT409';
    END IF;
  END IF;
  IF v_group.state <> 'confirmed' THEN
    RAISE EXCEPTION 'offer_invalid_transition' USING ERRCODE = 'PT409';
  END IF;

  SELECT count(*) INTO v_line_count FROM public.stay_reservation_lines WHERE group_id = v_group.id AND state = 'confirmed';
  SELECT * INTO v_line FROM public.stay_reservation_lines
  WHERE group_id = v_group.id AND state = 'confirmed'
    AND (NULLIF(p_payload->>'lineId', '') IS NULL OR id = NULLIF(p_payload->>'lineId', '')::uuid)
  ORDER BY created_at, id LIMIT 1;
  IF NOT FOUND OR (p_action = 'change_guests' AND v_line_count > 1 AND NULLIF(p_payload->>'lineId', '') IS NULL) THEN
    RAISE EXCEPTION 'offer_invalid_payload' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_offer FROM public.stay_offerings WHERE id = v_line.offering_id;
  SELECT * INTO v_cur_window FROM public.stay_place_windows WHERE id = public.issue_4490_line_window_id(v_line.id);
  v_settings := public.issue_4490_ensure_booking_settings(v_group.venue_id);
  v_rules := public.issue_4490_change_rules(v_group.id);
  v_admitted := COALESCE((SELECT p.admitted_count FROM public.venue_passes p WHERE p.group_id = v_group.id), 0);
  v_cur_guests := public.issue_4490_line_guests(v_line.id);
  SELECT COALESCE(sum(public.issue_4490_line_guests(l.id)), 0) INTO v_party
  FROM public.stay_reservation_lines l WHERE l.group_id = v_group.id AND l.state = 'confirmed';

  -- Who may change what, and until when.
  IF p_actor_type = 'guest' THEN
    IF p_action = 'move_date' AND NOT COALESCE((v_rules->>'canMove')::boolean, false) THEN
      RAISE EXCEPTION '%', CASE
        WHEN v_rules->>'moveUntil' IS NULL OR v_admitted > 0
             OR ((v_rules->>'maxChanges') IS NOT NULL AND (v_rules->>'changesUsed')::integer >= (v_rules->>'maxChanges')::integer)
        THEN 'offer_change_not_allowed' ELSE 'offer_change_too_late' END USING ERRCODE = 'P0001';
    END IF;
    IF p_action IN ('change_guests', 'add_extras') AND NOT COALESCE((v_rules->>'canChangeGuests')::boolean, false) THEN
      RAISE EXCEPTION '%', CASE WHEN v_rules->>'guestChangeUntil' IS NULL THEN 'offer_change_not_allowed'
                                ELSE 'offer_change_too_late' END USING ERRCODE = 'P0001';
    END IF;
  ELSIF now() >= v_cur_window.ends_at THEN
    RAISE EXCEPTION 'offer_change_too_late' USING ERRCODE = 'P0001';
  END IF;

  -- VAT on the line (added = on top; included = inside the price).
  SELECT (fee.snapshot->>'basis_points')::integer, fee.included_in_base INTO v_vat_bps, v_vat_included
  FROM public.stay_quote_fee_lines fee
  WHERE fee.quote_line_id = v_line.quote_line_id AND fee.fee_kind = 'tax'
  ORDER BY fee.id LIMIT 1;

  IF p_action = 'change_guests' THEN
    IF COALESCE(p_payload->>'guests', '') !~ '^[0-9]{1,4}$' THEN
      RAISE EXCEPTION 'offer_invalid_payload' USING ERRCODE = '22023';
    END IF;
    v_new_guests := (p_payload->>'guests')::integer;
    SELECT * INTO v_option FROM public.venue_offer_price_options WHERE id = v_line.price_option_id;
    IF v_new_guests = v_cur_guests THEN
      RAISE EXCEPTION 'offer_change_nothing' USING ERRCODE = '22023';
    END IF;
    -- #4490 P4 follow-up: a hire may grow up to its place's capacity when the
    -- venue sells extra guests.
    IF v_new_guests < GREATEST(COALESCE(v_option.guest_min, 1), 1)
       OR v_new_guests > public.issue_4490_change_guest_max(v_offer.id, v_option.id) THEN
      RAISE EXCEPTION 'offer_guests_out_of_range' USING ERRCODE = '22023';
    END IF;
    IF v_party - v_cur_guests + v_new_guests < v_admitted THEN
      RAISE EXCEPTION 'offer_already_checked_in' USING ERRCODE = 'PT409';
    END IF;
    v_delta_base := (v_new_guests - v_cur_guests) * (
      CASE WHEN v_line.price_snapshot->>'unit' = 'guest' THEN COALESCE((v_line.price_snapshot->>'unitPriceMinor')::bigint, 0) ELSE 0 END
      + COALESCE((SELECT sum((x->>'unitPriceMinor')::bigint) FROM jsonb_array_elements(COALESCE(v_line.price_snapshot->'extras', '[]'::jsonb)) x
                  WHERE x->>'per' = 'guest'), 0));
    v_needed := GREATEST(v_new_guests - v_cur_guests, 0);
    -- #4490 P4 follow-up: a hire charges the row's per-guest price up to the
    -- row's largest group and the extra-guest price above it.
    IF v_offer.kind = 'private_hire' THEN
      v_cur_guests := COALESCE((SELECT a.to_guests FROM public.venue_booking_amendments a
                                WHERE a.group_id = v_group.id AND a.kind = 'change_guests'
                                ORDER BY a.created_at DESC LIMIT 1),
                               (v_line.price_snapshot->>'guests')::integer, v_cur_guests);
      IF v_new_guests = v_cur_guests THEN
        RAISE EXCEPTION 'offer_change_nothing' USING ERRCODE = '22023';
      END IF;
      v_delta_base :=
        (LEAST(v_new_guests, v_option.guest_max) - LEAST(v_cur_guests, v_option.guest_max))
          * CASE WHEN v_line.price_snapshot->>'unit' = 'guest'
                 THEN COALESCE((v_line.price_snapshot->>'unitPriceMinor')::bigint, 0) ELSE 0 END
        + (GREATEST(v_new_guests - v_option.guest_max, 0) - GREATEST(v_cur_guests - v_option.guest_max, 0))
          * COALESCE(v_offer.extra_guest_minor, 0)
        + (v_new_guests - v_cur_guests)
          * COALESCE((SELECT sum((x->>'unitPriceMinor')::bigint)
                      FROM jsonb_array_elements(COALESCE(v_line.price_snapshot->'extras', '[]'::jsonb)) x
                      WHERE x->>'per' = 'guest'), 0);
    END IF;
    v_new_window := v_cur_window;
  ELSIF p_action = 'move_date' THEN
    SELECT * INTO v_new_window FROM public.stay_place_windows
    WHERE id = NULLIF(p_payload->>'windowId', '')::uuid AND offering_id = v_offer.id;
    IF NOT FOUND OR v_new_window.stop_sell OR v_new_window.id = v_cur_window.id THEN
      RAISE EXCEPTION 'offer_window_unavailable' USING ERRCODE = 'PT409';
    END IF;
    IF now() >= public.issue_4490_window_cutoff(v_offer.id, v_new_window.id) THEN
      RAISE EXCEPTION 'offer_too_soon' USING ERRCODE = 'PT409';
    END IF;
    IF v_new_window.local_date > (now() AT TIME ZONE v_settings.timezone)::date
         + LEAST(v_settings.booking_horizon_days, COALESCE(v_offer.max_advance_days, 730)) THEN
      RAISE EXCEPTION 'offer_too_far' USING ERRCODE = 'PT409';
    END IF;
    FOR v_l IN
      SELECT l.* FROM public.stay_reservation_lines l WHERE l.group_id = v_group.id AND l.state = 'confirmed'
    LOOP
      v_reason := public.issue_4490_option_window_reason(v_l.price_option_id, v_new_window.id);
      IF v_reason IN ('wrong_weekday', 'wrong_time') THEN
        RAISE EXCEPTION 'offer_%', v_reason USING ERRCODE = 'PT409';
      END IF;
      -- The booked price stands unless the new day is priced differently
      -- (weekday or busy-time price), then the difference applies.
      v_delta_base := v_delta_base
        + (COALESCE(public.issue_4490_option_price_at(v_l.price_option_id, v_new_window.id), 0)
           - COALESCE(public.issue_4490_option_price_at(v_l.price_option_id, v_cur_window.id), 0))
          * CASE WHEN v_l.price_snapshot->>'unit' = 'guest' THEN public.issue_4490_line_guests(v_l.id) ELSE 1 END;
    END LOOP;
    v_needed := v_party;
    -- #4490 P4 follow-up: a hire or a by-the-hour booking moves its space
    -- claims: the same place must be free on the new day (setup and cleanup
    -- included, its own claims ignored).
    IF v_offer.kind IN ('private_hire', 'by_the_hour') THEN
      v_claim_spaces := CASE WHEN v_offer.kind = 'private_hire'
        THEN public.issue_4490_option_spaces(v_line.price_option_id)
        ELSE (SELECT array_agg(DISTINCT c.space_id) FROM public.venue_space_claims c
              WHERE c.group_id = v_group.id AND c.state IN ('held', 'committed')) END;
      SELECT * INTO v_claim_r FROM public.issue_4490_hire_ranges(v_offer.id, v_new_window.id,
        COALESCE((v_line.price_snapshot->>'overtimeHours')::integer, 0) * 60);
      SELECT * INTO v_claim_state FROM public.issue_4490_spaces_status(v_claim_spaces, v_claim_r.claim, v_group.id);
      IF v_claim_spaces IS NULL OR v_claim_state.status <> 'free' THEN
        RAISE EXCEPTION 'offer_space_taken' USING ERRCODE = 'PT409';
      END IF;
    END IF;
  ELSE -- add_extras
    IF jsonb_typeof(p_payload->'extras') <> 'array' OR jsonb_array_length(p_payload->'extras') NOT BETWEEN 1 AND 20
       OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_payload->'extras') e
                  WHERE jsonb_typeof(e) <> 'object'
                     OR (e ? 'qty' AND (COALESCE(e->>'qty', '') !~ '^[0-9]{1,3}$' OR (e->>'qty')::integer NOT BETWEEN 1 AND 100)))
       OR (SELECT count(DISTINCT e->>'id') FROM jsonb_array_elements(p_payload->'extras') e) <> jsonb_array_length(p_payload->'extras') THEN
      RAISE EXCEPTION 'offer_invalid_payload' USING ERRCODE = '22023';
    END IF;
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_payload->'extras') e
               WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_offer.extras) x WHERE x->>'id' = e->>'id')) THEN
      RAISE EXCEPTION 'offer_extra_unavailable' USING ERRCODE = 'P0002';
    END IF;
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'id', x->>'id', 'name', x->>'name', 'per', x->>'per',
             'unitPriceMinor', (x->>'price_minor')::bigint,
             'qty', CASE WHEN x->>'per' = 'guest' THEN v_party ELSE COALESCE((e->>'qty')::integer, 1) END,
             'amountMinor', (x->>'price_minor')::bigint
               * CASE WHEN x->>'per' = 'guest' THEN v_party ELSE COALESCE((e->>'qty')::integer, 1) END)
             ORDER BY x->>'name'), '[]'::jsonb)
    INTO v_extras
    FROM jsonb_array_elements(p_payload->'extras') e
    JOIN jsonb_array_elements(v_offer.extras) x ON x->>'id' = e->>'id';
    SELECT COALESCE(sum((x->>'amountMinor')::bigint), 0) INTO v_delta_base FROM jsonb_array_elements(v_extras) x;
    v_new_window := v_cur_window;
  END IF;

  v_tax_delta := CASE WHEN v_vat_bps IS NOT NULL AND NOT COALESCE(v_vat_included, false)
                      THEN round(v_delta_base::numeric * v_vat_bps / 10000)::bigint ELSE 0 END;
  v_delta_total := v_delta_base + v_tax_delta;
  SELECT * INTO v_money FROM public.issue_4490_booking_money(v_group.id);
  IF v_delta_total < 0 THEN
    -- Less to pay: the guest keeps the ladder's share; the venue keeps the rest.
    v_refund_bps := public.issue_4490_line_refund_bps(v_line.id, p_actor_type);
    v_policy_fee := ((-v_delta_total) * (10000 - COALESCE(v_refund_bps, 0)) + 5000) / 10000;
  ELSIF p_action = 'move_date' AND p_actor_type = 'guest' THEN
    v_policy_fee := (v_money.total_due * COALESCE((v_rules->>'feeBps')::integer, 0) + 5000) / 10000;
  END IF;
  v_new_total := v_money.total_due + v_delta_total + v_policy_fee;
  SELECT COALESCE(sum(GREATEST(0, a.charged_minor - a.refunded_minor - COALESCE((
      SELECT sum(ra.amount_minor) FROM public.stay_refund_allocations ra
      JOIN public.stay_refunds rr ON rr.id = ra.refund_id
      WHERE ra.payment_allocation_id = a.id AND rr.state IN ('submitted', 'processing', 'manual_reconciliation')), 0))), 0)
  INTO v_refundable
  FROM public.stay_payment_allocations a
  JOIN public.stay_payment_attempts p ON p.id = a.payment_attempt_id
  WHERE p.group_id = v_group.id AND p.state = 'succeeded';
  v_refund := LEAST(GREATEST(v_money.net_paid - v_new_total, 0), v_refundable);

  -- Room on the day (under the pool lock when applying). Offers with no day
  -- limit (hire, by the hour) have no pool to check.
  IF v_needed > 0 AND v_offer.capacity_pool_id IS NOT NULL THEN
    IF NOT p_preview AND v_offer.capacity_pool_id IS NOT NULL THEN
      PERFORM 1 FROM public.venue_capacity_pools WHERE id = v_offer.capacity_pool_id FOR UPDATE;
      PERFORM 1 FROM public.venue_capacity_overrides
      WHERE pool_id = v_offer.capacity_pool_id AND local_date = v_new_window.local_date FOR UPDATE;
    END IF;
    SELECT * INTO v_usage FROM public.issue_4490_pool_day_usage(v_offer.capacity_pool_id, v_new_window.local_date);
    IF COALESCE(v_usage.closed, true) THEN
      RAISE EXCEPTION 'offer_day_closed' USING ERRCODE = 'PT409';
    END IF;
    v_left := CASE WHEN p_actor_type = 'staff' THEN v_usage.gate_left ELSE v_usage.online_left END;
    IF v_offer.entry_style = 'timed_session' THEN
      v_left := LEAST(v_left, GREATEST(v_new_window.sellable_capacity - public.issue_4490_window_used(v_new_window.id), 0));
    END IF;
    IF v_needed > v_left THEN
      RAISE EXCEPTION 'offer_sold_out' USING ERRCODE = 'PT409',
        DETAIL = jsonb_build_object('remaining', v_left)::text;
    END IF;
  END IF;

  v_summary := jsonb_strip_nulls(jsonb_build_object(
    'action', p_action,
    'lineId', v_line.id,
    'fromGuests', CASE WHEN p_action = 'change_guests' THEN v_cur_guests END,
    'toGuests', CASE WHEN p_action = 'change_guests' THEN v_new_guests END,
    'fromDate', CASE WHEN p_action = 'move_date' THEN v_cur_window.local_date END,
    'toDate', CASE WHEN p_action = 'move_date' THEN v_new_window.local_date END,
    'toStartsAt', CASE WHEN p_action = 'move_date' THEN v_new_window.starts_at END,
    'extras', CASE WHEN p_action = 'add_extras' THEN v_extras END)) || jsonb_build_object(
    'priceDeltaMinor', v_delta_base,
    'taxDeltaMinor', v_tax_delta,
    'feeMinor', v_policy_fee,
    'amountMinor', v_delta_total + v_policy_fee,
    'totalDueBeforeMinor', v_money.total_due,
    'totalDueAfterMinor', v_new_total,
    'paidMinor', v_money.net_paid,
    'refundMinor', v_refund,
    'balanceAfterMinor', GREATEST(v_new_total - (v_money.net_paid - v_refund), 0),
    'currencyCode', v_group.currency_code,
    'by', p_actor_type);
  IF p_preview THEN
    RETURN v_summary || jsonb_build_object('preview', true, 'groupVersion', v_group.version);
  END IF;

  -- Apply.
  PERFORM set_config('mingla.issue_4490_booking_change', v_group.id::text, true);
  IF p_action = 'change_guests' THEN
    UPDATE public.stay_inventory_commitments SET quantity = v_new_guests
    WHERE reservation_line_id = v_line.id AND state = 'active';
  ELSIF p_action = 'move_date' THEN
    UPDATE public.stay_inventory_commitments SET place_window_id = v_new_window.id
    WHERE group_id = v_group.id AND state = 'active' AND resource_type = 'place_window';
    UPDATE public.venue_passes p
    SET valid_local_date = v.valid_local_date, valid_from = v.valid_from, valid_to = v.valid_to,
        version = p.version + 1, updated_at = now()
    FROM public.issue_4490_pass_validity(v_offer.id, v_new_window.id) v
    WHERE p.group_id = v_group.id;
    -- #4490 P4 follow-up: the space claims move with the booking (release the
    -- old, claim the new in one transaction; the exclusion constraint decides).
    IF v_offer.kind IN ('private_hire', 'by_the_hour') THEN
      UPDATE public.venue_space_claims
      SET state = 'released', held_until = NULL, released_at = now(), release_reason = 'moved', updated_at = now()
      WHERE group_id = v_group.id AND state IN ('held', 'committed');
      PERFORM public.issue_4490_claim_spaces(v_group.id, v_line.id,
        (SELECT h.id FROM public.stay_inventory_holds h WHERE h.group_id = v_group.id ORDER BY h.created_at DESC LIMIT 1),
        v_claim_spaces, (v_line.price_snapshot->>'combinationId')::uuid, v_claim_r.booked, v_claim_r.claim, NULL);
      IF v_offer.kind = 'private_hire' THEN
        PERFORM public.issue_4490_assert_hire_capacity(v_group.venue_id, v_claim_spaces, v_claim_r.booked);
      END IF;
    END IF;
  END IF;
  IF p_action = 'change_guests' THEN
    UPDATE public.venue_passes p
    SET admits = totals.admits,
        id_check_count = LEAST(totals.id_count, totals.admits),
        version = p.version + 1, updated_at = now()
    FROM (
      SELECT sum(public.issue_4490_line_guests(l.id))::integer AS admits,
             COALESCE(sum(public.issue_4490_line_guests(l.id)) FILTER (WHERE l.price_snapshot->>'idCheckLabel' IS NOT NULL), 0)::integer AS id_count
      FROM public.stay_reservation_lines l WHERE l.group_id = v_group.id AND l.state = 'confirmed'
    ) totals
    WHERE p.group_id = v_group.id;
  END IF;
  INSERT INTO public.venue_booking_amendments (
    group_id, reservation_line_id, kind, from_guests, to_guests, from_window_id, to_window_id, extras,
    price_delta_minor, tax_delta_minor, policy_fee_minor, refund_minor, actor_type, actor_user_id,
    idempotency_key, request_hash, summary
  ) VALUES (
    v_group.id, CASE WHEN p_action = 'change_guests' THEN v_line.id END,
    p_action,
    CASE WHEN p_action = 'change_guests' THEN v_cur_guests END,
    CASE WHEN p_action = 'change_guests' THEN v_new_guests END,
    CASE WHEN p_action = 'move_date' THEN v_cur_window.id END,
    CASE WHEN p_action = 'move_date' THEN v_new_window.id END,
    v_extras, v_delta_base, v_tax_delta, v_policy_fee, v_refund, p_actor_type, p_actor_user,
    v_key, v_request_hash, v_summary
  ) RETURNING id INTO v_amend_id;
  IF v_refund > 0 THEN
    v_refund := public.issue_4490_refund_amount_internal(v_group.id, v_refund, p_actor_type, p_actor_user,
      p_token_hash, 'Booking changed: ' || replace(p_action, '_', ' '), v_key);
  END IF;
  UPDATE public.stay_reservation_groups SET version = version + 1, updated_at = now()
  WHERE id = v_group.id RETURNING * INTO v_group;
  INSERT INTO public.stay_reservation_events (
    group_id, event_type, actor_type, actor_user_id, idempotency_key, safe_metadata
  ) VALUES (
    v_group.id, 'stay_offer_changed', p_actor_type, p_actor_user, 'offer-change:' || v_key,
    jsonb_build_object('changeId', v_amend_id, 'action', p_action,
      'amountMinor', (v_summary->>'balanceAfterMinor'), 'currencyCode', v_group.currency_code,
      'refundMinor', v_refund::text)
  );
  RETURN v_summary || jsonb_build_object('changeId', v_amend_id, 'replayed', false,
    'refundMinor', v_refund, 'groupVersion', v_group.version);
END;
$function$;


-- hire facts: current day and party, damage deposit (from 20281203154490_issue_4490_p4_private_hire.sql)
CREATE OR REPLACE FUNCTION public.issue_4490_hire_booking_facts(p_group_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT CASE WHEN g.offer_kind <> 'private_hire' THEN NULL ELSE jsonb_strip_nulls(jsonb_build_object(
    'placeName', l.price_snapshot->>'placeName',
    'spaceIds', l.price_snapshot->'spaceIds',
    'combinationId', l.price_snapshot->'combinationId',
    'sessionLabel', l.offering_snapshot->>'sessionLabel',
    -- #4490 P4 follow-up: the current claims (a moved hire) win over the quote.
    'bookedFrom', COALESCE(to_jsonb(ac.booked_from), q.inventory_snapshot->'bookedFrom'),
    'bookedTo', COALESCE(to_jsonb(ac.booked_to), q.inventory_snapshot->'bookedTo'),
    'setupFrom', COALESCE(to_jsonb(ac.claim_from), q.inventory_snapshot->'claimFrom'),
    'cleanupUntil', COALESCE(to_jsonb(ac.claim_to), q.inventory_snapshot->'claimTo'),
    'guests', COALESCE((SELECT a.to_guests FROM public.venue_booking_amendments a
                        WHERE a.group_id = g.id AND a.kind = 'change_guests' ORDER BY a.created_at DESC LIMIT 1),
                       (l.price_snapshot->>'guests')::integer, l.place_guests),
    'damageDeposit', public.issue_4490_damage_deposit_state(g.id),
    'hireMinor', (l.price_snapshot->>'packageMinor')::bigint,
    'extraGuests', (l.price_snapshot->>'extraGuests')::integer,
    'extraGuestMinor', (l.price_snapshot->>'extraGuestMinor')::bigint,
    'overtimeHours', (l.price_snapshot->>'overtimeHours')::integer,
    'overtimeMinor', (l.price_snapshot->>'overtimeMinor')::bigint,
    'hireCharge', l.price_snapshot->>'hireCharge',
    'minSpendMinor', (g.payment_plan_snapshot->>'minSpendMinor')::bigint,
    'damageDepositMinor', COALESCE((g.payment_plan_snapshot->>'damageDepositMinor')::bigint, 0),
    'occasion', g.booking_answers->>'occasion',
    'note', g.booking_answers->>'note',
    'siteVisit', (g.booking_answers->>'siteVisit')::boolean,
    'replyWithinHours', (g.payment_plan_snapshot->>'requestResponseHours')::integer,
    'declineReason', (SELECT e.safe_metadata->>'reason' FROM public.stay_reservation_events e
                      WHERE e.group_id = g.id AND e.event_type = 'stay_offer_request_declined'
                      ORDER BY e.created_at DESC LIMIT 1),
    'alternatives', (SELECT e.safe_metadata->'alternatives' FROM public.stay_reservation_events e
                     WHERE e.group_id = g.id AND e.event_type = 'stay_offer_request_declined'
                     ORDER BY e.created_at DESC LIMIT 1),
    'hostNote', (SELECT e.safe_metadata->>'note' FROM public.stay_reservation_events e
                 WHERE e.group_id = g.id AND e.event_type = 'stay_offer_request_approved'
                 ORDER BY e.created_at DESC LIMIT 1),
    'closedReason', public.issue_4490_closed_reason(g.id)
  )) END
  FROM public.stay_reservation_groups g
  JOIN LATERAL (SELECT * FROM public.stay_reservation_lines l2 WHERE l2.group_id = g.id
                ORDER BY l2.created_at, l2.id LIMIT 1) l ON true
  LEFT JOIN public.stay_quote_lines q ON q.id = l.quote_line_id
  LEFT JOIN LATERAL (
    SELECT min(lower(c.booked_range)) AS booked_from, max(upper(c.booked_range)) AS booked_to,
           min(lower(c.claim_range)) AS claim_from, max(upper(c.claim_range)) AS claim_to
    FROM public.venue_space_claims c
    WHERE c.group_id = g.id AND c.state IN ('held', 'committed')
    HAVING count(*) > 0) ac ON true
  WHERE g.id = p_group_id;
$function$;


-- damage deposit refund (damage allocations only, no fee reversal) (from 20281203144490_issue_4490_p3_packages_deposits.sql)
CREATE OR REPLACE FUNCTION public.issue_4490_refund_damage_internal(
  p_group_id uuid,
  p_amount bigint,
  p_actor_type text,
  p_requester uuid,
  p_token_hash bytea,
  p_reason text,
  p_key text
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_group public.stay_reservation_groups%ROWTYPE;
  v_attempt public.stay_payment_attempts%ROWTYPE;
  v_preview public.stay_cancel_previews%ROWTYPE;
  v_refund public.stay_refunds%ROWTYPE;
  v_source public.source_refunds%ROWTYPE;
  v_remaining bigint := GREATEST(COALESCE(p_amount, 0), 0);
  v_take bigint;
  v_avail bigint;
  v_snapshot jsonb;
  v_fee_reversal bigint;
  v_fee_remaining bigint;
  v_existing_fee bigint;
  v_ordinal integer := 0;
  v_total bigint := 0;
  v_requester uuid := p_requester;
  v_reason text := left(COALESCE(NULLIF(btrim(COALESCE(p_reason, '')), ''), 'Damage deposit returned'), 500);
  v_key text := btrim(p_key);
  v_selected uuid[];
BEGIN
  IF v_remaining = 0 THEN
    RETURN 0;
  END IF;
  SELECT * INTO v_group FROM public.stay_reservation_groups WHERE id = p_group_id;
  SELECT array_agg(l.id ORDER BY l.id) INTO v_selected
  FROM public.stay_reservation_lines l WHERE l.group_id = p_group_id;
  PERFORM set_config('mingla.issue_4490_offer_rail', p_group_id::text, true);
  FOR v_attempt IN
    SELECT * FROM public.stay_payment_attempts
    WHERE group_id = p_group_id AND state = 'succeeded'
    ORDER BY succeeded_at DESC, id DESC
    FOR UPDATE
  LOOP
    EXIT WHEN v_remaining <= 0;
    WITH eligible AS (
      SELECT a.id AS payment_allocation_id, a.reservation_line_id,
        GREATEST(0, a.charged_minor - a.refunded_minor - COALESCE((
          SELECT sum(ra.amount_minor) FROM public.stay_refund_allocations ra
          JOIN public.stay_refunds rr ON rr.id = ra.refund_id
          WHERE ra.payment_allocation_id = a.id
            AND rr.state IN ('submitted', 'processing', 'manual_reconciliation')), 0)) AS outstanding_minor,
        a.component, a.component_ref, a.refund_treatment
      FROM public.stay_payment_allocations a WHERE a.payment_attempt_id = v_attempt.id
        AND public.issue_4490_is_damage_allocation(a.component, a.component_ref)
    )
    SELECT COALESCE(sum(outstanding_minor), 0) INTO v_avail FROM eligible;
    CONTINUE WHEN v_avail = 0;
    v_take := LEAST(v_remaining, v_avail);
    WITH eligible AS (
      SELECT a.id AS payment_allocation_id, a.reservation_line_id, a.component, a.component_ref, a.refund_treatment,
        GREATEST(0, a.charged_minor - a.refunded_minor - COALESCE((
          SELECT sum(ra.amount_minor) FROM public.stay_refund_allocations ra
          JOIN public.stay_refunds rr ON rr.id = ra.refund_id
          WHERE ra.payment_allocation_id = a.id
            AND rr.state IN ('submitted', 'processing', 'manual_reconciliation')), 0)) AS outstanding_minor
      FROM public.stay_payment_allocations a WHERE a.payment_attempt_id = v_attempt.id
        AND public.issue_4490_is_damage_allocation(a.component, a.component_ref)
    ), fl AS (
      SELECT e.*, floor(v_take::numeric * e.outstanding_minor / v_avail)::bigint AS f,
        (v_take::numeric * e.outstanding_minor) - floor(v_take::numeric * e.outstanding_minor / v_avail) * v_avail AS rem
      FROM eligible e WHERE e.outstanding_minor > 0
    ), rk AS (
      SELECT fl.*, row_number() OVER (ORDER BY fl.rem DESC, fl.payment_allocation_id) AS rn,
        v_take - sum(fl.f) OVER () AS extra
      FROM fl
    )
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'paymentAllocationId', rk.payment_allocation_id,
        'reservationLineId', rk.reservation_line_id,
        'component', rk.component,
        'componentRef', rk.component_ref,
        'refundTreatment', rk.refund_treatment,
        'amountMinor', (rk.f + CASE WHEN rk.rn <= rk.extra THEN 1 ELSE 0 END)::text,
        'attemptId', v_attempt.id) ORDER BY rk.reservation_line_id, rk.payment_allocation_id), '[]'::jsonb)
    INTO v_snapshot
    FROM rk WHERE rk.f + CASE WHEN rk.rn <= rk.extra THEN 1 ELSE 0 END > 0;
    v_ordinal := v_ordinal + 1;
    INSERT INTO public.stay_cancel_previews (
      group_id, actor_user_id, actor_type, selected_line_ids, group_version, amount_minor,
      allocation_snapshot, preview_hash, expires_at, consumed_at, actor_token_hash
    ) VALUES (
      v_group.id, p_requester, CASE WHEN p_requester IS NULL AND p_token_hash IS NULL THEN 'system' ELSE p_actor_type END,
      v_selected, v_group.version, v_take, v_snapshot,
      encode(pg_catalog.sha256(convert_to(jsonb_build_object('depositRefund', v_key, 'n', v_ordinal,
        'attemptId', v_attempt.id, 'amountMinor', v_take::text)::text, 'UTF8')), 'hex'),
      now() + interval '10 minutes', now(),
      CASE WHEN p_actor_type = 'guest' THEN p_token_hash END
    ) RETURNING * INTO v_preview;
    SELECT COALESCE(sum(application_fee_reversal_minor), 0) INTO v_existing_fee
    FROM public.stay_refunds prior_refund
    WHERE prior_refund.payment_attempt_id = v_attempt.id
      AND prior_refund.state IN ('submitted', 'processing', 'succeeded', 'manual_reconciliation');
    v_fee_remaining := GREATEST(0, v_attempt.application_fee_minor - v_existing_fee);
    -- The damage deposit never carried the platform fee: nothing to reverse.
    v_fee_reversal := 0;
      INSERT INTO public.stay_refunds (
        group_id, payment_attempt_id, cancel_preview_id, requested_by_type, requested_by_user_id,
        reason, state, amount_minor, application_fee_reversal_minor, currency_code, provider, idempotency_key
      ) VALUES (
        v_group.id, v_attempt.id, v_preview.id, v_preview.actor_type, v_requester, v_reason,
        CASE WHEN v_preview.amount_minor = 0 THEN 'succeeded' ELSE 'submitted' END,
        v_preview.amount_minor, v_fee_reversal, v_group.currency_code, v_attempt.provider,
        'offer-deposit-refund:' || v_key || ':' || v_ordinal
      ) RETURNING * INTO v_refund;
      IF v_preview.amount_minor > 0 THEN
        WITH requested AS (
          SELECT (item->>'paymentAllocationId')::uuid AS payment_allocation_id,
                 (item->>'reservationLineId')::uuid AS reservation_line_id,
                 (item->>'amountMinor')::bigint AS amount_minor
          FROM jsonb_array_elements(v_preview.allocation_snapshot) item
        ),
        floors AS (
          SELECT requested.*,
            floor(v_fee_reversal::numeric * requested.amount_minor / v_preview.amount_minor)::bigint AS fee_floor,
            (v_fee_reversal::numeric * requested.amount_minor
              - floor(v_fee_reversal::numeric * requested.amount_minor / v_preview.amount_minor)
                * v_preview.amount_minor) AS remainder
          FROM requested
        ),
        ranked AS (
          SELECT floors.*,
            row_number() OVER (ORDER BY remainder DESC, payment_allocation_id) AS remainder_rank,
            v_fee_reversal - sum(fee_floor) OVER () AS extras
          FROM floors
        )
        INSERT INTO public.stay_refund_allocations (
          refund_id, payment_allocation_id, reservation_line_id, amount_minor,
          organizer_liability_minor, platform_fee_reversal_minor, state
        )
        SELECT v_refund.id, ranked.payment_allocation_id, ranked.reservation_line_id, ranked.amount_minor,
          ranked.amount_minor - (ranked.fee_floor + CASE WHEN ranked.remainder_rank <= ranked.extras THEN 1 ELSE 0 END),
          ranked.fee_floor + CASE WHEN ranked.remainder_rank <= ranked.extras THEN 1 ELSE 0 END,
          'submitted'
        FROM ranked;
        INSERT INTO public.source_refunds (
          source_type, source_id, subject_id, brand_id, venue_id, refund_kind,
          requested_by_type, requested_by_user_id, reason, provider, currency,
          original_charge_cents, buyer_refund_requested_cents,
          original_application_fee_cents, fee_reversal_required_cents,
          fee_state, fee_leg_kind, financial_state,
          organizer_refund_liability_cents, platform_fee_absorption_cents,
          provider_payment_reference, provider_account_reference, idempotency_key
        ) VALUES (
          'stay_reservation', v_refund.id, v_group.id, v_group.brand_id, v_group.venue_id, 'stay_cancellation',
          CASE v_preview.actor_type WHEN 'guest' THEN 'consumer' WHEN 'admin' THEN 'admin' ELSE 'brand_staff' END,
          v_requester, v_reason, v_attempt.provider, v_group.currency_code::text,
          v_attempt.amount_minor::integer, v_refund.amount_minor::integer,
          v_attempt.application_fee_minor::integer, v_fee_reversal::integer,
          CASE WHEN v_fee_reversal = 0 THEN 'not_required' ELSE 'queued' END,
          CASE WHEN v_fee_reversal = 0 THEN 'not_required'
               WHEN v_attempt.provider = 'stripe' THEN 'stripe_application_fee_refund'
               ELSE 'paystack_ledger_allocation' END,
          'pending',
          (v_refund.amount_minor - v_fee_reversal)::integer, v_fee_reversal::integer,
          v_attempt.provider_payment_ref, v_attempt.connected_account_ref,
          'stay-refund:' || v_refund.id
        ) RETURNING * INTO v_source;
        UPDATE public.stay_refunds SET source_refund_id = v_source.id, updated_at = now()
        WHERE id = v_refund.id RETURNING * INTO v_refund;
        INSERT INTO public.source_refund_ledger_allocations (
          refund_id, allocation_type, amount_cents, currency, provider, state, idempotency_key
        ) VALUES (
          v_source.id, 'buyer_refund', v_source.buyer_refund_requested_cents, v_source.currency,
          v_source.provider, 'prepared', 'source-refund-allocation:buyer:' || v_source.id
        );
        IF v_source.organizer_refund_liability_cents > 0 THEN
          INSERT INTO public.source_refund_ledger_allocations (
            refund_id, allocation_type, amount_cents, currency, provider, state, idempotency_key
          ) VALUES (
            v_source.id, 'organizer_refund_liability', v_source.organizer_refund_liability_cents,
            v_source.currency, v_source.provider, 'prepared', 'source-refund-allocation:organizer:' || v_source.id
          );
        END IF;
        IF v_source.platform_fee_absorption_cents > 0 THEN
          INSERT INTO public.source_refund_ledger_allocations (
            refund_id, allocation_type, amount_cents, currency, provider, state, idempotency_key
          ) VALUES (
            v_source.id, 'platform_application_fee_reversal', v_source.platform_fee_absorption_cents,
            v_source.currency, v_source.provider, 'prepared', 'source-refund-allocation:platform:' || v_source.id
          );
        END IF;
        INSERT INTO public.stay_money_ledger (
          group_id, payment_attempt_id, refund_id, entry_type, amount_minor, currency_code,
          idempotency_key, metadata
        ) VALUES (
          v_group.id, v_attempt.id, v_refund.id, 'refund_requested', v_refund.amount_minor,
          v_group.currency_code, 'stay:refund_requested:' || v_refund.id,
          jsonb_build_object('reason', 'venue_damage_deposit_released')
        ) ON CONFLICT (idempotency_key) DO NOTHING;
      END IF;
      v_total := v_total + v_refund.amount_minor;
      v_remaining := v_remaining - v_refund.amount_minor;
  END LOOP;
  RETURN v_total;
END;
$function$;


-- sweep: return damage deposits after the release days (from 20281203164490_issue_4490_p5_tables_floor_hour.sql)
CREATE OR REPLACE FUNCTION public.issue_4490_offer_sweep(p_limit integer DEFAULT 200)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 200), 1), 1000);
  v_expired jsonb;
  v_row record;
  v_reminders integer := 0;
  v_overdue integer := 0;
  v_expiring integer := 0;
  v_lapsed integer := 0;
  v_day integer;
  v_inserted integer;
  v_released integer := 0;
  v_deposits integer := 0;
BEGIN
  IF NOT public.issue_1389_service_role() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  -- Lapsed holds: the generic Stays expiry (offer groups included).
  v_expired := to_jsonb(public.issue_1388_expire_groups(v_limit, gen_random_uuid()));
  UPDATE public.venue_space_claims
  SET state = 'released', held_until = NULL, released_at = now(), release_reason = 'hold_lapsed', updated_at = now()
  WHERE state = 'held' AND held_until <= now();
  GET DIAGNOSTICS v_lapsed = ROW_COUNT;

  FOR v_row IN
    SELECT g.id, g.payment_deadline, g.currency_code
    FROM public.stay_reservation_groups g
    WHERE g.offer_kind IS NOT NULL
      AND g.state = 'approved_payment_required'
      AND g.payment_deadline > now()
      AND g.payment_deadline <= now() + interval '12 hours'
    ORDER BY g.payment_deadline
    LIMIT v_limit
    FOR UPDATE OF g SKIP LOCKED
  LOOP
    INSERT INTO public.stay_reservation_events (
      group_id, event_type, actor_type, idempotency_key, safe_metadata
    ) VALUES (
      v_row.id, 'stay_offer_hold_expiring', 'service',
      'hold-expiring:' || v_row.id || ':' || floor(extract(epoch FROM v_row.payment_deadline))::bigint,
      jsonb_build_object('holdUntil', v_row.payment_deadline, 'reason', 'hold_expiring')
    ) ON CONFLICT (group_id, idempotency_key) DO NOTHING;
    GET DIAGNOSTICS v_inserted = ROW_COUNT;
    v_expiring := v_expiring + v_inserted;
  END LOOP;

  FOR v_row IN
    SELECT g.id, g.balance_due_at, g.created_at, g.currency_code, g.venue_id,
           COALESCE(s.balance_reminder_days, '{7,1}'::smallint[]) AS days, m.balance
    FROM public.stay_reservation_groups g
    LEFT JOIN public.venue_booking_settings s ON s.venue_id = g.venue_id
    CROSS JOIN LATERAL public.issue_4490_booking_money(g.id) m
    WHERE g.offer_kind IS NOT NULL
      AND g.state = 'confirmed'
      AND g.balance_due_at IS NOT NULL
      AND g.balance_due_at <= now() + interval '60 days'
      AND g.balance_due_at >= now() - interval '4 days'
      AND m.balance > 0
    ORDER BY g.balance_due_at
    LIMIT v_limit
    FOR UPDATE OF g SKIP LOCKED
  LOOP
    IF now() < v_row.balance_due_at THEN
      SELECT min(d) INTO v_day FROM unnest(v_row.days) d
      WHERE d > 0
        AND now() >= v_row.balance_due_at - make_interval(days => d)
        AND v_row.created_at <= v_row.balance_due_at - make_interval(days => d);
      IF v_day IS NOT NULL THEN
        INSERT INTO public.stay_reservation_events (
          group_id, event_type, actor_type, idempotency_key, safe_metadata
        ) VALUES (
          v_row.id, 'stay_offer_balance_due', 'service', 'balance-reminder:' || v_row.id || ':' || v_day,
          jsonb_build_object('amountMinor', v_row.balance::text, 'currencyCode', v_row.currency_code,
            'balanceDueAt', v_row.balance_due_at, 'reason', 'reminder', 'daysBefore', v_day)
        ) ON CONFLICT (group_id, idempotency_key) DO NOTHING;
        GET DIAGNOSTICS v_inserted = ROW_COUNT;
        v_reminders := v_reminders + v_inserted;
      END IF;
    ELSE
      v_day := CASE WHEN now() >= v_row.balance_due_at + interval '3 days' THEN 3 ELSE 0 END;
      INSERT INTO public.stay_reservation_events (
        group_id, event_type, actor_type, idempotency_key, safe_metadata
      ) VALUES (
        v_row.id, 'stay_offer_balance_overdue', 'service', 'balance-overdue:' || v_row.id || ':' || v_day,
        jsonb_build_object('amountMinor', v_row.balance::text, 'currencyCode', v_row.currency_code,
          'balanceDueAt', v_row.balance_due_at, 'reason', 'overdue', 'daysAfter', v_day)
      ) ON CONFLICT (group_id, idempotency_key) DO NOTHING;
      GET DIAGNOSTICS v_inserted = ROW_COUNT;
      v_overdue := v_overdue + v_inserted;
    END IF;
  END LOOP;
  -- #4490 P5: by the hour: release a booking nobody checked in for N minutes
  -- after its start (the place frees; no refund unless the policy gives one).
  FOR v_row IN
    SELECT g.id, w.starts_at, o.no_show_release_minutes AS release_minutes
    FROM public.stay_reservation_groups g
    JOIN LATERAL (SELECT l.* FROM public.stay_reservation_lines l WHERE l.group_id = g.id
                  ORDER BY l.created_at, l.id LIMIT 1) l ON true
    JOIN public.stay_offerings o ON o.id = l.offering_id
    JOIN public.stay_place_windows w ON w.id = public.issue_4490_line_window_id(l.id)
    JOIN public.venue_passes p ON p.group_id = g.id
    WHERE g.offer_kind = 'by_the_hour' AND g.state = 'confirmed'
      AND o.no_show_release_minutes IS NOT NULL
      AND p.status = 'valid' AND p.admitted_count = 0
      AND now() >= w.starts_at + make_interval(mins => o.no_show_release_minutes)
      AND EXISTS (SELECT 1 FROM public.stay_inventory_commitments c WHERE c.group_id = g.id AND c.state = 'active')
    ORDER BY w.starts_at
    LIMIT v_limit
    FOR UPDATE OF g SKIP LOCKED
  LOOP
    UPDATE public.stay_inventory_commitments
    SET state = 'released', released_at = now(), release_reason = 'no_show'
    WHERE group_id = v_row.id AND state = 'active';
    UPDATE public.venue_passes SET status = 'void', version = version + 1, updated_at = now()
    WHERE group_id = v_row.id AND status = 'valid';
    INSERT INTO public.stay_reservation_events (
      group_id, event_type, actor_type, idempotency_key, safe_metadata
    ) VALUES (
      v_row.id, 'stay_offer_no_show_released', 'service', 'no-show-release:' || v_row.id,
      jsonb_build_object('startsAt', v_row.starts_at, 'releaseMinutes', v_row.release_minutes)
    ) ON CONFLICT (group_id, idempotency_key) DO NOTHING;
    v_released := v_released + 1;
  END LOOP;
  -- #4490 P4 follow-up: return a hire's damage deposit N days after it ended
  -- unless the venue is holding it (a claim).
  FOR v_row IN
    SELECT g.id
    FROM public.stay_reservation_groups g
    LEFT JOIN public.venue_booking_settings s ON s.venue_id = g.venue_id
    WHERE g.offer_kind = 'private_hire' AND g.state IN ('confirmed', 'partially_cancelled')
      AND (public.issue_4490_damage_deposit_state(g.id)->>'status') = 'collected'
      AND (public.issue_4490_damage_deposit_state(g.id)->>'releaseAt')::timestamptz <= now()
    ORDER BY g.created_at
    LIMIT v_limit
    FOR UPDATE OF g SKIP LOCKED
  LOOP
    PERFORM public.issue_4490_release_damage_internal(v_row.id, 'system', NULL, 0, NULL, 'sweep-release-' || v_row.id);
    v_deposits := v_deposits + 1;
  END LOOP;
  RETURN jsonb_build_object('expired', v_expired, 'reminders', v_reminders, 'overdue', v_overdue,
    'holdExpiring', v_expiring, 'lapsedClaims', v_lapsed, 'noShowReleased', v_released,
    'depositsReleased', v_deposits);
END;
$function$;


-- Return (all or part of) a hire's damage deposit. Staff: money rights, after
-- the hire has ended; the sweep returns it in full (actor system).
CREATE OR REPLACE FUNCTION public.issue_4490_release_damage_internal(
  p_group_id uuid,
  p_actor_type text,
  p_user_id uuid,
  p_keep_minor bigint,
  p_reason text,
  p_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_group public.stay_reservation_groups%ROWTYPE;
  v_state jsonb;
  v_paid bigint;
  v_keep bigint := COALESCE(p_keep_minor, 0);
  v_reason text := NULLIF(btrim(COALESCE(p_reason, '')), '');
  v_refund bigint;
BEGIN
  IF p_actor_type NOT IN ('staff', 'system') OR char_length(btrim(COALESCE(p_key, ''))) NOT BETWEEN 8 AND 200 THEN
    RAISE EXCEPTION 'offer_invalid_payload' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_group FROM public.stay_reservation_groups WHERE id = p_group_id FOR UPDATE;
  IF NOT FOUND OR v_group.offer_kind IS DISTINCT FROM 'private_hire' THEN
    RAISE EXCEPTION 'offer_booking_not_found' USING ERRCODE = 'P0002';
  END IF;
  v_state := public.issue_4490_damage_deposit_state(p_group_id);
  IF v_state->>'status' = 'released' THEN
    RETURN v_state || jsonb_build_object('groupId', p_group_id, 'replayed', true);
  END IF;
  IF v_state->>'status' NOT IN ('collected', 'held_by_venue') THEN
    RAISE EXCEPTION 'deposit_nothing_to_release' USING ERRCODE = 'P0001';
  END IF;
  IF p_actor_type = 'staff' AND now() < (v_state->>'hireEndsAt')::timestamptz THEN
    RAISE EXCEPTION 'deposit_release_too_early' USING ERRCODE = 'P0001';
  END IF;
  v_paid := (v_state->>'paidMinor')::bigint;
  IF v_keep < 0 OR v_keep > v_paid THEN
    RAISE EXCEPTION 'deposit_keep_invalid' USING ERRCODE = '22023';
  END IF;
  IF v_keep > 0 AND (v_reason IS NULL OR char_length(v_reason) NOT BETWEEN 3 AND 500) THEN
    RAISE EXCEPTION 'deposit_keep_reason_required' USING ERRCODE = '22023';
  END IF;
  v_refund := public.issue_4490_refund_damage_internal(p_group_id, v_paid - v_keep, 'staff', p_user_id, NULL,
    COALESCE(v_reason, 'Damage deposit returned'), btrim(p_key));
  INSERT INTO public.stay_reservation_events (
    group_id, event_type, actor_type, actor_user_id, idempotency_key, safe_metadata
  ) VALUES (
    p_group_id, 'stay_offer_deposit_released', CASE WHEN p_actor_type = 'system' THEN 'service' ELSE 'staff' END,
    p_user_id, 'deposit-release:' || p_group_id,
    jsonb_strip_nulls(jsonb_build_object('refundMinor', v_refund, 'keptMinor', v_keep,
      'reason', CASE WHEN v_keep > 0 THEN v_reason END))
  );
  UPDATE public.stay_reservation_groups SET version = version + 1, updated_at = now() WHERE id = p_group_id;
  RETURN public.issue_4490_damage_deposit_state(p_group_id)
    || jsonb_build_object('groupId', p_group_id, 'replayed', false);
END;
$function$;

-- Host (signed in, money rights): return the damage deposit (keepMinor > 0
-- keeps part, with a reason) or hold it while the venue checks for damage.
CREATE OR REPLACE FUNCTION public.issue_4490_release_damage_deposit(
  p_group_id uuid,
  p_keep_minor bigint DEFAULT 0,
  p_reason text DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_venue uuid;
BEGIN
  SELECT g.venue_id INTO v_venue FROM public.stay_reservation_groups g WHERE g.id = p_group_id AND g.offer_kind IS NOT NULL;
  IF auth.uid() IS NULL OR v_venue IS NULL OR NOT public.issue_4490_can_manage_money(v_venue, auth.uid()) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  RETURN public.issue_4490_release_damage_internal(p_group_id, 'staff', auth.uid(), p_keep_minor, p_reason,
    COALESCE(p_idempotency_key, ''));
END;
$function$;

CREATE OR REPLACE FUNCTION public.issue_4490_hold_damage_deposit(
  p_group_id uuid,
  p_reason text,
  p_idempotency_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_group public.stay_reservation_groups%ROWTYPE;
  v_state jsonb;
BEGIN
  SELECT * INTO v_group FROM public.stay_reservation_groups WHERE id = p_group_id AND offer_kind IS NOT NULL FOR UPDATE;
  IF auth.uid() IS NULL OR NOT FOUND OR NOT public.issue_4490_can_manage_money(v_group.venue_id, auth.uid()) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  IF char_length(btrim(COALESCE(p_reason, ''))) NOT BETWEEN 3 AND 500
     OR char_length(btrim(COALESCE(p_idempotency_key, ''))) NOT BETWEEN 8 AND 200 THEN
    RAISE EXCEPTION 'deposit_hold_reason_required' USING ERRCODE = '22023';
  END IF;
  v_state := public.issue_4490_damage_deposit_state(p_group_id);
  IF v_state->>'status' = 'held_by_venue' THEN
    RETURN v_state || jsonb_build_object('groupId', p_group_id, 'replayed', true);
  END IF;
  IF COALESCE(v_state->>'status', '') <> 'collected' THEN
    RAISE EXCEPTION 'deposit_nothing_to_release' USING ERRCODE = 'P0001';
  END IF;
  INSERT INTO public.stay_reservation_events (
    group_id, event_type, actor_type, actor_user_id, idempotency_key, safe_metadata
  ) VALUES (
    p_group_id, 'stay_offer_deposit_held', 'staff', auth.uid(), 'deposit-hold:' || p_group_id,
    jsonb_build_object('reason', btrim(p_reason))
  );
  UPDATE public.stay_reservation_groups SET version = version + 1, updated_at = now() WHERE id = p_group_id;
  RETURN public.issue_4490_damage_deposit_state(p_group_id)
    || jsonb_build_object('groupId', p_group_id, 'replayed', false);
END;
$function$;

REVOKE ALL ON FUNCTION
  public.issue_4490_is_damage_allocation(text, text),
  public.issue_4490_change_guest_max(uuid, uuid),
  public.issue_4490_damage_deposit_state(uuid),
  public.issue_4490_refund_damage_internal(uuid, bigint, text, uuid, bytea, text, text),
  public.issue_4490_release_damage_internal(uuid, text, uuid, bigint, text, text),
  public.issue_4490_release_damage_deposit(uuid, bigint, text, text),
  public.issue_4490_hold_damage_deposit(uuid, text, text)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
  public.issue_4490_release_damage_deposit(uuid, bigint, text, text),
  public.issue_4490_hold_damage_deposit(uuid, text, text)
TO authenticated, service_role;

COMMIT;
