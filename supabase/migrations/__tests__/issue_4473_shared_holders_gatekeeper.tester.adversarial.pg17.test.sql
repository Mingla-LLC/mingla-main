\set ON_ERROR_STOP on
-- MINGLA-INVARIANT: I-4473-SHARED-HOLDER-NEEDS-LIVE-PROOF | issue #4473 | A purchase shows only on an account that proves its contact now; an expired claim-only contact never claims or shares; a lapsed holder keeps no access; claim-link challenges stay server-side.
--
-- Independent gatekeeper checks for #4473, beyond the implementor and the
-- first tester suite:
--   G1  an extra older than 12 months never attaches an UNOWNED purchase
--       through the ordinary identity sweep or the #4202 reconnect.
--   G2  every relation a client role can SELECT is scanned for the owner's
--       contact, name, card and note while signed in as the shared holder.
--   G3  provider-asserted email (GoTrue identity) is a proof; an unverified
--       provider email and a bare auth.users.email are not.
--   G4  the claim-link challenge writer refuses revoked, expired and
--       malformed links, rate-limits per link and per phone, and its reader
--       never answers for another account.
--   G5  the owner's share flags are invisible to every other account.
--   G6  the 5-extra limit ignores expired extras and still holds.
--   G8  a shared holder cannot cancel the owner's reservation.
--   G7  a holder whose proof lapses leaves the event group chat.

BEGIN;

-- The hosted Auth shape (identities, sessions, amr claims) inside this
-- transaction only, so account_owns_contact's provider arms are exercised.
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS email_confirmed_at timestamptz;
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS phone text;
CREATE TABLE IF NOT EXISTS auth.identities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), provider_id text,
  user_id uuid NOT NULL, identity_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  provider text NOT NULL, last_sign_in_at timestamptz,
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
CREATE TABLE IF NOT EXISTS auth.sessions (
  id uuid PRIMARY KEY, user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz DEFAULT now());
CREATE TABLE IF NOT EXISTS auth.mfa_amr_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), session_id uuid NOT NULL,
  authentication_method text NOT NULL, created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now());

CREATE FUNCTION pg_temp.as_user(p_user uuid) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', p_user::text, true);
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
END;
$$;
CREATE FUNCTION pg_temp.as_admin() RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'supabase_admin', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', '', true);
END;
$$;
CREATE FUNCTION pg_temp.shared_count(p_user uuid) RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE v jsonb;
BEGIN
  PERFORM pg_temp.as_user(p_user);
  v := public.pg_my_shared_purchases();
  PERFORM pg_temp.as_admin();
  RETURN jsonb_array_length(v);
END;
$$;
-- Every row the CURRENT role can read from one relation, as text; a relation
-- the role cannot read (or that errors for a client) counts as nothing.
CREATE FUNCTION pg_temp.relation_text(p_rel text) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE v text;
BEGIN
  EXECUTE format('SELECT coalesce(string_agg(to_jsonb(x)::text, chr(10)), '''') FROM %s x', p_rel)
    INTO v;
  RETURN v;
EXCEPTION WHEN OTHERS THEN
  RETURN '';
END;
$$;

DO $test$
DECLARE
  v_owner uuid := '44739900-0000-4000-8000-000000000001';
  v_second uuid := '44739900-0000-4000-8000-000000000002';
  v_host uuid := '44739900-0000-4000-8000-000000000003';
  v_stale uuid := '44739900-0000-4000-8000-000000000004';
  v_provider uuid := '44739900-0000-4000-8000-000000000005';
  v_unverified uuid := '44739900-0000-4000-8000-000000000006';
  v_bare uuid := '44739900-0000-4000-8000-000000000007';
  v_linker uuid := '44739900-0000-4000-8000-000000000008';
  v_brand uuid := '44739900-0000-4000-8000-000000000011';
  v_event uuid := '44739900-0000-4000-8000-000000000012';
  v_ticket_type uuid := '44739900-0000-4000-8000-000000000013';
  v_order uuid := '44739900-0000-4000-8000-000000000014';
  v_unowned uuid := '44739900-0000-4000-8000-000000000015';
  v_venue uuid := '44739900-0000-4000-8000-000000000016';
  v_reservation uuid := '44739900-0000-4000-8000-000000000017';
  v_email constant text := 'gatekeeper-buyer-4473@example.test';
  v_phone constant text := '+12025557481';
  v_unowned_email constant text := 'gatekeeper-detached-4473@example.test';
  v_code constant text := '4473GATE01';
  v_code_revoked constant text := '4473GATE02';
  v_code_expired constant text := '4473GATE03';
  v_rel record;
  v_text text;
  v_t text;
  v_result jsonb;
  v_n integer;
  v_owner_in_chat boolean;
  v_chat_before boolean;
  v_chat_after boolean;
BEGIN
  PERFORM set_config('session_replication_role', 'replica', true);
  INSERT INTO auth.users(id, email) VALUES
    (v_owner, 'gk-owner-4473@example.test'),
    (v_second, 'gk-second-4473@example.test'),
    (v_host, 'gk-host-4473@example.test'),
    (v_stale, 'gk-stale-4473@example.test'),
    (v_provider, 'gk-provider-4473@example.test'),
    (v_unverified, 'gk-unverified-4473@example.test'),
    (v_bare, v_email),
    (v_linker, 'gk-linker-4473@example.test');
  INSERT INTO public.creator_accounts(id) VALUES (v_host);
  INSERT INTO public.brands(
    id, account_id, name, slug, default_currency, pricing_currency, payment_provider
  ) VALUES (v_brand, v_host, 'Issue 4473 gatekeeper brand',
    'issue-4473-gatekeeper-brand', 'USD', 'USD', 'stripe');
  INSERT INTO public.events(
    id, brand_id, title, slug, event_type, status, visibility, timezone, currency
  ) VALUES (v_event, v_brand, 'Issue 4473 gatekeeper event',
    'issue-4473-gatekeeper-event', 'event', 'scheduled', 'private', 'UTC', 'USD');
  INSERT INTO public.ticket_types(id, event_id, name, price_cents, currency)
  VALUES (v_ticket_type, v_event, 'General', 1000, 'USD');
  INSERT INTO public.orders(
    id, event_id, buyer_user_id, buyer_name, buyer_email, buyer_phone_e164,
    total_cents, currency, payment_method, payment_status, source
  ) VALUES
    (v_order, v_event, v_owner, 'Gatekeeper Owner', v_email, v_phone, 2000,
     'USD', 'online_card', 'paid', 'online_checkout'),
    (v_unowned, v_event, NULL, 'Detached Buyer', v_unowned_email, '+12025557482', 1000,
     'USD', 'online_card', 'paid', 'online_checkout');
  INSERT INTO public.tickets(
    order_id, ticket_type_id, event_id, qr_code, status, approval_status
  ) VALUES
    (v_order, v_ticket_type, v_event, 'issue-4473-gk-qr-1', 'valid', 'auto'),
    (v_unowned, v_ticket_type, v_event, 'issue-4473-gk-qr-2', 'valid', 'auto');
  INSERT INTO public.venue_listings(id, brand_id, slug, name, lat, lng, venue_category)
  VALUES (v_venue, v_brand, 'issue4473gatekeepervenue', 'Issue 4473 GK Venue', 0, 0, 'restaurant');
  INSERT INTO public.reservations(
    id, brand_id, venue_id, reserved_for, party_size, status, guest_name,
    guest_email, guest_phone_e164, consumer_user_id, guest_notes
  ) VALUES (v_reservation, v_brand, v_venue, now() + interval '3 days', 2,
    'confirmed', 'Gatekeeper Owner', v_email, v_phone, v_owner, 'gk private note');
  INSERT INTO public.claim_links(code, purpose, subject_kind, subject_id, expires_at, revoked_at)
  VALUES
    (v_code, 'claim', 'order', v_order, now() + interval '20 days', NULL),
    (v_code_revoked, 'claim', 'order', v_unowned, now() + interval '20 days', now()),
    (v_code_expired, 'claim', 'order', v_unowned, now() - interval '1 day', NULL);
  -- Provider identities: one verified email, one unverified email.
  INSERT INTO auth.identities(user_id, provider, provider_id, identity_data) VALUES
    (v_provider, 'google', 'g-4473-1',
     jsonb_build_object('email', v_email, 'email_verified', true)),
    (v_unverified, 'google', 'g-4473-2',
     jsonb_build_object('email', v_email, 'email_verified', false));
  PERFORM set_config('session_replication_role', 'origin', true);
  UPDATE public.orders
     SET payment_card_brand = 'visa', payment_card_last4 = '4242'
   WHERE id = v_order;

  -- ── G1. An extra past its year claims nothing and shares nothing. ──────
  INSERT INTO public.account_claim_contacts(user_id, channel, value, verified_via, verified_at, last_proved_at)
  VALUES
    (v_stale, 'email', v_email, 'email_code', now() - interval '13 months', now() - interval '13 months'),
    (v_stale, 'email', v_unowned_email, 'email_code', now() - interval '13 months', now() - interval '13 months');
  IF public.account_owns_contact(v_stale, v_unowned_email, NULL) THEN
    RAISE EXCEPTION 'G1 an expired extra still proves the contact';
  END IF;
  v_result := public.claim_attendance_by_verified_identity(v_stale);
  IF EXISTS (SELECT 1 FROM public.orders WHERE id = v_unowned AND buyer_user_id IS NOT NULL) THEN
    RAISE EXCEPTION 'G1 the identity sweep attached an unowned order through an expired extra: %', v_result;
  END IF;
  v_result := public.issue_4202_reconnect_retained_orders(v_stale);
  IF EXISTS (SELECT 1 FROM public.orders WHERE id = v_unowned AND buyer_user_id IS NOT NULL) THEN
    RAISE EXCEPTION 'G1 the #4202 reconnect attached an unowned order through an expired extra: %', v_result;
  END IF;
  v_result := public.issue_4473_share_purchases_by_verified_identity(v_stale);
  IF (v_result->>'count')::integer <> 0
     OR EXISTS (SELECT 1 FROM public.purchase_shared_holders WHERE user_id = v_stale) THEN
    RAISE EXCEPTION 'G1 an expired extra produced a share: %', v_result;
  END IF;
  IF pg_temp.shared_count(v_stale) <> 0 THEN
    RAISE EXCEPTION 'G1 an expired extra reads shared purchases';
  END IF;

  -- ── G3. Provider-asserted email proves; unverified or bare email does not.
  v_result := public.issue_4473_share_purchases_by_verified_identity(v_provider);
  IF (v_result->>'count')::integer <> 2 OR pg_temp.shared_count(v_provider) <> 2 THEN
    RAISE EXCEPTION 'G3 a provider-verified email did not share: %', v_result;
  END IF;
  v_result := public.issue_4473_share_purchases_by_verified_identity(v_unverified);
  IF (v_result->>'count')::integer <> 0 OR pg_temp.shared_count(v_unverified) <> 0 THEN
    RAISE EXCEPTION 'G3 an unverified provider email shared a purchase: %', v_result;
  END IF;
  v_result := public.issue_4473_share_purchases_by_verified_identity(v_bare);
  IF (v_result->>'count')::integer <> 0 OR pg_temp.shared_count(v_bare) <> 0 THEN
    RAISE EXCEPTION 'G3 an account carrying the address but no proof shared: %', v_result;
  END IF;

  -- The second account proves the email by code and becomes a holder.
  v_result := public.issue_4063_record_claim_contact(v_second, 'email', v_email);
  IF v_result->>'result' <> 'recorded' THEN
    RAISE EXCEPTION 'setup: second account could not record the email: %', v_result;
  END IF;
  v_result := public.issue_4473_share_purchases_by_verified_identity(v_second);
  IF (v_result->>'count')::integer <> 2 THEN
    RAISE EXCEPTION 'setup: expected two shares, got %', v_result;
  END IF;

  -- ── G2. Every client-readable relation, read as the holder, carries none
  -- of the owner's contact, name, card or note. ────────────────────────────
  PERFORM pg_temp.as_user(v_second);
  -- Sanity: the scan really runs as the holder (it can read its event).
  IF position('issue 4473 gatekeeper event' IN lower(pg_temp.relation_text('public.events'))) = 0 THEN
    PERFORM pg_temp.as_admin();
    RAISE EXCEPTION 'G2 setup: the holder cannot read its own shared event';
  END IF;
  v_n := 0;
  FOR v_rel IN
    SELECT format('%I.%I', n.nspname, c.relname) AS rel
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname IN ('public')
       AND c.relkind IN ('r', 'v', 'm', 'p', 'f')
       AND has_table_privilege('authenticated', c.oid, 'SELECT')
     ORDER BY 1
  LOOP
    v_n := v_n + 1;
    v_text := lower(pg_temp.relation_text(v_rel.rel));
    FOREACH v_t IN ARRAY ARRAY[
      v_email, v_phone, 'gatekeeper owner', 'gk-owner-4473@example.test', 'issue-4473-gk-qr-2',
      'gk private note'
    ] LOOP
      IF position(v_t IN v_text) > 0 THEN
        PERFORM pg_temp.as_admin();
        RAISE EXCEPTION 'G2 the shared holder reads % through %', v_t, v_rel.rel;
      END IF;
    END LOOP;
  END LOOP;
  PERFORM pg_temp.as_admin();
  IF v_n < 50 THEN
    RAISE EXCEPTION 'G2 setup: only % client-readable relations scanned', v_n;
  END IF;
  RAISE NOTICE 'G2 scanned % client-readable relations as the shared holder', v_n;
  PERFORM pg_temp.as_user(v_second);
  v_text := lower(public.pg_my_shared_purchases()::text);
  PERFORM pg_temp.as_admin();
  FOREACH v_t IN ARRAY ARRAY[
    v_email, v_phone, 'gatekeeper owner', '4242', 'visa', '"total', 'cents', 'amount',
    'gk private note', 'fee'
  ] LOOP
    IF position(v_t IN v_text) > 0 THEN
      RAISE EXCEPTION 'G2 pg_my_shared_purchases carries %', v_t;
    END IF;
  END LOOP;

  -- ── G5. Share flags are the owner's alone. ──────────────────────────────
  PERFORM pg_temp.as_user(v_owner);
  SELECT count(*) INTO v_n FROM public.pg_my_purchase_share_flags();
  PERFORM pg_temp.as_admin();
  IF v_n <> 2 THEN
    RAISE EXCEPTION 'G5 the owner does not see its share flags (%)', v_n;
  END IF;
  FOREACH v_t IN ARRAY ARRAY[v_second::text, v_stale::text, v_bare::text, v_host::text] LOOP
    PERFORM pg_temp.as_user(v_t::uuid);
    SELECT count(*) INTO v_n FROM public.pg_my_purchase_share_flags();
    PERFORM pg_temp.as_admin();
    IF v_n <> 0 THEN
      RAISE EXCEPTION 'G5 account % sees another owner''s share flags', v_t;
    END IF;
  END LOOP;

  -- ── G4. Claim-link challenges. ──────────────────────────────────────────
  v_result := public.issue_4473_begin_claim_link_contact_challenge(
    gen_random_uuid(), v_linker, v_code_revoked, 'email', 'h', 'ip-4473');
  IF v_result->>'outcome' <> 'invalid' THEN
    RAISE EXCEPTION 'G4 a revoked link started a challenge: %', v_result;
  END IF;
  v_result := public.issue_4473_begin_claim_link_contact_challenge(
    gen_random_uuid(), v_linker, v_code_expired, 'email', 'h', 'ip-4473');
  IF v_result->>'outcome' <> 'expired' THEN
    RAISE EXCEPTION 'G4 an expired link was not refused as expired: %', v_result;
  END IF;
  v_result := public.issue_4473_begin_claim_link_contact_challenge(
    gen_random_uuid(), v_linker, 'not-a-code', 'email', 'h', 'ip-4473');
  IF v_result->>'outcome' <> 'invalid' THEN
    RAISE EXCEPTION 'G4 a malformed code was accepted: %', v_result;
  END IF;
  v_result := public.issue_4473_begin_claim_link_contact_challenge(
    gen_random_uuid(), v_linker, v_code, 'email', NULL, 'ip-4473');
  IF v_result->>'outcome' <> 'invalid'
     OR EXISTS (SELECT 1 FROM public.contact_challenges WHERE user_id = v_linker) THEN
    RAISE EXCEPTION 'G4 an email challenge started with no code hash: %', v_result;
  END IF;
  -- Per link and account: three in ten minutes, then refused.
  FOR v_n IN 1..3 LOOP
    v_result := public.issue_4473_begin_claim_link_contact_challenge(
      gen_random_uuid(), v_linker, v_code, 'email', 'hash-' || v_n, 'ip-4473-' || v_n);
    IF v_result->>'outcome' <> 'started' THEN
      RAISE EXCEPTION 'G4 setup: challenge % did not start: %', v_n, v_result;
    END IF;
  END LOOP;
  v_result := public.issue_4473_begin_claim_link_contact_challenge(
    gen_random_uuid(), v_linker, v_code, 'email', 'hash-4', 'ip-4473-4');
  IF v_result->>'outcome' <> 'rate_limited' THEN
    RAISE EXCEPTION 'G4 a fourth challenge for one link was not rate limited: %', v_result;
  END IF;
  -- Per phone: two in ten minutes across accounts, then refused.
  v_result := public.issue_4473_begin_claim_link_contact_challenge(
    gen_random_uuid(), v_host, v_code, 'phone', NULL, 'ip-4473-p1');
  IF v_result->>'outcome' <> 'started' OR v_result->>'target' <> v_phone THEN
    RAISE EXCEPTION 'G4 setup: phone challenge did not start: %', v_result;
  END IF;
  v_result := public.issue_4473_begin_claim_link_contact_challenge(
    gen_random_uuid(), v_stale, v_code, 'phone', NULL, 'ip-4473-p2');
  v_result := public.issue_4473_begin_claim_link_contact_challenge(
    gen_random_uuid(), v_provider, v_code, 'phone', NULL, 'ip-4473-p3');
  IF v_result->>'outcome' <> 'rate_limited' THEN
    RAISE EXCEPTION 'G4 a third phone challenge in ten minutes was not rate limited: %', v_result;
  END IF;
  -- The reader answers only for the account that started the challenge.
  SELECT count(*) INTO v_n FROM public.contact_challenges c
   WHERE c.purpose = 'claim_add_contact'
     AND (public.issue_4473_claim_link_challenge_for_user(c.id, v_second)->>'outcome') = 'ok';
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'G4 the challenge reader answered for another account (% rows)', v_n;
  END IF;
  SELECT count(*) INTO v_n FROM public.contact_challenges c
   WHERE c.purpose = 'claim_add_contact' AND c.user_id = v_linker
     AND (public.issue_4473_claim_link_challenge_for_user(c.id, v_linker)->>'value') = v_email;
  IF v_n <> 3 THEN
    RAISE EXCEPTION 'G4 setup: the owner of a challenge cannot read it (% rows)', v_n;
  END IF;
  -- No client role can reach either function.
  IF has_function_privilege('authenticated',
       'public.issue_4473_begin_claim_link_contact_challenge(uuid,uuid,text,text,text,text)', 'EXECUTE')
     OR has_function_privilege('anon',
       'public.issue_4473_begin_claim_link_contact_challenge(uuid,uuid,text,text,text,text)', 'EXECUTE')
     OR has_function_privilege('authenticated',
       'public.issue_4473_claim_link_challenge_for_user(uuid,uuid)', 'EXECUTE')
     OR has_function_privilege('anon',
       'public.issue_4473_claim_link_challenge_for_user(uuid,uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated',
       'public.issue_4473_sweep_lapsed_shared_holders(integer)', 'EXECUTE')
     OR has_function_privilege('authenticated',
       'public.issue_4473_backfill_shared_guest_sync()', 'EXECUTE')
     OR has_function_privilege('authenticated',
       'public.issue_4473_purchase_brand(text,uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated',
       'public.issue_4473_revoke_unproved_shares(uuid[])', 'EXECUTE') THEN
    RAISE EXCEPTION 'G4 a #4473 service function is reachable from a client role';
  END IF;

  -- ── G6. Five live extras is the limit; expired ones do not count. ───────
  FOR v_n IN 1..5 LOOP
    v_result := public.issue_4063_record_claim_contact(
      v_stale, 'email', format('gk-limit-%s-4473@example.test', v_n));
    IF v_result->>'result' <> 'recorded' THEN
      RAISE EXCEPTION 'G6 extra % refused while two expired extras exist: %', v_n, v_result;
    END IF;
  END LOOP;
  v_result := public.issue_4063_record_claim_contact(
    v_stale, 'email', 'gk-limit-6-4473@example.test');
  IF v_result->>'result' <> 'limit_reached' THEN
    RAISE EXCEPTION 'G6 a sixth live extra was not refused: %', v_result;
  END IF;

  -- ── G8. The shared holder cannot cancel the owner's reservation. ────────
  PERFORM pg_temp.as_user(v_second);
  BEGIN
    PERFORM public.pg_cancel_my_reservation(v_reservation);
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
  PERFORM pg_temp.as_admin();
  IF (SELECT status FROM public.reservations WHERE id = v_reservation) <> 'confirmed' THEN
    RAISE EXCEPTION 'G8 a shared holder cancelled the owner''s reservation';
  END IF;

  -- ── G7. A lapsed holder and the event group chat. ───────────────────────
  SELECT EXISTS (
    SELECT 1 FROM public.conversations c
      JOIN public.conversation_participants cp ON cp.conversation_id = c.id
     WHERE c.event_id = v_event AND cp.user_id = v_second)
    INTO v_chat_before;
  UPDATE public.account_claim_contacts
     SET revoked_at = now()
   WHERE user_id = v_second AND value = v_email AND revoked_at IS NULL;
  PERFORM public.issue_4473_sweep_lapsed_shared_holders(500);
  IF pg_temp.shared_count(v_second) <> 0 THEN
    RAISE EXCEPTION 'G7 a revoked holder still reads the purchase';
  END IF;
  IF EXISTS (SELECT 1 FROM public.purchase_shared_holders
              WHERE user_id = v_second AND revoked_at IS NULL) THEN
    RAISE EXCEPTION 'G7 the hourly sweep left a lapsed share live';
  END IF;
  PERFORM pg_temp.as_user(v_second);
  IF public.consumer_can_read_event_for_caller(v_event) THEN
    PERFORM pg_temp.as_admin();
    RAISE EXCEPTION 'G7 a lapsed holder still reads the private event';
  END IF;
  PERFORM pg_temp.as_admin();
  SELECT EXISTS (
    SELECT 1 FROM public.conversations c
      JOIN public.conversation_participants cp ON cp.conversation_id = c.id
     WHERE c.event_id = v_event AND cp.user_id = v_second
       AND coalesce((to_jsonb(cp)->>'left_at'), (to_jsonb(cp)->>'removed_at')) IS NULL)
    INTO v_chat_after;
  RAISE NOTICE 'G7 holder in event chat before lapse: %, after lapse and sweep: %',
    v_chat_before, v_chat_after;
  IF v_chat_after THEN
    RAISE EXCEPTION 'G7 a lapsed holder is still a member of the event chat';
  END IF;
END;
$test$;

ROLLBACK;
