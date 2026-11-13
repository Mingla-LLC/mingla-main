-- #4422 — RSVP messages: the RSVP-only switch, the pass row's event link and
-- short event links.
--
-- MINGLA-INVARIANT: I-4422-EVENT-LINK-HOST-ONLY | issue #4422 | An RSVP pass row and an event_page short link only ever point at the live public page on https://host.usemingla.com under /e/, /t/ or /exp/ (brand, then slug); usemingla.com/e/ (404), a bearer query, an expiry over 400 days and a deleted event are refused.
-- MINGLA-INVARIANT: I-4422-RSVP-SWITCH-SCOPED | issue #4422 | rsvp_messages_v2 enriches RSVP rows (date, host event link, pass reason, QR) and keeps manual promotions silent, without turning on messages_v2 for ticket, reservation or food-order messages.
--
--   both switches off: no enrichment
--   rsvp_messages_v2 on: eventStartAt, eventUrl (host), eventLastEndAt,
--   passReason going / approved / spot_opened, qrCode; messages_v2 stays off
--   manual promotion stays silent under rsvp_messages_v2
--   enqueue_rsvp_pass writes the host event link
--   mint_redirect_link('event_page'): /e/, /t/, /exp/ accepted and re-pointed
--   (same code, later expiry); bad targets, long expiry and deleted events
--   refused; resolve_claim_link redirects, then not_found once expired
--   waitlist_offer behaviour unchanged
--
-- Both #4422 migrations are re-applied first (after any older replay in the
-- shared lane database).
\set ON_ERROR_STOP on
\ir ../20280705004422_issue_4422_transactional_delivery_truth.sql
\ir ../20280705104422_issue_4422_rsvp_message_links.sql

BEGIN;

CREATE FUNCTION pg_temp.ok(p_ok boolean, p_message text) RETURNS void LANGUAGE plpgsql AS $fn$
BEGIN
  IF p_ok IS NOT TRUE THEN RAISE EXCEPTION '#4422 links FAIL: %', p_message; END IF;
END
$fn$;

DO $test$
DECLARE
  v_owner uuid := '44221000-0000-4000-8000-000000000001';
  v_brand uuid := '44221000-0000-4000-8000-000000000002';
  v_auto uuid := '44221000-0000-4000-8000-000000000003';
  v_manual uuid := '44221000-0000-4000-8000-000000000004';
  v_gone uuid := '44221000-0000-4000-8000-000000000005';
  v_rsvp_auto uuid := '44221000-0000-4000-8000-000000000011';
  v_rsvp_manual uuid := '44221000-0000-4000-8000-000000000012';
  v_current uuid := '44221000-0000-4000-8000-000000000013';
  v_waitlisted uuid := '44221000-0000-4000-8000-000000000014';
  v_payload jsonb;
  v_link jsonb;
  v_link2 jsonb;
  v_resolved jsonb;
  v_target text;
BEGIN
  INSERT INTO auth.users(id, email) VALUES (v_owner, 'issue-4422-owner@example.test');
  INSERT INTO public.creator_accounts(id, email) VALUES (v_owner, 'issue-4422-owner@example.test');
  INSERT INTO public.brands(id, account_id, name, slug, payment_provider, pricing_region,
    pricing_currency, default_currency, contact_email)
  VALUES (v_brand, v_owner, 'Issue 4422 Host', 'issue-4422-host', 'stripe', 'US', 'USD', 'USD',
    'host-4422@example.test');
  INSERT INTO public.events(id, brand_id, created_by, title, slug, event_type, status, visibility,
    timezone, currency, rsvp_capacity, rsvp_waitlist_enabled, rsvp_approval_mode, location_text, published_at)
  VALUES
    (v_auto, v_brand, v_owner, 'Auto RSVP', 'auto-rsvp-4422', 'rsvp', 'scheduled', 'public',
     'Africa/Lagos', 'USD', NULL, false, 'auto', '1 Marina', now()),
    (v_manual, v_brand, v_owner, 'Manual RSVP', 'manual-rsvp-4422', 'rsvp', 'scheduled', 'public',
     'Africa/Lagos', 'USD', 1, true, 'manual', '2 Marina', now()),
    (v_gone, v_brand, v_owner, 'Gone RSVP', 'gone-rsvp-4422', 'rsvp', 'scheduled', 'public',
     'Africa/Lagos', 'USD', NULL, false, 'auto', NULL, now());
  UPDATE public.events SET deleted_at = now() WHERE id = v_gone;
  INSERT INTO public.event_dates(event_id, start_at, end_at, timezone, is_master) VALUES
    (v_auto, '2026-11-27T18:00:00Z', '2026-11-27T22:00:00Z', 'Africa/Lagos', true),
    (v_auto, '2026-11-28T18:00:00Z', '2026-11-28T23:30:00Z', 'Africa/Lagos', false),
    (v_manual, '2026-11-29T18:00:00Z', '2026-11-29T21:00:00Z', 'Africa/Lagos', true);
  INSERT INTO public.event_rsvps(id, event_id, guest_name, guest_email, guest_phone,
    rsvp_status, approval_status, plus_count, qr_code)
  VALUES
    (v_rsvp_auto, v_auto, 'Ada Going', 'ada-4422@example.test', '+2348030000001',
     'going', 'approved', 0, 'mingla-rsvp:4422-auto'),
    (v_rsvp_manual, v_manual, 'Bola Approved', 'bola-4422@example.test', '+2348030000002',
     'going', 'approved', 0, 'mingla-rsvp:4422-manual');

  -- Both switches off: pre-#4063 payload.
  UPDATE public.issue_4063_switches SET enabled = false WHERE name IN ('messages_v2', 'rsvp_messages_v2');
  PERFORM pg_temp.ok(EXISTS (SELECT 1 FROM public.issue_4063_switches WHERE name = 'rsvp_messages_v2'),
    'the rsvp_messages_v2 switch row must exist');
  INSERT INTO public.rsvp_notifications(event_id, rsvp_id, recipient, template_key, payload, idempotency_key)
  VALUES (v_auto, v_rsvp_auto, 'ada-4422@example.test', 'rsvp_acknowledgement',
    jsonb_build_object('role', 'primary'), 'i4422-off')
  RETURNING payload INTO v_payload;
  PERFORM pg_temp.ok(NOT (v_payload ? 'eventStartAt') AND NOT (v_payload ? 'eventUrl')
    AND NOT (v_payload ? 'passReason'), 'switch off must not enrich: ' || v_payload::text);

  -- RSVP-only switch on.
  UPDATE public.issue_4063_switches SET enabled = true, changed_at = now() WHERE name = 'rsvp_messages_v2';
  PERFORM pg_temp.ok(NOT public.issue_4063_switch_on('messages_v2'), 'messages_v2 must stay off');
  INSERT INTO public.rsvp_notifications(event_id, rsvp_id, recipient, template_key, payload, idempotency_key)
  VALUES (v_auto, v_rsvp_auto, 'ada-4422@example.test', 'rsvp_pass',
    jsonb_build_object('role', 'primary'), 'i4422-on-auto')
  RETURNING payload INTO v_payload;
  PERFORM pg_temp.ok(
    v_payload->>'eventStartAt' = '2026-11-27T18:00:00+00:00'
    AND v_payload->>'eventTimezone' = 'Africa/Lagos'
    AND v_payload->>'eventUrl' = 'https://host.usemingla.com/e/issue-4422-host/auto-rsvp-4422'
    AND v_payload->>'eventLastEndAt' = '2026-11-28T23:30:00+00:00'
    AND v_payload->>'passReason' = 'going'
    AND v_payload->>'qrCode' = 'mingla-rsvp:4422-auto',
    'rsvp_messages_v2 must enrich an auto-mode pass: ' || v_payload::text);

  INSERT INTO public.rsvp_notifications(event_id, rsvp_id, recipient, template_key, payload, idempotency_key)
  VALUES (v_manual, v_rsvp_manual, 'bola-4422@example.test', 'rsvp_pass',
    jsonb_build_object('role', 'primary'), 'i4422-on-manual')
  RETURNING payload INTO v_payload;
  PERFORM pg_temp.ok(v_payload->>'passReason' = 'approved'
    AND v_payload->>'eventLastEndAt' = '2026-11-29T21:00:00+00:00',
    'a pass on a manual-mode event is the host approval: ' || v_payload::text);

  INSERT INTO public.rsvp_notifications(event_id, rsvp_id, recipient, template_key, payload, idempotency_key)
  VALUES (v_auto, v_rsvp_auto, 'ada-4422@example.test', 'rsvp_waitlist_promoted',
    jsonb_build_object('rsvp_id', v_rsvp_auto), 'i4422-on-promoted')
  RETURNING payload INTO v_payload;
  PERFORM pg_temp.ok(v_payload->>'passReason' = 'spot_opened', 'a promotion is spot_opened: ' || v_payload::text);

  -- Caller keys still win.
  INSERT INTO public.rsvp_notifications(event_id, rsvp_id, recipient, template_key, payload, idempotency_key)
  VALUES (v_auto, v_rsvp_auto, 'ada-4422@example.test', 'rsvp_pass',
    jsonb_build_object('role', 'primary', 'passReason', 'approved', 'qrCode', 'caller-qr'), 'i4422-caller')
  RETURNING payload INTO v_payload;
  PERFORM pg_temp.ok(v_payload->>'passReason' = 'approved' AND v_payload->>'qrCode' = 'caller-qr',
    'caller-owned keys must win: ' || v_payload::text);

  -- Manual promotion stays silent under the RSVP switch.
  INSERT INTO public.event_rsvps(id, event_id, guest_name, guest_email, guest_phone,
    rsvp_status, approval_status, plus_count, waitlisted_at)
  VALUES (v_waitlisted, v_manual, 'Waiting', 'wait-4422@example.test', '+2348030000003',
    'waitlisted', 'pending', 0, now() - interval '1 minute');
  UPDATE public.event_rsvps SET rsvp_status = 'not_going' WHERE id = v_rsvp_manual;
  PERFORM pg_temp.ok(EXISTS (SELECT 1 FROM public.event_rsvps WHERE id = v_waitlisted
      AND rsvp_status = 'going' AND approval_status = 'pending'),
    'the manual drain must promote to going + pending');
  PERFORM pg_temp.ok(NOT EXISTS (SELECT 1 FROM public.rsvp_notifications WHERE rsvp_id = v_waitlisted),
    'a manual promotion must stay silent under rsvp_messages_v2');

  -- enqueue_rsvp_pass writes the live host page, never usemingla.com/e/.
  INSERT INTO public.event_rsvps(id, event_id, guest_name, guest_email, guest_phone, rsvp_status,
    approval_status, plus_count, qr_code)
  VALUES (v_current, v_auto, 'Chidi Pass', 'chidi-4422@example.test', '+2348030000004', 'going',
    'approved', 0, 'mingla-rsvp:4422-enqueue');
  DELETE FROM public.rsvp_notifications WHERE rsvp_id = v_current;
  PERFORM public.enqueue_rsvp_pass(v_current, NULL);
  SELECT payload INTO v_payload FROM public.rsvp_notifications
   WHERE idempotency_key = 'rsvp_pass:' || v_current::text || ':primary';
  PERFORM pg_temp.ok(v_payload->>'deepLink' = 'https://host.usemingla.com/e/issue-4422-host/auto-rsvp-4422',
    'enqueue_rsvp_pass must write the host event link: ' || coalesce(v_payload->>'deepLink', 'null'));
  PERFORM pg_temp.ok(position('https://usemingla.com/e/' IN pg_get_functiondef(
      'public.enqueue_rsvp_pass(uuid,text)'::regprocedure)) = 0,
    'no usemingla.com/e/ link may remain in enqueue_rsvp_pass');
  PERFORM pg_temp.ok(NOT has_function_privilege('authenticated', 'public.enqueue_rsvp_pass(uuid,text)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.mint_redirect_link(text,uuid,text,timestamptz)', 'EXECUTE'),
    'enqueue and mint are service-role only');

  -- Short event links.
  v_link := public.mint_redirect_link('event_page', v_auto,
    'https://host.usemingla.com/e/issue-4422-host/auto-rsvp-4422', now() + interval '30 days');
  PERFORM pg_temp.ok(v_link->>'code' ~ '^[0-9ABCDEFGHJKMNPQRSTVWXYZ]{10}$', 'mint returns a code');
  v_resolved := public.resolve_claim_link(v_link->>'code');
  PERFORM pg_temp.ok(v_resolved->>'status' = 'redirect'
    AND v_resolved->>'url' = 'https://host.usemingla.com/e/issue-4422-host/auto-rsvp-4422',
    'the link redirects to the host page: ' || v_resolved::text);
  FOREACH v_target IN ARRAY ARRAY[
    'https://host.usemingla.com/t/issue-4422-host/auto-rsvp-4422',
    'https://host.usemingla.com/exp/issue-4422-host/auto-rsvp-4422',
    'https://host.usemingla.com/e/issue-4422-host/auto-rsvp-4422'
  ] LOOP
    v_link2 := public.mint_redirect_link('event_page', v_auto, v_target, now() + interval '60 days');
    PERFORM pg_temp.ok(v_link2->>'code' = v_link->>'code', 'one link per event: re-pointed, same code');
    PERFORM pg_temp.ok((SELECT target_url FROM public.claim_links WHERE code = v_link->>'code') = v_target,
      'the link follows the new target ' || v_target);
  END LOOP;
  PERFORM pg_temp.ok((v_link2->>'expiresAt')::timestamptz > now() + interval '59 days',
    'expiry becomes the later of the two');
  PERFORM pg_temp.ok((SELECT count(*) FROM public.claim_links WHERE subject_kind = 'event_page' AND subject_id = v_auto) = 1,
    'exactly one link row per event');

  FOREACH v_target IN ARRAY ARRAY[
    'https://usemingla.com/e/issue-4422-host/auto-rsvp-4422',
    'https://host.usemingla.com/e/issue-4422-host/auto-rsvp-4422?token=abc',
    'https://host.usemingla.com/e/issue-4422-host/auto-rsvp-4422#x',
    'https://evil.example/e/issue-4422-host/auto-rsvp-4422',
    'http://host.usemingla.com/e/issue-4422-host/auto-rsvp-4422'
  ] LOOP
    BEGIN
      PERFORM public.mint_redirect_link('event_page', v_manual, v_target, now() + interval '30 days');
      RAISE EXCEPTION 'accepted_bad_target';
    EXCEPTION
      WHEN check_violation THEN NULL;
      WHEN raise_exception THEN
        RAISE EXCEPTION '#4422 links FAIL: target must be refused: %', v_target;
    END;
  END LOOP;
  BEGIN
    PERFORM public.mint_redirect_link('event_page', v_manual,
      'https://host.usemingla.com/e/issue-4422-host/manual-rsvp-4422', now() + interval '401 days');
    RAISE EXCEPTION '#4422 links FAIL: an expiry over 400 days must be refused';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  BEGIN
    PERFORM public.mint_redirect_link('event_page', v_gone,
      'https://host.usemingla.com/e/issue-4422-host/gone-rsvp-4422', now() + interval '30 days');
    RAISE EXCEPTION '#4422 links FAIL: a deleted event must be refused';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  BEGIN
    PERFORM public.mint_redirect_link('event_page', v_auto,
      'https://host.usemingla.com/e/issue-4422-host/auto-rsvp-4422', now() - interval '1 minute');
    RAISE EXCEPTION '#4422 links FAIL: a past expiry must be refused';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  -- An event-page target is refused for any other kind, and a claim-purpose
  -- event_page row cannot exist.
  BEGIN
    INSERT INTO public.claim_links(code, purpose, subject_kind, subject_id, expires_at)
    VALUES ('ABCDEFGH23', 'claim', 'event_page', v_auto, now() + interval '1 day');
    RAISE EXCEPTION '#4422 links FAIL: a claim-purpose event_page row was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- Expired: resolve says not_found.
  UPDATE public.claim_links SET expires_at = now() - interval '1 second' WHERE code = v_link->>'code';
  v_resolved := public.resolve_claim_link(v_link->>'code');
  PERFORM pg_temp.ok(v_resolved->>'status' = 'not_found', 'an expired event link is not_found');

  -- Waitlist offers are unchanged: an unknown entry is still claim_subject_not_found.
  BEGIN
    PERFORM public.mint_redirect_link('waitlist_offer', gen_random_uuid(),
      'https://usemingla.com/checkout/x', now() + interval '1 day');
    RAISE EXCEPTION '#4422 links FAIL: waitlist branch changed';
  EXCEPTION WHEN no_data_found THEN NULL;
  END;
  BEGIN
    PERFORM public.mint_redirect_link('order', v_auto,
      'https://host.usemingla.com/e/issue-4422-host/auto-rsvp-4422', now() + interval '1 day');
    RAISE EXCEPTION '#4422 links FAIL: other kinds must still be refused';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
END
$test$;

ROLLBACK;
