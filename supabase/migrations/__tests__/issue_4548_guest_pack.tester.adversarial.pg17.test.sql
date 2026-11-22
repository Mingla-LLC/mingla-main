\set ON_ERROR_STOP on
-- #4548 Guest pack: the tester's adversarial suite (after the full migration replay).
-- A distinct angle from both implementor suites: it never sweeps for a marker. It attacks the
-- people next to a holder and the doors around the four functions.
--
-- X-ROLE     PostgREST-style SET ROLE + JWT claims: anon and authenticated cannot SELECT, INSERT,
--            UPDATE or DELETE the table; anon cannot call the guest read; authenticated with no
--            sub reads null.
-- X-EVENT    a holder of event A2 reads null on event A1 (same brand), and a holder of A1 reads
--            null on brand B's event.
-- X-RANK     scanner, marketing_manager and finance_manager of the brand, an invited-but-not-
--            accepted event_manager and a removed event_manager cannot write; an accepted
--            event_manager can. Brand B's owner can neither read (team read) nor write brand A's
--            pack, and brand A's event_manager cannot write brand B's.
-- X-ORDER    refunded only: null; refunded then re-purchased: reads; partial_refund: reads; a
--            shared holder of a refunded order: null; a ticket whose status is refunded or void:
--            null; a received ticket: reads.
-- X-RSVP     approved then denied by the host: null; approved then cancelled by the guest: null;
--            a client cannot self-approve (insert or update); a plus-one before claim: null,
--            after claim: reads, after the parent is denied: null; a plus-one cannot claim itself.
-- X-SELF     a stranger cannot make itself a holder: no order insert, no takeover of an
--            unclaimed web order, no move of the event into its own brand, no team row in another
--            brand, no shared-holder row, no ticket insert.
-- X-INPUT    biz_set_event_guest_pack refuses 6 items, extra keys, nested objects, non-string
--            fields, a 41-character label, a blank label, http, javascript:, data:, upper-case
--            HTTPS, a URL with a space or a newline, 2,049 characters and a 1,001-character
--            note; it keeps 40 / 2,048 / 1,000 boundaries; a whitespace-only note with no links
--            deletes; an injection-shaped note is stored as text. The table CHECKs refuse the
--            same shapes when written around the function.
-- X-LIFE     a soft-deleted event: holders and the team read nothing; a hard delete cascades.
-- X-CATALOG  every function that reads the table is SECURITY DEFINER, owned by the table owner,
--            pinned to an empty search_path; the table has no trigger, no rule, no publication,
--            and its event key cascades on delete.
--
-- FAILS-ON-REVERT: dropping the server-approval join or the rsvp_status/approval_status filter
-- from issue_4548_caller_holds_event fails X-RSVP; replacing the rank check with
-- biz_is_brand_member_for_read fails X-RANK; dropping event_guest_pack_items_valid's https
-- regex or key check fails X-INPUT; granting SELECT to authenticated fails X-ROLE.

CREATE OR REPLACE FUNCTION pg_temp.ok(p_ok boolean, p_label text)
RETURNS void LANGUAGE plpgsql AS $fn$
BEGIN
  IF NOT COALESCE(p_ok, false) THEN
    RAISE EXCEPTION 'issue #4548 guest pack tester FAIL: %', p_label;
  END IF;
  RAISE NOTICE 'PASS  %', p_label;
END;
$fn$;

-- Runs p_sql as p_user (NULL = anon) with PostgREST-shaped claims. Returns the jsonb a SELECT
-- yields, {"rows": n} for DML, or {"err": "<sqlstate> <message>"}.
CREATE OR REPLACE FUNCTION pg_temp.as_run(p_user uuid, p_sql text, p_dml boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql AS $fn$
DECLARE
  r jsonb;
  n bigint;
  v_state text;
  v_msg text;
BEGIN
  BEGIN
    PERFORM set_config('request.jwt.claim.sub', COALESCE(p_user::text, ''), true);
    PERFORM set_config('request.jwt.claims',
      CASE WHEN p_user IS NULL THEN json_build_object('role', 'anon')::text
           ELSE json_build_object('sub', p_user, 'role', 'authenticated')::text END, true);
    PERFORM set_config('role', CASE WHEN p_user IS NULL THEN 'anon' ELSE 'authenticated' END, true);
    IF p_dml THEN
      EXECUTE p_sql;
      GET DIAGNOSTICS n = ROW_COUNT;
      r := jsonb_build_object('rows', n);
    ELSE
      EXECUTE p_sql INTO r;
    END IF;
    PERFORM set_config('role', 'postgres', true);
    PERFORM set_config('request.jwt.claims', '', true);
    PERFORM set_config('request.jwt.claim.sub', '', true);
    RETURN r;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
    PERFORM set_config('role', 'postgres', true);
    PERFORM set_config('request.jwt.claims', '', true);
    PERFORM set_config('request.jwt.claim.sub', '', true);
    RETURN jsonb_build_object('err', v_state || ' ' || v_msg);
  END;
END;
$fn$;

BEGIN;

CREATE TEMP TABLE i4548t (k text PRIMARY KEY, id uuid);

CREATE OR REPLACE FUNCTION pg_temp.u(p_k text) RETURNS uuid LANGUAGE sql AS $fn$
  SELECT id FROM i4548t WHERE k = p_k;
$fn$;

CREATE OR REPLACE FUNCTION pg_temp.pack(p_user text, p_event text) RETURNS jsonb
LANGUAGE sql AS $fn$
  SELECT pg_temp.as_run(pg_temp.u(p_user),
    format('SELECT public.pg_my_event_guest_pack(%L::uuid)', pg_temp.u(p_event)));
$fn$;

CREATE OR REPLACE FUNCTION pg_temp.reads(p_user text, p_event text) RETURNS boolean
LANGUAGE sql AS $fn$
  SELECT (pg_temp.pack(p_user, p_event)) ->> 'note' = 'Tester door 4548';
$fn$;

CREATE OR REPLACE FUNCTION pg_temp.blind(p_user text, p_event text) RETURNS boolean
LANGUAGE sql AS $fn$
  SELECT pg_temp.pack(p_user, p_event) IS NULL
      OR pg_temp.pack(p_user, p_event) = 'null'::jsonb;
$fn$;

CREATE OR REPLACE FUNCTION pg_temp.set_as(p_user text, p_event text, p_note text, p_items jsonb)
RETURNS jsonb LANGUAGE sql AS $fn$
  SELECT pg_temp.as_run(pg_temp.u(p_user), format(
    'SELECT public.biz_set_event_guest_pack(%L::uuid, %L::text, %L::jsonb)',
    pg_temp.u(p_event), p_note, p_items));
$fn$;

CREATE OR REPLACE FUNCTION pg_temp.err(p jsonb) RETURNS text LANGUAGE sql AS $fn$
  SELECT COALESCE(p ->> 'err', '');
$fn$;

DO $fixture$
DECLARE
  v_ids text[] := ARRAY[
    'host', 'owner_b', 'brand_a', 'brand_b', 'ev_a1', 'ev_a2', 'ev_b1', 'ev_rsvp', 'ev_doomed',
    'tt_a1', 'tt_a2', 'tt_b1', 'scanner', 'marketing', 'finance', 'em', 'em_invited',
    'em_removed', 'holder_a2', 'holder_a1', 'refunded', 'repurchased', 'partial', 'sh_refund',
    'tix_refunded', 'tix_void', 'friend', 'giver', 'approved_then_denied', 'cancelled_rsvp',
    'plus', 'plus_parent', 'stranger', 'web_unclaimed', 'web_order', 'door_scanner',
    'rsvp_selfie', 'em_b'];
  i int;
BEGIN
  FOR i IN 1 .. array_length(v_ids, 1) LOOP
    INSERT INTO i4548t VALUES (v_ids[i], ('45480000-0000-4000-9000-' || lpad(i::text, 12, '0'))::uuid);
  END LOOP;
END;
$fixture$;

DO $fixture$
DECLARE
  v_people text[] := ARRAY['host', 'owner_b', 'scanner', 'marketing', 'finance', 'em',
    'em_invited', 'em_removed', 'holder_a2', 'holder_a1', 'refunded', 'repurchased', 'partial',
    'sh_refund', 'tix_refunded', 'tix_void', 'friend', 'giver', 'approved_then_denied',
    'cancelled_rsvp', 'plus', 'plus_parent', 'stranger', 'web_unclaimed', 'door_scanner',
    'rsvp_selfie', 'em_b'];
  p text;
  v_rsvp uuid;
  v_order uuid;
BEGIN
  FOREACH p IN ARRAY v_people LOOP
    INSERT INTO auth.users(id, email) VALUES (pg_temp.u(p), 'i4548t-' || p || '@example.test');
  END LOOP;
  INSERT INTO public.creator_accounts(id, email) VALUES
    (pg_temp.u('host'), 'i4548t-host@example.test'),
    (pg_temp.u('owner_b'), 'i4548t-owner_b@example.test');
  INSERT INTO public.brands(id, account_id, name, slug, payment_provider, pricing_region,
    pricing_currency, default_currency, contact_email)
  VALUES
    (pg_temp.u('brand_a'), pg_temp.u('host'), 'Issue 4548T A', 'issue-4548t-a', 'stripe', 'US',
     'USD', 'USD', 'i4548t-host@example.test'),
    (pg_temp.u('brand_b'), pg_temp.u('owner_b'), 'Issue 4548T B', 'issue-4548t-b', 'stripe',
     'US', 'USD', 'USD', 'i4548t-owner_b@example.test');
  INSERT INTO public.events(id, brand_id, created_by, title, slug, event_type, status, visibility,
    timezone, currency)
  VALUES
    (pg_temp.u('ev_a1'), pg_temp.u('brand_a'), pg_temp.u('host'), '4548T A1', 'issue-4548t-a1',
     'event', 'scheduled', 'public', 'UTC', 'USD'),
    (pg_temp.u('ev_a2'), pg_temp.u('brand_a'), pg_temp.u('host'), '4548T A2', 'issue-4548t-a2',
     'event', 'scheduled', 'public', 'UTC', 'USD'),
    (pg_temp.u('ev_b1'), pg_temp.u('brand_b'), pg_temp.u('owner_b'), '4548T B1',
     'issue-4548t-b1', 'event', 'scheduled', 'public', 'UTC', 'USD'),
    (pg_temp.u('ev_doomed'), pg_temp.u('brand_a'), pg_temp.u('host'), '4548T doomed',
     'issue-4548t-doomed', 'event', 'draft', 'public', 'UTC', 'USD');
  INSERT INTO public.events(id, brand_id, created_by, title, slug, event_type, status, visibility,
    timezone, currency, rsvp_capacity, rsvp_waitlist_enabled, rsvp_approval_mode,
    rsvp_allow_plus_ones, rsvp_plus_ones_max, rsvp_guests_can_bring, published_at)
  VALUES (pg_temp.u('ev_rsvp'), pg_temp.u('brand_a'), pg_temp.u('host'), '4548T RSVP',
    'issue-4548t-rsvp', 'rsvp', 'scheduled', 'public', 'UTC', 'USD', NULL, false, 'manual', true,
    2, true, now());
  INSERT INTO public.ticket_types(id, event_id, name, price_cents, currency) VALUES
    (pg_temp.u('tt_a1'), pg_temp.u('ev_a1'), 'General', 50, 'USD'),
    (pg_temp.u('tt_a2'), pg_temp.u('ev_a2'), 'General', 50, 'USD'),
    (pg_temp.u('tt_b1'), pg_temp.u('ev_b1'), 'General', 50, 'USD');

  -- Brand A team at every rank below and at event_manager.
  INSERT INTO public.brand_team_members(brand_id, user_id, role, invited_at, accepted_at, removed_at)
  VALUES
    (pg_temp.u('brand_a'), pg_temp.u('scanner'), 'scanner', now(), now(), NULL),
    (pg_temp.u('brand_a'), pg_temp.u('marketing'), 'marketing_manager', now(), now(), NULL),
    (pg_temp.u('brand_a'), pg_temp.u('finance'), 'finance_manager', now(), now(), NULL),
    (pg_temp.u('brand_a'), pg_temp.u('em'), 'event_manager', now(), now(), NULL),
    (pg_temp.u('brand_a'), pg_temp.u('em_invited'), 'event_manager', now(), NULL, NULL),
    (pg_temp.u('brand_a'), pg_temp.u('em_removed'), 'event_manager', now(), now(), now()),
    (pg_temp.u('brand_b'), pg_temp.u('em_b'), 'event_manager', now(), now(), NULL);

  -- An event-scoped door scanner (not a brand team member).
  INSERT INTO public.event_scanners(event_id, user_id) VALUES (pg_temp.u('ev_a1'), pg_temp.u('door_scanner'));

  -- Verified contacts so the #4063 owner rule keeps each order with its account.
  FOREACH p IN ARRAY ARRAY['holder_a2', 'holder_a1', 'refunded', 'repurchased', 'partial',
    'tix_refunded', 'tix_void', 'giver', 'web_unclaimed'] LOOP
    INSERT INTO public.account_claim_contacts(user_id, channel, value, verified_via)
    VALUES (pg_temp.u(p), 'email', 'i4548t-' || p || '@example.test', 'email_code');
  END LOOP;
  -- The shared holder proves the refunded order's contact.
  INSERT INTO public.account_claim_contacts(user_id, channel, value, verified_via)
  VALUES (pg_temp.u('sh_refund'), 'email', 'i4548t-refunded@example.test', 'email_code');

  INSERT INTO public.orders(event_id, buyer_user_id, buyer_email, buyer_phone_e164, total_cents,
    currency, payment_method, payment_status, source)
  VALUES
    (pg_temp.u('ev_a2'), pg_temp.u('holder_a2'), 'i4548t-holder_a2@example.test', '+12025559001',
     50, 'USD', 'online_card', 'paid', 'online_checkout'),
    (pg_temp.u('ev_a1'), pg_temp.u('holder_a1'), 'i4548t-holder_a1@example.test', '+12025559002',
     50, 'USD', 'online_card', 'paid', 'online_checkout'),
    (pg_temp.u('ev_a1'), pg_temp.u('repurchased'), 'i4548t-repurchased@example.test',
     '+12025559004', 50, 'USD', 'online_card', 'refunded', 'online_checkout'),
    (pg_temp.u('ev_a1'), pg_temp.u('repurchased'), 'i4548t-repurchased@example.test',
     '+12025559004', 50, 'USD', 'online_card', 'paid', 'online_checkout'),
    (pg_temp.u('ev_a1'), pg_temp.u('partial'), 'i4548t-partial@example.test', '+12025559005',
     100, 'USD', 'online_card', 'partial_refund', 'online_checkout'),
    (pg_temp.u('ev_a1'), NULL, 'i4548t-web_unclaimed@example.test', '+12025559006', 50, 'USD',
     'online_card', 'paid', 'online_checkout');
  INSERT INTO public.orders(event_id, buyer_user_id, buyer_email, buyer_phone_e164, total_cents,
    currency, payment_method, payment_status, source)
  VALUES (pg_temp.u('ev_a1'), pg_temp.u('refunded'), 'i4548t-refunded@example.test',
    '+12025559003', 50, 'USD', 'online_card', 'refunded', 'online_checkout')
  RETURNING id INTO v_order;
  INSERT INTO public.purchase_shared_holders(kind, source_id, user_id)
  VALUES ('order', v_order, pg_temp.u('sh_refund'));
  UPDATE i4548t SET id = (SELECT id FROM public.orders WHERE buyer_email = 'i4548t-web_unclaimed@example.test')
   WHERE k = 'web_order';

  -- Tickets held by accounts that bought nothing: refunded, void, and a valid one given by a friend.
  INSERT INTO public.orders(event_id, buyer_user_id, buyer_email, buyer_phone_e164, total_cents,
    currency, payment_method, payment_status, source)
  VALUES (pg_temp.u('ev_a1'), pg_temp.u('giver'), 'i4548t-giver@example.test', '+12025559007',
    150, 'USD', 'online_card', 'paid', 'online_checkout')
  RETURNING id INTO v_order;
  INSERT INTO public.tickets(order_id, ticket_type_id, event_id, qr_code, status, approval_status,
    holder_user_id)
  VALUES
    (v_order, pg_temp.u('tt_a1'), pg_temp.u('ev_a1'), 'i4548t-qr-friend', 'valid', 'auto', pg_temp.u('friend')),
    (v_order, pg_temp.u('tt_a1'), pg_temp.u('ev_a1'), 'i4548t-qr-refunded', 'refunded', 'auto', pg_temp.u('tix_refunded')),
    (v_order, pg_temp.u('tt_a1'), pg_temp.u('ev_a1'), 'i4548t-qr-void', 'void', 'auto', pg_temp.u('tix_void'));
  INSERT INTO public.tickets(order_id, ticket_type_id, event_id, qr_code, status, approval_status)
  VALUES (v_order, pg_temp.u('tt_a1'), pg_temp.u('ev_a1'), 'i4548t-qr-unheld', 'valid', 'auto');

  -- RSVPs written as the server, so the #4459 approval stamp is recorded.
  INSERT INTO public.event_rsvps(event_id, user_id, guest_name, rsvp_status, approval_status)
  VALUES (pg_temp.u('ev_rsvp'), pg_temp.u('approved_then_denied'), 'Denied later', 'going', 'approved'),
         (pg_temp.u('ev_rsvp'), pg_temp.u('cancelled_rsvp'), 'Cancels later', 'going', 'approved');
  INSERT INTO public.event_rsvps(event_id, user_id, guest_name, rsvp_status, approval_status)
  VALUES (pg_temp.u('ev_rsvp'), pg_temp.u('plus_parent'), 'Parent', 'going', 'approved')
  RETURNING id INTO v_rsvp;
  INSERT INTO public.event_rsvp_guests(rsvp_id, name, matched_user_id, claimed_at)
  VALUES (v_rsvp, 'Plus one', pg_temp.u('plus'), NULL);

  -- Every pack carries the same note; brand B's pack is the cross-brand target.
  INSERT INTO public.event_guest_packs(event_id, note, items, updated_by) VALUES
    (pg_temp.u('ev_a1'), 'Tester door 4548', '[{"label":"Map","url":"https://example.test/a1"}]', pg_temp.u('host')),
    (pg_temp.u('ev_a2'), 'Tester door 4548', '[]', pg_temp.u('host')),
    (pg_temp.u('ev_b1'), 'Tester door 4548', '[]', pg_temp.u('owner_b')),
    (pg_temp.u('ev_rsvp'), 'Tester door 4548', '[]', pg_temp.u('host')),
    (pg_temp.u('ev_doomed'), 'Tester door 4548', '[]', pg_temp.u('host'));
END;
$fixture$;

-- X-ROLE ------------------------------------------------------------------------
DO $test$
DECLARE
  v_sql text;
  v_event uuid;
  v_none boolean;
BEGIN
  FOREACH v_sql IN ARRAY ARRAY[
    'SELECT to_jsonb(count(*)) FROM public.event_guest_packs',
    'SELECT to_jsonb(p) FROM public.event_guest_packs p LIMIT 1'] LOOP
    PERFORM pg_temp.ok(pg_temp.err(pg_temp.as_run(NULL, v_sql)) LIKE '42501%',
      'X-ROLE anon is refused: ' || v_sql);
    PERFORM pg_temp.ok(pg_temp.err(pg_temp.as_run(pg_temp.u('host'), v_sql)) LIKE '42501%',
      'X-ROLE even the brand owner is refused a direct select: ' || v_sql);
  END LOOP;
  FOREACH v_sql IN ARRAY ARRAY[
    format('INSERT INTO public.event_guest_packs(event_id, note) VALUES (%L, %L)', pg_temp.u('ev_a2'), 'x'),
    format('UPDATE public.event_guest_packs SET note = %L WHERE event_id = %L', 'x', pg_temp.u('ev_a1')),
    format('DELETE FROM public.event_guest_packs WHERE event_id = %L', pg_temp.u('ev_a1'))] LOOP
    PERFORM pg_temp.ok(pg_temp.err(pg_temp.as_run(pg_temp.u('host'), v_sql, true)) LIKE '42501%',
      'X-ROLE authenticated is refused a direct write: ' || left(v_sql, 40));
    PERFORM pg_temp.ok(pg_temp.err(pg_temp.as_run(NULL, v_sql, true)) LIKE '42501%',
      'X-ROLE anon is refused a direct write: ' || left(v_sql, 40));
  END LOOP;
  PERFORM pg_temp.ok(pg_temp.err(pg_temp.as_run(NULL,
      format('SELECT public.pg_my_event_guest_pack(%L::uuid)', pg_temp.u('ev_a1')))) LIKE '42501%',
    'X-ROLE anon cannot call the guest read');
  PERFORM pg_temp.ok(pg_temp.err(pg_temp.as_run(pg_temp.u('stranger'),
      format('SELECT to_jsonb(public.event_guest_pack_exists(%L::uuid))', pg_temp.u('ev_a1')))) LIKE '42501%',
    'X-ROLE a signed-in account cannot even ask whether a pack exists');
  -- authenticated role with no subject (a malformed token) reads nothing.
  v_event := pg_temp.u('ev_a1');
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', '{"role":"authenticated"}', true);
  SET LOCAL ROLE authenticated;
  v_none := public.pg_my_event_guest_pack(v_event) IS NULL;
  RESET ROLE;
  PERFORM pg_temp.ok(v_none, 'X-ROLE authenticated with no sub reads null');
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM pg_temp.ok(pg_temp.reads('holder_a1', 'ev_a1'), 'X-ROLE control: the paid holder reads A1');
END;
$test$;

-- X-EVENT -----------------------------------------------------------------------
DO $test$
BEGIN
  PERFORM pg_temp.ok(pg_temp.reads('holder_a2', 'ev_a2'), 'X-EVENT control: the A2 holder reads A2');
  PERFORM pg_temp.ok(pg_temp.blind('holder_a2', 'ev_a1'), 'X-EVENT an A2 holder reads null on A1 (same brand)');
  PERFORM pg_temp.ok(pg_temp.blind('holder_a1', 'ev_b1'), 'X-EVENT an A1 holder reads null on brand B');
  PERFORM pg_temp.ok(pg_temp.blind('plus_parent', 'ev_a1'), 'X-EVENT an approved RSVP on one event reads null on another');
  PERFORM pg_temp.ok(pg_temp.blind('em_b', 'ev_a1'), 'X-EVENT brand B''s event manager reads null on brand A');
END;
$test$;

-- X-RANK ------------------------------------------------------------------------
DO $test$
DECLARE
  k text;
  v jsonb;
BEGIN
  FOREACH k IN ARRAY ARRAY['scanner', 'marketing', 'finance', 'em_invited', 'em_removed',
    'owner_b', 'em_b', 'holder_a1', 'stranger'] LOOP
    v := pg_temp.set_as(k, 'ev_a1', 'Overwritten by ' || k, '[]');
    PERFORM pg_temp.ok(pg_temp.err(v) LIKE '42501%not_authorized%',
      'X-RANK ' || k || ' cannot write brand A''s pack: ' || v::text);
  END LOOP;
  PERFORM pg_temp.ok((SELECT note FROM public.event_guest_packs WHERE event_id = pg_temp.u('ev_a1')) = 'Tester door 4548',
    'X-RANK the refused writes changed nothing');
  -- A refused delete-by-empty is refused too.
  PERFORM pg_temp.ok(pg_temp.err(pg_temp.set_as('finance', 'ev_a1', NULL, '[]')) LIKE '42501%',
    'X-RANK a finance manager cannot delete the pack with an empty save');
  PERFORM pg_temp.ok(pg_temp.set_as('em', 'ev_a1', 'Tester door 4548',
      '[{"label":"Map","url":"https://example.test/a1"}]') ->> 'note' = 'Tester door 4548',
    'X-RANK an accepted event manager can write');
  PERFORM pg_temp.ok(pg_temp.err(pg_temp.set_as('em', 'ev_b1', 'x', '[]')) LIKE '42501%',
    'X-RANK brand A''s event manager cannot write brand B''s pack');
  FOREACH k IN ARRAY ARRAY['owner_b', 'em_invited', 'em_removed', 'stranger', 'holder_a1'] LOOP
    PERFORM pg_temp.ok(pg_temp.err(pg_temp.as_run(pg_temp.u(k),
        format('SELECT public.biz_get_event_guest_pack(%L::uuid)', pg_temp.u('ev_a1')))) LIKE '42501%',
      'X-RANK ' || k || ' cannot use the team read');
  END LOOP;
  FOREACH k IN ARRAY ARRAY['em_invited', 'em_removed'] LOOP
    PERFORM pg_temp.ok(pg_temp.blind(k, 'ev_a1'), 'X-RANK ' || k || ' reads null through the guest read');
  END LOOP;
  PERFORM pg_temp.ok(pg_temp.reads('scanner', 'ev_a1'), 'X-RANK an accepted scanner (team) reads via the guest read');
END;
$test$;

-- X-ORDER -----------------------------------------------------------------------
DO $test$
BEGIN
  PERFORM pg_temp.ok(pg_temp.blind('refunded', 'ev_a1'), 'X-ORDER a refunded-only buyer reads null');
  PERFORM pg_temp.ok(pg_temp.reads('repurchased', 'ev_a1'), 'X-ORDER refunded then re-purchased reads');
  PERFORM pg_temp.ok(pg_temp.reads('partial', 'ev_a1'), 'X-ORDER a partially refunded order reads');
  PERFORM pg_temp.ok(pg_temp.blind('sh_refund', 'ev_a1'), 'X-ORDER a proven shared holder of a refunded order reads null');
  PERFORM pg_temp.ok(pg_temp.blind('tix_refunded', 'ev_a1'), 'X-ORDER a held ticket in status refunded reads null');
  PERFORM pg_temp.ok(pg_temp.blind('tix_void', 'ev_a1'), 'X-ORDER a held ticket in status void reads null');
  PERFORM pg_temp.ok(pg_temp.reads('friend', 'ev_a1'), 'X-ORDER a received valid ticket reads');
  PERFORM pg_temp.ok(pg_temp.blind('web_unclaimed', 'ev_a1'), 'X-ORDER an unclaimed web buyer reads null');
  -- The buyer refunds the friend's ticket: the friend loses it on the next read.
  UPDATE public.tickets SET status = 'refunded' WHERE qr_code = 'i4548t-qr-friend';
  PERFORM pg_temp.ok(pg_temp.blind('friend', 'ev_a1'), 'X-ORDER the friend reads null once that ticket is refunded');
  -- The paid order flips to refunded: its buyer loses it.
  UPDATE public.orders SET payment_status = 'refunded' WHERE buyer_user_id = pg_temp.u('holder_a2');
  PERFORM pg_temp.ok(pg_temp.blind('holder_a2', 'ev_a2'), 'X-ORDER a buyer reads null once the order is refunded');
END;
$test$;

-- X-RSVP ------------------------------------------------------------------------
DO $test$
DECLARE
  v jsonb;
BEGIN
  PERFORM pg_temp.ok(pg_temp.reads('approved_then_denied', 'ev_rsvp'), 'X-RSVP control: an approved guest reads');
  UPDATE public.event_rsvps SET approval_status = 'denied' WHERE user_id = pg_temp.u('approved_then_denied');
  PERFORM pg_temp.ok(pg_temp.blind('approved_then_denied', 'ev_rsvp'), 'X-RSVP approved then denied reads null');
  v := pg_temp.as_run(pg_temp.u('approved_then_denied'), format(
    'UPDATE public.event_rsvps SET approval_status = %L WHERE user_id = %L', 'approved',
    pg_temp.u('approved_then_denied')), true);
  PERFORM pg_temp.ok(pg_temp.err(v) LIKE '42501%' OR (v ->> 'rows') = '0',
    'X-RSVP a denied guest cannot re-approve itself: ' || v::text);
  PERFORM pg_temp.ok(pg_temp.blind('approved_then_denied', 'ev_rsvp'), 'X-RSVP still null after the attempt');

  PERFORM pg_temp.ok(pg_temp.reads('cancelled_rsvp', 'ev_rsvp'), 'X-RSVP control: the soon-cancelled guest reads');
  v := pg_temp.as_run(pg_temp.u('cancelled_rsvp'), format(
    'UPDATE public.event_rsvps SET rsvp_status = %L WHERE user_id = %L', 'not_going',
    pg_temp.u('cancelled_rsvp')), true);
  PERFORM pg_temp.ok((v ->> 'rows') = '1', 'X-RSVP the guest cancels its own RSVP: ' || v::text);
  PERFORM pg_temp.ok(pg_temp.blind('cancelled_rsvp', 'ev_rsvp'), 'X-RSVP a cancelled RSVP reads null');

  v := pg_temp.as_run(pg_temp.u('rsvp_selfie'), format(
    'INSERT INTO public.event_rsvps(event_id, user_id, guest_name, rsvp_status, approval_status) VALUES (%L, %L, %L, %L, %L)',
    pg_temp.u('ev_rsvp'), pg_temp.u('rsvp_selfie'), 'Selfie', 'going', 'approved'), true);
  PERFORM pg_temp.ok(pg_temp.err(v) LIKE '42501%', 'X-RSVP a client cannot insert itself approved: ' || v::text);
  v := pg_temp.as_run(pg_temp.u('rsvp_selfie'), format(
    'INSERT INTO public.event_rsvps(event_id, user_id, guest_name, rsvp_status, approval_status) VALUES (%L, %L, %L, %L, %L)',
    pg_temp.u('ev_rsvp'), pg_temp.u('rsvp_selfie'), 'Selfie', 'going', 'pending'), true);
  PERFORM pg_temp.ok((v ->> 'rows') = '1', 'X-RSVP a client may insert itself pending: ' || v::text);
  PERFORM pg_temp.ok(pg_temp.blind('rsvp_selfie', 'ev_rsvp'), 'X-RSVP a pending self-RSVP reads null');

  -- Plus-one: before claim, a self-claim attempt, after claim, after the parent is denied.
  PERFORM pg_temp.ok(pg_temp.blind('plus', 'ev_rsvp'), 'X-RSVP a matched plus-one before claim reads null');
  v := pg_temp.as_run(pg_temp.u('plus'), format(
    'UPDATE public.event_rsvp_guests SET claimed_at = now() WHERE matched_user_id = %L', pg_temp.u('plus')), true);
  PERFORM pg_temp.ok(pg_temp.err(v) LIKE '42501%' OR (v ->> 'rows') = '0',
    'X-RSVP a plus-one cannot claim itself: ' || v::text);
  PERFORM pg_temp.ok(pg_temp.blind('plus', 'ev_rsvp'), 'X-RSVP still null after the self-claim attempt');
  v := pg_temp.as_run(pg_temp.u('stranger'), format(
    'UPDATE public.event_rsvp_guests SET matched_user_id = %L, claimed_at = now() WHERE matched_user_id = %L',
    pg_temp.u('stranger'), pg_temp.u('plus')), true);
  PERFORM pg_temp.ok(pg_temp.err(v) LIKE '42501%' OR (v ->> 'rows') = '0',
    'X-RSVP a stranger cannot take over a plus-one: ' || v::text);
  UPDATE public.event_rsvp_guests SET claimed_at = now() WHERE matched_user_id = pg_temp.u('plus');
  PERFORM pg_temp.ok(pg_temp.reads('plus', 'ev_rsvp'), 'X-RSVP a claimed plus-one reads');
  UPDATE public.event_rsvps SET approval_status = 'denied' WHERE user_id = pg_temp.u('plus_parent');
  PERFORM pg_temp.ok(pg_temp.blind('plus', 'ev_rsvp'), 'X-RSVP the plus-one reads null once the parent is denied');
  PERFORM pg_temp.ok(pg_temp.blind('plus_parent', 'ev_rsvp'), 'X-RSVP the denied parent reads null');
END;
$test$;

-- X-SELF ------------------------------------------------------------------------
DO $test$
DECLARE
  v jsonb;
BEGIN
  v := pg_temp.as_run(pg_temp.u('stranger'), format(
    'INSERT INTO public.orders(event_id, buyer_user_id, buyer_email, buyer_phone_e164, total_cents, currency, payment_method, payment_status, source) VALUES (%L, %L, %L, %L, 50, %L, %L, %L, %L)',
    pg_temp.u('ev_a1'), pg_temp.u('stranger'), 'i4548t-stranger@example.test', '+12025559099',
    'USD', 'online_card', 'paid', 'online_checkout'), true);
  PERFORM pg_temp.ok(pg_temp.err(v) LIKE '42501%', 'X-SELF a stranger cannot insert a paid order: ' || v::text);
  v := pg_temp.as_run(pg_temp.u('stranger'), format(
    'UPDATE public.orders SET buyer_user_id = %L WHERE id = %L', pg_temp.u('stranger'), pg_temp.u('web_order')), true);
  PERFORM pg_temp.ok(pg_temp.err(v) LIKE '42501%' OR (v ->> 'rows') = '0',
    'X-SELF a stranger cannot take an unclaimed web order: ' || v::text);
  PERFORM pg_temp.ok((SELECT buyer_user_id FROM public.orders WHERE id = pg_temp.u('web_order')) IS NULL
      AND (SELECT event_id FROM public.orders WHERE id = pg_temp.u('web_order')) = pg_temp.u('ev_a1'),
    'X-SELF the web order on A1 is still unclaimed');
  v := pg_temp.as_run(pg_temp.u('owner_b'), format(
    'UPDATE public.events SET brand_id = %L WHERE id = %L', pg_temp.u('brand_b'), pg_temp.u('ev_a1')), true);
  PERFORM pg_temp.ok(pg_temp.err(v) <> '' OR (v ->> 'rows') = '0',
    'X-SELF brand B cannot move A1 into its brand: ' || v::text);
  v := pg_temp.as_run(pg_temp.u('owner_b'), format(
    'INSERT INTO public.brand_team_members(brand_id, user_id, role, invited_at, accepted_at) VALUES (%L, %L, %L, now(), now())',
    pg_temp.u('brand_a'), pg_temp.u('owner_b'), 'brand_admin'), true);
  PERFORM pg_temp.ok(pg_temp.err(v) LIKE '42501%', 'X-SELF brand B cannot join brand A''s team: ' || v::text);
  v := pg_temp.as_run(pg_temp.u('stranger'), format(
    'INSERT INTO public.purchase_shared_holders(kind, source_id, user_id) VALUES (%L, %L, %L)',
    'order', pg_temp.u('web_order'), pg_temp.u('stranger')), true);
  PERFORM pg_temp.ok(pg_temp.err(v) LIKE '42501%', 'X-SELF a stranger cannot add itself as a shared holder: ' || v::text);
  v := pg_temp.as_run(pg_temp.u('stranger'), format(
    'INSERT INTO public.tickets(order_id, ticket_type_id, event_id, qr_code, status, approval_status) VALUES (%L, %L, %L, %L, %L, %L)',
    pg_temp.u('web_order'), pg_temp.u('tt_a1'), pg_temp.u('ev_a1'), 'i4548t-qr-forged', 'valid', 'auto'), true);
  -- Refused either by the ticket trigger (the stranger cannot see the order) or by RLS.
  PERFORM pg_temp.ok(pg_temp.err(v) <> '', 'X-SELF a stranger cannot insert a ticket: ' || v::text);
  v := pg_temp.as_run(pg_temp.u('stranger'), format(
    'UPDATE public.tickets SET holder_user_id = %L WHERE qr_code = %L', pg_temp.u('stranger'), 'i4548t-qr-unheld'), true);
  PERFORM pg_temp.ok(pg_temp.err(v) LIKE '42501%' OR (v ->> 'rows') = '0',
    'X-SELF a stranger cannot make itself a ticket holder: ' || v::text);
  -- An event-scoped door scanner (not on the brand team) cannot hand itself a ticket.
  PERFORM pg_temp.ok(pg_temp.blind('door_scanner', 'ev_a1'), 'X-SELF a door scanner reads null');
  v := pg_temp.as_run(pg_temp.u('door_scanner'), format(
    'UPDATE public.tickets SET holder_user_id = %L WHERE qr_code = %L', pg_temp.u('door_scanner'), 'i4548t-qr-unheld'), true);
  PERFORM pg_temp.ok(pg_temp.err(v) <> '' OR (v ->> 'rows') = '0',
    'X-SELF a door scanner cannot make itself a ticket holder: ' || v::text);
  PERFORM pg_temp.ok(pg_temp.blind('door_scanner', 'ev_a1'), 'X-SELF the door scanner still reads null');
  PERFORM pg_temp.ok(pg_temp.blind('stranger', 'ev_a1'), 'X-SELF after every attempt the stranger still reads null');
  PERFORM pg_temp.ok(pg_temp.blind('owner_b', 'ev_a1'), 'X-SELF after every attempt brand B still reads null');
  PERFORM pg_temp.ok((SELECT brand_id FROM public.events WHERE id = pg_temp.u('ev_a1')) = pg_temp.u('brand_a'),
    'X-SELF A1 is still in brand A');
END;
$test$;

-- X-INPUT -----------------------------------------------------------------------
DO $test$
DECLARE
  v jsonb;
  bad jsonb;
  v_long text := 'https://example.test/' || repeat('a', 2048 - char_length('https://example.test/'));
BEGIN
  FOREACH bad IN ARRAY ARRAY[
    '[{"label":"1","url":"https://a.test/1"},{"label":"2","url":"https://a.test/2"},{"label":"3","url":"https://a.test/3"},{"label":"4","url":"https://a.test/4"},{"label":"5","url":"https://a.test/5"},{"label":"6","url":"https://a.test/6"}]',
    '[{"label":"Map","url":"https://a.test/m","extra":"x"}]',
    '[{"label":"Map"}]',
    '[{"label":{"nested":"x"},"url":"https://a.test/m"}]',
    '[{"label":"Map","url":{"href":"https://a.test/m"}}]',
    '[{"label":7,"url":"https://a.test/m"}]',
    '[["Map","https://a.test/m"]]',
    '["https://a.test/m"]',
    '{"label":"Map","url":"https://a.test/m"}',
    '"https://a.test/m"',
    '[{"label":"12345678901234567890123456789012345678901","url":"https://a.test/m"}]',
    '[{"label":"   ","url":"https://a.test/m"}]',
    E'[{"label":"\\t","url":"https://a.test/m"}]',
    E'[{"label":" \\n ","url":"https://a.test/m"}]',
    '[{"label":"Map","url":"http://a.test/m"}]',
    '[{"label":"Map","url":"javascript:alert(1)//a.test"}]',
    '[{"label":"Map","url":"https://javascript:alert(1)"}]',
    '[{"label":"Map","url":"data:text/html,<script>alert(1)</script>"}]',
    '[{"label":"Map","url":"HTTPS://a.test/m"}]',
    '[{"label":"Map","url":"https://a.test/with space"}]',
    '[{"label":"Map","url":"https://a.test/line\nbreak"}]',
    '[{"label":"Map","url":"https://a.test/tab\tx"}]',
    '[{"label":"Map","url":"https://nodot/m"}]',
    '[{"label":"Map","url":"https:///a.test"}]'] LOOP
    v := pg_temp.set_as('host', 'ev_a2', 'Tester door 4548', bad);
    PERFORM pg_temp.ok(pg_temp.err(v) LIKE '22023%',
      'X-INPUT refused ' || left(bad::text, 60) || ' -> ' || left(v::text, 80));
  END LOOP;
  v := pg_temp.set_as('host', 'ev_a2', 'Tester door 4548',
    jsonb_build_array(jsonb_build_object('label', 'Long', 'url', v_long || 'b')));
  PERFORM pg_temp.ok(pg_temp.err(v) LIKE '22023%', 'X-INPUT a 2,049-character link is refused');
  v := pg_temp.set_as('host', 'ev_a2', repeat('n', 1001), '[]');
  PERFORM pg_temp.ok(pg_temp.err(v) LIKE '22023%guest_pack_note_too_long%', 'X-INPUT a 1,001-character note is refused');
  PERFORM pg_temp.ok((SELECT note FROM public.event_guest_packs WHERE event_id = pg_temp.u('ev_a2')) = 'Tester door 4548',
    'X-INPUT every refused save left the stored pack untouched');

  -- Boundaries that must pass.
  v := pg_temp.set_as('host', 'ev_a2', repeat('n', 1000), jsonb_build_array(
    jsonb_build_object('label', repeat('L', 40), 'url', v_long)));
  PERFORM pg_temp.ok(char_length(v ->> 'note') = 1000
      AND char_length(v -> 'items' -> 0 ->> 'label') = 40
      AND char_length(v -> 'items' -> 0 ->> 'url') = 2048,
    'X-INPUT 1,000 / 40 / 2,048 are accepted');
  -- A note of only whitespace (spaces, tabs, line breaks) is no note: the Explorer card would
  -- render nothing while the email pointer still said a pack was waiting.
  v := pg_temp.set_as('host', 'ev_a2', E' \n\t ', '[{"label":"Map","url":"https://a.test/m"}]');
  PERFORM pg_temp.ok(v ? 'note' AND v -> 'note' = 'null'::jsonb AND jsonb_array_length(v -> 'items') = 1,
    'X-INPUT a whitespace-only note with a link stores no note: ' || v::text);
  v := pg_temp.set_as('host', 'ev_a2', E' \n\t ', NULL);
  PERFORM pg_temp.ok(v IS NULL OR v = 'null'::jsonb, 'X-INPUT a whitespace-only note and no links deletes');
  PERFORM pg_temp.ok(NOT EXISTS (SELECT 1 FROM public.event_guest_packs WHERE event_id = pg_temp.u('ev_a2')),
    'X-INPUT the row is gone');
  v := pg_temp.set_as('host', 'ev_a2', $inj$'); DROP TABLE public.event_guest_packs; --$inj$,
    '[{"label":"x\"); DROP TABLE x; --","url":"https://a.test/?q=%27%3B--"}]');
  PERFORM pg_temp.ok(v ->> 'note' = $inj$'); DROP TABLE public.event_guest_packs; --$inj$
      AND to_regclass('public.event_guest_packs') IS NOT NULL,
    'X-INPUT an injection-shaped note and label are stored as text');

  -- The table's own CHECKs hold when something writes around the function.
  BEGIN
    INSERT INTO public.event_guest_packs(event_id, note, items) VALUES (pg_temp.u('ev_doomed'), NULL, '[]')
    ON CONFLICT (event_id) DO UPDATE SET note = EXCLUDED.note, items = EXCLUDED.items;
    PERFORM pg_temp.ok(false, 'X-INPUT the table refuses an empty pack');
  EXCEPTION WHEN check_violation THEN
    PERFORM pg_temp.ok(true, 'X-INPUT the table refuses an empty pack');
  END;
  BEGIN
    UPDATE public.event_guest_packs SET items = '[{"label":"Map","url":"javascript:alert(1)"}]'
     WHERE event_id = pg_temp.u('ev_a1');
    PERFORM pg_temp.ok(false, 'X-INPUT the table refuses a javascript: link');
  EXCEPTION WHEN check_violation THEN
    PERFORM pg_temp.ok(true, 'X-INPUT the table refuses a javascript: link');
  END;
  BEGIN
    UPDATE public.event_guest_packs SET note = repeat('n', 1001) WHERE event_id = pg_temp.u('ev_a1');
    PERFORM pg_temp.ok(false, 'X-INPUT the table refuses a 1,001-character note');
  EXCEPTION WHEN check_violation THEN
    PERFORM pg_temp.ok(true, 'X-INPUT the table refuses a 1,001-character note');
  END;
  BEGIN
    UPDATE public.event_guest_packs SET note = '' WHERE event_id = pg_temp.u('ev_a1');
    PERFORM pg_temp.ok(false, 'X-INPUT the table refuses an empty-string note');
  EXCEPTION WHEN check_violation THEN
    PERFORM pg_temp.ok(true, 'X-INPUT the table refuses an empty-string note');
  END;
END;
$test$;

-- X-TRIM (retest) ---------------------------------------------------------------
-- The fix for F3: every leading/trailing whitespace character goes, including the Unicode
-- spaces; the helper is service-only and never reads the table.
DO $test$
DECLARE
  v jsonb;
  bad jsonb;
BEGIN
  PERFORM pg_temp.ok(NOT has_function_privilege('anon', 'public.issue_4548_trim(text)', 'EXECUTE')
      AND NOT has_function_privilege('authenticated', 'public.issue_4548_trim(text)', 'EXECUTE'),
    'X-TRIM the trim helper is not client callable');
  PERFORM pg_temp.ok((SELECT NOT prosecdef AND prosrc NOT ILIKE '%event_guest_packs%'
                        AND proconfig @> ARRAY['search_path=""']
                        FROM pg_proc WHERE oid = 'public.issue_4548_trim(text)'::regprocedure),
    'X-TRIM the trim helper is an invoker function with an empty search_path that never reads the table');
  FOREACH bad IN ARRAY ARRAY[
    jsonb_build_array(jsonb_build_object('label', E' ', 'url', 'https://a.test/m')),
    jsonb_build_array(jsonb_build_object('label', E'​　', 'url', 'https://a.test/m')),
    jsonb_build_array(jsonb_build_object('label', E'﻿ ', 'url', 'https://a.test/m')),
    jsonb_build_array(jsonb_build_object('label', E'Ma\np', 'url', 'https://a.test/m')),
    jsonb_build_array(jsonb_build_object('label', 'Map', 'url', E'https://a.test/x y'))] LOOP
    v := pg_temp.set_as('host', 'ev_a2', NULL, bad);
    PERFORM pg_temp.ok(pg_temp.err(v) LIKE '22023%', 'X-TRIM refused ' || bad::text || ' -> ' || left(v::text, 60));
  END LOOP;
  v := pg_temp.set_as('host', 'ev_a2', E' 　 \t\nDoor 4548\n﻿​',
    jsonb_build_array(jsonb_build_object('label', E'  Map 　', 'url', E' https://a.test/m \n')));
  PERFORM pg_temp.ok(v ->> 'note' = 'Door 4548' AND v -> 'items' -> 0 ->> 'label' = 'Map'
      AND v -> 'items' -> 0 ->> 'url' = 'https://a.test/m',
    'X-TRIM mixed ASCII and Unicode edges are trimmed from the note, label and url: ' || v::text);
  v := pg_temp.set_as('host', 'ev_a2', E'  ​\u0085', '[]');
  PERFORM pg_temp.ok(v IS NULL OR v = 'null'::jsonb, 'X-TRIM a note of only Unicode whitespace deletes the pack');
  BEGIN
    INSERT INTO public.event_guest_packs(event_id, note) VALUES (pg_temp.u('ev_a2'), E' Door');
    PERFORM pg_temp.ok(false, 'X-TRIM the table refuses an untrimmed note');
  EXCEPTION WHEN check_violation THEN
    PERFORM pg_temp.ok(true, 'X-TRIM the table refuses an untrimmed note');
  END;
END;
$test$;

-- X-LIFE ------------------------------------------------------------------------
DO $test$
BEGIN
  PERFORM pg_temp.ok(pg_temp.reads('holder_a1', 'ev_a1'), 'X-LIFE control: the holder reads before the delete');
  UPDATE public.events SET deleted_at = now() WHERE id = pg_temp.u('ev_a1');
  PERFORM pg_temp.ok(pg_temp.blind('holder_a1', 'ev_a1'), 'X-LIFE a soft-deleted event: the holder reads null');
  PERFORM pg_temp.ok(pg_temp.blind('host', 'ev_a1'), 'X-LIFE a soft-deleted event: the owner''s guest read is null');
  PERFORM pg_temp.ok(pg_temp.err(pg_temp.set_as('host', 'ev_a1', 'x', '[]')) LIKE 'P0002%',
    'X-LIFE a soft-deleted event cannot be written');
  PERFORM pg_temp.ok(pg_temp.err(pg_temp.as_run(pg_temp.u('host'),
      format('SELECT public.biz_get_event_guest_pack(%L::uuid)', pg_temp.u('ev_a1')))) LIKE 'P0002%',
    'X-LIFE a soft-deleted event cannot be read by the team');
  DELETE FROM public.events WHERE id = pg_temp.u('ev_doomed');
  PERFORM pg_temp.ok(NOT EXISTS (SELECT 1 FROM public.event_guest_packs WHERE event_id = pg_temp.u('ev_doomed')),
    'X-LIFE a hard-deleted event takes its pack with it');
END;
$test$;

-- X-CATALOG ---------------------------------------------------------------------
DO $test$
DECLARE
  v_owner oid := (SELECT relowner FROM pg_class WHERE oid = 'public.event_guest_packs'::regclass);
  r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS fn, p.prosecdef, p.proowner, p.proconfig
      FROM pg_proc p
     WHERE p.prosrc ILIKE '%event_guest_packs%'
  LOOP
    PERFORM pg_temp.ok(r.prosecdef AND r.proowner = v_owner
        AND r.proconfig @> ARRAY['search_path=""'],
      format('X-CATALOG %s is a definer owned by the table owner with an empty search_path', r.fn));
  END LOOP;
  FOR r IN
    SELECT p.oid::regprocedure AS fn, p.proconfig
      FROM pg_proc p
     WHERE p.oid IN ('public.issue_4548_caller_holds_event(uuid)'::regprocedure,
                     'public.event_guest_pack_items_valid(jsonb)'::regprocedure)
  LOOP
    PERFORM pg_temp.ok(r.proconfig @> ARRAY['search_path=""'],
      format('X-CATALOG %s pins an empty search_path', r.fn));
  END LOOP;
  PERFORM pg_temp.ok(NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.event_guest_packs'::regclass
      AND NOT tgisinternal),
    'X-CATALOG the table has no user trigger (no audit or ingest copy of the pack)');
  PERFORM pg_temp.ok(NOT EXISTS (SELECT 1 FROM pg_rewrite WHERE ev_class = 'public.event_guest_packs'::regclass
      AND rulename <> '_RETURN'), 'X-CATALOG the table has no rule');
  PERFORM pg_temp.ok(NOT EXISTS (SELECT 1 FROM pg_publication_rel WHERE prrelid = 'public.event_guest_packs'::regclass)
      AND NOT EXISTS (SELECT 1 FROM pg_publication WHERE puballtables),
    'X-CATALOG the table is in no publication (realtime cannot stream it)');
  PERFORM pg_temp.ok(EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.event_guest_packs'::regclass
      AND contype = 'f' AND confrelid = 'public.events'::regclass AND confdeltype = 'c'),
    'X-CATALOG the event key cascades on delete');
  PERFORM pg_temp.ok(NOT EXISTS (SELECT 1 FROM pg_depend d JOIN pg_rewrite w ON w.oid = d.objid
      WHERE d.refobjid = 'public.event_guest_packs'::regclass AND d.classid = 'pg_rewrite'::regclass
        AND w.ev_class <> 'public.event_guest_packs'::regclass),
    'X-CATALOG no view or materialized view in any schema depends on the table');
END;
$test$;

ROLLBACK;
