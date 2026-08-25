-- Issue #1971 / #424 — one canonical, replay-safe trip command boundary.
--
-- Every Business (web/iOS/Android) and Ari trip write converges here. Quote
-- calculation (#1736) and quote-to-draft consent/mapping (#1753) stay separate
-- contracts and are NOT owned by this migration.
--
-- Design notes that are easy to get wrong and were measured against the real
-- migrated schema:
--
--  * `trg_events_updated_at` is a BEFORE trigger running
--    `update_updated_at_column()` (`NEW.updated_at = now()`). Any updated_at we
--    write is REPLACED by the transaction timestamp, so the graph revision is
--    the transaction time and is stable inside one command. We therefore write
--    `now()` explicitly rather than `clock_timestamp()`, so the source says
--    what the database actually stores.
--
--  * THE COLUMNS ARE AUTHORITATIVE; the theme keys are an authoring INPUT that
--    is mirrored into them. This is the schema's own position, not a choice
--    invented here:
--      - ORCH-0950-expanded made `events.destination_text` canonical and
--        backfilled it FROM the theme;
--      - `tg_events_sync_departure_from_theme` (20260803000000) documents
--        itself as mirroring the theme key into "the canonical
--        events.departure_text + departure_geo columns", explicitly as a
--        "mirror of the destination_text canonical-write pattern";
--      - the active I-PROPOSED-TRIP-CANONICAL-COLUMNS gate forbids new code
--        from reintroducing those theme keys as source-of-truth readers/writers.
--
--    Note precisely what that mirror trigger is: `BEFORE INSERT OR UPDATE OF
--    theme`. It fires ONLY when `theme` is in the UPDATE's column list, so a
--    column-only write SURVIVES it — it cannot clobber a direct column write,
--    and it cannot be relied on as the mechanism either.
--
--    So the draft-graph command writes the COLUMNS itself, derived from the
--    merged business_trip object, and writes that merged object back to `theme`
--    in the same statement. Whichever shape the caller used —
--    `event.destination_text`, or the destinationLocationText key nested under
--    `event.business_trip` — both land in the canonical column, and the theme
--    mirror the existing
--    publish/live owners consume stays coherent with it. Publish then reads the
--    COLUMN, so a theme-shaped input can no longer produce a draft that is
--    unpublishable.
--
--  * `public.orders` carries no BEFORE row trigger today (only AFTER ones:
--    issue_0873_order_change, issue_1770_order_ingest,
--    drop_buyer_chat_on_order_change, trg_stamp_event_pricing_lock — plus the
--    BEFORE trg_orders_updated_at). The delete/order serialization trigger below
--    is BEFORE, so it rejects the row before any of those observe it, and it
--    fights none of them.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Domain command receipts.
--
-- Manual Business mutations mint their own operation UUID per user action; Ari
-- passes the immutable confirmed pending-action UUID. Both land here so a
-- delivery retry returns the recorded result and a changed argument set fails
-- closed. This is the TRIP-DOMAIN receipt; it is deliberately separate from
-- #1972's generic `agent_operation_receipts`, which only Ari writes and which
-- `ari_execute_trip_operation` still honours.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.biz_trip_command_receipts (
  operation_id uuid PRIMARY KEY,
  actor_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  tool_name text NOT NULL CHECK (length(btrim(tool_name)) BETWEEN 1 AND 100),
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE RESTRICT,
  event_id uuid REFERENCES public.events(id) ON DELETE RESTRICT,
  arguments_hash text NOT NULL CHECK (arguments_hash ~ '^[0-9a-f]{64}$'),
  result jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
ALTER TABLE public.biz_trip_command_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.biz_trip_command_receipts FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.biz_trip_command_receipts TO service_role;
CREATE INDEX IF NOT EXISTS idx_biz_trip_command_receipts_event
  ON public.biz_trip_command_receipts(event_id);

COMMENT ON TABLE public.biz_trip_command_receipts IS
  'Issue #1971: exactly-once receipts for canonical trip commands. Private — no direct grant; the commands below are the only readers/writers.';

CREATE OR REPLACE FUNCTION public.biz_trip_command_begin(
  p_operation_id uuid,
  p_tool_name text,
  p_brand_id uuid,
  p_event_id uuid,
  p_arguments jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp
AS $fn$
DECLARE
  v_actor uuid := auth.uid();
  v_hash text;
  v_row public.biz_trip_command_receipts%ROWTYPE;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'authentication_required';
  END IF;
  IF p_operation_id IS NULL THEN
    RAISE EXCEPTION 'trip_operation_id_required' USING ERRCODE = '22023';
  END IF;

  v_hash := encode(
    extensions.digest(
      convert_to(p_tool_name || ':' || COALESCE(p_arguments, '{}'::jsonb)::text, 'UTF8'),
      'sha256'
    ),
    'hex'
  );

  PERFORM pg_advisory_xact_lock(hashtextextended(p_operation_id::text, 1971));
  SELECT * INTO v_row
    FROM public.biz_trip_command_receipts
   WHERE operation_id = p_operation_id
     FOR UPDATE;

  IF FOUND THEN
    -- Actor, tenant, resource, command AND canonical arguments all bind the
    -- receipt. A different actor replaying someone else's operation id, or the
    -- same actor replaying with materially different arguments (including a
    -- different expected revision), fails closed rather than returning a result
    -- that was never computed for those arguments.
    IF v_row.actor_user_id <> v_actor
       OR v_row.tool_name <> p_tool_name
       OR v_row.brand_id <> p_brand_id
       OR v_row.event_id IS DISTINCT FROM p_event_id
       OR v_row.arguments_hash <> v_hash THEN
      RAISE EXCEPTION 'idempotency_conflict' USING ERRCODE = '23505';
    END IF;
    IF v_row.completed_at IS NULL THEN
      RAISE EXCEPTION 'trip_operation_incomplete';
    END IF;
    RETURN jsonb_build_object('replay', true, 'result', v_row.result);
  END IF;

  INSERT INTO public.biz_trip_command_receipts(
    operation_id, actor_user_id, tool_name, brand_id, event_id, arguments_hash
  ) VALUES (p_operation_id, v_actor, p_tool_name, p_brand_id, p_event_id, v_hash);
  RETURN jsonb_build_object('replay', false);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.biz_trip_command_finish(
  p_operation_id uuid,
  p_result jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
BEGIN
  UPDATE public.biz_trip_command_receipts
     SET result = p_result, completed_at = now()
   WHERE operation_id = p_operation_id
     AND actor_user_id = auth.uid()
     AND completed_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'trip_operation_receipt_missing';
  END IF;
  RETURN p_result;
END;
$fn$;

-- ---------------------------------------------------------------------------
-- 2. Shared guards.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.biz_trip_require_manager(p_brand_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public, pg_temp
AS $fn$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'authentication_required';
  END IF;
  IF public.biz_brand_effective_rank(p_brand_id, auth.uid())
       < public.biz_role_rank('event_manager') THEN
    RAISE EXCEPTION 'insufficient_event_permission';
  END IF;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.biz_trip_require_finance(p_brand_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public, pg_temp
AS $fn$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'authentication_required';
  END IF;
  IF public.biz_brand_effective_rank(p_brand_id, auth.uid())
       < public.biz_role_rank('finance_manager') THEN
    RAISE EXCEPTION 'insufficient_finance_permission';
  END IF;
END;
$fn$;

-- Deposit/installment metadata must satisfy the SAME bounds the checkout path
-- later enforces, BEFORE the authoring boundary stores it. Otherwise an
-- organiser can persist an offering the purchase path can never honour.
CREATE OR REPLACE FUNCTION public.biz_validate_trip_installment_schedule(p_tier_metadata jsonb)
RETURNS void
LANGUAGE plpgsql IMMUTABLE SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_schedule jsonb;
  v_installments jsonb;
  v_item jsonb;
  v_deposit_pct numeric;
  v_installment_pct numeric;
  v_pct_sum numeric;
  v_index int;
BEGIN
  IF p_tier_metadata IS NULL
     OR NOT (p_tier_metadata ? 'installments')
     OR jsonb_typeof(p_tier_metadata->'installments') = 'null' THEN
    RETURN;
  END IF;

  v_schedule := p_tier_metadata->'installments';
  IF jsonb_typeof(v_schedule) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'installment_schedule_malformed' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(v_schedule->'deposit_pct') IS DISTINCT FROM 'number' THEN
    RAISE EXCEPTION 'installment_deposit_pct_out_of_range' USING ERRCODE = '22023';
  END IF;

  v_deposit_pct := (v_schedule->>'deposit_pct')::numeric;
  IF v_deposit_pct <= 0 OR v_deposit_pct > 100 THEN
    RAISE EXCEPTION 'installment_deposit_pct_out_of_range' USING ERRCODE = '22023';
  END IF;

  v_installments := v_schedule->'installments';
  IF v_installments IS NULL OR jsonb_typeof(v_installments) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'installment_schedule_malformed' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(v_installments) < 1 OR jsonb_array_length(v_installments) > 11 THEN
    RAISE EXCEPTION 'installment_count_out_of_range' USING ERRCODE = '22023';
  END IF;

  v_pct_sum := v_deposit_pct;
  FOR v_index IN 0..jsonb_array_length(v_installments) - 1 LOOP
    v_item := v_installments->v_index;
    IF jsonb_typeof(v_item) IS DISTINCT FROM 'object'
       OR jsonb_typeof(v_item->'ordinal') IS DISTINCT FROM 'number'
       OR (v_item->>'ordinal')::numeric <> v_index + 1 THEN
      RAISE EXCEPTION 'installment_ordinal_invalid' USING ERRCODE = '22023';
    END IF;
    IF jsonb_typeof(v_item->'pct') IS DISTINCT FROM 'number' THEN
      RAISE EXCEPTION 'installment_pct_out_of_range' USING ERRCODE = '22023';
    END IF;
    v_installment_pct := (v_item->>'pct')::numeric;
    IF v_installment_pct <= 0 OR v_installment_pct >= 100 THEN
      RAISE EXCEPTION 'installment_pct_out_of_range' USING ERRCODE = '22023';
    END IF;
    -- Exactly one due mode per instalment: relative days OR a fixed date.
    IF ((NULLIF(v_item->>'days_after_booking', '') IS NULL)::int
        + (NULLIF(v_item->>'fixed_date', '') IS NULL)::int) <> 1 THEN
      RAISE EXCEPTION 'installment_due_mode_invalid' USING ERRCODE = '22023';
    END IF;
    v_pct_sum := v_pct_sum + v_installment_pct;
  END LOOP;

  IF abs(v_pct_sum - 100) > 0.01 THEN
    RAISE EXCEPTION 'installment_pct_sum_mismatch' USING ERRCODE = '22023';
  END IF;
END;
$fn$;

-- ---------------------------------------------------------------------------
-- 3. TripDraftGraphV1 read. One shape for Business and Ari, so a chat-created
--    draft opens byte-identically in the manual wizard.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.biz_get_trip_draft_graph(p_event_id uuid)
RETURNS jsonb
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public, pg_temp
AS $fn$
  SELECT jsonb_build_object(
    'event', to_jsonb(e),
    'event_dates', COALESCE((
      SELECT jsonb_agg(to_jsonb(ed) ORDER BY ed.start_at)
        FROM public.event_dates ed WHERE ed.event_id = e.id), '[]'::jsonb),
    'days', COALESCE((
      SELECT jsonb_agg(to_jsonb(d) ORDER BY d.ordinal)
        FROM public.trip_days d WHERE d.event_id = e.id), '[]'::jsonb),
    'inclusions', COALESCE((
      SELECT jsonb_agg(to_jsonb(i) ORDER BY i.kind, i.ordinal)
        FROM public.trip_inclusions i WHERE i.event_id = e.id), '[]'::jsonb),
    'tiers', COALESCE((
      SELECT jsonb_agg(
               to_jsonb(t) || jsonb_build_object('ticket_type', to_jsonb(tt))
               ORDER BY tt.display_order, t.created_at)
        FROM public.trip_pricing_tiers t
        JOIN public.ticket_types tt ON tt.id = t.ticket_type_id
       WHERE t.event_id = e.id AND tt.deleted_at IS NULL), '[]'::jsonb),
    'intake_schemas', COALESCE((
      SELECT jsonb_agg(to_jsonb(s) ORDER BY s.created_at)
        FROM public.trip_intake_schemas s WHERE s.event_id = e.id), '[]'::jsonb),
    'revision', e.updated_at
  )
    FROM public.events e
   WHERE e.id = p_event_id
     AND e.event_type = 'trip'
     AND e.deleted_at IS NULL
     AND public.biz_brand_effective_rank(e.brand_id, auth.uid())
           >= public.biz_role_rank('event_manager');
$fn$;

-- ---------------------------------------------------------------------------
-- 4. Create.
-- ---------------------------------------------------------------------------
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
BEGIN
  PERFORM public.biz_trip_require_manager(p_brand_id);

  IF jsonb_typeof(COALESCE(p_seed, '{}'::jsonb)) <> 'object'
     OR EXISTS (
       SELECT 1 FROM jsonb_object_keys(COALESCE(p_seed, '{}'::jsonb)) key
        WHERE key <> ALL (ARRAY['title', 'description', 'timezone', 'business_trip', 'provenance'])
     ) THEN
    RAISE EXCEPTION 'trip_seed_invalid' USING ERRCODE = '22023';
  END IF;

  v_begin := public.biz_trip_command_begin(
    p_operation_id, 'create_trip', p_brand_id, NULL, COALESCE(p_seed, '{}'::jsonb));
  IF (v_begin->>'replay')::boolean THEN RETURN v_begin->'result'; END IF;

  -- issue #1014: NULL brand currency stays NULL. Never invent USD.
  SELECT default_currency INTO v_currency
    FROM public.brands WHERE id = p_brand_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'brand_not_found'; END IF;

  v_business_trip := COALESCE(p_seed->'business_trip', '{}'::jsonb);
  IF jsonb_typeof(v_business_trip) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'trip_seed_invalid' USING ERRCODE = '22023';
  END IF;
  IF p_seed ? 'provenance' THEN
    -- Opaque to this issue: #1753 owns what provenance means.
    v_business_trip := v_business_trip || jsonb_build_object('provenance', p_seed->'provenance');
  END IF;

  INSERT INTO public.events(
    brand_id, created_by, title, description, slug, event_type, status,
    visibility, currency, theme, timezone
  ) VALUES (
    p_brand_id,
    auth.uid(),
    COALESCE(NULLIF(btrim(p_seed->>'title'), ''), 'Untitled trip'),
    NULLIF(p_seed->>'description', ''),
    'draft-' || replace(gen_random_uuid()::text, '-', ''),
    'trip',
    'draft',
    'draft',
    v_currency,
    jsonb_build_object('business_trip', v_business_trip),
    COALESCE(NULLIF(p_seed->>'timezone', ''), 'UTC')
  ) RETURNING * INTO v_event;

  -- The manual wizard's placeholder Standard ticket + its joined pricing tier.
  -- Ari-created drafts must satisfy the same publish prerequisites.
  INSERT INTO public.ticket_types(
    event_id, name, price_cents, currency, quantity_total, is_unlimited,
    is_free, min_purchase_qty, available_online, available_in_person, display_order
  ) VALUES (
    v_event.id, 'Standard', 0, v_currency, 1, false, true, 1, true, false, 0
  ) RETURNING * INTO v_ticket;

  INSERT INTO public.trip_pricing_tiers(event_id, ticket_type_id, tier_name, tier_metadata)
  VALUES (v_event.id, v_ticket.id, 'Standard', '{}'::jsonb);

  v_result := public.biz_get_trip_draft_graph(v_event.id);
  RETURN public.biz_trip_command_finish(p_operation_id, v_result);
END;
$fn$;

-- ---------------------------------------------------------------------------
-- 5. Atomic draft graph patch.
-- ---------------------------------------------------------------------------
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
        IF COALESCE((v_item->>'price_cents')::int, 0) > 0
           AND NOT public.pg_brand_can_collect(v_event.brand_id) THEN
          RAISE EXCEPTION 'stripe_charges_disabled';
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
        IF COALESCE((v_item->>'price_cents')::int, 0) > 0
           AND NOT public.pg_brand_can_collect(v_event.brand_id) THEN
          RAISE EXCEPTION 'stripe_charges_disabled';
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

-- ---------------------------------------------------------------------------
-- 6. Published (scheduled/live) edit.
--
-- The established Business `LiveTripPatch` vocabulary is TOP-LEVEL and shared
-- by web/iOS/Android. It is forwarded to the canonical live updater byte for
-- byte; Ari's grouped TripDraftGraphV1 keys are TRANSLATED into that same
-- vocabulary. Independent QA proved the earlier grouped-only allowlist made the
-- shared published-trip editor dead on all three surfaces.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.biz_update_trip_live_command(
  p_event_id uuid,
  p_patch jsonb,
  p_reason text,
  p_expected_updated_at timestamptz,
  p_operation_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_event public.events%ROWTYPE;
  v_begin jsonb;
  v_result jsonb;
  v_forward jsonb := '{}'::jsonb;
  v_item jsonb;
  v_dates jsonb;
  v_ticket_type uuid;
  v_business_trip jsonb := '{}'::jsonb;
  v_graph_only text[] := ARRAY['event', 'event_dates', 'days', 'inclusions', 'tiers', 'intake_schemas', 'settings'];
  v_known text[] := ARRAY[
    -- Ari's TripDraftGraphV1 groups.
    'event', 'event_dates', 'days', 'inclusions', 'tiers', 'intake_schemas', 'settings',
    -- The established shared Business LiveTripPatch vocabulary.
    'title', 'description', 'theme', 'pricing_tiers', 'days', 'inclusions',
    'cover_media_url', 'cover_media_poster_url', 'cover_media_type',
    'cover_media_gallery', 'cover_media_provider', 'cover_media_source_url',
    'cover_media_credit', 'cover_media_credit_url', 'cover_media_alt',
    'refund_policy', 'booking_deadline', 'bookings_closed', 'intake_schemas'];
BEGIN
  SELECT * INTO v_event FROM public.events WHERE id = p_event_id FOR UPDATE;
  IF NOT FOUND OR v_event.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'trip_not_found';
  END IF;
  IF v_event.event_type <> 'trip' THEN RAISE EXCEPTION 'event_not_a_trip'; END IF;
  PERFORM public.biz_trip_require_manager(v_event.brand_id);

  v_begin := public.biz_trip_command_begin(
    p_operation_id, 'update_trip_live', v_event.brand_id, p_event_id,
    jsonb_build_object('patch', p_patch, 'reason', p_reason,
                       'expected_updated_at', p_expected_updated_at));
  IF (v_begin->>'replay')::boolean THEN RETURN v_begin->'result'; END IF;

  IF p_expected_updated_at IS NULL
     OR v_event.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'trip_revision_conflict' USING ERRCODE = '40001';
  END IF;
  IF v_event.status NOT IN ('scheduled', 'live') THEN
    RAISE EXCEPTION 'trip_not_live';
  END IF;
  IF char_length(btrim(COALESCE(p_reason, ''))) NOT BETWEEN 10 AND 200 THEN
    RAISE EXCEPTION 'trip_update_reason_invalid' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(COALESCE(p_patch, '{}'::jsonb)) <> 'object'
     OR EXISTS (
       SELECT 1 FROM jsonb_object_keys(COALESCE(p_patch, '{}'::jsonb)) k
        WHERE NOT (k = ANY (v_known)))
  THEN
    RAISE EXCEPTION 'trip_patch_key_not_allowed' USING ERRCODE = '22023';
  END IF;

  -- Everything that is already top-level Business vocabulary rides through
  -- untouched. Only the graph-only groups are translated.
  v_forward := COALESCE(p_patch, '{}'::jsonb) - v_graph_only;

  IF p_patch ? 'event' THEN
    IF jsonb_typeof(p_patch->'event') <> 'object' THEN
      RAISE EXCEPTION 'trip_event_patch_invalid' USING ERRCODE = '22023';
    END IF;
    v_forward := v_forward
      || ((p_patch->'event') - ARRAY['destination_text', 'departure_text', 'business_trip']);
    IF (p_patch->'event') ? 'business_trip' THEN
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
  END IF;

  IF p_patch ? 'event_dates' THEN
    IF jsonb_typeof(p_patch->'event_dates') <> 'array' THEN
      RAISE EXCEPTION 'trip_dates_invalid' USING ERRCODE = '22023';
    END IF;
    v_dates := p_patch->'event_dates'->0;
    v_business_trip := v_business_trip
      || jsonb_build_object('startAt', v_dates->'start_at', 'endAt', v_dates->'end_at');
  END IF;

  IF v_business_trip <> '{}'::jsonb THEN
    v_forward := v_forward || jsonb_build_object(
      'theme',
      COALESCE(v_forward->'theme', '{}'::jsonb) || jsonb_build_object(
        'business_trip',
        COALESCE(v_forward#>'{theme,business_trip}', '{}'::jsonb) || v_business_trip));
  END IF;

  IF p_patch ? 'days' THEN v_forward := v_forward || jsonb_build_object('days', p_patch->'days'); END IF;
  IF p_patch ? 'inclusions' THEN v_forward := v_forward || jsonb_build_object('inclusions', p_patch->'inclusions'); END IF;
  IF p_patch ? 'intake_schemas' THEN v_forward := v_forward || jsonb_build_object('intake_schemas', p_patch->'intake_schemas'); END IF;

  -- Deposit/instalment bounds are validated for BOTH vocabularies before
  -- anything is delegated or written.
  IF p_patch ? 'pricing_tiers' THEN
    IF jsonb_typeof(p_patch->'pricing_tiers') <> 'array' THEN
      RAISE EXCEPTION 'trip_tiers_invalid' USING ERRCODE = '22023';
    END IF;
    FOR v_item IN SELECT value FROM jsonb_array_elements(p_patch->'pricing_tiers') LOOP
      PERFORM public.biz_validate_trip_installment_schedule(v_item->'tier_metadata');
    END LOOP;
  END IF;

  IF p_patch ? 'tiers' THEN
    IF jsonb_typeof(p_patch->'tiers') <> 'array' THEN
      RAISE EXCEPTION 'trip_tiers_invalid' USING ERRCODE = '22023';
    END IF;
    FOR v_item IN SELECT value FROM jsonb_array_elements(p_patch->'tiers') LOOP
      IF NOT COALESCE((v_item->>'deleted')::boolean, false) THEN
        PERFORM public.biz_validate_trip_installment_schedule(v_item->'tier_metadata');
      END IF;
    END LOOP;
    -- The live gate expects the COMPLETE retained tier set. Merge the requested
    -- changes into the stored set and omit explicit deletes; new rows are added
    -- only after the gate's sold-count/refund/readiness checks return ok.
    v_forward := v_forward || jsonb_build_object('pricing_tiers', COALESCE((
      SELECT jsonb_agg(base || COALESCE(change, '{}'::jsonb)
                       ORDER BY (base->>'display_order')::int)
        FROM (
          SELECT jsonb_build_object(
                   'ticket_type_id', tt.id,
                   'tier_name', t.tier_name,
                   'tier_metadata', t.tier_metadata,
                   'price_cents', tt.price_cents,
                   'capacity', tt.quantity_total,
                   'display_order', tt.display_order) AS base,
                 (SELECT item FROM jsonb_array_elements(p_patch->'tiers') item
                   WHERE NULLIF(item->>'ticket_type_id', '')::uuid = tt.id LIMIT 1) AS change
            FROM public.trip_pricing_tiers t
            JOIN public.ticket_types tt ON tt.id = t.ticket_type_id
           WHERE t.event_id = p_event_id AND tt.deleted_at IS NULL
        ) retained
       WHERE NOT COALESCE((change->>'deleted')::boolean, false)
    ), '[]'::jsonb));

    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_patch->'tiers') item
       WHERE NULLIF(item->>'ticket_type_id', '') IS NULL
         AND COALESCE((item->>'price_cents')::int, 0) > 0
    ) AND NOT public.pg_brand_can_collect(v_event.brand_id) THEN
      v_result := jsonb_build_object('ok', false, 'reason', 'stripe_charges_disabled');
      RETURN public.biz_trip_command_finish(p_operation_id, v_result);
    END IF;
  END IF;

  IF p_patch ? 'settings' THEN
    IF jsonb_typeof(p_patch->'settings') <> 'object' THEN
      RAISE EXCEPTION 'trip_settings_patch_invalid' USING ERRCODE = '22023';
    END IF;
    v_forward := v_forward || (p_patch->'settings');
  END IF;

  -- Delegate to the proven audited/refund-safe live authority. Its safety logic
  -- is reused, never forked or weakened.
  v_result := public.issue_1719_update_live_trip_with_poster(p_event_id, v_forward, p_reason);
  IF NOT COALESCE((v_result->>'ok')::boolean, false) THEN
    RETURN public.biz_trip_command_finish(p_operation_id, v_result);
  END IF;

  -- Ari-only tier lifecycle the live gate does not own: explicit removals and
  -- brand-new tiers, applied after the gate approved the retained set.
  IF p_patch ? 'tiers' THEN
    FOR v_item IN SELECT value FROM jsonb_array_elements(p_patch->'tiers') LOOP
      IF COALESCE((v_item->>'deleted')::boolean, false) THEN
        IF EXISTS (
          SELECT 1 FROM public.tickets
           WHERE ticket_type_id = NULLIF(v_item->>'ticket_type_id', '')::uuid
             AND status IN ('valid', 'used', 'transferred')
        ) THEN
          RAISE EXCEPTION 'tier_delete_with_sales';
        END IF;
        UPDATE public.ticket_types SET deleted_at = now(), updated_at = now()
         WHERE id = NULLIF(v_item->>'ticket_type_id', '')::uuid
           AND event_id = p_event_id AND deleted_at IS NULL;
      ELSIF NULLIF(v_item->>'ticket_type_id', '') IS NULL THEN
        IF NULLIF(btrim(v_item->>'tier_name'), '') IS NULL
           OR COALESCE((v_item->>'price_cents')::int, -1) < 0
           OR COALESCE((v_item->>'capacity')::int, 0) < 1 THEN
          RAISE EXCEPTION 'trip_tier_invalid' USING ERRCODE = '22023';
        END IF;
        INSERT INTO public.ticket_types(
          event_id, name, price_cents, currency, quantity_total, is_unlimited,
          is_free, min_purchase_qty, available_online, available_in_person, display_order
        ) VALUES (
          p_event_id, v_item->>'tier_name', (v_item->>'price_cents')::int,
          v_event.currency, (v_item->>'capacity')::int, false,
          (v_item->>'price_cents')::int = 0, 1, true, false,
          COALESCE((v_item->>'display_order')::int, 0)
        ) RETURNING id INTO v_ticket_type;
        INSERT INTO public.trip_pricing_tiers(event_id, ticket_type_id, tier_name, tier_metadata)
        VALUES (p_event_id, v_ticket_type, v_item->>'tier_name',
                COALESCE(v_item->'tier_metadata', '{}'::jsonb));
      END IF;
    END LOOP;
  END IF;

  IF p_patch ? 'settings' THEN
    UPDATE public.events SET
      pass_tax = CASE WHEN (p_patch->'settings') ? 'pass_tax'
                THEN (p_patch#>>'{settings,pass_tax}')::boolean ELSE pass_tax END,
      pass_mingla_fee = CASE WHEN (p_patch->'settings') ? 'pass_mingla_fee'
                THEN (p_patch#>>'{settings,pass_mingla_fee}')::boolean ELSE pass_mingla_fee END,
      pass_service_fee = CASE WHEN (p_patch->'settings') ? 'pass_service_fee'
                THEN (p_patch#>>'{settings,pass_service_fee}')::boolean ELSE pass_service_fee END,
      updated_at = now()
     WHERE id = p_event_id;
  END IF;

  v_result := v_result || jsonb_build_object(
    'graph', public.biz_get_trip_draft_graph(p_event_id),
    'revision', (SELECT updated_at FROM public.events WHERE id = p_event_id));
  RETURN public.biz_trip_command_finish(p_operation_id, v_result);
END;
$fn$;

-- ---------------------------------------------------------------------------
-- 7. Publish. The payload is reconstructed from PERSISTED state; a caller can
--    no longer supply `{}` or a partial graph.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.biz_publish_trip_command(
  p_event_id uuid,
  p_expected_updated_at timestamptz,
  p_operation_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_event public.events%ROWTYPE;
  v_begin jsonb;
  v_result jsonb;
  v_start timestamptz;
  v_end timestamptz;
  v_payload jsonb;
BEGIN
  SELECT * INTO v_event FROM public.events WHERE id = p_event_id FOR UPDATE;
  IF NOT FOUND OR v_event.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'trip_not_found';
  END IF;
  IF v_event.event_type <> 'trip' THEN RAISE EXCEPTION 'event_not_a_trip'; END IF;
  PERFORM public.biz_trip_require_manager(v_event.brand_id);

  v_begin := public.biz_trip_command_begin(
    p_operation_id, 'publish_trip', v_event.brand_id, p_event_id,
    jsonb_build_object('expected_updated_at', p_expected_updated_at));
  IF (v_begin->>'replay')::boolean THEN RETURN v_begin->'result'; END IF;

  IF p_expected_updated_at IS NULL
     OR v_event.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'trip_revision_conflict' USING ERRCODE = '40001';
  END IF;

  SELECT start_at, end_at INTO v_start, v_end
    FROM public.event_dates
   WHERE event_id = p_event_id AND is_master = true
   ORDER BY start_at LIMIT 1;

  v_payload := jsonb_build_object(
    'title', v_event.title,
    'description', v_event.description,
    'timezone', v_event.timezone,
    'cover_media_url', v_event.cover_media_url,
    'cover_media_poster_url', v_event.cover_media_poster_url,
    'cover_media_type', v_event.cover_media_type,
    'cover_media_provider', v_event.cover_media_provider,
    'cover_media_source_url', v_event.cover_media_source_url,
    'cover_media_credit', v_event.cover_media_credit,
    'cover_media_credit_url', v_event.cover_media_credit_url,
    'cover_media_alt', v_event.cover_media_alt,
    'cover_media_gallery', v_event.cover_media_gallery,
    'theme', jsonb_set(
      COALESCE(v_event.theme, '{}'::jsonb),
      '{business_trip}',
      COALESCE(v_event.theme->'business_trip', '{}'::jsonb) || jsonb_build_object(
        'destinationLocationText', v_event.destination_text,
        'departureLocationText', v_event.departure_text,
        'startAt', v_start,
        'endAt', v_end),
      true));

  -- All current required-day, pricing-tier, capacity, destination/date,
  -- paid-readiness, past-date, slug and poster validations stay with the
  -- existing owner.
  v_result := public.issue_1719_publish_trip_with_poster(p_event_id, v_payload, NULL);
  IF COALESCE((v_result->>'ok')::boolean, true) THEN
    v_result := v_result || jsonb_build_object(
      'graph', public.biz_get_trip_draft_graph(p_event_id),
      'revision', (SELECT updated_at FROM public.events WHERE id = p_event_id));
  END IF;
  RETURN public.biz_trip_command_finish(p_operation_id, v_result);
END;
$fn$;

-- ---------------------------------------------------------------------------
-- 8. Soft delete, serialized against confirmed-order arrival.
--
-- `biz_trip_has_web_purchases` stays a notification-only predicate: it sees only
-- card/Apple Pay/Google Pay and would silently permit deleting a trip with
-- confirmed door/manual orders. It is deliberately NOT used here.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.biz_soft_delete_trip(
  p_event_id uuid,
  p_expected_updated_at timestamptz,
  p_operation_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_event public.events%ROWTYPE;
  v_begin jsonb;
  v_result jsonb;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_event_id::text, 1971));
  SELECT * INTO v_event FROM public.events WHERE id = p_event_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'trip_not_found'; END IF;
  IF v_event.event_type <> 'trip' THEN RAISE EXCEPTION 'event_not_a_trip'; END IF;
  PERFORM public.biz_trip_require_manager(v_event.brand_id);

  v_begin := public.biz_trip_command_begin(
    p_operation_id, 'delete_trip', v_event.brand_id, p_event_id,
    jsonb_build_object('expected_updated_at', p_expected_updated_at));
  IF (v_begin->>'replay')::boolean THEN RETURN v_begin->'result'; END IF;

  IF v_event.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'trip_not_found'; END IF;
  IF p_expected_updated_at IS NULL
     OR v_event.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'trip_revision_conflict' USING ERRCODE = '40001';
  END IF;

  -- Every payment rail, not just the web ones.
  IF EXISTS (
    SELECT 1 FROM public.orders
     WHERE event_id = p_event_id
       AND payment_status NOT IN ('failed', 'cancelled')
  ) THEN
    v_result := jsonb_build_object(
      'id', p_event_id, 'deleted', false, 'rejected', true,
      'reason', 'has_confirmed_orders', 'prior_status', v_event.status);
    RETURN public.biz_trip_command_finish(p_operation_id, v_result);
  END IF;

  UPDATE public.events SET deleted_at = now(), updated_at = now() WHERE id = p_event_id;
  v_result := jsonb_build_object(
    'id', p_event_id, 'deleted', true, 'rejected', false,
    'prior_status', v_event.status);
  RETURN public.biz_trip_command_finish(p_operation_id, v_result);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.biz_trip_order_delete_lock()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_event_id uuid := NEW.event_id;
  v_is_trip boolean;
BEGIN
  IF v_event_id IS NULL THEN RETURN NEW; END IF;
  IF NEW.payment_status IN ('failed', 'cancelled') THEN RETURN NEW; END IF;

  -- CHECK -> LOCK -> RE-CHECK. Taking the advisory lock BEFORE establishing that
  -- this is even a trip order made every concert, stay and venue order on the
  -- platform serialise against every other order on the same event: MEASURED at
  -- 1.71s for a second concurrent concert order against 0.02s on a different
  -- event. A trips issue must not slow checkout for products it does not own.
  --
  -- The unlocked read is a FAST PATH, never the authority: `event_type` is NOT
  -- immutable in this schema (see 20270418002009), so a row can cross types
  -- concurrently. Non-trips leave here and never touch the lock; trips take it
  -- and then re-read `deleted_at` UNDER it, which is where the delete/order
  -- serialisation this trigger exists for actually happens.
  SELECT (event_type = 'trip') INTO v_is_trip
    FROM public.events WHERE id = v_event_id;
  IF NOT COALESCE(v_is_trip, false) THEN RETURN NEW; END IF;

  -- Same advisory key the delete command takes, so the two directions serialize
  -- on one point instead of racing a best-effort pre-query. Lock ordering is
  -- uniform across both sides — advisory first, row locks after — so the
  -- trigger never holds a row lock while waiting for the advisory key.
  PERFORM pg_advisory_xact_lock(hashtextextended(v_event_id::text, 1971));
  IF EXISTS (
    SELECT 1 FROM public.events
     WHERE id = v_event_id AND event_type = 'trip' AND deleted_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'trip_deleted_order_forbidden';
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_biz_trip_order_delete_lock ON public.orders;
CREATE TRIGGER trg_biz_trip_order_delete_lock
  BEFORE INSERT OR UPDATE OF event_id, payment_status ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.biz_trip_order_delete_lock();

-- ---------------------------------------------------------------------------
-- 9. Aggregate order/money read. finance_manager+, fail-closed, no buyer PII.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.biz_get_trip_order_money_snapshot(p_event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_event public.events%ROWTYPE;
BEGIN
  SELECT * INTO v_event FROM public.events
   WHERE id = p_event_id AND event_type = 'trip' AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'trip_not_found'; END IF;
  PERFORM public.biz_trip_require_finance(v_event.brand_id);

  RETURN jsonb_build_object(
    'event_id', p_event_id,
    'status', v_event.status,
    'currency', v_event.currency,
    'order_count', (SELECT count(*) FROM public.orders WHERE event_id = p_event_id),
    'gross_cents', COALESCE((
      SELECT sum(total_cents) FROM public.orders
       WHERE event_id = p_event_id AND payment_status NOT IN ('failed', 'cancelled')), 0),
    'refunded_cents', COALESCE((
      SELECT sum(refunded_amount_cents) FROM public.orders WHERE event_id = p_event_id), 0),
    'orders_by_payment_status', COALESCE((
      SELECT jsonb_object_agg(payment_status, n) FROM (
        SELECT payment_status, count(*) n FROM public.orders
         WHERE event_id = p_event_id GROUP BY payment_status) s), '{}'::jsonb),
    'orders_by_refund_status', COALESCE((
      SELECT jsonb_object_agg(refund_bucket, n) FROM (
        SELECT CASE
                 WHEN COALESCE(refunded_amount_cents, 0) = 0 THEN 'none'
                 WHEN refunded_amount_cents >= total_cents THEN 'full'
                 ELSE 'partial' END AS refund_bucket,
               count(*) n
          FROM public.orders WHERE event_id = p_event_id GROUP BY 1) r), '{}'::jsonb),
    'sold_by_tier', COALESCE((
      SELECT jsonb_object_agg(ticket_type_id, n) FROM (
        SELECT ticket_type_id, count(*) n FROM public.tickets
         WHERE event_id = p_event_id AND status IN ('valid', 'used', 'transferred')
         GROUP BY ticket_type_id) t), '{}'::jsonb),
    'installments_by_status', COALESCE((
      SELECT jsonb_object_agg(status, jsonb_build_object('count', n, 'amount_cents', amount_cents))
        FROM (
          SELECT oi.status, count(*) n, sum(oi.amount_cents) amount_cents
            FROM public.order_installments oi
            JOIN public.orders o ON o.id = oi.order_id
           WHERE o.event_id = p_event_id GROUP BY oi.status) i), '{}'::jsonb),
    'installments_by_due_bucket', jsonb_build_object(
      'overdue', jsonb_build_object(
        'count', (SELECT count(*) FROM public.order_installments oi
                    JOIN public.orders o ON o.id = oi.order_id
                   WHERE o.event_id = p_event_id
                     AND oi.status IN ('scheduled', 'failed') AND oi.due_at < now()),
        'amount_cents', COALESCE((SELECT sum(oi.amount_cents) FROM public.order_installments oi
                    JOIN public.orders o ON o.id = oi.order_id
                   WHERE o.event_id = p_event_id
                     AND oi.status IN ('scheduled', 'failed') AND oi.due_at < now()), 0)),
      'due_next_30_days', jsonb_build_object(
        'count', (SELECT count(*) FROM public.order_installments oi
                    JOIN public.orders o ON o.id = oi.order_id
                   WHERE o.event_id = p_event_id AND oi.status = 'scheduled'
                     AND oi.due_at >= now() AND oi.due_at < now() + interval '30 days'),
        'amount_cents', COALESCE((SELECT sum(oi.amount_cents) FROM public.order_installments oi
                    JOIN public.orders o ON o.id = oi.order_id
                   WHERE o.event_id = p_event_id AND oi.status = 'scheduled'
                     AND oi.due_at >= now() AND oi.due_at < now() + interval '30 days'), 0)),
      'later', jsonb_build_object(
        'count', (SELECT count(*) FROM public.order_installments oi
                    JOIN public.orders o ON o.id = oi.order_id
                   WHERE o.event_id = p_event_id AND oi.status = 'scheduled'
                     AND oi.due_at >= now() + interval '30 days'),
        'amount_cents', COALESCE((SELECT sum(oi.amount_cents) FROM public.order_installments oi
                    JOIN public.orders o ON o.id = oi.order_id
                   WHERE o.event_id = p_event_id AND oi.status = 'scheduled'
                     AND oi.due_at >= now() + interval '30 days'), 0))));
END;
$fn$;

-- ---------------------------------------------------------------------------
-- 10. Ari entry point. Consumes #1972's generic pending-action receipt so a
--     confirmed chat action commits the domain mutation and the recovery
--     receipt in ONE transaction.
-- ---------------------------------------------------------------------------
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
  -- `NULL NOT IN (...)` is NULL and `IF NULL THEN` does not execute, so a NULL
  -- tool name would fall past this allowlist and be refused further downstream
  -- by #1972's receipt function instead. That still fails closed, but it means
  -- the allowlist is not doing the work it appears to. Make it explicit.
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

-- ---------------------------------------------------------------------------
-- 11. Sidecar RLS floor. The deployed write policies used a
--     brand-membership-for-READ predicate, so scanner-class members could
--     attempt graph mutation. Canonical writes go through the commands above;
--     any remaining direct write requires event_manager+.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS trip_days_write_brand_members ON public.trip_days;
DROP POLICY IF EXISTS trip_days_write_event_managers ON public.trip_days;
CREATE POLICY trip_days_write_event_managers ON public.trip_days FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.events e
                  WHERE e.id = trip_days.event_id AND e.event_type = 'trip'
                    AND public.biz_brand_effective_rank(e.brand_id, auth.uid())
                          >= public.biz_role_rank('event_manager')))
  WITH CHECK (EXISTS (SELECT 1 FROM public.events e
                  WHERE e.id = trip_days.event_id AND e.event_type = 'trip'
                    AND public.biz_brand_effective_rank(e.brand_id, auth.uid())
                          >= public.biz_role_rank('event_manager')));

DROP POLICY IF EXISTS trip_inclusions_write_brand_members ON public.trip_inclusions;
DROP POLICY IF EXISTS trip_inclusions_write_event_managers ON public.trip_inclusions;
CREATE POLICY trip_inclusions_write_event_managers ON public.trip_inclusions FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.events e
                  WHERE e.id = trip_inclusions.event_id AND e.event_type = 'trip'
                    AND public.biz_brand_effective_rank(e.brand_id, auth.uid())
                          >= public.biz_role_rank('event_manager')))
  WITH CHECK (EXISTS (SELECT 1 FROM public.events e
                  WHERE e.id = trip_inclusions.event_id AND e.event_type = 'trip'
                    AND public.biz_brand_effective_rank(e.brand_id, auth.uid())
                          >= public.biz_role_rank('event_manager')));

DROP POLICY IF EXISTS trip_pricing_tiers_write_brand_members ON public.trip_pricing_tiers;
DROP POLICY IF EXISTS trip_pricing_tiers_write_event_managers ON public.trip_pricing_tiers;
CREATE POLICY trip_pricing_tiers_write_event_managers ON public.trip_pricing_tiers FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.events e
                  WHERE e.id = trip_pricing_tiers.event_id AND e.event_type = 'trip'
                    AND public.biz_brand_effective_rank(e.brand_id, auth.uid())
                          >= public.biz_role_rank('event_manager')))
  WITH CHECK (EXISTS (SELECT 1 FROM public.events e
                  WHERE e.id = trip_pricing_tiers.event_id AND e.event_type = 'trip'
                    AND public.biz_brand_effective_rank(e.brand_id, auth.uid())
                          >= public.biz_role_rank('event_manager')));

-- ---------------------------------------------------------------------------
-- 12. Grants. Internals are private; only the six commands and the Ari entry
--     point are callable, and only by an authenticated caller.
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION
  public.biz_trip_command_begin(uuid, text, uuid, uuid, jsonb),
  public.biz_trip_command_finish(uuid, jsonb),
  public.biz_trip_require_manager(uuid),
  public.biz_trip_require_finance(uuid),
  public.biz_validate_trip_installment_schedule(jsonb),
  public.biz_get_trip_draft_graph(uuid)
  FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION
  public.biz_create_trip_draft(uuid, jsonb, uuid),
  public.biz_apply_trip_draft_graph(uuid, jsonb, timestamptz, uuid),
  public.biz_update_trip_live_command(uuid, jsonb, text, timestamptz, uuid),
  public.biz_publish_trip_command(uuid, timestamptz, uuid),
  public.biz_soft_delete_trip(uuid, timestamptz, uuid),
  public.biz_get_trip_order_money_snapshot(uuid),
  public.biz_trip_order_delete_lock(),
  public.ari_execute_trip_operation(uuid, text, jsonb)
  FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION
  public.biz_create_trip_draft(uuid, jsonb, uuid),
  public.biz_apply_trip_draft_graph(uuid, jsonb, timestamptz, uuid),
  public.biz_update_trip_live_command(uuid, jsonb, text, timestamptz, uuid),
  public.biz_publish_trip_command(uuid, timestamptz, uuid),
  public.biz_soft_delete_trip(uuid, timestamptz, uuid),
  public.biz_get_trip_order_money_snapshot(uuid),
  public.ari_execute_trip_operation(uuid, text, jsonb)
  TO authenticated, service_role;

COMMIT;
