-- Issue #1384: source-currency venue discovery ranges and canonical FX.
-- Additive only. Existing Google ordinal/tier fields remain for non-money
-- enrichment and rollback, but are not currency authorities.

BEGIN;

-- The canonical admin gate predates hardened empty-search-path callers and
-- its body references admin_users without schema qualification. Pin its own
-- trusted lookup path so every #1384 SECURITY DEFINER RPC can keep
-- `search_path = ''` while still using the one constitutional admin gate.
ALTER FUNCTION public.is_admin_user()
  SET search_path TO pg_catalog, public;

CREATE TABLE public.supported_brand_currencies (
  code character(3) PRIMARY KEY,
  minor_unit_exponent smallint NOT NULL
    CHECK (minor_unit_exponent BETWEEN 0 AND 3),
  active boolean NOT NULL DEFAULT true,
  rail_source text NOT NULL,
  display_order integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT supported_brand_currencies_upper_iso
    CHECK (code::text = upper(code::text) AND code::text ~ '^[A-Z]{3}$')
);

INSERT INTO public.supported_brand_currencies
  (code, minor_unit_exponent, active, rail_source, display_order)
VALUES
  ('BGN', 2, true, 'stripe', 10),
  ('CAD', 2, true, 'stripe', 20),
  ('CHF', 2, true, 'stripe', 30),
  ('CZK', 2, true, 'stripe', 40),
  ('DKK', 2, true, 'stripe', 50),
  ('EUR', 2, true, 'stripe', 60),
  ('GBP', 2, true, 'stripe', 70),
  ('HUF', 2, true, 'stripe', 80),
  ('ISK', 2, true, 'stripe', 90),
  ('NGN', 2, true, 'paystack', 100),
  ('NOK', 2, true, 'stripe', 110),
  ('PLN', 2, true, 'stripe', 120),
  ('RON', 2, true, 'stripe', 130),
  ('SEK', 2, true, 'stripe', 140),
  ('USD', 2, true, 'stripe', 150);

ALTER TABLE public.supported_brand_currencies ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.supported_brand_currencies FROM public, anon, authenticated;

ALTER TABLE public.brands
  ADD COLUMN provisional_currency_code character(3)
    REFERENCES public.supported_brand_currencies(code),
  ADD COLUMN discovery_currency_state_version bigint NOT NULL DEFAULT 1
    CHECK (discovery_currency_state_version > 0);

CREATE TABLE public.brand_currency_reconciliations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  from_currency_code character(3),
  to_currency_code character(3) NOT NULL
    REFERENCES public.supported_brand_currencies(code),
  reason text NOT NULL CHECK (
    reason IN ('bank_attached', 'bank_changed', 'provisional_changed')
  ),
  status text NOT NULL CHECK (
    status IN (
      'pending', 'matched', 'converted', 'reentered',
      'accepted_no_ranges', 'cancelled'
    )
  ),
  decision text CHECK (
    decision IS NULL OR
    decision IN ('convert', 'reenter', 'accept_no_ranges')
  ),
  fx_snapshot_id uuid,
  initiated_by uuid,
  initiated_at timestamptz NOT NULL DEFAULT now(),
  resolved_by uuid,
  resolved_at timestamptz,
  resolution_metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE UNIQUE INDEX brand_currency_one_pending_idx
  ON public.brand_currency_reconciliations (brand_id)
  WHERE status = 'pending';
CREATE INDEX brand_currency_reconciliations_brand_idx
  ON public.brand_currency_reconciliations (brand_id, initiated_at DESC);

CREATE TABLE public.place_discovery_price_ranges (
  place_pool_id uuid PRIMARY KEY
    REFERENCES public.place_pool(id) ON DELETE CASCADE,
  brand_id uuid REFERENCES public.brands(id) ON DELETE CASCADE,
  venue_id uuid UNIQUE
    REFERENCES public.venue_listings(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (
    status IN ('active', 'legacy_unresolved', 'reconciliation_required')
  ),
  source_min_minor bigint,
  source_max_minor bigint,
  source_currency_code character(3)
    REFERENCES public.supported_brand_currencies(code),
  source_type text NOT NULL CHECK (
    source_type IN (
      'business_authored', 'provider',
      'reconciled_conversion', 'legacy_unresolved'
    )
  ),
  source_recorded_at timestamptz,
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT place_discovery_price_range_money_shape CHECK (
    (
      status IN ('active', 'reconciliation_required')
      AND source_currency_code IS NOT NULL
      AND source_min_minor IS NOT NULL
      AND source_min_minor >= 0
      AND (source_max_minor IS NULL OR source_max_minor >= source_min_minor)
    )
    OR
    (
      status = 'legacy_unresolved'
      AND source_min_minor IS NULL
      AND source_max_minor IS NULL
      AND source_currency_code IS NULL
      AND source_type = 'legacy_unresolved'
    )
  ),
  CONSTRAINT place_discovery_business_owner_shape CHECK (
    source_type <> 'business_authored'
    OR (brand_id IS NOT NULL AND venue_id IS NOT NULL)
  )
);

CREATE INDEX place_discovery_price_ranges_brand_idx
  ON public.place_discovery_price_ranges (brand_id, status);
CREATE INDEX place_discovery_price_ranges_currency_idx
  ON public.place_discovery_price_ranges (source_currency_code, status);

CREATE TABLE public.place_discovery_price_range_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  place_pool_id uuid NOT NULL REFERENCES public.place_pool(id) ON DELETE CASCADE,
  brand_id uuid REFERENCES public.brands(id) ON DELETE CASCADE,
  prior_row jsonb,
  current_row jsonb NOT NULL,
  action text NOT NULL,
  actor_id uuid,
  reconciliation_id uuid
    REFERENCES public.brand_currency_reconciliations(id) ON DELETE SET NULL,
  fx_snapshot_id uuid,
  request_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX place_discovery_revisions_place_idx
  ON public.place_discovery_price_range_revisions
  (place_pool_id, created_at DESC);

CREATE TABLE public.fx_rate_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL CHECK (provider = 'exchange_rate_api_open_v6'),
  base_currency_code character(3) NOT NULL
    CHECK (base_currency_code = 'USD'),
  provider_updated_at timestamptz NOT NULL,
  provider_next_update_at timestamptz NOT NULL,
  provider_eol_at timestamptz NOT NULL,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  stale_after timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  payload_sha256 text NOT NULL UNIQUE,
  status text NOT NULL
    CHECK (status IN ('active', 'superseded', 'rejected')),
  response_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT fx_snapshot_time_order CHECK (
    provider_updated_at < provider_next_update_at
    AND provider_updated_at < expires_at
    AND stale_after <= expires_at
  )
);

CREATE UNIQUE INDEX fx_one_active_snapshot_idx
  ON public.fx_rate_snapshots ((status))
  WHERE status = 'active';

CREATE TABLE public.fx_rates (
  snapshot_id uuid NOT NULL
    REFERENCES public.fx_rate_snapshots(id) ON DELETE CASCADE,
  currency_code character(3) NOT NULL
    REFERENCES public.supported_brand_currencies(code),
  rate_per_base numeric(38,18) NOT NULL CHECK (rate_per_base > 0),
  PRIMARY KEY (snapshot_id, currency_code)
);

ALTER TABLE public.brand_currency_reconciliations
  ADD CONSTRAINT brand_currency_reconciliations_snapshot_fk
  FOREIGN KEY (fx_snapshot_id) REFERENCES public.fx_rate_snapshots(id);

ALTER TABLE public.place_discovery_price_range_revisions
  ADD CONSTRAINT place_discovery_revisions_snapshot_fk
  FOREIGN KEY (fx_snapshot_id) REFERENCES public.fx_rate_snapshots(id);

ALTER TABLE public.brand_currency_reconciliations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.place_discovery_price_ranges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.place_discovery_price_range_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fx_rate_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fx_rates ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.brand_currency_reconciliations FROM public, anon, authenticated;
REVOKE ALL ON public.place_discovery_price_ranges FROM public, anon, authenticated;
REVOKE ALL ON public.place_discovery_price_range_revisions FROM public, anon, authenticated;
REVOKE ALL ON public.fx_rate_snapshots FROM public, anon, authenticated;
REVOKE ALL ON public.fx_rates FROM public, anon, authenticated;

CREATE POLICY brand_currency_reconciliations_team_read
ON public.brand_currency_reconciliations
FOR SELECT TO authenticated
USING (
  public.is_admin_user()
  OR public.biz_brand_effective_rank(brand_id, auth.uid())
    >= public.biz_role_rank('event_manager'::text)
);

CREATE POLICY place_discovery_price_ranges_team_read
ON public.place_discovery_price_ranges
FOR SELECT TO authenticated
USING (
  public.is_admin_user()
  OR (
    brand_id IS NOT NULL
    AND public.biz_brand_effective_rank(brand_id, auth.uid())
      >= public.biz_role_rank('event_manager'::text)
  )
);

CREATE POLICY place_discovery_price_revisions_team_read
ON public.place_discovery_price_range_revisions
FOR SELECT TO authenticated
USING (
  public.is_admin_user()
  OR (
    brand_id IS NOT NULL
    AND public.biz_brand_effective_rank(brand_id, auth.uid())
      >= public.biz_role_rank('event_manager'::text)
  )
);

GRANT SELECT ON public.brand_currency_reconciliations TO authenticated;
GRANT SELECT ON public.place_discovery_price_ranges TO authenticated;
GRANT SELECT ON public.place_discovery_price_range_revisions TO authenticated;

CREATE OR REPLACE FUNCTION public.issue_1384_supported_currencies()
RETURNS TABLE (
  code character(3),
  minor_unit_exponent smallint,
  rail_source text,
  display_order integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT c.code, c.minor_unit_exponent, c.rail_source, c.display_order
  FROM public.supported_brand_currencies c
  WHERE c.active
  ORDER BY c.display_order, c.code;
$function$;

REVOKE ALL ON FUNCTION public.issue_1384_supported_currencies() FROM public;
GRANT EXECUTE ON FUNCTION public.issue_1384_supported_currencies()
  TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.fx_latest_servable_snapshot(
  p_at timestamptz DEFAULT now()
)
RETURNS TABLE (
  snapshot_id uuid,
  provider text,
  provider_updated_at timestamptz,
  stale_after timestamptz,
  expires_at timestamptz,
  freshness text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT
    s.id,
    s.provider,
    s.provider_updated_at,
    s.stale_after,
    s.expires_at,
    CASE WHEN p_at <= s.stale_after THEN 'fresh' ELSE 'stale_soft' END
  FROM public.fx_rate_snapshots s
  WHERE s.status = 'active'
    AND p_at <= s.expires_at
    AND NOT EXISTS (
      SELECT 1
      FROM public.supported_brand_currencies c
      WHERE c.active
        AND NOT EXISTS (
          SELECT 1
          FROM public.fx_rates r
          WHERE r.snapshot_id = s.id AND r.currency_code = c.code
        )
    )
  ORDER BY s.provider_updated_at DESC
  LIMIT 1;
$function$;

REVOKE ALL ON FUNCTION public.fx_latest_servable_snapshot(timestamptz)
  FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fx_latest_servable_snapshot(timestamptz)
  TO service_role;

CREATE OR REPLACE FUNCTION public.fx_convert_minor(
  p_amount bigint,
  p_source character(3),
  p_target character(3),
  p_snapshot uuid
)
RETURNS bigint
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_source_exp smallint;
  v_target_exp smallint;
  v_source_rate numeric(38,18);
  v_target_rate numeric(38,18);
  v_result numeric;
BEGIN
  IF p_amount IS NULL OR p_amount < 0 THEN
    RAISE EXCEPTION 'invalid_amount' USING ERRCODE = '22023';
  END IF;
  IF p_source = p_target THEN
    RETURN p_amount;
  END IF;
  IF p_snapshot IS NULL THEN
    RAISE EXCEPTION 'fx_snapshot_required' USING ERRCODE = '22023';
  END IF;

  SELECT c.minor_unit_exponent, r.rate_per_base
    INTO v_source_exp, v_source_rate
  FROM public.supported_brand_currencies c
  JOIN public.fx_rates r ON r.currency_code = c.code
  JOIN public.fx_rate_snapshots s ON s.id = r.snapshot_id
  WHERE c.code = p_source
    AND c.active
    AND r.snapshot_id = p_snapshot
    AND s.status IN ('active', 'superseded')
    AND now() <= s.expires_at;

  SELECT c.minor_unit_exponent, r.rate_per_base
    INTO v_target_exp, v_target_rate
  FROM public.supported_brand_currencies c
  JOIN public.fx_rates r ON r.currency_code = c.code
  WHERE c.code = p_target
    AND c.active
    AND r.snapshot_id = p_snapshot;

  IF v_source_exp IS NULL OR v_target_exp IS NULL
     OR v_source_rate IS NULL OR v_target_rate IS NULL THEN
    RAISE EXCEPTION 'fx_unavailable' USING ERRCODE = 'P0001';
  END IF;

  v_result := round(
    (p_amount::numeric / power(10::numeric, v_source_exp))
    * (v_target_rate / v_source_rate)
    * power(10::numeric, v_target_exp)
  );

  IF v_result > 9223372036854775807::numeric THEN
    RAISE EXCEPTION 'converted_amount_overflow' USING ERRCODE = '22003';
  END IF;
  RETURN v_result::bigint;
END;
$function$;

REVOKE ALL ON FUNCTION public.fx_convert_minor(
  bigint, character, character, uuid
) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fx_convert_minor(
  bigint, character, character, uuid
) TO service_role;

CREATE OR REPLACE FUNCTION public.place_discovery_range_for_viewer(
  p_place_pool_id uuid,
  p_display_currency character(3) DEFAULT NULL,
  p_snapshot uuid DEFAULT NULL
)
RETURNS TABLE (
  price_range_status text,
  source_min_minor bigint,
  source_max_minor bigint,
  source_currency_code character(3),
  display_min_minor bigint,
  display_max_minor bigint,
  display_currency_code character(3),
  price_is_approximate boolean,
  fx_snapshot_id uuid,
  fx_provider text,
  fx_provider_updated_at timestamptz,
  fx_freshness text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_range public.place_discovery_price_ranges%ROWTYPE;
  v_snapshot record;
  v_snapshot_id uuid;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND NOT EXISTS (
       SELECT 1
       FROM public.place_pool pp
       WHERE pp.id = p_place_pool_id
         AND pp.is_active IS DISTINCT FROM false
         AND pp.is_servable IS TRUE
     ) THEN
    RETURN QUERY SELECT
      'unset'::text,
      NULL::bigint, NULL::bigint, NULL::character(3),
      NULL::bigint, NULL::bigint, NULL::character(3),
      false, NULL::uuid, NULL::text, NULL::timestamptz,
      'unavailable'::text;
    RETURN;
  END IF;

  SELECT * INTO v_range
  FROM public.place_discovery_price_ranges r
  WHERE r.place_pool_id = p_place_pool_id;

  IF NOT FOUND OR v_range.status <> 'active' THEN
    RETURN QUERY SELECT
      COALESCE(v_range.status, 'unset'::text),
      NULL::bigint, NULL::bigint, NULL::character(3),
      NULL::bigint, NULL::bigint, NULL::character(3),
      false, NULL::uuid, NULL::text, NULL::timestamptz,
      'unavailable'::text;
    RETURN;
  END IF;

  IF p_display_currency IS NULL
     OR p_display_currency = v_range.source_currency_code THEN
    RETURN QUERY SELECT
      v_range.status,
      v_range.source_min_minor,
      v_range.source_max_minor,
      v_range.source_currency_code,
      v_range.source_min_minor,
      v_range.source_max_minor,
      v_range.source_currency_code,
      false, NULL::uuid, NULL::text, NULL::timestamptz,
      'not_needed'::text;
    RETURN;
  END IF;

  -- Viewer preference is not settlement truth. An unknown/unsupported viewer
  -- currency degrades to exact source money instead of failing the deck.
  IF NOT EXISTS (
    SELECT 1
    FROM public.supported_brand_currencies c
    WHERE c.code = p_display_currency
      AND c.active
  ) THEN
    RETURN QUERY SELECT
      v_range.status,
      v_range.source_min_minor,
      v_range.source_max_minor,
      v_range.source_currency_code,
      NULL::bigint, NULL::bigint, NULL::character(3),
      false, NULL::uuid, NULL::text, NULL::timestamptz,
      'unavailable'::text;
    RETURN;
  END IF;

  IF p_snapshot IS NULL THEN
    SELECT * INTO v_snapshot
      FROM public.fx_latest_servable_snapshot(now());
    v_snapshot_id := v_snapshot.snapshot_id;
  ELSE
    SELECT
      s.id AS snapshot_id,
      s.provider,
      s.provider_updated_at,
      s.stale_after,
      s.expires_at,
      CASE
        WHEN now() <= s.stale_after THEN 'fresh'
        WHEN now() <= s.expires_at THEN 'stale_soft'
        ELSE 'expired'
      END AS freshness
    INTO v_snapshot
    FROM public.fx_rate_snapshots s
    WHERE s.id = p_snapshot;
    v_snapshot_id := v_snapshot.snapshot_id;
  END IF;

  IF v_snapshot_id IS NULL
     OR v_snapshot.freshness = 'expired' THEN
    RETURN QUERY SELECT
      v_range.status,
      v_range.source_min_minor,
      v_range.source_max_minor,
      v_range.source_currency_code,
      NULL::bigint, NULL::bigint, NULL::character(3),
      false, NULL::uuid, NULL::text, NULL::timestamptz,
      COALESCE(v_snapshot.freshness, 'unavailable'::text);
    RETURN;
  END IF;

  RETURN QUERY SELECT
    v_range.status,
    v_range.source_min_minor,
    v_range.source_max_minor,
    v_range.source_currency_code,
    public.fx_convert_minor(
      v_range.source_min_minor,
      v_range.source_currency_code,
      p_display_currency,
      v_snapshot_id
    ),
    CASE WHEN v_range.source_max_minor IS NULL THEN NULL ELSE
      GREATEST(
        public.fx_convert_minor(
          v_range.source_min_minor,
          v_range.source_currency_code,
          p_display_currency,
          v_snapshot_id
        ),
        public.fx_convert_minor(
          v_range.source_max_minor,
          v_range.source_currency_code,
          p_display_currency,
          v_snapshot_id
        )
      )
    END,
    p_display_currency,
    true,
    v_snapshot_id,
    v_snapshot.provider,
    v_snapshot.provider_updated_at,
    v_snapshot.freshness;
END;
$function$;

REVOKE ALL ON FUNCTION public.place_discovery_range_for_viewer(
  uuid, character, uuid
) FROM public;
GRANT EXECUTE ON FUNCTION public.place_discovery_range_for_viewer(
  uuid, character, uuid
) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.place_discovery_ranges_for_viewer(
  p_place_pool_ids uuid[],
  p_display_currency character(3) DEFAULT NULL,
  p_snapshot uuid DEFAULT NULL
)
RETURNS TABLE (
  place_pool_id uuid,
  price_range_status text,
  source_min_minor bigint,
  source_max_minor bigint,
  source_currency_code character(3),
  display_min_minor bigint,
  display_max_minor bigint,
  display_currency_code character(3),
  price_is_approximate boolean,
  fx_snapshot_id uuid,
  fx_provider text,
  fx_provider_updated_at timestamptz,
  fx_freshness text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT requested.place_pool_id, projected.*
  FROM pg_catalog.unnest(COALESCE(p_place_pool_ids, '{}'::uuid[]))
    AS requested(place_pool_id)
  CROSS JOIN LATERAL public.place_discovery_range_for_viewer(
    requested.place_pool_id,
    p_display_currency,
    p_snapshot
  ) AS projected;
$function$;

REVOKE ALL ON FUNCTION public.place_discovery_ranges_for_viewer(
  uuid[], character, uuid
) FROM public;
GRANT EXECUTE ON FUNCTION public.place_discovery_ranges_for_viewer(
  uuid[], character, uuid
) TO anon, authenticated, service_role;

-- Price-aware solo serving contract. The canonical overlap predicate lives in
-- the same SQL statement as ranking/limit, so no post-cap filtering can hide
-- otherwise eligible venues.
CREATE OR REPLACE FUNCTION public.issue_1384_query_servable_places_by_signal(
  p_signal_id text,
  p_filter_min numeric,
  p_lat double precision,
  p_lng double precision,
  p_radius_m double precision,
  p_exclude_place_ids uuid[] DEFAULT '{}'::uuid[],
  p_limit integer DEFAULT 20,
  p_price_filter_min_minor bigint DEFAULT NULL,
  p_price_filter_max_minor bigint DEFAULT NULL,
  p_price_filter_currency character(3) DEFAULT NULL,
  p_fx_snapshot_id uuid DEFAULT NULL
) RETURNS TABLE(
  place_id uuid,
  google_place_id text,
  name text,
  address text,
  lat double precision,
  lng double precision,
  rating numeric,
  review_count integer,
  price_level text,
  price_range_start_cents integer,
  price_range_end_cents integer,
  opening_hours jsonb,
  website text,
  photos jsonb,
  stored_photo_urls text[],
  types text[],
  primary_type text,
  generative_summary text,
  signal_score numeric,
  signal_contributions jsonb,
  ai_reasoning jsonb,
  ai_score_raw numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT
    pp.id,
    pp.google_place_id,
    pp.name,
    pp.address,
    pp.lat,
    pp.lng,
    pp.rating,
    pp.review_count,
    pp.price_level,
    pp.price_range_start_cents,
    pp.price_range_end_cents,
    pp.opening_hours,
    pp.website,
    pp.photos,
    pp.stored_photo_urls,
    pp.types,
    pp.primary_type,
    pp.generative_summary,
    ps.score,
    ps.contributions,
    pp.ai_signal_scores -> p_signal_id,
    NULLIF(
      pp.ai_signal_scores -> p_signal_id ->> 'score_0_to_100',
      ''
    )::numeric
  FROM public.place_pool pp
  JOIN public.place_scores ps
    ON ps.place_id = pp.id
   AND ps.signal_id = p_signal_id
  CROSS JOIN LATERAL public.place_discovery_range_for_viewer(
    pp.id,
    p_price_filter_currency,
    p_fx_snapshot_id
  ) filtered_price
  WHERE pp.is_servable = true
    AND pp.is_active = true
    AND ps.score >= p_filter_min
    AND pp.stored_photo_urls IS NOT NULL
    AND pg_catalog.array_length(pp.stored_photo_urls, 1) > 0
    AND NOT (
      pg_catalog.array_length(pp.stored_photo_urls, 1) = 1
      AND pp.stored_photo_urls[1] = '__backfill_failed__'
    )
    AND (
      6371000.0 * 2.0 * pg_catalog.asin(pg_catalog.sqrt(
        pg_catalog.power(pg_catalog.sin(pg_catalog.radians(pp.lat - p_lat) / 2.0), 2) +
        pg_catalog.cos(pg_catalog.radians(p_lat)) *
        pg_catalog.cos(pg_catalog.radians(pp.lat)) *
        pg_catalog.power(pg_catalog.sin(pg_catalog.radians(pp.lng - p_lng) / 2.0), 2)
      ))
    ) <= p_radius_m
    AND NOT (pp.id = ANY(COALESCE(p_exclude_place_ids, '{}'::uuid[])))
    AND (
      p_price_filter_currency IS NULL
      OR (
        filtered_price.price_range_status = 'active'
        AND COALESCE(
          filtered_price.display_currency_code,
          filtered_price.source_currency_code
        ) = p_price_filter_currency
        AND (
          COALESCE(
            filtered_price.display_max_minor,
            filtered_price.source_max_minor
          ) IS NULL
          OR COALESCE(
              filtered_price.display_max_minor,
              filtered_price.source_max_minor
            ) >= COALESCE(p_price_filter_min_minor, 0)
        )
        AND (
          p_price_filter_max_minor IS NULL
          OR COALESCE(
            filtered_price.display_min_minor,
            filtered_price.source_min_minor
          ) <= p_price_filter_max_minor
        )
      )
    )
  ORDER BY ps.score DESC, pp.review_count DESC NULLS LAST
  LIMIT p_limit;
$function$;

REVOKE ALL ON FUNCTION public.issue_1384_query_servable_places_by_signal(
  text, numeric, double precision, double precision, double precision,
  uuid[], integer, bigint, bigint, character, uuid
) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_1384_query_servable_places_by_signal(
  text, numeric, double precision, double precision, double precision,
  uuid[], integer, bigint, bigint, character, uuid
) TO service_role;

CREATE OR REPLACE FUNCTION public.issue_1384_append_range_revision()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  INSERT INTO public.place_discovery_price_range_revisions (
    place_pool_id,
    brand_id,
    prior_row,
    current_row,
    action,
    actor_id,
    reconciliation_id,
    fx_snapshot_id,
    request_id
  ) VALUES (
    NEW.place_pool_id,
    NEW.brand_id,
    CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD) ELSE NULL END,
    to_jsonb(NEW),
    COALESCE(current_setting('mingla.discovery_price_action', true), lower(TG_OP)),
    COALESCE(auth.uid(), NEW.updated_by, NEW.created_by),
    NULLIF(current_setting('mingla.discovery_price_reconciliation_id', true), '')::uuid,
    NULLIF(current_setting('mingla.discovery_price_fx_snapshot_id', true), '')::uuid,
    NULLIF(current_setting('mingla.request_id', true), '')::uuid
  );
  RETURN NEW;
END;
$function$;

CREATE TRIGGER place_discovery_price_revision
AFTER INSERT OR UPDATE ON public.place_discovery_price_ranges
FOR EACH ROW EXECUTE FUNCTION public.issue_1384_append_range_revision();

CREATE OR REPLACE FUNCTION public.issue_1384_bump_brand_currency_state()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  IF NEW.provisional_currency_code IS DISTINCT FROM OLD.provisional_currency_code
     OR NEW.default_currency IS DISTINCT FROM OLD.default_currency THEN
    NEW.discovery_currency_state_version :=
      OLD.discovery_currency_state_version + 1;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER brands_discovery_currency_state_version
BEFORE UPDATE OF default_currency, provisional_currency_code ON public.brands
FOR EACH ROW EXECUTE FUNCTION public.issue_1384_bump_brand_currency_state();

CREATE OR REPLACE FUNCTION public.issue_1384_reconcile_bank_currency()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_from character(3);
  v_active_count bigint;
  v_reason text;
BEGIN
  IF NEW.default_currency IS NULL
     OR NEW.default_currency IS NOT DISTINCT FROM OLD.default_currency THEN
    RETURN NEW;
  END IF;

  v_from := COALESCE(OLD.default_currency, NEW.provisional_currency_code);
  IF v_from IS NULL THEN
    RETURN NEW;
  END IF;

  v_reason := CASE
    WHEN OLD.default_currency IS NULL THEN 'bank_attached'
    ELSE 'bank_changed'
  END;

  SELECT count(*) INTO v_active_count
  FROM public.place_discovery_price_ranges r
  WHERE r.brand_id = NEW.id
    AND r.status IN ('active', 'reconciliation_required');

  IF v_from = NEW.default_currency THEN
    INSERT INTO public.brand_currency_reconciliations (
      brand_id, from_currency_code, to_currency_code, reason, status,
      decision, initiated_by, resolved_by, resolved_at
    ) VALUES (
      NEW.id, v_from, NEW.default_currency, v_reason, 'matched',
      'accept_no_ranges', auth.uid(), auth.uid(), now()
    );
    UPDATE public.brands
      SET provisional_currency_code = NULL
      WHERE id = NEW.id;
  ELSIF v_active_count = 0 THEN
    INSERT INTO public.brand_currency_reconciliations (
      brand_id, from_currency_code, to_currency_code, reason, status,
      decision, initiated_by, resolved_by, resolved_at
    ) VALUES (
      NEW.id, v_from, NEW.default_currency, v_reason, 'accepted_no_ranges',
      'accept_no_ranges', auth.uid(), auth.uid(), now()
    );
    UPDATE public.brands
      SET provisional_currency_code = NULL
      WHERE id = NEW.id;
  ELSE
    INSERT INTO public.brand_currency_reconciliations (
      brand_id, from_currency_code, to_currency_code, reason, status,
      initiated_by
    ) VALUES (
      NEW.id, v_from, NEW.default_currency, v_reason, 'pending', auth.uid()
    ) ON CONFLICT (brand_id) WHERE status = 'pending' DO NOTHING;

    PERFORM set_config(
      'mingla.discovery_price_action',
      'currency_reconciliation_required',
      true
    );
    UPDATE public.place_discovery_price_ranges
      SET status = 'reconciliation_required',
          updated_at = now(),
          updated_by = auth.uid(),
          version = version + 1
      WHERE brand_id = NEW.id
        AND status = 'active';
  END IF;

  RETURN NEW;
END;
$function$;

CREATE TRIGGER brands_discovery_currency_reconcile
AFTER UPDATE OF default_currency ON public.brands
FOR EACH ROW EXECUTE FUNCTION public.issue_1384_reconcile_bank_currency();

CREATE OR REPLACE FUNCTION public.pg_brand_can_charge(p_brand_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT
    EXISTS (
      SELECT 1
      FROM public.stripe_connect_accounts s
      WHERE s.brand_id = p_brand_id
        AND s.detached_at IS NULL
        AND s.stripe_account_id IS NOT NULL
        AND s.charges_enabled IS DISTINCT FROM false
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.brand_currency_reconciliations r
      WHERE r.brand_id = p_brand_id AND r.status = 'pending'
    );
$function$;

CREATE OR REPLACE FUNCTION public.pg_brand_can_collect(p_brand_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT
    (
      public.pg_brand_can_charge(p_brand_id)
      OR EXISTS (
        SELECT 1
        FROM public.brands b
        WHERE b.id = p_brand_id
          AND b.paystack_subaccount_code IS NOT NULL
      )
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.brand_currency_reconciliations r
      WHERE r.brand_id = p_brand_id AND r.status = 'pending'
    );
$function$;

GRANT EXECUTE ON FUNCTION public.pg_brand_can_charge(uuid)
  TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.pg_brand_can_collect(uuid)
  TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.issue_1384_brand_currency_state(
  p_brand_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_brand public.brands%ROWTYPE;
  v_reconciliation jsonb;
  v_supported jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;
  IF NOT public.is_admin_user()
     AND public.biz_brand_effective_rank(p_brand_id, v_uid)
       < public.biz_role_rank('event_manager'::text) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_brand FROM public.brands WHERE id = p_brand_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'brand_not_found' USING ERRCODE = 'P0002';
  END IF;

  SELECT to_jsonb(r) INTO v_reconciliation
  FROM public.brand_currency_reconciliations r
  WHERE r.brand_id = p_brand_id AND r.status = 'pending'
  ORDER BY r.initiated_at DESC
  LIMIT 1;

  SELECT jsonb_agg(jsonb_build_object(
    'code', c.code,
    'minorUnitExponent', c.minor_unit_exponent,
    'railSource', c.rail_source
  ) ORDER BY c.display_order) INTO v_supported
  FROM public.supported_brand_currencies c
  WHERE c.active;

  RETURN jsonb_build_object(
    'brandId', p_brand_id,
    'stateVersion', v_brand.discovery_currency_state_version,
    'authority', CASE
      WHEN v_brand.default_currency IS NOT NULL THEN 'settlement'
      WHEN v_brand.provisional_currency_code IS NOT NULL THEN 'provisional'
      ELSE 'unset'
    END,
    'currencyCode', COALESCE(
      v_brand.default_currency,
      v_brand.provisional_currency_code
    ),
    'canAuthorRange', COALESCE(
      v_brand.default_currency,
      v_brand.provisional_currency_code
    ) IS NOT NULL AND v_reconciliation IS NULL,
    'canAcceptPaidReservations',
      public.pg_brand_can_collect(p_brand_id) AND v_brand.default_currency IS NOT NULL,
    'supportedCurrencies', COALESCE(v_supported, '[]'::jsonb),
    'reconciliation', v_reconciliation
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.issue_1384_brand_currency_state(uuid)
  FROM public, anon;
GRANT EXECUTE ON FUNCTION public.issue_1384_brand_currency_state(uuid)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.issue_1384_set_provisional_currency(
  p_brand_id uuid,
  p_currency_code character(3),
  p_expected_state_version bigint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_brand public.brands%ROWTYPE;
  v_range_count bigint;
  v_reconciliation_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;
  IF public.biz_brand_effective_rank(p_brand_id, v_uid)
       < public.biz_role_rank('finance_manager'::text) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.supported_brand_currencies c
    WHERE c.code = upper(p_currency_code::text)::character(3) AND c.active
  ) THEN
    RAISE EXCEPTION 'unsupported_currency' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_brand
  FROM public.brands
  WHERE id = p_brand_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'brand_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_brand.default_currency IS NOT NULL THEN
    RAISE EXCEPTION 'currency_already_set' USING ERRCODE = 'P0001';
  END IF;
  IF v_brand.discovery_currency_state_version <> p_expected_state_version THEN
    RAISE EXCEPTION 'range_version_conflict' USING ERRCODE = '40001';
  END IF;
  IF v_brand.provisional_currency_code = p_currency_code THEN
    RETURN public.issue_1384_brand_currency_state(p_brand_id);
  END IF;

  SELECT count(*) INTO v_range_count
  FROM public.place_discovery_price_ranges r
  WHERE r.brand_id = p_brand_id
    AND r.status IN ('active', 'reconciliation_required');

  IF v_brand.provisional_currency_code IS NOT NULL AND v_range_count > 0 THEN
    INSERT INTO public.brand_currency_reconciliations (
      brand_id, from_currency_code, to_currency_code, reason, status,
      initiated_by
    ) VALUES (
      p_brand_id,
      v_brand.provisional_currency_code,
      p_currency_code,
      'provisional_changed',
      'pending',
      v_uid
    ) RETURNING id INTO v_reconciliation_id;
    PERFORM set_config(
      'mingla.discovery_price_action',
      'currency_reconciliation_required',
      true
    );
    UPDATE public.place_discovery_price_ranges
      SET status = 'reconciliation_required',
          version = version + 1,
          updated_by = v_uid,
          updated_at = now()
      WHERE brand_id = p_brand_id AND status = 'active';
  ELSE
    UPDATE public.brands
      SET provisional_currency_code = p_currency_code
      WHERE id = p_brand_id;
  END IF;

  RETURN public.issue_1384_brand_currency_state(p_brand_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.issue_1384_set_provisional_currency(
  uuid, character, bigint
) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.issue_1384_set_provisional_currency(
  uuid, character, bigint
) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.issue_1384_save_discovery_price_range(
  p_brand_id uuid,
  p_venue_id uuid,
  p_place_pool_id uuid,
  p_source_min_minor bigint,
  p_source_max_minor bigint,
  p_source_currency_code character(3),
  p_expected_version bigint DEFAULT NULL,
  p_actor_reason text DEFAULT 'business_authored',
  p_request_id uuid DEFAULT NULL
)
RETURNS public.place_discovery_price_ranges
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_currency character(3);
  v_existing public.place_discovery_price_ranges%ROWTYPE;
  v_result public.place_discovery_price_ranges%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;
  IF NOT public.is_admin_user()
     AND public.biz_brand_effective_rank(p_brand_id, v_uid)
       < public.biz_role_rank('event_manager'::text) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_source_min_minor IS NULL OR p_source_min_minor < 0
     OR (p_source_max_minor IS NOT NULL
         AND p_source_max_minor < p_source_min_minor) THEN
    RAISE EXCEPTION 'invalid_range' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.venue_listings v
    WHERE v.id = p_venue_id
      AND v.brand_id = p_brand_id
      AND v.place_pool_id = p_place_pool_id
  ) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.brand_currency_reconciliations r
    WHERE r.brand_id = p_brand_id AND r.status = 'pending'
  ) THEN
    RAISE EXCEPTION 'currency_reconciliation_required'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT COALESCE(b.default_currency, b.provisional_currency_code)
    INTO v_currency
  FROM public.brands b
  WHERE b.id = p_brand_id
  FOR UPDATE;

  IF v_currency IS NULL THEN
    RAISE EXCEPTION 'paid_currency_not_ready' USING ERRCODE = 'P0001';
  END IF;
  IF v_currency <> p_source_currency_code THEN
    RAISE EXCEPTION 'currency_mismatch' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_existing
  FROM public.place_discovery_price_ranges
  WHERE place_pool_id = p_place_pool_id
  FOR UPDATE;

  IF FOUND AND (
    p_expected_version IS NULL OR v_existing.version <> p_expected_version
  ) THEN
    RAISE EXCEPTION 'range_version_conflict' USING ERRCODE = '40001';
  END IF;
  IF NOT FOUND AND p_expected_version IS NOT NULL THEN
    RAISE EXCEPTION 'range_version_conflict' USING ERRCODE = '40001';
  END IF;

  PERFORM set_config(
    'mingla.discovery_price_action',
    COALESCE(NULLIF(p_actor_reason, ''), 'business_authored'),
    true
  );
  IF p_request_id IS NOT NULL THEN
    PERFORM set_config('mingla.request_id', p_request_id::text, true);
  END IF;

  INSERT INTO public.place_discovery_price_ranges (
    place_pool_id, brand_id, venue_id, status,
    source_min_minor, source_max_minor, source_currency_code,
    source_type, source_recorded_at, version,
    created_by, updated_by
  ) VALUES (
    p_place_pool_id, p_brand_id, p_venue_id, 'active',
    p_source_min_minor, p_source_max_minor, p_source_currency_code,
    'business_authored', now(), 1,
    v_uid, v_uid
  )
  ON CONFLICT (place_pool_id) DO UPDATE SET
    brand_id = EXCLUDED.brand_id,
    venue_id = EXCLUDED.venue_id,
    status = 'active',
    source_min_minor = EXCLUDED.source_min_minor,
    source_max_minor = EXCLUDED.source_max_minor,
    source_currency_code = EXCLUDED.source_currency_code,
    source_type = CASE
      WHEN p_actor_reason = 'admin_edit' THEN
        public.place_discovery_price_ranges.source_type
      ELSE 'business_authored'
    END,
    source_recorded_at = now(),
    version = public.place_discovery_price_ranges.version + 1,
    updated_by = v_uid,
    updated_at = now()
  RETURNING * INTO v_result;

  IF public.is_admin_user() THEN
    PERFORM public.admin_write_audit(
      'admin.discovery_price.update',
      'place_pool',
      p_place_pool_id::text,
      COALESCE(NULLIF(p_actor_reason, ''), 'admin_edit'),
      jsonb_build_object(
        'before', CASE WHEN v_existing.place_pool_id IS NULL
          THEN NULL ELSE to_jsonb(v_existing) END,
        'after', to_jsonb(v_result),
        'requestId', p_request_id
      ),
      true
    );
  END IF;

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.issue_1384_save_discovery_price_range(
  uuid, uuid, uuid, bigint, bigint, character, bigint, text, uuid
) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.issue_1384_save_discovery_price_range(
  uuid, uuid, uuid, bigint, bigint, character, bigint, text, uuid
) TO authenticated, service_role;

-- One Admin statement owns legitimate legacy place fields and canonical
-- discovery money. CAS is checked before any mutation; every exception rolls
-- the whole statement back, eliminating the former partial-commit sequence.
-- p_ai_categories stays in the RPC contract for deployed-client compatibility
-- but is deliberately inert: I-CATEGORY-DERIVED-ON-DROP forbids recreating or
-- writing that removed place_pool interpretation column.
CREATE OR REPLACE FUNCTION public.issue_1384_admin_update_place_and_discovery_range(
  p_place_pool_id uuid,
  p_name text,
  p_price_tier text,
  p_price_tiers text[],
  p_is_active boolean,
  p_ai_categories text[],
  p_source_min_minor bigint,
  p_source_max_minor bigint,
  p_expected_version bigint,
  p_actor_reason text,
  p_request_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_existing public.place_discovery_price_ranges%ROWTYPE;
  v_saved public.place_discovery_price_ranges%ROWTYPE;
  v_place_result jsonb;
BEGIN
  -- Authorization is deliberately the first state-dependent operation.
  IF auth.uid() IS NULL OR NOT public.is_admin_user() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF pg_catalog.length(pg_catalog.btrim(COALESCE(p_actor_reason, ''))) < 3 THEN
    RAISE EXCEPTION 'admin_reason_required' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_existing
  FROM public.place_discovery_price_ranges r
  WHERE r.place_pool_id = p_place_pool_id
  FOR UPDATE;

  IF FOUND AND v_existing.status = 'active' THEN
    IF p_expected_version IS NULL
       OR v_existing.version <> p_expected_version THEN
      RAISE EXCEPTION 'range_version_conflict' USING ERRCODE = '40001';
    END IF;
    IF p_source_min_minor IS NULL OR p_source_min_minor < 0
       OR (p_source_max_minor IS NOT NULL
           AND p_source_max_minor < p_source_min_minor) THEN
      RAISE EXCEPTION 'invalid_range' USING ERRCODE = '22023';
    END IF;
  ELSIF p_expected_version IS NOT NULL THEN
    RAISE EXCEPTION 'range_version_conflict' USING ERRCODE = '40001';
  END IF;

  SELECT public.admin_edit_place(
    p_place_pool_id,
    p_name,
    p_price_tier,
    p_is_active,
    p_price_tiers
  ) INTO v_place_result;

  IF v_existing.place_pool_id IS NOT NULL
     AND v_existing.status = 'active' THEN
    SELECT * INTO v_saved
    FROM public.issue_1384_save_discovery_price_range(
      v_existing.brand_id,
      v_existing.venue_id,
      p_place_pool_id,
      p_source_min_minor,
      p_source_max_minor,
      v_existing.source_currency_code,
      p_expected_version,
      pg_catalog.btrim(p_actor_reason),
      p_request_id
    );
  END IF;

  RETURN jsonb_build_object(
    'place', v_place_result,
    'discoveryPrice', CASE
      WHEN v_saved.place_pool_id IS NULL THEN NULL
      ELSE to_jsonb(v_saved)
    END
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.issue_1384_admin_update_place_and_discovery_range(
  uuid, text, text, text[], boolean, text[], bigint, bigint, bigint, text, uuid
) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.issue_1384_admin_update_place_and_discovery_range(
  uuid, text, text, text[], boolean, text[], bigint, bigint, bigint, text, uuid
) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.issue_1384_preview_reconciliation(
  p_brand_id uuid,
  p_reconciliation_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_rec public.brand_currency_reconciliations%ROWTYPE;
  v_snapshot record;
  v_ranges jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;
  IF public.biz_brand_effective_rank(p_brand_id, v_uid)
       < public.biz_role_rank('finance_manager'::text) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_rec
  FROM public.brand_currency_reconciliations
  WHERE id = p_reconciliation_id
    AND brand_id = p_brand_id
    AND status = 'pending';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'reconciliation_not_found' USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO v_snapshot
  FROM public.fx_latest_servable_snapshot(now());
  IF v_snapshot.snapshot_id IS NULL THEN
    RAISE EXCEPTION 'fx_unavailable' USING ERRCODE = 'P0001';
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'placePoolId', r.place_pool_id,
    'venueId', r.venue_id,
    'expectedVersion', r.version,
    'sourceMinMinor', r.source_min_minor,
    'sourceMaxMinor', r.source_max_minor,
    'sourceCurrencyCode', r.source_currency_code,
    'proposedMinMinor', public.fx_convert_minor(
      r.source_min_minor, r.source_currency_code,
      v_rec.to_currency_code, v_snapshot.snapshot_id
    ),
    'proposedMaxMinor', CASE WHEN r.source_max_minor IS NULL THEN NULL ELSE
      public.fx_convert_minor(
        r.source_max_minor, r.source_currency_code,
        v_rec.to_currency_code, v_snapshot.snapshot_id
      )
    END
  ) ORDER BY r.place_pool_id), '[]'::jsonb)
  INTO v_ranges
  FROM public.place_discovery_price_ranges r
  WHERE r.brand_id = p_brand_id
    AND r.status = 'reconciliation_required';

  RETURN jsonb_build_object(
    'reconciliationId', v_rec.id,
    'fromCurrencyCode', v_rec.from_currency_code,
    'toCurrencyCode', v_rec.to_currency_code,
    'snapshot', jsonb_build_object(
      'id', v_snapshot.snapshot_id,
      'provider', v_snapshot.provider,
      'providerUpdatedAt', v_snapshot.provider_updated_at,
      'freshness', v_snapshot.freshness
    ),
    'ranges', v_ranges
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.issue_1384_preview_reconciliation(uuid, uuid)
  FROM public, anon;
GRANT EXECUTE ON FUNCTION public.issue_1384_preview_reconciliation(uuid, uuid)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.issue_1384_resolve_reconciliation(
  p_brand_id uuid,
  p_reconciliation_id uuid,
  p_decision text,
  p_fx_snapshot_id uuid DEFAULT NULL,
  p_ranges jsonb DEFAULT '[]'::jsonb,
  p_request_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_rec public.brand_currency_reconciliations%ROWTYPE;
  v_brand public.brands%ROWTYPE;
  v_authoritative_ids uuid[];
  v_request_ids uuid[];
  v_item jsonb;
  v_range public.place_discovery_price_ranges%ROWTYPE;
  v_new_min bigint;
  v_new_max bigint;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;
  IF public.biz_brand_effective_rank(p_brand_id, v_uid)
       < public.biz_role_rank('finance_manager'::text) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_decision NOT IN ('convert', 'reenter', 'accept_no_ranges') THEN
    RAISE EXCEPTION 'incomplete_reentry' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_brand
  FROM public.brands
  WHERE id = p_brand_id
  FOR UPDATE;
  SELECT * INTO v_rec
  FROM public.brand_currency_reconciliations
  WHERE id = p_reconciliation_id
    AND brand_id = p_brand_id
  FOR UPDATE;
  IF NOT FOUND OR v_rec.status <> 'pending' THEN
    RAISE EXCEPTION 'reconciliation_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_brand.default_currency IS NOT NULL
     AND v_brand.default_currency <> v_rec.to_currency_code THEN
    RAISE EXCEPTION 'currency_mismatch' USING ERRCODE = '22023';
  END IF;

  PERFORM 1
  FROM public.place_discovery_price_ranges r
  WHERE r.brand_id = p_brand_id
    AND r.status = 'reconciliation_required'
  FOR UPDATE;

  SELECT COALESCE(array_agg(r.place_pool_id ORDER BY r.place_pool_id), '{}')
    INTO v_authoritative_ids
  FROM public.place_discovery_price_ranges r
  WHERE r.brand_id = p_brand_id
    AND r.status = 'reconciliation_required';

  SELECT COALESCE(
    array_agg((item->>'placePoolId')::uuid ORDER BY (item->>'placePoolId')::uuid),
    '{}'
  ) INTO v_request_ids
  FROM jsonb_array_elements(COALESCE(p_ranges, '[]'::jsonb)) item;

  IF p_decision = 'accept_no_ranges' THEN
    IF cardinality(v_authoritative_ids) <> 0 OR cardinality(v_request_ids) <> 0 THEN
      RAISE EXCEPTION 'range_set_changed' USING ERRCODE = '40001';
    END IF;
  ELSIF v_authoritative_ids IS DISTINCT FROM v_request_ids THEN
    RAISE EXCEPTION 'range_set_changed' USING ERRCODE = '40001';
  END IF;

  IF p_request_id IS NOT NULL THEN
    PERFORM set_config('mingla.request_id', p_request_id::text, true);
  END IF;
  PERFORM set_config(
    'mingla.discovery_price_reconciliation_id',
    p_reconciliation_id::text,
    true
  );
  PERFORM set_config(
    'mingla.discovery_price_action',
    CASE p_decision WHEN 'convert' THEN 'reconciled_conversion'
      ELSE 'reentered' END,
    true
  );

  IF p_decision = 'convert' THEN
    IF p_fx_snapshot_id IS NULL OR NOT EXISTS (
      SELECT 1 FROM public.fx_rate_snapshots s
      WHERE s.id = p_fx_snapshot_id
        AND s.status IN ('active', 'superseded')
        AND now() <= s.expires_at
    ) THEN
      RAISE EXCEPTION 'fx_snapshot_stale' USING ERRCODE = '22023';
    END IF;
    PERFORM set_config(
      'mingla.discovery_price_fx_snapshot_id',
      p_fx_snapshot_id::text,
      true
    );
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(p_ranges, '[]'::jsonb))
  LOOP
    SELECT * INTO v_range
    FROM public.place_discovery_price_ranges r
    WHERE r.place_pool_id = (v_item->>'placePoolId')::uuid
      AND r.brand_id = p_brand_id
    FOR UPDATE;
    IF NOT FOUND OR v_range.version <> (v_item->>'expectedVersion')::bigint THEN
      RAISE EXCEPTION 'range_version_conflict' USING ERRCODE = '40001';
    END IF;

    IF p_decision = 'convert' THEN
      v_new_min := public.fx_convert_minor(
        v_range.source_min_minor,
        v_range.source_currency_code,
        v_rec.to_currency_code,
        p_fx_snapshot_id
      );
      v_new_max := CASE WHEN v_range.source_max_minor IS NULL THEN NULL ELSE
        public.fx_convert_minor(
          v_range.source_max_minor,
          v_range.source_currency_code,
          v_rec.to_currency_code,
          p_fx_snapshot_id
        )
      END;
    ELSE
      IF (v_item->>'currencyCode')::character(3) <> v_rec.to_currency_code THEN
        RAISE EXCEPTION 'currency_mismatch' USING ERRCODE = '22023';
      END IF;
      v_new_min := (v_item->>'sourceMinMinor')::bigint;
      v_new_max := NULLIF(v_item->>'sourceMaxMinor', '')::bigint;
      IF v_new_min IS NULL OR v_new_min < 0
         OR (v_new_max IS NOT NULL AND v_new_max < v_new_min) THEN
        RAISE EXCEPTION 'invalid_range' USING ERRCODE = '22023';
      END IF;
    END IF;

    UPDATE public.place_discovery_price_ranges
      SET status = 'active',
          source_min_minor = v_new_min,
          source_max_minor = v_new_max,
          source_currency_code = v_rec.to_currency_code,
          source_type = CASE WHEN p_decision = 'convert'
            THEN 'reconciled_conversion' ELSE 'business_authored' END,
          source_recorded_at = now(),
          version = version + 1,
          updated_by = v_uid,
          updated_at = now()
      WHERE place_pool_id = v_range.place_pool_id;
  END LOOP;

  UPDATE public.brand_currency_reconciliations
    SET status = CASE p_decision
      WHEN 'convert' THEN 'converted'
      WHEN 'reenter' THEN 'reentered'
      ELSE 'accepted_no_ranges'
    END,
    decision = p_decision,
    fx_snapshot_id = p_fx_snapshot_id,
    resolved_by = v_uid,
    resolved_at = now(),
    resolution_metadata = jsonb_build_object(
      'rangeCount', cardinality(v_authoritative_ids),
      'requestId', p_request_id
    )
    WHERE id = p_reconciliation_id;

  UPDATE public.brands
    SET provisional_currency_code = CASE
      WHEN default_currency IS NULL
        AND v_rec.reason = 'provisional_changed'
      THEN v_rec.to_currency_code
      ELSE NULL
    END
    WHERE id = p_brand_id;

  RETURN public.issue_1384_brand_currency_state(p_brand_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.issue_1384_resolve_reconciliation(
  uuid, uuid, text, uuid, jsonb, uuid
) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.issue_1384_resolve_reconciliation(
  uuid, uuid, text, uuid, jsonb, uuid
) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.issue_1384_activate_fx_snapshot(
  p_provider_updated_at timestamptz,
  p_provider_next_update_at timestamptz,
  p_provider_eol_at timestamptz,
  p_payload_sha256 text,
  p_rates jsonb,
  p_response_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_snapshot_id uuid;
  v_missing_count bigint;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_provider_eol_at <= now()
     OR p_provider_updated_at >= p_provider_next_update_at THEN
    RAISE EXCEPTION 'invalid_provider_timestamps' USING ERRCODE = '22023';
  END IF;

  SELECT count(*) INTO v_missing_count
  FROM public.supported_brand_currencies c
  WHERE c.active
    AND (
      NOT (p_rates ? c.code::text)
      OR jsonb_typeof(p_rates->c.code::text) <> 'number'
      OR (p_rates->>c.code::text)::numeric <= 0
    );
  IF v_missing_count <> 0 THEN
    RAISE EXCEPTION 'incomplete_fx_snapshot' USING ERRCODE = '22023';
  END IF;

  SELECT id INTO v_snapshot_id
  FROM public.fx_rate_snapshots
  WHERE payload_sha256 = p_payload_sha256;
  IF FOUND THEN
    RETURN v_snapshot_id;
  END IF;

  INSERT INTO public.fx_rate_snapshots (
    provider, base_currency_code, provider_updated_at,
    provider_next_update_at, provider_eol_at,
    stale_after, expires_at, payload_sha256, status, response_metadata
  ) VALUES (
    'exchange_rate_api_open_v6', 'USD', p_provider_updated_at,
    p_provider_next_update_at, p_provider_eol_at,
    p_provider_next_update_at + interval '24 hours',
    p_provider_updated_at + interval '7 days',
    p_payload_sha256, 'rejected', COALESCE(p_response_metadata, '{}'::jsonb)
  ) RETURNING id INTO v_snapshot_id;

  INSERT INTO public.fx_rates (snapshot_id, currency_code, rate_per_base)
  SELECT v_snapshot_id, c.code, (p_rates->>c.code::text)::numeric
  FROM public.supported_brand_currencies c
  WHERE c.active;

  UPDATE public.fx_rate_snapshots
    SET status = 'superseded'
    WHERE status = 'active';
  UPDATE public.fx_rate_snapshots
    SET status = 'active'
    WHERE id = v_snapshot_id;

  RETURN v_snapshot_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.issue_1384_activate_fx_snapshot(
  timestamptz, timestamptz, timestamptz, text, jsonb, jsonb
) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_1384_activate_fx_snapshot(
  timestamptz, timestamptz, timestamptz, text, jsonb, jsonb
) TO service_role;

-- Ambiguous historical values are made explicit without inventing money.
INSERT INTO public.place_discovery_price_ranges (
  place_pool_id, brand_id, venue_id, status,
  source_type, version, source_recorded_at
)
SELECT
  pp.id,
  vl.brand_id,
  vl.id,
  'legacy_unresolved',
  'legacy_unresolved',
  1,
  NULL
FROM public.place_pool pp
LEFT JOIN public.venue_listings vl ON vl.place_pool_id = pp.id
WHERE
  (
    cardinality(COALESCE(pp.price_tiers, '{}'::text[])) > 0
    OR pp.price_level IS NOT NULL
    OR pp.price_range_start_cents IS NOT NULL
    OR pp.price_range_end_cents IS NOT NULL
    OR pp.price_range_currency IS NOT NULL
  )
ON CONFLICT (place_pool_id) DO NOTHING;

COMMENT ON TABLE public.place_discovery_price_ranges IS
  'Issue #1384 canonical venue discovery-price source range. Currency-bearing '
  'integer minor units are authoritative; legacy tiers/Google levels are not.';
COMMENT ON TABLE public.fx_rate_snapshots IS
  'Issue #1384 immutable server FX snapshots. Clients never read this table '
  'directly; serving functions expose safe attribution metadata.';
COMMENT ON FUNCTION public.pg_brand_can_collect(uuid) IS
  'Provider-aware paid-readiness predicate (Stripe or Paystack) extended by '
  'issue #1384 to fail closed while currency reconciliation is pending. '
  'Existing provider/account predicates remain intact.';

COMMIT;
