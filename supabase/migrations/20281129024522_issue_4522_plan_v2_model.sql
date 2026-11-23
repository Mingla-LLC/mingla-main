-- issue #4522 M1 — trip payment plans v2: the model, the server switch (off),
-- the plan validator, the publish guard and the refund-policy keys.
--
-- Nothing here changes what a buyer, host or cron sees today:
--   * issue_4522_plan_v2_enabled() returns false, so the validator refuses
--     every `tier_metadata.payment_plan` save (payment_plan_v2_unavailable).
--   * Every new column has a default (or is NULL) that existing rows and
--     writers already satisfy; `superseded` is a new status nothing writes yet.
--   * Legacy `tier_metadata.installments` checks are byte-for-byte unchanged.
-- Re-emitted from their latest bodies, each guarded by an md5 drift check:
--   biz_validate_trip_installment_schedule  (20270509001971) — v2 prefix, STABLE
--   trg_trip_publish_installment_capability_guard (20280203003645) — also matches payment_plan
--   validate_refund_policy (20260612000000 + 20280707414423 search_path) — two optional keys
--   biz_apply_trip_draft_graph (20271231204134) — share_payment_plan + price check
-- Static SQL only. Conflicts would raise PT409, never 40001 (none are raised here).

BEGIN;
SET LOCAL lock_timeout = '10s';

DO $drift$
DECLARE r record; v_actual text;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('public.biz_validate_trip_installment_schedule(jsonb)','53868a849cf5eb61e67ee526062810df'),
    ('public.trg_trip_publish_installment_capability_guard()','431fe2d4218c64b4d944909fe6bfe8c7'),
    ('public.validate_refund_policy(jsonb)','d94510c2539a495ca8b4d156fd2803d6'),
    ('public.biz_apply_trip_draft_graph(uuid,jsonb,timestamptz,uuid)','d1ed5bf5bd52f6cb68c31933e7e9fb10')
  ) v(sig,expected_md5) LOOP
    SELECT md5(pg_get_functiondef(r.sig::regprocedure)) INTO v_actual;
    IF v_actual IS DISTINCT FROM r.expected_md5 THEN
      RAISE EXCEPTION 'issue #4522 M1 drift: % expected %, got %',r.sig,r.expected_md5,v_actual;
    END IF;
  END LOOP;
END;
$drift$;

-- ---------------------------------------------------------------------------
-- 1. The one server switch. Flipped only by M5 (slice 13).
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.issue_4522_plan_v2_enabled()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$ SELECT false $fn$;

REVOKE ALL ON FUNCTION public.issue_4522_plan_v2_enabled() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4522_plan_v2_enabled() TO service_role;
COMMENT ON FUNCTION public.issue_4522_plan_v2_enabled() IS
  'Issue #4522: the single server switch for saving v2 trip plans, quoting them and taking flexible payments. False until the M5 switch-on migration.';

-- ---------------------------------------------------------------------------
-- 2. The v2 plan shape (`tier_metadata.payment_plan`, v = 2). Pure.
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.issue_4522_is_whole(p_value jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $fn$
  SELECT COALESCE(jsonb_typeof(p_value) = 'number'
     AND (p_value #>> '{}')::numeric = trunc((p_value #>> '{}')::numeric), false)
$fn$;
REVOKE ALL ON FUNCTION public.issue_4522_is_whole(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4522_is_whole(jsonb) TO service_role;

CREATE FUNCTION public.issue_4522_validate_payment_plan(p_plan jsonb)
RETURNS void
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_deposit jsonb;
  v_flex jsonb;
  v_custom jsonb;
  v_count integer;
  v_entry jsonb;
BEGIN
  IF p_plan IS NULL OR jsonb_typeof(p_plan) <> 'object'
     OR NOT public.issue_4522_is_whole(p_plan->'v')
     OR (p_plan->>'v')::numeric <> 2
     OR EXISTS (SELECT 1 FROM jsonb_object_keys(p_plan) k
                 WHERE k <> ALL (ARRAY['v','deposit','count','final_due_days_before_start',
                                       'auto_adjust','flex','custom_amounts_minor']))
     OR (p_plan ? 'auto_adjust' AND jsonb_typeof(p_plan->'auto_adjust') <> 'boolean') THEN
    RAISE EXCEPTION 'plan_version_invalid' USING ERRCODE = '22023';
  END IF;

  v_deposit := p_plan->'deposit';
  IF v_deposit IS NULL OR jsonb_typeof(v_deposit) <> 'object' THEN
    RAISE EXCEPTION 'plan_deposit_invalid' USING ERRCODE = '22023';
  END IF;
  IF v_deposit->>'mode' = 'percent' THEN
    IF jsonb_typeof(v_deposit->'pct') <> 'number'
       OR (v_deposit->>'pct')::numeric < 1 OR (v_deposit->>'pct')::numeric > 100
       OR v_deposit ? 'amount_minor' THEN
      RAISE EXCEPTION 'plan_deposit_invalid' USING ERRCODE = '22023';
    END IF;
  ELSIF v_deposit->>'mode' = 'amount' THEN
    IF NOT public.issue_4522_is_whole(v_deposit->'amount_minor')
       OR (v_deposit->>'amount_minor')::numeric < 100
       OR v_deposit ? 'pct' THEN
      RAISE EXCEPTION 'plan_deposit_invalid' USING ERRCODE = '22023';
    END IF;
  ELSE
    RAISE EXCEPTION 'plan_deposit_invalid' USING ERRCODE = '22023';
  END IF;

  IF NOT public.issue_4522_is_whole(p_plan->'count')
     OR (p_plan->>'count')::numeric < 1 OR (p_plan->>'count')::numeric > 12 THEN
    RAISE EXCEPTION 'plan_count_out_of_range' USING ERRCODE = '22023';
  END IF;
  v_count := (p_plan->>'count')::integer;

  IF NOT public.issue_4522_is_whole(p_plan->'final_due_days_before_start')
     OR (p_plan->>'final_due_days_before_start')::numeric < 0
     OR (p_plan->>'final_due_days_before_start')::numeric > 180 THEN
    RAISE EXCEPTION 'plan_final_due_out_of_range' USING ERRCODE = '22023';
  END IF;

  v_flex := p_plan->'flex';
  IF v_flex IS NOT NULL THEN
    IF jsonb_typeof(v_flex) <> 'object' OR jsonb_typeof(v_flex->'enabled') <> 'boolean' THEN
      RAISE EXCEPTION 'plan_flex_min_invalid' USING ERRCODE = '22023';
    END IF;
    IF (v_flex->>'enabled')::boolean
       AND (NOT public.issue_4522_is_whole(v_flex->'min_payment_minor')
            OR (v_flex->>'min_payment_minor')::numeric < 100) THEN
      RAISE EXCEPTION 'plan_flex_min_invalid' USING ERRCODE = '22023';
    END IF;
  END IF;

  v_custom := p_plan->'custom_amounts_minor';
  IF v_custom IS NOT NULL AND jsonb_typeof(v_custom) <> 'null' THEN
    IF jsonb_typeof(v_custom) <> 'array' OR jsonb_array_length(v_custom) <> v_count - 1 THEN
      RAISE EXCEPTION 'plan_custom_amounts_invalid' USING ERRCODE = '22023';
    END IF;
    FOR v_entry IN SELECT value FROM jsonb_array_elements(v_custom) LOOP
      IF NOT public.issue_4522_is_whole(v_entry) OR (v_entry #>> '{}')::numeric < 100 THEN
        RAISE EXCEPTION 'plan_custom_amounts_invalid' USING ERRCODE = '22023';
      END IF;
    END LOOP;
  END IF;
END;
$fn$;
REVOKE ALL ON FUNCTION public.issue_4522_validate_payment_plan(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4522_validate_payment_plan(jsonb) TO service_role;
COMMENT ON FUNCTION public.issue_4522_validate_payment_plan(jsonb) IS
  'Issue #4522: shape checks for tier_metadata.payment_plan (v2). Every failure raises its named code with SQLSTATE 22023.';

-- ---------------------------------------------------------------------------
-- 3. The tier validator: the v2 prefix, then every v1 check unchanged.
--    STABLE (was IMMUTABLE) because it now reads the switch.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.biz_validate_trip_installment_schedule(p_tier_metadata jsonb)
RETURNS void
LANGUAGE plpgsql STABLE SET search_path = public, pg_temp
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
  -- issue #4522 — the v2 plan shape (`payment_plan`). A tier holds one shape
  -- or the other, never both; v2 is refused while the server switch is off.
  IF p_tier_metadata IS NOT NULL
     AND p_tier_metadata ? 'payment_plan'
     AND jsonb_typeof(p_tier_metadata->'payment_plan') <> 'null' THEN
    IF p_tier_metadata ? 'installments'
       AND jsonb_typeof(p_tier_metadata->'installments') <> 'null' THEN
      RAISE EXCEPTION 'payment_plan_shape_conflict' USING ERRCODE = '22023';
    END IF;
    IF NOT public.issue_4522_plan_v2_enabled() THEN
      RAISE EXCEPTION 'payment_plan_v2_unavailable' USING ERRCODE = 'P0001';
    END IF;
    PERFORM public.issue_4522_validate_payment_plan(p_tier_metadata->'payment_plan');
    RETURN;
  END IF;

  -- #4522: legacy percent plan, retired when no live v1 trip remains.
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

REVOKE ALL ON FUNCTION public.biz_validate_trip_installment_schedule(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.biz_validate_trip_installment_schedule(jsonb) TO service_role;

-- ---------------------------------------------------------------------------
-- 4. A v2 plan against its package price (per traveler).
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.biz_validate_trip_plan_against_price(
  p_tier_metadata jsonb,
  p_unit_price_minor bigint
) RETURNS void
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_plan jsonb;
  v_price bigint := COALESCE(p_unit_price_minor, 0);
  v_deposit bigint;
  v_custom_sum bigint := 0;
BEGIN
  IF p_tier_metadata IS NULL OR NOT (p_tier_metadata ? 'payment_plan')
     OR jsonb_typeof(p_tier_metadata->'payment_plan') = 'null' THEN
    RETURN;
  END IF;
  v_plan := p_tier_metadata->'payment_plan';
  IF v_plan#>>'{deposit,mode}' = 'amount' THEN
    v_deposit := (v_plan#>>'{deposit,amount_minor}')::bigint;
    IF v_deposit > v_price THEN
      RAISE EXCEPTION 'plan_deposit_invalid' USING ERRCODE = '22023';
    END IF;
  ELSE
    v_deposit := floor(v_price::numeric * (v_plan#>>'{deposit,pct}')::numeric / 100)::bigint;
  END IF;
  IF jsonb_typeof(v_plan->'custom_amounts_minor') = 'array' THEN
    SELECT COALESCE(sum((x #>> '{}')::bigint), 0) INTO v_custom_sum
      FROM jsonb_array_elements(v_plan->'custom_amounts_minor') x;
    IF jsonb_array_length(v_plan->'custom_amounts_minor') > 0
       AND v_custom_sum >= v_price - v_deposit THEN
      RAISE EXCEPTION 'plan_custom_amounts_exceed_balance' USING ERRCODE = '22023';
    END IF;
  END IF;
  IF COALESCE((v_plan#>>'{flex,enabled}')::boolean, false)
     AND (v_plan#>>'{flex,min_payment_minor}')::bigint > v_price - v_deposit THEN
    RAISE EXCEPTION 'plan_flex_min_above_balance' USING ERRCODE = '22023';
  END IF;
END;
$fn$;
REVOKE ALL ON FUNCTION public.biz_validate_trip_plan_against_price(jsonb, bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.biz_validate_trip_plan_against_price(jsonb, bigint) TO service_role;
COMMENT ON FUNCTION public.biz_validate_trip_plan_against_price(jsonb, bigint) IS
  'Issue #4522: a v2 plan must fit its per-traveler package price (amount deposit, custom amounts, smallest flexible payment).';

-- ---------------------------------------------------------------------------
-- 5. "Use this plan for all packages" — stored beside refund_policy and
--    booking_deadline on events (the trip settings row).
-- ---------------------------------------------------------------------------
ALTER TABLE public.events
  ADD COLUMN share_payment_plan boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.events.share_payment_plan IS
  'Issue #4522: when true, biz_apply_trip_draft_graph copies the first package''s payment_plan to every package of the trip in the same save.';

CREATE FUNCTION public.issue_4522_apply_shared_plan(p_event_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_shared jsonb;
  v_tier record;
BEGIN
  IF COALESCE((SELECT e.share_payment_plan FROM public.events e WHERE e.id = p_event_id), false) THEN
    SELECT t.tier_metadata->'payment_plan' INTO v_shared
      FROM public.trip_pricing_tiers t
      JOIN public.ticket_types tt ON tt.id = t.ticket_type_id AND tt.deleted_at IS NULL
     WHERE t.event_id = p_event_id
     ORDER BY tt.display_order, tt.created_at, tt.id
     LIMIT 1;
    IF v_shared IS NOT NULL AND jsonb_typeof(v_shared) <> 'null' THEN
      UPDATE public.trip_pricing_tiers t
         SET tier_metadata = (COALESCE(t.tier_metadata, '{}'::jsonb) - 'installments')
                             || jsonb_build_object('payment_plan', v_shared)
        FROM public.ticket_types tt
       WHERE t.event_id = p_event_id
         AND tt.id = t.ticket_type_id AND tt.deleted_at IS NULL
         AND t.tier_metadata->'payment_plan' IS DISTINCT FROM v_shared;
    END IF;
  END IF;

  FOR v_tier IN
    SELECT t.tier_metadata, t.tier_name, tt.price_cents
      FROM public.trip_pricing_tiers t
      JOIN public.ticket_types tt ON tt.id = t.ticket_type_id AND tt.deleted_at IS NULL
     WHERE t.event_id = p_event_id
       AND t.tier_metadata ? 'payment_plan'
       AND jsonb_typeof(t.tier_metadata->'payment_plan') <> 'null'
     ORDER BY tt.display_order, tt.created_at, tt.id
  LOOP
    PERFORM public.biz_validate_trip_installment_schedule(v_tier.tier_metadata);
    BEGIN
      PERFORM public.biz_validate_trip_plan_against_price(v_tier.tier_metadata, v_tier.price_cents);
    EXCEPTION WHEN invalid_parameter_value THEN
      RAISE EXCEPTION '%', SQLERRM USING ERRCODE = '22023', HINT = v_tier.tier_name;
    END;
  END LOOP;
END;
$fn$;
REVOKE ALL ON FUNCTION public.issue_4522_apply_shared_plan(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_4522_apply_shared_plan(uuid) TO service_role;
COMMENT ON FUNCTION public.issue_4522_apply_shared_plan(uuid) IS
  'Issue #4522: copies the first package''s v2 plan to every package when share_payment_plan is on, then checks every v2 plan against its package price (HINT names the package).';

-- ---------------------------------------------------------------------------
-- 6. biz_apply_trip_draft_graph: settings.share_payment_plan + the price check.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.biz_apply_trip_draft_graph(p_event_id uuid, p_patch jsonb, p_expected_updated_at timestamp with time zone, p_operation_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
    RAISE EXCEPTION 'trip_revision_conflict' USING ERRCODE = 'PT409';
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
         'pass_tax', 'pass_mingla_fee', 'pass_service_fee',
         -- issue #4522 — "Use this plan for all packages".
         'share_payment_plan'])
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
      share_payment_plan = CASE WHEN (p_patch->'settings') ? 'share_payment_plan'
                THEN COALESCE((p_patch#>>'{settings,share_payment_plan}')::boolean, false) ELSE share_payment_plan END,
      updated_at = now()
     WHERE id = p_event_id;
  END IF;

  -- issue #4522 — one plan for every package, then every v2 plan is checked
  -- against its own package price. Runs only when this patch touched the
  -- packages or the settings; a trip with no v2 plan passes untouched.
  IF p_patch ? 'tiers' OR p_patch ? 'settings' THEN
    PERFORM public.issue_4522_apply_shared_plan(p_event_id);
  END IF;

  -- A sidecar-only patch still advances the graph revision, so the next
  -- compare-and-swap sees a moved target.
  UPDATE public.events SET updated_at = now() WHERE id = p_event_id;

  v_result := public.biz_get_trip_draft_graph(p_event_id);
  RETURN public.biz_trip_command_finish(p_operation_id, v_result);
END;
$function$;

-- ---------------------------------------------------------------------------
-- 7. Publish guard: a v2 plan is a plan, like a v1 one. No other change.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_trip_publish_installment_capability_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
BEGIN
  IF NEW.event_type = 'trip'
     AND NEW.status IN ('scheduled', 'live')
     -- #4040: refuse only a transition that increases buyer exposure
     -- (draft/hidden 0 < private 1 < public/discover 2).
     AND (
       (OLD.status NOT IN ('scheduled', 'live')
        AND (CASE WHEN NEW.visibility IN ('public', 'discover') THEN 2
                  WHEN NEW.visibility = 'private' THEN 1 ELSE 0 END) > 0)
       OR (CASE WHEN NEW.visibility IN ('public', 'discover') THEN 2
                WHEN NEW.visibility = 'private' THEN 1 ELSE 0 END)
          > (CASE WHEN OLD.visibility IN ('public', 'discover') THEN 2
                  WHEN OLD.visibility = 'private' THEN 1 ELSE 0 END)
     )
     AND EXISTS (
       SELECT 1
         FROM public.trip_pricing_tiers tpt
        WHERE tpt.event_id = NEW.id
          AND (
            (tpt.tier_metadata ? 'installments'
             AND tpt.tier_metadata -> 'installments' IS NOT NULL
             AND jsonb_typeof(tpt.tier_metadata -> 'installments') <> 'null')
            -- issue #4522: the v2 plan shape needs the same capability.
            OR (tpt.tier_metadata ? 'payment_plan'
                AND jsonb_typeof(tpt.tier_metadata -> 'payment_plan') <> 'null')
          )
     )
     AND NOT public.pg_trip_installments_supported(NEW.id) THEN
    RAISE EXCEPTION 'installment_capability_unavailable'
      USING ERRCODE = 'P0001',
            HINT = 'The saved payment setup does not support trip installments.';
  END IF;
  RETURN NEW;
END
$fn$;

REVOKE ALL ON FUNCTION public.trg_trip_publish_installment_capability_guard()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.trg_trip_publish_installment_capability_guard()
  TO service_role;

-- ---------------------------------------------------------------------------
-- 8. Refund policy: two optional keys. `no_refunds: true` needs an empty
--    ladder (the only way an empty ladder is accepted); `deposit_non_refundable`
--    is a boolean. Every existing policy validates exactly as before.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.validate_refund_policy(p_policy jsonb)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_kind text;
  v_tiers jsonb;
  v_prev_days int := -1;
  v_prev_pct int := 101;
  v_tier jsonb;
  v_days int;
  v_pct int;
BEGIN
  IF p_policy IS NULL THEN
    RETURN true;  -- NULL is "no policy" (no refund at any time, semantically equivalent to 0% tier)
  END IF;
  v_kind := p_policy->>'kind';
  IF v_kind NOT IN ('flexible', 'standard', 'strict', 'custom') THEN
    RAISE EXCEPTION 'refund_policy.kind must be flexible|standard|strict|custom (got %)', v_kind;
  END IF;
  -- issue #4522 — optional "No refunds" and "Deposit is non-refundable" keys.
  IF p_policy ? 'deposit_non_refundable'
     AND jsonb_typeof(p_policy->'deposit_non_refundable') <> 'boolean' THEN
    RAISE EXCEPTION 'refund_policy.deposit_non_refundable must be a boolean';
  END IF;
  IF p_policy ? 'no_refunds' AND jsonb_typeof(p_policy->'no_refunds') <> 'boolean' THEN
    RAISE EXCEPTION 'refund_policy.no_refunds must be a boolean';
  END IF;
  v_tiers := p_policy->'tiers';
  IF jsonb_typeof(v_tiers) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'refund_policy.tiers must be a JSONB array';
  END IF;
  IF COALESCE((p_policy->>'no_refunds')::boolean, false) THEN
    IF jsonb_array_length(v_tiers) <> 0 THEN
      RAISE EXCEPTION 'refund_policy.no_refunds needs an empty tiers ladder';
    END IF;
    RETURN true;
  END IF;
  IF jsonb_array_length(v_tiers) = 0 THEN
    RAISE EXCEPTION 'refund_policy.tiers must contain at least 1 tier';
  END IF;
  IF jsonb_array_length(v_tiers) > 8 THEN
    RAISE EXCEPTION 'refund_policy.tiers max 8 tiers (got %)', jsonb_array_length(v_tiers);
  END IF;
  -- Iterate tiers in input order; expect DESC by days_before_start; assert monotonicity.
  FOR v_tier IN SELECT * FROM jsonb_array_elements(v_tiers) LOOP
    v_days := (v_tier->>'days_before_start')::int;
    v_pct := (v_tier->>'refund_pct')::int;
    IF v_days IS NULL OR v_days < 0 THEN
      RAISE EXCEPTION 'tier days_before_start must be int >= 0 (got %)', v_days;
    END IF;
    IF v_pct IS NULL OR v_pct < 0 OR v_pct > 100 THEN
      RAISE EXCEPTION 'tier refund_pct must be int 0-100 (got %)', v_pct;
    END IF;
    IF v_prev_days >= 0 AND v_days >= v_prev_days THEN
      RAISE EXCEPTION 'tier days_before_start must be strictly descending (% then %)', v_prev_days, v_days;
    END IF;
    IF v_pct > v_prev_pct THEN
      RAISE EXCEPTION 'I-PROPOSED-TR4-REFUND-CASCADE-MONOTONICITY: tier refund_pct must be non-increasing (% then %)', v_prev_pct, v_pct;
    END IF;
    v_prev_days := v_days;
    v_prev_pct := v_pct;
  END LOOP;
  RETURN true;
END;
$$;

-- ---------------------------------------------------------------------------
-- 9. order_installments: kind, schedule version, add-on portion, flex line
--    allocation and the `superseded` status (rebalanced away, never money).
-- ---------------------------------------------------------------------------
ALTER TABLE public.order_installments
  ADD COLUMN kind text NOT NULL DEFAULT 'scheduled',
  ADD COLUMN schedule_version integer NOT NULL DEFAULT 0,
  ADD COLUMN addon_portion_minor bigint NOT NULL DEFAULT 0,
  ADD COLUMN line_allocation jsonb NULL,
  ADD COLUMN superseded_at timestamptz NULL;

ALTER TABLE public.order_installments
  ADD CONSTRAINT order_installments_kind_check CHECK (kind IN ('scheduled', 'flex')),
  ADD CONSTRAINT order_installments_schedule_version_check CHECK (schedule_version >= 0),
  ADD CONSTRAINT order_installments_addon_portion_check
    CHECK (addon_portion_minor >= 0 AND addon_portion_minor <= amount_cents);

ALTER TABLE public.order_installments DROP CONSTRAINT order_installments_status_check;
ALTER TABLE public.order_installments
  ADD CONSTRAINT order_installments_status_check
    CHECK (status IN ('scheduled', 'collected', 'failed', 'refunded', 'cancelled', 'superseded')),
  ADD CONSTRAINT order_installments_superseded_at_status_consistent
    CHECK ((status = 'superseded') = (superseded_at IS NOT NULL));

ALTER TABLE public.order_installments
  ADD CONSTRAINT order_installments_flex_has_allocation
    CHECK (kind <> 'flex' OR line_allocation IS NOT NULL) NOT VALID;
ALTER TABLE public.order_installments
  VALIDATE CONSTRAINT order_installments_flex_has_allocation;

CREATE UNIQUE INDEX uq_order_one_open_flex
  ON public.order_installments (order_id)
  WHERE kind = 'flex' AND status IN ('scheduled', 'failed');

COMMENT ON COLUMN public.order_installments.kind IS
  'Issue #4522: scheduled = a planned payment; flex = a traveler''s "pay any amount" payment (never retried by the cron).';
COMMENT ON COLUMN public.order_installments.schedule_version IS
  'Issue #4522: bumped each time a rebalance changes this row''s amount; part of the Stripe idempotency key when > 0.';
COMMENT ON COLUMN public.order_installments.addon_portion_minor IS
  'Issue #4522: the part of amount_cents that pays add-ons chosen "Spread over my plan".';
COMMENT ON COLUMN public.order_installments.line_allocation IS
  'Issue #4522: flex rows only — [{ticket_type_id, net_minor, addon_minor}] summing to amount_cents.';
COMMENT ON COLUMN public.order_installments.superseded_at IS
  'Issue #4522: set with status superseded (rebalanced away or rolled over). A superseded row is no money, not due, and not shown as cancelled.';

-- ---------------------------------------------------------------------------
-- 10. Plan terms and the add-on payment choice, frozen at checkout.
-- ---------------------------------------------------------------------------
ALTER TABLE public.orders
  ADD COLUMN payment_plan_terms jsonb NULL,
  ADD COLUMN addon_payment_mode text NULL;
ALTER TABLE public.orders
  ADD CONSTRAINT orders_addon_payment_mode_check
    CHECK (addon_payment_mode IS NULL OR addon_payment_mode IN ('today', 'spread'));
ALTER TABLE public.ticket_checkout_sessions
  ADD COLUMN payment_plan_terms jsonb NULL,
  ADD COLUMN addon_payment_mode text NULL;
ALTER TABLE public.ticket_checkout_sessions
  ADD CONSTRAINT ticket_checkout_sessions_addon_payment_mode_check
    CHECK (addon_payment_mode IS NULL OR addon_payment_mode IN ('today', 'spread'));
COMMENT ON COLUMN public.orders.payment_plan_terms IS
  'Issue #4522: v2 plan terms frozen at checkout: {v, trip_start_at, final_due_at, time_zone, auto_adjust, flex_enabled, min_payment_minor, deposit_minor, deposit_non_refundable, addon_payment_mode, count_offered, count_given}.';
COMMENT ON COLUMN public.orders.addon_payment_mode IS
  'Issue #4522: add-ons on a v2 plan — today (in the deposit) or spread (in the balance). NULL when no add-on rides a plan.';

-- ---------------------------------------------------------------------------
-- 11. Balance audit and the tokenised "pay toward balance" link. Service role
--     only; hosts, buyers and admins read through RPCs (later slices).
-- ---------------------------------------------------------------------------
CREATE TABLE public.order_balance_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  reason text NOT NULL CHECK (reason IN ('flex_payment', 'missed_rollover', 'addon_removed', 'host_adjust')),
  trigger_installment_id uuid NULL REFERENCES public.order_installments(id) ON DELETE SET NULL,
  before jsonb NOT NULL,
  after jsonb NOT NULL,
  actor uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_order_balance_events_order ON public.order_balance_events (order_id, created_at);
CREATE INDEX idx_order_balance_events_trigger ON public.order_balance_events (trigger_installment_id)
  WHERE trigger_installment_id IS NOT NULL;
ALTER TABLE public.order_balance_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.order_balance_events FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT ON public.order_balance_events TO service_role;
COMMENT ON TABLE public.order_balance_events IS
  'Issue #4522: one row per balance change (flex payment, missed-payment rollover, add-on removed, host adjustment) with the rows before and after.';

CREATE TABLE public.order_balance_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE RESTRICT,
  token_hash bytea NOT NULL UNIQUE CHECK (octet_length(token_hash) = 32),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz NULL,
  revoked_reason text NULL,
  last_opened_at timestamptz NULL,
  open_count integer NOT NULL DEFAULT 0 CHECK (open_count >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uq_order_one_live_balance_link
  ON public.order_balance_links (order_id)
  WHERE revoked_at IS NULL;
ALTER TABLE public.order_balance_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.order_balance_links FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON public.order_balance_links TO service_role;
COMMENT ON TABLE public.order_balance_links IS
  'Issue #4522: tokenised "pay toward your balance" links (SHA-256 of the token only; one live link per order).';

COMMIT;
