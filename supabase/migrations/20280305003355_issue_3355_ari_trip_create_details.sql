-- Issue #3355 — let Ari create a useful private trip draft with user-supplied
-- schedule, destination, timezone and guest limit in the same approved write.
-- The schedule is written to the canonical event_dates owner and mirrored into
-- the trip graph atomically. Price, itinerary and departure details stay empty.

CREATE OR REPLACE FUNCTION public.biz_create_trip_draft(
  p_brand_id uuid,
  p_seed jsonb,
  p_operation_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_begin jsonb;
  v_event public.events%ROWTYPE;
  v_ticket public.ticket_types%ROWTYPE;
  v_currency char(3);
  v_business_trip jsonb;
  v_result jsonb;
  v_start_at timestamptz;
  v_end_at timestamptz;
  v_timezone text;
  v_destination text;
  v_capacity integer;
BEGIN
  PERFORM public.biz_trip_require_manager(p_brand_id);

  IF jsonb_typeof(COALESCE(p_seed, '{}'::jsonb)) <> 'object'
     OR EXISTS (
       SELECT 1 FROM jsonb_object_keys(COALESCE(p_seed, '{}'::jsonb)) key
        WHERE key <> ALL (ARRAY[
          'title', 'description', 'timezone', 'business_trip', 'provenance',
          'start_date', 'end_date', 'destination_text', 'capacity'
        ])
     ) THEN
    RAISE EXCEPTION 'trip_seed_invalid' USING ERRCODE = '22023';
  END IF;

  v_begin := public.biz_trip_command_begin(
    p_operation_id, 'create_trip', p_brand_id, NULL, COALESCE(p_seed, '{}'::jsonb));
  IF (v_begin->>'replay')::boolean THEN RETURN v_begin->'result'; END IF;

  SELECT default_currency INTO v_currency
    FROM public.brands WHERE id = p_brand_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'brand_not_found'; END IF;

  v_business_trip := COALESCE(p_seed->'business_trip', '{}'::jsonb);
  IF jsonb_typeof(v_business_trip) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'trip_seed_invalid';
  END IF;
  IF p_seed ? 'provenance' THEN
    v_business_trip := v_business_trip || jsonb_build_object('provenance', p_seed->'provenance');
  END IF;

  v_timezone := COALESCE(NULLIF(p_seed->>'timezone', ''), 'UTC');
  IF NOT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = v_timezone) THEN
    RAISE EXCEPTION 'trip_timezone_invalid' USING ERRCODE = '22023';
  END IF;
  IF (NULLIF(p_seed->>'start_date', '') IS NULL) <>
     (NULLIF(p_seed->>'end_date', '') IS NULL) THEN
    RAISE EXCEPTION 'trip_dates_invalid' USING ERRCODE = '22023';
  END IF;
  IF NULLIF(p_seed->>'start_date', '') IS NOT NULL THEN
    v_start_at := (p_seed->>'start_date')::date::timestamp AT TIME ZONE v_timezone;
    v_end_at := (p_seed->>'end_date')::date::timestamp AT TIME ZONE v_timezone;
    IF v_end_at <= v_start_at THEN
      RAISE EXCEPTION 'trip_dates_invalid' USING ERRCODE = '22023';
    END IF;
  END IF;
  v_destination := NULLIF(btrim(p_seed->>'destination_text'), '');
  v_capacity := COALESCE(NULLIF(p_seed->>'capacity', '')::integer, 1);
  IF v_capacity < 1 OR v_capacity > 100000 THEN
    RAISE EXCEPTION 'trip_capacity_invalid' USING ERRCODE = '22023';
  END IF;

  IF v_start_at IS NOT NULL THEN
    v_business_trip := v_business_trip || jsonb_build_object(
      'startAt', v_start_at,
      'endAt', v_end_at
    );
  END IF;
  IF v_destination IS NOT NULL THEN
    v_business_trip := v_business_trip || jsonb_build_object(
      'destinationLocationText', v_destination
    );
  END IF;

  INSERT INTO public.events(
    brand_id, created_by, title, description, slug, event_type, status,
    visibility, currency, theme, timezone, destination_text
  ) VALUES (
    p_brand_id,
    auth.uid(),
    COALESCE(NULLIF(btrim(p_seed->>'title'), ''), 'Untitled trip'),
    NULLIF(p_seed->>'description', ''),
    'draft-' || replace(gen_random_uuid()::text, '-', ''),
    'trip', 'draft', 'draft', v_currency,
    jsonb_build_object('business_trip', v_business_trip),
    v_timezone, v_destination
  ) RETURNING * INTO v_event;

  IF v_start_at IS NOT NULL THEN
    INSERT INTO public.event_dates(event_id, start_at, end_at, timezone, is_master)
    VALUES (v_event.id, v_start_at, v_end_at, v_timezone, true);
  END IF;

  INSERT INTO public.ticket_types(
    event_id, name, price_cents, currency, quantity_total, is_unlimited,
    is_free, min_purchase_qty, available_online, available_in_person, display_order
  ) VALUES (
    v_event.id, 'Standard', 0, v_currency, v_capacity, false, true, 1, true, false, 0
  ) RETURNING * INTO v_ticket;

  INSERT INTO public.trip_pricing_tiers(event_id, ticket_type_id, tier_name, tier_metadata)
  VALUES (v_event.id, v_ticket.id, 'Standard', '{}'::jsonb);

  v_result := public.biz_get_trip_draft_graph(v_event.id);
  RETURN public.biz_trip_command_finish(p_operation_id, v_result);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.ari_execute_trip_operation(
  p_operation_id uuid,
  p_tool_name text,
  p_args jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_begin jsonb;
  v_result jsonb;
  v_event_id uuid;
  v_status text;
  v_patch jsonb := '{}'::jsonb;
  v_event_patch jsonb := '{}'::jsonb;
  v_seed jsonb := '{}'::jsonb;
BEGIN
  IF p_tool_name IS NULL OR p_tool_name NOT IN (
    'create_trip', 'update_trip', 'manage_trip_days', 'manage_trip_inclusions',
    'manage_trip_tiers', 'manage_trip_traveler_intake', 'publish_trip', 'delete_trip'
  ) THEN
    RAISE EXCEPTION 'unsupported_trip_operation';
  END IF;

  v_begin := public.agent_operation_receipt_begin(p_operation_id, p_tool_name, p_args);
  IF COALESCE((v_begin->>'replay')::boolean, false) THEN RETURN v_begin->'result'; END IF;

  IF p_tool_name = 'create_trip' THEN
    IF p_args ? 'title' THEN v_seed := v_seed || jsonb_build_object('title', p_args->'title'); END IF;
    IF p_args ? 'description' THEN v_seed := v_seed || jsonb_build_object('description', p_args->'description'); END IF;
    IF p_args ? 'provenance' THEN v_seed := v_seed || jsonb_build_object('provenance', p_args->'provenance'); END IF;
    IF p_args ? 'timezone' THEN v_seed := v_seed || jsonb_build_object('timezone', p_args->'timezone'); END IF;
    IF p_args ? 'start_date' THEN v_seed := v_seed || jsonb_build_object('start_date', p_args->'start_date'); END IF;
    IF p_args ? 'end_date' THEN v_seed := v_seed || jsonb_build_object('end_date', p_args->'end_date'); END IF;
    IF p_args ? 'destination_text' THEN v_seed := v_seed || jsonb_build_object('destination_text', p_args->'destination_text'); END IF;
    IF p_args ? 'max_guests' THEN v_seed := v_seed || jsonb_build_object('capacity', p_args->'max_guests'); END IF;
    v_result := public.biz_create_trip_draft(
      (p_args->>'brand_id')::uuid, v_seed, p_operation_id);
  ELSE
    v_event_id := NULLIF(p_args->>'event_id', '')::uuid;
    IF v_event_id IS NULL THEN RAISE EXCEPTION 'trip_not_found'; END IF;
    IF p_tool_name = 'publish_trip' THEN
      v_result := public.biz_publish_trip_command(
        v_event_id, (p_args->>'expected_updated_at')::timestamptz, p_operation_id);
    ELSIF p_tool_name = 'delete_trip' THEN
      v_result := public.biz_soft_delete_trip(
        v_event_id, (p_args->>'expected_updated_at')::timestamptz, p_operation_id);
    ELSE
      IF p_tool_name = 'update_trip' THEN
        IF p_args ? 'title' THEN v_event_patch := v_event_patch || jsonb_build_object('title', p_args->'title'); END IF;
        IF p_args ? 'description' THEN v_event_patch := v_event_patch || jsonb_build_object('description', p_args->'description'); END IF;
        IF v_event_patch = '{}'::jsonb THEN RAISE EXCEPTION 'trip_patch_empty'; END IF;
        v_patch := jsonb_build_object('event', v_event_patch);
      ELSIF p_tool_name = 'manage_trip_days' THEN
        v_patch := jsonb_build_object('days', COALESCE(p_args->'items', '[]'::jsonb));
      ELSIF p_tool_name = 'manage_trip_inclusions' THEN
        v_patch := jsonb_build_object('inclusions', COALESCE(p_args->'items', '[]'::jsonb));
      ELSIF p_tool_name = 'manage_trip_tiers' THEN
        v_patch := jsonb_build_object('tiers', COALESCE(p_args->'items', '[]'::jsonb));
      ELSIF p_tool_name = 'manage_trip_traveler_intake' THEN
        v_patch := jsonb_build_object('intake_schemas', COALESCE(p_args->'items', '[]'::jsonb));
      END IF;
      SELECT status INTO v_status FROM public.events
       WHERE id = v_event_id AND event_type = 'trip' AND deleted_at IS NULL;
      IF NOT FOUND THEN RAISE EXCEPTION 'trip_not_found'; END IF;
      IF v_status = 'draft' THEN
        v_result := public.biz_apply_trip_draft_graph(
          v_event_id, v_patch, (p_args->>'expected_updated_at')::timestamptz, p_operation_id);
      ELSIF v_status IN ('scheduled', 'live') THEN
        v_result := public.biz_update_trip_live_command(
          v_event_id, v_patch, p_args->>'reason',
          (p_args->>'expected_updated_at')::timestamptz, p_operation_id);
      ELSE
        RAISE EXCEPTION 'trip_not_editable';
      END IF;
    END IF;
  END IF;
  RETURN public.agent_operation_receipt_complete(p_operation_id, p_tool_name, p_args, v_result);
END;
$fn$;
