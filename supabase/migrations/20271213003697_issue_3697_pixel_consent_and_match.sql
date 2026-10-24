-- toward #3697: region-switchable ad-pixel consent plus buyer match/opt-out parity.
BEGIN;

CREATE TABLE IF NOT EXISTS public.ad_region_config (
  country_code text PRIMARY KEY
    CHECK (country_code ~ '^[A-Z]{2}$'),
  ad_pixel_consent_mode text NOT NULL DEFAULT 'on_arrival'
    CHECK (ad_pixel_consent_mode IN ('on_arrival', 'opt_in')),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL
);

ALTER TABLE public.ad_region_config ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ad_region_config FROM PUBLIC, anon;
GRANT SELECT ON public.ad_region_config TO authenticated;
GRANT ALL ON public.ad_region_config TO service_role;

DROP POLICY IF EXISTS ad_region_config_admin_read ON public.ad_region_config;
CREATE POLICY ad_region_config_admin_read
  ON public.ad_region_config
  FOR SELECT
  TO authenticated
  USING (public.is_admin_user());

COMMENT ON TABLE public.ad_region_config IS
  'I-PROPOSED-3697-REGION-PIXEL-MODE: country overrides are admin-readable, definer-written, and default to on_arrival when absent.';

CREATE OR REPLACE FUNCTION public.ad_pixel_public_config(p_country_code text)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  SELECT pg_catalog.jsonb_build_object(
    'ad_pixel_consent_mode',
    COALESCE(
      (
        SELECT c.ad_pixel_consent_mode
        FROM public.ad_region_config c
        WHERE c.country_code = pg_catalog.upper(pg_catalog.btrim(COALESCE(p_country_code, '')))
      ),
      'on_arrival'
    )
  );
$function$;

REVOKE ALL ON FUNCTION public.ad_pixel_public_config(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ad_pixel_public_config(text)
  TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.ad_pixel_public_config(text) IS
  'I-PROPOSED-3697-PUBLIC-PIXEL-MODE: returns one non-sensitive mode and no region inventory; missing/invalid countries default on_arrival.';

CREATE OR REPLACE FUNCTION public.admin_set_ad_pixel_consent_mode(
  p_country_code text,
  p_mode text
)
RETURNS public.ad_region_config
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_country text := pg_catalog.upper(pg_catalog.btrim(COALESCE(p_country_code, '')));
  v_row public.ad_region_config;
BEGIN
  IF NOT public.is_admin_user() THEN
    RAISE EXCEPTION 'admin_required' USING ERRCODE = '42501';
  END IF;
  IF v_country !~ '^[A-Z]{2}$' THEN
    RAISE EXCEPTION 'invalid_country_code' USING ERRCODE = '22023';
  END IF;
  IF p_mode IS NULL OR p_mode NOT IN ('on_arrival', 'opt_in') THEN
    RAISE EXCEPTION 'invalid_ad_pixel_consent_mode' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.ad_region_config (
    country_code,
    ad_pixel_consent_mode,
    updated_at,
    updated_by
  ) VALUES (
    v_country,
    p_mode,
    pg_catalog.now(),
    auth.uid()
  )
  ON CONFLICT (country_code) DO UPDATE
    SET ad_pixel_consent_mode = EXCLUDED.ad_pixel_consent_mode,
        updated_at = EXCLUDED.updated_at,
        updated_by = EXCLUDED.updated_by
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_set_ad_pixel_consent_mode(text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_ad_pixel_consent_mode(text, text)
  TO authenticated, service_role;

ALTER TABLE public.ticket_checkout_sessions
  ADD COLUMN IF NOT EXISTS ttp text,
  ADD COLUMN IF NOT EXISTS ad_tracking_opt_out boolean NOT NULL DEFAULT false;

ALTER TABLE public.reservation_checkout_sessions
  ADD COLUMN IF NOT EXISTS fbp text,
  ADD COLUMN IF NOT EXISTS fbc text,
  ADD COLUMN IF NOT EXISTS scid text,
  ADD COLUMN IF NOT EXISTS ttp text,
  ADD COLUMN IF NOT EXISTS ad_tracking_opt_out boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS client_ip text,
  ADD COLUMN IF NOT EXISTS client_user_agent text;

ALTER TABLE public.stay_reservation_groups
  ADD COLUMN IF NOT EXISTS fbp text,
  ADD COLUMN IF NOT EXISTS fbc text,
  ADD COLUMN IF NOT EXISTS scid text,
  ADD COLUMN IF NOT EXISTS ttp text,
  ADD COLUMN IF NOT EXISTS ad_tracking_opt_out boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS client_ip text,
  ADD COLUMN IF NOT EXISTS client_user_agent text;

COMMENT ON COLUMN public.ticket_checkout_sessions.ttp IS
  'toward #3697: consent-allowed TikTok _ttp cookie for server event matching.';
COMMENT ON COLUMN public.ticket_checkout_sessions.ad_tracking_opt_out IS
  'I-PROPOSED-3697-OPT-OUT-LATCH: true suppresses every server ad-platform send with or without an attribution touch.';
COMMENT ON COLUMN public.reservation_checkout_sessions.ad_tracking_opt_out IS
  'I-PROPOSED-3697-OPT-OUT-LATCH: true suppresses every server ad-platform send with or without an attribution touch.';
COMMENT ON COLUMN public.stay_reservation_groups.ad_tracking_opt_out IS
  'I-PROPOSED-3697-OPT-OUT-LATCH: true suppresses every server ad-platform send with or without an attribution touch.';

CREATE OR REPLACE FUNCTION public.issue_3697_set_stay_ad_context(
  p_group_id uuid,
  p_context jsonb
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF p_group_id IS NULL OR pg_catalog.jsonb_typeof(COALESCE(p_context, '{}'::jsonb)) <> 'object' THEN
    RAISE EXCEPTION 'invalid_stay_ad_context' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.jsonb_object_keys(COALESCE(p_context, '{}'::jsonb)) AS key
    WHERE key NOT IN (
      'fbp', 'fbc', 'scid', 'ttp', 'trackingOptOut',
      'clientIpAddress', 'clientUserAgent'
    )
  ) THEN
    RAISE EXCEPTION 'invalid_stay_ad_context' USING ERRCODE = '22023';
  END IF;

  UPDATE public.stay_reservation_groups
  SET fbp = pg_catalog.left(NULLIF(pg_catalog.btrim(p_context->>'fbp'), ''), 512),
      fbc = pg_catalog.left(NULLIF(pg_catalog.btrim(p_context->>'fbc'), ''), 512),
      scid = pg_catalog.left(NULLIF(pg_catalog.btrim(p_context->>'scid'), ''), 512),
      ttp = pg_catalog.left(NULLIF(pg_catalog.btrim(p_context->>'ttp'), ''), 512),
      ad_tracking_opt_out = COALESCE((p_context->>'trackingOptOut')::boolean, false),
      client_ip = pg_catalog.left(NULLIF(pg_catalog.btrim(p_context->>'clientIpAddress'), ''), 128),
      client_user_agent = pg_catalog.left(NULLIF(pg_catalog.btrim(p_context->>'clientUserAgent'), ''), 1024)
  WHERE id = p_group_id;

  RETURN FOUND;
EXCEPTION
  WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'invalid_stay_ad_context' USING ERRCODE = '22023';
END;
$function$;

REVOKE ALL ON FUNCTION public.issue_3697_set_stay_ad_context(uuid, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_3697_set_stay_ad_context(uuid, jsonb)
  TO service_role;

COMMIT;
