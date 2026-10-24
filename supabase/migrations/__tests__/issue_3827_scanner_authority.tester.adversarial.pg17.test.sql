-- issue #3827 — scanner authority hotfix, tester adversarial suite (pg17).
-- Attacks rank widening, unaccepted/removed memberships and explicit grants
-- whose scan permission was revoked.
--
-- MINGLA-INVARIANT: I-3827-SCANNER-FAILS-CLOSED | issue #3827 | lower brand roles, foreign managers, removed or unaccepted brand scanners, and inactive or scan-disabled event scanner rows cannot scan tickets.

\set ON_ERROR_STOP on

BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.t3827_scan_assert(p_ok boolean, p_label text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF NOT COALESCE(p_ok, false) THEN
    RAISE EXCEPTION 'issue #3827 scanner adversarial FAIL: %', p_label;
  END IF;
  RAISE NOTICE 'PASS  %', p_label;
END
$$;

CREATE OR REPLACE FUNCTION pg_temp.t3827_scan_error(
  p_event uuid, p_user uuid
) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  PERFORM public.biz_ticket_scan(
    p_event, 'invalid-qr', p_user,
    't3827-scanner-pepper-0123456789abcdef'
  );
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RETURN SQLERRM;
END
$$;

DO $adversarial$
DECLARE
  v_owner uuid := gen_random_uuid();
  v_finance uuid := gen_random_uuid();
  v_marketing uuid := gen_random_uuid();
  v_unaccepted uuid := gen_random_uuid();
  v_removed_brand uuid := gen_random_uuid();
  v_disabled_event uuid := gen_random_uuid();
  v_removed_event uuid := gen_random_uuid();
  v_foreign_owner uuid := gen_random_uuid();
  v_foreign_manager uuid := gen_random_uuid();
  v_brand uuid := gen_random_uuid();
  v_foreign_brand uuid := gen_random_uuid();
  v_event uuid := gen_random_uuid();
BEGIN
  INSERT INTO auth.users(id, email) VALUES
    (v_owner, 't3827-owner@example.test'),
    (v_finance, 't3827-finance@example.test'),
    (v_marketing, 't3827-marketing@example.test'),
    (v_unaccepted, 't3827-unaccepted@example.test'),
    (v_removed_brand, 't3827-removed-brand@example.test'),
    (v_disabled_event, 't3827-disabled-event@example.test'),
    (v_removed_event, 't3827-removed-event@example.test'),
    (v_foreign_owner, 't3827-foreign-owner@example.test'),
    (v_foreign_manager, 't3827-foreign-manager@example.test');
  INSERT INTO public.creator_accounts(id) VALUES (v_owner), (v_foreign_owner);
  INSERT INTO public.brands(id, account_id, name, slug, payment_provider) VALUES
    (v_brand, v_owner, 't3827 scanner target',
     't3827-scanner-target-' || v_brand, 'stripe'),
    (v_foreign_brand, v_foreign_owner, 't3827 scanner foreign',
     't3827-scanner-foreign-' || v_foreign_brand, 'stripe');
  INSERT INTO public.events(
    id, brand_id, title, slug, event_type, status, visibility, timezone,
    is_multi_date, is_recurring
  ) VALUES (
    v_event, v_brand, 't3827 scanner target event',
    't3827-scanner-target-event-' || v_event, 'event', 'draft', 'draft',
    'UTC', false, false
  );

  INSERT INTO public.brand_team_members(
    brand_id, user_id, role, invited_at, accepted_at, removed_at
  ) VALUES
    (v_brand, v_finance, 'finance_manager', now(), now(), NULL),
    (v_brand, v_marketing, 'marketing_manager', now(), now(), NULL),
    (v_brand, v_unaccepted, 'scanner', now(), NULL, NULL),
    (v_brand, v_removed_brand, 'scanner', now(), now(), now()),
    (v_foreign_brand, v_foreign_manager, 'event_manager', now(), now(), NULL);
  INSERT INTO public.event_scanners(
    event_id, user_id, permissions, removed_at
  ) VALUES
    (v_event, v_disabled_event, '{"scan":false}'::jsonb, NULL),
    (v_event, v_removed_event, '{"scan":true}'::jsonb, now());

  PERFORM pg_temp.t3827_scan_assert(
    pg_temp.t3827_scan_error(v_event, v_finance) = 'scanner_not_authorized',
    'A1 finance_manager is below the event_manager scan threshold'
  );
  PERFORM pg_temp.t3827_scan_assert(
    pg_temp.t3827_scan_error(v_event, v_marketing) = 'scanner_not_authorized',
    'A2 marketing_manager is below the event_manager scan threshold'
  );
  PERFORM pg_temp.t3827_scan_assert(
    pg_temp.t3827_scan_error(v_event, v_unaccepted) = 'scanner_not_authorized',
    'A3 an unaccepted brand scanner cannot scan'
  );
  PERFORM pg_temp.t3827_scan_assert(
    pg_temp.t3827_scan_error(v_event, v_removed_brand) = 'scanner_not_authorized',
    'A4 a removed brand scanner cannot scan'
  );
  PERFORM pg_temp.t3827_scan_assert(
    pg_temp.t3827_scan_error(v_event, v_disabled_event) = 'scanner_not_authorized',
    'A5 an event scanner with scan=false cannot scan'
  );
  PERFORM pg_temp.t3827_scan_assert(
    pg_temp.t3827_scan_error(v_event, v_removed_event) = 'scanner_not_authorized',
    'A6 a removed event scanner cannot scan'
  );
  PERFORM pg_temp.t3827_scan_assert(
    pg_temp.t3827_scan_error(v_event, v_foreign_manager) = 'scanner_not_authorized',
    'A7 an event manager of another brand cannot scan'
  );
  PERFORM pg_temp.t3827_scan_assert(
    NOT EXISTS (
      SELECT 1 FROM public.scan_events
       WHERE event_id = v_event
         AND scanner_user_id IN (
           v_finance, v_marketing, v_unaccepted, v_removed_brand,
           v_disabled_event, v_removed_event, v_foreign_manager
         )
    ),
    'denied attempts write no scan audit rows'
  );
END
$adversarial$;

ROLLBACK;
