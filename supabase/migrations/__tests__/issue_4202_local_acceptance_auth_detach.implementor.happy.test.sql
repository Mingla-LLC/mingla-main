\set ON_ERROR_STOP on

-- PostgreSQL 17 post-replay behavioural proof.
-- MINGLA-INVARIANT: I-4202-EXPLORER-AUTH-DETACH | issue #4202 | Deleting an Explorer authentication user may detach retained Local audit records, but cannot rewrite or delete the signed agreement evidence.

BEGIN;

DO $test$
DECLARE
  v_user constant uuid := '42020000-0000-4000-8000-000000000201';
  v_city constant uuid := '42020000-0000-4000-8000-000000000202';
  v_application constant uuid := '42020000-0000-4000-8000-000000000203';
  v_acceptance constant uuid := '42020000-0000-4000-8000-000000000204';
  v_local constant uuid := '42020000-0000-4000-8000-000000000205';
  v_application_before jsonb;
  v_acceptance_before jsonb;
  v_refused boolean := false;
BEGIN
  INSERT INTO auth.users(id, email)
  VALUES(v_user, 'issue-4202-local@test.local');

  INSERT INTO public.seeding_cities(
    id, google_place_id, name, country, country_code, center_lat, center_lng,
    bbox_sw_lat, bbox_sw_lng, bbox_ne_lat, bbox_ne_lng
  ) VALUES(
    v_city, 'issue-4202-local-city', 'Issue 4202 Local city', 'Belgium', 'BE',
    50.85, 4.35, 50.75, 4.25, 50.95, 4.45
  );

  INSERT INTO public.local_applications(
    id, user_id, city_id, handles, sample_links, why, status,
    agreement_version, agreement_due_at
  ) VALUES(
    v_application, v_user, v_city, '{"instagram":"issue4202"}'::jsonb,
    '[]'::jsonb, 'I know this city and write useful local reviews.', 'accepted',
    'local-ng-1.0', now() + interval '7 days'
  );

  INSERT INTO public.local_agreement_acceptances(
    id, application_id, user_id, agreement_version, document_url,
    document_sha256, signature_name, accepted_at, created_at
  ) VALUES(
    v_acceptance, v_application, v_user, 'local-ng-1.0',
    'https://usemingla.com/local-agreement',
    '65d2ac74f256dc9bf013aa56afced7f15210083854e471e89f8d7ddce255a954',
    'Issue 4202 Applicant', '2026-10-30 12:00:00+00',
    '2026-10-30 12:00:00+00'
  );

  INSERT INTO public.locals(
    id, user_id, city_id, status, seat_started_on, ends_on,
    agreement_version, agreement_signed_at, agreement_acceptance_id
  ) VALUES(
    v_local, v_user, v_city, 'ended', '2026-10-01', '2026-10-30',
    'local-ng-1.0', '2026-10-30 12:00:00+00', v_acceptance
  );

  SELECT to_jsonb(a) - 'user_id' - 'updated_at'
    INTO v_application_before
  FROM public.local_applications a
  WHERE a.id = v_application;

  SELECT to_jsonb(a) - 'user_id'
    INTO v_acceptance_before
  FROM public.local_agreement_acceptances a
  WHERE a.id = v_acceptance;

  BEGIN
    UPDATE public.local_agreement_acceptances
    SET user_id = NULL
    WHERE id = v_acceptance;
  EXCEPTION WHEN SQLSTATE '55000' THEN
    v_refused := SQLERRM = 'local_agreement_acceptance_immutable';
  END;

  IF NOT v_refused THEN
    RAISE EXCEPTION '#4202 direct agreement identity rewrite was not refused';
  END IF;

  v_refused := false;
  BEGIN
    DELETE FROM public.local_agreement_acceptances
    WHERE id = v_acceptance;
  EXCEPTION WHEN SQLSTATE '55000' THEN
    v_refused := SQLERRM = 'local_agreement_acceptance_immutable';
  END;

  IF NOT v_refused THEN
    RAISE EXCEPTION '#4202 direct signed agreement deletion was not refused';
  END IF;

  DELETE FROM auth.users WHERE id = v_user;

  IF EXISTS (SELECT 1 FROM auth.users WHERE id = v_user) THEN
    RAISE EXCEPTION '#4202 auth user survived deletion';
  END IF;

  IF EXISTS (SELECT 1 FROM public.locals WHERE id = v_local) THEN
    RAISE EXCEPTION '#4202 active Local account row survived auth cascade';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.local_applications
    WHERE id = v_application AND user_id IS NULL
  ) OR (SELECT to_jsonb(a) - 'user_id' - 'updated_at'
        FROM public.local_applications a WHERE a.id = v_application)
       IS DISTINCT FROM v_application_before THEN
    RAISE EXCEPTION '#4202 retained Local application was lost or rewritten';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.local_agreement_acceptances
    WHERE id = v_acceptance AND user_id IS NULL
  ) OR (SELECT to_jsonb(a) - 'user_id'
        FROM public.local_agreement_acceptances a WHERE a.id = v_acceptance)
       IS DISTINCT FROM v_acceptance_before THEN
    RAISE EXCEPTION '#4202 signed agreement evidence was lost or rewritten';
  END IF;

  v_refused := false;
  BEGIN
    UPDATE public.local_agreement_acceptances
    SET signature_name = 'Rewritten signature'
    WHERE id = v_acceptance;
  EXCEPTION WHEN SQLSTATE '55000' THEN
    v_refused := SQLERRM = 'local_agreement_acceptance_immutable';
  END;

  IF NOT v_refused THEN
    RAISE EXCEPTION '#4202 detached signed agreement became mutable';
  END IF;

  v_refused := false;
  BEGIN
    DELETE FROM public.local_agreement_acceptances
    WHERE id = v_acceptance;
  EXCEPTION WHEN SQLSTATE '55000' THEN
    v_refused := SQLERRM = 'local_agreement_acceptance_immutable';
  END;

  IF NOT v_refused THEN
    RAISE EXCEPTION '#4202 detached signed agreement became deletable';
  END IF;
END;
$test$;

ROLLBACK;
