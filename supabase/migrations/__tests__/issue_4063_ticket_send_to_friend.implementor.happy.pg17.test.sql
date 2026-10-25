-- Issue #4063 Wave 5 / M8 — ticket send-to-friend ownership transfer.
--
-- MINGLA-INVARIANT: I-4063-TICKET-TRANSFER-CLAIM | issue #4063 | an offered extra ticket moves only to an account that proved the offered contact, rotates its QR atomically, and leaves the buyer's RLS view

\set ON_ERROR_STOP on
BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.i4063_send_assert(p_ok boolean, p_label text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF NOT coalesce(p_ok, false) THEN
    RAISE EXCEPTION 'issue #4063 ticket send FAIL: %', p_label;
  END IF;
  RAISE NOTICE 'PASS %', p_label;
END $$;

DO $test$
DECLARE
  v_host uuid := '40630000-0000-4000-8000-000000008001';
  v_buyer uuid := '40630000-0000-4000-8000-000000008002';
  v_friend uuid := '40630000-0000-4000-8000-000000008003';
  v_other uuid := '40630000-0000-4000-8000-000000008004';
  v_scanner uuid := '40630000-0000-4000-8000-000000008005';
  v_brand uuid := '40630000-0000-4000-8000-000000008010';
  v_event uuid := '40630000-0000-4000-8000-000000008020';
  v_date uuid := '40630000-0000-4000-8000-000000008021';
  v_tier uuid := '40630000-0000-4000-8000-000000008022';
  v_order uuid := '40630000-0000-4000-8000-000000008030';
  v_first uuid := '40630000-0000-4000-8000-000000008031';
  v_extra uuid := '40630000-0000-4000-8000-000000008032';
  v_pepper text := 'issue-4063-ticket-transfer-pepper-0123456789';
  v_hash text;
  v_old_qr text;
  v_new_qr text;
  v_result jsonb;
  v_code text;
  v_err text;
BEGIN
  INSERT INTO auth.users(id, email) VALUES
    (v_host, 'host-send-4063@example.test'),
    (v_buyer, 'buyer-send-4063@example.test'),
    (v_friend, 'friend-send-4063@example.test'),
    (v_other, 'other-send-4063@example.test'),
    (v_scanner, 'scanner-send-4063@example.test');
  INSERT INTO public.creator_accounts(id) VALUES (v_host);
  INSERT INTO public.brands(
    id, account_id, name, slug, default_currency, pricing_currency,
    payment_provider
  ) VALUES (
    v_brand, v_host, 'Issue 4063 Send', 'issue-4063-send',
    'USD', 'USD', 'stripe'
  );
  INSERT INTO public.events(
    id, brand_id, title, slug, event_type, status, visibility, timezone,
    currency, location_text
  ) VALUES (
    v_event, v_brand, 'Friend ticket night', 'issue-4063-send-event',
    'event', 'scheduled', 'public', 'America/New_York', 'USD', 'North Door'
  );
  INSERT INTO public.event_dates(
    id, event_id, start_at, end_at, timezone, is_master
  ) VALUES (
    v_date, v_event, now() - interval '30 minutes', now() + interval '2 hours',
    'America/New_York', true
  );
  INSERT INTO public.ticket_types(
    id, event_id, name, price_cents, currency, quantity_total, is_unlimited
  ) VALUES (v_tier, v_event, 'General', 1200, 'USD', 20, false);
  INSERT INTO public.verified_phone_identities(user_id, phone_e164)
  VALUES (v_buyer, '+12025558002');
  INSERT INTO public.orders(
    id, event_id, event_date_id, buyer_user_id, buyer_name, buyer_phone_e164,
    total_cents, currency, payment_method, payment_status, source
  ) VALUES (
    v_order, v_event, v_date, v_buyer, 'Seth Buyer', '+12025558002',
    2400, 'USD', 'online_card', 'paid', 'online_checkout'
  );
  v_hash := public.biz_ticket_checkout_token_hash('first-token', v_pepper);
  INSERT INTO public.tickets(
    id, order_id, ticket_type_id, event_id, qr_code, qr_token_hash,
    status, approval_status, created_at
  ) VALUES (
    v_first, v_order, v_tier, v_event,
    public.biz_ticket_checkout_qr_payload(v_first, v_hash, v_pepper), v_hash,
    'valid', 'auto', now() - interval '2 seconds'
  );
  v_hash := public.biz_ticket_checkout_token_hash('extra-token', v_pepper);
  v_old_qr := public.biz_ticket_checkout_qr_payload(v_extra, v_hash, v_pepper);
  INSERT INTO public.tickets(
    id, order_id, ticket_type_id, event_id, qr_code, qr_token_hash,
    status, approval_status, created_at
  ) VALUES (
    v_extra, v_order, v_tier, v_event, v_old_qr, v_hash,
    'valid', 'auto', now() - interval '1 second'
  );
  INSERT INTO public.ticket_event_dates(ticket_id, event_date_id)
  VALUES (v_first, v_date), (v_extra, v_date);
  INSERT INTO public.event_scanners(event_id, user_id)
  VALUES (v_event, v_scanner);

  PERFORM set_config('request.jwt.claim.sub', v_other::text, true);
  BEGIN
    PERFORM public.pg_ticket_offer_to_friend(
      v_extra, 'Friend', 'friend-send-4063@example.test', NULL
    );
    RAISE EXCEPTION 'non-buyer offer unexpectedly succeeded';
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM; END;
  PERFORM pg_temp.i4063_send_assert(
    v_err = 'ticket_offer_denied',
    'T5-13 a non-buyer cannot offer the ticket'
  );

  PERFORM set_config('request.jwt.claim.sub', v_buyer::text, true);
  BEGIN
    PERFORM public.pg_ticket_offer_to_friend(
      v_first, 'Friend', 'friend-send-4063@example.test', NULL
    );
    RAISE EXCEPTION 'first-ticket offer unexpectedly succeeded';
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM; END;
  PERFORM pg_temp.i4063_send_assert(
    v_err = 'ticket_offer_primary_refused',
    'T5-13 the order primary ticket cannot be offered'
  );
  BEGIN
    PERFORM public.pg_ticket_offer_to_friend(
      v_extra, 'Me', NULL, '+12025558002'
    );
    RAISE EXCEPTION 'self offer unexpectedly succeeded';
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM; END;
  PERFORM pg_temp.i4063_send_assert(
    v_err = 'ticket_offer_self',
    'T5-13 the buyer cannot send an extra ticket to their own proved contact'
  );

  v_result := public.pg_ticket_offer_to_friend(
    v_extra, 'Tolu Friend', 'friend-send-4063@example.test', NULL
  );
  SELECT code INTO v_code FROM public.claim_links
   WHERE subject_kind = 'ticket' AND subject_id = v_extra
     AND revoked_at IS NULL;
  PERFORM pg_temp.i4063_send_assert(
    v_result = jsonb_build_object('ok', true, 'state', 'offered')
      AND v_code IS NOT NULL
      AND public.resolve_claim_link(v_code)->>'preferredProof' = 'email'
      AND (SELECT transfer_state FROM public.tickets WHERE id = v_extra) = 'offered'
      AND EXISTS (
        SELECT 1 FROM public.notification_outbox
         WHERE category_key = 'buyer_ticket_sent' AND contact = 'friend-send-4063@example.test'
           AND channel = 'email' AND payload->>'sender' = 'Seth'
      ),
    'T5-14 an extra ticket offer mints a safe claim link and queues delivery'
  );

  v_result := public.pg_ticket_take_back(v_extra);
  PERFORM pg_temp.i4063_send_assert(
    v_result = jsonb_build_object('ok', true, 'state', 'none')
      AND NOT EXISTS (
        SELECT 1 FROM public.claim_links WHERE code = v_code AND revoked_at IS NULL
      )
      AND EXISTS (
        SELECT 1 FROM public.tickets WHERE id = v_extra
          AND transfer_state = 'none' AND holder_user_id IS NULL
          AND holder_name IS NULL AND holder_email IS NULL
          AND transfer_revoked_at IS NOT NULL
      ),
    'T5-16 take back before claim clears the offer and revokes its link'
  );

  v_result := public.pg_ticket_offer_to_friend(
    v_extra, 'Tolu Friend', 'friend-send-4063@example.test', NULL
  );
  SELECT code INTO v_code FROM public.claim_links
   WHERE subject_kind = 'ticket' AND subject_id = v_extra
     AND revoked_at IS NULL;
  UPDATE public.tickets SET status = 'refunded' WHERE id = v_extra;
  PERFORM pg_temp.i4063_send_assert(
    v_result = jsonb_build_object('ok', true, 'state', 'offered')
      AND NOT EXISTS (
        SELECT 1 FROM public.claim_links WHERE code = v_code AND revoked_at IS NULL
      )
      AND EXISTS (
        SELECT 1 FROM public.tickets WHERE id = v_extra
          AND status = 'refunded' AND transfer_state = 'none'
          AND holder_user_id IS NULL AND holder_name IS NULL
          AND holder_email IS NULL AND transfer_revoked_at IS NOT NULL
      ),
    'T5-16 refund automatically revokes an unclaimed ticket offer and its link'
  );
  UPDATE public.tickets SET status = 'valid' WHERE id = v_extra;

  v_result := public.pg_ticket_offer_to_friend(
    v_extra, 'Tolu Friend', 'friend-send-4063@example.test', NULL
  );
  SELECT code INTO v_code FROM public.claim_links
   WHERE subject_kind = 'ticket' AND subject_id = v_extra
     AND revoked_at IS NULL;
  PERFORM pg_temp.i4063_send_assert(
    v_result = jsonb_build_object('ok', true, 'state', 'offered')
      AND v_code IS NOT NULL,
    'T5-14 a taken-back ticket can be offered again with a fresh link'
  );

  INSERT INTO public.account_claim_contacts(
    user_id, channel, value, verified_via
  ) VALUES (
    v_friend, 'email', 'friend-send-4063@example.test', 'email_code'
  );
  PERFORM set_config('request.jwt.claim.sub', '', true);
  v_result := public.issue_4063_claim_offered_tickets(v_friend, v_pepper);
  SELECT qr_code INTO v_new_qr FROM public.tickets WHERE id = v_extra;
  PERFORM pg_temp.i4063_send_assert(
    v_result->>'count' = '1'
      AND v_result#>>'{claimed,0,kind}' = 'ticket'
      AND v_result#>>'{claimed,0,routeKind}' = 'held_ticket'
      AND v_result#>>'{claimed,0,source}' = 'transfer'
      AND v_result#>>'{claimed,0,sentByFirstName}' = 'Seth'
      AND v_new_qr IS DISTINCT FROM v_old_qr
      AND EXISTS (
        SELECT 1 FROM public.tickets WHERE id = v_extra
          AND holder_user_id = v_friend AND transfer_state = 'claimed'
          AND transfer_claimed_at IS NOT NULL
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.claim_links WHERE code = v_code AND revoked_at IS NULL
      ),
    'W5-H2 proved recipient claims the ticket, rotates QR and revokes the link'
  );

  PERFORM set_config('request.jwt.claim.sub', v_buyer::text, true);
  v_result := public.pg_ticket_take_back(v_extra);
  PERFORM pg_temp.i4063_send_assert(
    v_result = jsonb_build_object('ok', false, 'error', 'too_late'),
    'T5-15 a buyer cannot take a ticket back after it was claimed'
  );
  PERFORM pg_temp.i4063_send_assert(
    EXISTS (
      SELECT 1 FROM public.pg_my_order_ticket_states(v_order) s
       WHERE s.ticket_id = v_extra AND s.ticket_index = 2
         AND s.transfer_state = 'claimed' AND s.holder_first_name = 'Tolu'
    ),
    'T5-15 buyer summary exposes state and first name but no QR'
  );

  PERFORM set_config('request.jwt.claim.sub', v_scanner::text, true);
  v_err := NULL;
  BEGIN
    UPDATE public.tickets
       SET holder_name = 'Scanner Hijack'
     WHERE id = v_extra;
    RAISE EXCEPTION 'scanner transfer-field tamper unexpectedly succeeded';
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM; END;
  PERFORM pg_temp.i4063_send_assert(
    v_err = 'Scanners may only update check-in fields on tickets',
    'T5-16 scanner trigger cannot mutate ticket ownership fields'
  );
END;
$test$;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub',
  '40630000-0000-4000-8000-000000008002', true);
SELECT pg_temp.i4063_send_assert(
  (SELECT count(*) FROM public.tickets
    WHERE order_id = '40630000-0000-4000-8000-000000008030') = 1,
  'T5-16 buyer RLS hides the claimed ticket'
);
SELECT set_config('request.jwt.claim.sub',
  '40630000-0000-4000-8000-000000008003', true);
SELECT pg_temp.i4063_send_assert(
  (SELECT count(*) FROM public.tickets
    WHERE id = '40630000-0000-4000-8000-000000008032') = 1,
  'T5-16 recipient RLS shows the claimed ticket'
);
SELECT set_config('request.jwt.claim.sub',
  '40630000-0000-4000-8000-000000008001', true);
SELECT pg_temp.i4063_send_assert(
  (SELECT count(*) FROM public.tickets
    WHERE order_id = '40630000-0000-4000-8000-000000008030') = 2,
  'T5-16 brand owner RLS remains unchanged'
);
SELECT set_config('request.jwt.claim.sub',
  '40630000-0000-4000-8000-000000008005', true);
DO $scanner_tamper$
DECLARE
  v_err text;
  v_rows integer := 0;
BEGIN
  BEGIN
    UPDATE public.tickets
       SET holder_name = 'Scanner Hijack'
     WHERE id = '40630000-0000-4000-8000-000000008032';
    GET DIAGNOSTICS v_rows = ROW_COUNT;
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM; END;
  PERFORM pg_temp.i4063_send_assert(
    v_rows = 0 OR v_err = 'Scanners may only update check-in fields on tickets',
    'T5-16 scanner RLS cannot mutate ticket ownership fields'
  );
END;
$scanner_tamper$;
RESET ROLE;

DO $scan$
DECLARE
  v_event uuid := '40630000-0000-4000-8000-000000008020';
  v_ticket uuid := '40630000-0000-4000-8000-000000008032';
  v_scanner uuid := '40630000-0000-4000-8000-000000008005';
  v_pepper text := 'issue-4063-ticket-transfer-pepper-0123456789';
  v_old_qr text;
  v_new_qr text;
BEGIN
  v_old_qr := public.biz_ticket_checkout_qr_payload(
    v_ticket,
    public.biz_ticket_checkout_token_hash('extra-token', v_pepper),
    v_pepper
  );
  SELECT qr_code INTO v_new_qr FROM public.tickets WHERE id = v_ticket;
  PERFORM pg_temp.i4063_send_assert(
    public.biz_ticket_scan(v_event, v_old_qr, v_scanner, v_pepper)->>'result'
      = 'not_found',
    'W5-H2 the buyer old QR stops scanning after claim'
  );
  PERFORM pg_temp.i4063_send_assert(
    public.biz_ticket_scan(v_event, v_new_qr, v_scanner, v_pepper)->>'result'
      = 'success',
    'W5-H2 the recipient rotated QR scans successfully'
  );
END;
$scan$;

ROLLBACK;
