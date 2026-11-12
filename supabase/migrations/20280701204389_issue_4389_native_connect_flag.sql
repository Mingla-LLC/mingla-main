-- =============================================================================
-- Issue #4389 (decision S-11, 2026-11-11): kill switch for the NATIVE secure
-- setup screen in the Host app.
--
-- The Host app on iPhone and Android can open the payment partner's secure
-- setup as a native in-app screen instead of the pop-up browser sheet. The
-- native screen is used ONLY when this server switch says so for the phone's
-- platform. Off (the default), unreadable, or a missing row all mean "use the
-- browser sheet", so the native screen can be switched off without a store
-- build.
--
--   ops_settings key 'native_connect_onboarding':
--     {"iphone": bool, "android": bool, "test_brand_ids": [uuid, ...]}
--   test_brand_ids turns the native screen on for named test brands while the
--   platform flags are off. The list is never returned to a client.
--
-- Same shape and rules as 'tap_to_pay_release' (#4271).
-- =============================================================================
ALTER TABLE public.ops_settings DROP CONSTRAINT ops_settings_key_check;
ALTER TABLE public.ops_settings ADD CONSTRAINT ops_settings_key_check
  CHECK (key IN ('auto_steps','brand_auto_cards','brand_auto_since','marketing_owner','follow_through_since','auto_promo_cards','tap_to_pay_release','auto_card_routes','native_connect_onboarding'));
-- (#4398's 20280626004398 added 'auto_card_routes' before this migration; it is kept.)

INSERT INTO public.ops_settings (key, value, updated_by)
VALUES (
  'native_connect_onboarding',
  '{"iphone":false,"android":false,"test_brand_ids":[]}'::jsonb,
  'system@usemingla.com'
)
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.biz_native_connect_onboarding(p_brand_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_value jsonb;
  v_listed boolean := false;
BEGIN
  SELECT value INTO v_value FROM public.ops_settings WHERE key = 'native_connect_onboarding';
  IF v_value IS NULL OR jsonb_typeof(v_value) <> 'object' THEN
    RETURN jsonb_build_object('iphone', false, 'android', false);
  END IF;
  IF p_brand_id IS NOT NULL AND jsonb_typeof(v_value -> 'test_brand_ids') = 'array' THEN
    v_listed := (v_value -> 'test_brand_ids') ? p_brand_id::text;
  END IF;
  RETURN jsonb_build_object(
    'iphone', v_listed OR coalesce(v_value -> 'iphone' = 'true'::jsonb, false),
    'android', v_listed OR coalesce(v_value -> 'android' = 'true'::jsonb, false)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.biz_native_connect_onboarding(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.biz_native_connect_onboarding(uuid)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.biz_native_connect_onboarding(uuid) IS
  '#4389 S-11 kill switch: may the Host app open the native secure setup screen on iphone / android? Defaults off; off means the browser sheet.';
