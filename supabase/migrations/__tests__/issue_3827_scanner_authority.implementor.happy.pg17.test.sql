-- issue #3827 — scanner authority hotfix, implementor happy path (pg17).
-- Runs the real post-replay biz_ticket_scan function.
--
-- MINGLA-INVARIANT: I-3827-SCANNER-CURRENT-AUTHORITY | issue #3827 | current event_manager-or-higher brand authority can scan every event of that brand without an event_scanners projection; explicit event and accepted brand scanner grants remain valid.
-- MINGLA-INVARIANT: I-3827-MANUAL-ADMIT-CURRENT-AUTHORITY | issue #3827 | manual door search/admit and QR scan accept the same explicit scanners and current event_manager-or-higher brand authority.
--
-- Fails on revert: remove the effective-rank branch from biz_ticket_scan and
-- H1/H2 fail with scanner_not_authorized.

\set ON_ERROR_STOP on

BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.i3827_scan_assert(p_ok boolean, p_label text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF NOT COALESCE(p_ok, false) THEN
    RAISE EXCEPTION 'issue #3827 scanner happy FAIL: %', p_label;
  END IF;
  RAISE NOTICE 'PASS  %', p_label;
END
$$;

DO $happy$
DECLARE
  v_owner uuid := gen_random_uuid();
  v_manager uuid := gen_random_uuid();
  v_event_scanner uuid := gen_random_uuid();
  v_brand_scanner uuid := gen_random_uuid();
  v_brand uuid := gen_random_uuid();
  v_event uuid := gen_random_uuid();
  v_ticket_type uuid;
  v_issue jsonb;
  v_order uuid;
  v_qrs text[];
  v_manual_ticket uuid;
  v_result jsonb;
  v_pepper constant text := 'i3827-scanner-pepper-0123456789abcdef';
BEGIN
  INSERT INTO auth.users(id, email) VALUES
    (v_owner, 'i3827-scan-owner@example.test'),
    (v_manager, 'i3827-scan-manager@example.test'),
    (v_event_scanner, 'i3827-scan-event@example.test'),
    (v_brand_scanner, 'i3827-scan-brand@example.test');
  INSERT INTO public.creator_accounts(id) VALUES (v_owner);
  INSERT INTO public.brands(id, account_id, name, slug, payment_provider)
    VALUES (v_brand, v_owner, 'i3827 scanner hotfix',
            'i3827-scanner-' || v_brand, 'stripe');
  INSERT INTO public.events(id, brand_id, title, slug, event_type, status,
                            visibility, timezone, is_multi_date, is_recurring)
    VALUES (v_event, v_brand, 'i3827 scanner event',
            'i3827-scanner-event-' || v_event, 'event', 'draft', 'draft',
            'UTC', false, false);
  INSERT INTO public.event_dates(event_id, start_at, end_at, timezone, is_master)
    VALUES (v_event, now() - interval '1 hour', now() + interval '5 hours',
            'UTC', true);
  INSERT INTO public.ticket_types(
    event_id, name, price_cents, is_free, quantity_total, min_purchase_qty,
    available_online, available_in_person, display_order
  ) VALUES (v_event, 'Entry', 0, true, 20, 1, true, true, 0)
  RETURNING id INTO v_ticket_type;
  PERFORM set_config('mingla.publish_free_only', 'on', true);
  UPDATE public.events
     SET status = 'scheduled', visibility = 'public', published_at = now()
   WHERE id = v_event;
  PERFORM set_config('mingla.publish_free_only', '', true);

  -- These memberships arrive after the event. Neither should need a projected
  -- event_scanners row in order to use the current Host authority.
  INSERT INTO public.brand_team_members(
    brand_id, user_id, role, invited_at, accepted_at
  ) VALUES
    (v_brand, v_manager, 'event_manager', now(), now()),
    (v_brand, v_brand_scanner, 'scanner', now(), now());
  INSERT INTO public.event_scanners(event_id, user_id, permissions)
    VALUES (v_event, v_event_scanner, '{"scan":true}'::jsonb);

  v_issue := public.biz_comp_issue(
    v_owner, v_event, v_ticket_type, NULL,
    jsonb_build_array(
      jsonb_build_object('index', 0, 'name', 'Owner Guest'),
      jsonb_build_object('index', 1, 'name', 'Manager Guest'),
      jsonb_build_object('index', 2, 'name', 'Event Scanner Guest'),
      jsonb_build_object('index', 3, 'name', 'Brand Scanner Guest'),
      jsonb_build_object('index', 4, 'name', 'Manual Admit Guest')
    ), NULL, gen_random_uuid(), v_pepper
  );

  SELECT array_agg(t.qr_code ORDER BY o.buyer_name)
    INTO v_qrs
    FROM public.tickets t
    JOIN public.orders o ON o.id = t.order_id
   WHERE o.event_id = v_event
     AND o.source = 'comp'
     AND o.buyer_name <> 'Manual Admit Guest';

  SELECT t.id INTO v_manual_ticket
    FROM public.tickets t
    JOIN public.orders o ON o.id = t.order_id
   WHERE o.event_id = v_event
     AND o.source = 'comp'
     AND o.buyer_name = 'Manual Admit Guest';

  -- Simulate the production drift: the current owner and a manager added
  -- after event creation have no event_scanners projection.
  DELETE FROM public.event_scanners
   WHERE event_id = v_event AND user_id IN (v_owner, v_manager);
  PERFORM pg_temp.i3827_scan_assert(
    NOT EXISTS (
      SELECT 1 FROM public.event_scanners
       WHERE event_id = v_event AND user_id IN (v_owner, v_manager)
    ),
    'fixture has no projected scanner row for owner or manager'
  );

  v_result := public.biz_ticket_scan(
    v_event, 'issue-3827-intentionally-invalid-qr', v_owner, v_pepper
  );
  PERFORM pg_temp.i3827_scan_assert(
    v_result ->> 'result' = 'not_found'
      AND v_result -> 'ticketId' = 'null'::jsonb
      AND v_result -> 'orderId' = 'null'::jsonb,
    'H0 authorized manager gets not_found JSON for a malformed QR'
  );
  PERFORM pg_temp.i3827_scan_assert(
    NOT EXISTS (SELECT 1 FROM public.scan_events WHERE event_id = v_event),
    'H0 malformed QR writes no scan audit row'
  );

  v_result := public.biz_ticket_admit_by_id(
    v_owner, v_event, v_manual_ticket, v_pepper
  );
  PERFORM pg_temp.i3827_scan_assert(
    v_result ->> 'result' = 'success',
    'H0b current brand owner manually admits without an event_scanners row'
  );
  PERFORM pg_temp.i3827_scan_assert(
    EXISTS (
      SELECT 1 FROM public.scan_events
       WHERE ticket_id = v_manual_ticket
         AND scan_result = 'success'
         AND metadata ->> 'source' = 'manual-admit'
    ),
    'H0b manual admit records the shared scan with manual source metadata'
  );

  v_result := public.biz_ticket_scan(v_event, v_qrs[1], v_owner, v_pepper);
  PERFORM pg_temp.i3827_scan_assert(
    v_result ->> 'result' = 'success',
    'H1 current brand owner scans without an event_scanners row'
  );

  v_result := public.biz_ticket_scan(v_event, v_qrs[2], v_manager, v_pepper);
  PERFORM pg_temp.i3827_scan_assert(
    v_result ->> 'result' = 'success',
    'H2 current event manager scans without an event_scanners row'
  );

  v_result := public.biz_ticket_scan(
    v_event, v_qrs[3], v_event_scanner, v_pepper
  );
  PERFORM pg_temp.i3827_scan_assert(
    v_result ->> 'result' = 'success',
    'H3 explicit event scanner remains authorized'
  );

  v_result := public.biz_ticket_scan(
    v_event, v_qrs[4], v_brand_scanner, v_pepper
  );
  PERFORM pg_temp.i3827_scan_assert(
    v_result ->> 'result' = 'success',
    'H4 accepted brand scanner remains authorized'
  );

  PERFORM pg_temp.i3827_scan_assert(
    (SELECT count(*) FROM public.scan_events
      WHERE event_id = v_event AND scan_result = 'success') = 5,
    'each authorized path and manual admit write one successful scan audit row'
  );
END
$happy$;

ROLLBACK;
