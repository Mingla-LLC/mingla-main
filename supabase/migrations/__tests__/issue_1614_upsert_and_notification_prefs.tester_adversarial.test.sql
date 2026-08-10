\set ON_ERROR_STOP on
BEGIN;

-- Prove the old partial-index shapes cannot arbitrate the exact PostgREST
-- statement, then restore the migrated full constraints inside this rollback.
ALTER TABLE public.place_pool
  DROP CONSTRAINT place_pool_google_place_id_key;
CREATE UNIQUE INDEX issue_1614_tester_place_partial
  ON public.place_pool (google_place_id)
  WHERE google_place_id IS NOT NULL;
DO $place_partial_rejected$
BEGIN
  BEGIN
    EXECUTE 'EXPLAIN INSERT INTO public.place_pool (google_place_id) VALUES (NULL) ON CONFLICT (google_place_id) DO NOTHING';
    RAISE EXCEPTION 'tester SC-1 FAIL: partial place arbiter was accepted';
  EXCEPTION WHEN invalid_column_reference THEN
    NULL;
  END;
END
$place_partial_rejected$;
DROP INDEX public.issue_1614_tester_place_partial;
ALTER TABLE public.place_pool
  ADD CONSTRAINT place_pool_google_place_id_key UNIQUE (google_place_id);
EXPLAIN INSERT INTO public.place_pool (google_place_id)
VALUES (NULL) ON CONFLICT (google_place_id) DO NOTHING;

ALTER TABLE public.person_card_impressions
  DROP CONSTRAINT person_card_impressions_paired_user_key;
CREATE UNIQUE INDEX issue_1614_tester_impression_partial
  ON public.person_card_impressions (user_id, paired_user_id, place_pool_id)
  WHERE paired_user_id IS NOT NULL;
DO $impression_partial_rejected$
BEGIN
  BEGIN
    EXECUTE 'EXPLAIN INSERT INTO public.person_card_impressions (user_id, paired_user_id, place_pool_id) VALUES (NULL, NULL, NULL) ON CONFLICT (user_id, paired_user_id, place_pool_id) DO NOTHING';
    RAISE EXCEPTION 'tester SC-2 FAIL: partial impression arbiter was accepted';
  EXCEPTION WHEN invalid_column_reference THEN
    NULL;
  END;
END
$impression_partial_rejected$;
DROP INDEX public.issue_1614_tester_impression_partial;
ALTER TABLE public.person_card_impressions
  ADD CONSTRAINT person_card_impressions_paired_user_key
  UNIQUE (user_id, paired_user_id, place_pool_id);

INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at)
VALUES
  ('00000000-1614-4000-9000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'tester-owner-1614@example.test', now(), now()),
  ('00000000-1614-4000-9000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'tester-other-1614@example.test', now(), now());

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-1614-4000-9000-000000000001', true);
INSERT INTO public.business_notification_type_preferences
  (user_id, channel, type, opt_in)
VALUES
  ('00000000-1614-4000-9000-000000000001', 'push', 'business.new_review', false),
  ('00000000-1614-4000-9000-000000000001', 'in_app', 'business.new_review', true);
UPDATE public.business_notification_type_preferences
SET opt_in = true
WHERE user_id = '00000000-1614-4000-9000-000000000001'
  AND channel = 'push'
  AND type = 'business.new_review';

SELECT set_config('request.jwt.claim.sub', '00000000-1614-4000-9000-000000000002', true);
DO $cross_user_rls$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.business_notification_type_preferences
    WHERE user_id = '00000000-1614-4000-9000-000000000001'
  ) THEN
    RAISE EXCEPTION 'tester SC-10 FAIL: cross-user SELECT exposed rows';
  END IF;

  BEGIN
    INSERT INTO public.business_notification_type_preferences
      (user_id, channel, type, opt_in)
    VALUES
      ('00000000-1614-4000-9000-000000000001', 'push', 'business.order_paid', false);
    RAISE EXCEPTION 'tester SC-10 FAIL: cross-user INSERT was accepted';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
END
$cross_user_rls$;

RESET ROLE;

DO $schema_boundaries$
BEGIN
  IF has_table_privilege('anon', 'public.business_notification_type_preferences', 'SELECT')
     OR has_table_privilege('anon', 'public.business_notification_type_preferences', 'INSERT')
     OR has_table_privilege('anon', 'public.business_notification_type_preferences', 'UPDATE')
     OR has_table_privilege('anon', 'public.business_notification_type_preferences', 'DELETE') THEN
    RAISE EXCEPTION 'tester SC-10 FAIL: anon privilege leaked';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.person_card_impressions'::regclass
      AND conname = 'person_card_impressions_exactly_one_subject_check'
      AND contype = 'c' AND convalidated
  ) THEN
    RAISE EXCEPTION 'tester SC-3 FAIL: validated XOR subject constraint absent';
  END IF;

  BEGIN
    INSERT INTO public.business_notification_type_preferences
      (user_id, channel, type, opt_in)
    VALUES
      ('00000000-1614-4000-9000-000000000001', 'sms', 'business.new_review', true);
    RAISE EXCEPTION 'tester SC-5 FAIL: unsupported channel was accepted';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  BEGIN
    INSERT INTO public.business_notification_type_preferences
      (user_id, channel, type, opt_in)
    VALUES
      ('00000000-1614-4000-9000-000000000001', 'push', 'business.unknown', true);
    RAISE EXCEPTION 'tester SC-5 FAIL: unsupported Business type was accepted';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;
END
$schema_boundaries$;

ROLLBACK;
