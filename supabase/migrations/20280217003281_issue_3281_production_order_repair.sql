-- issue #3281 — keep newer production function bodies when older migrations apply.
--
-- Production took these migrations out of file order. Applying the pending
-- files now would run each CREATE OR REPLACE after a newer definition that is
-- already live, which a clean replay in file order can never show:
--   20271026003801 over biz_update_live_experience from 20271123003281
--     (capacity_scope and price_options handling)
--   20271217003281 over pg_notify_reminders_enqueue from 20271218054063
--     (#4063 reminder window and message payloads)
-- This migration runs after all of them and restores both terminal bodies
-- byte for byte, so file order and production order reach the same definitions.
-- The finalizer needs no re-emit here: 20280216003282 is its terminal body, and
-- the verify block refuses to finish if that file has not run first.
--
-- Also re-emits issue_3872_ticket_quote, the one checkout reader that still
-- ignored byDate: it multiplied the summed quantity by every chosen day, so an
-- uneven cart quoted more than create-session would mint.

BEGIN;

CREATE OR REPLACE FUNCTION public.biz_update_live_experience(p_event_id uuid, p_payload jsonb, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  -- issue #3827 buyer email [H0 notice-declare]
  v_notice jsonb;
  v_user_id          uuid;
  v_existing         public.events%ROWTYPE;
  v_brand            record;
  v_now              timestamptz := now();
  v_trimmed_reason   text;
  v_total_sold       int;
  -- header / modes
  v_title            text;
  v_description      text;
  v_intents          text[];
  v_intent           text;
  v_currency         char(3);
  v_location_mode    text;
  v_pricing_mode     text;
  v_is_free          boolean;
  v_capacity         integer;
  v_whole_price      integer;
  v_resolved_total   integer;
  v_old_resolved     integer;
  -- stops
  v_stops            jsonb;
  v_stop_count       integer;
  v_stop             jsonb;
  v_existing_stop_keys text[];
  v_new_stop_keys    text[];
  v_dropped_stops    text[];
  -- single-mode shared place
  v_shared_place_id     text;
  v_shared_place_addr   text;
  v_shared_city         text;
  v_shared_region       text;
  v_shared_country      text;
  v_shared_lat          double precision;
  v_shared_lng          double precision;
  v_idx              integer;
  v_s_place_id       text;
  v_s_address        text;
  v_s_city           text;
  v_s_region         text;
  v_s_country        text;
  v_s_lat            double precision;
  v_s_lng            double precision;
  v_s_images         text[];
  v_s_start          time;
  v_s_price          integer;
  -- dates
  v_when_mode        text;
  v_when             jsonb;
  v_multi_dates      jsonb;
  v_recurrence_rules jsonb;
  v_timezone         text;
  v_date_iso         text;
  v_doors            text;
  v_ends             text;
  v_start            timestamptz;
  v_end              timestamptz;
  v_date_entry       jsonb;
  v_min_start        timestamptz;
  v_is_recurring     boolean;
  v_is_multi_date    boolean;
  v_next_occurrence  timestamptz;
  v_new_date_starts  timestamptz[];
  v_old_date_starts  timestamptz[];
  v_old_date_ends    timestamptz[];
  v_new_date_ends    timestamptz[];
  v_max_end          timestamptz; -- ORCH-1075: latest end_at across edited dates
  v_dates_changed    boolean := false;
  -- audit
  v_severity         text;
  v_changed_keys     text[];
  v_log_id           uuid;
  v_affected_order_ids uuid[];
  -- return
  v_event            public.events%ROWTYPE;
  v_stop_rows        jsonb;
  v_ticket_rows      jsonb;
  v_event_dates_rows jsonb;
  -- issue #3281 1c — reconcile-in-place scratch
  v_stop_id          uuid;
  v_keep_stop_orders integer[] := '{}'::integer[];
  v_stop_order       integer;
  v_date_id          uuid;
  v_keep_date_ids    uuid[] := '{}'::uuid[];
  v_hold             text;
  v_master_id        uuid;
  v_existing_master_start timestamptz;
  v_existing_master_end   timestamptz;
  v_seed_unchanged   boolean := false;
BEGIN
  -- ---------- 1. Auth + reason ----------
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  v_trimmed_reason := btrim(COALESCE(p_reason, ''));
  IF v_trimmed_reason = '' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'missing_edit_reason');
  END IF;
  IF char_length(v_trimmed_reason) < 10 OR char_length(v_trimmed_reason) > 200 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_edit_reason');
  END IF;

  -- ---------- 2. Load + permission + status gate ----------
  SELECT * INTO v_existing
  FROM public.events
  WHERE id = p_event_id
    AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'experience_not_found';
  END IF;

  IF v_existing.event_type <> 'experience' THEN
    RAISE EXCEPTION 'event_not_an_experience'
      USING HINT = 'biz_update_live_experience only handles event_type=experience rows.';
  END IF;

  IF v_existing.status NOT IN ('scheduled', 'live') THEN
    -- Draft edits NEVER route here; non-live statuses are rejected so the live
    -- guards can never trip a draft.
    RETURN jsonb_build_object('ok', false, 'reason', 'experience_not_editable_status');
  END IF;

  IF public.biz_brand_effective_rank(v_existing.brand_id, v_user_id)
       < public.biz_role_rank('event_manager'::text) THEN
    RAISE EXCEPTION 'insufficient_event_permission';
  END IF;

  SELECT id, slug, name, default_currency
  INTO v_brand
  FROM public.brands
  WHERE id = v_existing.brand_id
    AND deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'brand_not_found';
  END IF;

  -- ---------- 3. Sold-count context ----------
  v_total_sold := public.biz_experience_sold_count(p_event_id);

  -- ---------- 4. Parse payload (mirror biz_publish_experience) ----------
  v_title := NULLIF(btrim(COALESCE(p_payload->>'title', '')), '');
  IF v_title IS NULL THEN
    RAISE EXCEPTION 'experience_title_required';
  END IF;
  v_description := NULLIF(btrim(COALESCE(p_payload->>'description', '')), '');
  IF v_description IS NULL OR char_length(v_description) < 10 OR char_length(v_description) > 500 THEN
    RAISE EXCEPTION 'experience_description_invalid';
  END IF;

  -- META-ORCH-1059 Sub-E FIX (live-edit dropped the vibe): persist curated
  -- experience_intents on edit, mirroring biz_publish_experience. The wizard
  -- sends p_payload->'experience_intents' (1-4 of the 4 brand ids); validate +
  -- require >=1 so a live/published experience stays deck-eligible. Key absent
  -- => leave existing intents unchanged.
  IF jsonb_typeof(p_payload->'experience_intents') = 'array' THEN
    SELECT array_agg(DISTINCT btrim(elem))
      INTO v_intents
      FROM jsonb_array_elements_text(p_payload->'experience_intents') AS elem
     WHERE btrim(elem) <> '';
  ELSIF p_payload ? 'experience_intent'
        AND NULLIF(btrim(p_payload->>'experience_intent'), '') IS NOT NULL THEN
    v_intents := ARRAY[btrim(p_payload->>'experience_intent')];
  ELSE
    v_intents := v_existing.experience_intents;
  END IF;
  IF v_intents IS NOT NULL
     AND NOT (v_intents <@ ARRAY['adventurous','first-date','romantic','group-fun']::text[]) THEN
    RAISE EXCEPTION 'experience_intent_invalid';
  END IF;
  IF v_intents IS NULL OR array_length(v_intents, 1) IS NULL THEN
    RAISE EXCEPTION 'experience_intent_required';
  END IF;
  v_intent := v_intents[1];

  v_currency := upper(COALESCE(
    NULLIF(p_payload->>'currency', ''),
    NULLIF(v_existing.currency, '')::text,
    v_brand.default_currency::text,
    'USD'
  ))::char(3);

  v_location_mode := COALESCE(NULLIF(p_payload->>'location_mode', ''), 'single');
  v_pricing_mode  := COALESCE(NULLIF(p_payload->>'pricing_mode', ''), 'whole');
  IF v_location_mode NOT IN ('single','per_stop') OR v_pricing_mode NOT IN ('whole','per_stop') THEN
    RAISE EXCEPTION 'invalid_mode';
  END IF;

  v_is_free  := COALESCE((p_payload->>'is_free')::boolean, false);
  v_capacity := NULLIF(p_payload->>'capacity', '')::integer;
  v_whole_price := COALESCE(NULLIF(p_payload->>'whole_price_cents', '')::integer, 0);

  v_stops := COALESCE(p_payload->'stops', '[]'::jsonb);
  IF jsonb_typeof(v_stops) IS DISTINCT FROM 'array' THEN
    v_stops := '[]'::jsonb;
  END IF;
  v_stop_count := jsonb_array_length(v_stops);

  -- Live experiences are published: enforce the same 2–5 stop gate.
  IF v_stop_count < 1 OR v_stop_count > 5 THEN
    RAISE EXCEPTION 'experience_stop_count_invalid';
  END IF;

  FOR v_stop IN SELECT value FROM jsonb_array_elements(v_stops)
  LOOP
    IF NULLIF(btrim(COALESCE(v_stop->>'place_name', '')), '') IS NULL THEN
      RAISE EXCEPTION 'stop_name_required';
    END IF;
    IF (v_stop->'image_urls') IS NOT NULL
       AND jsonb_typeof(v_stop->'image_urls') = 'array'
       AND jsonb_array_length(v_stop->'image_urls') > 5 THEN
      RAISE EXCEPTION 'stop_too_many_images';
    END IF;
    IF COALESCE((v_stop->>'price_cents')::integer, 0) < 0 THEN
      RAISE EXCEPTION 'experience_price_invalid';
    END IF;
  END LOOP;

  -- Resolve the new ONE-ticket total (I-1).
  v_resolved_total :=
    CASE
      WHEN v_is_free THEN 0
      WHEN v_pricing_mode = 'whole' THEN v_whole_price
      ELSE (
        SELECT COALESCE(sum(COALESCE((s->>'price_cents')::integer, 0)), 0)
        FROM jsonb_array_elements(v_stops) s
      )
    END;

  -- ---------- 5. REFUND-GATE (only when sold > 0, except capacity) ----------

  -- 5a. Capacity floor: lifetime for total; busiest day for per_day;
  -- busiest slot (incl. holds) for per_start.
  IF (p_payload ? 'capacity') AND v_capacity IS NOT NULL THEN
    IF COALESCE(
         NULLIF(p_payload->>'capacity_scope', ''),
         NULLIF(p_payload->>'capacityScope', ''),
         (SELECT capacity_scope FROM public.events WHERE id = p_event_id),
         'total'
       ) = 'total' THEN
      IF v_capacity < v_total_sold THEN
        RETURN jsonb_build_object(
          'ok', false,
          'reason', 'capacity_below_sold',
          'affected_order_count', v_total_sold
        );
      END IF;
    ELSIF COALESCE(
         NULLIF(p_payload->>'capacity_scope', ''),
         NULLIF(p_payload->>'capacityScope', ''),
         (SELECT capacity_scope FROM public.events WHERE id = p_event_id),
         'total'
       ) = 'per_start' THEN
      IF v_capacity < COALESCE((
        SELECT MAX(public.issue_3281_ticket_type_slot_taken(
                 tt.id, d.id, gs,
                 gs + make_interval(mins => COALESCE(e.booking_spacing_minutes, 30)),
                 NULL
               ))
          FROM public.events e
          CROSS JOIN public.ticket_types tt
          CROSS JOIN public.event_dates d
          CROSS JOIN LATERAL generate_series(
            d.start_at,
            d.end_at - interval '1 microsecond',
            make_interval(mins => COALESCE(e.booking_spacing_minutes, 30))
          ) AS gs
         WHERE e.id = p_event_id
           AND tt.event_id = p_event_id
           AND tt.deleted_at IS NULL
           AND d.event_id = p_event_id
      ), 0) THEN
        RETURN jsonb_build_object(
          'ok', false,
          'reason', 'capacity_below_sold',
          'affected_order_count', v_total_sold
        );
      END IF;
    ELSE
      IF v_capacity < COALESCE((
        SELECT MAX(public.issue_3313_ticket_type_occurrence_taken(tt.id, d.id))
          FROM public.ticket_types tt
          CROSS JOIN public.event_dates d
         WHERE tt.event_id = p_event_id
           AND tt.deleted_at IS NULL
           AND d.event_id = p_event_id
      ), 0) THEN
        RETURN jsonb_build_object(
          'ok', false,
          'reason', 'capacity_below_sold',
          'affected_order_count', v_total_sold
        );
      END IF;
    END IF;
  END IF;

  IF v_total_sold > 0 THEN
    -- 5b. Price lock — the ONE ticket's resolved price can't change once sold.
    SELECT price_cents INTO v_old_resolved
    FROM public.ticket_types
    WHERE event_id = p_event_id AND deleted_at IS NULL
    ORDER BY display_order ASC
    LIMIT 1;
    v_old_resolved := COALESCE(v_old_resolved, 0);

    IF v_resolved_total IS DISTINCT FROM v_old_resolved THEN
      RETURN jsonb_build_object(
        'ok', false,
        'reason', 'price_change_with_sales',
        'affected_order_count', v_total_sold
      );
    END IF;

    -- 5c. Stop removal — removing an existing (by name) stop is destructive.
    SELECT array_agg(lower(btrim(place_name)))
      INTO v_existing_stop_keys
      FROM public.experience_stops
      WHERE event_id = p_event_id;
    v_existing_stop_keys := COALESCE(v_existing_stop_keys, '{}'::text[]);

    SELECT array_agg(lower(btrim(s->>'place_name')))
      INTO v_new_stop_keys
      FROM jsonb_array_elements(v_stops) s;
    v_new_stop_keys := COALESCE(v_new_stop_keys, '{}'::text[]);

    v_dropped_stops := (
      SELECT COALESCE(array_agg(k), '{}'::text[])
      FROM unnest(v_existing_stop_keys) k
      WHERE NOT (k = ANY (v_new_stop_keys))
    );

    IF array_length(v_dropped_stops, 1) > 0 THEN
      RETURN jsonb_build_object(
        'ok', false,
        'reason', 'stop_removed_with_sales',
        'affected_order_count', v_total_sold,
        'dropped_stops', to_jsonb(v_dropped_stops)
      );
    END IF;
  END IF;

  -- ---------- 6. Resolve the date model + date-shift gate ----------
  v_when_mode := COALESCE(NULLIF(p_payload->>'whenMode', ''), 'single');
  v_when := p_payload->'when';
  v_multi_dates := p_payload->'multiDates';
  v_recurrence_rules := p_payload->'recurrence_rules';
  v_timezone := COALESCE(NULLIF(p_payload->>'timezone', ''), NULLIF(v_existing.timezone, ''), 'UTC');
  v_is_recurring  := (v_when_mode = 'recurring');
  v_is_multi_date := (v_when_mode = 'multi_date');

  -- ORCH-1153 WS1 SEED-HARDENING (F-4). A stale client seed can send a recurring
  -- whenMode but a NULL recurrence_rules (e.g. firstRecurrenceRule returned null
  -- on an unexpected jsonb shape). Below, date reconcile + expand only run when
  -- recurrence_rules IS NOT NULL — so a dropped rule would leave the series
  -- without fresh children. Re-derive the rule from the PERSISTED
  -- events.recurrence_rules rather than draining the series. Net: a live-edit
  -- that omits the rule can never silently drain a recurring series.
  IF v_is_recurring
     AND v_recurrence_rules IS NULL
     AND v_existing.is_recurring = true
     AND v_existing.recurrence_rules IS NOT NULL THEN
    v_recurrence_rules := v_existing.recurrence_rules;
  END IF;

  IF v_when_mode NOT IN ('single','multi_date','recurring') THEN
    RAISE EXCEPTION 'event_date_required';
  END IF;

  -- Build the proposed occurrence start/end arrays (sorted by start).
  IF v_when_mode IN ('single','recurring') THEN
    v_date_iso := NULLIF(v_when->>'date', '');
    IF v_date_iso IS NULL THEN
      RAISE EXCEPTION 'event_date_required';
    END IF;
    v_doors := COALESCE(NULLIF(v_when->>'doorsOpen', ''), '00:00');
    v_ends  := COALESCE(NULLIF(v_when->>'endsAt', ''), v_doors);
    v_start := (v_date_iso || ' ' || v_doors || ':00')::timestamp AT TIME ZONE v_timezone;
    v_end   := (v_date_iso || ' ' || v_ends  || ':00')::timestamp AT TIME ZONE v_timezone;
    IF v_end <= v_start THEN
      v_end := v_end + INTERVAL '1 day';
    END IF;
    v_new_date_starts := ARRAY[v_start];
    v_new_date_ends   := ARRAY[v_end];
  ELSE
    IF v_multi_dates IS NULL
       OR jsonb_typeof(v_multi_dates) IS DISTINCT FROM 'array'
       OR jsonb_array_length(v_multi_dates) = 0 THEN
      RAISE EXCEPTION 'event_date_required';
    END IF;
    v_new_date_starts := '{}'::timestamptz[];
    v_new_date_ends := '{}'::timestamptz[];
    FOR v_date_entry IN
      SELECT value FROM jsonb_array_elements(v_multi_dates)
      ORDER BY (value->>'date'), (value->>'startTime')
    LOOP
      v_date_iso := NULLIF(v_date_entry->>'date', '');
      IF v_date_iso IS NULL THEN
        RAISE EXCEPTION 'event_date_required';
      END IF;
      v_doors := COALESCE(NULLIF(v_date_entry->>'startTime', ''), '00:00');
      v_ends  := COALESCE(NULLIF(v_date_entry->>'endTime', ''), v_doors);
      v_start := (v_date_iso || ' ' || v_doors || ':00')::timestamp AT TIME ZONE v_timezone;
      v_end   := (v_date_iso || ' ' || v_ends  || ':00')::timestamp AT TIME ZONE v_timezone;
      IF v_end <= v_start THEN
        v_end := v_end + INTERVAL '1 day';
      END IF;
      v_new_date_starts := v_new_date_starts || v_start;
      v_new_date_ends := v_new_date_ends || v_end;
    END LOOP;
  END IF;


  -- ORCH-1075 paid-publish integrity guards (experience live-edit) --------
  -- Q3: block ANY resulting PAID state while not Stripe-ready (free->paid AND
  -- paid->paid), and block shifting onto an already-past date. Structured
  -- return shape matches this RPC. FREE edits are exempt.
  --   Stripe charges_enabled: https://docs.stripe.com/api/accounts/object
  --   Finish onboarding:      https://docs.stripe.com/connect/onboarding.md
  IF NOT v_is_free AND v_resolved_total > 0 THEN
    IF NOT public.pg_brand_can_collect(v_brand.id) THEN
      -- TRANSITIONAL wire alias; remove only under cleanup issue #1922:
      -- https://github.com/Mingla-LLC/mingla-main/issues/1922
      RETURN jsonb_build_object('ok', false, 'reason', 'stripe_charges_disabled');
    END IF;
    SELECT max(d) INTO v_max_end FROM unnest(v_new_date_ends) AS d;
    IF v_max_end IS NULL OR v_max_end <= v_now THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'offering_date_past');
    END IF;
  END IF;

  -- Date-shift gate (only with sales). Compare against current event_dates.
  -- issue #3281 1c: for recurring, only the master seed is in the payload; expanded
  -- children must not count as a shift on a title/price-neutral live edit.
  IF v_total_sold > 0 THEN
    IF v_when_mode = 'recurring' THEN
      SELECT array_agg(start_at ORDER BY start_at), array_agg(end_at ORDER BY start_at)
        INTO v_old_date_starts, v_old_date_ends
        FROM public.event_dates
        WHERE event_id = p_event_id AND is_master = true;
    ELSE
      SELECT array_agg(start_at ORDER BY start_at), array_agg(end_at ORDER BY start_at)
        INTO v_old_date_starts, v_old_date_ends
        FROM public.event_dates
        WHERE event_id = p_event_id;
    END IF;
    v_old_date_starts := COALESCE(v_old_date_starts, '{}'::timestamptz[]);
    v_old_date_ends   := COALESCE(v_old_date_ends, '{}'::timestamptz[]);

    IF COALESCE(array_length(v_old_date_starts, 1), 0)
         IS DISTINCT FROM COALESCE(array_length(v_new_date_starts, 1), 0) THEN
      v_dates_changed := true;
    ELSE
      FOR v_idx IN 1 .. COALESCE(array_length(v_old_date_starts, 1), 0)
      LOOP
        IF v_old_date_starts[v_idx] IS DISTINCT FROM v_new_date_starts[v_idx]
           OR v_old_date_ends[v_idx] IS DISTINCT FROM v_new_date_ends[v_idx] THEN
          v_dates_changed := true;
          EXIT;
        END IF;
      END LOOP;
    END IF;

    IF v_dates_changed THEN
      RETURN jsonb_build_object(
        'ok', false,
        'reason', 'dates_shifted_with_sales',
        'affected_order_count', v_total_sold,
        'dropped_dates', (
          SELECT COALESCE(jsonb_agg(to_char(d AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')), '[]'::jsonb)
          FROM unnest(v_old_date_starts) d
        )
      );
    END IF;
  END IF;

  -- ---------- 7. APPLY (all gates passed) ----------
  IF v_location_mode = 'single' AND v_stop_count > 0 THEN
    v_shared_place_id   := NULLIF(v_stops->0->>'place_id', '');
    v_shared_place_addr := NULLIF(v_stops->0->>'address', '');
    v_shared_city       := NULLIF(v_stops->0->>'city', '');
    v_shared_region     := NULLIF(v_stops->0->>'region', '');
    v_shared_country    := NULLIF(v_stops->0->>'country_code', '');
    v_shared_lat        := NULLIF(v_stops->0->>'lat', '')::double precision;
    v_shared_lng        := NULLIF(v_stops->0->>'lng', '')::double precision;
  END IF;

  UPDATE public.events SET
    title             = v_title,
    description       = v_description,
    experience_intents = v_intents,
    experience_intent  = v_intent,
    currency          = v_currency,
    timezone          = v_timezone,
    location_mode     = v_location_mode,
    pricing_mode      = v_pricing_mode,
    whole_price_cents = CASE WHEN v_pricing_mode = 'whole' THEN v_resolved_total ELSE NULL END,
    is_recurring      = v_is_recurring,
    is_multi_date     = v_is_multi_date,
    recurrence_rules  = v_recurrence_rules,
    pass_tax          = CASE WHEN (p_payload ? 'pass_tax') THEN (p_payload->>'pass_tax')::boolean ELSE pass_tax END,
    pass_mingla_fee   = CASE WHEN (p_payload ? 'pass_mingla_fee') THEN (p_payload->>'pass_mingla_fee')::boolean ELSE pass_mingla_fee END,
    pass_service_fee  = CASE WHEN (p_payload ? 'pass_service_fee') THEN (p_payload->>'pass_service_fee')::boolean ELSE pass_service_fee END,
    theme             = jsonb_set(
                          COALESCE(theme, '{}'::jsonb),
                          '{experience_meta,venue_text}',
                          to_jsonb(COALESCE(NULLIF(v_stops->0->>'address', ''), '')),
                          true
                        ),
    updated_at        = v_now
  WHERE id = p_event_id;

  -- issue #3281 1c — reconcile experience_stops in place (match by stop_order).
  -- Kept ids matter for R2/R3 per-stop address choice; never DELETE+reinsert.
  v_idx := 0;
  v_keep_stop_orders := '{}'::integer[];
  FOR v_stop IN SELECT value FROM jsonb_array_elements(v_stops)
  LOOP
    IF v_location_mode = 'single' THEN
      v_s_place_id := v_shared_place_id;
      v_s_address  := v_shared_place_addr;
      v_s_city     := v_shared_city;
      v_s_region   := v_shared_region;
      v_s_country  := v_shared_country;
      v_s_lat      := v_shared_lat;
      v_s_lng      := v_shared_lng;
    ELSE
      v_s_place_id := NULLIF(v_stop->>'place_id', '');
      v_s_address  := NULLIF(v_stop->>'address', '');
      v_s_city     := NULLIF(v_stop->>'city', '');
      v_s_region   := NULLIF(v_stop->>'region', '');
      v_s_country  := NULLIF(v_stop->>'country_code', '');
      v_s_lat      := NULLIF(v_stop->>'lat', '')::double precision;
      v_s_lng      := NULLIF(v_stop->>'lng', '')::double precision;
    END IF;

    v_s_images := COALESCE(
      (SELECT array_agg(value::text)
       FROM jsonb_array_elements_text(
         CASE WHEN jsonb_typeof(v_stop->'image_urls') = 'array'
              THEN v_stop->'image_urls' ELSE '[]'::jsonb END)),
      ARRAY[]::text[]
    );
    v_s_start := NULLIF(v_stop->>'start_time', '')::time;
    v_s_price := CASE WHEN v_pricing_mode = 'whole' THEN 0
                      ELSE COALESCE((v_stop->>'price_cents')::integer, 0) END;
    v_stop_order := COALESCE((v_stop->>'stop_order')::integer, v_idx);

    UPDATE public.experience_stops SET
      place_id     = v_s_place_id,
      place_name   = btrim(v_stop->>'place_name'),
      address      = COALESCE(v_s_address, ''),
      city         = v_s_city,
      region       = v_s_region,
      country_code = v_s_country,
      lat          = v_s_lat,
      lng          = v_s_lng,
      image_urls   = v_s_images,
      start_time   = v_s_start,
      price_cents  = v_s_price,
      ai_description = COALESCE(NULLIF(v_stop->>'ai_description', ''), '')
    WHERE event_id = p_event_id AND stop_order = v_stop_order
    RETURNING id INTO v_stop_id;

    IF v_stop_id IS NULL THEN
      INSERT INTO public.experience_stops (
        event_id, stop_order, place_id, place_name, address,
        city, region, country_code, lat, lng,
        image_urls, start_time, price_cents, ai_description
      ) VALUES (
        p_event_id,
        v_stop_order,
        v_s_place_id,
        btrim(v_stop->>'place_name'),
        COALESCE(v_s_address, ''),
        v_s_city, v_s_region, v_s_country, v_s_lat, v_s_lng,
        v_s_images, v_s_start, v_s_price,
        COALESCE(NULLIF(v_stop->>'ai_description', ''), '')
      );
    END IF;

    v_keep_stop_orders := v_keep_stop_orders || v_stop_order;
    v_stop_id := NULL;
    v_idx := v_idx + 1;
  END LOOP;

  DELETE FROM public.experience_stops
   WHERE event_id = p_event_id
     AND NOT (stop_order = ANY (v_keep_stop_orders));

  -- Rewrite the ONE ticket (I-1). Preserve identity by UPDATEing the live ticket
  -- in place (so existing order_line_items.ticket_type_id stays valid) rather
  -- than soft-delete + insert.
  -- Ticket types — legacy Standard OR price_options (#3281 R2)
  -- Refuse option rewrite when sales exist and payload names price_options
  -- with a unit/price change; additive-only live edits omit price_options and
  -- keep the existing Standard row update below via the helper's sales guard.
  IF p_payload ? 'price_options' THEN
    PERFORM public.issue_3281_apply_experience_price_options(
      p_event_id,
      v_currency,
      v_pricing_mode,
      v_resolved_total,
      v_capacity,
      p_payload->'price_options',
      (v_total_sold > 0)
    );
  ELSE
    -- Omission: never flatten multi-option experiences. Legacy single-ticket
    -- experiences still get the Standard in-place update.
    IF (SELECT count(*) FROM public.ticket_types
         WHERE event_id = p_event_id AND deleted_at IS NULL) <= 1 THEN
      UPDATE public.ticket_types SET
        name           = 'Standard',
        price_cents    = v_resolved_total,
        currency       = v_currency,
        quantity_total = CASE WHEN v_capacity IS NULL OR v_capacity <= 0 THEN NULL ELSE v_capacity END,
        is_unlimited   = (v_capacity IS NULL OR v_capacity <= 0),
        is_free        = (v_resolved_total = 0),
        updated_at     = v_now
      WHERE event_id = p_event_id
        AND deleted_at IS NULL;
    ELSE
      UPDATE public.ticket_types SET
        currency       = v_currency,
        quantity_total = CASE WHEN v_capacity IS NULL OR v_capacity <= 0 THEN NULL ELSE v_capacity END,
        is_unlimited   = (v_capacity IS NULL OR v_capacity <= 0),
        updated_at     = v_now
      WHERE event_id = p_event_id
        AND deleted_at IS NULL;
    END IF;
  END IF;

  -- issue #3281 1c — reconcile event_dates in place (match by start_at; P3 for
  -- single/recurring one-occurrence moves). Held rows never deleted
  -- (issue_3285_event_date_hold_reason). Recurring children survive when the
  -- master seed is unchanged; the expander skips existing starts.
  v_min_start := NULL;
  FOR v_idx IN 1 .. COALESCE(array_length(v_new_date_starts, 1), 0)
  LOOP
    IF v_min_start IS NULL OR v_new_date_starts[v_idx] < v_min_start THEN
      v_min_start := v_new_date_starts[v_idx];
    END IF;
  END LOOP;

  SELECT ed.start_at, ed.end_at INTO v_existing_master_start, v_existing_master_end
    FROM public.event_dates ed
   WHERE ed.event_id = p_event_id AND ed.is_master = true
   ORDER BY ed.start_at, ed.id
   LIMIT 1;
  v_seed_unchanged := (
    v_when_mode = 'recurring'
    AND v_existing_master_start IS NOT DISTINCT FROM v_start
    AND v_existing_master_end IS NOT DISTINCT FROM v_end
  );

  v_keep_date_ids := '{}'::uuid[];
  FOR v_idx IN 1 .. COALESCE(array_length(v_new_date_starts, 1), 0)
  LOOP
    v_date_id := NULL;
    SELECT ed.id INTO v_date_id
      FROM public.event_dates ed
     WHERE ed.event_id = p_event_id
       AND ed.start_at = v_new_date_starts[v_idx]
       AND NOT (ed.id = ANY (v_keep_date_ids))
     ORDER BY ed.id
     LIMIT 1;

    -- P3: a single/recurring experience's one seed occurrence keeps its id when
    -- its start moves (unsold path only; sold shifts are gated above).
    IF v_date_id IS NULL
       AND v_when_mode IN ('single', 'recurring')
       AND COALESCE(array_length(v_new_date_starts, 1), 0) = 1 THEN
      SELECT ed.id INTO v_date_id
        FROM public.event_dates ed
       WHERE ed.event_id = p_event_id
         AND ed.is_master = true
         AND NOT (ed.id = ANY (v_keep_date_ids))
       ORDER BY ed.start_at, ed.id
       LIMIT 1;
      IF v_date_id IS NULL THEN
        SELECT ed.id INTO v_date_id
          FROM public.event_dates ed
         WHERE ed.event_id = p_event_id
           AND NOT (ed.id = ANY (v_keep_date_ids))
         ORDER BY ed.start_at, ed.id
         LIMIT 1;
      END IF;
    END IF;

    IF v_date_id IS NOT NULL THEN
      UPDATE public.event_dates
         SET start_at = v_new_date_starts[v_idx],
             end_at = v_new_date_ends[v_idx],
             timezone = v_timezone
       WHERE id = v_date_id
         AND (start_at, end_at, timezone) IS DISTINCT FROM
             (v_new_date_starts[v_idx], v_new_date_ends[v_idx], v_timezone);
      v_keep_date_ids := v_keep_date_ids || v_date_id;
    ELSE
      INSERT INTO public.event_dates (event_id, start_at, end_at, timezone, is_master)
      VALUES (
        p_event_id, v_new_date_starts[v_idx], v_new_date_ends[v_idx], v_timezone,
        v_new_date_starts[v_idx] = v_min_start
      )
      RETURNING id INTO v_date_id;
      v_keep_date_ids := v_keep_date_ids || v_date_id;
    END IF;
  END LOOP;

  -- Recurring children: keep when the master seed is unchanged.
  IF v_seed_unchanged THEN
    SELECT COALESCE(v_keep_date_ids, '{}'::uuid[])
           || COALESCE(array_agg(ed.id), '{}'::uuid[])
      INTO v_keep_date_ids
      FROM public.event_dates ed
     WHERE ed.event_id = p_event_id
       AND ed.is_master = false
       AND NOT (ed.id = ANY (COALESCE(v_keep_date_ids, '{}'::uuid[])));
  END IF;

  -- Remove only unheld rows that are not in the keep set.
  FOR v_date_id IN
    SELECT ed.id FROM public.event_dates ed
     WHERE ed.event_id = p_event_id
       AND NOT (ed.id = ANY (v_keep_date_ids))
  LOOP
    v_hold := public.issue_3285_event_date_hold_reason(v_date_id);
    IF v_hold IS NOT NULL THEN
      RAISE EXCEPTION 'multi_date_remove_with_sales'
        USING DETAIL = format('issue #3281: occurrence %s is held (%s)', v_date_id, v_hold);
    END IF;
    DELETE FROM public.ticket_event_dates ted
     USING public.tickets t
     WHERE t.id = ted.ticket_id
       AND ted.event_date_id = v_date_id
       AND t.status NOT IN ('valid', 'used', 'transferred', 'refund_pending');
    DELETE FROM public.event_dates WHERE id = v_date_id;
  END LOOP;

  -- Exactly one master = the earliest occurrence.
  SELECT ed.id INTO v_master_id
    FROM public.event_dates ed
   WHERE ed.event_id = p_event_id
   ORDER BY ed.start_at, ed.id
   LIMIT 1;
  UPDATE public.event_dates
     SET is_master = false
   WHERE event_id = p_event_id
     AND is_master
     AND id IS DISTINCT FROM v_master_id;
  IF v_master_id IS NOT NULL THEN
    UPDATE public.event_dates SET is_master = true WHERE id = v_master_id AND NOT is_master;
  END IF;

  v_next_occurrence := v_min_start;

  -- ORCH-1138 Leg 3 (§4.6) — RECURRENCE MATERIALISATION on live-edit. Seed
  -- row(s) are reconciled above; for a `recurring` rule, expand the 2nd..Nth
  -- bookable occurrences (bounded 52-cap). The expander skips starts that
  -- already exist so surviving date ids stay put. I-4 preserved.
  IF v_when_mode = 'recurring' AND v_recurrence_rules IS NOT NULL THEN
    PERFORM public.pg_expand_experience_recurrence(
      p_event_id, v_start, v_end, v_recurrence_rules, v_timezone
    );

    -- ORCH-1153 WS1 live-edit DRAIN GUARD (I-PROPOSED-1153-NO-DRAIN). After
    -- re-materialisation a recurring experience must never have zero future
    -- occurrences (unless the rule is count-exhausted / until-expired). Blocks a
    -- live-edit that would shift the master into the past with a non-productive
    -- rule. count/until series whose window legitimately closed are EXEMPT.
    IF NOT EXISTS (
          SELECT 1 FROM public.event_dates ed
          WHERE ed.event_id = p_event_id AND ed.start_at > v_now
        )
       AND NOT public.pg_recurrence_is_terminated(v_recurrence_rules, p_event_id, v_now)
    THEN
      RAISE EXCEPTION 'recurring_experience_has_no_future_occurrences';
    END IF;
  END IF;

  IF v_next_occurrence IS NOT NULL THEN
    UPDATE public.events
    SET theme = jsonb_set(
          COALESCE(theme, '{}'::jsonb),
          '{experience_meta,next_occurrence_at}',
          to_jsonb(to_char(v_next_occurrence AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')),
          true
        ),
        updated_at = v_now
    WHERE id = p_event_id;
  END IF;

  -- ---------- 8. Audit log ----------
  v_changed_keys := ARRAY(SELECT jsonb_object_keys(p_payload));

  IF (p_payload ? 'capacity' OR p_payload ? 'stops' OR p_payload ? 'whenMode'
      OR p_payload ? 'whole_price_cents' OR p_payload ? 'pricing_mode') THEN
    v_severity := 'material';
  ELSE
    v_severity := 'additive';
  END IF;

  SELECT COALESCE(array_agg(id), '{}'::uuid[])
    INTO v_affected_order_ids
    FROM public.orders
    WHERE event_id = p_event_id
      AND payment_status NOT IN ('failed', 'cancelled');

  INSERT INTO public.experience_edit_log
    (event_id, brand_id, edited_by, reason, severity,
     changed_field_keys, diff_summary, affected_order_ids, occurred_at)
  VALUES (
    p_event_id,
    v_existing.brand_id,
    v_user_id,
    v_trimmed_reason,
    v_severity,
    v_changed_keys,
    jsonb_build_object('changed_keys', to_jsonb(v_changed_keys)),
    v_affected_order_ids,
    v_now
  ) RETURNING id INTO v_log_id;

  -- issue #3827 buyer email [H1 notice-flush]
  v_notice := public.event_edit_notice_flush(p_event_id, v_trimmed_reason, 'experience', false);

  -- ---------- 9. Return payload (mirror biz_publish_experience shape) ----------
  SELECT * INTO v_event FROM public.events WHERE id = p_event_id;

  SELECT COALESCE(jsonb_agg(to_jsonb(es) ORDER BY es.stop_order), '[]'::jsonb)
  INTO v_stop_rows
  FROM public.experience_stops es
  WHERE es.event_id = p_event_id;

  SELECT COALESCE(jsonb_agg(to_jsonb(tt) ORDER BY tt.display_order), '[]'::jsonb)
  INTO v_ticket_rows
  FROM public.ticket_types tt
  WHERE tt.event_id = p_event_id
    AND tt.deleted_at IS NULL;

  SELECT COALESCE(jsonb_agg(to_jsonb(ed) ORDER BY ed.start_at), '[]'::jsonb)
  INTO v_event_dates_rows
  FROM public.event_dates ed
  WHERE ed.event_id = p_event_id;

    -- issue #3281 R3 — spacing / notice / capacity_scope / stop offsets
  PERFORM public.issue_3281_apply_experience_r3_settings(p_event_id, p_payload);

RETURN jsonb_build_object(
    'ok', true,
    'edit_log_entry_id', v_log_id,
    'severity', v_severity,
    'changed_keys', to_jsonb(v_changed_keys),
    'affected_order_count', COALESCE(array_length(v_affected_order_ids, 1), 0),
    'event', to_jsonb(v_event),
    'brand', jsonb_build_object('id', v_brand.id, 'slug', v_brand.slug, 'name', v_brand.name),
    'stops', v_stop_rows,
    'ticket', (v_ticket_rows->0),
    'tickets', v_ticket_rows,
    'eventDates', v_event_dates_rows,
    -- issue #3827 buyer email [H2 notice-result]
    'buyer_notice', v_notice
  );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.pg_notify_reminders_enqueue(
  p_lead_hours int,
  p_lead_bucket text,
  p_window_minutes int DEFAULT 30
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_low timestamptz;
  v_high timestamptz;
  -- Kept as a declaration for the #1210 compatibility probe. The caller's
  -- p_window_minutes value is deprecated and intentionally ignored.
  v_half_mins integer := NULL;
  v_inserted integer := 0;
  v_n integer;
BEGIN
  IF p_lead_bucket NOT IN ('24h', '2h') THEN
    RAISE EXCEPTION 'pg_notify_reminders_enqueue: invalid lead bucket %', p_lead_bucket;
  END IF;
  IF p_lead_hours IS NULL OR p_lead_hours <= 0 THEN
    RAISE EXCEPTION 'pg_notify_reminders_enqueue: lead hours must be positive (got %)', p_lead_hours;
  END IF;

  v_low := now() + make_interval(hours => p_lead_hours) - interval '7 minutes';
  v_high := now() + make_interval(hours => p_lead_hours) + interval '3 minutes';

  WITH upcoming AS (
    SELECT
      o.id AS order_id,
      o.event_id,
      o.buyer_user_id,
      COALESCE(o.buyer_phone_e164, o.buyer_email) AS contact,
      e.brand_id,
      e.event_type AS kind,
      e.title AS event_title,
      o.booked_start_at AS start_at,
      NULL::uuid AS event_date_id,
      e.timezone,
      e.location_text,
      NULL::text AS override_title,
      NULL::text AS override_location
    FROM public.orders AS o
    JOIN public.events AS e ON e.id = o.event_id
    WHERE e.event_type = 'experience'
      AND o.booked_start_at IS NOT NULL
      AND o.booked_start_at >= v_low
      AND o.booked_start_at < v_high
      AND e.deleted_at IS NULL
      AND e.status IN ('scheduled', 'live')
      AND o.payment_status IN ('paid', 'partial_refund')
      AND EXISTS (
        SELECT 1
          FROM public.tickets AS valid_ticket
         WHERE valid_ticket.order_id = o.id
           AND valid_ticket.status = 'valid'
      )
      AND (
        o.buyer_user_id IS NOT NULL
        OR o.buyer_email IS NOT NULL
        OR o.buyer_phone_e164 IS NOT NULL
      )

    UNION ALL

    SELECT
      o.id AS order_id,
      o.event_id,
      o.buyer_user_id,
      COALESCE(o.buyer_phone_e164, o.buyer_email) AS contact,
      e.brand_id,
      e.event_type AS kind,
      e.title AS event_title,
      bought_date.start_at,
      bought_date.event_date_id,
      COALESCE(bought_date.timezone, e.timezone) AS timezone,
      e.location_text,
      bought_date.override_title,
      bought_date.override_location
    FROM public.orders AS o
    JOIN public.events AS e ON e.id = o.event_id
    JOIN LATERAL (
      WITH candidates AS (
        SELECT DISTINCT
          date.id AS event_date_id,
          date.start_at,
          date.timezone,
          date.override_title,
          date.override_location,
          1 AS precedence
        FROM public.tickets AS ticket
        JOIN public.ticket_event_dates AS admitted
          ON admitted.ticket_id = ticket.id
        JOIN public.event_dates AS date
          ON date.id = admitted.event_date_id
         AND date.event_id = o.event_id
        WHERE ticket.order_id = o.id
          AND ticket.status = 'valid'

        UNION ALL

        SELECT
          date.id,
          date.start_at,
          date.timezone,
          date.override_title,
          date.override_location,
          2 AS precedence
        FROM public.event_dates AS date
        WHERE date.id = o.event_date_id
          AND date.event_id = o.event_id

        UNION ALL

        SELECT
          date.id,
          date.start_at,
          date.timezone,
          date.override_title,
          date.override_location,
          3 AS precedence
        FROM public.event_dates AS date
        WHERE date.event_id = o.event_id
          AND date.is_master
      )
      SELECT DISTINCT ON (candidate.event_date_id)
        candidate.event_date_id,
        candidate.start_at,
        candidate.timezone,
        candidate.override_title,
        candidate.override_location
      FROM candidates AS candidate
      WHERE candidate.precedence = (
        SELECT min(other_candidate.precedence) FROM candidates AS other_candidate
      )
      ORDER BY candidate.event_date_id, candidate.start_at
    ) AS bought_date ON true
    WHERE e.event_type <> 'experience'
      AND bought_date.start_at >= v_low
      AND bought_date.start_at < v_high
      AND e.deleted_at IS NULL
      AND e.status IN ('scheduled', 'live')
      AND o.payment_status IN ('paid', 'partial_refund')
      AND EXISTS (
        SELECT 1
          FROM public.tickets AS valid_ticket
         WHERE valid_ticket.order_id = o.id
           AND valid_ticket.status = 'valid'
      )
      AND (
        o.buyer_user_id IS NOT NULL
        OR o.buyer_email IS NOT NULL
        OR o.buyer_phone_e164 IS NOT NULL
      )
  ), inserted AS (
    INSERT INTO public.notification_outbox (
      category_key, user_id, contact, brand_id, payload,
      idempotency_key, country_code
    )
    SELECT
      'buyer_event_reminder',
      u.buyer_user_id,
      u.contact,
      u.brand_id,
      jsonb_strip_nulls(jsonb_build_object(
        'order_id', u.order_id,
        'event_id', u.event_id,
        'event_date_id', u.event_date_id,
        'kind', u.kind,
        'event_title', u.event_title,
        'reserved_for', u.start_at,
        'timezone', u.timezone,
        'location_text', u.location_text,
        'claimed', u.buyer_user_id IS NOT NULL,
        'lead_bucket', p_lead_bucket,
        -- Preserve the #3281 per-date override payload while adding the v2 shape.
        'date_title', u.override_title,
        'date_location', u.override_location
      )),
      'buyer_event_reminder:' || u.order_id::text || ':'
        || COALESCE(u.event_date_id::text, 'booked') || ':'
        || p_lead_bucket,
      public.mingla_e164_country(u.contact)
    FROM upcoming AS u
    WHERE NOT EXISTS (
      SELECT 1
        FROM public.notification_outbox AS prior
       WHERE prior.idempotency_key =
         'buyer_event_reminder:' || u.order_id::text || ':' || p_lead_bucket
         AND prior.created_at >= now() - interval '26 hours'
    )
    ON CONFLICT (idempotency_key) DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO v_n FROM inserted;
  v_inserted := v_inserted + COALESCE(v_n, 0);

  WITH upcoming AS (
    SELECT
      reservation.id AS reservation_id,
      reservation.consumer_user_id AS buyer_user_id,
      COALESCE(reservation.guest_phone_e164, reservation.guest_email) AS contact,
      reservation.brand_id,
      reservation.venue_id,
      reservation.reserved_for,
      reservation.party_size,
      reservation.guest_name,
      venue.name AS venue_name,
      CASE
        WHEN availability.iana_timezone_source IN ('derived', 'operator')
          THEN availability.iana_timezone
        ELSE NULL
      END AS timezone
    FROM public.reservations AS reservation
    LEFT JOIN public.venue_listings AS venue
      ON venue.id = reservation.venue_id
    LEFT JOIN public.venue_availability_config AS availability
      ON availability.venue_id = reservation.venue_id
    WHERE reservation.reserved_for >= v_low
      AND reservation.reserved_for < v_high
      AND reservation.status = 'confirmed'
      AND (
        reservation.consumer_user_id IS NOT NULL
        OR reservation.guest_email IS NOT NULL
        OR reservation.guest_phone_e164 IS NOT NULL
      )
  ), inserted AS (
    INSERT INTO public.notification_outbox (
      category_key, user_id, contact, brand_id, payload,
      idempotency_key, country_code
    )
    SELECT
      'buyer_reservation_reminder',
      u.buyer_user_id,
      u.contact,
      u.brand_id,
      jsonb_strip_nulls(jsonb_build_object(
        'reservation_id', u.reservation_id,
        'reserved_for', u.reserved_for,
        'party_size', u.party_size,
        'guest_name', u.guest_name,
        'lead_bucket', p_lead_bucket,
        'venue_id', u.venue_id,
        'venue_name', u.venue_name,
        'timezone', u.timezone,
        'claimed', u.buyer_user_id IS NOT NULL
      )),
      'buyer_reservation_reminder:' || u.reservation_id::text || ':'
        || p_lead_bucket,
      public.mingla_e164_country(u.contact)
    FROM upcoming AS u
    ON CONFLICT (idempotency_key) DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO v_n FROM inserted;
  v_inserted := v_inserted + COALESCE(v_n, 0);

  RETURN v_inserted;
END;
$function$;

REVOKE ALL ON FUNCTION public.pg_notify_reminders_enqueue(int, text, int)
  FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.pg_notify_reminders_enqueue(int, text, int)
  FROM anon;
GRANT EXECUTE ON FUNCTION public.pg_notify_reminders_enqueue(int, text, int)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.pg_notify_reminders_enqueue(int, text, int) IS
  '#4063: five-minute reminder enqueue window. p_window_minutes is deprecated and ignored; retained for caller compatibility.';

CREATE OR REPLACE FUNCTION public.issue_2947_waitlist_drain_for_ticket_type(
  p_ticket_type_id uuid,
  p_freed integer
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_running integer := 0;
  v_entry record;
  v_notification_id uuid;
  v_email_notification_id uuid;
  v_sms_notification_id uuid;
  v_channel text;
  v_recipient text;
  v_phone text;
  v_event_date_id uuid;
  v_start_at timestamptz;
  v_timezone text;
  v_payload jsonb;
  v_v2 boolean := public.issue_4063_switch_on('messages_v2');
BEGIN
  IF p_ticket_type_id IS NULL OR p_freed IS NULL OR p_freed < 1 THEN
    RETURN 0;
  END IF;

  FOR v_entry IN
    SELECT id, event_id, ticket_type_id, email, phone, qty_requested
      FROM public.waitlist_entries
     WHERE ticket_type_id = p_ticket_type_id
       AND status = 'waiting'
       AND notified_at IS NULL
     ORDER BY created_at ASC, id ASC
  LOOP
    EXIT WHEN v_running >= p_freed;

    IF NOT v_v2 THEN
      -- Preserve the exact pre-#4063 one-row producer while the switch is off.
      IF v_entry.email IS NOT NULL AND length(btrim(v_entry.email)) > 0 THEN
        v_channel := 'email';
        v_recipient := v_entry.email;
      ELSIF v_entry.phone IS NOT NULL AND length(btrim(v_entry.phone)) > 0 THEN
        v_channel := 'sms';
        v_recipient := v_entry.phone;
      ELSE
        CONTINUE;
      END IF;

      v_notification_id := NULL;
      INSERT INTO public.ticket_order_notifications
        (order_id, event_id, channel, recipient, status, payload,
         idempotency_key, attempt_count)
      VALUES
        (NULL, v_entry.event_id, v_channel, v_recipient, 'pending',
         jsonb_build_object(
           'template_key', 'waitlist_spot_open',
           'waitlist_entry_id', v_entry.id,
           'event_id', v_entry.event_id,
           'ticket_type_id', v_entry.ticket_type_id,
           'qty_requested', v_entry.qty_requested,
           'invite_expires_at', (now() + interval '24 hours')
         ),
         'waitlist_invite:' || v_entry.id::text,
         0)
      ON CONFLICT (idempotency_key) DO NOTHING
      RETURNING id INTO v_notification_id;
    ELSE
      SELECT date.id, date.start_at, COALESCE(date.timezone, event.timezone)
        INTO v_event_date_id, v_start_at, v_timezone
        FROM public.events AS event
        LEFT JOIN LATERAL (
          SELECT event_date.id, event_date.start_at, event_date.timezone
            FROM public.event_dates AS event_date
           WHERE event_date.event_id = event.id
           ORDER BY event_date.is_master DESC, event_date.start_at, event_date.id
           LIMIT 1
        ) AS date ON true
       WHERE event.id = v_entry.event_id;

      v_payload := jsonb_strip_nulls(jsonb_build_object(
        'template_key', 'waitlist_spot_open',
        'waitlist_entry_id', v_entry.id,
        'event_id', v_entry.event_id,
        'ticket_type_id', v_entry.ticket_type_id,
        'qty_requested', v_entry.qty_requested,
        'invite_expires_at', (now() + interval '24 hours'),
        'event_date_id', v_event_date_id,
        'timezone', v_timezone,
        'start_at', v_start_at
      ));

      v_email_notification_id := NULL;
      v_sms_notification_id := NULL;
      v_phone := public.mingla_e164_normalize(v_entry.phone);

      IF nullif(btrim(coalesce(v_entry.email, '')), '') IS NOT NULL THEN
        INSERT INTO public.ticket_order_notifications
          (order_id, event_id, channel, recipient, status, payload,
           idempotency_key, attempt_count)
        VALUES
          (NULL, v_entry.event_id, 'email', lower(btrim(v_entry.email)), 'pending',
           v_payload,
           'waitlist_invite:' || v_entry.id::text || ':email',
           0)
        ON CONFLICT (idempotency_key) DO NOTHING
        RETURNING id INTO v_email_notification_id;

        IF v_email_notification_id IS NULL THEN
          SELECT notification.id INTO v_email_notification_id
            FROM public.ticket_order_notifications AS notification
           WHERE notification.idempotency_key =
             'waitlist_invite:' || v_entry.id::text || ':email';
        END IF;
      END IF;

      IF v_phone IS NOT NULL THEN
        INSERT INTO public.ticket_order_notifications
          (order_id, event_id, channel, recipient, status, payload,
           idempotency_key, attempt_count)
        VALUES
          (NULL, v_entry.event_id, 'sms', v_phone, 'pending',
           v_payload || jsonb_build_object('channel_hint', 'sms'),
           'waitlist_invite:' || v_entry.id::text || ':sms',
           0)
        ON CONFLICT (idempotency_key) DO NOTHING
        RETURNING id INTO v_sms_notification_id;

        IF v_sms_notification_id IS NULL THEN
          SELECT notification.id INTO v_sms_notification_id
            FROM public.ticket_order_notifications AS notification
           WHERE notification.idempotency_key =
             'waitlist_invite:' || v_entry.id::text || ':sms';
        END IF;
      END IF;

      v_notification_id := COALESCE(v_email_notification_id, v_sms_notification_id);
    END IF;

    IF v_notification_id IS NOT NULL THEN
      UPDATE public.waitlist_entries
         SET status = 'invited',
             invited_at = now(),
             notified_at = now(),
             notification_id = v_notification_id
       WHERE id = v_entry.id;
      v_running := v_running + v_entry.qty_requested;
    END IF;
  END LOOP;

  RETURN v_running;
END;
$function$;

COMMENT ON FUNCTION public.issue_2947_waitlist_drain_for_ticket_type(uuid, integer) IS
  '#2947/#4063: FIFO waitlist drain. messages_v2 emits independent email and normalized SMS rows with canonical occurrence facts; switch-off preserves the original one-row producer.';

REVOKE ALL ON FUNCTION public.issue_2947_waitlist_drain_for_ticket_type(uuid, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_2947_waitlist_drain_for_ticket_type(uuid, integer)
  TO service_role;

CREATE OR REPLACE FUNCTION public.fn_rsvp_drain_on_capacity_freed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_event_id uuid;
  v_capacity integer;
  v_approval_mode text;
  v_event_type text;
  v_confirmed integer;
  v_free integer;
  v_entry record;
  v_has_queue boolean;
  v_v2 boolean := public.issue_4063_switch_on('messages_v2');
BEGIN
  IF TG_TABLE_NAME = 'events' THEN
    v_event_id := NEW.id;
  ELSE
    v_event_id := NEW.event_id;
  END IF;

  SELECT event.event_type, event.rsvp_capacity, event.rsvp_approval_mode
    INTO v_event_type, v_capacity, v_approval_mode
    FROM public.events AS event
   WHERE event.id = v_event_id;

  IF v_event_type IS DISTINCT FROM 'rsvp' THEN RETURN NEW; END IF;
  IF v_capacity IS NULL THEN RETURN NEW; END IF;

  SELECT coalesce(sum(1 + rsvp.plus_count), 0)
    INTO v_confirmed
    FROM public.event_rsvps AS rsvp
   WHERE rsvp.event_id = v_event_id
     AND rsvp.rsvp_status = 'going'
     AND rsvp.approval_status = 'approved';

  v_free := v_capacity - v_confirmed;
  IF v_free <= 0 THEN RETURN NEW; END IF;

  SELECT EXISTS (
    SELECT 1
      FROM information_schema.tables
     WHERE table_schema = 'public'
       AND table_name = 'rsvp_notifications'
  ) INTO v_has_queue;

  FOR v_entry IN
    SELECT rsvp.id, rsvp.plus_count, rsvp.user_id
      FROM public.event_rsvps AS rsvp
     WHERE rsvp.event_id = v_event_id
       AND rsvp.rsvp_status = 'waitlisted'
     ORDER BY rsvp.waitlisted_at ASC NULLS FIRST, rsvp.created_at ASC
  LOOP
    EXIT WHEN v_free <= 0;

    IF v_approval_mode = 'manual' THEN
      UPDATE public.event_rsvps
         SET rsvp_status = 'going',
             approval_status = 'pending',
             promoted_at = now()
       WHERE id = v_entry.id;
    ELSE
      IF (1 + v_entry.plus_count) > v_free THEN
        EXIT;
      END IF;
      UPDATE public.event_rsvps
         SET rsvp_status = 'going',
             approval_status = 'approved',
             promoted_at = now()
       WHERE id = v_entry.id;
      v_free := v_free - (1 + v_entry.plus_count);
    END IF;

    IF v_has_queue
       AND (NOT v_v2 OR v_approval_mode <> 'manual') THEN
      -- Auto promotions keep the established promotion template. The v2
      -- renderer turns it into the on-the-list message; only manual/pending
      -- promotions become silent after the switch is enabled.
      INSERT INTO public.rsvp_notifications
        (event_id, rsvp_id, channel, recipient, status, template_key, payload,
         idempotency_key, attempt_count)
      VALUES
        (v_event_id, v_entry.id, NULL, NULL, 'pending', 'rsvp_waitlist_promoted',
         jsonb_build_object('template_key', 'rsvp_waitlist_promoted',
                            'rsvp_id', v_entry.id, 'event_id', v_event_id),
         'rsvp_promote:' || v_entry.id::text || ':' || extract(epoch FROM now())::bigint::text,
         0)
      ON CONFLICT (idempotency_key) DO NOTHING;
    END IF;
  END LOOP;

  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.fn_rsvp_drain_on_capacity_freed() IS
  '#1150/#4063: deterministic RSVP capacity drain. messages_v2 keeps auto promotion notices and makes manual promotions silent until host approval; switch-off preserves the legacy notice for both modes.';

REVOKE ALL ON FUNCTION public.fn_rsvp_drain_on_capacity_freed()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_rsvp_drain_on_capacity_freed()
  TO service_role;

CREATE OR REPLACE FUNCTION public.event_edit_notice_fanout(
  p_limit integer DEFAULT 20
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_due record;
  v_notice public.event_edit_notices%ROWTYPE;
  v_event record;
  v_allowlist_only boolean;
  v_recipient record;
  v_notification_id uuid;
  v_key text;
  v_index integer;
  v_held integer;
  v_recipients integer;
  v_no_email integer;
  v_notices integer := 0;
  v_rows integer := 0;
  v_v2 boolean := public.issue_4063_switch_on('messages_v2');
BEGIN
  v_allowlist_only := public.event_edit_notice_allowlist_only();

  DELETE FROM public.event_edit_notice_pending
   WHERE created_at < now() - interval '1 day';

  FOR v_due IN
    SELECT notice.id, notice.event_id
      FROM public.event_edit_notices AS notice
     WHERE notice.state = 'scheduled'
       AND notice.send_after <= now()
     ORDER BY notice.send_after
     LIMIT LEAST(GREATEST(coalesce(p_limit, 20), 1), 100)
  LOOP
    PERFORM 1 FROM public.events AS e WHERE e.id = v_due.event_id FOR KEY SHARE;
    PERFORM pg_advisory_xact_lock(
      hashtext('issue_3827_event_edit_notice'),
      hashtext(v_due.event_id::text)
    );
    SELECT * INTO v_notice
      FROM public.event_edit_notices AS notice
     WHERE notice.id = v_due.id
       AND notice.state = 'scheduled'
       AND notice.send_after <= now()
       FOR UPDATE SKIP LOCKED;
    IF NOT FOUND THEN
      CONTINUE;
    END IF;

    SELECT event.id, event.status, event.deleted_at, event.brand_id,
           event.event_type
      INTO v_event
      FROM public.events AS event
     WHERE event.id = v_notice.event_id;

    IF NOT public.event_edit_notice_brand_live(v_notice.brand_id) THEN
      UPDATE public.event_edit_notices
         SET state = 'held', hold_code = 'feature_off', send_after = NULL
       WHERE id = v_notice.id;
      IF v_event.event_type = 'rsvp' THEN
        PERFORM public.event_edit_notice_legacy_alert(v_notice.id, rsvp.id)
          FROM public.event_rsvps AS rsvp
         WHERE rsvp.event_id = v_notice.event_id
           AND rsvp.rsvp_status = 'going'
           AND rsvp.approval_status = 'approved';
      END IF;
      CONTINUE;
    END IF;
    IF v_event.id IS NULL
       OR v_event.status NOT IN ('scheduled', 'live')
       OR v_event.deleted_at IS NOT NULL THEN
      UPDATE public.event_edit_notices
         SET state = 'held', hold_code = 'event_not_live', send_after = NULL
       WHERE id = v_notice.id;
      CONTINUE;
    END IF;

    v_index := 0;
    v_held := 0;
    FOR v_recipient IN
      WITH buyer AS (
        SELECT *
          FROM public.business_event_buyer_rows(v_notice.event_id)
      ), order_contact AS (
        SELECT
          'o:' || orders.id::text AS group_key,
          lower(nullif(btrim(orders.buyer_email), '')) AS email,
          nullif(btrim(orders.buyer_name), '') AS name,
          CASE
            WHEN orders.buyer_phone_e164 ~ '^\+[1-9][0-9]{1,14}$'
              THEN orders.buyer_phone_e164
            ELSE NULL
          END AS phone,
          orders.buyer_user_id IS NOT NULL AS claimed
        FROM public.orders AS orders
        WHERE orders.event_id = v_notice.event_id
          AND orders.payment_status IN ('paid', 'partial_refund')
          AND orders.cancelled_at IS NULL
      ), by_email AS (
        SELECT
          lower(buyer.email) AS email,
          (array_agg(buyer.name ORDER BY buyer.source)
            FILTER (WHERE buyer.name IS NOT NULL))[1] AS name,
          (array_agg(buyer.rsvp_id)
            FILTER (WHERE buyer.rsvp_id IS NOT NULL))[1] AS rsvp_id,
          bool_or(coalesce(order_contact.claimed, false)) AS claimed
        FROM buyer
        LEFT JOIN order_contact
          ON order_contact.group_key = buyer.group_key
        WHERE buyer.email IS NOT NULL
        GROUP BY lower(buyer.email)
      ), by_phone AS (
        SELECT
          order_contact.phone,
          min(order_contact.name) AS name,
          min(order_contact.email) AS gate_email,
          bool_or(order_contact.claimed) AS claimed
        FROM order_contact
        WHERE order_contact.phone IS NOT NULL
        GROUP BY order_contact.phone
      )
      SELECT *
        FROM (
          SELECT email.email, email.name, email.rsvp_id,
                 NULL::text AS phone, NULL::boolean AS claimed,
                 NULL::text AS kind, email.email AS gate_email,
                 'email'::text AS delivery_kind
            FROM by_email AS email
           WHERE NOT v_v2
          UNION ALL
          SELECT NULL::text, buyer.name, buyer.rsvp_id,
                 NULL::text, NULL::boolean, NULL::text, NULL::text,
                 'rsvp'::text
            FROM buyer
           WHERE NOT v_v2
             AND buyer.email IS NULL
             AND buyer.rsvp_id IS NOT NULL
          UNION ALL
          SELECT email.email, email.name, email.rsvp_id,
                 NULL::text, email.claimed, v_event.event_type,
                 email.email, 'email'::text
            FROM by_email AS email
           WHERE v_v2
          UNION ALL
          SELECT NULL::text, buyer.name, buyer.rsvp_id,
                 NULL::text, NULL::boolean, NULL::text, NULL::text,
                 'rsvp'::text
            FROM buyer
           WHERE v_v2
             AND buyer.email IS NULL
             AND buyer.rsvp_id IS NOT NULL
          UNION ALL
          SELECT NULL::text, phone.name, NULL::uuid,
                 phone.phone, phone.claimed, v_event.event_type,
                 phone.gate_email, 'sms'::text
            FROM by_phone AS phone
           WHERE v_v2
        ) AS recipient
       ORDER BY recipient.email, recipient.rsvp_id, recipient.phone
    LOOP
      IF v_allowlist_only
         AND NOT public.event_edit_notice_on_allowlist(
           coalesce(v_recipient.email, v_recipient.gate_email)
         ) THEN
        v_held := v_held + 1;
        IF v_recipient.rsvp_id IS NOT NULL THEN
          PERFORM public.event_edit_notice_legacy_alert(
            v_notice.id,
            v_recipient.rsvp_id
          );
        END IF;
        CONTINUE;
      END IF;

      IF v_recipient.rsvp_id IS NOT NULL AND EXISTS (
        SELECT 1
          FROM public.rsvp_notifications AS legacy
         WHERE legacy.event_id = v_notice.event_id
           AND legacy.rsvp_id = v_recipient.rsvp_id
           AND legacy.template_key = 'rsvp_event_updated'
           AND NOT (legacy.payload ? 'noticeId')
           AND legacy.created_at >= v_notice.created_at - interval '1 second'
      ) THEN
        CONTINUE;
      END IF;

      v_notification_id := NULL;
      IF v_recipient.rsvp_id IS NOT NULL THEN
        v_key := 'event_edit:' || v_notice.id::text || ':'
          || coalesce(
            md5(v_recipient.email),
            'rsvp:' || v_recipient.rsvp_id::text
          );
        INSERT INTO public.rsvp_notifications
          (event_id, rsvp_id, channel, recipient, status, template_key,
           payload, idempotency_key, attempt_count)
        VALUES
          (v_notice.event_id, v_recipient.rsvp_id, NULL, NULL, 'pending',
           'rsvp_event_updated',
           jsonb_build_object(
             'template_key', 'rsvp_event_updated',
             'rsvp_id', v_recipient.rsvp_id,
             'event_id', v_notice.event_id,
             'noticeId', v_notice.id
           ),
           v_key, 0)
        ON CONFLICT (idempotency_key) DO NOTHING
        RETURNING id INTO v_notification_id;
      ELSE
        v_key := 'event_edit:' || v_notice.id::text || ':'
          || CASE
            WHEN v_recipient.delivery_kind = 'sms'
              THEN 'phone:' || md5(v_recipient.phone)
            ELSE md5(v_recipient.email)
          END;
        INSERT INTO public.rsvp_notifications
          (event_id, rsvp_id, channel, recipient, status, template_key,
           payload, idempotency_key, attempt_count)
        VALUES
          (v_notice.event_id, NULL, NULL, NULL, 'pending',
           'buyer_event_updated',
           jsonb_strip_nulls(jsonb_build_object(
             'template_key', 'buyer_event_updated',
             'event_id', v_notice.event_id,
             'noticeId', v_notice.id,
             'recipientEmail', v_recipient.email,
             'recipientPhone', v_recipient.phone,
             'recipientName', v_recipient.name,
             'claimed', v_recipient.claimed,
             'kind', v_recipient.kind
           )),
           v_key, 0)
        ON CONFLICT (idempotency_key) DO NOTHING
        RETURNING id INTO v_notification_id;
      END IF;

      IF v_notification_id IS NOT NULL THEN
        UPDATE public.rsvp_notification_deliveries
           SET next_attempt_at = now() + make_interval(mins => v_index / 40)
         WHERE notification_id = v_notification_id;
        v_index := v_index + 1;
        v_rows := v_rows + 1;
      END IF;
    END LOOP;

    SELECT audience.recipients, audience.no_email
      INTO v_recipients, v_no_email
      FROM public.event_edit_notice_audience(v_notice.event_id) AS audience;
    UPDATE public.event_edit_notices
       SET state = 'fanned_out',
           fanned_out_at = now(),
           send_after = NULL,
           audience_count = v_recipients + v_no_email,
           no_email_count = v_no_email,
           held_count = v_held,
           tested_at_fanout = v_allowlist_only
     WHERE id = v_notice.id;
    v_notices := v_notices + 1;
  END LOOP;

  RETURN jsonb_build_object('notices', v_notices, 'rows', v_rows);
END;
$function$;

COMMENT ON FUNCTION public.event_edit_notice_fanout(integer) IS
  '#3827/#4063: switch-safe edit fan-out. messages_v2 adds one phone-only buyer row per distinct paid-order handset plus claimed/kind payload facts; pilot and allowlist gates stay authoritative.';

REVOKE ALL ON FUNCTION public.event_edit_notice_fanout(integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.event_edit_notice_fanout(integer)
  TO service_role;

CREATE OR REPLACE FUNCTION public.orch_1161_reservation_notify_outbox()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_category text;
  v_contact text;
  v_base_key text;
  v_refund_cents integer;
  v_refund_currency text;
  v_v2 boolean := public.issue_4063_switch_on('messages_v2');
  v_payload jsonb;
  v_venue_name text;
  v_venue_address text;
  v_venue_city text;
  v_timezone text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'confirmed' THEN
      RETURN NEW;
    END IF;
    v_category := 'buyer_reservation_confirmed';
    v_base_key := 'buyer_reservation_confirmed:' || NEW.id::text;
  ELSE
    IF NOT v_v2 THEN
      -- Preserve the exact pre-#4063 trigger guard while the switch is off.
      IF NEW.status IS NOT DISTINCT FROM OLD.status
         AND NEW.table_id IS NOT DISTINCT FROM OLD.table_id
         AND NEW.reserved_for IS NOT DISTINCT FROM OLD.reserved_for THEN
        RETURN NEW;
      END IF;
    ELSIF NEW.status IS NOT DISTINCT FROM OLD.status
       AND NEW.table_id IS NOT DISTINCT FROM OLD.table_id
       AND NEW.reserved_for IS NOT DISTINCT FROM OLD.reserved_for
       AND NEW.party_size IS NOT DISTINCT FROM OLD.party_size THEN
      RETURN NEW;
    END IF;

    IF NEW.status IN ('cancelled_by_guest','cancelled_by_venue')
       AND NEW.status IS DISTINCT FROM OLD.status THEN
      v_category := 'buyer_reservation_cancelled';
    ELSIF NEW.status = 'confirmed' AND OLD.status = 'requested' THEN
      v_category := 'buyer_reservation_confirmed';
    ELSIF NOT v_v2 THEN
      v_category := 'buyer_reservation_changed';
    ELSIF NEW.status NOT IN ('cancelled_by_guest','cancelled_by_venue')
       AND (
         NEW.reserved_for IS DISTINCT FROM OLD.reserved_for
         OR NEW.party_size IS DISTINCT FROM OLD.party_size
       ) THEN
      v_category := 'buyer_reservation_changed';
    ELSE
      -- #4063: seated/completed/no-show and table-only transitions are quiet.
      RETURN NEW;
    END IF;

    IF v_category = 'buyer_reservation_confirmed' THEN
      v_base_key := 'buyer_reservation_confirmed:' || NEW.id::text;
    ELSE
      v_base_key := v_category || ':' || NEW.id::text || ':'
        || to_char(now(), 'YYYYMMDD"T"HH24MISSMS');
    END IF;
  END IF;

  IF v_category = 'buyer_reservation_cancelled'
     AND NEW.status = 'cancelled_by_venue' THEN
    SELECT refund.buyer_refund_requested_cents, refund.currency
      INTO v_refund_cents, v_refund_currency
      FROM public.source_refunds AS refund
     WHERE refund.source_type = 'venue_reservation'
       AND refund.subject_id = NEW.id
       AND refund.refund_kind = 'venue_staff_cancel'
     ORDER BY refund.requested_at DESC
     LIMIT 1;
  END IF;

  v_payload := jsonb_build_object(
    'reservation_id', NEW.id,
    'status', NEW.status,
    'reserved_for', NEW.reserved_for,
    'party_size', NEW.party_size,
    'guest_name', NEW.guest_name,
    'guest_phone_e164', NEW.guest_phone_e164,
    'guest_email', NEW.guest_email
  ) || CASE
    WHEN v_refund_cents IS NULL THEN '{}'::jsonb
    ELSE jsonb_build_object(
      'cancelled_by', 'venue',
      'refund_amount_cents', v_refund_cents,
      'refund_currency', v_refund_currency
    )
  END;

  IF v_v2 THEN
    SELECT
      venue.name,
      venue.address,
      venue.city,
      CASE
        WHEN availability.iana_timezone_source IN ('derived','operator')
          THEN availability.iana_timezone
        ELSE NULL
      END
      INTO v_venue_name, v_venue_address, v_venue_city, v_timezone
      FROM public.venue_listings AS venue
      LEFT JOIN public.venue_availability_config AS availability
        ON availability.venue_id = venue.id
     WHERE venue.id = NEW.venue_id;

    v_payload := v_payload || jsonb_strip_nulls(jsonb_build_object(
      'venue_id', NEW.venue_id,
      'venue_name', v_venue_name,
      'venue_address', v_venue_address,
      'venue_city', v_venue_city,
      'timezone', v_timezone,
      'created_via', NEW.created_via,
      'claimed', NEW.consumer_user_id IS NOT NULL,
      'previous_reserved_for', CASE WHEN TG_OP = 'UPDATE'
        THEN OLD.reserved_for ELSE NULL END,
      'previous_party_size', CASE WHEN TG_OP = 'UPDATE'
        THEN OLD.party_size ELSE NULL END
    ));

    IF nullif(btrim(coalesce(NEW.guest_email, '')), '') IS NOT NULL THEN
      INSERT INTO public.notification_outbox (
        category_key, user_id, contact, brand_id, payload,
        idempotency_key, country_code
      ) VALUES (
        v_category,
        NEW.consumer_user_id,
        lower(btrim(NEW.guest_email)),
        NEW.brand_id,
        v_payload,
        v_base_key || ':email',
        public.mingla_e164_country(NEW.guest_phone_e164)
      ) ON CONFLICT (idempotency_key) DO NOTHING;
    END IF;

    IF NEW.guest_phone_e164 ~ '^\+[1-9][0-9]{1,14}$' THEN
      INSERT INTO public.notification_outbox (
        category_key, user_id, contact, brand_id, payload,
        idempotency_key, country_code
      ) VALUES (
        v_category,
        CASE
          WHEN nullif(btrim(coalesce(NEW.guest_email, '')), '') IS NULL
            THEN NEW.consumer_user_id
          ELSE NULL
        END,
        NEW.guest_phone_e164,
        NEW.brand_id,
        v_payload || jsonb_build_object('channel_hint', 'sms'),
        v_base_key || ':sms',
        public.mingla_e164_country(NEW.guest_phone_e164)
      ) ON CONFLICT (idempotency_key) DO NOTHING;
    END IF;
  ELSE
    -- This branch is the pre-#4063 producer byte-for-byte in data shape.
    v_contact := coalesce(NEW.guest_phone_e164, NEW.guest_email);
    INSERT INTO public.notification_outbox (
      category_key, user_id, contact, brand_id, payload,
      idempotency_key, country_code
    ) VALUES (
      v_category,
      NEW.consumer_user_id,
      v_contact,
      NEW.brand_id,
      v_payload,
      v_base_key,
      public.mingla_e164_country(NEW.guest_phone_e164)
    ) ON CONFLICT (idempotency_key) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.orch_1161_reservation_notify_outbox()
  FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.orch_1161_reservation_notify_outbox()
  FROM anon;

CREATE OR REPLACE FUNCTION public.tg_venue_orders_a4063_receipt()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_venue_name text;
BEGIN
  IF NEW.money_path <> 'mingla'
     OR NEW.payment_status <> 'paid'
     OR NEW.confirmed_at IS NULL
     OR NEW.buyer_phone_e164 !~ '^\+[1-9][0-9]{1,14}$'
     OR NOT public.issue_4063_switch_on('messages_v2')
     OR (
       TG_OP = 'UPDATE'
       AND OLD.payment_status = 'paid'
       AND OLD.confirmed_at IS NOT NULL
     ) THEN
    RETURN NEW;
  END IF;

  BEGIN
    SELECT venue.name
      INTO v_venue_name
      FROM public.venue_listings AS venue
     WHERE venue.id = NEW.venue_id;

    INSERT INTO public.notification_outbox (
      category_key,
      user_id,
      contact,
      brand_id,
      payload,
      idempotency_key,
      country_code,
      status
    ) VALUES (
      'buyer_venue_order_receipt',
      NEW.buyer_user_id,
      NEW.buyer_phone_e164,
      NEW.brand_id,
      jsonb_build_object(
        'venue_order_id', NEW.id,
        'venue_id', NEW.venue_id,
        'venue_name', coalesce(nullif(btrim(v_venue_name), ''), 'the venue'),
        'pickup_code', NEW.pickup_code,
        'claimed', NEW.buyer_user_id IS NOT NULL,
        'channel_hint', 'sms'
      ),
      'buyer_venue_order_receipt:' || NEW.id::text || ':sms',
      public.mingla_e164_country(NEW.buyer_phone_e164),
      'pending'
    )
    ON CONFLICT (idempotency_key) DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    -- A notification failure must never roll back a successful payment write.
    RAISE WARNING 'issue_4063_receipt_enqueue_failed %', SQLSTATE;
  END;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.tg_venue_orders_a4063_receipt()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tg_venue_orders_a4063_receipt()
  TO service_role;

DROP TRIGGER IF EXISTS trg_venue_orders_a4063_receipt
  ON public.venue_orders;
CREATE TRIGGER trg_venue_orders_a4063_receipt
AFTER INSERT OR UPDATE OF payment_status, confirmed_at
ON public.venue_orders
FOR EACH ROW
EXECUTE FUNCTION public.tg_venue_orders_a4063_receipt();

DO $reschedule$
BEGIN
  PERFORM cron.unschedule(job.jobid)
    FROM cron.job AS job
   WHERE job.jobname = 'orch_1161_notify_reminders';
END;
$reschedule$;

SELECT cron.schedule(
  'orch_1161_notify_reminders',
  '*/5 * * * *',
  $cron$
    SELECT net.http_post(
      url := (
        SELECT decrypted_secret
          FROM vault.decrypted_secrets
         WHERE name = 'supabase_url'
         LIMIT 1
      ) || '/functions/v1/notify-reminders',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer ' || (
          SELECT decrypted_secret
            FROM vault.decrypted_secrets
           WHERE name = 'service_role_key'
           LIMIT 1
        )
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 30000
    );
  $cron$
);

DO $exit_check$
DECLARE
  v_definition text;
  v_schedule text;
BEGIN
  SELECT pg_get_functiondef(
    'public.pg_notify_reminders_enqueue(int, text, int)'::regprocedure
  ) INTO v_definition;

  IF v_definition NOT LIKE '%interval ''7 minutes''%'
     OR v_definition NOT LIKE '%interval ''3 minutes''%'
     OR v_definition NOT LIKE '%ticket_event_dates%'
     OR v_definition NOT LIKE '%o.booked_start_at%'
     OR v_definition NOT LIKE '%partial_refund%'
     OR v_definition NOT LIKE '%buyer_event_reminder:%booked%'
     OR v_definition NOT LIKE '%mingla_e164_country(u.contact)%' THEN
    RAISE EXCEPTION 'issue_4063_exit_check_reminder_definition_incomplete';
  END IF;

  SELECT pg_get_functiondef(
    'public.issue_2947_waitlist_drain_for_ticket_type(uuid, integer)'::regprocedure
  ) INTO v_definition;
  IF v_definition NOT LIKE '%issue_4063_switch_on%'
     OR v_definition NOT LIKE '%mingla_e164_normalize%'
     OR v_definition NOT LIKE '%:email%'
     OR v_definition NOT LIKE '%:sms%'
     OR v_definition NOT LIKE '%event_date_id%'
     OR v_definition NOT LIKE '%start_at%' THEN
    RAISE EXCEPTION 'issue_4063_exit_check_waitlist_definition_incomplete';
  END IF;

  SELECT pg_get_functiondef(
    'public.fn_rsvp_drain_on_capacity_freed()'::regprocedure
  ) INTO v_definition;
  IF v_definition NOT LIKE '%issue_4063_switch_on%'
     OR v_definition NOT LIKE '%NOT v_v2 OR v_approval_mode <> ''manual''%'
     OR v_definition NOT LIKE '%rsvp_waitlist_promoted%' THEN
    RAISE EXCEPTION 'issue_4063_exit_check_rsvp_promotion_definition_incomplete';
  END IF;

  SELECT pg_get_functiondef(
    'public.event_edit_notice_fanout(integer)'::regprocedure
  ) INTO v_definition;
  IF v_definition NOT LIKE '%issue_4063_switch_on%'
     OR v_definition NOT LIKE '%buyer_phone_e164%'
     OR v_definition NOT LIKE '%recipientPhone%'
     OR v_definition NOT LIKE '%phone:%'
     OR v_definition NOT LIKE '%claimed%'
     OR v_definition NOT LIKE '%kind%' THEN
    RAISE EXCEPTION 'issue_4063_exit_check_event_edit_fanout_incomplete';
  END IF;

  SELECT schedule INTO v_schedule
    FROM cron.job
   WHERE jobname = 'orch_1161_notify_reminders'
   LIMIT 1;
  IF v_schedule IS DISTINCT FROM '*/5 * * * *' THEN
    RAISE EXCEPTION 'issue_4063_exit_check_reminder_cron_%', v_schedule;
  END IF;
END;
$exit_check$;

COMMIT;
NOTIFY pgrst, 'reload schema';

CREATE OR REPLACE FUNCTION public.issue_3872_ticket_quote(
  p_event_id uuid,
  p_lines jsonb,
  p_event_date_ids uuid[],
  p_booked_start_at timestamptz,
  p_booked_end_at timestamptz,
  p_booked_party_size integer,
  p_payment_plan_choice text,
  p_discount_code text,
  p_buyer_email text,
  p_buyer_phone_e164 text,
  p_buyer_user_id uuid,
  p_link_token_hash text,
  p_queued boolean
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=public,auth,pg_temp AS $quote$
DECLARE
  v_event record;
  v_link public.ticket_type_links;
  v_state text;
  v_ctx jsonb;
  v_price jsonb;
  v_line_ctx jsonb;
  v_line jsonb;
  v_items jsonb := '[]'::jsonb;
  v_engine_lines jsonb := '[]'::jsonb;
  v_candidates jsonb;
  v_quote jsonb;
  v_plan jsonb;
  v_buyer jsonb;
  v_code text;
  v_currency character(3);
  v_line_currency text;
  v_saw_null_currency boolean := false;
  v_units integer := 0;
  v_expires_at timestamptz;
  v_result jsonb;
BEGIN
  IF COALESCE(p_payment_plan_choice,'') NOT IN ('auto','full','installments') THEN
    RAISE EXCEPTION 'payment_plan_choice_invalid';
  END IF;
  IF p_lines IS NULL OR jsonb_typeof(p_lines)<>'array' OR jsonb_array_length(p_lines)=0 THEN
    RAISE EXCEPTION 'ticket_lines_required';
  END IF;

  SELECT e.id,e.brand_id,e.visibility,e.status,e.deleted_at,e.event_type,e.timezone
    INTO v_event FROM public.events e WHERE e.id=p_event_id;
  IF NOT FOUND OR v_event.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'event_not_found'; END IF;
  IF v_event.visibility NOT IN ('public','hidden')
     OR v_event.status NOT IN ('scheduled','live') THEN RAISE EXCEPTION 'event_not_selling'; END IF;
  IF EXISTS(SELECT 1 FROM public.event_dates d WHERE d.event_id=p_event_id)
     AND NOT EXISTS(SELECT 1 FROM public.event_dates d WHERE d.event_id=p_event_id AND d.end_at>now()) THEN
    RAISE EXCEPTION 'event_already_ended';
  END IF;

  IF p_link_token_hash IS NOT NULL THEN
    SELECT l.* INTO v_link FROM public.ticket_type_links l WHERE l.token_hash=p_link_token_hash;
    IF NOT FOUND THEN RAISE EXCEPTION 'link_not_found'; END IF;
    IF v_link.event_id<>p_event_id OR v_link.kind<>'private_ticket' THEN
      RAISE EXCEPTION 'not_a_private_ticket_link';
    END IF;
    v_state:=public.issue_3827_link_state(v_link,now());
    IF v_state<>'active' THEN
      RAISE EXCEPTION '%',CASE v_state WHEN 'revoked' THEN 'link_revoked'
        WHEN 'expired' THEN 'link_expired' WHEN 'full' THEN 'link_full' ELSE v_state END;
    END IF;
    FOR v_line IN SELECT value FROM jsonb_array_elements(p_lines) LOOP
      IF (v_line->>'ticketTypeId')::uuid<>v_link.ticket_type_id THEN
        RAISE EXCEPTION 'link_tier_mismatch';
      END IF;
      v_units:=v_units+public.issue_3281_line_qty_sum(v_line);
    END LOOP;
    IF v_units<=0 THEN RAISE EXCEPTION 'invalid_request'; END IF;
    IF v_link.max_uses IS NOT NULL
       AND public.issue_3827_link_uses_taken(v_link.id)+v_units>v_link.max_uses THEN
      RAISE EXCEPTION 'link_full';
    END IF;
    PERFORM set_config('mingla.ticket_link_id',v_link.id::text,true);
  END IF;

  v_ctx:=public.issue_3872_checkout_day_context(
    p_event_id,p_event_date_ids,p_booked_start_at,p_booked_end_at);
  v_expires_at:=CASE WHEN COALESCE(p_queued,false) THEN 'infinity'::timestamptz
    ELSE now()+interval '30 minutes' END;
  FOR v_line IN SELECT value FROM jsonb_array_elements(p_lines) LOOP
    -- Same rules as create-session: byDate is already expanded per date.
    v_line_ctx:=v_ctx;
    IF jsonb_typeof(v_line->'byDate')='object' THEN
      IF v_ctx->>'pricingMode'='all_days' THEN
        RAISE EXCEPTION 'by_date_not_supported_for_all_days';
      END IF;
      IF COALESCE((v_ctx->>'dayCount')::integer,0)=0 OR EXISTS(
        SELECT 1 FROM jsonb_object_keys(v_line->'byDate') AS k
        WHERE NOT (k::uuid=ANY(ARRAY(
          SELECT jsonb_array_elements_text(v_ctx->'dayIds')::uuid)))
      ) THEN
        RAISE EXCEPTION 'ticket_quantity_invalid';
      END IF;
      v_line_ctx:=v_ctx||jsonb_build_object('dayMultiplier',1);
    END IF;
    v_price:=public.issue_3872_ticket_line_price(
      p_event_id,(v_line->>'ticketTypeId')::uuid,
      public.issue_3281_line_qty_sum(v_line),v_line_ctx,v_expires_at,p_booked_party_size);
    v_line_currency:=NULLIF(v_price->>'currency','');
    IF v_line_currency IS NULL THEN
      v_saw_null_currency:=true;
    ELSIF v_currency IS NULL THEN
      v_currency:=v_line_currency::character(3);
    ELSIF trim(v_currency)<>v_line_currency THEN
      RAISE EXCEPTION 'mixed_currency_cart';
    END IF;
    v_items:=v_items||jsonb_build_array(jsonb_build_object(
      'ticketTypeId',v_price->'ticketTypeId','ticketName',v_price->>'ticketName',
      'quantity',(v_price->>'quantity')::integer,
      'unitPriceCents',(v_price->>'unitPriceCents')::integer,
      'listUnitPriceCents',(v_price->>'unitPriceCents')::integer,
      'discountCents',0,'totalCents',(v_price->>'totalCents')::integer,
      'admitsCount',(v_price->>'admitsCount')::integer,
      'valueScale',(v_price->>'valueScale')::integer,
      'countScale',(v_price->>'countScale')::integer,
      'discountsAllowed',(v_price->>'discountsAllowed')::boolean,
      'priceBasis',v_price->>'priceBasis','isFree',(v_price->>'isFree')::boolean,
      'applied','[]'::jsonb));
  END LOOP;

  v_code:=NULLIF(upper(regexp_replace(btrim(COALESCE(p_discount_code,'')),'[\s-]','','g')),'');
  IF v_code IS NOT NULL AND (length(v_code)>32 OR v_code!~'^[A-Z0-9]+$') THEN
    RAISE EXCEPTION 'discount_code_invalid';
  END IF;
  v_buyer:=jsonb_build_object('email',NULLIF(lower(btrim(p_buyer_email)),''),
    'phone',p_buyer_phone_e164,'userId',p_buyer_user_id);
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'lineRef',i->>'ticketTypeId','itemKind','ticket_type','itemId',i->'ticketTypeId',
    'listingId',p_event_id,'listingKind',v_event.event_type,
    'listUnitMinor',(i->>'listUnitPriceCents')::integer,'qty',(i->>'quantity')::integer,
    'valueScale',(i->>'valueScale')::integer,'countScale',(i->>'countScale')::integer,
    'allowed',(i->>'discountsAllowed')::boolean AND NOT (i->>'isFree')::boolean,
    'tz',COALESCE(v_event.timezone,'UTC')) ORDER BY ord),'[]'::jsonb)
    INTO v_engine_lines FROM jsonb_array_elements(v_items) WITH ORDINALITY a(i,ord);
  v_candidates:=public.issue_3872_discount_candidates(
    v_event.brand_id,v_engine_lines,v_code,v_buyer,now());
  v_quote:=public.issue_3872_discount_apply(jsonb_build_object(
    'currency',trim(v_currency),'at',now(),'queued',COALESCE(p_queued,false),
    'lines',v_engine_lines,'automatics',v_candidates->'automatics',
    'code',v_candidates->'code','codeLookup',v_candidates->>'codeLookup'));
  SELECT COALESCE(jsonb_agg(i||jsonb_build_object(
    'unitPriceCents',(q->>'netUnitMinor')::integer,
    'totalCents',(q->>'lineNetMinor')::integer,
    'discountCents',(q->>'lineDiscountMinor')::integer,
    'unitsCounted',(q->>'unitsCounted')::integer,
    'applied',q->'applied') ORDER BY ord),'[]'::jsonb)
    INTO v_items
    FROM jsonb_array_elements(v_items) WITH ORDINALITY a(i,ord)
    JOIN jsonb_array_elements(v_quote->'lines') q ON q->>'lineRef'=i->>'ticketTypeId';
  IF v_saw_null_currency AND v_currency IS NOT NULL
     AND (v_quote->>'netSubtotalMinor')::bigint>0 THEN RAISE EXCEPTION 'mixed_currency_cart'; END IF;
  IF (v_quote->>'netSubtotalMinor')::bigint>0 AND v_currency IS NULL THEN
    RAISE EXCEPTION 'event_currency_required';
  END IF;

  v_plan:=public.issue_3872_plan_due_today(p_event_id,v_items,p_payment_plan_choice);
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'ticketTypeId',i->'ticketTypeId','ticketName',i->>'ticketName',
    'quantity',(i->>'quantity')::integer,
    'listUnitCents',(i->>'listUnitPriceCents')::integer,
    'netUnitCents',(i->>'unitPriceCents')::integer,
    'lineListCents',(i->>'listUnitPriceCents')::integer*(i->>'quantity')::integer,
    'lineNetCents',(i->>'totalCents')::integer,
    'discountCents',(i->>'discountCents')::integer,
    'discounts',COALESCE(i->'applied','[]'::jsonb)) ORDER BY ord),'[]'::jsonb)
    INTO v_result FROM jsonb_array_elements(v_items) WITH ORDINALITY a(i,ord);
  IF p_link_token_hash IS NOT NULL THEN PERFORM set_config('mingla.ticket_link_id','',true); END IF;
  RETURN jsonb_build_object(
    'currency',trim(v_currency),'lines',v_result,
    'listSubtotalCents',(v_quote->>'listSubtotalMinor')::bigint,
    'discountCents',(v_quote->>'discountMinor')::bigint,
    'netSubtotalCents',(v_quote->>'netSubtotalMinor')::bigint,
    'dueTodayNetCents',(v_plan->>'dueTodayNetCents')::bigint,
    'dueTodayListCents',(v_plan->>'dueTodayListCents')::bigint,
    'installmentSchedule',v_plan->'installmentSchedule',
    'discounts',v_quote->'applied','codeOutcome',v_quote->'codeOutcome',
    'notices',v_quote->'notices','quoteDigest',v_quote->>'digest',
    'quoteListDigest',v_quote->>'listDigest');
END;
$quote$;

DO $verify$
DECLARE
  v_live text := pg_get_functiondef(
    'public.biz_update_live_experience(uuid, jsonb, text)'::regprocedure
  );
  v_remind text := pg_get_functiondef(
    'public.pg_notify_reminders_enqueue(integer, text, integer)'::regprocedure
  );
  v_quote text := pg_get_functiondef(
    'public.issue_3872_ticket_quote(uuid, jsonb, uuid[], timestamptz, timestamptz, integer, text, text, text, text, uuid, text, boolean)'::regprocedure
  );
  v_finalize text := pg_get_functiondef(
    'public.issue_1930_ticket_checkout_finalize_base(uuid, text, text, text, text, text, text, boolean)'::regprocedure
  );
BEGIN
  IF position('capacity_scope' IN v_live) = 0
     OR position('price_options' IN v_live) = 0 THEN
    RAISE EXCEPTION 'issue_3281_order_repair: live experience body is not terminal';
  END IF;
  IF position('interval ''7 minutes''' IN v_remind) = 0 THEN
    RAISE EXCEPTION 'issue_3281_order_repair: reminder body is not terminal';
  END IF;
  IF position('issue_3281_line_qty_sum' IN v_quote) = 0 THEN
    RAISE EXCEPTION 'issue_3281_order_repair: quote body ignores byDate';
  END IF;
  IF position('by_date' IN v_finalize) = 0
     OR position('plan_bound_at' IN v_finalize) = 0 THEN
    RAISE EXCEPTION 'issue_3281_order_repair: finalizer needs 20280216003282 first';
  END IF;
END;
$verify$;

COMMIT;
