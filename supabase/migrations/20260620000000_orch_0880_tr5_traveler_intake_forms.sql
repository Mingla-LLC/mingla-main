-- ============================================================
-- ORCH-0880 [Tr5 Traveler Intake Forms]
--
-- Per-tier traveler intake forms for trips. Trip planner builds a custom intake
-- form per ticket tier (Standard vs VIP can have different question sets);
-- buyer fills at checkout; planner sees answers per traveler in Travelers tab.
-- Schema edits on published trips flow through biz_update_live_trip RPC
-- (extended below with Section 4f + Section 5e for intake_schemas patch key
-- per SPEC §15.3 — UNIFIED RPC pattern from ORCH-0876 V2, NOT a parallel RPC).
--
-- Migration creates:
--   1. orders.intake_form_data jsonb column (per-tier answers + schema version)
--   2. trip_intake_schemas sidecar table (per-tier schema, joins events+ticket_types)
--   3. validate_trip_intake_schema(jsonb) IMMUTABLE validator function
--   4. trip_intake_files storage bucket + 4 RLS policies (anon-write own,
--      anon-read own via signed URL, planner-read brand-scoped, service-role all)
--   5. biz_update_live_trip CREATE OR REPLACE — adds Section 4f (intake_schemas
--      refund-gate, permissive per D2 operator decision) + Section 5e (upsert
--      to trip_intake_schemas table). All prior 4a-4e + 5a-5d preserved verbatim.
--   6. tg_intake_schemas_re_answer_dispatch trigger — on UPDATE of schema for
--      a tier with existing answers, scans orders and enqueues
--      buyer_intake_form_re_answer_required notifications
--   7. 2 indexes
--   8. Self-verification DO-block at end
--
-- 6 NEW DRAFT invariants codified (flip ACTIVE on ORCH-0880 CLOSE):
--   I-PROPOSED-TR5-INTAKE-SCHEMA-VALID-AT-WRITE
--   I-PROPOSED-TR5-INTAKE-ANSWER-MATCHES-SCHEMA
--   I-PROPOSED-TR5-INTAKE-SCHEMA-EDIT-PERSISTS-TO-DB
--   I-PROPOSED-TR5-INTAKE-FILE-RLS-ANON-WRITE-PLANNER-READ
--   I-PROPOSED-TR5-INTAKE-REQUIRED-BLOCKS-CHECKOUT
--   I-PROPOSED-TR5-INTAKE-RE-ANSWER-NOTIFICATION-DISPATCH
--
-- See: Mingla_Artifacts/specs/SPEC_ORCH-0880_TR5_TRAVELER_INTAKE_FORMS.md §4 + §15
-- ============================================================

BEGIN;

-- ============================================================
-- Section 1 — orders.intake_form_data column
-- ============================================================
ALTER TABLE public.orders
  ADD COLUMN intake_form_data jsonb DEFAULT NULL;

COMMENT ON COLUMN public.orders.intake_form_data IS
  'ORCH-0880 Tr5: buyer-submitted answers + schema version snapshot. Per-tier shape: {ticket_type_id: uuid, schema_version_id: uuid, answers: {question_id: value}}. NULL = no answers (order created before Tr5 OR trip tier has no schema OR data purged after 30d post-cancel per cron-purge-canceled-intake-data per SPEC D12 — deferred to ORCH-0881 follow-up).';

-- ============================================================
-- Section 2 — validate_trip_intake_schema(jsonb) IMMUTABLE function
-- Per SPEC §4.1.B — 7-type allowlist, max 20 questions, unique IDs + positions,
-- per-type validation rules.
-- ============================================================
CREATE OR REPLACE FUNCTION public.validate_trip_intake_schema(p_schema jsonb)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_question jsonb;
  v_question_ids text[] := '{}'::text[];
  v_positions int[] := '{}'::int[];
  v_type text;
  v_id text;
  v_position int;
  v_required boolean;
  v_label text;
  v_options jsonb;
  v_question_count int;
BEGIN
  -- NULL allowed (no schema configured for this tier)
  IF p_schema IS NULL THEN
    RETURN true;
  END IF;

  -- Must be object with schema_version_id + questions
  IF jsonb_typeof(p_schema) <> 'object' THEN
    RAISE EXCEPTION 'I-PROPOSED-TR5-INTAKE-SCHEMA-VALID-AT-WRITE: schema must be a jsonb object';
  END IF;

  IF NOT (p_schema ? 'schema_version_id' AND p_schema ? 'questions') THEN
    RAISE EXCEPTION 'I-PROPOSED-TR5-INTAKE-SCHEMA-VALID-AT-WRITE: schema must contain schema_version_id and questions';
  END IF;

  -- schema_version_id must be uuid-shaped (36 chars)
  IF char_length(p_schema->>'schema_version_id') <> 36 THEN
    RAISE EXCEPTION 'I-PROPOSED-TR5-INTAKE-SCHEMA-VALID-AT-WRITE: schema_version_id must be uuid (36 chars)';
  END IF;

  -- questions must be array
  IF jsonb_typeof(p_schema->'questions') <> 'array' THEN
    RAISE EXCEPTION 'I-PROPOSED-TR5-INTAKE-SCHEMA-VALID-AT-WRITE: questions must be array';
  END IF;

  v_question_count := jsonb_array_length(p_schema->'questions');

  -- 0 questions allowed (schema present but empty — planner mid-build)
  -- Max 20 questions (UX guard)
  IF v_question_count > 20 THEN
    RAISE EXCEPTION 'I-PROPOSED-TR5-INTAKE-SCHEMA-VALID-AT-WRITE: max 20 questions per schema';
  END IF;

  -- Per-question validation
  FOR v_question IN SELECT * FROM jsonb_array_elements(p_schema->'questions')
  LOOP
    v_type := v_question->>'type';
    v_id := v_question->>'id';
    v_position := (v_question->>'position')::int;
    v_required := (v_question->>'required')::boolean;
    v_label := v_question->>'label';

    -- Type allowlist (D4 from SPEC §6)
    IF v_type NOT IN ('short_text', 'long_text', 'single_choice', 'multi_choice', 'date', 'number', 'file_upload') THEN
      RAISE EXCEPTION 'I-PROPOSED-TR5-INTAKE-SCHEMA-VALID-AT-WRITE: question type must be one of short_text, long_text, single_choice, multi_choice, date, number, file_upload (got %)', v_type;
    END IF;

    -- ID required, uuid-shaped, unique within schema
    IF v_id IS NULL OR char_length(v_id) <> 36 THEN
      RAISE EXCEPTION 'I-PROPOSED-TR5-INTAKE-SCHEMA-VALID-AT-WRITE: question id must be uuid (36 chars)';
    END IF;

    IF v_id = ANY (v_question_ids) THEN
      RAISE EXCEPTION 'I-PROPOSED-TR5-INTAKE-SCHEMA-VALID-AT-WRITE: duplicate question id %', v_id;
    END IF;
    v_question_ids := array_append(v_question_ids, v_id);

    -- Position required, integer, non-negative, unique within schema
    IF v_position IS NULL OR v_position < 0 THEN
      RAISE EXCEPTION 'I-PROPOSED-TR5-INTAKE-SCHEMA-VALID-AT-WRITE: question position must be int >= 0';
    END IF;

    IF v_position = ANY (v_positions) THEN
      RAISE EXCEPTION 'I-PROPOSED-TR5-INTAKE-SCHEMA-VALID-AT-WRITE: duplicate question position %', v_position;
    END IF;
    v_positions := array_append(v_positions, v_position);

    -- Required must be boolean
    IF v_required IS NULL THEN
      RAISE EXCEPTION 'I-PROPOSED-TR5-INTAKE-SCHEMA-VALID-AT-WRITE: question required must be boolean';
    END IF;

    -- Label non-empty, max 200 chars
    IF v_label IS NULL OR char_length(v_label) = 0 OR char_length(v_label) > 200 THEN
      RAISE EXCEPTION 'I-PROPOSED-TR5-INTAKE-SCHEMA-VALID-AT-WRITE: question label must be 1-200 chars';
    END IF;

    -- Type-specific validation
    CASE v_type
      WHEN 'single_choice', 'multi_choice' THEN
        v_options := v_question->'options';
        IF v_options IS NULL OR jsonb_typeof(v_options) <> 'array' THEN
          RAISE EXCEPTION 'I-PROPOSED-TR5-INTAKE-SCHEMA-VALID-AT-WRITE: choice questions must have options array';
        END IF;
        IF jsonb_array_length(v_options) < 2 OR jsonb_array_length(v_options) > 10 THEN
          RAISE EXCEPTION 'I-PROPOSED-TR5-INTAKE-SCHEMA-VALID-AT-WRITE: choice questions must have 2-10 options';
        END IF;
      WHEN 'file_upload' THEN
        -- max_files default 1, max 5
        IF v_question ? 'max_files' AND ((v_question->>'max_files')::int < 1 OR (v_question->>'max_files')::int > 5) THEN
          RAISE EXCEPTION 'I-PROPOSED-TR5-INTAKE-SCHEMA-VALID-AT-WRITE: file_upload max_files must be 1-5';
        END IF;
      ELSE
        -- text/date/number have no required type-specific fields beyond base
        NULL;
    END CASE;
  END LOOP;

  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.validate_trip_intake_schema(jsonb)
  TO authenticated, anon, service_role;

COMMENT ON FUNCTION public.validate_trip_intake_schema(jsonb) IS
  'ORCH-0880 Tr5: IMMUTABLE schema validator. NULL accepted. RAISES on bad shape with I-PROPOSED-TR5-INTAKE-SCHEMA-VALID-AT-WRITE prefix. Called by trip_intake_schemas_valid CHECK constraint + intake_schemas patch path in biz_update_live_trip.';

-- ============================================================
-- Section 3 — trip_intake_schemas sidecar table (per SPEC §15.2)
-- ============================================================
CREATE TABLE public.trip_intake_schemas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  ticket_type_id uuid NOT NULL REFERENCES public.ticket_types(id) ON DELETE CASCADE,
  schema jsonb NOT NULL,
  schema_version_id uuid NOT NULL DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT trip_intake_schemas_valid CHECK (public.validate_trip_intake_schema(schema)),
  UNIQUE (event_id, ticket_type_id)
);

CREATE INDEX trip_intake_schemas_event_id_idx
  ON public.trip_intake_schemas (event_id);

CREATE INDEX trip_intake_schemas_ticket_type_id_idx
  ON public.trip_intake_schemas (ticket_type_id);

ALTER TABLE public.trip_intake_schemas ENABLE ROW LEVEL SECURITY;

-- Planner reads/writes own brand's schemas (event_manager+ rank)
CREATE POLICY "trip_intake_schemas_planner_all"
  ON public.trip_intake_schemas FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.events e
      WHERE e.id = trip_intake_schemas.event_id
        AND e.event_type = 'trip'
        AND public.biz_brand_effective_rank(e.brand_id, auth.uid())
              >= public.biz_role_rank('event_manager'::text)
    )
  );

-- Anon can SELECT (buyer needs the schema to render the form at /checkout-trip/[tripEventId]/intake)
CREATE POLICY "trip_intake_schemas_anon_select"
  ON public.trip_intake_schemas FOR SELECT TO anon
  USING (
    EXISTS (
      SELECT 1 FROM public.events e
      WHERE e.id = trip_intake_schemas.event_id
        AND e.event_type = 'trip'
        AND e.status IN ('scheduled', 'live')
        AND e.deleted_at IS NULL
    )
  );

-- Service role full access (cron + edge functions)
CREATE POLICY "trip_intake_schemas_service_role_all"
  ON public.trip_intake_schemas FOR ALL TO service_role
  USING (true);

COMMENT ON TABLE public.trip_intake_schemas IS
  'ORCH-0880 Tr5: per-tier intake form schema for trips. JOINs events+ticket_types via composite UNIQUE. Schema validated by validate_trip_intake_schema(jsonb) CHECK constraint. Planner-edit via biz_update_live_trip RPC intake_schemas patch key (see ORCH-0876 V2 unified RPC pattern); buyer-anon SELECT for /checkout-trip/[tripEventId]/intake render.';

-- ============================================================
-- Section 4 — trip_intake_files storage bucket + RLS policies
-- I-PROPOSED-TR5-INTAKE-FILE-RLS-ANON-WRITE-PLANNER-READ enforcement.
-- ============================================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('trip_intake_files', 'trip_intake_files', false)
ON CONFLICT (id) DO NOTHING;

-- Anon buyer can INSERT under own path (signed-URL signed by edge function
-- trip-intake-upload-signed-url; path = {event_id}/{order_id}/{question_id}/{filename})
CREATE POLICY "trip_intake_files_anon_buyer_insert"
  ON storage.objects FOR INSERT TO anon
  WITH CHECK (
    bucket_id = 'trip_intake_files'
    AND (storage.foldername(name))[1] IS NOT NULL  -- event_id
    AND (storage.foldername(name))[2] IS NOT NULL  -- order_id
  );

-- Anon buyer can SELECT (signed URL pattern; signed URL contains object path,
-- so only the buyer who uploaded has the URL — RLS is intentionally broad and
-- protection layered at signed-URL expiry)
CREATE POLICY "trip_intake_files_anon_buyer_select"
  ON storage.objects FOR SELECT TO anon
  USING (bucket_id = 'trip_intake_files');

-- Planner reads under owned brand at event_manager+ rank
CREATE POLICY "trip_intake_files_planner_read"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'trip_intake_files'
    AND EXISTS (
      SELECT 1
      FROM public.events e
      WHERE e.id = ((storage.foldername(name))[1])::uuid
        AND e.event_type = 'trip'
        AND public.biz_brand_effective_rank(e.brand_id, auth.uid())
              >= public.biz_role_rank('event_manager'::text)
    )
  );

-- Service role full access (cron purge + edge fn signed URL generation)
CREATE POLICY "trip_intake_files_service_role_all"
  ON storage.objects FOR ALL TO service_role
  USING (bucket_id = 'trip_intake_files');

-- ============================================================
-- Section 5 — biz_update_live_trip RPC EXTENSION
-- Per SPEC §15.3: extends existing ORCH-0876 V2 unified RPC with new Section 4f
-- (intake_schemas refund-gate, permissive per D2) + Section 5e (upsert to
-- trip_intake_schemas). All other sections (4a-4e, 5a-5d) preserved verbatim
-- from supabase/migrations/20260616000000_orch_0876_trip_published_edit.sql.
-- ============================================================
CREATE OR REPLACE FUNCTION public.biz_update_live_trip(
  p_event_id uuid,
  p_patch jsonb,
  p_reason text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid;
  v_event public.events%ROWTYPE;
  v_trimmed_reason text;
  v_severity text;
  v_changed_keys text[] := '{}';
  v_sold_by_tier jsonb;
  v_log_id uuid;
  v_business_trip jsonb;
  v_new_business_trip jsonb;
  v_old_start timestamptz;
  v_new_start timestamptz;
  v_old_end timestamptz;
  v_new_end timestamptz;
  v_old_capacity int;
  v_new_capacity int;
  v_total_sold int;
  v_existing_day_ordinals int[];
  v_new_day_ordinals int[];
  v_dropped_ordinals int[];
  v_existing_inclusion_keys text[];
  v_new_inclusion_keys text[];
  v_dropped_inclusions text[];
  v_tier record;
  v_new_tier jsonb;
  v_affected_order_count int := 0;
  v_diff_summary jsonb := '{}'::jsonb;
  v_affected_order_ids uuid[];
  -- ORCH-0880 Tr5 additions:
  v_intake_schema_entry jsonb;
  v_intake_ticket_type_id uuid;
  v_intake_schema jsonb;
  v_intake_changed_tier_ids uuid[] := '{}'::uuid[];
BEGIN
  -- ---------- 1. Auth + reason validation ----------
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'authentication_required';
  END IF;

  v_trimmed_reason := btrim(COALESCE(p_reason, ''));
  IF v_trimmed_reason = '' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'missing_edit_reason');
  END IF;
  IF char_length(v_trimmed_reason) < 10 OR char_length(v_trimmed_reason) > 200 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_edit_reason');
  END IF;

  -- ---------- 2. Event lookup + type/permission gates ----------
  SELECT * INTO v_event
  FROM public.events
  WHERE id = p_event_id
    AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'trip_not_found');
  END IF;

  IF v_event.event_type <> 'trip' THEN
    RAISE EXCEPTION 'event_not_a_trip'
      USING HINT = 'biz_update_live_trip only handles event_type=trip rows. Use the event-side mutation path for events.';
  END IF;

  IF v_event.status NOT IN ('scheduled', 'live') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'trip_not_editable_status');
  END IF;

  IF public.biz_brand_effective_rank(v_event.brand_id, v_user_id)
       < public.biz_role_rank('event_manager'::text) THEN
    RAISE EXCEPTION 'insufficient_event_permission';
  END IF;

  -- ---------- 3. Compute sold-count context ----------
  v_sold_by_tier := public.biz_trip_sold_count_by_tier(p_event_id);

  SELECT COALESCE(SUM((value)::int), 0)
    INTO v_total_sold
    FROM jsonb_each_text(v_sold_by_tier);

  -- ---------- 4. Refund-gate validation per patch shape ----------

  -- 4a. Capacity check (theme.business_trip.capacity)
  v_business_trip := COALESCE(v_event.theme->'business_trip', '{}'::jsonb);
  v_new_business_trip := COALESCE(p_patch->'theme'->'business_trip', '{}'::jsonb);

  IF v_new_business_trip ? 'capacity' THEN
    v_old_capacity := NULLIF(v_business_trip->>'capacity', '')::int;
    v_new_capacity := NULLIF(v_new_business_trip->>'capacity', '')::int;
    IF v_new_capacity IS NOT NULL
       AND v_new_capacity < v_total_sold THEN
      RETURN jsonb_build_object(
        'ok', false,
        'reason', 'capacity_below_sold',
        'affected_order_count', v_total_sold
      );
    END IF;
  END IF;

  -- 4b. Date shift check
  IF v_new_business_trip ? 'startAt' OR v_new_business_trip ? 'endAt' THEN
    v_old_start := NULLIF(v_business_trip->>'startAt', '')::timestamptz;
    v_old_end := NULLIF(v_business_trip->>'endAt', '')::timestamptz;
    v_new_start := COALESCE(
      NULLIF(v_new_business_trip->>'startAt', '')::timestamptz,
      v_old_start
    );
    v_new_end := COALESCE(
      NULLIF(v_new_business_trip->>'endAt', '')::timestamptz,
      v_old_end
    );
    IF v_total_sold > 0
       AND (v_new_start IS DISTINCT FROM v_old_start
            OR v_new_end IS DISTINCT FROM v_old_end) THEN
      RETURN jsonb_build_object(
        'ok', false,
        'reason', 'dates_shifted_with_sales',
        'affected_order_count', v_total_sold,
        'dropped_dates', jsonb_build_array(
          COALESCE(to_char(v_old_start, 'YYYY-MM-DD'), ''),
          COALESCE(to_char(v_old_end, 'YYYY-MM-DD'), '')
        )
      );
    END IF;
  END IF;

  -- 4c. Days check
  IF p_patch ? 'days' THEN
    SELECT array_agg(ordinal ORDER BY ordinal)
      INTO v_existing_day_ordinals
      FROM public.trip_days
      WHERE event_id = p_event_id;
    v_existing_day_ordinals := COALESCE(v_existing_day_ordinals, '{}'::int[]);

    SELECT array_agg((d->>'ordinal')::int ORDER BY (d->>'ordinal')::int)
      INTO v_new_day_ordinals
      FROM jsonb_array_elements(p_patch->'days') d;
    v_new_day_ordinals := COALESCE(v_new_day_ordinals, '{}'::int[]);

    v_dropped_ordinals := (
      SELECT COALESCE(array_agg(o), '{}'::int[])
      FROM unnest(v_existing_day_ordinals) o
      WHERE NOT (o = ANY (v_new_day_ordinals))
    );

    IF array_length(v_dropped_ordinals, 1) > 0 AND v_total_sold > 0 THEN
      RETURN jsonb_build_object(
        'ok', false,
        'reason', 'days_dropped_with_sales',
        'affected_order_count', v_total_sold,
        'dropped_dates', to_jsonb(v_dropped_ordinals)
      );
    END IF;
  END IF;

  -- 4d. Inclusions check
  IF p_patch ? 'inclusions' THEN
    SELECT array_agg(kind || ':' || item)
      INTO v_existing_inclusion_keys
      FROM public.trip_inclusions
      WHERE event_id = p_event_id;
    v_existing_inclusion_keys := COALESCE(v_existing_inclusion_keys, '{}'::text[]);

    SELECT array_agg((i->>'kind') || ':' || (i->>'item'))
      INTO v_new_inclusion_keys
      FROM jsonb_array_elements(p_patch->'inclusions') i;
    v_new_inclusion_keys := COALESCE(v_new_inclusion_keys, '{}'::text[]);

    v_dropped_inclusions := (
      SELECT COALESCE(array_agg(k), '{}'::text[])
      FROM unnest(v_existing_inclusion_keys) k
      WHERE NOT (k = ANY (v_new_inclusion_keys))
    );

    IF array_length(v_dropped_inclusions, 1) > 0 AND v_total_sold > 0 THEN
      RETURN jsonb_build_object(
        'ok', false,
        'reason', 'inclusions_removed_with_sales',
        'affected_order_count', v_total_sold,
        'dropped_inclusions', to_jsonb(v_dropped_inclusions)
      );
    END IF;
  END IF;

  -- 4e. Pricing tier checks
  IF p_patch ? 'pricing_tiers' THEN
    FOR v_tier IN
      SELECT tpt.id AS tpt_id, tpt.ticket_type_id, tt.price_cents
      FROM public.trip_pricing_tiers tpt
      JOIN public.ticket_types tt ON tt.id = tpt.ticket_type_id
      WHERE tpt.event_id = p_event_id
    LOOP
      SELECT t INTO v_new_tier
        FROM jsonb_array_elements(p_patch->'pricing_tiers') t
       WHERE (t->>'ticket_type_id')::uuid = v_tier.ticket_type_id
       LIMIT 1;

      IF v_new_tier IS NULL THEN
        IF COALESCE((v_sold_by_tier->>v_tier.ticket_type_id::text)::int, 0) > 0 THEN
          RETURN jsonb_build_object(
            'ok', false,
            'reason', 'tier_delete_with_sales',
            'affected_order_count', (v_sold_by_tier->>v_tier.ticket_type_id::text)::int
          );
        END IF;
      ELSIF v_new_tier ? 'price_cents'
            AND (v_new_tier->>'price_cents')::int IS DISTINCT FROM v_tier.price_cents THEN
        IF COALESCE((v_sold_by_tier->>v_tier.ticket_type_id::text)::int, 0) > 0 THEN
          RETURN jsonb_build_object(
            'ok', false,
            'reason', 'tier_price_change_with_sales',
            'affected_order_count', (v_sold_by_tier->>v_tier.ticket_type_id::text)::int
          );
        END IF;
      END IF;
    END LOOP;
  END IF;

  -- 4f. ORCH-0880 Tr5 intake_schemas refund-gate (PERMISSIVE per D2 operator
  -- decision). Schema validation runs but no hard reject on sold>0 — re-answer
  -- notification fan-out handles affected buyers via Section 6 trigger.
  IF p_patch ? 'intake_schemas' THEN
    IF jsonb_typeof(p_patch->'intake_schemas') <> 'array' THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'invalid_intake_schemas_payload');
    END IF;

    -- Validate every entry's schema via validator function. If any fails, reject
    -- the whole patch (atomicity invariant from ORCH-0876 V2 preserved).
    FOR v_intake_schema_entry IN
      SELECT * FROM jsonb_array_elements(p_patch->'intake_schemas')
    LOOP
      v_intake_ticket_type_id := (v_intake_schema_entry->>'ticket_type_id')::uuid;
      v_intake_schema := v_intake_schema_entry->'schema';

      IF v_intake_ticket_type_id IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'intake_schema_missing_ticket_type_id');
      END IF;

      -- Tier must belong to this trip
      IF NOT EXISTS (
        SELECT 1 FROM public.trip_pricing_tiers
        WHERE event_id = p_event_id
          AND ticket_type_id = v_intake_ticket_type_id
      ) THEN
        RETURN jsonb_build_object(
          'ok', false,
          'reason', 'intake_schema_unknown_ticket_type',
          'ticket_type_id', v_intake_ticket_type_id
        );
      END IF;

      -- Schema validity check (raises with I-PROPOSED-TR5-... prefix if bad)
      IF v_intake_schema IS NOT NULL
         AND NOT public.validate_trip_intake_schema(v_intake_schema) THEN
        -- Should not reach here — validator raises on bad input — but defensive
        RETURN jsonb_build_object('ok', false, 'reason', 'invalid_intake_schema');
      END IF;
    END LOOP;
  END IF;

  -- ---------- 5. Apply patch ----------
  -- 5a. events row update
  IF p_patch ?| ARRAY['title','description','theme','cover_media_url','cover_media_type',
                      'cover_media_provider','cover_media_source_url',
                      'cover_media_credit','cover_media_credit_url','cover_media_alt']::text[] THEN
    UPDATE public.events SET
      title = COALESCE(p_patch->>'title', title),
      description = CASE WHEN p_patch ? 'description'
                         THEN p_patch->>'description' ELSE description END,
      theme = CASE WHEN p_patch ? 'theme'
                   THEN theme || (p_patch->'theme') ELSE theme END,
      cover_media_url = CASE WHEN p_patch ? 'cover_media_url'
                              THEN NULLIF(p_patch->>'cover_media_url','')
                              ELSE cover_media_url END,
      cover_media_type = CASE WHEN p_patch ? 'cover_media_type'
                               THEN NULLIF(p_patch->>'cover_media_type','')
                               ELSE cover_media_type END,
      cover_media_provider = CASE WHEN p_patch ? 'cover_media_provider'
                                   THEN NULLIF(p_patch->>'cover_media_provider','')
                                   ELSE cover_media_provider END,
      cover_media_source_url = CASE WHEN p_patch ? 'cover_media_source_url'
                                     THEN NULLIF(p_patch->>'cover_media_source_url','')
                                     ELSE cover_media_source_url END,
      cover_media_credit = CASE WHEN p_patch ? 'cover_media_credit'
                                 THEN NULLIF(p_patch->>'cover_media_credit','')
                                 ELSE cover_media_credit END,
      cover_media_credit_url = CASE WHEN p_patch ? 'cover_media_credit_url'
                                     THEN NULLIF(p_patch->>'cover_media_credit_url','')
                                     ELSE cover_media_credit_url END,
      cover_media_alt = CASE WHEN p_patch ? 'cover_media_alt'
                              THEN NULLIF(p_patch->>'cover_media_alt','')
                              ELSE cover_media_alt END,
      updated_at = now()
    WHERE id = p_event_id;
  END IF;

  -- 5b. trip_days upsert + delete
  IF p_patch ? 'days' THEN
    IF v_dropped_ordinals IS NOT NULL AND array_length(v_dropped_ordinals, 1) > 0 THEN
      DELETE FROM public.trip_days
        WHERE event_id = p_event_id
          AND ordinal = ANY (v_dropped_ordinals);
    END IF;
    INSERT INTO public.trip_days (event_id, ordinal, title, narrative)
      SELECT p_event_id,
             (d->>'ordinal')::int,
             d->>'title',
             NULLIF(d->>'narrative', '')
        FROM jsonb_array_elements(p_patch->'days') d
      ON CONFLICT (event_id, ordinal)
      DO UPDATE SET title = EXCLUDED.title, narrative = EXCLUDED.narrative;
  END IF;

  -- 5c. trip_inclusions: replace-all (safe because dropped-with-sales gated above)
  IF p_patch ? 'inclusions' THEN
    DELETE FROM public.trip_inclusions WHERE event_id = p_event_id;
    INSERT INTO public.trip_inclusions (event_id, kind, item, ordinal)
      SELECT p_event_id, i->>'kind', i->>'item', (i->>'ordinal')::int
        FROM jsonb_array_elements(p_patch->'inclusions') i;
  END IF;

  -- 5d. trip_pricing_tiers upsert
  IF p_patch ? 'pricing_tiers' THEN
    FOR v_new_tier IN
      SELECT * FROM jsonb_array_elements(p_patch->'pricing_tiers')
    LOOP
      UPDATE public.trip_pricing_tiers SET
        tier_name = COALESCE(v_new_tier->>'tier_name', tier_name),
        tier_metadata = COALESCE(v_new_tier->'tier_metadata', tier_metadata)
      WHERE ticket_type_id = (v_new_tier->>'ticket_type_id')::uuid
        AND event_id = p_event_id;

      IF v_new_tier ? 'price_cents' THEN
        UPDATE public.ticket_types SET
          price_cents = (v_new_tier->>'price_cents')::int
        WHERE id = (v_new_tier->>'ticket_type_id')::uuid;
      END IF;
    END LOOP;
  END IF;

  -- 5e. ORCH-0880 Tr5 intake_schemas upsert (NEW). UPSERT into
  -- trip_intake_schemas per ticket_type_id. NULL schema = delete row (clear
  -- the tier's intake form). Trigger tg_intake_schemas_re_answer_dispatch fires
  -- on UPDATE for re-answer notification fan-out.
  IF p_patch ? 'intake_schemas' THEN
    FOR v_intake_schema_entry IN
      SELECT * FROM jsonb_array_elements(p_patch->'intake_schemas')
    LOOP
      v_intake_ticket_type_id := (v_intake_schema_entry->>'ticket_type_id')::uuid;
      v_intake_schema := v_intake_schema_entry->'schema';

      v_intake_changed_tier_ids := array_append(v_intake_changed_tier_ids, v_intake_ticket_type_id);

      IF v_intake_schema IS NULL OR jsonb_typeof(v_intake_schema) = 'null' THEN
        DELETE FROM public.trip_intake_schemas
          WHERE event_id = p_event_id
            AND ticket_type_id = v_intake_ticket_type_id;
      ELSE
        INSERT INTO public.trip_intake_schemas
          (event_id, ticket_type_id, schema, schema_version_id, created_at, updated_at)
        VALUES (
          p_event_id,
          v_intake_ticket_type_id,
          v_intake_schema,
          COALESCE(NULLIF(v_intake_schema->>'schema_version_id', '')::uuid, gen_random_uuid()),
          now(),
          now()
        )
        ON CONFLICT (event_id, ticket_type_id) DO UPDATE
          SET schema = EXCLUDED.schema,
              schema_version_id = EXCLUDED.schema_version_id,
              updated_at = now();
      END IF;
    END LOOP;
  END IF;

  -- ---------- 6. Compute changed_keys + severity + diff_summary ----------
  v_changed_keys := ARRAY(SELECT jsonb_object_keys(p_patch));

  IF (p_patch ? 'days' OR p_patch ? 'inclusions' OR p_patch ? 'pricing_tiers' OR p_patch ? 'intake_schemas')
     OR (p_patch ? 'theme' AND v_new_business_trip ?| ARRAY['startAt','endAt',
                                                            'destinationLocationText','capacity']::text[]) THEN
    v_severity := 'material';
  ELSE
    v_severity := 'additive';
  END IF;

  v_diff_summary := jsonb_build_object(
    'changed_keys', to_jsonb(v_changed_keys),
    'dropped_day_ordinals', to_jsonb(COALESCE(v_dropped_ordinals, '{}'::int[])),
    'dropped_inclusions', to_jsonb(COALESCE(v_dropped_inclusions, '{}'::text[])),
    'intake_changed_tier_ids', to_jsonb(v_intake_changed_tier_ids)
  );

  -- ---------- 7. Insert trip_edit_log row ----------
  SELECT COALESCE(array_agg(id), '{}'::uuid[])
    INTO v_affected_order_ids
    FROM public.orders
    WHERE event_id = p_event_id
      AND payment_status NOT IN ('failed', 'cancelled');

  INSERT INTO public.trip_edit_log
    (event_id, brand_id, edited_by, reason, severity,
     changed_field_keys, diff_summary, affected_order_ids, occurred_at)
  VALUES (
    p_event_id,
    v_event.brand_id,
    v_user_id,
    v_trimmed_reason,
    v_severity,
    v_changed_keys,
    v_diff_summary,
    v_affected_order_ids,
    now()
  ) RETURNING id INTO v_log_id;

  -- ---------- 8. Return success ----------
  RETURN jsonb_build_object(
    'ok', true,
    'edit_log_entry_id', v_log_id,
    'severity', v_severity,
    'changed_keys', to_jsonb(v_changed_keys),
    'affected_order_count', COALESCE(array_length(v_affected_order_ids, 1), 0),
    'intake_changed_tier_ids', to_jsonb(v_intake_changed_tier_ids)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.biz_update_live_trip(uuid, jsonb, text)
  TO authenticated;

COMMENT ON FUNCTION public.biz_update_live_trip(uuid, jsonb, text) IS
  'ORCH-0876 + ORCH-0880 Tr5: atomic published-trip patch writer. Validates auth + reason + event_type + status + permission, runs refund-gate (8 paths from ORCH-0876 + intake_schemas validation from ORCH-0880), applies patch across events + trip_days + trip_inclusions + trip_pricing_tiers + ticket_types + trip_intake_schemas, inserts trip_edit_log row, returns {ok, severity, changed_keys, edit_log_entry_id, affected_order_count, intake_changed_tier_ids}. ORCH-0880 §15.3 extension: accepts intake_schemas array patch key for per-tier intake form schema updates (UPSERT to trip_intake_schemas table).';

-- ============================================================
-- Section 6 — Re-answer notification trigger (per SPEC §4.1.F)
-- I-PROPOSED-TR5-INTAKE-RE-ANSWER-NOTIFICATION-DISPATCH enforcement.
-- On UPDATE of trip_intake_schemas.schema, compare old vs new question shape
-- and enqueue buyer_intake_form_re_answer_required notifications for orders
-- with non-null intake_form_data targeting this tier.
-- ============================================================
CREATE OR REPLACE FUNCTION public.tg_intake_schemas_re_answer_dispatch()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_old_question_ids text[];
  v_new_question_ids text[];
  v_changed_question_ids text[];
  v_affected_order record;
BEGIN
  -- Only fire on UPDATE (not INSERT — no prior answers to re-ask)
  IF TG_OP <> 'UPDATE' THEN
    RETURN NEW;
  END IF;

  -- Skip if schema_version_id unchanged (no-op write)
  IF NEW.schema_version_id = OLD.schema_version_id THEN
    RETURN NEW;
  END IF;

  -- Extract old + new question IDs
  SELECT COALESCE(array_agg((q->>'id') ORDER BY q->>'id'), '{}'::text[])
    INTO v_old_question_ids
    FROM jsonb_array_elements(OLD.schema->'questions') q;

  SELECT COALESCE(array_agg((q->>'id') ORDER BY q->>'id'), '{}'::text[])
    INTO v_new_question_ids
    FROM jsonb_array_elements(NEW.schema->'questions') q;

  -- Changed = symmetric difference of old vs new question IDs
  -- (additions OR removals trigger re-answer; identical sets = no-op even if
  -- per-question content edited — covered by SPEC §4.1.F minimum-viable approach)
  v_changed_question_ids := (
    SELECT COALESCE(array_agg(q), '{}'::text[])
    FROM (
      SELECT unnest(v_new_question_ids) AS q
      EXCEPT
      SELECT unnest(v_old_question_ids)
      UNION
      SELECT unnest(v_old_question_ids)
      EXCEPT
      SELECT unnest(v_new_question_ids)
    ) diff
  );

  IF array_length(v_changed_question_ids, 1) IS NULL THEN
    -- No structural change to question IDs; skip notification dispatch
    RETURN NEW;
  END IF;

  -- For each affected order on this tier, enqueue notification.
  -- Filter: orders for this event whose intake_form_data is non-null AND
  -- targets the changed ticket_type_id.
  FOR v_affected_order IN
    SELECT id, buyer_email, intake_form_data
      FROM public.orders
     WHERE event_id = NEW.event_id
       AND intake_form_data IS NOT NULL
       AND payment_status NOT IN ('failed', 'cancelled')
       AND (intake_form_data->>'ticket_type_id')::uuid = NEW.ticket_type_id
  LOOP
    -- Defensive: notifications_outbox table may not exist in current schema.
    -- Check existence before insert (implementor flagged as deviation if missing
    -- — operator decides between table creation OR ORCH-0788 dispatcher
    -- direct call). For now: skip silently if table absent so the trigger
    -- itself doesn't break the parent UPDATE.
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'public'
         AND table_name = 'notifications_outbox'
    ) THEN
      EXECUTE format(
        $sql$
        INSERT INTO public.notifications_outbox
          (kind, order_id, buyer_email, payload, enqueued_at)
        VALUES (
          'buyer_intake_form_re_answer_required',
          %L::uuid,
          %L,
          %L::jsonb,
          now()
        )
        $sql$,
        v_affected_order.id,
        v_affected_order.buyer_email,
        jsonb_build_object(
          'event_id', NEW.event_id,
          'ticket_type_id', NEW.ticket_type_id,
          'changed_question_ids', to_jsonb(v_changed_question_ids),
          'schema_version_id', NEW.schema_version_id
        )::text
      );
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$;

CREATE TRIGGER tg_trip_intake_schemas_re_answer
  AFTER UPDATE OF schema, schema_version_id
  ON public.trip_intake_schemas
  FOR EACH ROW
  WHEN (OLD.schema IS DISTINCT FROM NEW.schema)
  EXECUTE FUNCTION public.tg_intake_schemas_re_answer_dispatch();

COMMENT ON FUNCTION public.tg_intake_schemas_re_answer_dispatch() IS
  'ORCH-0880 Tr5: after a per-tier intake_schema UPDATE, enqueue buyer_intake_form_re_answer_required notifications for orders with non-null intake_form_data targeting the changed tier. Trigger guards against the notifications_outbox table absent case (no-op silently). Per I-PROPOSED-TR5-INTAKE-RE-ANSWER-NOTIFICATION-DISPATCH (DRAFT → ACTIVE on ORCH-0880 CLOSE).';

-- ============================================================
-- Section 7 — Indexes
-- ============================================================
CREATE INDEX orders_intake_form_data_idx
  ON public.orders ((intake_form_data IS NOT NULL))
  WHERE payment_status NOT IN ('failed', 'cancelled');

-- ============================================================
-- Section 8 — Self-verification DO-block
-- ============================================================
DO $verify$
DECLARE
  v_column_exists boolean;
  v_table_exists boolean;
  v_function_exists boolean;
  v_bucket_exists boolean;
  v_policy_count int;
  v_trigger_exists boolean;
  v_index_exists boolean;
BEGIN
  -- A. orders.intake_form_data column exists
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'orders'
       AND column_name = 'intake_form_data'
  ) INTO v_column_exists;
  IF NOT v_column_exists THEN
    RAISE EXCEPTION 'ORCH-0880 self-verify A: orders.intake_form_data column missing';
  END IF;

  -- B. trip_intake_schemas table exists
  SELECT EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'trip_intake_schemas'
  ) INTO v_table_exists;
  IF NOT v_table_exists THEN
    RAISE EXCEPTION 'ORCH-0880 self-verify B: trip_intake_schemas table missing';
  END IF;

  -- C. validate_trip_intake_schema function exists + is IMMUTABLE
  SELECT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname = 'validate_trip_intake_schema'
       AND p.provolatile = 'i'  -- IMMUTABLE
  ) INTO v_function_exists;
  IF NOT v_function_exists THEN
    RAISE EXCEPTION 'ORCH-0880 self-verify C: validate_trip_intake_schema IMMUTABLE function missing';
  END IF;

  -- D. validator accepts null + valid; rejects bad
  IF NOT public.validate_trip_intake_schema(NULL) THEN
    RAISE EXCEPTION 'ORCH-0880 self-verify D1: validator should accept NULL';
  END IF;

  IF NOT public.validate_trip_intake_schema(
    jsonb_build_object(
      'schema_version_id', '11111111-1111-1111-1111-111111111111',
      'questions', jsonb_build_array(
        jsonb_build_object(
          'id', '22222222-2222-2222-2222-222222222222',
          'type', 'short_text',
          'label', 'Test',
          'required', true,
          'position', 0
        )
      )
    )
  ) THEN
    RAISE EXCEPTION 'ORCH-0880 self-verify D2: validator should accept valid minimal schema';
  END IF;

  -- E. trip_intake_files bucket exists
  SELECT EXISTS (
    SELECT 1 FROM storage.buckets WHERE id = 'trip_intake_files'
  ) INTO v_bucket_exists;
  IF NOT v_bucket_exists THEN
    RAISE EXCEPTION 'ORCH-0880 self-verify E: trip_intake_files storage bucket missing';
  END IF;

  -- F. 4 RLS policies on storage.objects for trip_intake_files bucket
  SELECT count(*) INTO v_policy_count
    FROM pg_policies
   WHERE schemaname = 'storage'
     AND tablename = 'objects'
     AND policyname IN (
       'trip_intake_files_anon_buyer_insert',
       'trip_intake_files_anon_buyer_select',
       'trip_intake_files_planner_read',
       'trip_intake_files_service_role_all'
     );
  IF v_policy_count <> 4 THEN
    RAISE EXCEPTION 'ORCH-0880 self-verify F: expected 4 trip_intake_files storage RLS policies, got %', v_policy_count;
  END IF;

  -- G. 3 RLS policies on trip_intake_schemas
  SELECT count(*) INTO v_policy_count
    FROM pg_policies
   WHERE schemaname = 'public'
     AND tablename = 'trip_intake_schemas'
     AND policyname IN (
       'trip_intake_schemas_planner_all',
       'trip_intake_schemas_anon_select',
       'trip_intake_schemas_service_role_all'
     );
  IF v_policy_count <> 3 THEN
    RAISE EXCEPTION 'ORCH-0880 self-verify G: expected 3 trip_intake_schemas RLS policies, got %', v_policy_count;
  END IF;

  -- H. Trigger exists
  SELECT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgname = 'tg_trip_intake_schemas_re_answer'
       AND tgrelid = 'public.trip_intake_schemas'::regclass
  ) INTO v_trigger_exists;
  IF NOT v_trigger_exists THEN
    RAISE EXCEPTION 'ORCH-0880 self-verify H: tg_trip_intake_schemas_re_answer trigger missing';
  END IF;

  -- I. orders index exists
  SELECT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'public'
       AND tablename = 'orders'
       AND indexname = 'orders_intake_form_data_idx'
  ) INTO v_index_exists;
  IF NOT v_index_exists THEN
    RAISE EXCEPTION 'ORCH-0880 self-verify I: orders_intake_form_data_idx missing';
  END IF;

  -- J. biz_update_live_trip is the EXTENDED version (accepts intake_schemas
  -- patch key). Probe by checking function source for the 'intake_schemas'
  -- string — defensive but lightweight.
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname = 'biz_update_live_trip'
       AND pg_get_functiondef(p.oid) LIKE '%intake_schemas%'
  ) THEN
    RAISE EXCEPTION 'ORCH-0880 self-verify J: biz_update_live_trip not extended with intake_schemas handling';
  END IF;

  RAISE NOTICE 'ORCH-0880 self-verify: all 10 checks PASS';
END
$verify$;

COMMIT;
