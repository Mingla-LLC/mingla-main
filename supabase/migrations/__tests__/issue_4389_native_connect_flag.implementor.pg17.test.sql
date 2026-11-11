-- Issue #4389 S-11 — the native secure setup kill switch, on the fully
-- replayed PG17 schema.
--
--   A-DEFAULT  the seeded row is off on both platforms (default OFF).
--   A-FLAG     biz_native_connect_onboarding returns only {iphone, android};
--              flags are read per platform; a listed test brand is on and
--              another brand is not; the list is never returned.
--   A-BAD      bad values, a non-object and a missing row all read as off.
--   A-GRANT    authenticated may call it, anon may not.
--   A-KEYS     the earlier ops_settings keys are still accepted; an unknown key
--              is still refused.
BEGIN;
DO $$
DECLARE
  v_listed uuid := '43890000-0000-4000-8000-00000000c001';
  v_other uuid := '43890000-0000-4000-8000-00000000c002';
  v_answer jsonb;
  v_seed jsonb;
BEGIN
  SELECT value INTO v_seed FROM public.ops_settings WHERE key = 'native_connect_onboarding';
  IF v_seed IS NULL
     OR v_seed -> 'iphone' <> 'false'::jsonb
     OR v_seed -> 'android' <> 'false'::jsonb THEN
    RAISE EXCEPTION 'A-DEFAULT the seeded row must exist and be off, got %', v_seed;
  END IF;

  v_answer := public.biz_native_connect_onboarding(v_other);
  IF v_answer <> '{"iphone":false,"android":false}'::jsonb THEN
    RAISE EXCEPTION 'A-DEFAULT must be off with exactly two keys, got %', v_answer;
  END IF;

  UPDATE public.ops_settings
     SET value = jsonb_build_object('iphone', false, 'android', false, 'test_brand_ids', jsonb_build_array(v_listed))
   WHERE key = 'native_connect_onboarding';
  v_answer := public.biz_native_connect_onboarding(v_listed);
  IF v_answer <> '{"iphone":true,"android":true}'::jsonb THEN
    RAISE EXCEPTION 'A-FLAG a listed brand must be on, got %', v_answer;
  END IF;
  v_answer := public.biz_native_connect_onboarding(v_other);
  IF v_answer <> '{"iphone":false,"android":false}'::jsonb THEN
    RAISE EXCEPTION 'A-FLAG another brand must stay off, got %', v_answer;
  END IF;
  IF v_answer ? 'test_brand_ids' THEN
    RAISE EXCEPTION 'A-FLAG the list must never be returned';
  END IF;

  UPDATE public.ops_settings
     SET value = '{"iphone":false,"android":true,"test_brand_ids":[]}'::jsonb
   WHERE key = 'native_connect_onboarding';
  v_answer := public.biz_native_connect_onboarding(v_other);
  IF v_answer <> '{"iphone":false,"android":true}'::jsonb THEN
    RAISE EXCEPTION 'A-FLAG flags are read per platform, got %', v_answer;
  END IF;

  UPDATE public.ops_settings
     SET value = '{"iphone":"yes","android":1,"test_brand_ids":"everyone"}'::jsonb
   WHERE key = 'native_connect_onboarding';
  v_answer := public.biz_native_connect_onboarding(v_other);
  IF v_answer <> '{"iphone":false,"android":false}'::jsonb THEN
    RAISE EXCEPTION 'A-BAD a bad value must read as off, got %', v_answer;
  END IF;

  UPDATE public.ops_settings SET value = '"on"'::jsonb WHERE key = 'native_connect_onboarding';
  v_answer := public.biz_native_connect_onboarding(v_other);
  IF v_answer <> '{"iphone":false,"android":false}'::jsonb THEN
    RAISE EXCEPTION 'A-BAD a non-object must read as off, got %', v_answer;
  END IF;

  DELETE FROM public.ops_settings WHERE key = 'native_connect_onboarding';
  v_answer := public.biz_native_connect_onboarding(v_other);
  IF v_answer <> '{"iphone":false,"android":false}'::jsonb THEN
    RAISE EXCEPTION 'A-BAD a missing row must read as off, got %', v_answer;
  END IF;

  IF NOT has_function_privilege('authenticated', 'public.biz_native_connect_onboarding(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'A-GRANT authenticated must be able to call it';
  END IF;
  IF has_function_privilege('anon', 'public.biz_native_connect_onboarding(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'A-GRANT anon must not be able to call it';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.ops_settings WHERE key = 'tap_to_pay_release') THEN
    RAISE EXCEPTION 'A-KEYS the tap_to_pay_release row must survive the constraint swap';
  END IF;
  BEGIN
    INSERT INTO public.ops_settings (key, value, updated_by)
    VALUES ('not_a_real_key_4389', '{}'::jsonb, 'system@usemingla.com');
    RAISE EXCEPTION 'A-KEYS an unknown key must be refused';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;
END;
$$;
ROLLBACK;
