-- #4063 Wave 2 — RSVP capacity promotions send only after approval.
-- MINGLA-INVARIANT: I-4063-RSVP-PROMOTION-AFTER-APPROVAL | issue #4063 | With messages_v2 enabled, auto promotions enqueue the canonical pass and manual promotions remain silent until host approval.
\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION pg_temp.i4063_promotion_assert(
  p_ok boolean,
  p_message text
) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_ok IS NOT TRUE THEN
    RAISE EXCEPTION '#4063 promotion FAIL: %', p_message;
  END IF;
END
$$;

BEGIN;
DO $test$
DECLARE
  v_owner uuid := gen_random_uuid();
  v_brand uuid := gen_random_uuid();
  v_legacy_event uuid := gen_random_uuid();
  v_manual_event uuid := gen_random_uuid();
  v_auto_event uuid := gen_random_uuid();
  v_legacy_current uuid := gen_random_uuid();
  v_manual_current uuid := gen_random_uuid();
  v_auto_current uuid := gen_random_uuid();
  v_legacy_waitlisted uuid := gen_random_uuid();
  v_manual_waitlisted uuid := gen_random_uuid();
  v_auto_waitlisted uuid := gen_random_uuid();
BEGIN
  INSERT INTO auth.users(id, email)
  VALUES (v_owner, 'rsvp-promotion-owner-4063-' || v_owner || '@example.test');
  INSERT INTO public.creator_accounts(id, email)
  VALUES (v_owner, 'rsvp-promotion-owner-4063-' || v_owner || '@example.test');
  INSERT INTO public.brands(
    id, account_id, name, slug, payment_provider, pricing_region,
    pricing_currency, default_currency
  ) VALUES (
    v_brand, v_owner, 'Issue 4063 RSVP Promotion',
    'issue-4063-rsvp-promotion-' || v_brand, 'stripe', 'US', 'USD', 'USD'
  );

  INSERT INTO public.events(
    id, brand_id, created_by, title, slug, event_type, status, visibility,
    timezone, currency, rsvp_capacity, rsvp_waitlist_enabled,
    rsvp_approval_mode, published_at
  ) VALUES
    (v_legacy_event, v_brand, v_owner, 'Legacy Promotion',
     'legacy-promotion-' || v_legacy_event, 'rsvp', 'scheduled', 'public',
     'America/New_York', 'USD', 1, true, 'auto', now()),
    (v_manual_event, v_brand, v_owner, 'Manual Promotion',
     'manual-promotion-' || v_manual_event, 'rsvp', 'scheduled', 'public',
     'America/New_York', 'USD', 1, true, 'manual', now()),
    (v_auto_event, v_brand, v_owner, 'Auto Promotion',
     'auto-promotion-' || v_auto_event, 'rsvp', 'scheduled', 'public',
     'America/New_York', 'USD', 1, true, 'auto', now());

  INSERT INTO public.event_rsvps(
    id, event_id, guest_name, guest_email, guest_phone, rsvp_status,
    approval_status, plus_count, created_at
  ) VALUES
    (v_legacy_current, v_legacy_event, 'Legacy Current',
     'legacy-current-4063@example.test', '+14155550100', 'going', 'approved', 0, now()),
    (v_manual_current, v_manual_event, 'Manual Current',
     'manual-current-4063@example.test', '+14155550101', 'going', 'approved', 0, now()),
    (v_auto_current, v_auto_event, 'Auto Current',
     'auto-current-4063@example.test', '+14155550102', 'going', 'approved', 0, now());

  INSERT INTO public.event_rsvps(
    id, event_id, guest_name, guest_email, guest_phone, rsvp_status,
    approval_status, plus_count, waitlisted_at, created_at, qr_code
  ) VALUES
    (v_legacy_waitlisted, v_legacy_event, 'Legacy Waitlisted',
     'legacy-waitlisted-4063@example.test', '+14155550110', 'waitlisted',
     'approved', 0, now() - interval '3 minutes', now() - interval '3 minutes',
     'mingla-rsvp:4063-legacy'),
    (v_manual_waitlisted, v_manual_event, 'Manual Waitlisted',
     'manual-waitlisted-4063@example.test', '+14155550111', 'waitlisted',
     'pending', 0, now() - interval '2 minutes', now() - interval '2 minutes',
     'mingla-rsvp:4063-manual'),
    (v_auto_waitlisted, v_auto_event, 'Auto Waitlisted',
     'auto-waitlisted-4063@example.test', '+14155550112', 'waitlisted',
     'approved', 0, now() - interval '1 minute', now() - interval '1 minute',
     'mingla-rsvp:4063-auto');

  UPDATE public.issue_4063_switches
     SET enabled = false, changed_at = NULL
   WHERE name = 'messages_v2';
  UPDATE public.event_rsvps
     SET rsvp_status = 'not_going'
   WHERE id = v_legacy_current;

  PERFORM pg_temp.i4063_promotion_assert(EXISTS (
    SELECT 1
      FROM public.rsvp_notifications
     WHERE rsvp_id = v_legacy_waitlisted
       AND template_key = 'rsvp_waitlist_promoted'
       AND idempotency_key LIKE 'rsvp_promote:' || v_legacy_waitlisted::text || ':%'
  ), 'switch-off path must preserve the legacy promotion notice');

  UPDATE public.issue_4063_switches
     SET enabled = true, changed_at = now()
   WHERE name = 'messages_v2';
  UPDATE public.event_rsvps
     SET rsvp_status = 'not_going'
   WHERE id = v_manual_current;

  PERFORM pg_temp.i4063_promotion_assert(EXISTS (
    SELECT 1
      FROM public.event_rsvps
     WHERE id = v_manual_waitlisted
       AND rsvp_status = 'going'
       AND approval_status = 'pending'
       AND promoted_at IS NOT NULL
  ), 'manual capacity drain must promote the oldest row to going and pending');
  PERFORM pg_temp.i4063_promotion_assert(NOT EXISTS (
    SELECT 1
      FROM public.rsvp_notifications
     WHERE rsvp_id = v_manual_waitlisted
  ), 'manual promotion must remain silent until host approval');

  UPDATE public.event_rsvps
     SET rsvp_status = 'not_going'
   WHERE id = v_auto_current;

  PERFORM pg_temp.i4063_promotion_assert(EXISTS (
    SELECT 1
      FROM public.event_rsvps
     WHERE id = v_auto_waitlisted
       AND rsvp_status = 'going'
       AND approval_status = 'approved'
       AND promoted_at IS NOT NULL
  ), 'auto capacity drain must promote the oldest row to going and approved');
  PERFORM pg_temp.i4063_promotion_assert(EXISTS (
    SELECT 1
      FROM public.rsvp_notifications
     WHERE rsvp_id = v_auto_waitlisted
       AND template_key = 'rsvp_pass'
       AND idempotency_key = 'rsvp_pass:' || v_auto_waitlisted::text || ':primary'
  ), 'auto promotion must enqueue the canonical pass immediately');
  PERFORM pg_temp.i4063_promotion_assert(NOT EXISTS (
    SELECT 1
      FROM public.rsvp_notifications
     WHERE rsvp_id = v_auto_waitlisted
       AND template_key = 'rsvp_waitlist_promoted'
  ), 'auto promotion must not also enqueue the legacy promotion notice');
END
$test$;
ROLLBACK;
