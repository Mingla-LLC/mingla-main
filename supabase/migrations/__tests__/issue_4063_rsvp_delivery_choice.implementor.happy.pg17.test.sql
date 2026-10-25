\set ON_ERROR_STOP on

BEGIN;

DO $test$
DECLARE
  v_owner uuid := '40630000-0000-4000-8000-000000006201';
  v_brand uuid := '40630000-0000-4000-8000-000000006202';
  v_auto uuid := '40630000-0000-4000-8000-000000006203';
  v_manual uuid := '40630000-0000-4000-8000-000000006204';
  v_result jsonb;
  v_pepper text := repeat('p', 64);
BEGIN
  INSERT INTO auth.users(id, email) VALUES (
    v_owner, 'issue-4063-rsvp-delivery-owner@example.test'
  );
  INSERT INTO public.creator_accounts(id) VALUES (v_owner);
  INSERT INTO public.brands(id, account_id, name, slug, default_currency)
  VALUES (
    v_brand, v_owner, 'Issue 4063 RSVP Delivery',
    'issue-4063-rsvp-delivery', 'USD'
  );
  INSERT INTO public.events(
    id, brand_id, created_by, title, slug, event_type, status, visibility,
    published_at, timezone, rsvp_approval_mode, rsvp_allow_plus_ones,
    rsvp_plus_ones_max
  ) VALUES
    (
      v_auto, v_brand, v_owner, 'Auto RSVP', 'issue-4063-rsvp-auto',
      'rsvp', 'scheduled', 'public', now(), 'UTC', 'auto', false, 0
    ),
    (
      v_manual, v_brand, v_owner, 'Manual RSVP', 'issue-4063-rsvp-manual',
      'rsvp', 'scheduled', 'public', now(), 'UTC', 'manual', false, 0
    );
  INSERT INTO public.event_dates(event_id, start_at, end_at, timezone, is_master)
  VALUES
    (v_auto, now() + interval '2 days', now() + interval '2 days 2 hours', 'UTC', true),
    (v_manual, now() + interval '3 days', now() + interval '3 days 2 hours', 'UTC', true);

  v_result := public.submit_event_rsvp_with_delivery(
    v_auto, NULL, 'Auto Guest', 'auto-rsvp@example.test', '+12025550651',
    'going', 0, '[]'::jsonb, v_pepper, 'US'
  );
  IF v_result->>'status' <> 'going'
     OR v_result->>'approvalStatus' <> 'approved'
     OR (
       SELECT count(*) FROM public.rsvp_notifications
        WHERE event_id = v_auto AND template_key = 'rsvp_pass'
     ) <> 1
     OR EXISTS (
       SELECT 1 FROM public.rsvp_notifications
        WHERE event_id = v_auto AND template_key = 'rsvp_acknowledgement'
     ) THEN
    RAISE EXCEPTION 'approved RSVP did not enqueue pass only: %', v_result;
  END IF;

  v_result := public.submit_event_rsvp_with_delivery(
    v_manual, NULL, 'Manual Guest', 'manual-rsvp@example.test', '+12025550652',
    'going', 0, '[]'::jsonb, v_pepper, 'US'
  );
  IF v_result->>'status' <> 'going'
     OR v_result->>'approvalStatus' <> 'pending'
     OR (
       SELECT count(*) FROM public.rsvp_notifications
        WHERE event_id = v_manual AND template_key = 'rsvp_acknowledgement'
     ) <> 1
     OR EXISTS (
       SELECT 1 FROM public.rsvp_notifications
        WHERE event_id = v_manual AND template_key = 'rsvp_pass'
     ) THEN
    RAISE EXCEPTION 'pending RSVP did not enqueue acknowledgement only: %', v_result;
  END IF;
END;
$test$;

ROLLBACK;
