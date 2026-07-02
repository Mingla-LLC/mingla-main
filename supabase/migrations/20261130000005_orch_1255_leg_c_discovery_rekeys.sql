-- ===========================================================================
-- META-ORCH-1255(C) M6 — Leg C ratified discovery re-keys (D-A / D-B / D-D)
-- + one Leg-C-discovered read-model break (D-F).
--
-- Spec: Mingla_Artifacts/specs/SPEC_META-ORCH-1255_MULTI_VENUE_FIRST_CLASS.md
-- Leg A report discoveries #1/#2 + Leg B discovery #3 (ratified by the
-- orchestrator as D-A / D-B / D-D in the Leg C dispatch).
--
--   D-A  admin_tweak_venue_claim_fields + admin_apply_score_override read the
--        now-inert brands.place_pool_id / brands.claim_status → re-keyed to
--        the venue_listings row (p_brand_id → p_venue_id).
--   D-B  resolve_brand_pricing_inputs LEFT JOINs venue_reservation_settings
--        ON s.brand_id = b.id; post-M3 a brand can hold N settings rows so
--        the resolver could return N rows and venue-reservation-create took
--        rows[0] (arbitrary winner). Now: optional p_venue_id resolves THAT
--        venue's overrides; without it the settings contribution applies only
--        when the brand has exactly ONE settings row — never an arbitrary row.
--   D-D  venue_intelligence_overview read brands.place_pool_id (legacy-inert)
--        for signal scores + tz-offset, and venue_availability_config by
--        brand with LIMIT 1 (non-deterministic at N venues). Now: optional
--        p_venue_id resolves the venue's place/config; without it a
--        single-venue brand resolves deterministically, else legacy fallback.
--   D-F  (discovered at Leg C implement) public_menus_view was gated on
--        brands.claim_status = 'verified' — post-1255 NO brand is ever
--        'verified' again (the hidden-brand writer is decommissioned), so the
--        public menu read model would be PERMANENTLY EMPTY, breaking the
--        public venue page §6.6 menu section AND the brand page Menu tab.
--        Gate re-keyed: the brand has ≥1 verified venue_listings row.
--
-- No table data is mutated; function/view DDL only. Old signatures whose key
-- param renamed are DROPped in the same migration (PostgREST named-arg calls
-- would otherwise be ambiguous). Apply via the Supabase Management API from
-- MERGED main at CLOSE, after M1–M5, verified with the read-backs in the
-- Leg C implementation report §11.
-- ===========================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. D-A — admin_tweak_venue_claim_fields(p_venue_id, p_patch)
--    Re-stated from 20260831000000 (META-ORCH-1062) changing ONLY the keying:
--    brand row reads/writes → venue_listings row; place resolved via
--    venue_listings.place_pool_id. Whitelist, validation, return shape, and
--    the pending-only guard are byte-identical in behavior (the guard now
--    reads the VENUE claim machine, which is where D-4 moved it).
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.admin_tweak_venue_claim_fields(uuid, jsonb);

CREATE OR REPLACE FUNCTION public.admin_tweak_venue_claim_fields(
  p_venue_id uuid,
  p_patch    jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_venue        public.venue_listings%ROWTYPE;
  v_pp_id        uuid;
  v_fetched_via  text;
  v_key          text;
  v_address      text;
  v_category     text;
  v_price_level  text;
  v_price_tiers  jsonb;
  v_applied      jsonb := '{}'::jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;
  IF NOT public.is_admin_user() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object' THEN
    RAISE EXCEPTION 'invalid_patch';
  END IF;

  -- Whitelist EXACTLY these keys; any other key is a hard reject.
  FOR v_key IN SELECT jsonb_object_keys(p_patch) LOOP
    IF v_key NOT IN ('address', 'venue_category', 'price_level', 'price_tiers') THEN
      RAISE EXCEPTION 'invalid_patch_key';
    END IF;
  END LOOP;

  SELECT v.* INTO v_venue
  FROM public.venue_listings v
  JOIN public.brands b ON b.id = v.brand_id AND b.deleted_at IS NULL
  WHERE v.id = p_venue_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'venue_not_found';
  END IF;

  -- Pending-only: never rewrite a live (verified) or rejected venue's data.
  IF v_venue.claim_status <> 'pending_review' THEN
    RAISE EXCEPTION 'venue_not_pending_review';
  END IF;

  v_pp_id := v_venue.place_pool_id;
  IF v_pp_id IS NOT NULL THEN
    SELECT fetched_via INTO v_fetched_via FROM public.place_pool WHERE id = v_pp_id;
  END IF;

  -- address → venue_listings.address AND place_pool.address
  IF p_patch ? 'address' THEN
    v_address := nullif(trim(p_patch->>'address'), '');
    UPDATE public.venue_listings SET address = v_address WHERE id = p_venue_id;
    IF v_pp_id IS NOT NULL THEN
      UPDATE public.place_pool SET address = v_address WHERE id = v_pp_id;
    END IF;
    v_applied := v_applied || jsonb_build_object('address', v_address);
  END IF;

  -- venue_category → venue_listings.venue_category. The M1 CHECK constraint
  -- (restaurant/play/creative_and_arts) hard-rejects an invalid value — the
  -- admin sees the constraint error rather than a silent bad write. types
  -- remap stays deferred exactly as in the 1062 def.
  IF p_patch ? 'venue_category' THEN
    v_category := nullif(trim(p_patch->>'venue_category'), '');
    IF v_category IS NULL THEN
      RAISE EXCEPTION 'invalid_patch_key';
    END IF;
    UPDATE public.venue_listings SET venue_category = v_category WHERE id = p_venue_id;
    v_applied := v_applied || jsonb_build_object('venue_category', v_category);
  END IF;

  -- price_level → place_pool.price_level
  IF p_patch ? 'price_level' THEN
    v_price_level := nullif(trim(p_patch->>'price_level'), '');
    IF v_pp_id IS NOT NULL THEN
      UPDATE public.place_pool SET price_level = v_price_level WHERE id = v_pp_id;
    END IF;
    v_applied := v_applied || jsonb_build_object('price_level', v_price_level);
  END IF;

  -- price_tiers → place_pool.price_tiers (jsonb array passthrough)
  IF p_patch ? 'price_tiers' THEN
    v_price_tiers := p_patch->'price_tiers';
    IF v_pp_id IS NOT NULL THEN
      UPDATE public.place_pool SET price_tiers = v_price_tiers WHERE id = v_pp_id;
    END IF;
    v_applied := v_applied || jsonb_build_object('price_tiers', v_price_tiers);
  END IF;

  RETURN jsonb_build_object('ok', true, 'applied', v_applied, 'fetched_via', v_fetched_via);
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_tweak_venue_claim_fields(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_tweak_venue_claim_fields(uuid, jsonb) TO authenticated;

COMMENT ON FUNCTION public.admin_tweak_venue_claim_fields(uuid, jsonb) IS
  'META-ORCH-1255(C) D-A re-key of the META-ORCH-1062 Phase 1 whitelisted field '
  'tweak (address/venue_category/price_level/price_tiers) — venue-keyed: reads/'
  'writes the pending_review venue_listings row + its place_pool (the brand '
  'claim pointer is legacy-inert).';

-- ---------------------------------------------------------------------------
-- 2. D-A — admin_apply_score_override(p_venue_id, p_signal_id, p_score, p_reason)
--    Re-stated from 20260831000000 changing ONLY the place resolution:
--    brands.place_pool_id (legacy-inert) → venue_listings.place_pool_id.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.admin_apply_score_override(uuid, text, numeric, text);

CREATE OR REPLACE FUNCTION public.admin_apply_score_override(
  p_venue_id  uuid,
  p_signal_id text,
  p_score     numeric,
  p_reason    text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_pp_id     uuid;
  v_original  numeric;
  v_version   uuid;
  v_now       timestamptz := now();
  v_veto      jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;
  IF NOT public.is_admin_user() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF p_signal_id IS NULL OR length(trim(p_signal_id)) = 0 THEN
    RAISE EXCEPTION 'signal_id_required';
  END IF;
  IF p_score IS NULL THEN
    RAISE EXCEPTION 'score_required';
  END IF;
  -- Clamp to the place_scores CHECK range (0–200). Reject out-of-range rather
  -- than silently clamping so the admin sees a clear error.
  IF p_score < 0 OR p_score > 200 THEN
    RAISE EXCEPTION 'score_out_of_range';
  END IF;

  SELECT v.place_pool_id INTO v_pp_id
  FROM public.venue_listings v
  JOIN public.brands b ON b.id = v.brand_id AND b.deleted_at IS NULL
  WHERE v.id = p_venue_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'venue_not_found';
  END IF;
  IF v_pp_id IS NULL THEN
    RAISE EXCEPTION 'no_linked_place';
  END IF;

  -- Validate signal exists + is active (so override targets a real deck signal).
  IF NOT EXISTS (SELECT 1 FROM public.signal_definitions sd
                 WHERE sd.id = p_signal_id AND sd.is_active = true) THEN
    RAISE EXCEPTION 'unknown_or_inactive_signal';
  END IF;

  -- Current computed score for this (place, signal), if any (audit "original").
  SELECT ps.score, ps.signal_version_id
  INTO v_original, v_version
  FROM public.place_scores ps
  WHERE ps.place_id = v_pp_id AND ps.signal_id = p_signal_id;

  -- Persist the audit slice on place_pool.ai_signal_scores_veto.
  v_veto := coalesce((SELECT pp.ai_signal_scores_veto FROM public.place_pool pp WHERE pp.id = v_pp_id), '{}'::jsonb);
  v_veto := v_veto || jsonb_build_object(
    p_signal_id, jsonb_build_object(
      'vetoed_score', p_score,
      'original_score', v_original,
      'reason', nullif(trim(coalesce(p_reason, '')), ''),
      'vetoed_at', v_now,
      'vetoed_by', auth.uid()
    )
  );
  UPDATE public.place_pool SET ai_signal_scores_veto = v_veto WHERE id = v_pp_id;

  -- Apply the REAL override to the deck-ranking place_scores.score. UPSERT so an
  -- override can create a deck-qualifying row even if the scorer produced none
  -- (operator-locked: admins may bump a deserving venue UP). signal_version_id
  -- falls back to the signal's current_version_id when no prior score row exists.
  IF v_version IS NULL THEN
    SELECT sd.current_version_id INTO v_version
    FROM public.signal_definitions sd WHERE sd.id = p_signal_id;
  END IF;

  INSERT INTO public.place_scores (place_id, signal_id, score, contributions, signal_version_id, scored_at)
  VALUES (
    v_pp_id, p_signal_id, p_score,
    jsonb_build_object('_admin_override', 1, '_original_score', v_original,
                       '_overridden_by', auth.uid(), '_reason', nullif(trim(coalesce(p_reason, '')), '')),
    v_version, v_now
  )
  ON CONFLICT (place_id, signal_id) DO UPDATE
    SET score = EXCLUDED.score,
        contributions = public.place_scores.contributions || EXCLUDED.contributions,
        scored_at = EXCLUDED.scored_at;

  RETURN jsonb_build_object(
    'ok', true,
    'signal_id', p_signal_id,
    'original_score', v_original,
    'new_score', p_score,
    'direction', CASE
      WHEN v_original IS NULL THEN 'created'
      WHEN p_score > v_original THEN 'raised'
      WHEN p_score < v_original THEN 'lowered'
      ELSE 'unchanged' END
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_apply_score_override(uuid, text, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_apply_score_override(uuid, text, numeric, text) TO authenticated;

COMMENT ON FUNCTION public.admin_apply_score_override(uuid, text, numeric, text) IS
  'META-ORCH-1255(C) D-A re-key of the META-ORCH-1062 Q2 bidirectional admin '
  'score override — the place is resolved via venue_listings.place_pool_id '
  '(brands.place_pool_id is legacy-inert). Behavior otherwise identical.';

-- ---------------------------------------------------------------------------
-- 3. D-B — resolve_brand_pricing_inputs(p_brand_id, p_venue_id DEFAULT NULL)
--    Re-stated from 20261012000003 (ORCH-1148 2.2) with DETERMINISTIC
--    venue-scoped settings resolution. Payments stay brand-keyed (D-1: one
--    brand, one Stripe account); ONLY the reservation pass_*_override source
--    is venue-resolved:
--      • p_venue_id given → that venue's settings row (≤1 by PK), asserted to
--        belong to the brand via the join predicate.
--      • p_venue_id NULL  → the settings row ONLY when the brand has exactly
--        one (single-venue back-compat); at N>1 rows the overrides drop out
--        and the brand defaults apply — NEVER an arbitrary rows[0] winner.
--    The old 1-arg signature is DROPped (same name, new default param would
--    make PostgREST named-arg calls ambiguous if both survived).
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.resolve_brand_pricing_inputs(uuid);

CREATE OR REPLACE FUNCTION public.resolve_brand_pricing_inputs(
  p_brand_id uuid,
  p_venue_id uuid DEFAULT NULL
)
RETURNS TABLE (
  pass_tax boolean,
  pass_mingla_fee boolean,
  pass_service_fee boolean,
  pricing_region text,
  pricing_currency text,
  effective_take_rate_bps integer,
  take_rate_source text,
  stripe_account_id text,
  stripe_charges_enabled boolean,
  payment_provider text,
  payment_country text,
  paystack_subaccount_code text,
  vat_rate_bps integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    -- reservation override (venue-resolved settings) wins; else brand default.
    COALESCE(s.pass_tax_override,  b.default_pass_tax)         AS pass_tax,
    COALESCE(s.pass_fee_override,  b.default_pass_mingla_fee)  AS pass_mingla_fee,
    COALESCE(s.pass_fee_override,  b.default_pass_service_fee) AS pass_service_fee,
    b.pricing_region                                          AS pricing_region,
    b.pricing_currency                                        AS pricing_currency,
    r.effective_take_rate_bps                                 AS effective_take_rate_bps,
    r.take_rate_source                                        AS take_rate_source,
    b.stripe_connect_id                                       AS stripe_account_id,
    b.stripe_charges_enabled                                  AS stripe_charges_enabled,
    b.payment_provider                                        AS payment_provider,
    b.payment_country                                         AS payment_country,
    b.paystack_subaccount_code                                AS paystack_subaccount_code,
    v.vat_rate_bps                                            AS vat_rate_bps
  FROM public.brands b
  LEFT JOIN LATERAL (
    SELECT s2.pass_tax_override, s2.pass_fee_override
    FROM public.venue_reservation_settings s2
    WHERE s2.brand_id = b.id
      AND (
        (p_venue_id IS NOT NULL AND s2.venue_id = p_venue_id)
        OR (
          p_venue_id IS NULL
          AND (SELECT count(*) FROM public.venue_reservation_settings s3
               WHERE s3.brand_id = b.id) = 1
        )
      )
    LIMIT 1
  ) s ON TRUE
  CROSS JOIN LATERAL public.resolve_effective_take_rate_bps(b.id) r
  LEFT JOIN public.country_vat_config v ON v.country = b.payment_country
  WHERE b.id = p_brand_id;
$$;

REVOKE ALL ON FUNCTION public.resolve_brand_pricing_inputs(uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.resolve_brand_pricing_inputs(uuid, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.resolve_brand_pricing_inputs(uuid, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_brand_pricing_inputs(uuid, uuid) TO service_role;

COMMENT ON FUNCTION public.resolve_brand_pricing_inputs(uuid, uuid) IS
  'META-ORCH-1255(C) D-B — brand-scoped reservation pricing resolver (D-1: '
  'payments stay brand-keyed) with DETERMINISTIC venue-scoped pass_*_override '
  'resolution: explicit p_venue_id → that venue''s settings; NULL → the single '
  'settings row iff exactly one exists, else brand defaults (never an '
  'arbitrary multi-row winner). Service-role-only (venue-reservation-create).';

-- ---------------------------------------------------------------------------
-- 4. D-D — venue_intelligence_overview(p_brand_id, p_venue_id DEFAULT NULL)
--    Re-stated from 20261117000000 (ORCH-1186-B) changing ONLY the venue/place
--    resolution:
--      • place pointer: brands.place_pool_id (legacy-inert) →
--        venue_listings.place_pool_id of the resolved venue.
--      • availability-config tz: brand-level LIMIT 1 (non-deterministic at
--        N venues) → the resolved venue's config row.
--      • venue resolution: explicit p_venue_id (asserted to belong to the
--        brand), else the brand's single venue when exactly one exists, else
--        NULL (the tz ladder falls through to events/UTC exactly as before;
--        legacy brands.place_pool_id remains the last-resort pointer so
--        pre-1255 data keeps working).
--    Orders remain brand-level (orders link via events; events are not
--    venue-keyed — out of D-D scope). Everything else byte-identical.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.venue_intelligence_overview(uuid);

CREATE OR REPLACE FUNCTION public.venue_intelligence_overview(
  p_brand_id uuid,
  p_venue_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_tz            text;
  v_tz_confidence text;
  v_offset_min    integer;
  v_default_ccy   text;
  v_venue_id      uuid;
  v_place_pool_id uuid;
  v_order_count   integer := 0;
  v_first_order   timestamptz;
  v_hours         jsonb;
  v_days          jsonb;
  v_revenue_trend jsonb;
  v_revenue_ccy   jsonb;
  v_rev7d_ccy     jsonb;
  v_signal_scores jsonb;
BEGIN
  -- ── Authorization (fail-closed, owner-only) ──────────────────────────────
  IF NOT EXISTS (
    SELECT 1 FROM public.brands b
    WHERE b.id = p_brand_id AND b.account_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'not authorized for brand %', p_brand_id USING ERRCODE = '42501';
  END IF;

  -- ── META-ORCH-1255(C) D-D venue resolution ───────────────────────────────
  IF p_venue_id IS NOT NULL THEN
    SELECT v.id INTO v_venue_id
      FROM public.venue_listings v
     WHERE v.id = p_venue_id AND v.brand_id = p_brand_id;
    IF v_venue_id IS NULL THEN
      RAISE EXCEPTION 'venue % does not belong to brand %', p_venue_id, p_brand_id
        USING ERRCODE = '42501';
    END IF;
  ELSE
    -- Deterministic single-venue back-compat: exactly one venue → use it;
    -- 0 or N>1 venues → NULL (legacy fallback below, never an arbitrary pick).
    IF (SELECT count(*) FROM public.venue_listings v WHERE v.brand_id = p_brand_id) = 1 THEN
      SELECT v.id INTO v_venue_id
        FROM public.venue_listings v
       WHERE v.brand_id = p_brand_id;
    END IF;
  END IF;

  SELECT b.default_currency INTO v_default_ccy
    FROM public.brands b
   WHERE b.id = p_brand_id;

  -- Place pointer: the venue row owns it (one owner per truth); the legacy
  -- brand pointer survives ONLY as the pre-1255 fallback when no venue row
  -- resolves.
  IF v_venue_id IS NOT NULL THEN
    SELECT v.place_pool_id INTO v_place_pool_id
      FROM public.venue_listings v
     WHERE v.id = v_venue_id;
  ELSE
    SELECT b.place_pool_id INTO v_place_pool_id
      FROM public.brands b
     WHERE b.id = p_brand_id;
  END IF;

  v_default_ccy := COALESCE(NULLIF(TRIM(UPPER(v_default_ccy)), ''), 'GBP');

  -- ── Timezone resolution ladder (§4.1) ────────────────────────────────────
  -- (1) reservations availability config IANA zone (DST-aware) — venue-scoped
  --     when a venue resolved, else the legacy brand read.
  -- (2) the brand's most-common non-UTC events.timezone (DST-aware)
  -- (3) static utc_offset_minutes (NOT DST-aware) — fixed-offset bucketing
  -- (4) 'UTC'
  IF v_venue_id IS NOT NULL THEN
    SELECT vac.iana_timezone
      INTO v_tz
      FROM public.venue_availability_config vac
     WHERE vac.venue_id = v_venue_id
       AND vac.iana_timezone IS NOT NULL
     LIMIT 1;
  ELSE
    SELECT vac.iana_timezone
      INTO v_tz
      FROM public.venue_availability_config vac
     WHERE vac.brand_id = p_brand_id
       AND vac.iana_timezone IS NOT NULL
     LIMIT 1;
  END IF;

  IF v_tz IS NOT NULL THEN
    v_tz_confidence := 'iana';
  ELSE
    SELECT e.timezone
      INTO v_tz
      FROM public.events e
     WHERE e.brand_id = p_brand_id
       AND e.deleted_at IS NULL
       AND e.timezone IS NOT NULL
       AND e.timezone <> 'UTC'
     GROUP BY e.timezone
     ORDER BY COUNT(*) DESC, e.timezone ASC
     LIMIT 1;

    IF v_tz IS NOT NULL THEN
      v_tz_confidence := 'iana';
    ELSE
      -- (3) static offset on the place_pool, if present
      SELECT pp.utc_offset_minutes
        INTO v_offset_min
        FROM public.place_pool pp
       WHERE pp.id = v_place_pool_id
         AND pp.utc_offset_minutes IS NOT NULL;

      IF v_offset_min IS NOT NULL THEN
        v_tz_confidence := 'offset';
        v_tz := NULL; -- bucket via interval, not a named zone
      ELSE
        v_tz := 'UTC';
        v_tz_confidence := 'utc';
      END IF;
    END IF;
  END IF;

  -- ── Source set: paid, non-failed/cancelled/refunded orders for this venue ─
  -- Order timestamp = COALESCE(confirmed_at, created_at) ("paid at").
  -- The local instant per order is computed once below in the CTE.
  WITH base AS (
    SELECT
      COALESCE(o.confirmed_at, o.created_at) AS paid_at,
      -- venue-local timestamp: named zone when known, else a fixed-offset shift
      CASE
        WHEN v_tz IS NOT NULL
          THEN (COALESCE(o.confirmed_at, o.created_at) AT TIME ZONE v_tz)
        ELSE (COALESCE(o.confirmed_at, o.created_at)
               + make_interval(mins => v_offset_min))
      END AS local_ts,
      COALESCE(NULLIF(TRIM(UPPER(o.currency)), ''), v_default_ccy) AS ccy,
      (o.total_cents - COALESCE(o.refunded_amount_cents, 0))       AS net_cents
    FROM public.orders o
    JOIN public.events e
      ON e.id = o.event_id
     AND e.brand_id = p_brand_id
     AND e.deleted_at IS NULL
    WHERE o.payment_status NOT IN ('failed', 'cancelled', 'refunded')
  )
  SELECT
    COUNT(*)::int,
    MIN(paid_at)
    INTO v_order_count, v_first_order
  FROM base;

  -- hours[]: all 24 buckets, 0-filled, hour = EXTRACT(hour FROM local_ts)
  SELECT jsonb_agg(jsonb_build_object('hour', h.hour, 'orders', COALESCE(c.cnt, 0))
                   ORDER BY h.hour)
    INTO v_hours
  FROM generate_series(0, 23) AS h(hour)
  LEFT JOIN (
    SELECT EXTRACT(hour FROM b.local_ts)::int AS hour, COUNT(*)::int AS cnt
    FROM (
      SELECT
        CASE
          WHEN v_tz IS NOT NULL
            THEN (COALESCE(o.confirmed_at, o.created_at) AT TIME ZONE v_tz)
          ELSE (COALESCE(o.confirmed_at, o.created_at)
                 + make_interval(mins => v_offset_min))
        END AS local_ts
      FROM public.orders o
      JOIN public.events e
        ON e.id = o.event_id AND e.brand_id = p_brand_id AND e.deleted_at IS NULL
      WHERE o.payment_status NOT IN ('failed', 'cancelled', 'refunded')
    ) b
    GROUP BY 1
  ) c ON c.hour = h.hour;

  -- days[]: all 7 buckets, 0-filled, weekday 0=Mon..6=Sun via ((dow+6)%7)
  SELECT jsonb_agg(jsonb_build_object('weekday', d.weekday, 'orders', COALESCE(c.cnt, 0))
                   ORDER BY d.weekday)
    INTO v_days
  FROM generate_series(0, 6) AS d(weekday)
  LEFT JOIN (
    SELECT ((EXTRACT(dow FROM b.local_ts)::int + 6) % 7) AS weekday, COUNT(*)::int AS cnt
    FROM (
      SELECT
        CASE
          WHEN v_tz IS NOT NULL
            THEN (COALESCE(o.confirmed_at, o.created_at) AT TIME ZONE v_tz)
          ELSE (COALESCE(o.confirmed_at, o.created_at)
                 + make_interval(mins => v_offset_min))
        END AS local_ts
      FROM public.orders o
      JOIN public.events e
        ON e.id = o.event_id AND e.brand_id = p_brand_id AND e.deleted_at IS NULL
      WHERE o.payment_status NOT IN ('failed', 'cancelled', 'refunded')
    ) b
    GROUP BY 1
  ) c ON c.weekday = d.weekday;

  -- revenue_trend: last 30 calendar days (venue-local), default-currency only,
  -- oldest→newest, 0-filled.
  SELECT jsonb_build_object(
           'currency', v_default_ccy,
           'days', COALESCE(jsonb_agg(
             jsonb_build_object('date', to_char(g.d, 'YYYY-MM-DD'),
                                'net_cents', COALESCE(r.net_cents, 0))
             ORDER BY g.d), '[]'::jsonb)
         )
    INTO v_revenue_trend
  FROM (
    SELECT (
      (CASE
         WHEN v_tz IS NOT NULL THEN (now() AT TIME ZONE v_tz)::date
         ELSE ((now() + make_interval(mins => v_offset_min)))::date
       END) - g.day_offset
    ) AS d
    FROM generate_series(0, 29) AS g(day_offset)
  ) g
  LEFT JOIN (
    SELECT b.local_date AS d, SUM(b.net_cents)::bigint AS net_cents
    FROM (
      SELECT
        (CASE
           WHEN v_tz IS NOT NULL
             THEN (COALESCE(o.confirmed_at, o.created_at) AT TIME ZONE v_tz)
           ELSE (COALESCE(o.confirmed_at, o.created_at)
                  + make_interval(mins => v_offset_min))
         END)::date AS local_date,
        (o.total_cents - COALESCE(o.refunded_amount_cents, 0)) AS net_cents,
        COALESCE(NULLIF(TRIM(UPPER(o.currency)), ''), v_default_ccy) AS ccy
      FROM public.orders o
      JOIN public.events e
        ON e.id = o.event_id AND e.brand_id = p_brand_id AND e.deleted_at IS NULL
      WHERE o.payment_status NOT IN ('failed', 'cancelled', 'refunded')
    ) b
    WHERE b.ccy = v_default_ccy
    GROUP BY b.local_date
  ) r ON r.d = g.d;

  -- revenue_by_currency: lifetime net cents per currency (NEVER cross-summed)
  SELECT COALESCE(jsonb_object_agg(t.ccy, t.net_cents), '{}'::jsonb)
    INTO v_revenue_ccy
  FROM (
    SELECT
      COALESCE(NULLIF(TRIM(UPPER(o.currency)), ''), v_default_ccy) AS ccy,
      SUM(o.total_cents - COALESCE(o.refunded_amount_cents, 0))::bigint AS net_cents
    FROM public.orders o
    JOIN public.events e
      ON e.id = o.event_id AND e.brand_id = p_brand_id AND e.deleted_at IS NULL
    WHERE o.payment_status NOT IN ('failed', 'cancelled', 'refunded')
    GROUP BY 1
  ) t;

  -- rev7d_by_currency: last-7-day net cents per currency (venue-local window)
  SELECT COALESCE(jsonb_object_agg(t.ccy, t.net_cents), '{}'::jsonb)
    INTO v_rev7d_ccy
  FROM (
    SELECT
      COALESCE(NULLIF(TRIM(UPPER(o.currency)), ''), v_default_ccy) AS ccy,
      SUM(o.total_cents - COALESCE(o.refunded_amount_cents, 0))::bigint AS net_cents
    FROM public.orders o
    JOIN public.events e
      ON e.id = o.event_id AND e.brand_id = p_brand_id AND e.deleted_at IS NULL
    WHERE o.payment_status NOT IN ('failed', 'cancelled', 'refunded')
      AND (
        CASE
          WHEN v_tz IS NOT NULL
            THEN (COALESCE(o.confirmed_at, o.created_at) AT TIME ZONE v_tz)::date
          ELSE ((COALESCE(o.confirmed_at, o.created_at)
                  + make_interval(mins => v_offset_min)))::date
        END
      ) > (
        CASE
          WHEN v_tz IS NOT NULL THEN (now() AT TIME ZONE v_tz)::date
          ELSE ((now() + make_interval(mins => v_offset_min)))::date
        END - 7
      )
    GROUP BY 1
  ) t;

  -- signal_scores: place_pool.ai_signal_scores is a JSONB OBJECT keyed by
  -- signal id, value = { score_0_to_100, inappropriate_for, ... }. Transform to
  -- [{ id, score }], filtering inappropriate_for=true, sorted score desc.
  -- (Mirrors VenueListingContent.tsx scoreRows transform.)
  SELECT COALESCE(jsonb_agg(s.row ORDER BY (s.row->>'score')::int DESC), '[]'::jsonb)
    INTO v_signal_scores
  FROM (
    SELECT jsonb_build_object(
             'id', kv.key,
             'score', COALESCE((kv.value->>'score_0_to_100')::int, 0)
           ) AS row
    FROM public.place_pool pp
    CROSS JOIN LATERAL jsonb_each(pp.ai_signal_scores) AS kv(key, value)
    WHERE pp.id = v_place_pool_id
      AND v_place_pool_id IS NOT NULL
      AND jsonb_typeof(pp.ai_signal_scores) = 'object'
      AND COALESCE((kv.value->>'inappropriate_for')::boolean, false) = false
  ) s;

  RETURN jsonb_build_object(
    'resolved_timezone',     COALESCE(v_tz, CASE WHEN v_offset_min IS NOT NULL
                                                 THEN 'UTC' || (CASE WHEN v_offset_min >= 0 THEN '+' ELSE '' END)
                                                      || (v_offset_min / 60)::text
                                                 ELSE 'UTC' END),
    'tz_confidence',         v_tz_confidence,
    'brand_default_currency', v_default_ccy,
    'order_count',           v_order_count,
    'first_order_at',        v_first_order,
    'hours',                 COALESCE(v_hours, '[]'::jsonb),
    'days',                  COALESCE(v_days, '[]'::jsonb),
    'revenue_trend',         v_revenue_trend,
    'revenue_by_currency',   v_revenue_ccy,
    'rev7d_by_currency',     v_rev7d_ccy,
    'signal_scores',         v_signal_scores
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.venue_intelligence_overview(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.venue_intelligence_overview(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.venue_intelligence_overview(uuid, uuid) TO authenticated;

COMMENT ON FUNCTION public.venue_intelligence_overview(uuid, uuid) IS
  'META-ORCH-1255(C) D-D re-key of the ORCH-1186-B owner-only venue '
  'intelligence rollup: place pointer + availability-config tz resolve via the '
  'venue_listings row (explicit p_venue_id, else the brand''s single venue, '
  'else the pre-1255 legacy brand pointer). Orders remain brand-level (orders '
  'link via events). Buckets/currency behavior byte-identical to 20261117000000.';

-- ---------------------------------------------------------------------------
-- 5. D-F — public_menus_view gate re-key (discovered at Leg C implement).
--    Was: b.claim_status = 'verified' — permanently 0 rows post-1255 (no
--    brand is ever verified again). Now: the brand has ≥1 VERIFIED venue
--    listing. Column list unchanged (CREATE OR REPLACE compatible); definer
--    semantics + grants re-asserted.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.public_menus_view AS
  SELECT mi.id,
         mi.menu_id,
         mi.brand_id,
         b.slug                AS brand_slug,
         m.name                AS menu_name,
         m.description         AS menu_description,
         m.sort_order          AS menu_sort_order,
         mi.name               AS item_name,
         mi.description        AS item_description,
         mi.price_cents,
         mi.currency,
         mi.sort_order         AS item_sort_order
  FROM public.menu_items mi
  JOIN public.menus  m ON m.id = mi.menu_id AND m.is_active = true
  JOIN public.brands b ON b.id = mi.brand_id
  WHERE mi.is_available = true
    AND b.deleted_at IS NULL
    -- META-ORCH-1255(C) D-F: venue-keyed public gate (brands.claim_status is
    -- legacy-inert; the venue row carries the claim machine per D-4).
    AND EXISTS (
      SELECT 1 FROM public.venue_listings v
      WHERE v.brand_id = b.id AND v.claim_status = 'verified'
    );

-- DEFINER: anon never touches brands/venue_listings directly.
ALTER VIEW public.public_menus_view SET (security_invoker = false);

GRANT SELECT ON public.public_menus_view TO anon, authenticated;

COMMENT ON VIEW public.public_menus_view IS
  'ORCH-1186-C anon-readable display-only venue menu, re-gated by '
  'META-ORCH-1255(C) D-F: available items of active menus for brands with ≥1 '
  'VERIFIED venue_listings row (brands.claim_status is legacy-inert post-1255). '
  'No ordering/cart/payment. security_invoker=false so anon reads scoped '
  'output, never the brands/venue_listings tables.';

-- ---------------------------------------------------------------------------
-- 6. Admin brand-name read for the claims queue (Leg C forced cascade).
--    The SPEC's queue re-point embeds `brand:brand_id(id,name,slug)` on the
--    venue_listings read, but PostgREST embedded rows are filtered by the
--    JOINED table's RLS and brands has NO admin SELECT policy — the parent
--    brand columns would be silently NULL for every admin (SC-13 requires
--    "venue + brand names"). Mirror of the M1 venue_listings admin-read
--    policy + the existing "Admins can read brand_hours for operations"
--    precedent. READ-ONLY: no admin write path on brands is added.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "brands admin can read" ON public.brands;
CREATE POLICY "brands admin can read" ON public.brands
  FOR SELECT TO authenticated
  USING (public.is_admin_user());

COMMIT;
