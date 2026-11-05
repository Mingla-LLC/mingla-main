-- Issue #4271 phase 2 — the Tap to Pay release switch and the Apple build's
-- server state, on the fully replayed PG17 schema.
--
--   A-RELEASE  biz_tap_to_pay_release returns only {iphone, android}; defaults
--              off; a listed test brand is on and another brand is not; the
--              list is never returned; bad values read as off; a missing row
--              reads as off; authenticated may call it, anon may not.
--   A-BRAND-PERM  the brand-wide door permission: owner, event manager and a
--              brand scanner with the switch may; a brand scanner without it, an
--              event-only scanner and an outsider may not; service role only.
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

DO $$
DECLARE
  v_owner uuid := gen_random_uuid();
  v_manager uuid := gen_random_uuid();
  v_pay uuid := gen_random_uuid();
  v_plain uuid := gen_random_uuid();
  v_event_only uuid := gen_random_uuid();
  v_outsider uuid := gen_random_uuid();
  v_brand uuid := gen_random_uuid();
  v_event uuid := gen_random_uuid();
BEGIN
  INSERT INTO auth.users (id, email)
  SELECT id, id::text || '@example.test'
    FROM unnest(ARRAY[v_owner, v_manager, v_pay, v_plain, v_event_only, v_outsider]) AS id;
  INSERT INTO public.creator_accounts (id, email, display_name)
  SELECT id, id::text || '@example.test', 'Member'
    FROM unnest(ARRAY[v_owner, v_manager, v_pay, v_plain, v_event_only, v_outsider]) AS id;
  INSERT INTO public.brands (id, account_id, name, slug, default_currency, pricing_currency, payment_provider)
  VALUES (v_brand, v_owner, 'Brand perm', 'brand-perm-'||v_brand, 'USD', 'USD', 'stripe');
  INSERT INTO public.brand_team_members (brand_id, user_id, role, invited_at, accepted_at, permissions_override) VALUES
    (v_brand, v_owner, 'brand_owner', now(), now(), '{}'::jsonb),
    (v_brand, v_manager, 'event_manager', now(), now(), '{}'::jsonb),
    (v_brand, v_pay, 'scanner', now(), now(), '{"canAcceptPayments":true}'::jsonb),
    (v_brand, v_plain, 'scanner', now(), now(), '{}'::jsonb)
  ON CONFLICT DO NOTHING;
  INSERT INTO public.events (id, brand_id, title, slug, event_type, status, visibility, timezone, currency)
  VALUES (v_event, v_brand, 'Night', 'brand-perm-'||v_event, 'event', 'live', 'public', 'UTC', 'USD');
  INSERT INTO public.event_scanners (event_id, user_id, permissions, assigned_by)
  VALUES (v_event, v_event_only, '{"canAcceptPayments":true}'::jsonb, v_owner);

  IF NOT public.issue_4271_can_take_brand_door_payment(v_brand, v_owner) THEN
    RAISE EXCEPTION 'A-BRAND-PERM owner must be allowed';
  END IF;
  IF NOT public.issue_4271_can_take_brand_door_payment(v_brand, v_manager) THEN
    RAISE EXCEPTION 'A-BRAND-PERM event manager must be allowed';
  END IF;
  IF NOT public.issue_4271_can_take_brand_door_payment(v_brand, v_pay) THEN
    RAISE EXCEPTION 'A-BRAND-PERM a brand scanner with the switch must be allowed';
  END IF;
  IF public.issue_4271_can_take_brand_door_payment(v_brand, v_plain) THEN
    RAISE EXCEPTION 'A-BRAND-PERM a brand scanner without the switch must be refused';
  END IF;
  IF public.issue_4271_can_take_brand_door_payment(v_brand, v_event_only) THEN
    RAISE EXCEPTION 'A-BRAND-PERM an event-only scanner gets no brand-wide session';
  END IF;
  IF public.issue_4271_can_take_brand_door_payment(v_brand, v_outsider) THEN
    RAISE EXCEPTION 'A-BRAND-PERM an outsider must be refused';
  END IF;
  IF public.issue_4271_can_take_brand_door_payment(v_brand, NULL) THEN
    RAISE EXCEPTION 'A-BRAND-PERM no actor must be refused';
  END IF;
  IF has_function_privilege('authenticated', 'public.issue_4271_can_take_brand_door_payment(uuid, uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'A-BRAND-PERM service role only';
  END IF;
END;
$$;
ROLLBACK;
