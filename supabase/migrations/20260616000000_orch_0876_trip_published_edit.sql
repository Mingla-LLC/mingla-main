-- ============================================================
-- ORCH-0876 [Trip CRUD + Purchase Flow Completion — Full Event↔Trip Parity]
--
-- Migration creates the server-side substrate for published-trip edit:
--   1. `trip_edit_log` audit table (append-only via RPC, owner-read RLS)
--   2. `biz_trip_sold_count_by_tier(p_event_id)` helper — per-tier sold counts
--   3. `biz_trip_has_web_purchases(p_event_id)` helper — SMS-channel gate
--   4. `biz_update_live_trip(p_event_id, p_patch, p_reason)` main RPC —
--      atomic transaction across events + trip_days + trip_inclusions +
--      trip_pricing_tiers + ticket_types + trip_edit_log; enforces all
--      refund-gate rejection paths (8 reasons) per SPEC §11 SC-4.18..4.19.
--
-- Architecture note (F-17 leapfrog): trips do NOT replicate events'
-- Zustand-only-write pattern. Every published-trip edit goes through this
-- RPC. Server-side validation + DB-level CHECK on reason length + RLS
-- with NO INSERT/UPDATE/DELETE policy = tamper-resistant audit trail.
--
-- See: Mingla_Artifacts/specs/SPEC_ORCH-0876_V2_FULL_PARITY.md §4
-- ============================================================

BEGIN;

-- ============================================================
-- Section 1 — trip_edit_log table
-- ============================================================
CREATE TABLE public.trip_edit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  edited_by uuid NOT NULL REFERENCES auth.users(id),
  reason text NOT NULL CHECK (char_length(reason) BETWEEN 10 AND 200),
  severity text NOT NULL CHECK (severity IN ('additive', 'material')),
  changed_field_keys text[] NOT NULL DEFAULT '{}',
  diff_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  affected_order_ids uuid[] NOT NULL DEFAULT '{}',
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX trip_edit_log_event_id_idx
  ON public.trip_edit_log (event_id, occurred_at DESC);

CREATE INDEX trip_edit_log_brand_id_idx
  ON public.trip_edit_log (brand_id, occurred_at DESC);

ALTER TABLE public.trip_edit_log ENABLE ROW LEVEL SECURITY;

-- Read: owner brand at event_manager+ rank reads own brand's logs.
CREATE POLICY "trip_edit_log_owner_read"
  ON public.trip_edit_log
  FOR SELECT
  USING (
    public.biz_brand_effective_rank(brand_id, auth.uid())
      >= public.biz_role_rank('event_manager'::text)
  );

-- NO INSERT/UPDATE/DELETE policies — only biz_update_live_trip
-- (SECURITY DEFINER) writes. Direct client mutation is impossible.

COMMENT ON TABLE public.trip_edit_log IS
  'ORCH-0876: append-only audit log for published-trip edits. Written exclusively by biz_update_live_trip RPC. Owner reads own brand logs.';

-- ============================================================
-- Section 2 — Helper: per-tier sold counts for a trip
-- ============================================================
CREATE OR REPLACE FUNCTION public.biz_trip_sold_count_by_tier(
  p_event_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_result jsonb := '{}'::jsonb;
BEGIN
  -- Returns { ticket_type_id: count, ... } for confirmed orders.
  -- Confirmed = orders.payment_status NOT IN ('failed', 'cancelled').
  SELECT COALESCE(jsonb_object_agg(ticket_type_id::text, sold_count), '{}'::jsonb)
  INTO v_result
  FROM (
    SELECT
      oli.ticket_type_id,
      SUM(oli.quantity)::int AS sold_count
    FROM public.orders o
    JOIN public.order_line_items oli ON oli.order_id = o.id
    WHERE o.event_id = p_event_id
      AND o.payment_status NOT IN ('failed', 'cancelled')
      AND oli.ticket_type_id IS NOT NULL
    GROUP BY oli.ticket_type_id
  ) s;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.biz_trip_sold_count_by_tier(uuid)
  TO authenticated;

COMMENT ON FUNCTION public.biz_trip_sold_count_by_tier(uuid) IS
  'ORCH-0876: returns { ticket_type_id: sold_count } jsonb for a trip''s confirmed orders. Used by biz_update_live_trip refund-gate.';

-- ============================================================
-- Section 3 — Helper: has-web-purchases predicate
-- ============================================================
CREATE OR REPLACE FUNCTION public.biz_trip_has_web_purchases(
  p_event_id uuid
) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.orders
    WHERE event_id = p_event_id
      AND payment_status NOT IN ('failed', 'cancelled')
      AND payment_method IN ('card', 'apple_pay', 'google_pay')
  );
$$;

GRANT EXECUTE ON FUNCTION public.biz_trip_has_web_purchases(uuid)
  TO authenticated;

COMMENT ON FUNCTION public.biz_trip_has_web_purchases(uuid) IS
  'ORCH-0876: predicate for SMS-channel gate in tripChangeNotifier.deriveTripChannelFlags. Used by useTripHasWebPurchases hook.';

-- ============================================================
-- Section 4 — Main RPC: biz_update_live_trip
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

  -- 4b. Date shift check (theme.business_trip.startAt or endAt)
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

  -- 4c. Days check — dropped trip_day ordinals with sales
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

  -- 4d. Inclusions check — dropped inclusion keys with sales
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

  -- 4e. Pricing tier checks — tier_delete_with_sales, tier_price_change_with_sales
  IF p_patch ? 'pricing_tiers' THEN
    FOR v_tier IN
      SELECT tpt.id AS tpt_id, tpt.ticket_type_id, tt.price_cents
      FROM public.trip_pricing_tiers tpt
      JOIN public.ticket_types tt ON tt.id = tpt.ticket_type_id
      WHERE tpt.event_id = p_event_id
    LOOP
      -- Look up matching tier in patch by ticket_type_id
      SELECT t INTO v_new_tier
        FROM jsonb_array_elements(p_patch->'pricing_tiers') t
       WHERE (t->>'ticket_type_id')::uuid = v_tier.ticket_type_id
       LIMIT 1;

      IF v_new_tier IS NULL THEN
        -- Tier deleted from patch
        IF COALESCE((v_sold_by_tier->>v_tier.ticket_type_id::text)::int, 0) > 0 THEN
          RETURN jsonb_build_object(
            'ok', false,
            'reason', 'tier_delete_with_sales',
            'affected_order_count', (v_sold_by_tier->>v_tier.ticket_type_id::text)::int
          );
        END IF;
      ELSIF v_new_tier ? 'price_cents'
            AND (v_new_tier->>'price_cents')::int IS DISTINCT FROM v_tier.price_cents THEN
        -- Tier price changed
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

  -- ---------- 5. Apply patch ----------
  -- 5a. events row update (title, description, theme, cover_media_*)
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
    -- Delete dropped days
    IF v_dropped_ordinals IS NOT NULL AND array_length(v_dropped_ordinals, 1) > 0 THEN
      DELETE FROM public.trip_days
        WHERE event_id = p_event_id
          AND ordinal = ANY (v_dropped_ordinals);
    END IF;
    -- Upsert kept/new days
    INSERT INTO public.trip_days (event_id, ordinal, title, narrative)
      SELECT p_event_id,
             (d->>'ordinal')::int,
             d->>'title',
             NULLIF(d->>'narrative', '')
        FROM jsonb_array_elements(p_patch->'days') d
      ON CONFLICT (event_id, ordinal)
      DO UPDATE SET title = EXCLUDED.title, narrative = EXCLUDED.narrative;
  END IF;

  -- 5c. trip_inclusions: replace-all (safe because dropped-with-sales is gated above)
  IF p_patch ? 'inclusions' THEN
    DELETE FROM public.trip_inclusions WHERE event_id = p_event_id;
    INSERT INTO public.trip_inclusions (event_id, kind, item, ordinal)
      SELECT p_event_id, i->>'kind', i->>'item', (i->>'ordinal')::int
        FROM jsonb_array_elements(p_patch->'inclusions') i;
  END IF;

  -- 5d. trip_pricing_tiers upsert (tier name + tier_metadata)
  -- ticket_types row updated for price_cents change (no-sale guard cleared above).
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

  -- ---------- 6. Compute changed_keys + severity + diff_summary ----------
  v_changed_keys := ARRAY(SELECT jsonb_object_keys(p_patch));

  -- Severity: material if any MATERIAL_KEYS changed; else additive
  -- MATERIAL: days/inclusions/pricing_tiers (when structural change), OR
  -- theme.business_trip.{startAt,endAt,destinationLocationText,capacity}
  IF (p_patch ? 'days' OR p_patch ? 'inclusions' OR p_patch ? 'pricing_tiers')
     OR (p_patch ? 'theme' AND v_new_business_trip ?| ARRAY['startAt','endAt',
                                                            'destinationLocationText','capacity']::text[]) THEN
    v_severity := 'material';
  ELSE
    v_severity := 'additive';
  END IF;

  v_diff_summary := jsonb_build_object(
    'changed_keys', to_jsonb(v_changed_keys),
    'dropped_day_ordinals', to_jsonb(COALESCE(v_dropped_ordinals, '{}'::int[])),
    'dropped_inclusions', to_jsonb(COALESCE(v_dropped_inclusions, '{}'::text[]))
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
    'affected_order_count', COALESCE(array_length(v_affected_order_ids, 1), 0)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.biz_update_live_trip(uuid, jsonb, text)
  TO authenticated;

COMMENT ON FUNCTION public.biz_update_live_trip(uuid, jsonb, text) IS
  'ORCH-0876: atomic published-trip patch writer. Validates auth + reason (10-200 chars) + event_type + status + permission, runs 8-path refund-gate, applies patch across events + trip_days + trip_inclusions + trip_pricing_tiers + ticket_types, inserts trip_edit_log row, returns {ok, severity, changed_keys, edit_log_entry_id, affected_order_count}. Rejects return {ok:false, reason, affected_order_count?, dropped_dates?, dropped_inclusions?}.';

COMMIT;
