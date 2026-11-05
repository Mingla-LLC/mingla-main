-- Issue #4271 phase 2 — the Tap to Pay release switch and the Apple build's
-- server state, on the fully replayed PG17 schema.
--
--   A-RELEASE  biz_tap_to_pay_release returns only {iphone, android}; defaults
--              off; a listed test brand is on and another brand is not; the
--              list is never returned; bad values read as off; a missing row
--              reads as off; authenticated may call it, anon may not.
BEGIN;
DO $$
DECLARE
  v_listed uuid := '42710000-0000-4000-8000-00000000b001';
  v_other uuid := '42710000-0000-4000-8000-00000000b002';
  v_answer jsonb;
BEGIN
  v_answer := public.biz_tap_to_pay_release(v_other);
  IF v_answer <> '{"iphone":false,"android":false}'::jsonb THEN
    RAISE EXCEPTION 'A-RELEASE default must be off with exactly two keys, got %', v_answer;
  END IF;

  UPDATE public.ops_settings
     SET value = jsonb_build_object('iphone', false, 'android', false, 'test_brand_ids', jsonb_build_array(v_listed))
   WHERE key = 'tap_to_pay_release';
  v_answer := public.biz_tap_to_pay_release(v_listed);
  IF v_answer <> '{"iphone":true,"android":true}'::jsonb THEN
    RAISE EXCEPTION 'A-RELEASE a listed brand must be on, got %', v_answer;
  END IF;
  v_answer := public.biz_tap_to_pay_release(v_other);
  IF v_answer <> '{"iphone":false,"android":false}'::jsonb THEN
    RAISE EXCEPTION 'A-RELEASE another brand must stay off, got %', v_answer;
  END IF;
  IF v_answer ? 'test_brand_ids' THEN
    RAISE EXCEPTION 'A-RELEASE the list must never be returned';
  END IF;

  UPDATE public.ops_settings
     SET value = '{"iphone":true,"android":false,"test_brand_ids":[]}'::jsonb
   WHERE key = 'tap_to_pay_release';
  v_answer := public.biz_tap_to_pay_release(v_other);
  IF v_answer <> '{"iphone":true,"android":false}'::jsonb THEN
    RAISE EXCEPTION 'A-RELEASE flags are read per platform, got %', v_answer;
  END IF;

  UPDATE public.ops_settings
     SET value = '{"iphone":"yes","android":1,"test_brand_ids":"everyone"}'::jsonb
   WHERE key = 'tap_to_pay_release';
  v_answer := public.biz_tap_to_pay_release(v_other);
  IF v_answer <> '{"iphone":false,"android":false}'::jsonb THEN
    RAISE EXCEPTION 'A-RELEASE a bad value must read as off, got %', v_answer;
  END IF;

  UPDATE public.ops_settings SET value = '"on"'::jsonb WHERE key = 'tap_to_pay_release';
  v_answer := public.biz_tap_to_pay_release(v_other);
  IF v_answer <> '{"iphone":false,"android":false}'::jsonb THEN
    RAISE EXCEPTION 'A-RELEASE a non-object must read as off, got %', v_answer;
  END IF;

  DELETE FROM public.ops_settings WHERE key = 'tap_to_pay_release';
  v_answer := public.biz_tap_to_pay_release(v_other);
  IF v_answer <> '{"iphone":false,"android":false}'::jsonb THEN
    RAISE EXCEPTION 'A-RELEASE a missing row must read as off, got %', v_answer;
  END IF;

  IF NOT has_function_privilege('authenticated', 'public.biz_tap_to_pay_release(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'A-RELEASE authenticated must be able to call it';
  END IF;
  IF has_function_privilege('anon', 'public.biz_tap_to_pay_release(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'A-RELEASE anon must not be able to call it';
  END IF;
END;
$$;
ROLLBACK;
