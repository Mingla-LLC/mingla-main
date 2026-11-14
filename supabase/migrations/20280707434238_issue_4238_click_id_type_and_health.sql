-- Issue #4238 Wave 1 (M-1) — ad tracking that holds.
--
-- Spec: #4238 tracking-fix spec v2.4, sections 5.4, 6 (W1-2), 7 (W2-6), 12.
--
-- What this adds:
--   1. ad_attribution_touches.external_click_id_type — which URL parameter an
--      external click id came from (fbclid, ttclid, sccid, gclid, gbraid,
--      wbraid, rdt_cid). NULL for legacy rows. Read by the Google upload so a
--      gbraid/wbraid is sent in its own field (W2-6 writes it).
--   2. ad_tracking_health — one row per (channel, lane), written only by the
--      hourly ad-conversion-retry run (service role): key presence, pixel
--      configured, last send, last failure, daily probe and last alert. It
--      never stores a token, a hash or any person's data. Admins read it.
--   3. admin_set_ad_connection_test_code(platform, code) — admins save the
--      Meta or TikTok test event code the daily probe uses. Writes only the
--      one ad_connections.extra.test_event_code key on the consumer lane.
--
-- Static SQL only. New table has RLS on; the new function is revoked from
-- PUBLIC and anon. Do NOT auto-apply — reviewed path post-merge.

BEGIN;

-- ── 1. Typed external click id ──────────────────────────────────────────────
ALTER TABLE public.ad_attribution_touches
  ADD COLUMN IF NOT EXISTS external_click_id_type text NULL;

ALTER TABLE public.ad_attribution_touches
  DROP CONSTRAINT IF EXISTS ad_attribution_touches_external_click_id_type_check;
ALTER TABLE public.ad_attribution_touches
  ADD CONSTRAINT ad_attribution_touches_external_click_id_type_check
  CHECK (
    external_click_id_type IS NULL
    OR external_click_id_type IN ('fbclid', 'ttclid', 'sccid', 'gclid', 'gbraid', 'wbraid', 'rdt_cid')
  );

COMMENT ON COLUMN public.ad_attribution_touches.external_click_id_type IS
  'Issue #4238: the URL parameter external_click_id came from. NULL = legacy row (treated as the network''s classic id).';

-- ── 2. Tracking health ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ad_tracking_health (
  channel text NOT NULL CHECK (channel IN ('meta', 'tiktok', 'snap', 'reddit', 'google')),
  lane text NOT NULL CHECK (lane IN ('consumer', 'business')),
  token_present boolean NOT NULL DEFAULT false,
  pixel_configured boolean NOT NULL DEFAULT false,
  last_sent_at timestamptz NULL,
  last_failure_at timestamptz NULL,
  last_failure_reason text NULL CHECK (
    last_failure_reason IS NULL OR char_length(last_failure_reason) BETWEEN 1 AND 80
  ),
  failures_1h integer NOT NULL DEFAULT 0 CHECK (failures_1h >= 0),
  last_probe_at timestamptz NULL,
  last_probe_result text NULL CHECK (
    last_probe_result IS NULL
    OR last_probe_result IN ('ok', 'auth_failed', 'not_configured', 'skipped_no_test_code', 'failed')
  ),
  last_alerted_at timestamptz NULL,
  last_alert_reason text NULL CHECK (
    last_alert_reason IS NULL OR char_length(last_alert_reason) BETWEEN 1 AND 80
  ),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (channel, lane)
);

COMMENT ON TABLE public.ad_tracking_health IS
  'Issue #4238: per-channel server-event health, written hourly by ad-conversion-retry (service role). Names and states only: never a token, a hash or a person''s data. Admin read only.';

ALTER TABLE public.ad_tracking_health ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ad_tracking_health_admin_read ON public.ad_tracking_health;
CREATE POLICY ad_tracking_health_admin_read
  ON public.ad_tracking_health
  FOR SELECT TO authenticated USING (public.is_admin_user());
REVOKE ALL ON public.ad_tracking_health FROM anon, authenticated, PUBLIC;
GRANT SELECT ON public.ad_tracking_health TO authenticated;
GRANT ALL ON public.ad_tracking_health TO service_role;

-- ── 3. Test event code (Meta / TikTok / Reddit, consumer lane) ──────────────
-- Reddit (#4238 Step 0 Z5): CAPI v3 `test_id`, the Events Testing id.
CREATE OR REPLACE FUNCTION public.admin_set_ad_connection_test_code(
  p_platform text,
  p_code text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_code text := nullif(btrim(coalesce(p_code, '')), '');
  v_extra jsonb;
BEGIN
  IF NOT public.is_admin_user() THEN
    RAISE EXCEPTION 'admin_required' USING ERRCODE = '42501';
  END IF;
  IF p_platform IS NULL OR p_platform NOT IN ('meta', 'tiktok', 'reddit') THEN
    RAISE EXCEPTION 'platform_invalid' USING ERRCODE = '22023';
  END IF;
  IF v_code IS NOT NULL AND v_code !~ '^[A-Za-z0-9_-]{1,64}$' THEN
    RAISE EXCEPTION 'test_code_invalid' USING ERRCODE = '22023';
  END IF;
  UPDATE public.ad_connections
  SET extra = CASE
        WHEN v_code IS NULL THEN coalesce(extra, '{}'::jsonb) - 'test_event_code'
        ELSE jsonb_set(coalesce(extra, '{}'::jsonb), '{test_event_code}', to_jsonb(v_code), true)
      END,
      updated_at = now()
  WHERE platform = p_platform AND lane = 'consumer'
  RETURNING extra INTO v_extra;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'connection_missing' USING ERRCODE = 'P0002';
  END IF;
  RETURN jsonb_build_object('platform', p_platform, 'test_event_code', v_extra -> 'test_event_code');
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_set_ad_connection_test_code(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_ad_connection_test_code(text, text)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_set_ad_connection_test_code(text, text) IS
  'Issue #4238: admins save (or clear with NULL/blank) the Meta, TikTok or Reddit test event code (Reddit: the CAPI v3 test_id) on the consumer ad connection. Writes only extra.test_event_code. 42501 for non-admins; 22023 for a bad platform or code.';

COMMIT;
