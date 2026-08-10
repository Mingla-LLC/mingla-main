\set ON_ERROR_STOP on
BEGIN;

INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at)
VALUES
  ('00000000-1614-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'owner-1614@example.test', now(), now()),
  ('00000000-1614-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'paired-1614@example.test', now(), now()),
  ('00000000-1614-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'other-1614@example.test', now(), now());

INSERT INTO public.place_pool (id, google_place_id, name, lat, lng)
VALUES
  ('00000000-1614-4000-8000-000000000010', NULL, 'Null identity one', 1, 1),
  ('00000000-1614-4000-8000-000000000011', NULL, 'Null identity two', 2, 2),
  ('00000000-1614-4000-8000-000000000012', 'issue-1614-google', 'Google identity', 3, 3);

INSERT INTO public.place_pool (id, google_place_id, name, lat, lng)
VALUES ('00000000-1614-4000-8000-000000000013', 'issue-1614-google', 'Updated identity', 4, 4)
ON CONFLICT (google_place_id) DO UPDATE SET name = EXCLUDED.name;

DO $assert_place$
BEGIN
  IF (SELECT count(*) FROM public.place_pool WHERE google_place_id IS NULL AND id::text LIKE '00000000-1614%') <> 2 THEN
    RAISE EXCEPTION 'SC-1 FAIL: nullable Google identities collapsed';
  END IF;
  IF (SELECT count(*) FROM public.place_pool WHERE google_place_id = 'issue-1614-google') <> 1 THEN
    RAISE EXCEPTION 'SC-1 FAIL: full UNIQUE upsert did not resolve one row';
  END IF;
END
$assert_place$;

INSERT INTO public.saved_people (id, user_id, initials)
VALUES ('00000000-1614-4000-8000-000000000020', '00000000-1614-4000-8000-000000000001', 'T');

INSERT INTO public.person_card_impressions
  (user_id, person_id, paired_user_id, place_pool_id, holiday_key)
VALUES
  ('00000000-1614-4000-8000-000000000001', '00000000-1614-4000-8000-000000000020', NULL, '00000000-1614-4000-8000-000000000012', 'legacy'),
  ('00000000-1614-4000-8000-000000000001', NULL, '00000000-1614-4000-8000-000000000002', '00000000-1614-4000-8000-000000000012', 'paired')
ON CONFLICT DO NOTHING;

INSERT INTO public.person_card_impressions
  (user_id, person_id, paired_user_id, place_pool_id, holiday_key)
VALUES ('00000000-1614-4000-8000-000000000001', NULL, '00000000-1614-4000-8000-000000000002', '00000000-1614-4000-8000-000000000012', 'paired-again')
ON CONFLICT (user_id, paired_user_id, place_pool_id) DO NOTHING;

DO $assert_impressions$
BEGIN
  IF (SELECT count(*) FROM public.person_card_impressions WHERE user_id = '00000000-1614-4000-8000-000000000001') <> 2 THEN
    RAISE EXCEPTION 'SC-2/3 FAIL: legal impression forms not idempotent';
  END IF;
  BEGIN
    INSERT INTO public.person_card_impressions (user_id, person_id, paired_user_id, place_pool_id, holiday_key)
    VALUES ('00000000-1614-4000-8000-000000000001', NULL, NULL, '00000000-1614-4000-8000-000000000012', 'neither');
    RAISE EXCEPTION 'SC-3 FAIL: neither-subject impression accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.person_card_impressions (user_id, person_id, paired_user_id, place_pool_id, holiday_key)
    VALUES ('00000000-1614-4000-8000-000000000001', '00000000-1614-4000-8000-000000000020', '00000000-1614-4000-8000-000000000002', '00000000-1614-4000-8000-000000000012', 'both');
    RAISE EXCEPTION 'SC-3 FAIL: both-subject impression accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END
$assert_impressions$;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-1614-4000-8000-000000000001', true);

INSERT INTO public.business_notification_type_preferences (user_id, channel, type, opt_in)
VALUES ('00000000-1614-4000-8000-000000000001', 'push', 'business.order_paid', false)
ON CONFLICT (user_id, channel, type) DO UPDATE SET opt_in = EXCLUDED.opt_in;

DO $assert_rls$
BEGIN
  IF (SELECT count(*) FROM public.business_notification_type_preferences) <> 1 THEN
    RAISE EXCEPTION 'SC-5/10 FAIL: owner preference unavailable';
  END IF;
  BEGIN
    INSERT INTO public.business_notification_type_preferences (user_id, channel, type, opt_in)
    VALUES ('00000000-1614-4000-8000-000000000003', 'push', 'business.order_paid', false);
    RAISE EXCEPTION 'SC-10 FAIL: cross-user insert accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END
$assert_rls$;

RESET ROLE;

DO $assert_schema$
BEGIN
  IF to_regclass('public.business_notification_type_preferences') IS NULL THEN
    RAISE EXCEPTION 'SC-5 FAIL: Business preference relation absent';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'notifications'
      AND column_name = 'in_app_suppressed_at' AND is_nullable = 'YES'
  ) THEN
    RAISE EXCEPTION 'SC-8 FAIL: suppression column absent';
  END IF;
  IF has_table_privilege('anon', 'public.business_notification_type_preferences', 'SELECT') THEN
    RAISE EXCEPTION 'SC-10 FAIL: anon can read Business preferences';
  END IF;
END
$assert_schema$;

ROLLBACK;
