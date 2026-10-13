-- Issue #3645 — a trip draft saves a priced package before the brand can take
-- payments. The stop moves to Publish.
--
-- WHAT WAS WRONG. `biz_apply_trip_draft_graph` refused to SAVE a package with
-- a price above zero when the brand could not collect yet
-- (`stripe_charges_disabled`, on both the package insert and the package
-- update). A host building a paid trip therefore lost the package they had
-- just typed and was sent to bank setup in the middle of the wizard. Events
-- and experiences already save a priced draft and stop only at Publish.
--
-- WHAT THIS DOES. One thing: `biz_apply_trip_draft_graph` is re-emitted from
-- its latest definition with ONLY those two refusals removed. Nothing else in
-- the body differs.
--
-- WHY REMOVING IT OUTRIGHT IS SAFE. This function writes drafts only: it
-- raises `trip_not_draft` for any trip whose status is not 'draft' before it
-- reads the patch, so it can never write a published trip's packages. A draft
-- takes no money. The paid-publish refusal is untouched and still lives in the
-- publish owners (`business_publish_trip_draft` /
-- `business_publish_event_draft`, reached through `biz_publish_trip_command`),
-- which raise `stripe_charges_disabled` when a priced trip is published by a
-- brand that cannot collect.
--
-- WHERE THE BODY CAME FROM. Verbatim from
--   supabase/migrations/20270818003801_issue_3801_trip_draft_dates_single_owner.sql
-- minus the two blocks (each exactly these four lines):
--     IF COALESCE((v_item->>'price_cents')::int, 0) > 0
--        AND NOT public.pg_brand_can_collect(v_event.brand_id) THEN
--       RAISE EXCEPTION 'stripe_charges_disabled';
--     END IF;
-- Recheck function-body drift against production before applying.
--
-- NOT modified: `biz_publish_trip_command` (both signatures),
-- `business_publish_trip_draft`, `issue_1719_publish_trip_with_poster`,
-- `pg_brand_can_collect`. No table, column, index, policy, constraint or
-- trigger changes. Re-runnable: CREATE OR REPLACE plus restated grants.
--
-- Pinned by
--   supabase/migrations/__tests__/issue_3645_trip_draft_saves_priced_packages.implementor.happy.pg17.test.sql
--   supabase/migrations/__tests__/issue_3645_trip_draft_saves_priced_packages.tester.adversarial.pg17.test.sql

BEGIN;

-- CREATE OR REPLACE takes a brief lock on the function's catalog row. Give up
-- rather than queue behind a long-running caller; the migration rolls back
-- whole and can simply be run again.
SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.biz_apply_trip_draft_graph(
  p_event_id uuid,
  p_patch jsonb,
  p_expected_updated_at timestamptz,
  p_operation_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_event public.events%ROWTYPE;
  v_begin jsonb;
  v_result jsonb;
  v_item jsonb;
  v_ticket_type uuid;
  v_currency char(3);
  v_theme jsonb;
  v_business_trip jsonb;
  v_known text[] := ARRAY['event', 'event_dates', 'days', 'inclusions', 'tiers', 'intake_schemas', 'settings'];
  -- issue #3801
  v_dates_touched boolean;
  v_trip_start timestamptz;
  v_trip_end timestamptz;
BEGIN
  SELECT * INTO v_event FROM public.events WHERE id = p_event_id FOR UPDATE;
  IF NOT FOUND OR v_event.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'trip_not_found';
  END IF;
  IF v_event.event_type <> 'trip' THEN
    RAISE EXCEPTION 'event_not_a_trip';
  END IF;
  PERFORM public.biz_trip_require_manager(v_event.brand_id);

  v_begin := public.biz_trip_command_begin(
    p_operation_id, 'apply_trip_draft_graph', v_event.brand_id, p_event_id,
    jsonb_build_object('patch', p_patch, 'expected_updated_at', p_expected_updated_at));
  IF (v_begin->>'replay')::boolean THEN RETURN v_begin->'result'; END IF;

  IF v_event.status <> 'draft' THEN RAISE EXCEPTION 'trip_not_draft'; END IF;
  IF p_expected_updated_at IS NULL
     OR v_event.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'trip_revision_conflict' USING ERRCODE = '40001';
  END IF;
  IF jsonb_typeof(COALESCE(p_patch, '{}'::jsonb)) <> 'object' THEN
    RAISE EXCEPTION 'trip_patch_invalid' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_object_keys(COALESCE(p_patch, '{}'::jsonb)) k
     WHERE NOT (k = ANY (v_known))
  ) THEN
    RAISE EXCEPTION 'trip_patch_key_not_allowed' USING ERRCODE = '22023';
  END IF;

  ------------------------------------------------------------------ basics --
  IF p_patch ? 'event' THEN
    IF jsonb_typeof(p_patch->'event') <> 'object' OR EXISTS (
      SELECT 1 FROM jsonb_object_keys(p_patch->'event') key
       WHERE key <> ALL (ARRAY[
         'title', 'description', 'timezone', 'destination_text', 'departure_text',
         'cover_media_url', 'cover_media_poster_url', 'cover_media_type',
         'cover_media_gallery', 'business_trip'])
    ) THEN
      RAISE EXCEPTION 'trip_event_patch_invalid' USING ERRCODE = '22023';
    END IF;

    -- `events.destination_text` / `events.departure_text` are the canonical
    -- columns (ORCH-0950-expanded, ORCH-1016, I-PROPOSED-TRIP-CANONICAL-COLUMNS)
    -- and publish reads them. The theme keys are the authoring input and the
    -- wire format the existing publish/live owners consume. Both are written in
    -- the one statement below, DERIVED FROM THE SAME merged object, so the two
    -- cannot drift and neither input shape can produce a half-written trip.
    v_theme := COALESCE(v_event.theme, '{}'::jsonb);
    v_business_trip := COALESCE(v_theme->'business_trip', '{}'::jsonb);
    IF (p_patch->'event') ? 'business_trip' THEN
      IF jsonb_typeof(p_patch#>'{event,business_trip}') <> 'object' THEN
        RAISE EXCEPTION 'trip_event_patch_invalid' USING ERRCODE = '22023';
      END IF;
      v_business_trip := v_business_trip || (p_patch#>'{event,business_trip}');
    END IF;
    IF (p_patch->'event') ? 'destination_text' THEN
      v_business_trip := v_business_trip
        || jsonb_build_object('destinationLocationText', p_patch#>'{event,destination_text}');
    END IF;
    IF (p_patch->'event') ? 'departure_text' THEN
      v_business_trip := v_business_trip
        || jsonb_build_object('departureLocationText', p_patch#>'{event,departure_text}');
    END IF;
    v_theme := jsonb_set(v_theme, '{business_trip}', v_business_trip, true);

    UPDATE public.events SET
      title = CASE WHEN (p_patch->'event') ? 'title'
                THEN COALESCE(NULLIF(btrim(p_patch#>>'{event,title}'), ''), title) ELSE title END,
      description = CASE WHEN (p_patch->'event') ? 'description'
                THEN NULLIF(p_patch#>>'{event,description}', '') ELSE description END,
      timezone = CASE WHEN (p_patch->'event') ? 'timezone'
                THEN COALESCE(NULLIF(p_patch#>>'{event,timezone}', ''), 'UTC') ELSE timezone END,
      -- Derived from the MERGED business_trip, not from the raw patch key, so a
      -- destinationLocationText nested under `event.business_trip` populates
      -- the canonical column exactly as `event.destination_text` does. This
      -- also heals a legacy row whose theme and column disagree, on the next
      -- patch.
      destination_text = CASE WHEN v_business_trip ? 'destinationLocationText'
                THEN NULLIF(btrim(v_business_trip->>'destinationLocationText'), '') ELSE destination_text END,
      departure_text = CASE WHEN v_business_trip ? 'departureLocationText'
                THEN NULLIF(btrim(v_business_trip->>'departureLocationText'), '') ELSE departure_text END,
      cover_media_url = CASE WHEN (p_patch->'event') ? 'cover_media_url'
                THEN NULLIF(p_patch#>>'{event,cover_media_url}', '') ELSE cover_media_url END,
      cover_media_poster_url = CASE WHEN (p_patch->'event') ? 'cover_media_poster_url'
                THEN NULLIF(p_patch#>>'{event,cover_media_poster_url}', '') ELSE cover_media_poster_url END,
      cover_media_type = CASE WHEN (p_patch->'event') ? 'cover_media_type'
                THEN NULLIF(p_patch#>>'{event,cover_media_type}', '') ELSE cover_media_type END,
      cover_media_gallery = CASE WHEN (p_patch->'event') ? 'cover_media_gallery'
                THEN p_patch#>'{event,cover_media_gallery}' ELSE cover_media_gallery END,
      theme = v_theme,
      updated_at = now()
     WHERE id = p_event_id;

    -- issue #3801 — ONE OWNER FOR DRAFT TRIP DATES: the master event_dates row.
    --
    -- The wizard authors the dates as startAt / endAt inside
    -- `event.business_trip`, and never sends an `event_dates` group. Before
    -- this block the dates therefore reached the theme only, while publish and
    -- every reader (the wizard reload, the Hub list) read the master
    -- event_dates row — which did not exist. Publish refused every trip with
    -- `trip_dates_required` and the wizard reopened with blank dates.
    --
    -- The master row is now derived here, from the SAME merged object the theme
    -- write above just used and in the same transaction, so the two cannot
    -- drift:
    --   * dates touched by this patch and complete (both set, end after start)
    --       -> the master row is replaced with them;
    --   * dates touched and now cleared, half-set or out of order
    --       -> the master row is removed, so no stale row can outvote the
    --          theme at publish (the publish owner then names the real fault);
    --   * dates NOT touched, the theme holds a complete pair, and there is no
    --     master row -> the row is created. This heals a draft saved before
    --     this migration on its next basics save;
    --   * dates NOT touched and a master row exists -> left exactly as it is
    --     (it may have been written through the explicit `event_dates` group).
    -- An explicit `event_dates` group in the same patch keeps its existing
    -- behaviour and wins: this block stands aside and the group below runs.
    IF NOT (p_patch ? 'event_dates') THEN
      v_dates_touched := COALESCE(
        (p_patch#>'{event,business_trip}') ? 'startAt'
        OR (p_patch#>'{event,business_trip}') ? 'endAt', false);
      v_trip_start := NULL;
      v_trip_end := NULL;
      BEGIN
        v_trip_start := NULLIF(btrim(v_business_trip->>'startAt'), '')::timestamptz;
        v_trip_end := NULLIF(btrim(v_business_trip->>'endAt'), '')::timestamptz;
      EXCEPTION
        WHEN invalid_datetime_format OR datetime_field_overflow
             OR invalid_parameter_value OR invalid_text_representation THEN
          -- A date this patch just wrote that is not a date is refused, with
          -- the code the `event_dates` group already uses. Unreadable text
          -- already sitting in an old draft is not this patch's fault and
          -- must not block an unrelated save.
          IF v_dates_touched THEN
            RAISE EXCEPTION 'trip_dates_invalid' USING ERRCODE = '22023';
          END IF;
          v_trip_start := NULL;
          v_trip_end := NULL;
      END;

      IF v_trip_start IS NOT NULL AND v_trip_end IS NOT NULL
         AND v_trip_end > v_trip_start THEN
        IF v_dates_touched OR NOT EXISTS (
          SELECT 1 FROM public.event_dates
           WHERE event_id = p_event_id AND is_master = true
        ) THEN
          DELETE FROM public.event_dates
           WHERE event_id = p_event_id AND is_master = true;
          INSERT INTO public.event_dates(event_id, start_at, end_at, timezone, is_master)
          SELECT p_event_id, v_trip_start, v_trip_end, e.timezone, true
            FROM public.events e
           WHERE e.id = p_event_id;
        END IF;
      ELSIF v_dates_touched THEN
        DELETE FROM public.event_dates
         WHERE event_id = p_event_id AND is_master = true;
      END IF;
    END IF;
  END IF;

  ------------------------------------------------------------------- dates --
  IF p_patch ? 'event_dates' THEN
    IF jsonb_typeof(p_patch->'event_dates') <> 'array' THEN
      RAISE EXCEPTION 'trip_dates_invalid' USING ERRCODE = '22023';
    END IF;
    DELETE FROM public.event_dates WHERE event_id = p_event_id;
    FOR v_item IN SELECT value FROM jsonb_array_elements(p_patch->'event_dates') LOOP
      IF NULLIF(v_item->>'start_at', '') IS NULL THEN
        RAISE EXCEPTION 'trip_dates_invalid' USING ERRCODE = '22023';
      END IF;
      INSERT INTO public.event_dates(event_id, start_at, end_at, timezone, is_master)
      VALUES (
        p_event_id,
        (v_item->>'start_at')::timestamptz,
        NULLIF(v_item->>'end_at', '')::timestamptz,
        COALESCE(NULLIF(v_item->>'timezone', ''), v_event.timezone),
        COALESCE((v_item->>'is_master')::boolean, true)
      );
    END LOOP;
  END IF;

  -------------------------------------------------------------------- days --
  IF p_patch ? 'days' THEN
    IF jsonb_typeof(p_patch->'days') <> 'array'
       OR EXISTS (
         SELECT 1 FROM jsonb_array_elements(p_patch->'days') d
          WHERE jsonb_typeof(d) <> 'object'
             OR COALESCE((d->>'ordinal')::int, 0) < 1
             OR NULLIF(btrim(d->>'title'), '') IS NULL
             OR jsonb_typeof(COALESCE(d->'media', '[]'::jsonb)) <> 'array')
       OR EXISTS (
         SELECT 1 FROM jsonb_array_elements(p_patch->'days') d
          GROUP BY (d->>'ordinal')::int HAVING count(*) > 1)
    THEN
      RAISE EXCEPTION 'trip_days_invalid' USING ERRCODE = '22023';
    END IF;
    DELETE FROM public.trip_days WHERE event_id = p_event_id;
    FOR v_item IN SELECT value FROM jsonb_array_elements(p_patch->'days') LOOP
      INSERT INTO public.trip_days(event_id, ordinal, title, narrative, date, stops, media)
      VALUES (
        p_event_id,
        (v_item->>'ordinal')::smallint,
        v_item->>'title',
        NULLIF(v_item->>'narrative', ''),
        NULLIF(v_item->>'date', '')::date,
        COALESCE(v_item->'stops', '[]'::jsonb),
        COALESCE(v_item->'media', '[]'::jsonb)
      );
    END LOOP;
  END IF;

  -------------------------------------------------------------- inclusions --
  IF p_patch ? 'inclusions' THEN
    IF jsonb_typeof(p_patch->'inclusions') <> 'array'
       OR EXISTS (
         SELECT 1 FROM jsonb_array_elements(p_patch->'inclusions') i
          WHERE COALESCE(i->>'kind', '') NOT IN ('included', 'excluded')
             OR NULLIF(btrim(i->>'item'), '') IS NULL
             OR COALESCE((i->>'ordinal')::int, -1) < 0)
    THEN
      RAISE EXCEPTION 'trip_inclusions_invalid' USING ERRCODE = '22023';
    END IF;
    DELETE FROM public.trip_inclusions WHERE event_id = p_event_id;
    FOR v_item IN SELECT value FROM jsonb_array_elements(p_patch->'inclusions') LOOP
      INSERT INTO public.trip_inclusions(event_id, kind, item, ordinal)
      VALUES (p_event_id, v_item->>'kind', v_item->>'item', (v_item->>'ordinal')::smallint);
    END LOOP;
  END IF;

  ------------------------------------------------------------------- tiers --
  IF p_patch ? 'tiers' THEN
    IF jsonb_typeof(p_patch->'tiers') <> 'array' THEN
      RAISE EXCEPTION 'trip_tiers_invalid' USING ERRCODE = '22023';
    END IF;
    v_currency := v_event.currency;
    FOR v_item IN SELECT value FROM jsonb_array_elements(p_patch->'tiers') LOOP
      v_ticket_type := NULLIF(v_item->>'ticket_type_id', '')::uuid;

      IF COALESCE((v_item->>'deleted')::boolean, false) THEN
        IF v_ticket_type IS NULL THEN RAISE EXCEPTION 'trip_tier_id_required'; END IF;
        IF EXISTS (
          SELECT 1 FROM public.tickets
           WHERE ticket_type_id = v_ticket_type
             AND status IN ('valid', 'used', 'transferred')
        ) THEN
          RAISE EXCEPTION 'tier_delete_with_sales';
        END IF;
        UPDATE public.ticket_types
           SET deleted_at = now(), updated_at = now()
         WHERE id = v_ticket_type AND event_id = p_event_id AND deleted_at IS NULL;
        IF NOT FOUND THEN RAISE EXCEPTION 'trip_tier_not_found'; END IF;
        CONTINUE;
      END IF;

      PERFORM public.biz_validate_trip_installment_schedule(v_item->'tier_metadata');

      IF v_ticket_type IS NULL THEN
        IF NULLIF(btrim(v_item->>'tier_name'), '') IS NULL
           OR COALESCE((v_item->>'price_cents')::int, -1) < 0
           OR COALESCE((v_item->>'capacity')::int, 0) < 1 THEN
          RAISE EXCEPTION 'trip_tier_invalid' USING ERRCODE = '22023';
        END IF;
        INSERT INTO public.ticket_types(
          event_id, name, price_cents, currency, quantity_total, is_unlimited,
          is_free, min_purchase_qty, available_online, available_in_person, display_order
        ) VALUES (
          p_event_id,
          v_item->>'tier_name',
          COALESCE((v_item->>'price_cents')::int, 0),
          v_currency,
          (v_item->>'capacity')::int,
          false,
          COALESCE((v_item->>'price_cents')::int, 0) = 0,
          1, true, false,
          COALESCE((v_item->>'display_order')::int, 0)
        ) RETURNING id INTO v_ticket_type;
        INSERT INTO public.trip_pricing_tiers(event_id, ticket_type_id, tier_name, tier_metadata)
        VALUES (p_event_id, v_ticket_type, v_item->>'tier_name',
                COALESCE(v_item->'tier_metadata', '{}'::jsonb));
      ELSE
        IF (v_item ? 'price_cents' AND (v_item->>'price_cents')::int < 0)
           OR (v_item ? 'capacity' AND (v_item->>'capacity')::int < 1) THEN
          RAISE EXCEPTION 'trip_tier_invalid' USING ERRCODE = '22023';
        END IF;
        UPDATE public.ticket_types SET
          name = COALESCE(v_item->>'tier_name', name),
          price_cents = COALESCE((v_item->>'price_cents')::int, price_cents),
          quantity_total = COALESCE((v_item->>'capacity')::int, quantity_total),
          is_free = COALESCE((v_item->>'price_cents')::int, price_cents) = 0,
          updated_at = now()
         WHERE id = v_ticket_type AND event_id = p_event_id AND deleted_at IS NULL;
        IF NOT FOUND THEN RAISE EXCEPTION 'trip_tier_not_found'; END IF;
        UPDATE public.trip_pricing_tiers SET
          tier_name = COALESCE(v_item->>'tier_name', tier_name),
          tier_metadata = COALESCE(v_item->'tier_metadata', tier_metadata)
         WHERE event_id = p_event_id AND ticket_type_id = v_ticket_type;
      END IF;
    END LOOP;
  END IF;

  ----------------------------------------------------------- intake schemas --
  IF p_patch ? 'intake_schemas' THEN
    IF jsonb_typeof(p_patch->'intake_schemas') <> 'array' THEN
      RAISE EXCEPTION 'trip_intake_schemas_invalid' USING ERRCODE = '22023';
    END IF;
    FOR v_item IN SELECT value FROM jsonb_array_elements(p_patch->'intake_schemas') LOOP
      v_ticket_type := NULLIF(v_item->>'ticket_type_id', '')::uuid;
      IF v_ticket_type IS NULL OR NOT EXISTS (
        SELECT 1 FROM public.trip_pricing_tiers
         WHERE event_id = p_event_id AND ticket_type_id = v_ticket_type
      ) THEN
        RAISE EXCEPTION 'trip_intake_schema_unknown_tier';
      END IF;
      IF NOT (v_item ? 'schema') OR jsonb_typeof(v_item->'schema') = 'null' THEN
        DELETE FROM public.trip_intake_schemas
         WHERE event_id = p_event_id AND ticket_type_id = v_ticket_type;
      ELSE
        IF NOT public.validate_trip_intake_schema(v_item->'schema') THEN
          RAISE EXCEPTION 'trip_intake_schema_invalid' USING ERRCODE = '22023';
        END IF;
        INSERT INTO public.trip_intake_schemas(event_id, ticket_type_id, schema, schema_version_id)
        VALUES (p_event_id, v_ticket_type, v_item->'schema',
                NULLIF(v_item#>>'{schema,schema_version_id}', '')::uuid)
        ON CONFLICT (event_id, ticket_type_id) DO UPDATE
          SET schema = EXCLUDED.schema,
              schema_version_id = EXCLUDED.schema_version_id,
              updated_at = now();
      END IF;
    END LOOP;
  END IF;

  ---------------------------------------------------------------- settings --
  IF p_patch ? 'settings' THEN
    IF jsonb_typeof(p_patch->'settings') <> 'object' OR EXISTS (
      SELECT 1 FROM jsonb_object_keys(p_patch->'settings') key
       WHERE key <> ALL (ARRAY[
         'refund_policy', 'booking_deadline', 'bookings_closed',
         'pass_tax', 'pass_mingla_fee', 'pass_service_fee'])
    ) THEN
      RAISE EXCEPTION 'trip_settings_patch_invalid' USING ERRCODE = '22023';
    END IF;
    UPDATE public.events SET
      refund_policy = CASE WHEN (p_patch->'settings') ? 'refund_policy'
                THEN p_patch#>'{settings,refund_policy}' ELSE refund_policy END,
      booking_deadline = CASE WHEN (p_patch->'settings') ? 'booking_deadline'
                THEN NULLIF(p_patch#>>'{settings,booking_deadline}', '')::timestamptz ELSE booking_deadline END,
      bookings_closed = CASE WHEN (p_patch->'settings') ? 'bookings_closed'
                THEN (p_patch#>>'{settings,bookings_closed}')::boolean ELSE bookings_closed END,
      pass_tax = CASE WHEN (p_patch->'settings') ? 'pass_tax'
                THEN (p_patch#>>'{settings,pass_tax}')::boolean ELSE pass_tax END,
      pass_mingla_fee = CASE WHEN (p_patch->'settings') ? 'pass_mingla_fee'
                THEN (p_patch#>>'{settings,pass_mingla_fee}')::boolean ELSE pass_mingla_fee END,
      pass_service_fee = CASE WHEN (p_patch->'settings') ? 'pass_service_fee'
                THEN (p_patch#>>'{settings,pass_service_fee}')::boolean ELSE pass_service_fee END,
      updated_at = now()
     WHERE id = p_event_id;
  END IF;

  -- A sidecar-only patch still advances the graph revision, so the next
  -- compare-and-swap sees a moved target.
  UPDATE public.events SET updated_at = now() WHERE id = p_event_id;

  v_result := public.biz_get_trip_draft_graph(p_event_id);
  RETURN public.biz_trip_command_finish(p_operation_id, v_result);
END;
$fn$;

-- Grants, restated exactly as the latest definition leaves them.
REVOKE ALL ON FUNCTION
  public.biz_apply_trip_draft_graph(uuid, jsonb, timestamptz, uuid)
  FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION
  public.biz_apply_trip_draft_graph(uuid, jsonb, timestamptz, uuid)
  TO authenticated, service_role;

-- Fail the migration, not a later publish, if the body is not what was meant.
DO $verify$
DECLARE
  v_src text;
BEGIN
  SELECT p.prosrc INTO v_src
    FROM pg_catalog.pg_proc AS p
   WHERE p.oid = 'public.biz_apply_trip_draft_graph(uuid, jsonb, timestamptz, uuid)'::pg_catalog.regprocedure;
  IF v_src IS NULL THEN
    RAISE EXCEPTION 'issue_3645_verify: biz_apply_trip_draft_graph missing';
  END IF;
  IF pg_catalog.strpos(v_src, 'pg_brand_can_collect') > 0
     OR pg_catalog.strpos(v_src, 'stripe_charges_disabled') > 0 THEN
    RAISE EXCEPTION 'issue_3645_verify: the trip draft owner still refuses a priced package';
  END IF;
  IF pg_catalog.strpos(v_src, 'trip_not_draft') = 0 THEN
    RAISE EXCEPTION 'issue_3645_verify: the trip draft owner no longer refuses a non-draft trip';
  END IF;
END
$verify$;

COMMIT;
