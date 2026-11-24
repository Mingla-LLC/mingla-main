-- Issue #4490, spec 07 H: layout-specific space capacity, hire choices and
-- immutable quote/booking snapshots. Local stack only until Seth approves a
-- production migration.

BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE TABLE public.venue_space_layouts (
  space_id uuid NOT NULL REFERENCES public.venue_spaces(id) ON DELETE CASCADE,
  layout text NOT NULL CHECK (layout IN ('banquet', 'theatre', 'classroom', 'cabaret', 'boardroom')),
  capacity integer NOT NULL CHECK (capacity BETWEEN 1 AND 100000),
  PRIMARY KEY (space_id, layout)
);
COMMENT ON TABLE public.venue_space_layouts IS
  '#4490 H: capacities for fixed layouts other than standing and seated. Written only through issue_4490_manage_space.';

ALTER TABLE public.venue_space_layouts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.venue_space_layouts FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.venue_space_layouts TO authenticated;
GRANT ALL ON public.venue_space_layouts TO service_role;
CREATE POLICY "venue space layouts readable by venue viewers"
  ON public.venue_space_layouts FOR SELECT TO authenticated
  USING (public.issue_4490_can_view_space(space_id));

CREATE OR REPLACE FUNCTION public.issue_4490_layouts_valid(p_layouts text[], p_kind text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $function$
  SELECT p_layouts IS NULL OR (
    cardinality(p_layouts) BETWEEN 1 AND 7
    AND p_layouts <@ ARRAY['standing','seated','banquet','theatre','classroom','cabaret','boardroom']::text[]
    AND (SELECT count(DISTINCT layout) FROM unnest(p_layouts) layout) = cardinality(p_layouts)
    AND p_kind IN ('private_hire', 'group_package')
    AND (p_kind <> 'group_package' OR cardinality(p_layouts) <= 1)
  );
$function$;

ALTER TABLE public.stay_offerings
  ADD COLUMN layouts text[] NULL,
  ADD CONSTRAINT stay_offerings_layouts_valid CHECK (public.issue_4490_layouts_valid(layouts, kind));

CREATE OR REPLACE FUNCTION public.issue_4490_space_layout_capacity(p_space_id uuid, p_layout text)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT CASE p_layout
    WHEN 'standing' THEN s.capacity_standing
    WHEN 'seated' THEN s.capacity_seated
    ELSE (SELECT l.capacity FROM public.venue_space_layouts l
          WHERE l.space_id = s.id AND l.layout = p_layout)
  END
  FROM public.venue_spaces s
  WHERE s.id = p_space_id
    AND p_layout IN ('standing','seated','banquet','theatre','classroom','cabaret','boardroom');
$function$;

CREATE OR REPLACE FUNCTION public.issue_4490_option_layout_capacity(p_option_id uuid, p_layout text)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  WITH spaces AS MATERIALIZED (
    SELECT space_id
    FROM unnest(COALESCE(public.issue_4490_option_spaces(p_option_id), '{}'::uuid[])) AS selected(space_id)
  ), capacities AS MATERIALIZED (
    SELECT public.issue_4490_space_layout_capacity(space_id, p_layout) AS capacity
    FROM spaces
  )
  SELECT CASE
    WHEN count(*) = 0 OR count(capacity) <> count(*) THEN NULL
    ELSE sum(capacity)::integer
  END
  FROM capacities;
$function$;

-- Checked text patches keep the cumulative functions from the preceding
-- #4490 migrations intact. A replay accepts the already-patched form only.
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
  v_new_count integer;
BEGIN
  v_old_count := (length(v_def) - length(replace(v_def, p_old, ''))) / length(p_old);
  v_new_count := (length(v_def) - length(replace(v_def, p_new, ''))) / length(p_new);
  IF v_new_count = 1 AND v_old_count = 0 THEN RETURN; END IF;
  IF v_old_count <> 1 OR v_new_count <> 0 THEN
    RAISE EXCEPTION 'issue_4490 layouts patch precondition failed for %: old %, new %',
      p_sig, v_old_count, v_new_count;
  END IF;
  EXECUTE replace(v_def, p_old, p_new);
END;
$patch$;

-- Space authoring owns every custom-layout row.
SELECT pg_temp.issue_4490_patch(
  'public.issue_4490_manage_space(text,uuid,jsonb,bigint)'::regprocedure,
  $old$  v_amenities text[];
  v_needs text[];$old$,
  $new$  v_amenities text[];
  v_layouts jsonb := '[]'::jsonb;
  v_needs text[];$new$
);
SELECT pg_temp.issue_4490_patch(
  'public.issue_4490_manage_space(text,uuid,jsonb,bigint)'::regprocedure,
  $old$  IF v_payload ? 'amenities' THEN
    IF jsonb_typeof(v_payload->'amenities') <> 'array'
       OR EXISTS (SELECT 1 FROM jsonb_array_elements(v_payload->'amenities') a WHERE jsonb_typeof(a) <> 'string') THEN
      RAISE EXCEPTION 'space_amenities_invalid' USING ERRCODE = '22023';
    END IF;
    v_amenities := ARRAY(SELECT jsonb_array_elements_text(v_payload->'amenities'));
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock$old$,
  $new$  IF v_payload ? 'amenities' THEN
    IF jsonb_typeof(v_payload->'amenities') <> 'array'
       OR EXISTS (SELECT 1 FROM jsonb_array_elements(v_payload->'amenities') a WHERE jsonb_typeof(a) <> 'string') THEN
      RAISE EXCEPTION 'space_amenities_invalid' USING ERRCODE = '22023';
    END IF;
    v_amenities := ARRAY(SELECT jsonb_array_elements_text(v_payload->'amenities'));
  END IF;
  IF v_payload ? 'layouts' THEN
    v_layouts := v_payload->'layouts';
    IF jsonb_typeof(v_layouts) <> 'array' OR jsonb_array_length(v_layouts) > 5
       OR EXISTS (SELECT 1 FROM jsonb_array_elements(v_layouts) l
                  WHERE jsonb_typeof(l) <> 'object'
                     OR COALESCE(l->>'layout', '') NOT IN ('banquet','theatre','classroom','cabaret','boardroom')
                     OR jsonb_typeof(l->'capacity') <> 'number'
                     OR COALESCE(l->>'capacity', '') !~ '^[0-9]{1,6}$'
                     OR (l->>'capacity')::integer NOT BETWEEN 1 AND 100000)
       OR (SELECT count(DISTINCT l->>'layout') FROM jsonb_array_elements(v_layouts) l)
          <> jsonb_array_length(v_layouts) THEN
      RAISE EXCEPTION 'space_layouts_invalid' USING ERRCODE = '22023';
    END IF;
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock$new$
);
SELECT pg_temp.issue_4490_patch(
  'public.issue_4490_manage_space(text,uuid,jsonb,bigint)'::regprocedure,
  $old$      ) RETURNING * INTO v_space;
      RETURN public.issue_4490_space_projection(v_space);

    ELSIF p_action = 'update' THEN$old$,
  $new$      ) RETURNING * INTO v_space;
      INSERT INTO public.venue_space_layouts (space_id, layout, capacity)
      SELECT v_space.id, l->>'layout', (l->>'capacity')::integer
      FROM jsonb_array_elements(v_layouts) l;
      RETURN public.issue_4490_space_projection(v_space);

    ELSIF p_action = 'update' THEN$new$
);
SELECT pg_temp.issue_4490_patch(
  'public.issue_4490_manage_space(text,uuid,jsonb,bigint)'::regprocedure,
  $old$      WHERE id = v_space.id
      RETURNING * INTO v_space;
      RETURN public.issue_4490_space_projection(v_space);

    ELSIF p_action = 'archive' THEN$old$,
  $new$      WHERE id = v_space.id
      RETURNING * INTO v_space;
      IF v_payload ? 'layouts' THEN
        DELETE FROM public.venue_space_layouts WHERE space_id = v_space.id;
        INSERT INTO public.venue_space_layouts (space_id, layout, capacity)
        SELECT v_space.id, l->>'layout', (l->>'capacity')::integer
        FROM jsonb_array_elements(v_layouts) l;
      END IF;
      RETURN public.issue_4490_space_projection(v_space);

    ELSIF p_action = 'archive' THEN$new$
);

CREATE OR REPLACE FUNCTION public.issue_4490_space_projection(p_space public.venue_spaces)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = ''
AS $function$
  SELECT jsonb_build_object(
    'id', p_space.id, 'venue_id', p_space.venue_id, 'name', p_space.name,
    'setting', p_space.setting, 'capacity_standing', p_space.capacity_standing,
    'capacity_seated', p_space.capacity_seated, 'photos', p_space.photos,
    'plan_shape', p_space.plan_shape, 'plan_background_url', p_space.plan_background_url,
    'sort_order', p_space.sort_order, 'is_active', p_space.is_active,
    'archived_at', p_space.archived_at, 'can_be_hired', p_space.can_be_hired,
    'step_free', p_space.step_free, 'amenities', to_jsonb(p_space.amenities),
    'layouts', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'layout', l.layout, 'capacity', l.capacity) ORDER BY l.layout)
      FROM public.venue_space_layouts l WHERE l.space_id = p_space.id), '[]'::jsonb),
    'version', p_space.version, 'updated_at', p_space.updated_at
  );
$function$;

-- Hire authoring stores the guest-selectable layout list on the offer.
SELECT pg_temp.issue_4490_patch(
  'public.issue_4490_manage_hire(text,uuid,jsonb,bigint,text)'::regprocedure,
  $old$  IF p_action NOT IN ('set_spaces', 'set_price_row', 'set_sessions', 'set_terms', 'set_booking', 'set_flexible', 'set_extras')$old$,
  $new$  IF p_action NOT IN ('set_spaces', 'set_price_row', 'set_sessions', 'set_terms', 'set_booking', 'set_flexible', 'set_extras', 'set_layouts')$new$
);
SELECT pg_temp.issue_4490_patch(
  'public.issue_4490_manage_hire(text,uuid,jsonb,bigint,text)'::regprocedure,
  $old$  v_step integer;
  v_extras jsonb;
BEGIN$old$,
  $new$  v_step integer;
  v_extras jsonb;
  v_layouts text[];
BEGIN$new$
);
SELECT pg_temp.issue_4490_patch(
  'public.issue_4490_manage_hire(text,uuid,jsonb,bigint,text)'::regprocedure,
  $old$  ELSIF p_action = 'set_extras' THEN$old$,
  $new$  ELSIF p_action = 'set_layouts' THEN
    IF jsonb_typeof(COALESCE(p_payload->'layouts', '[]'::jsonb)) <> 'array'
       OR jsonb_array_length(COALESCE(p_payload->'layouts', '[]'::jsonb)) > 7
       OR EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(p_payload->'layouts', '[]'::jsonb)) l
                  WHERE jsonb_typeof(l) <> 'string'
                     OR (l #>> '{}') NOT IN ('standing','seated','banquet','theatre','classroom','cabaret','boardroom'))
       OR (SELECT count(DISTINCT l #>> '{}') FROM jsonb_array_elements(COALESCE(p_payload->'layouts', '[]'::jsonb)) l)
          <> jsonb_array_length(COALESCE(p_payload->'layouts', '[]'::jsonb)) THEN
      RAISE EXCEPTION 'hire_layouts_invalid' USING ERRCODE = '22023';
    END IF;
    SELECT CASE WHEN count(*) = 0 THEN NULL ELSE array_agg(l #>> '{}' ORDER BY ord) END
    INTO v_layouts
    FROM jsonb_array_elements(COALESCE(p_payload->'layouts', '[]'::jsonb)) WITH ORDINALITY AS x(l, ord);
    UPDATE public.stay_offerings
    SET layouts = v_layouts, version = version + 1, updated_at = now(), updated_by = v_uid
    WHERE id = v_offer.id RETURNING * INTO v_offer;

  ELSIF p_action = 'set_extras' THEN$new$
);

-- Current cumulative hire read plus the offered layouts and each price row's
-- exact capacity in every offered layout.
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
    'layouts', to_jsonb(COALESCE(o.layouts, '{}'::text[])),
    'spaces', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id', s.id, 'name', s.name, 'setting', s.setting,
      'capacityStanding', s.capacity_standing, 'capacitySeated', s.capacity_seated,
      'capacity', public.issue_4490_space_capacity(s.id)) ORDER BY s.sort_order, s.name)
      FROM public.venue_offer_spaces os JOIN public.venue_spaces s ON s.id = os.space_id
      WHERE os.offering_id = o.id), '[]'::jsonb),
    'combinations', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id', c.id, 'name', c.name, 'spaceIds', to_jsonb(c.space_ids),
      'capacity', (SELECT COALESCE(sum(public.issue_4490_space_capacity(p)), 0) FROM unnest(c.space_ids) p)) ORDER BY c.name)
      FROM public.venue_space_combinations c
      WHERE c.id = ANY(o.hire_combination_ids) AND c.archived_at IS NULL), '[]'::jsonb),
    'rows', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'optionId', opt.id, 'name', opt.name, 'unit', opt.unit,
      'spaceId', opt.space_id, 'combinationId', opt.combination_id,
      'placeName', public.issue_4490_option_place_name(opt.id),
      'capacity', public.issue_4490_option_capacity(opt.id),
      'layoutCapacities', COALESCE((SELECT jsonb_object_agg(layout, public.issue_4490_option_layout_capacity(opt.id, layout))
                                   FROM unnest(COALESCE(o.layouts, '{}'::text[])) layout), '{}'::jsonb),
      'guestMin', opt.guest_min, 'guestMax', opt.guest_max,
      'weekdays', to_jsonb(opt.weekdays), 'priceMinor', price.amount_minor) ORDER BY opt.sort_order, opt.created_at)
      FROM public.venue_offer_price_options opt
      LEFT JOIN public.stay_price_versions price ON price.price_option_id = opt.id
        AND price.offering_id = opt.offering_id AND price.effective_to IS NULL
      WHERE opt.offering_id = o.id AND opt.status = 'active'), '[]'::jsonb),
    'sessions', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'ruleId', r.id, 'label', r.session_label,
      'startTime', to_char(r.local_start_time, 'HH24:MI'), 'endTime', to_char(r.local_end_time, 'HH24:MI'),
      'pastMidnight', r.local_end_time <= r.local_start_time,
      'minutes', r.slot_duration_minutes, 'weekdays', to_jsonb(r.weekdays),
      'startDate', r.local_start_date, 'endDate', r.local_end_date) ORDER BY r.local_start_time, r.session_label)
      FROM public.stay_place_schedule_rules r
      WHERE r.offering_id = o.id AND r.active AND r.mode = 'repeating_windows'), '[]'::jsonb),
    'hoursYouSet', (SELECT jsonb_build_object('ruleId', r.id, 'weekdays', to_jsonb(r.weekdays),
      'startTime', to_char(r.local_start_time, 'HH24:MI'), 'endTime', to_char(r.local_end_time, 'HH24:MI'),
      'pastMidnight', r.local_end_time <= r.local_start_time,
      'minMinutes', o.booking_length_min_minutes, 'maxMinutes', o.booking_length_max_minutes,
      'stepMinutes', COALESCE(o.booking_length_step_minutes, 60))
      FROM public.stay_place_schedule_rules r WHERE r.offering_id = o.id AND r.active AND r.mode = 'flexible'
      ORDER BY r.created_at DESC LIMIT 1),
    'damageDepositReleaseDays', COALESCE(s.damage_deposit_release_days, 7),
    'setupMinutes', o.buffer_before_minutes, 'cleanupMinutes', o.buffer_after_minutes,
    'damageDepositMinor', o.damage_deposit_minor, 'minSpendMinor', o.min_spend_minor,
    'extraGuestMinor', o.extra_guest_minor, 'overtimeMinorPerHour', o.overtime_minor_per_hour,
    'requestResponseHours', COALESCE(s.request_response_hours, 48),
    'approvedPaymentMinutes', COALESCE(s.approved_payment_minutes, 4320)
  ) END
  FROM public.stay_offerings o
  LEFT JOIN public.venue_booking_settings s ON s.venue_id = o.venue_id
  WHERE o.id = p_offering_id;
$function$;

-- A listed layout must exist on every atomic space used by every active row.
SELECT pg_temp.issue_4490_patch(
  'public.issue_4490_offer_readiness(uuid)'::regprocedure,
  $old$  IF v_offer.kind = 'by_the_hour' THEN$old$,
  $new$  IF v_offer.kind IN ('private_hire', 'group_package') AND cardinality(COALESCE(v_offer.layouts, '{}'::text[])) > 0
     AND EXISTS (
       SELECT 1 FROM public.venue_offer_price_options opt
       CROSS JOIN unnest(v_offer.layouts) layout
       WHERE opt.offering_id = v_offer.id AND opt.status = 'active'
         AND public.issue_4490_option_layout_capacity(opt.id, layout) IS NULL
     ) THEN
    v_reasons := v_reasons || 'layout_capacity_missing'::text;
  END IF;
  IF v_offer.kind = 'by_the_hour' THEN$new$
);

-- Hire quote: `layout` rides inside the one line, so the signature and request
-- hash remain unchanged.
SELECT pg_temp.issue_4490_patch(
  'public.issue_4490_quote_hire_internal(uuid,uuid,jsonb,text,uuid,text,jsonb,jsonb)'::regprocedure,
  $old$  v_minutes integer;
BEGIN$old$,
  $new$  v_minutes integer;
  v_layout text;
  v_layout_capacity integer;
BEGIN$new$
);
SELECT pg_temp.issue_4490_patch(
  'public.issue_4490_quote_hire_internal(uuid,uuid,jsonb,text,uuid,text,jsonb,jsonb)'::regprocedure,
  $old$     OR (v_item ? 'overtimeHours' AND (COALESCE(v_item->>'overtimeHours', '') !~ '^[0-9]{1,2}$'
         OR (v_item->>'overtimeHours')::integer > 12)) THEN$old$,
  $new$     OR (v_item ? 'overtimeHours' AND (COALESCE(v_item->>'overtimeHours', '') !~ '^[0-9]{1,2}$'
         OR (v_item->>'overtimeHours')::integer > 12))
     OR (v_item ? 'layout' AND (jsonb_typeof(v_item->'layout') <> 'string'
         OR COALESCE(v_item->>'layout', '') NOT IN ('standing','seated','banquet','theatre','classroom','cabaret','boardroom'))) THEN$new$
);
SELECT pg_temp.issue_4490_patch(
  'public.issue_4490_quote_hire_internal(uuid,uuid,jsonb,text,uuid,text,jsonb,jsonb)'::regprocedure,
  $old$  v_guests := (v_item->>'guests')::integer;$old$,
  $new$  v_guests := (v_item->>'guests')::integer;
  v_layout := NULLIF(v_item->>'layout', '');
  IF cardinality(COALESCE(v_offer.layouts, '{}'::text[])) > 0
     AND (v_layout IS NULL OR NOT (v_layout = ANY(v_offer.layouts))) THEN
    RAISE EXCEPTION 'offer_invalid_payload' USING ERRCODE = '22023';
  ELSIF cardinality(COALESCE(v_offer.layouts, '{}'::text[])) = 0 AND v_layout IS NOT NULL THEN
    RAISE EXCEPTION 'offer_invalid_payload' USING ERRCODE = '22023';
  END IF;
  v_layout_capacity := CASE WHEN v_layout IS NULL THEN NULL
    ELSE public.issue_4490_option_layout_capacity(v_option.id, v_layout) END;
  IF v_layout IS NOT NULL AND v_layout_capacity IS NULL THEN
    RAISE EXCEPTION 'offer_option_unavailable' USING ERRCODE = 'P0002';
  END IF;
  $new$
);
SELECT pg_temp.issue_4490_patch(
  'public.issue_4490_quote_hire_internal(uuid,uuid,jsonb,text,uuid,text,jsonb,jsonb)'::regprocedure,
  $old$  v_max := CASE WHEN v_offer.extra_guest_minor IS NOT NULL THEN v_cap ELSE v_option.guest_max END;$old$,
  $new$  v_cap := COALESCE(v_layout_capacity, public.issue_4490_option_capacity(v_option.id));
  IF v_layout IS NOT NULL AND v_guests > v_cap THEN
    RAISE EXCEPTION 'offer_group_too_big' USING ERRCODE = '22023',
      DETAIL = jsonb_build_object('placeName', public.issue_4490_option_place_name(v_option.id),
        'capacity', v_cap, 'layout', v_layout)::text;
  END IF;
  v_max := CASE WHEN v_offer.extra_guest_minor IS NOT NULL THEN v_cap ELSE LEAST(v_option.guest_max, v_cap) END;
  $new$
);
SELECT pg_temp.issue_4490_patch(
  'public.issue_4490_quote_hire_internal(uuid,uuid,jsonb,text,uuid,text,jsonb,jsonb)'::regprocedure,
  $old$      'spaceId', v_option.space_id, 'combinationId', v_option.combination_id,$old$,
  $new$      'spaceId', v_option.space_id, 'combinationId', v_option.combination_id,
      'layout', v_layout, 'layoutCapacity', v_layout_capacity,$new$
);
SELECT pg_temp.issue_4490_patch(
  'public.issue_4490_quote_hire_internal(uuid,uuid,jsonb,text,uuid,text,jsonb,jsonb)'::regprocedure,
  $old$      'placeName', public.issue_4490_option_place_name(v_option.id),
      'spaceIds', to_jsonb(v_spaces),$old$,
  $new$      'placeName', public.issue_4490_option_place_name(v_option.id),
      'spaceIds', to_jsonb(v_spaces),
      'layout', v_layout, 'layoutCapacity', v_layout_capacity,$new$
);

-- Group packages have at most one canonical layout; enforce it when present.
SELECT pg_temp.issue_4490_patch(
  'public.issue_4490_quote_offer_internal(uuid,uuid,jsonb,text,uuid,text,boolean,jsonb,jsonb)'::regprocedure,
  $old$  v_answers jsonb := '{}'::jsonb;
BEGIN$old$,
  $new$  v_answers jsonb := '{}'::jsonb;
  v_layout text;
  v_layout_capacity integer;
BEGIN$new$
);
SELECT pg_temp.issue_4490_patch(
  'public.issue_4490_quote_offer_internal(uuid,uuid,jsonb,text,uuid,text,boolean,jsonb,jsonb)'::regprocedure,
  $old$    IF v_guests < v_option.guest_min OR v_guests > v_option.guest_max THEN
      RAISE EXCEPTION 'offer_guests_out_of_range' USING ERRCODE = '22023';
    END IF;
    SELECT * INTO v_price$old$,
  $new$    IF v_guests < v_option.guest_min OR v_guests > v_option.guest_max THEN
      RAISE EXCEPTION 'offer_guests_out_of_range' USING ERRCODE = '22023';
    END IF;
    IF v_offer.kind = 'group_package' AND cardinality(COALESCE(v_offer.layouts, '{}'::text[])) = 1 THEN
      v_layout := v_offer.layouts[1];
      v_layout_capacity := public.issue_4490_option_layout_capacity(v_option.id, v_layout);
      IF v_layout_capacity IS NULL THEN
        RAISE EXCEPTION 'offer_option_unavailable' USING ERRCODE = 'P0002';
      END IF;
      IF v_guests > v_layout_capacity THEN
        RAISE EXCEPTION 'offer_group_too_big' USING ERRCODE = '22023',
          DETAIL = jsonb_build_object('placeName', public.issue_4490_option_place_name(v_option.id),
            'capacity', v_layout_capacity, 'layout', v_layout)::text;
      END IF;
    END IF;
    SELECT * INTO v_price$new$
);
SELECT pg_temp.issue_4490_patch(
  'public.issue_4490_quote_offer_internal(uuid,uuid,jsonb,text,uuid,text,boolean,jsonb,jsonb)'::regprocedure,
  $old$        'packageMinor', v_base - v_extras_minor,
        'extras', v_extras,$old$,
  $new$        'packageMinor', v_base - v_extras_minor,
        'layout', v_layout, 'layoutCapacity', v_layout_capacity,
        'extras', v_extras,$new$
);

-- The immutable booking facts and the host request list read the snapshot.
CREATE OR REPLACE FUNCTION public.issue_4490_hire_booking_facts(p_group_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT CASE WHEN g.offer_kind <> 'private_hire' THEN NULL ELSE jsonb_strip_nulls(jsonb_build_object(
    'placeName', l.price_snapshot->>'placeName', 'spaceIds', l.price_snapshot->'spaceIds',
    'combinationId', l.price_snapshot->'combinationId',
    'layout', l.price_snapshot->>'layout',
    'layoutCapacity', (l.price_snapshot->>'layoutCapacity')::integer,
    'sessionLabel', l.offering_snapshot->>'sessionLabel',
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
    'occasion', g.booking_answers->>'occasion', 'note', g.booking_answers->>'note',
    'siteVisit', (g.booking_answers->>'siteVisit')::boolean,
    'replyWithinHours', (g.payment_plan_snapshot->>'requestResponseHours')::integer,
    'declineReason', (SELECT e.safe_metadata->>'reason' FROM public.stay_reservation_events e
      WHERE e.group_id = g.id AND e.event_type = 'stay_offer_request_declined' ORDER BY e.created_at DESC LIMIT 1),
    'alternatives', (SELECT e.safe_metadata->'alternatives' FROM public.stay_reservation_events e
      WHERE e.group_id = g.id AND e.event_type = 'stay_offer_request_declined' ORDER BY e.created_at DESC LIMIT 1),
    'hostNote', (SELECT e.safe_metadata->>'note' FROM public.stay_reservation_events e
      WHERE e.group_id = g.id AND e.event_type = 'stay_offer_request_approved' ORDER BY e.created_at DESC LIMIT 1),
    'closedReason', public.issue_4490_closed_reason(g.id)
  )) END
  FROM public.stay_reservation_groups g
  JOIN LATERAL (SELECT * FROM public.stay_reservation_lines l2 WHERE l2.group_id = g.id
    ORDER BY l2.created_at, l2.id LIMIT 1) l ON true
  LEFT JOIN public.stay_quote_lines q ON q.id = l.quote_line_id
  LEFT JOIN LATERAL (SELECT min(lower(c.booked_range)) AS booked_from, max(upper(c.booked_range)) AS booked_to,
    min(lower(c.claim_range)) AS claim_from, max(upper(c.claim_range)) AS claim_to
    FROM public.venue_space_claims c WHERE c.group_id = g.id AND c.state IN ('held', 'committed')
    HAVING count(*) > 0) ac ON true
  WHERE g.id = p_group_id;
$function$;

SELECT pg_temp.issue_4490_patch(
  'public.issue_4490_requests_list(uuid,text)'::regprocedure,
  $old$          'placeName', r.price_snapshot->>'placeName', 'spaceIds', r.price_snapshot->'spaceIds',$old$,
  $new$          'placeName', r.price_snapshot->>'placeName', 'spaceIds', r.price_snapshot->'spaceIds',
          'layout', r.price_snapshot->>'layout',
          'layoutCapacity', (r.price_snapshot->>'layoutCapacity')::integer,$new$
);

DROP FUNCTION pg_temp.issue_4490_patch(regprocedure, text, text);

REVOKE ALL ON FUNCTION
  public.issue_4490_layouts_valid(text[], text),
  public.issue_4490_space_layout_capacity(uuid, text),
  public.issue_4490_option_layout_capacity(uuid, text)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
  public.issue_4490_space_layout_capacity(uuid, text),
  public.issue_4490_option_layout_capacity(uuid, text)
TO service_role;

COMMIT;
