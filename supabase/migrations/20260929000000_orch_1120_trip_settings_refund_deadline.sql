-- ===========================================================================
-- ORCH-1120 [Published-trip Settings tab → editable refund tiers + booking
-- deadline + bookings-closed (sales-gated)] — extend biz_update_live_trip.
--
-- Re-emits the AUTHORITATIVE biz_update_live_trip body VERBATIM from migration
-- 20260911000000_orch_1075_paid_publish_integrity_guards.sql (the newest
-- migration that defines this function; ORCH-1118 has NOT yet merged a
-- migration touching it — confirmed at IMPLEMENT time 2026-06-12 by
-- `grep -rln biz_update_live_trip supabase/migrations` across the anchor +
-- all active worktrees: 1075 is the newest definer). If a later ORCH (e.g.
-- 1118) merges a biz_update_live_trip rewrite BEFORE this lands, the
-- whichever-merges-second migration MUST re-emit from THAT body, not 1075
-- (clobber hazard — feedback_edge_deploy_and_migration_apply_hazards).
--
-- ADDED on top of the verbatim 1075 body (and ONLY these):
--   §4g — refund_policy / booking_deadline / bookings_closed buyer-protection
--         gate. Buyer-UNFAVORABLE edits HARD-BLOCK when paid non-cancelled
--         orders exist (v_total_sold > 0); buyer-FAVORABLE edits always
--         apply; no sales => everything editable. Returns the affected-order
--         count + one of 3 new reasons.
--   §5f — apply block: writes refund_policy / booking_deadline /
--         bookings_closed (+ bookings_closed_at semantics) only when present
--         in the post-gate patch.
--   §6  — severity: the 3 new keys are MATERIAL (buyer-relied-upon terms).
--   GRANT + COMMENT re-emitted (GRANT stays AFTER the closing $$;).
--
-- Function returns a scalar jsonb (NOT RETURNS TABLE) and the return type is
-- UNCHANGED, so NO `DROP FUNCTION` is needed (no widening). Dollar-quoting
-- stays `$$` exactly as in 1075; the closing `$$;` precedes the GRANT.
-- Idempotent CREATE OR REPLACE; no DDL, no backfill, no column adds (the 3
-- columns + bookings_closed_at already exist from TR4 migration
-- 20260612000000). Safe to re-run.
--
-- The new gate mirrors biz_compute_refund_for_cancel's tier selection
-- (TR4 L231-237): the winning tier for `d` whole-days-before-start is the one
-- with the LARGEST days_before_start <= d, else 0% (NULL policy => 0 at every
-- d). The edit is UNFAVORABLE iff the realized refund_pct DROPS at any
-- threshold in the union of both policies' thresholds (∪ {0}). This is the
-- money-accurate "buyer-unfavorable" test — it captures tier removal AND
-- tier-% reduction. Per SPEC §4.1.A + Q-1 default: ALL refund downgrades
-- return reason `refund_policy_downgrade_with_sales`; the design's
-- `refund_tier_removed_with_sales` reason is RESERVED (added to the TS union +
-- dialog for an exhaustive type) but the RPC does NOT emit it under this
-- classifier.
--
-- Spec: Mingla_Artifacts/specs/SPEC_ORCH-1120_TRIP_SETTINGS_REFUND_DEADLINE.md
-- ===========================================================================

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
  v_ticket_type_id uuid;
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
  v_now timestamptz := now();
  -- ORCH-0880 Tr5 additions:
  v_intake_schema_entry jsonb;
  v_intake_ticket_type_id uuid;
  v_intake_schema jsonb;
  v_intake_changed_tier_ids uuid[] := '{}'::uuid[];
  -- ORCH-1075: paid-edit guard locals.
  v_trip_price_cents int;
  v_guard_end timestamptz;
  -- ORCH-1120: refund/deadline/bookings-closed gate locals.
  v_old_policy jsonb;
  v_new_policy jsonb;
  v_thresholds int[];
  v_threshold int;
  v_old_pct int;
  v_new_pct int;
  v_refund_unfavorable boolean := false;
  v_old_deadline timestamptz;
  v_new_deadline timestamptz;
  v_old_closed boolean;
  v_new_closed boolean;
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


  -- ORCH-1075 paid-publish integrity guards (trip live-edit) -------------
  -- Block a PAID trip edit while not Stripe-ready, and block shifting a paid
  -- trip's range onto an already-past end. Structured return shape matches this
  -- RPC. FREE / in-person-only trips are exempt. Effective end = patched endAt
  -- when present, else the current master event_date end.
  --   Stripe charges_enabled: https://docs.stripe.com/api/accounts/object
  --   Finish onboarding:      https://docs.stripe.com/connect/onboarding.md
  SELECT max(tt.price_cents) INTO v_trip_price_cents
    FROM public.trip_pricing_tiers tpt
    JOIN public.ticket_types tt ON tt.id = tpt.ticket_type_id
   WHERE tpt.event_id = p_event_id
     AND tt.deleted_at IS NULL
     AND tt.available_online = true;

  IF COALESCE(v_trip_price_cents, 0) > 0 THEN
    IF NOT public.pg_brand_can_charge(v_event.brand_id) THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'stripe_charges_disabled');
    END IF;
    v_guard_end := COALESCE(
      NULLIF(p_patch->'theme'->'business_trip'->>'endAt', '')::timestamptz,
      (SELECT ed.end_at FROM public.event_dates ed
        WHERE ed.event_id = p_event_id AND ed.is_master = true LIMIT 1)
    );
    IF v_guard_end IS NULL OR v_guard_end <= v_now THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'offering_date_past');
    END IF;
  END IF;

  -- ---------- 3. Compute sold-count context ----------
  v_sold_by_tier := public.biz_trip_sold_count_by_tier(p_event_id);

  SELECT COALESCE(SUM((value)::int), 0)
    INTO v_total_sold
    FROM jsonb_each_text(v_sold_by_tier);

  -- ---------- 4. Refund-gate validation per patch shape ----------

  -- 4a. Capacity check. ORCH-0950: source of truth is ticket_types.quantity_total.
  v_business_trip := COALESCE(v_event.theme->'business_trip', '{}'::jsonb);
  v_new_business_trip := COALESCE(p_patch->'theme'->'business_trip', '{}'::jsonb);

  IF v_new_business_trip ? 'capacity' THEN
    v_new_capacity := NULLIF(v_new_business_trip->>'capacity', '')::int;
    IF v_new_capacity IS NULL OR v_new_capacity <= 0 THEN
      RAISE EXCEPTION 'trip_capacity_required';
    END IF;

    SELECT tt.quantity_total, tt.id
      INTO v_old_capacity, v_ticket_type_id
    FROM public.ticket_types tt
    JOIN public.trip_pricing_tiers tpt ON tpt.ticket_type_id = tt.id
    WHERE tpt.event_id = p_event_id
      AND tt.deleted_at IS NULL
    LIMIT 1;

    IF v_ticket_type_id IS NULL THEN
      RAISE EXCEPTION 'trip_pricing_tier_missing';
    END IF;

    IF v_new_capacity < v_total_sold THEN
      RETURN jsonb_build_object(
        'ok', false,
        'reason', 'capacity_below_sold',
        'affected_order_count', v_total_sold
      );
    END IF;

    UPDATE public.ticket_types
    SET quantity_total = v_new_capacity,
        updated_at = v_now
    WHERE id = v_ticket_type_id;

    -- Remove capacity from the inbound patch before any theme merge.
    p_patch := p_patch #- '{theme,business_trip,capacity}';
  END IF;

  -- 4b. Date shift check
  IF v_new_business_trip ? 'startAt' OR v_new_business_trip ? 'endAt' THEN
    SELECT ed.start_at, ed.end_at
      INTO v_old_start, v_old_end
    FROM public.event_dates ed
    WHERE ed.event_id = p_event_id
      AND ed.is_master = true
    LIMIT 1;

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

    UPDATE public.event_dates
    SET start_at = COALESCE(v_new_start, start_at),
        end_at = COALESCE(v_new_end, end_at),
        updated_at = v_now
    WHERE event_id = p_event_id
      AND is_master = true;

    p_patch := p_patch #- '{theme,business_trip,startAt}';
    p_patch := p_patch #- '{theme,business_trip,endAt}';
  END IF;

  -- 4b2. Destination text canonical write.
  IF v_new_business_trip ? 'destinationLocationText' THEN
    UPDATE public.events
    SET destination_text = NULLIF(btrim(v_new_business_trip->>'destinationLocationText'), ''),
        updated_at = v_now
    WHERE id = p_event_id;

    p_patch := p_patch #- '{theme,business_trip,destinationLocationText}';
    p_patch := p_patch #- '{theme,business_trip,destinationPlaceId}';
    p_patch := p_patch #- '{theme,business_trip,destinationLat}';
    p_patch := p_patch #- '{theme,business_trip,destinationLng}';
  END IF;

  -- ORCH-0950 expanded: preserve any non-canonical future business_trip
  -- siblings with a deep merge, then remove business_trip from p_patch so the
  -- top-level theme merge below cannot shallow-replace the nested object.
  IF p_patch ? 'theme'
     AND p_patch->'theme' ? 'business_trip'
     AND p_patch->'theme'->'business_trip' <> '{}'::jsonb THEN
    UPDATE public.events
    SET theme = jsonb_set(
          COALESCE(theme, '{}'::jsonb),
          '{business_trip}',
          COALESCE(theme->'business_trip', '{}'::jsonb)
            || (p_patch->'theme'->'business_trip')
        ),
        updated_at = v_now
    WHERE id = p_event_id;

    p_patch := p_patch #- '{theme,business_trip}';
  END IF;

  IF p_patch ? 'theme'
     AND p_patch->'theme' ? 'business_trip'
     AND p_patch->'theme'->'business_trip' = '{}'::jsonb THEN
    p_patch := p_patch #- '{theme,business_trip}';
  END IF;
  IF p_patch ? 'theme' AND p_patch->'theme' = '{}'::jsonb THEN
    p_patch := p_patch - 'theme';
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
  -- decision). Schema validation runs but no hard reject on sold>0 - re-answer
  -- notification fan-out handles affected buyers via Section 6 trigger.
  IF p_patch ? 'intake_schemas' THEN
    IF jsonb_typeof(p_patch->'intake_schemas') <> 'array' THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'invalid_intake_schemas_payload');
    END IF;

    FOR v_intake_schema_entry IN
      SELECT * FROM jsonb_array_elements(p_patch->'intake_schemas')
    LOOP
      v_intake_ticket_type_id := (v_intake_schema_entry->>'ticket_type_id')::uuid;
      v_intake_schema := v_intake_schema_entry->'schema';

      IF v_intake_ticket_type_id IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'intake_schema_missing_ticket_type_id');
      END IF;

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

      IF v_intake_schema IS NOT NULL
         AND NOT public.validate_trip_intake_schema(v_intake_schema) THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'invalid_intake_schema');
      END IF;
    END LOOP;
  END IF;

  -- 4g. ORCH-1120 refund_policy / booking_deadline / bookings_closed gate.
  -- Buyer-FAVORABLE edits always allowed. Buyer-UNFAVORABLE edits HARD-BLOCK
  -- when v_total_sold > 0. No sales => everything allowed. Only present patch
  -- keys are evaluated (client omits unchanged keys). Validate/classify BEFORE
  -- any write; on a block we RETURN before §5f so nothing persists.

  -- 4g.1 refund_policy
  IF p_patch ? 'refund_policy' THEN
    v_old_policy := v_event.refund_policy;
    v_new_policy := CASE
                      WHEN jsonb_typeof(p_patch->'refund_policy') = 'null' THEN NULL
                      ELSE p_patch->'refund_policy'
                    END;

    -- Shape validation (belt-and-suspenders; the events_refund_policy_valid
    -- CHECK also fires on the §5f UPDATE). A bad shape RAISEs and propagates
    -- as the existing CHECK path (the service maps it to a friendly error).
    PERFORM public.validate_refund_policy(v_new_policy);

    -- Favorable/unfavorable classification only matters when sales exist.
    IF v_total_sold > 0 THEN
      -- Thresholds = union of both policies' days_before_start + {0}.
      v_thresholds := (
        SELECT array_agg(DISTINCT x)
        FROM (
          SELECT (t->>'days_before_start')::int AS x
            FROM jsonb_array_elements(COALESCE(v_old_policy->'tiers', '[]'::jsonb)) t
          UNION
          SELECT (t->>'days_before_start')::int
            FROM jsonb_array_elements(COALESCE(v_new_policy->'tiers', '[]'::jsonb)) t
          UNION
          SELECT 0
        ) u
      );

      v_refund_unfavorable := false;
      IF v_thresholds IS NOT NULL THEN
        FOREACH v_threshold IN ARRAY v_thresholds LOOP
          -- realized refund_pct at v_threshold = winning tier (largest
          -- days_before_start <= v_threshold), else 0. Mirrors
          -- biz_compute_refund_for_cancel tier selection (TR4 L231-237).
          SELECT COALESCE(
            (SELECT (te->>'refund_pct')::int
               FROM jsonb_array_elements(COALESCE(v_old_policy->'tiers', '[]'::jsonb)) te
              WHERE (te->>'days_before_start')::int <= v_threshold
              ORDER BY (te->>'days_before_start')::int DESC
              LIMIT 1),
            0
          ) INTO v_old_pct;

          SELECT COALESCE(
            (SELECT (te->>'refund_pct')::int
               FROM jsonb_array_elements(COALESCE(v_new_policy->'tiers', '[]'::jsonb)) te
              WHERE (te->>'days_before_start')::int <= v_threshold
              ORDER BY (te->>'days_before_start')::int DESC
              LIMIT 1),
            0
          ) INTO v_new_pct;

          IF v_new_pct < v_old_pct THEN
            v_refund_unfavorable := true;
            EXIT;
          END IF;
        END LOOP;
      END IF;

      IF v_refund_unfavorable THEN
        RETURN jsonb_build_object(
          'ok', false,
          'reason', 'refund_policy_downgrade_with_sales',
          'affected_order_count', v_total_sold
        );
      END IF;
    END IF;
  END IF;

  -- 4g.2 booking_deadline
  IF p_patch ? 'booking_deadline' THEN
    v_old_deadline := v_event.booking_deadline;
    v_new_deadline := CASE
                        WHEN jsonb_typeof(p_patch->'booking_deadline') = 'null' THEN NULL
                        ELSE (p_patch->>'booking_deadline')::timestamptz
                      END;

    -- Unfavorable = pulling the deadline EARLIER (shrinks the booking window).
    -- NULL->deadline = newly closing earlier than "never" = unfavorable.
    -- Later deadline, or clearing to NULL = favorable, always allowed.
    IF v_total_sold > 0
       AND v_new_deadline IS NOT NULL
       AND (v_old_deadline IS NULL OR v_new_deadline < v_old_deadline) THEN
      RETURN jsonb_build_object(
        'ok', false,
        'reason', 'booking_deadline_earlier_with_sales',
        'affected_order_count', v_total_sold
      );
    END IF;

    -- Future-validity (no 5th reason per SPEC §4.1.2 LOCKED): a past deadline
    -- cannot be produced by the client picker (it bounds to future <= start).
    -- Defensive clamp: if a past deadline somehow arrives, drop the write so
    -- nothing harmful persists, but do not block the rest of the patch.
    IF v_new_deadline IS NOT NULL AND v_new_deadline <= v_now THEN
      p_patch := p_patch - 'booking_deadline';
    END IF;
  END IF;

  -- 4g.3 bookings_closed
  IF p_patch ? 'bookings_closed' THEN
    v_old_closed := v_event.bookings_closed;
    v_new_closed := (p_patch->>'bookings_closed')::boolean;

    -- Harmful flip = closing bookings (false -> true) while sales exist.
    -- Opening (true -> false) is favorable, always allowed. No implicit
    -- coupling with the deadline field — each field evaluated independently.
    IF v_total_sold > 0 AND v_old_closed = false AND v_new_closed = true THEN
      RETURN jsonb_build_object(
        'ok', false,
        'reason', 'bookings_closed_harms_active',
        'affected_order_count', v_total_sold
      );
    END IF;
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
                   THEN COALESCE(theme, '{}'::jsonb) || (p_patch->'theme') ELSE theme END,
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
      updated_at = v_now
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

  -- 5e. ORCH-0880 Tr5 intake_schemas upsert.
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
          v_now,
          v_now
        )
        ON CONFLICT (event_id, ticket_type_id) DO UPDATE
          SET schema = EXCLUDED.schema,
              schema_version_id = EXCLUDED.schema_version_id,
              updated_at = v_now;
      END IF;
    END LOOP;
  END IF;

  -- 5f. ORCH-1120 refund/deadline/bookings-closed writes (gate passed above).
  -- Each field writes only if present in the (post-gate) patch. bookings_closed_at
  -- mirrors the cron/standalone semantics: set to now() on a false->true close,
  -- cleared on any ->false open (matches process-booking-deadlines +
  -- refundPolicyService.updateBookingDeadline). The events_refund_policy_valid
  -- CHECK validates refund_policy on this UPDATE as defense-in-depth.
  IF p_patch ? 'refund_policy' OR p_patch ? 'booking_deadline' OR p_patch ? 'bookings_closed' THEN
    UPDATE public.events SET
      refund_policy   = CASE WHEN p_patch ? 'refund_policy'
                             THEN (CASE WHEN jsonb_typeof(p_patch->'refund_policy') = 'null'
                                        THEN NULL ELSE p_patch->'refund_policy' END)
                             ELSE refund_policy END,
      booking_deadline = CASE WHEN p_patch ? 'booking_deadline'
                             THEN (CASE WHEN jsonb_typeof(p_patch->'booking_deadline') = 'null'
                                        THEN NULL ELSE (p_patch->>'booking_deadline')::timestamptz END)
                             ELSE booking_deadline END,
      bookings_closed = CASE WHEN p_patch ? 'bookings_closed'
                             THEN (p_patch->>'bookings_closed')::boolean
                             ELSE bookings_closed END,
      bookings_closed_at = CASE
                             WHEN p_patch ? 'bookings_closed' AND (p_patch->>'bookings_closed')::boolean = true
                                  AND bookings_closed = false THEN v_now
                             WHEN p_patch ? 'bookings_closed' AND (p_patch->>'bookings_closed')::boolean = false
                                  THEN NULL
                             ELSE bookings_closed_at END,
      updated_at = v_now
    WHERE id = p_event_id;
  END IF;

  -- ---------- 6. Compute changed_keys + severity + diff_summary ----------
  v_changed_keys := ARRAY(SELECT jsonb_object_keys(p_patch));

  IF (p_patch ? 'days' OR p_patch ? 'inclusions' OR p_patch ? 'pricing_tiers' OR p_patch ? 'intake_schemas'
      OR p_patch ? 'refund_policy' OR p_patch ? 'booking_deadline' OR p_patch ? 'bookings_closed')
     OR (v_new_business_trip ?| ARRAY['startAt','endAt',
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
    v_now
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
  'ORCH-0876 + ORCH-0880 Tr5: atomic published-trip patch writer. Validates auth + reason + event_type + status + permission, runs refund-gate (8 paths from ORCH-0876 + intake_schemas validation from ORCH-0880), applies patch across events + trip_days + trip_inclusions + trip_pricing_tiers + ticket_types + trip_intake_schemas, inserts trip_edit_log row, returns {ok, severity, changed_keys, edit_log_entry_id, affected_order_count, intake_changed_tier_ids}. ORCH-0880 §15.3 extension: accepts intake_schemas array patch key for per-tier intake form schema updates (UPSERT to trip_intake_schemas table). / ORCH-0950 expanded: trip capacity, dates, and destination text route to canonical columns; business_trip uses defensive deep merge only for non-canonical future keys. / ORCH-1120: also accepts refund_policy / booking_deadline / bookings_closed patch keys; buyer-unfavorable edits (lower realized refund %, earlier deadline, harmful bookings-closed flip) hard-block when sold>0 with reasons refund_policy_downgrade_with_sales / booking_deadline_earlier_with_sales / bookings_closed_harms_active. Favorable edits (raise realized %, later/cleared deadline, reopen bookings) always apply; no sales => everything editable. Classification is by realized refund_pct (matches biz_compute_refund_for_cancel), not literal tier-array shape, so refund_tier_removed_with_sales is RESERVED-but-unused (all downgrades emit refund_policy_downgrade_with_sales).';
