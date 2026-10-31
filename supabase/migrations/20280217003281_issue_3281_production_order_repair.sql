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
-- Also finishes the by-date readers that still treated a line as uniform:
--   issue_3872_ticket_quote multiplied the summed quantity by every chosen day.
--   issue_3313_ticket_type_occurrence_taken and
--     issue_1930_ticket_session_authorized divided a line evenly across dates,
--     so an uneven cart held too few places on its busiest date.
--   issue_3859_bind_checkout_contract compared only totals, so a same-total
--     retry could bind a different split from the one reserved.

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

CREATE OR REPLACE FUNCTION public.issue_3313_ticket_type_occurrence_taken(
  p_ticket_type_id uuid,
  p_event_date_id uuid,
  p_exclude_session_id uuid DEFAULT NULL
) RETURNS integer
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_held integer;
BEGIN
  SELECT COALESCE(SUM(
           CASE
             -- A by-date line holds that date's own count, zero when omitted.
             WHEN jsonb_typeof(i.by_date) = 'object'
               THEN COALESCE((i.by_date ->> p_event_date_id::text)::integer, 0)
             WHEN sd.day_count = 0 THEN i.quantity
             WHEN COALESCE(s.multi_date_pricing_mode_snapshot, 'per_day') = 'per_day'
               THEN i.quantity / sd.day_count
             ELSE i.quantity
           END
         ), 0)::integer
    INTO v_held
    FROM public.ticket_checkout_session_items i
    JOIN public.ticket_checkout_sessions s ON s.id = i.checkout_session_id
    CROSS JOIN LATERAL (
      SELECT count(*)::integer AS day_count,
             COALESCE(bool_or(x.event_date_id = p_event_date_id), false) AS has_night
        FROM public.ticket_checkout_session_event_dates x
       WHERE x.checkout_session_id = s.id
    ) sd
   WHERE i.ticket_type_id = p_ticket_type_id
     AND s.expires_at > now()
     AND s.status IN ('pending_free', 'requires_payment', 'processing_payment', 'awaiting_web_redirect')
     -- a finalized or revoked session holds nothing (its tickets, if any,
     -- are counted as sold); the caller's own session can be excluded.
     AND s.order_id IS NULL
     AND s.revoked_at IS NULL
     AND (p_exclude_session_id IS NULL OR s.id <> p_exclude_session_id)
     AND (sd.day_count = 0 OR sd.has_night);

  RETURN public.issue_3313_ticket_type_occurrence_sold(p_ticket_type_id, p_event_date_id)
         + COALESCE(v_held, 0);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.issue_1930_ticket_session_authorized(
  p_session_id uuid, p_event_id uuid
) RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=public,auth,pg_temp AS $function$
DECLARE
  v_event public.events%ROWTYPE; v_bad boolean;
  v_session public.ticket_checkout_sessions%ROWTYPE; v_decision text;
  v_per_occurrence boolean; -- issue #3313
BEGIN
  SELECT * INTO v_event FROM public.events WHERE id=p_event_id;
  IF public.issue_1930_event_sale_reason(v_event) <> 'sellable' THEN RETURN false; END IF;
  -- #2101 — the sole decision owner, consuming this session's snapshots. It
  -- takes event -> brand in the canonical order before any lower-order row.
  SELECT * INTO v_session FROM public.ticket_checkout_sessions
    WHERE id=p_session_id AND event_id=p_event_id;
  IF NOT FOUND THEN RETURN false; END IF;
  v_decision := public.issue_2101_ticket_checkout_access_decision(
    p_event_id, v_session.buyer_user_id,
    v_session.checkout_access_mode_snapshot,
    v_session.checkout_access_restrictive_epoch_snapshot,
    v_session.checkout_access_membership_id_snapshot,
    v_session.checkout_access_membership_epoch_snapshot);
  IF v_decision NOT IN ('allowed_unrestricted','allowed_named') THEN RETURN false; END IF;
  v_per_occurrence := COALESCE(
    (public.issue_3313_event_day_choice(p_event_id) ->> 'perOccurrenceCapacity')::boolean, false);
  IF NOT EXISTS(SELECT 1 FROM public.ticket_checkout_sessions s
    WHERE s.id=p_session_id AND s.event_id=p_event_id AND s.revoked_at IS NULL
      AND s.status IN ('pending_free','requires_payment','processing_payment','awaiting_web_redirect'))
  THEN RETURN false; END IF;
  SELECT EXISTS(
    SELECT 1 FROM public.ticket_checkout_session_items i
    LEFT JOIN public.ticket_types tt ON tt.id=i.ticket_type_id AND tt.event_id=p_event_id
    WHERE i.checkout_session_id=p_session_id AND (
      tt.id IS NULL OR tt.deleted_at IS NOT NULL OR tt.is_hidden OR tt.is_disabled
      OR NOT tt.available_online
      OR (tt.sale_start_at IS NOT NULL AND tt.sale_start_at > now())
      OR (tt.sale_end_at IS NOT NULL AND tt.sale_end_at <= now())
      -- issue #3313 — a recurring event's capacity is PER NIGHT, so the
      -- finalize-time re-check measures each of this session's nights (every
      -- upcoming night when it has none): everyone else's sold + held places
      -- that night, plus this session's own places that night. The shared
      -- whole-run check below stays for every other event. DELETE THIS and a
      -- second night's buyer is authorised at reserve and refused at finalize.
      OR (v_per_occurrence AND NOT tt.is_unlimited AND tt.quantity_total IS NOT NULL
        AND EXISTS (
          SELECT 1
            FROM public.event_dates night
           WHERE night.event_id = p_event_id
             AND (
               EXISTS (SELECT 1 FROM public.ticket_checkout_session_event_dates sd
                        WHERE sd.checkout_session_id = p_session_id AND sd.event_date_id = night.id)
               OR (NOT EXISTS (SELECT 1 FROM public.ticket_checkout_session_event_dates sd
                                WHERE sd.checkout_session_id = p_session_id)
                   AND night.end_at > now())
             )
             AND public.issue_3313_ticket_type_occurrence_taken(tt.id, night.id, p_session_id)
                 + CASE
                     WHEN jsonb_typeof(i.by_date) = 'object'
                       THEN COALESCE((i.by_date ->> night.id::text)::integer, 0)
                     WHEN COALESCE(v_session.multi_date_pricing_mode_snapshot, 'per_day') = 'per_day'
                          AND (SELECT count(*) FROM public.ticket_checkout_session_event_dates sd
                                WHERE sd.checkout_session_id = p_session_id) > 0
                       THEN i.quantity / (SELECT count(*) FROM public.ticket_checkout_session_event_dates sd
                                           WHERE sd.checkout_session_id = p_session_id)
                     ELSE i.quantity
                   END
                 > tt.quantity_total
        ))
      OR (NOT v_per_occurrence AND NOT tt.is_unlimited AND tt.quantity_total IS NOT NULL AND
        (SELECT count(*) FROM public.tickets sold
          WHERE sold.ticket_type_id=tt.id
            AND sold.status IN ('valid','used','transferred'))
        + (SELECT COALESCE(sum(reserved.quantity),0) FROM public.ticket_checkout_session_items reserved
            JOIN public.ticket_checkout_sessions active
              ON active.id=reserved.checkout_session_id
          WHERE reserved.ticket_type_id=tt.id
            AND active.id<>p_session_id
            AND active.expires_at>now()
            AND active.order_id IS NULL
            AND active.revoked_at IS NULL
            AND active.status IN ('pending_free','requires_payment','processing_payment','awaiting_web_redirect'))
        + i.quantity > tt.quantity_total)
    )
  ) INTO v_bad;
  IF v_bad THEN RETURN false; END IF;
  IF EXISTS(SELECT 1 FROM public.ticket_checkout_sessions s
    WHERE s.id=p_session_id AND (s.metadata->>'event_date_id') IS NOT NULL
      AND NOT EXISTS(SELECT 1 FROM public.event_dates d
        WHERE d.id=(s.metadata->>'event_date_id')::uuid AND d.event_id=p_event_id
          AND d.end_at > now())) THEN RETURN false; END IF;
  -- ══ issue #2160 — RE-VALIDATE **EVERY** CHOSEN DAY, NOT JUST THE ANCHOR ══
  -- The clause above re-checks only `metadata->>'event_date_id'`, which under
  -- #2160 is the ANCHOR (the latest-ENDING day). Without the clause below a
  -- stale NON-anchor day could still mint an entitlement at finalize for an
  -- occurrence that has already ended — the guest gets a pass for a day that
  -- is over, and the scanner correctly refuses them at a door they paid for.
  --
  -- DELETE THIS BLOCK and a session that sat in the cart across the end of
  -- day 1 finalizes into a day-1 pass.
  IF EXISTS(SELECT 1 FROM public.ticket_checkout_session_event_dates i
             WHERE i.checkout_session_id=p_session_id
               AND NOT EXISTS(SELECT 1 FROM public.event_dates d
                 WHERE d.id=i.event_date_id AND d.event_id=p_event_id
                   AND d.end_at > now())) THEN RETURN false; END IF;
  RETURN true;
END $function$;

CREATE OR REPLACE FUNCTION public.issue_3859_bind_checkout_contract(
  p_checkout_session_id uuid,
  p_event_id uuid,
  p_idempotency_key text,
  p_checkout_attempt_id uuid,
  p_checkout_fingerprint text,
  p_lines jsonb,
  p_due_today_cents integer,
  p_full_price_cents integer,
  p_installment_schedule jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $function$
DECLARE
  v_session public.ticket_checkout_sessions%ROWTYPE;
  v_line jsonb;
  v_item public.ticket_checkout_session_items%ROWTYPE;
  v_choice text;
  v_ticket_type_id uuid;
  v_quantity integer;
  v_seen integer := 0;
  v_item_count integer;
  v_full_price bigint;
  v_scheduled_total bigint := 0;
  v_installment jsonb;
  v_expected_ordinal integer := 1;
  v_seen_ticket_ids uuid[] := ARRAY[]::uuid[];
BEGIN
  IF p_checkout_attempt_id IS NULL
     OR p_checkout_fingerprint IS NULL
     OR p_due_today_cents IS NULL
     OR p_full_price_cents IS NULL
     OR p_checkout_fingerprint !~ '^[0-9a-f]{64}$'
     OR p_idempotency_key IS DISTINCT FROM
       ('ticket_checkout:v2:' || p_event_id::text || ':' || p_checkout_attempt_id::text) THEN
    RAISE EXCEPTION 'checkout_contract_invalid';
  END IF;

  SELECT * INTO v_session
    FROM public.ticket_checkout_sessions
   WHERE id = p_checkout_session_id
     AND event_id = p_event_id
     AND idempotency_key = p_idempotency_key
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'checkout_session_not_found';
  END IF;

  -- Same attempt + same canonical fingerprint is reconciliation. Same attempt
  -- + changed cart/contact/consent/intake/quote is a review conflict.
  IF v_session.checkout_contract_version IS NOT NULL THEN
    IF v_session.checkout_contract_version = 2
       AND v_session.checkout_attempt_id = p_checkout_attempt_id
       AND v_session.checkout_fingerprint = p_checkout_fingerprint THEN
      RETURN jsonb_build_object(
        'outcome', 'reconciled',
        'totalCents', v_session.total_cents,
        'installmentSchedule', v_session.installment_schedule
      );
    END IF;
    RAISE EXCEPTION 'checkout_fingerprint_conflict';
  END IF;

  IF v_session.order_id IS NOT NULL
     OR v_session.stripe_payment_intent_id IS NOT NULL
     OR v_session.status NOT IN ('pending_free', 'requires_payment') THEN
    RAISE EXCEPTION 'checkout_contract_too_late';
  END IF;
  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array'
     OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'checkout_lines_conflict';
  END IF;

  SELECT count(*), COALESCE(sum(total_cents), 0)
    INTO v_item_count, v_full_price
    FROM public.ticket_checkout_session_items
   WHERE checkout_session_id = p_checkout_session_id;
  IF v_item_count <> jsonb_array_length(p_lines)
     OR v_full_price <> p_full_price_cents THEN
    RAISE EXCEPTION 'checkout_lines_conflict';
  END IF;

  FOR v_line IN SELECT value FROM jsonb_array_elements(p_lines)
  LOOP
    IF jsonb_typeof(v_line) <> 'object'
       OR COALESCE(v_line->>'ticketTypeId', '') !~
         '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'
       OR COALESCE(v_line->>'quantity', '') !~ '^[1-9][0-9]*$'
       OR COALESCE(v_line->>'paymentPlanChoice', '') NOT IN ('full', 'installments') THEN
      RAISE EXCEPTION 'checkout_lines_conflict';
    END IF;
    v_ticket_type_id := (v_line->>'ticketTypeId')::uuid;
    v_quantity := (v_line->>'quantity')::integer;
    v_choice := v_line->>'paymentPlanChoice';

    SELECT * INTO v_item
      FROM public.ticket_checkout_session_items
     WHERE checkout_session_id = p_checkout_session_id
       AND ticket_type_id = v_ticket_type_id;
    IF NOT FOUND OR v_item.quantity <> v_quantity THEN
      RAISE EXCEPTION 'checkout_lines_conflict';
    END IF;
    -- A same-total retry must not bind over the reserved per-date split.
    IF v_item.by_date IS DISTINCT FROM (v_line -> 'byDate') THEN
      RAISE EXCEPTION 'checkout_lines_conflict';
    END IF;

    IF v_ticket_type_id = ANY(v_seen_ticket_ids) THEN
      RAISE EXCEPTION 'checkout_lines_conflict';
    END IF;
    v_seen_ticket_ids := array_append(v_seen_ticket_ids, v_ticket_type_id);
    UPDATE public.ticket_checkout_session_items
       SET payment_plan_choice = v_choice
     WHERE id = v_item.id;
    v_seen := v_seen + 1;
  END LOOP;
  IF v_seen <> v_item_count THEN
    RAISE EXCEPTION 'checkout_lines_conflict';
  END IF;

  IF p_due_today_cents < 0 OR p_due_today_cents > p_full_price_cents THEN
    RAISE EXCEPTION 'checkout_quote_invalid';
  END IF;
  IF p_installment_schedule IS NULL THEN
    IF p_due_today_cents <> p_full_price_cents
       OR EXISTS (
         SELECT 1 FROM public.ticket_checkout_session_items
          WHERE checkout_session_id = p_checkout_session_id
            AND payment_plan_choice = 'installments'
       ) THEN
      RAISE EXCEPTION 'checkout_quote_invalid';
    END IF;
  ELSE
    IF jsonb_typeof(p_installment_schedule) <> 'object'
       OR COALESCE(p_installment_schedule->>'fullPriceCents', '') !~ '^[0-9]+$'
       OR COALESCE(p_installment_schedule->>'depositCents', '') !~ '^[0-9]+$'
       OR upper(COALESCE(p_installment_schedule->>'currency', '')) <>
         upper(trim(v_session.currency))
       OR jsonb_typeof(p_installment_schedule->'installments') <> 'array'
       OR p_due_today_cents <= 0 THEN
      RAISE EXCEPTION 'checkout_quote_invalid';
    END IF;
    IF jsonb_array_length(p_installment_schedule->'installments') = 0
       OR (p_installment_schedule->>'fullPriceCents')::bigint <> p_full_price_cents
       OR (p_installment_schedule->>'depositCents')::bigint <> p_due_today_cents THEN
      RAISE EXCEPTION 'checkout_quote_invalid';
    END IF;
    FOR v_installment IN
      SELECT value FROM jsonb_array_elements(p_installment_schedule->'installments')
    LOOP
      IF COALESCE(v_installment->>'ordinal', '') !~ '^[1-9][0-9]*$'
         OR (v_installment->>'ordinal')::integer <> v_expected_ordinal
         OR COALESCE(v_installment->>'amountCents', '') !~ '^[1-9][0-9]*$'
         OR COALESCE(v_installment->>'sourceTicketTypeId', '') !~
           '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'
         OR NOT EXISTS (
           SELECT 1 FROM public.ticket_checkout_session_items
            WHERE checkout_session_id = p_checkout_session_id
              AND ticket_type_id = (v_installment->>'sourceTicketTypeId')::uuid
              AND payment_plan_choice = 'installments'
         ) THEN
        RAISE EXCEPTION 'checkout_quote_invalid';
      END IF;
      IF (v_installment->>'dueAt')::timestamptz <= v_session.created_at THEN
        RAISE EXCEPTION 'checkout_quote_invalid';
      END IF;
      v_scheduled_total := v_scheduled_total +
        (v_installment->>'amountCents')::bigint;
      v_expected_ordinal := v_expected_ordinal + 1;
    END LOOP;
    IF p_due_today_cents + v_scheduled_total <> p_full_price_cents
       OR EXISTS (
         SELECT 1 FROM public.ticket_checkout_session_items l
          WHERE l.checkout_session_id = p_checkout_session_id
            AND l.payment_plan_choice = 'installments'
            AND NOT EXISTS (
              SELECT 1
                FROM jsonb_array_elements(p_installment_schedule->'installments') i
               WHERE i->>'sourceTicketTypeId' = l.ticket_type_id::text
            )
       ) THEN
      RAISE EXCEPTION 'checkout_quote_invalid';
    END IF;
  END IF;

  UPDATE public.ticket_checkout_sessions
     SET checkout_contract_version = 2,
         checkout_attempt_id = p_checkout_attempt_id,
         checkout_fingerprint = p_checkout_fingerprint,
         cart_fingerprint = p_checkout_fingerprint,
         subtotal_cents = p_due_today_cents,
         total_cents = p_due_today_cents,
         installment_schedule = p_installment_schedule,
         updated_at = now()
   WHERE id = p_checkout_session_id;

  RETURN jsonb_build_object(
    'outcome', 'bound',
    'totalCents', p_due_today_cents,
    'installmentSchedule', p_installment_schedule
  );
END
$function$;

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
  v_taken text := pg_get_functiondef(
    'public.issue_3313_ticket_type_occurrence_taken(uuid, uuid, uuid)'::regprocedure
  );
  v_authorized text := pg_get_functiondef(
    'public.issue_1930_ticket_session_authorized(uuid, uuid)'::regprocedure
  );
  v_bind text := pg_get_functiondef(
    'public.issue_3859_bind_checkout_contract(uuid, uuid, text, uuid, text, jsonb, integer, integer, jsonb)'::regprocedure
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
  IF position('by_date' IN v_taken) = 0
     OR position('by_date' IN v_authorized) = 0
     OR position('by_date' IN v_bind) = 0 THEN
    RAISE EXCEPTION 'issue_3281_order_repair: a by-date reader is not terminal';
  END IF;
  IF position('by_date' IN v_finalize) = 0
     OR position('plan_bound_at' IN v_finalize) = 0 THEN
    RAISE EXCEPTION 'issue_3281_order_repair: finalizer needs 20280216003282 first';
  END IF;
END;
$verify$;

NOTIFY pgrst, 'reload schema';

COMMIT;
