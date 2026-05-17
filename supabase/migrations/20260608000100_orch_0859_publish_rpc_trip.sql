-- ORCH-0859 — Tr2 Minimum Viable Trip: forked trip-publish RPC.
--
-- AMENDED 2026-05-17 (operator option B): the original SPEC §4.2 "extend
-- business_publish_event_draft with one IF block at top" was discovered at
-- IMPLEMENT-time to be technically infeasible. The existing event RPC body
-- is tightly coupled to event-only taxonomy validation (city_required,
-- party_types_required, party_types_not_canonical, vibe_tags_not_canonical,
-- music_genres_not_canonical). None of those apply to trips. Extending the
-- function would require gating every existing validation block in
-- `IF v_event.event_type = 'event'` wrappers — materially "altering existing
-- logic" beyond the SPEC §4.2 hard guard. Operator picked Option B: fork.
--
-- This migration creates a NEW function business_publish_trip_draft with a
-- narrow trip-specific contract. The existing business_publish_event_draft
-- is BYTE-UNCHANGED — event publish path is provably unaffected.
--
-- Process-improvement follow-up: META-ORCH-NNNN [Forensics + SPEC body-read
-- discipline for extend-vs-fork decisions] queued at INTAKE — would have
-- caught this at INVESTIGATE time if the publish RPC body had been read
-- verbatim and the `RAISE EXCEPTION` literals enumerated.
--
-- Pre-state (verified 2026-05-17):
--   trip_days / trip_pricing_tiers / trip_inclusions tables live
--   (migration 20260608000000_orch_0859_trip_sidecar_tables.sql applied)
--   events.event_type admits 'trip' (post-ORCH-0826 [Hub Foundation + universal-plus creator])
--   biz_brand_effective_rank + biz_role_rank helpers exist (per ORCH-0824 event RPC body)
--
-- SPEC: Mingla_Artifacts/specs/SPEC_ORCH-0859_TR2_MINIMUM_VIABLE_TRIP.md §4.2 (amended)
-- Investigation: Mingla_Artifacts/reports/INVESTIGATION_ORCH-0859_TR2_MINIMUM_VIABLE_TRIP.md §D-1

BEGIN;

CREATE OR REPLACE FUNCTION public.business_publish_trip_draft(
  p_event_id uuid,
  p_draft_payload jsonb,
  p_client_revision integer DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_user_id uuid;
  v_event public.events%ROWTYPE;
  v_brand record;
  v_theme jsonb;
  v_business_trip jsonb;
  v_title text;
  v_description text;
  v_cover_media_url text;
  v_cover_media_type text;
  v_cover_media_provider text;
  v_cover_media_source_url text;
  v_cover_media_credit text;
  v_cover_media_credit_url text;
  v_cover_media_alt text;
  v_timezone text;
  v_visibility text;
  v_destination_text text;
  v_capacity int;
  v_start_at_text text;
  v_end_at_text text;
  v_start timestamptz;
  v_end timestamptz;
  v_base_slug text;
  v_final_slug text;
  v_suffix integer := 2;
  v_now timestamptz := now();
  v_trip_day_count int;
  v_pricing_tier_count int;
  v_trip_days_rows jsonb;
  v_pricing_tier_rows jsonb;
  v_inclusion_rows jsonb;
  v_ticket_rows jsonb;
  v_event_dates_rows jsonb;
BEGIN
  -- ---------- 1. Auth ----------
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  -- ---------- 2. Event row lookup + state checks ----------
  SELECT *
  INTO v_event
  FROM public.events
  WHERE id = p_event_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'event_draft_not_found';
  END IF;

  IF v_event.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'event_draft_deleted';
  END IF;

  IF v_event.status <> 'draft' THEN
    RAISE EXCEPTION 'event_draft_not_publishable';
  END IF;

  IF v_event.event_type <> 'trip' THEN
    RAISE EXCEPTION 'event_not_a_trip'
      USING HINT = 'business_publish_trip_draft only handles event_type=trip rows. Use business_publish_event_draft for event_type=event.';
  END IF;

  IF public.biz_brand_effective_rank(v_event.brand_id, v_user_id) < public.biz_role_rank('event_manager'::text) THEN
    RAISE EXCEPTION 'insufficient_event_permission';
  END IF;

  -- ---------- 3. Brand lookup ----------
  SELECT id, slug, name, default_currency
  INTO v_brand
  FROM public.brands
  WHERE id = v_event.brand_id
    AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'brand_not_found';
  END IF;

  -- ---------- 4. Title validation (mirror event RPC) ----------
  v_title := NULLIF(btrim(COALESCE(p_draft_payload->>'title', '')), '');
  IF v_title IS NULL THEN
    RAISE EXCEPTION 'event_title_required';
  END IF;

  -- ---------- 5. Trip-specific validation ----------
  v_theme := COALESCE(p_draft_payload->'theme', v_event.theme, '{}'::jsonb);
  v_business_trip := COALESCE(v_theme->'business_trip', '{}'::jsonb);

  v_destination_text := NULLIF(btrim(COALESCE(v_business_trip->>'destinationLocationText', '')), '');
  IF v_destination_text IS NULL THEN
    RAISE EXCEPTION 'trip_destination_required'
      USING HINT = 'Trips must have a destination before publish. Set theme.business_trip.destinationLocationText in Step 1 of the wizard.';
  END IF;

  v_capacity := NULLIF(v_business_trip->>'capacity', '')::int;
  IF v_capacity IS NULL OR v_capacity <= 0 THEN
    RAISE EXCEPTION 'trip_capacity_required'
      USING HINT = 'Trips must have a positive capacity before publish.';
  END IF;

  v_start_at_text := NULLIF(v_business_trip->>'startAt', '');
  v_end_at_text := NULLIF(v_business_trip->>'endAt', '');
  IF v_start_at_text IS NULL OR v_end_at_text IS NULL THEN
    RAISE EXCEPTION 'trip_dates_required'
      USING HINT = 'Trips must have start + end dates before publish.';
  END IF;

  v_start := v_start_at_text::timestamptz;
  v_end := v_end_at_text::timestamptz;
  IF v_end <= v_start THEN
    RAISE EXCEPTION 'trip_end_before_start'
      USING HINT = 'Trip end date must be after start date.';
  END IF;

  -- ---------- 6. Sidecar table validation ----------
  SELECT count(*) INTO v_trip_day_count FROM public.trip_days WHERE event_id = p_event_id;
  IF v_trip_day_count = 0 THEN
    RAISE EXCEPTION 'trip_days_required'
      USING HINT = 'Trips must have at least one day before publish. Add days in Step 2 of the wizard.';
  END IF;

  SELECT count(*) INTO v_pricing_tier_count FROM public.trip_pricing_tiers WHERE event_id = p_event_id;
  IF v_pricing_tier_count = 0 THEN
    RAISE EXCEPTION 'trip_pricing_tier_required'
      USING HINT = 'Trips must have at least one pricing tier before publish. Configure pricing in Step 4 of the wizard.';
  END IF;

  -- ---------- 7. Slug generation + uniqueness (per-brand) ----------
  v_base_slug := lower(regexp_replace(v_title, '[^a-zA-Z0-9]+', '-', 'g'));
  v_base_slug := regexp_replace(v_base_slug, '(^-+|-+$)', '', 'g');
  IF v_base_slug = '' OR v_base_slug LIKE 'draft-%' THEN
    v_base_slug := 'trip';
  END IF;
  v_final_slug := v_base_slug;

  WHILE EXISTS (
    SELECT 1
    FROM public.events e
    WHERE e.brand_id = v_event.brand_id
      AND e.deleted_at IS NULL
      AND e.id <> p_event_id
      AND lower(e.slug) = lower(v_final_slug)
  ) LOOP
    v_final_slug := v_base_slug || '-' || v_suffix::text;
    v_suffix := v_suffix + 1;
  END LOOP;

  -- ---------- 8. Visibility mapping (mirror event RPC) ----------
  v_visibility := CASE COALESCE(v_business_trip->>'requestedVisibility', 'public')
    WHEN 'private' THEN 'private'
    WHEN 'unlisted' THEN 'hidden'
    ELSE 'public'
  END;

  -- ---------- 9. Cover media (optional — mirror event RPC pattern) ----------
  v_description := NULLIF(p_draft_payload->>'description', '');
  v_cover_media_url := NULLIF(p_draft_payload->>'cover_media_url', '');
  v_cover_media_type := NULLIF(p_draft_payload->>'cover_media_type', '');
  v_cover_media_provider := NULLIF(p_draft_payload->>'cover_media_provider', '');
  v_cover_media_source_url := NULLIF(p_draft_payload->>'cover_media_source_url', '');
  v_cover_media_credit := NULLIF(p_draft_payload->>'cover_media_credit', '');
  v_cover_media_credit_url := NULLIF(p_draft_payload->>'cover_media_credit_url', '');
  v_cover_media_alt := NULLIF(p_draft_payload->>'cover_media_alt', '');
  IF v_cover_media_url IS NULL THEN
    v_cover_media_type := NULL;
    v_cover_media_provider := NULL;
    v_cover_media_source_url := NULL;
    v_cover_media_credit := NULL;
    v_cover_media_credit_url := NULL;
    v_cover_media_alt := NULL;
  END IF;
  v_timezone := COALESCE(NULLIF(p_draft_payload->>'timezone', ''), v_event.timezone, 'UTC');

  -- ---------- 10. event_dates write (single master row from start/end) ----------
  -- Trips are single date-range. No multi_date / recurring complexity in Tr2.
  DELETE FROM public.event_dates WHERE event_id = p_event_id;
  INSERT INTO public.event_dates (event_id, start_at, end_at, timezone, is_master)
  VALUES (p_event_id, v_start, v_end, v_timezone, true);

  -- ---------- 11. RLS context flag (mirror event RPC) ----------
  PERFORM set_config('mingla.business_publish_trip_draft', 'on', true);

  -- ---------- 12. events UPDATE ----------
  -- NOTE: event-taxonomy columns (city, party_types, vibe_tags, music_genres)
  -- stay NULL/default for trips. Those are event-only concepts per ORCH-0824.
  -- ticket_types are NOT recreated here — trip wizard's tripsService.createTripDraft
  -- + updateTripPricing already inserted/maintained the single ticket_types row.
  UPDATE public.events
  SET
    title = v_title,
    description = v_description,
    slug = v_final_slug,
    cover_media_url = v_cover_media_url,
    cover_media_type = v_cover_media_type,
    cover_media_provider = v_cover_media_provider,
    cover_media_source_url = v_cover_media_source_url,
    cover_media_credit = v_cover_media_credit,
    cover_media_credit_url = v_cover_media_credit_url,
    cover_media_alt = v_cover_media_alt,
    theme = jsonb_strip_nulls(v_theme - 'business_draft'),
    is_online = false,
    is_recurring = false,
    is_multi_date = false,
    recurrence_rules = NULL,
    status = 'scheduled',
    visibility = v_visibility,
    published_at = v_now,
    timezone = v_timezone,
    updated_at = v_now
  WHERE id = p_event_id
    AND status = 'draft'
    AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'event_draft_not_publishable';
  END IF;

  -- ---------- 13. Refresh + return composite payload ----------
  SELECT * INTO v_event FROM public.events WHERE id = p_event_id;

  SELECT COALESCE(jsonb_agg(to_jsonb(td) ORDER BY td.ordinal), '[]'::jsonb)
  INTO v_trip_days_rows
  FROM public.trip_days td
  WHERE td.event_id = p_event_id;

  SELECT COALESCE(jsonb_agg(to_jsonb(tpt) ORDER BY tpt.created_at), '[]'::jsonb)
  INTO v_pricing_tier_rows
  FROM public.trip_pricing_tiers tpt
  WHERE tpt.event_id = p_event_id;

  SELECT COALESCE(jsonb_agg(to_jsonb(ti) ORDER BY ti.kind, ti.ordinal), '[]'::jsonb)
  INTO v_inclusion_rows
  FROM public.trip_inclusions ti
  WHERE ti.event_id = p_event_id;

  SELECT COALESCE(jsonb_agg(to_jsonb(tt) ORDER BY tt.display_order), '[]'::jsonb)
  INTO v_ticket_rows
  FROM public.ticket_types tt
  WHERE tt.event_id = p_event_id
    AND tt.deleted_at IS NULL;

  SELECT COALESCE(jsonb_agg(to_jsonb(ed) ORDER BY ed.start_at), '[]'::jsonb)
  INTO v_event_dates_rows
  FROM public.event_dates ed
  WHERE ed.event_id = p_event_id;

  RETURN jsonb_build_object(
    'event', to_jsonb(v_event),
    'brand', jsonb_build_object(
      'id', v_brand.id,
      'slug', v_brand.slug,
      'name', v_brand.name
    ),
    'tripDays', v_trip_days_rows,
    'tripPricingTiers', v_pricing_tier_rows,
    'tripInclusions', v_inclusion_rows,
    'tickets', v_ticket_rows,
    'eventDates', v_event_dates_rows,
    'client_revision', p_client_revision
  );
END;
$$;

COMMENT ON FUNCTION public.business_publish_trip_draft(uuid, jsonb, integer) IS
  'ORCH-0859 (Tr2): trip-specific publish RPC. Forked from business_publish_event_draft per operator option B 2026-05-17 — extending the event RPC was technically infeasible due to tight coupling to event-only taxonomy validation. Trip RPC validates trip_destination_required + trip_capacity_required + trip_dates_required + trip_end_before_start + trip_days_required + trip_pricing_tier_required + event_title_required + standard auth/permission checks. event_type=event publish stays on business_publish_event_draft (byte-unchanged).';

-- Self-verification probe
DO $$
DECLARE
  fn_exists boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM pg_proc
    WHERE proname = 'business_publish_trip_draft'
      AND pronamespace = 'public'::regnamespace
  ) INTO fn_exists;

  IF NOT fn_exists THEN
    RAISE EXCEPTION 'ORCH-0859 migration: business_publish_trip_draft function not created';
  END IF;

  RAISE NOTICE 'ORCH-0859 migration complete: business_publish_trip_draft function created (event RPC unchanged)';
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';
