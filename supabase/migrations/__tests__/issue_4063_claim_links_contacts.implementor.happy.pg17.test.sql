\set ON_ERROR_STOP on

BEGIN;

DO $test$
DECLARE
  v_host uuid := '40630000-0000-4000-8000-000000003001';
  v_user_a uuid := '40630000-0000-4000-8000-000000003002';
  v_user_b uuid := '40630000-0000-4000-8000-000000003003';
  v_brand uuid := '40630000-0000-4000-8000-000000003004';
  v_event uuid := '40630000-0000-4000-8000-000000003005';
  v_date uuid := '40630000-0000-4000-8000-000000003006';
  v_order uuid := '40630000-0000-4000-8000-000000003007';
  v_ticket_type uuid := '40630000-0000-4000-8000-000000003008';
  v_waitlist uuid := '40630000-0000-4000-8000-000000003009';
  v_result jsonb;
  v_resolved jsonb;
  v_code text;
  v_handoff text;
  v_challenge uuid;
  v_i integer;
BEGIN
  INSERT INTO auth.users(id, email)
  VALUES
    (v_host, 'host-4063@example.test'),
    (v_user_a, 'account-a-4063@example.test'),
    (v_user_b, 'account-b-4063@example.test');
  INSERT INTO public.creator_accounts(id) VALUES (v_host);
  INSERT INTO public.brands(
    id, account_id, name, slug, default_currency, pricing_currency,
    payment_provider
  ) VALUES (
    v_brand, v_host, 'Issue 4063 links', 'issue-4063-links',
    'USD', 'USD', 'stripe'
  );
  INSERT INTO public.events(
    id, brand_id, title, slug, event_type, status, visibility, timezone,
    currency
  ) VALUES (
    v_event, v_brand, 'Private claim subject', 'issue-4063-claim-subject',
    'event', 'scheduled', 'private', 'America/New_York', 'USD'
  );
  INSERT INTO public.event_dates(
    id, event_id, start_at, end_at, timezone, is_master
  ) VALUES (
    v_date, v_event, now() + interval '2 days', now() + interval '2 days 2 hours',
    'America/New_York', true
  );
  INSERT INTO public.ticket_types(id, event_id, name, price_cents, currency)
  VALUES (v_ticket_type, v_event, 'General', 1500, 'USD');
  INSERT INTO public.orders(
    id, event_id, event_date_id, buyer_email, buyer_name, buyer_phone_e164,
    total_cents, currency, payment_method, payment_status, source
  ) VALUES (
    v_order, v_event, v_date, 'buyer-4063@example.test', 'Private Buyer',
    '+12025553063', 1500, 'USD', 'online_card', 'paid', 'online_checkout'
  );
  INSERT INTO public.tickets(
    order_id, ticket_type_id, event_id, qr_code, status, approval_status
  ) VALUES (
    v_order, v_ticket_type, v_event, 'issue-4063-link-test-qr', 'valid', 'auto'
  );

  v_result := public.mint_claim_link('order', v_order);
  v_code := v_result->>'code';
  IF v_code !~ '^[0-9ABCDEFGHJKMNPQRSTVWXYZ]{10}$'
     OR coalesce((v_result->>'claimed')::boolean, true) IS NOT FALSE THEN
    RAISE EXCEPTION 'claim link mint returned the wrong envelope: %', v_result;
  END IF;
  IF (public.mint_claim_link('order', v_order)->>'code') <> v_code THEN
    RAISE EXCEPTION 'claim link mint did not reuse the active subject code';
  END IF;

  v_resolved := public.resolve_claim_link(lower(v_code));
  IF v_resolved->>'status' <> 'active'
     OR v_resolved->>'noun' <> 'ticket'
     OR v_resolved->>'title' <> 'Private claim subject'
     OR v_resolved->>'emailMasked' <> 'b•••@e•••.test'
     OR v_resolved->>'phoneLast4' <> '3063'
     OR v_resolved->>'preferredProof' <> 'email'
     OR v_resolved ? 'subjectId'
     OR v_resolved ? 'claimed'
     OR v_resolved::text LIKE '%buyer-4063@example.test%'
     OR v_resolved::text LIKE '%Private Buyer%'
     OR v_resolved::text LIKE '%+12025553063%' THEN
    RAISE EXCEPTION 'resolver leaked or omitted claim display data: %', v_resolved;
  END IF;

  INSERT INTO public.account_claim_contacts(
    user_id, channel, value, verified_via
  ) VALUES (
    v_user_a, 'email', 'buyer-4063@example.test', 'email_code'
  );
  v_result := public.issue_4063_claim_prefill(v_code, v_user_a);
  IF v_result->>'outcome' <> 'ok'
     OR v_result->>'firstName' <> 'Private'
     OR v_result->>'lastName' <> 'Buyer'
     OR v_result->>'phoneE164' <> '+12025553063' THEN
    RAISE EXCEPTION 'proved prefill did not return the subject fields: %', v_result;
  END IF;
  IF public.issue_4063_claim_prefill(v_code, v_user_b)->>'outcome'
     <> 'not_proven' THEN
    RAISE EXCEPTION 'unproved account received claim prefill';
  END IF;
  UPDATE public.account_claim_contacts SET revoked_at = now()
   WHERE user_id = v_user_a AND value = 'buyer-4063@example.test';

  FOR v_i IN 1..5 LOOP
    v_result := public.mint_claim_link_handoff(v_code, 'ip-a');
    IF v_result->>'outcome' <> 'ok' THEN
      RAISE EXCEPTION 'handoff % unexpectedly failed: %', v_i, v_result;
    END IF;
    IF v_i = 1 THEN v_handoff := v_result->>'code'; END IF;
  END LOOP;
  v_result := public.mint_claim_link_handoff(v_code, 'ip-a');
  IF v_result->>'outcome' <> 'rate_limited' THEN
    RAISE EXCEPTION 'sixth same-address handoff was not limited: %', v_result;
  END IF;
  IF public.mint_claim_link_handoff(v_code, 'ip-b')->>'outcome' <> 'ok' THEN
    RAISE EXCEPTION 'one address consumed another address handoff budget';
  END IF;
  v_result := public.resolve_claim_link(v_handoff);
  IF v_result->>'status' <> 'active' OR v_result->>'redirectCode' <> v_code THEN
    RAISE EXCEPTION 'handoff did not resolve to its parent once: %', v_result;
  END IF;
  IF public.resolve_claim_link(v_handoff)->>'status' <> 'not_found' THEN
    RAISE EXCEPTION 'handoff was reusable';
  END IF;

  INSERT INTO public.waitlist_entries(
    id, event_id, ticket_type_id, email, status
  ) VALUES (
    v_waitlist, v_event, v_ticket_type, 'wait-4063@example.test', 'invited'
  );
  v_result := public.mint_redirect_link(
    'waitlist_offer', v_waitlist,
    'https://host.usemingla.com/checkout/offer-4063', now() + interval '1 hour'
  );
  v_resolved := public.resolve_claim_link(v_result->>'code');
  IF v_resolved <> jsonb_build_object(
    'status', 'redirect',
    'url', 'https://host.usemingla.com/checkout/offer-4063'
  ) THEN
    RAISE EXCEPTION 'redirect link did not resolve exactly: %', v_resolved;
  END IF;
  BEGIN
    PERFORM public.mint_redirect_link(
      'waitlist_offer', v_waitlist,
      'https://host.usemingla.com/checkout/offer?token=secret',
      now() + interval '1 hour'
    );
    RAISE EXCEPTION 'redirect target accepted a bearer query';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  v_challenge := gen_random_uuid();
  v_result := public.issue_4063_begin_contact_challenge(
    v_challenge, 'claim_sign_in', 'email', NULL, v_code, NULL,
    'email-hash-good', 'send-ip'
  );
  IF v_result->>'outcome' <> 'started'
     OR v_result->>'target' <> 'buyer-4063@example.test' THEN
    RAISE EXCEPTION 'claim email challenge did not derive its target: %', v_result;
  END IF;
  v_result := public.issue_4063_settle_contact_challenge(
    v_challenge, 'email-hash-bad', false
  );
  IF v_result->>'outcome' <> 'bad_code'
     OR (v_result->>'attemptsLeft')::integer <> 4 THEN
    RAISE EXCEPTION 'bad email code did not spend one attempt: %', v_result;
  END IF;
  v_result := public.issue_4063_settle_contact_challenge(
    v_challenge, 'email-hash-good', false
  );
  IF v_result->>'outcome' <> 'ok'
     OR v_result->>'value' <> 'buyer-4063@example.test' THEN
    RAISE EXCEPTION 'correct email code did not settle challenge: %', v_result;
  END IF;
  IF public.issue_4063_settle_contact_challenge(
    v_challenge, 'email-hash-good', false
  )->>'outcome' <> 'invalid' THEN
    RAISE EXCEPTION 'settled challenge was reusable';
  END IF;

  v_challenge := gen_random_uuid();
  v_result := public.issue_4063_begin_contact_challenge(
    v_challenge, 'add_contact', 'email', v_user_a, NULL,
    'extra-4063@example.test', 'added-email-hash', 'account-ip'
  );
  IF v_result->>'outcome' <> 'started' THEN
    RAISE EXCEPTION 'extra email challenge did not begin: %', v_result;
  END IF;
  v_result := public.issue_4063_settle_contact_challenge(
    v_challenge, 'added-email-hash', false
  );
  IF v_result->>'outcome' <> 'ok' THEN
    RAISE EXCEPTION 'extra email challenge did not settle: %', v_result;
  END IF;
  v_result := public.issue_4063_record_claim_contact(
    v_user_a, 'email', v_result->>'value'
  );
  IF v_result->>'result' <> 'recorded'
     OR NOT public.account_owns_contact(
       v_user_a, 'extra-4063@example.test', NULL
     ) THEN
    RAISE EXCEPTION 'settled extra email was not recorded: %', v_result;
  END IF;
  IF public.issue_4063_record_claim_contact(
    v_user_a, 'email', 'extra-4063@example.test'
  )->>'result' <> 'already_on_this_account' THEN
    RAISE EXCEPTION 'recorded extra email was not idempotent';
  END IF;

  PERFORM set_config('request.jwt.claim.sub', v_user_a::text, true);
  IF NOT EXISTS (
    SELECT 1 FROM public.pg_my_claim_identifiers() i
     WHERE i.kind = 'email' AND i.value = 'extra-4063@example.test'
       AND i.source = 'added'
  ) THEN
    RAISE EXCEPTION 'proved extra email was absent from my identifiers';
  END IF;

  v_result := public.issue_4063_record_claim_contact(
    v_user_b, 'email', 'extra-4063@example.test'
  );
  IF v_result->>'result' <> 'recorded'
     OR public.account_owns_contact(v_user_a, 'extra-4063@example.test', NULL)
     OR NOT public.account_owns_contact(v_user_b, 'extra-4063@example.test', NULL) THEN
    RAISE EXCEPTION 'most-recent extra proof did not move cleanly: %', v_result;
  END IF;

  INSERT INTO public.verified_phone_identities(user_id, phone_e164)
  VALUES (v_user_a, '+12025553999');
  IF public.issue_4063_record_claim_contact(
    v_user_b, 'phone', '+12025553999'
  )->>'result' <> 'already_other_account' THEN
    RAISE EXCEPTION 'primary phone proof was movable as an extra contact';
  END IF;

  IF has_table_privilege('anon', 'public.claim_links', 'SELECT')
     OR has_table_privilege('authenticated', 'public.claim_links', 'SELECT')
     OR has_table_privilege('anon', 'public.contact_challenges', 'SELECT')
     OR has_table_privilege('authenticated', 'public.contact_challenges', 'SELECT')
     OR has_function_privilege(
       'anon', 'public.resolve_claim_link(text)', 'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'claim internals are reachable outside service role';
  END IF;
  IF NOT has_function_privilege(
    'authenticated', 'public.pg_my_claim_identifiers()', 'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'authenticated users cannot read their proved identifiers';
  END IF;

  IF public.issue_4063_revoke_claim_links('order', v_order) < 1
     OR public.resolve_claim_link(v_code)->>'status' <> 'not_found'
     OR EXISTS (
       SELECT 1 FROM public.orders o
        WHERE o.id = v_order AND o.buyer_user_id IS NOT NULL
     ) THEN
    RAISE EXCEPTION 'link revocation changed ownership or left the link live';
  END IF;
END;
$test$;

ROLLBACK;
