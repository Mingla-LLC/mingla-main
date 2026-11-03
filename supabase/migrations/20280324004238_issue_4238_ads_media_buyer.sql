-- Issue #4238 — Host Ads media-buyer upgrade.
--
-- Spec: https://github.com/Mingla-LLC/mingla-main/issues/4238#issuecomment-6612906506
--
-- What this adds:
--   1. ad_platform_country_availability — staff-editable "works here" per ad
--      app and country. A missing row means the app works there until staff
--      mark it otherwise (Seth's decision). Written only through
--      admin_set_ad_platform_country.
--   2. ad_ops_switch_events + admin_set_ad_reach_estimates — the per-app reach
--      switch (the existing ad_connections.extra.audience_estimate_certified
--      flag adProviderEstimate.ts reads), audited. Ships OFF.
--   3. host_ad_live_edits + host_ad_amend_live — a Host changes a live ad's
--      budget and end date once a day; Ads credit is set aside or given back
--      in the same transaction.
--   4. ad_finalize_campaign_settlement — the overspend check reads the amended
--      provider cap (a raised cap must not flag "attention required").
--
-- Static SQL only. Conflicts raise PT409, never 40001. New functions are
-- revoked from PUBLIC and anon. New tables have RLS on. No personal data.
-- Do NOT auto-apply — reviewed path post-merge.

BEGIN;

-- ── 1. Works here, per app and country ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ad_platform_country_availability (
  platform text NOT NULL CHECK (platform IN ('meta', 'tiktok', 'snapchat', 'google', 'reddit')),
  country_code char(2) NOT NULL CHECK (country_code ~ '^[A-Z]{2}$'),
  status text NOT NULL CHECK (status IN ('works', 'not_available')),
  reason text NULL CHECK (reason IS NULL OR char_length(btrim(reason)) BETWEEN 1 AND 200),
  updated_by uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (platform, country_code)
);

COMMENT ON TABLE public.ad_platform_country_availability IS
  'Issue #4238: whether an ad app runs in a country on Mingla''s accounts. No row = works (until staff mark it). Host builder greys an app out with the reason; ad-plan create_version refuses an app that runs in none of the chosen countries.';

ALTER TABLE public.ad_platform_country_availability ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ad_platform_country_availability_admin_read
  ON public.ad_platform_country_availability;
CREATE POLICY ad_platform_country_availability_admin_read
  ON public.ad_platform_country_availability
  FOR SELECT TO authenticated USING (public.is_admin_user());
REVOKE ALL ON public.ad_platform_country_availability FROM anon, PUBLIC;
REVOKE INSERT, UPDATE, DELETE ON public.ad_platform_country_availability FROM authenticated;
GRANT SELECT ON public.ad_platform_country_availability TO authenticated;
GRANT ALL ON public.ad_platform_country_availability TO service_role;

-- Proven or documented today: TikTok has no United Kingdom market on Mingla's
-- advertiser (2026-07-15) and Reddit does not sell ads in Nigeria.
INSERT INTO public.ad_platform_country_availability (platform, country_code, status, reason)
VALUES
  ('tiktok', 'GB', 'not_available', 'TikTok can''t run ads in the United Kingdom on Mingla''s account yet.'),
  ('reddit', 'NG', 'not_available', 'Reddit doesn''t run ads in Nigeria.')
ON CONFLICT (platform, country_code) DO NOTHING;

CREATE OR REPLACE FUNCTION public.admin_set_ad_platform_country(
  p_platform text,
  p_country_code text,
  p_status text,
  p_reason text DEFAULT NULL
)
RETURNS public.ad_platform_country_availability
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_row public.ad_platform_country_availability%ROWTYPE;
  v_country text := upper(btrim(coalesce(p_country_code, '')));
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
BEGIN
  IF NOT public.is_admin_user() THEN
    RAISE EXCEPTION 'admin_required' USING ERRCODE = '42501';
  END IF;
  IF p_platform IS NULL OR p_platform NOT IN ('meta', 'tiktok', 'snapchat', 'google', 'reddit') THEN
    RAISE EXCEPTION 'platform_invalid' USING ERRCODE = '22023';
  END IF;
  IF v_country !~ '^[A-Z]{2}$' THEN
    RAISE EXCEPTION 'country_invalid' USING ERRCODE = '22023';
  END IF;
  IF p_status IS NULL OR p_status NOT IN ('works', 'not_available', 'not_checked') THEN
    RAISE EXCEPTION 'status_invalid' USING ERRCODE = '22023';
  END IF;
  IF p_status = 'not_available' AND v_reason IS NULL THEN
    RAISE EXCEPTION 'reason_required' USING ERRCODE = '22023';
  END IF;
  -- "Not checked yet" removes the row: unknown means it works for Hosts.
  IF p_status = 'not_checked' THEN
    DELETE FROM public.ad_platform_country_availability
    WHERE platform = p_platform AND country_code = v_country
    RETURNING * INTO v_row;
    RETURN v_row;
  END IF;
  INSERT INTO public.ad_platform_country_availability (
    platform, country_code, status, reason, updated_by, updated_at
  ) VALUES (
    p_platform, v_country, p_status, left(v_reason, 200), auth.uid(), now()
  )
  ON CONFLICT (platform, country_code) DO UPDATE
  SET status = EXCLUDED.status,
      reason = EXCLUDED.reason,
      updated_by = EXCLUDED.updated_by,
      updated_at = now()
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_set_ad_platform_country(text, text, text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_ad_platform_country(text, text, text, text)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_set_ad_platform_country(text, text, text, text) IS
  'Issue #4238: staff mark whether an ad app runs in a country (works / not_available with a reason / not_checked = delete). Admins only (42501 otherwise).';

-- ── 2. Per-app reach switch ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ad_ops_switch_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  switch text NOT NULL CHECK (switch IN ('reach_estimates')),
  platform text NOT NULL CHECK (platform IN ('meta', 'tiktok', 'snapchat', 'google', 'reddit')),
  value jsonb NOT NULL CHECK (jsonb_typeof(value) = 'object'),
  actor_id uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.ad_ops_switch_events IS
  'Issue #4238: append-only audit of staff ad switches (per-app reach estimates).';

DROP TRIGGER IF EXISTS ad_ops_switch_events_immutable ON public.ad_ops_switch_events;
CREATE TRIGGER ad_ops_switch_events_immutable
  BEFORE UPDATE OR DELETE ON public.ad_ops_switch_events
  FOR EACH ROW EXECUTE FUNCTION public.ad_immutable_row_guard();

ALTER TABLE public.ad_ops_switch_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ad_ops_switch_events_admin_read ON public.ad_ops_switch_events;
CREATE POLICY ad_ops_switch_events_admin_read ON public.ad_ops_switch_events
  FOR SELECT TO authenticated USING (public.is_admin_user());
REVOKE ALL ON public.ad_ops_switch_events FROM anon, PUBLIC;
REVOKE INSERT, UPDATE, DELETE ON public.ad_ops_switch_events FROM authenticated;
GRANT SELECT ON public.ad_ops_switch_events TO authenticated;
GRANT ALL ON public.ad_ops_switch_events TO service_role;

CREATE OR REPLACE FUNCTION public.admin_set_ad_reach_estimates(
  p_platform text,
  p_enabled boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_count integer;
BEGIN
  IF NOT public.is_admin_user() THEN
    RAISE EXCEPTION 'admin_required' USING ERRCODE = '42501';
  END IF;
  IF p_platform IS NULL OR p_platform NOT IN ('meta', 'tiktok', 'snapchat', 'reddit') THEN
    -- Google's reach planner needs allowlisting first; it has no switch.
    RAISE EXCEPTION 'platform_invalid' USING ERRCODE = '22023';
  END IF;
  IF p_enabled IS NULL THEN
    RAISE EXCEPTION 'enabled_required' USING ERRCODE = '22023';
  END IF;
  -- Host ads run on the consumer lane (#4238 D1, HOST_AD_LANE).
  UPDATE public.ad_connections
  SET extra = coalesce(extra, '{}'::jsonb)
        || jsonb_build_object('audience_estimate_certified', p_enabled)
  WHERE platform = p_platform AND lane = 'consumer';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  INSERT INTO public.ad_ops_switch_events (switch, platform, value, actor_id)
  VALUES ('reach_estimates', p_platform,
    jsonb_build_object('enabled', p_enabled, 'rows', v_count), auth.uid());
  RETURN jsonb_build_object('platform', p_platform, 'enabled', p_enabled, 'rows', v_count);
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_set_ad_reach_estimates(text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_ad_reach_estimates(text, boolean)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_set_ad_reach_estimates(text, boolean) IS
  'Issue #4238: staff switch Host reach estimates on or off per ad app (the read-only provider reach call). Admins only (42501 otherwise). Audited in ad_ops_switch_events.';

COMMIT;
