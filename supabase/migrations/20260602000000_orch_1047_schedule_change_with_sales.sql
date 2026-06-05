-- ORCH-1047 — buyer protection: time/timezone changes on a sold event
-- must pass through the same refund-first process as date moves.
-- Adds a single-mode TIME/instant check to business_patch_event_when:
-- when sold>0 and the proposed master start/end instant differs from the
-- current one (even on the same calendar day), raise schedule_change_with_sales.
-- Idempotent (CREATE OR REPLACE). Mirrors the existing date-day block.

CREATE OR REPLACE FUNCTION public.business_patch_event_when(p_event_id uuid, p_when_payload jsonb, p_reason text, p_client_revision integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_user_id uuid;
  v_event public.events%ROWTYPE;
  v_now timestamptz := now();
  v_trimmed_reason text;
  v_reason_len integer;
  v_when_mode text;
  v_old_when_mode text;
  v_when jsonb;
  v_multi_dates jsonb;
  v_date_iso text;
  v_doors text;
  v_ends text;
  v_timezone text;
  v_start timestamptz;
  v_end timestamptz;
  v_min_start timestamptz;
  v_date_entry jsonb;
  v_sold_count integer;
  v_old_recurrence jsonb;
  v_new_recurrence jsonb;
  v_old_master_dates date[];
  v_new_payload_dates date[];
  v_updated public.events%ROWTYPE;
BEGIN
  -- 1. Authentication
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  -- 2. Fetch + lock the events row (concurrent edit/publish protection)
  SELECT *
  INTO v_event
  FROM public.events
  WHERE id = p_event_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'event_not_found';
  END IF;

  -- 3. Soft-delete guard
  IF v_event.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'event_deleted';
  END IF;

  -- 4. Status guard — only scheduled/live events are editable
  IF v_event.status NOT IN ('scheduled', 'live') THEN
    RAISE EXCEPTION 'event_not_editable_status';
  END IF;

  -- 5. Permission — event_manager+ for the brand
  IF public.biz_brand_effective_rank(v_event.brand_id, v_user_id)
       < public.biz_role_rank('event_manager'::text) THEN
    RAISE EXCEPTION 'insufficient_event_permission';
  END IF;

  -- 6. Reason validation (mirror publishedEventEditGuards.ts:26-32 — trim ∈ [10, 200])
  IF p_reason IS NULL THEN
    RAISE EXCEPTION 'missing_edit_reason';
  END IF;
  v_trimmed_reason := btrim(p_reason);
  IF length(v_trimmed_reason) = 0 THEN
    RAISE EXCEPTION 'missing_edit_reason';
  END IF;
  v_reason_len := length(v_trimmed_reason);
  IF v_reason_len < 10 OR v_reason_len > 200 THEN
    RAISE EXCEPTION 'invalid_edit_reason';
  END IF;

  -- 7. Client revision check (NO-OP — events.client_revision column does
  --    not exist yet; param reserved for future optimistic-concurrency
  --    extension. Service still passes the param per SPEC §4.8 contract.)
  IF p_client_revision IS NOT NULL THEN
    -- Future: SELECT client_revision FROM events WHERE id = p_event_id;
    -- and raise stale_client_revision on mismatch. Currently a no-op.
    NULL;
  END IF;

  -- 8. whenMode validation
  v_when_mode := COALESCE(NULLIF(p_when_payload->>'whenMode', ''), 'single');
  v_when := p_when_payload->'when';
  v_multi_dates := p_when_payload->'multiDates';
  v_timezone := COALESCE(NULLIF(p_when_payload->>'timezone', ''), v_event.timezone, 'UTC');

  IF v_when_mode NOT IN ('single', 'multi_date', 'recurring') THEN
    RAISE EXCEPTION 'event_date_required';
  END IF;

  -- 9. Buyer-protection (CONSERVATIVE) — block structural changes when sold>0
  SELECT count(*)::integer INTO v_sold_count
  FROM public.orders
  WHERE event_id = p_event_id
    AND payment_status IN ('paid', 'partial_refund');

  v_old_when_mode := CASE
    WHEN v_event.is_multi_date THEN 'multi_date'
    WHEN v_event.is_recurring THEN 'recurring'
    ELSE 'single'
  END;

  IF v_sold_count > 0 THEN
    -- Block whenMode change
    IF v_when_mode <> v_old_when_mode THEN
      RAISE EXCEPTION 'when_mode_drops_active_date';
    END IF;

    -- Block recurrenceRule structural change in recurring mode
    IF v_when_mode = 'recurring' THEN
      v_old_recurrence := v_event.recurrence_rules;
      v_new_recurrence := p_when_payload->'recurrenceRule';
      IF COALESCE(v_old_recurrence::text, '') <> COALESCE(v_new_recurrence::text, '') THEN
        RAISE EXCEPTION 'recurrence_drops_occurrence';
      END IF;
    END IF;

    -- Block multi-date structural removal OR single-mode date change
    IF v_when_mode = 'multi_date' THEN
      -- Compare existing event_dates dates with payload dates
      SELECT array_agg(DISTINCT (start_at AT TIME ZONE v_timezone)::date ORDER BY (start_at AT TIME ZONE v_timezone)::date)
      INTO v_old_master_dates
      FROM public.event_dates
      WHERE event_id = p_event_id;

      SELECT array_agg(DISTINCT (entry->>'date')::date ORDER BY (entry->>'date')::date)
      INTO v_new_payload_dates
      FROM jsonb_array_elements(v_multi_dates) entry
      WHERE NULLIF(entry->>'date', '') IS NOT NULL;

      -- Reject if any existing date is missing from new payload
      IF v_old_master_dates IS NOT NULL AND v_new_payload_dates IS NOT NULL THEN
        IF EXISTS (
          SELECT 1 FROM unnest(v_old_master_dates) AS d
          WHERE d <> ALL(v_new_payload_dates)
        ) THEN
          RAISE EXCEPTION 'multi_date_remove_with_sales';
        END IF;
      END IF;
    END IF;

    IF v_when_mode = 'single' THEN
      -- Reject date change in single mode with sold>0
      v_date_iso := NULLIF(v_when->>'date', '');
      IF v_date_iso IS NOT NULL THEN
        IF EXISTS (
          SELECT 1 FROM public.event_dates
          WHERE event_id = p_event_id
            AND is_master = true
            AND (start_at AT TIME ZONE v_timezone)::date <> v_date_iso::date
        ) THEN
          RAISE EXCEPTION 'multi_date_remove_with_sales';
        END IF;
        -- ORCH-1047 buyer protection: a TIME / timezone change (same calendar
        -- day) is just as material to a ticket holder as a date move — the
        -- event they paid for is moving — so it must also pass through the
        -- refund-first process rather than saving silently. Compute the
        -- proposed master start/end instant (mirror the §10 midnight-wrap) and
        -- reject if it differs from the current master row.
        v_doors := COALESCE(NULLIF(v_when->>'doorsOpen', ''), '00:00');
        v_ends := COALESCE(NULLIF(v_when->>'endsAt', ''), v_doors);
        v_start := (v_date_iso || ' ' || v_doors || ':00')::timestamp AT TIME ZONE v_timezone;
        v_end := (v_date_iso || ' ' || v_ends || ':00')::timestamp AT TIME ZONE v_timezone;
        IF v_end <= v_start THEN
          v_end := v_end + INTERVAL '1 day';
        END IF;
        IF EXISTS (
          SELECT 1 FROM public.event_dates
          WHERE event_id = p_event_id
            AND is_master = true
            AND (start_at <> v_start OR end_at <> v_end)
        ) THEN
          RAISE EXCEPTION 'schedule_change_with_sales';
        END IF;
      END IF;
    END IF;
  END IF;

  -- 10. Atomic event_dates rewrite (mirror business_publish_event_draft:281-333)
  DELETE FROM public.event_dates WHERE event_id = p_event_id;

  IF v_when_mode IN ('single', 'recurring') THEN
    v_date_iso := NULLIF(v_when->>'date', '');
    IF v_date_iso IS NULL THEN
      RAISE EXCEPTION 'event_date_required';
    END IF;
    v_doors := COALESCE(NULLIF(v_when->>'doorsOpen', ''), '00:00');
    v_ends := COALESCE(NULLIF(v_when->>'endsAt', ''), v_doors);
    v_start := (v_date_iso || ' ' || v_doors || ':00')::timestamp AT TIME ZONE v_timezone;
    v_end := (v_date_iso || ' ' || v_ends || ':00')::timestamp AT TIME ZONE v_timezone;
    -- Midnight wrap — IDENTICAL to business_publish_event_draft:292-294
    IF v_end <= v_start THEN
      v_end := v_end + INTERVAL '1 day';
    END IF;
    -- Zero-duration rejection (defensive — wizard should prevent this client-side)
    IF v_end = v_start THEN
      RAISE EXCEPTION 'event_end_must_differ_from_start';
    END IF;
    INSERT INTO public.event_dates (event_id, start_at, end_at, timezone, is_master)
    VALUES (p_event_id, v_start, v_end, v_timezone, true);

  ELSIF v_when_mode = 'multi_date' THEN
    IF v_multi_dates IS NULL
      OR jsonb_typeof(v_multi_dates) IS DISTINCT FROM 'array'
      OR jsonb_array_length(v_multi_dates) = 0
    THEN
      RAISE EXCEPTION 'event_date_required';
    END IF;

    -- Compute master = earliest start instant
    SELECT min(
      (entry->>'date' || ' ' || COALESCE(NULLIF(entry->>'startTime', ''), '00:00') || ':00')::timestamp AT TIME ZONE v_timezone
    )
    INTO v_min_start
    FROM jsonb_array_elements(v_multi_dates) entry
    WHERE NULLIF(entry->>'date', '') IS NOT NULL;

    IF v_min_start IS NULL THEN
      RAISE EXCEPTION 'event_date_required';
    END IF;

    FOR v_date_entry IN SELECT value FROM jsonb_array_elements(v_multi_dates)
    LOOP
      v_date_iso := NULLIF(v_date_entry->>'date', '');
      IF v_date_iso IS NULL THEN
        RAISE EXCEPTION 'event_date_required';
      END IF;
      v_doors := COALESCE(NULLIF(v_date_entry->>'startTime', ''), '00:00');
      v_ends := COALESCE(NULLIF(v_date_entry->>'endTime', ''), v_doors);
      v_start := (v_date_iso || ' ' || v_doors || ':00')::timestamp AT TIME ZONE v_timezone;
      v_end := (v_date_iso || ' ' || v_ends || ':00')::timestamp AT TIME ZONE v_timezone;
      -- Per-entry midnight wrap — IDENTICAL to business_publish_event_draft:327-329
      IF v_end <= v_start THEN
        v_end := v_end + INTERVAL '1 day';
      END IF;
      IF v_end = v_start THEN
        RAISE EXCEPTION 'event_end_must_differ_from_start';
      END IF;
      INSERT INTO public.event_dates (event_id, start_at, end_at, timezone, is_master)
      VALUES (p_event_id, v_start, v_end, v_timezone, v_start = v_min_start);
    END LOOP;
  END IF;

  -- 11. Update events row (timezone may have changed; updated_at bump)
  UPDATE public.events
  SET
    timezone = v_timezone,
    updated_at = v_now
  WHERE id = p_event_id
    AND status IN ('scheduled', 'live')
    AND deleted_at IS NULL
  RETURNING * INTO v_updated;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'event_not_editable_race';
  END IF;

  -- 12. Return canonical shape (mirror business_patch_event_taxonomy)
  RETURN jsonb_build_object(
    'event', to_jsonb(v_updated),
    'when_mode', v_when_mode,
    'sold_count', v_sold_count,
    'updated_at', v_now
  );
END;
$function$
