\set ON_ERROR_STOP on

-- Issue #3645 — tester RETEST 2 of "an unpublished draft with nothing sold
-- follows its brand's currency" (20270829003645). Run after the full migration
-- chain on PostgreSQL 17. Everything is rolled back.
--
-- The second rework made the draft ROW the owner of a draft's currency: the
-- app no longer moves a draft whose row is still in the old currency. So what
-- the database does with a draft it did NOT move matters more than before.
-- This suite pins the parts of that which hold, from angles the earlier
-- suites do not take:
--
--   W-1x  THE WARNING PATH. The brand moves to a currency no offering may use.
--         The brand's own update succeeds; the draft is left exactly as it was
--         (row, draft JSON, price); and Publish by the signed-in host is
--         refused, so the old number never goes on sale under the new currency.
--   K-1x  A DRAFT THE TRIGGER SKIPS (a buyer once started a checkout), old
--         currency not pounds: left exactly as it was, and Publish is refused;
--         nothing is on sale in the brand's new currency.
--   N-1x  A CLEARED TRIP PACKAGE, the two doors added this round, as the
--         signed-in host through the real draft owner:
--           * metadata replaced by JSON null with the old number: refused;
--           * the old number with EMPTY metadata from a form that read the
--             trip BEFORE the clear (it holds the older revision): refused as
--             a revision conflict, nothing stored.
--   X-1x  THE INDEX. `idx_trip_pricing_tiers_ticket_type` exists, is valid,
--         and is what the commit-time check uses to find a package by its
--         ticket type among 3,000 packages.

BEGIN;

INSERT INTO auth.users(id) VALUES ('3645d2e7-0000-4000-8000-000000000001');
INSERT INTO public.creator_accounts(id) VALUES ('3645d2e7-0000-4000-8000-000000000001');

CREATE FUNCTION pg_temp.as_host() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '3645d2e7-0000-4000-8000-000000000001', true);
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', '3645d2e7-0000-4000-8000-000000000001', 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
END $$;

-- A brand that can take money in p_currency, with the organiser terms
-- accepted, so a paid Publish is refused for no other reason. p_stripe: through
-- a connected Stripe account; otherwise through a payout account code alone, so
-- the brand's own currency column is the only currency the brand has.
CREATE FUNCTION pg_temp.brand(p_id uuid, p_currency text, p_stripe boolean) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.brands(id, account_id, name, slug, default_currency)
  VALUES (p_id, '3645d2e7-0000-4000-8000-000000000001', 'RT2 ' || p_id, 'rt2-' || p_id, p_currency);
  IF p_stripe THEN
    INSERT INTO public.stripe_connect_accounts(brand_id, stripe_account_id, charges_enabled, default_currency, country)
    VALUES (p_id, 'acct_rt2_' || replace(p_id::text, '-', ''), true, p_currency, 'GB');
  ELSE
    UPDATE public.brands SET paystack_subaccount_code = 'ACCT_rt2_w' WHERE id = p_id;
  END IF;
  UPDATE public.brand_team_members
     SET mingla_tos_version_accepted = '1.0', mingla_tos_accepted_at = now()
   WHERE brand_id = p_id AND user_id = '3645d2e7-0000-4000-8000-000000000001';
END $$;

-- What the wizard sends for a draft with one paid online ticket at 50.
CREATE FUNCTION pg_temp.payload(p_currency text) RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object('title', 'RT2 paid', 'timezone', 'UTC', 'currency', p_currency,
    'theme', jsonb_build_object('business_draft', jsonb_build_object(
      'currency', p_currency,
      'tickets', jsonb_build_array(jsonb_build_object('id', 't_paid', 'name', 'General',
        'isFree', false, 'priceGbp', 50, 'capacity', 10, 'availableAt', 'online',
        'currency', p_currency)),
      'city', 'London', 'partyTypes', jsonb_build_array('club-night'),
      'requestedVisibility', 'public', 'whenMode', 'single',
      'when', jsonb_build_object('date', to_char(now() + interval '10 days', 'YYYY-MM-DD'),
        'doorsOpen', '20:00', 'endsAt', '23:00'))))
$$;

CREATE FUNCTION pg_temp.draft(p_id uuid, p_brand uuid) RETURNS void LANGUAGE sql AS $$
  INSERT INTO public.events(id, brand_id, created_by, title, slug, event_type, status, visibility, timezone)
  VALUES (p_id, p_brand, '3645d2e7-0000-4000-8000-000000000001', 'RT2 draft',
    'draft-rt2-' || p_id, 'event', 'draft', 'draft', 'UTC')
$$;

CREATE FUNCTION pg_temp.revision(p_event uuid) RETURNS integer LANGUAGE sql AS $$
  SELECT COALESCE((theme#>>'{business_draft,clientRevision}')::integer, 0)
    FROM public.events WHERE id = p_event
$$;

-- ─── W-1x  the WARNING path ──────────────────────────────────────────────────
DO $warning$
DECLARE
  v_brand uuid := '3645d2e7-0000-4000-8000-0000000000a0';
  v_event uuid := '3645d2e7-0000-4000-8000-0000000000a1';
  v_before record;
  v_after record;
  v_refused text := NULL;
BEGIN
  PERFORM pg_temp.brand(v_brand, 'GBP', false);
  PERFORM pg_temp.draft(v_event, v_brand);
  PERFORM pg_temp.as_host();
  SET LOCAL ROLE authenticated;
  PERFORM public.business_update_event_draft(v_event, pg_temp.payload('GBP'), 1);
  RESET ROLE;
  SELECT currency, theme INTO v_before FROM public.events WHERE id = v_event;
  IF v_before.currency IS DISTINCT FROM 'GBP' THEN
    RAISE EXCEPTION 'W-10 fixture: the draft row is in %, expected GBP', v_before.currency;
  END IF;

  -- A currency no offering may be sold in, arriving the way a payout-country
  -- change does (the currency is cleared, then set). The brand's update must
  -- succeed.
  UPDATE public.brands SET default_currency = NULL WHERE id = v_brand;
  UPDATE public.brands SET default_currency = 'JPY' WHERE id = v_brand;
  IF (SELECT default_currency FROM public.brands WHERE id = v_brand) IS DISTINCT FROM 'JPY' THEN
    RAISE EXCEPTION 'W-11 a draft that could not be moved blocked the brand''s own update';
  END IF;

  -- The draft is exactly as it was: not half moved, no price cleared, no note.
  SELECT currency, theme INTO v_after FROM public.events WHERE id = v_event;
  IF v_after.currency IS DISTINCT FROM v_before.currency OR v_after.theme IS DISTINCT FROM v_before.theme THEN
    RAISE EXCEPTION 'W-12 a draft that could not be moved was changed: % / %', v_after.currency, v_after.theme;
  END IF;

  -- The app follows the row (pounds, 50). Publish must not put 50 on sale in
  -- the brand's new currency.
  PERFORM pg_temp.as_host();
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.business_publish_event_draft(v_event, pg_temp.payload('GBP'), 2);
  EXCEPTION WHEN OTHERS THEN
    v_refused := SQLERRM;
  END;
  RESET ROLE;
  IF v_refused IS NULL THEN
    RAISE EXCEPTION 'W-13 a draft left in GBP on a JPY brand was published: status=% currency=% tickets=%',
      (SELECT status FROM public.events WHERE id = v_event),
      (SELECT currency FROM public.events WHERE id = v_event),
      (SELECT jsonb_agg(jsonb_build_object('p', price_cents, 'c', currency))
         FROM public.ticket_types WHERE event_id = v_event AND deleted_at IS NULL);
  END IF;
  IF (SELECT status FROM public.events WHERE id = v_event) IS DISTINCT FROM 'draft'
     OR EXISTS (SELECT 1 FROM public.ticket_types WHERE event_id = v_event AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'W-14 the refused publish left something behind';
  END IF;
END
$warning$;

-- ─── K-1x  a draft the trigger skips, old currency not pounds ────────────────
DO $skipped$
DECLARE
  v_brand uuid := '3645d2e7-0000-4000-8000-0000000000b0';
  v_event uuid := '3645d2e7-0000-4000-8000-0000000000b1';
  v_before record;
  v_after record;
  v_refused text := NULL;
BEGIN
  PERFORM pg_temp.brand(v_brand, 'USD', true);
  PERFORM pg_temp.draft(v_event, v_brand);
  PERFORM pg_temp.as_host();
  SET LOCAL ROLE authenticated;
  PERFORM public.business_update_event_draft(v_event, pg_temp.payload('USD'), 1);
  -- It goes on sale, a buyer starts a checkout and leaves, the host takes it
  -- back to draft. All through the real owners.
  PERFORM public.business_publish_event_draft(v_event, pg_temp.payload('USD'), 2);
  RESET ROLE;
  IF (SELECT status FROM public.events WHERE id = v_event) IS DISTINCT FROM 'scheduled' THEN
    RAISE EXCEPTION 'K-10 fixture: the event did not publish';
  END IF;
  INSERT INTO public.ticket_checkout_sessions(event_id, brand_id, buyer_name, buyer_email,
    buyer_phone_e164, idempotency_key, expires_at)
  VALUES (v_event, v_brand, 'Buyer', 'buyer@example.com', '+447700900001',
    'rt2-session-b1', now() + interval '1 hour');
  PERFORM pg_temp.as_host();
  SET LOCAL ROLE authenticated;
  PERFORM public.business_unpublish_event_to_draft(v_event);
  RESET ROLE;
  SELECT status, published_at, currency, theme INTO v_before FROM public.events WHERE id = v_event;
  IF v_before.status IS DISTINCT FROM 'draft' OR v_before.published_at IS NOT NULL
     OR v_before.currency IS DISTINCT FROM 'USD' THEN
    RAISE EXCEPTION 'K-11 fixture: expected a USD draft with no published_at, got % / % / %',
      v_before.status, v_before.published_at, v_before.currency;
  END IF;

  -- The brand moves to Nigeria.
  UPDATE public.stripe_connect_accounts SET detached_at = now() WHERE brand_id = v_brand;
  UPDATE public.brands
     SET default_currency = 'NGN', payment_provider = 'paystack', payment_country = 'NG',
         paystack_subaccount_code = 'ACCT_rt2_b'
   WHERE id = v_brand;

  -- A checkout was started on it, so the trigger leaves it alone: all of it.
  SELECT currency, theme INTO v_after FROM public.events WHERE id = v_event;
  IF v_after.currency IS DISTINCT FROM 'USD' OR v_after.theme IS DISTINCT FROM v_before.theme THEN
    RAISE EXCEPTION 'K-12 a draft with a checkout session was changed: % / %', v_after.currency, v_after.theme;
  END IF;

  -- The app follows the row (dollars, 50) and the host presses Publish.
  PERFORM pg_temp.as_host();
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.business_publish_event_draft(v_event, pg_temp.payload('USD'),
      pg_temp.revision(v_event) + 1);
  EXCEPTION WHEN OTHERS THEN
    v_refused := SQLERRM;
  END;
  RESET ROLE;
  -- Whatever the answer, 50 dollars must not be on sale as 50 naira.
  IF EXISTS (SELECT 1 FROM public.ticket_types tt
              WHERE tt.event_id = v_event AND tt.deleted_at IS NULL
                AND tt.price_cents = 5000 AND tt.currency = 'NGN')
     AND (SELECT status FROM public.events WHERE id = v_event) <> 'draft' THEN
    RAISE EXCEPTION 'K-13 a skipped USD draft went on sale at the old number in NGN';
  END IF;
  IF v_refused IS NULL THEN
    RAISE EXCEPTION 'K-14 a skipped USD draft published on an NGN brand: currency=%',
      (SELECT currency FROM public.events WHERE id = v_event);
  END IF;
END
$skipped$;

-- ─── N-1x  a cleared trip package: JSON null, and a form older than the clear ─
DO $package$
DECLARE
  v_brand uuid := '3645d2e7-0000-4000-8000-0000000000c0';
  g jsonb;
  v_event uuid;
  v_tier uuid;
  v_stale_revision timestamptz;
  v_out text;
  v_state record;
BEGIN
  INSERT INTO public.brands(id, account_id, name, slug, default_currency, payment_provider,
    payment_country, paystack_subaccount_code)
  VALUES (v_brand, '3645d2e7-0000-4000-8000-000000000001', 'RT2 trips', 'rt2-trips', 'NGN',
    'paystack', 'NG', 'ACCT_rt2_c');
  PERFORM pg_temp.as_host();
  g := public.biz_create_trip_draft(v_brand, jsonb_build_object('title', 'Untitled trip'), gen_random_uuid());
  v_event := (g#>>'{event,id}')::uuid;
  v_tier := (g#>>'{tiers,0,ticket_type_id}')::uuid;
  PERFORM public.biz_apply_trip_draft_graph(v_event,
    jsonb_build_object('tiers', jsonb_build_array(jsonb_build_object(
      'ticket_type_id', v_tier, 'tier_name', 'Standard', 'price_cents', 4500000,
      'capacity', 12, 'tier_metadata', '{}'::jsonb))),
    (SELECT updated_at FROM public.events WHERE id = v_event), gen_random_uuid());
  -- What a pricing form opened NOW holds: this revision, this (empty) metadata.
  SELECT updated_at INTO v_stale_revision FROM public.events WHERE id = v_event;

  -- Later (a later transaction in real life), the brand leaves Nigeria.
  UPDATE public.events SET updated_at = updated_at - interval '1 minute' WHERE id = v_event;
  v_stale_revision := v_stale_revision - interval '1 minute';
  UPDATE public.brands SET default_currency = 'GBP', payment_provider = 'stripe' WHERE id = v_brand;
  SELECT tt.price_cents, tt.currency, tpt.tier_metadata INTO v_state
    FROM public.ticket_types tt JOIN public.trip_pricing_tiers tpt ON tpt.ticket_type_id = tt.id
   WHERE tt.id = v_tier;
  IF v_state.price_cents <> 0 OR v_state.currency IS DISTINCT FROM 'GBP'
     OR NOT (v_state.tier_metadata ? 'price_cleared_for_currency_change') THEN
    RAISE EXCEPTION 'N-10 fixture: the package was not cleared and marked: %', row_to_json(v_state);
  END IF;
  IF (SELECT updated_at FROM public.events WHERE id = v_event) IS NOT DISTINCT FROM v_stale_revision THEN
    RAISE EXCEPTION 'N-11 the clear did not move the trip''s revision; a form older than the clear could not be told apart';
  END IF;

  -- N-12 the form left open sends its old number and the empty metadata it
  -- read before the clear, with the revision it read then.
  v_out := '';
  BEGIN
    SET LOCAL ROLE authenticated;
    PERFORM public.biz_apply_trip_draft_graph(v_event,
      jsonb_build_object('tiers', jsonb_build_array(jsonb_build_object(
        'ticket_type_id', v_tier, 'tier_name', 'Standard', 'price_cents', 4500000,
        'capacity', 12, 'tier_metadata', '{}'::jsonb))),
      v_stale_revision, gen_random_uuid());
    SET CONSTRAINTS ALL IMMEDIATE;
    SET CONSTRAINTS ALL DEFERRED;
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN
    SET CONSTRAINTS ALL DEFERRED;
    RESET ROLE;
    v_out := SQLERRM;
  END;
  IF v_out IS DISTINCT FROM 'trip_revision_conflict' THEN
    RAISE EXCEPTION 'N-12 the old number from a form older than the clear answered "%", expected trip_revision_conflict', v_out;
  END IF;

  -- N-13 metadata replaced by JSON null with the old number, at the CURRENT
  -- revision: refused at commit.
  v_out := '';
  BEGIN
    SET LOCAL ROLE authenticated;
    PERFORM public.biz_apply_trip_draft_graph(v_event,
      jsonb_build_object('tiers', jsonb_build_array(jsonb_build_object(
        'ticket_type_id', v_tier, 'tier_name', 'Standard', 'price_cents', 4500000,
        'capacity', 12, 'tier_metadata', 'null'::jsonb))),
      (SELECT updated_at FROM public.events WHERE id = v_event), gen_random_uuid());
    SET CONSTRAINTS ALL IMMEDIATE;
    SET CONSTRAINTS ALL DEFERRED;
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN
    SET CONSTRAINTS ALL DEFERRED;
    RESET ROLE;
    v_out := SQLERRM;
  END;
  IF v_out IS DISTINCT FROM 'price_reentry_required' THEN
    RAISE EXCEPTION 'N-13 JSON null metadata with the old number answered "%", expected price_reentry_required', v_out;
  END IF;

  -- N-14 neither refusal left anything behind.
  SELECT tt.price_cents, tt.currency, tpt.tier_metadata INTO v_state
    FROM public.ticket_types tt JOIN public.trip_pricing_tiers tpt ON tpt.ticket_type_id = tt.id
   WHERE tt.id = v_tier;
  IF v_state.price_cents <> 0 OR NOT (v_state.tier_metadata ? 'price_cleared_for_currency_change') THEN
    RAISE EXCEPTION 'N-14 a refused save changed the package: %', row_to_json(v_state);
  END IF;
END
$package$;

-- ─── X-1x  the index the commit-time check needs ─────────────────────────────
DO $index$
DECLARE
  v_tier uuid;
  v_plan text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
     WHERE i.indrelid = 'public.trip_pricing_tiers'::regclass
       AND c.relname = 'idx_trip_pricing_tiers_ticket_type' AND i.indisvalid AND i.indisready
       AND i.indnkeyatts = 1
       AND (SELECT attname FROM pg_attribute WHERE attrelid = i.indrelid AND attnum = i.indkey[0]) = 'ticket_type_id'
  ) THEN
    RAISE EXCEPTION 'X-10 idx_trip_pricing_tiers_ticket_type is missing, invalid, or not on ticket_type_id';
  END IF;

  SELECT tpt.ticket_type_id INTO v_tier FROM public.trip_pricing_tiers tpt
   WHERE tpt.event_id IN (SELECT id FROM public.events WHERE brand_id = '3645d2e7-0000-4000-8000-0000000000c0');
  CREATE TEMP TABLE rt2_many ON COMMIT DROP AS
    SELECT gen_random_uuid() AS new_id, n FROM generate_series(1, 3000) AS n;
  INSERT INTO public.ticket_types
    SELECT (jsonb_populate_record(tt, jsonb_build_object('id', m.new_id, 'name', 'P' || m.n,
              'price_cents', 1000, 'is_free', false, 'display_order', m.n))).*
      FROM public.ticket_types tt, rt2_many m WHERE tt.id = v_tier;
  INSERT INTO public.trip_pricing_tiers
    SELECT (jsonb_populate_record(tpt, jsonb_build_object('id', gen_random_uuid(),
              'ticket_type_id', m.new_id, 'tier_name', 'P' || m.n, 'tier_metadata', '{}'::jsonb))).*
      FROM public.trip_pricing_tiers tpt, rt2_many m WHERE tpt.ticket_type_id = v_tier;
  ANALYZE public.trip_pricing_tiers;
  ANALYZE public.ticket_types;

  -- The lookup the commit-time check runs, for one package among 3,000.
  SELECT new_id INTO v_tier FROM rt2_many WHERE n = 1500;
  EXECUTE format($q$EXPLAIN (COSTS OFF)
    SELECT 1 FROM public.trip_pricing_tiers tpt
      JOIN public.ticket_types tt ON tt.id = tpt.ticket_type_id
     WHERE tt.id = %L AND tt.deleted_at IS NULL AND tt.price_cents > 0
       AND tpt.tier_metadata ? 'price_cleared_for_currency_change'$q$, v_tier)
    INTO v_plan;
  -- EXPLAIN returns one row per plan line; read them all.
  v_plan := '';
  FOR v_plan IN EXECUTE format($q$EXPLAIN (COSTS OFF)
    SELECT 1 FROM public.trip_pricing_tiers tpt
      JOIN public.ticket_types tt ON tt.id = tpt.ticket_type_id
     WHERE tt.id = %L AND tt.deleted_at IS NULL AND tt.price_cents > 0
       AND tpt.tier_metadata ? 'price_cleared_for_currency_change'$q$, v_tier)
  LOOP
    IF v_plan ~ 'Seq Scan on trip_pricing_tiers' THEN
      RAISE EXCEPTION 'X-11 the commit-time check scans every package: %', v_plan;
    END IF;
    IF v_plan ~ 'idx_trip_pricing_tiers_ticket_type' THEN
      PERFORM set_config('rt2.index_used', 'yes', true);
    END IF;
  END LOOP;
  IF current_setting('rt2.index_used', true) IS DISTINCT FROM 'yes' THEN
    RAISE EXCEPTION 'X-12 the commit-time check does not use idx_trip_pricing_tiers_ticket_type';
  END IF;

  -- And the check still does its job on the big table: every one of the 3,000
  -- ordinary price changes commits, none is mistaken for a cleared package.
  UPDATE public.ticket_types SET price_cents = price_cents + 1 WHERE id IN (SELECT new_id FROM rt2_many);
  SET CONSTRAINTS ALL IMMEDIATE;
  SET CONSTRAINTS ALL DEFERRED;
  IF (SELECT count(*) FROM public.ticket_types WHERE id IN (SELECT new_id FROM rt2_many) AND price_cents = 1001) <> 3000 THEN
    RAISE EXCEPTION 'X-13 ordinary price changes were lost';
  END IF;
END
$index$;

ROLLBACK;

\echo 'issue_3645_drafts_follow_brand_currency.tester.retest2: ALL PASS'
