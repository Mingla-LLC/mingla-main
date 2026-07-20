-- issue #1014 — behavioral post-apply probe for the free-only-publish currency
-- relax. Hand-run AFTER `supabase db push --linked` lands
-- 20270108001014_issue_1014_free_only_publish_currency_relax.sql:
--   psql "$DB_URL" -f supabase/migrations/__tests__/issue_1014_free_publish_currency.test.sql
--
-- WRITE-SAFE: every behavioral case runs inside its own transaction that
-- ROLLBACKs, so no fixture data survives. Covers SPEC §7 T-1 (trigger leg),
-- T-2 (gate marker), T-7, T-8, T-9, T-10 plus the §9 angle-(8) steady-state
-- contract. The RPC-internal legs (wizard payload → publish RPC) are pinned by
-- the Deno test issue_1014_free_publish_currency.test.ts and exercised by the
-- tester end-to-end.
--
-- fails-on-revert: reverting trigger (c) to the ORCH-0769 unconditional RAISE
-- makes B-02 (flagged free publish) and B-03 (steady-state transitions) fail;
-- reverting trigger (d) to the event_currency_not_found raiser makes B-04/B-05
-- fail; re-adding the events CHECK makes B-02 fail at the UPDATE.

\set ON_ERROR_STOP on

-- ─── B-00: schema contract ──────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'events_published_currency_required_check') THEN
    RAISE EXCEPTION 'B-00 FAIL: events_published_currency_required_check still exists (must be dropped)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ticket_types_paid_currency_required_check') THEN
    RAISE EXCEPTION 'B-00 FAIL: ticket_types_paid_currency_required_check missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'orders_paid_currency_required_check') THEN
    RAISE EXCEPTION 'B-00 FAIL: orders_paid_currency_required_check missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ticket_checkout_sessions_paid_currency_required_check') THEN
    RAISE EXCEPTION 'B-00 FAIL: ticket_checkout_sessions_paid_currency_required_check missing';
  END IF;
  IF (SELECT is_nullable FROM information_schema.columns
      WHERE table_schema='public' AND table_name='ticket_types' AND column_name='currency') <> 'YES' THEN
    RAISE EXCEPTION 'B-00 FAIL: ticket_types.currency still NOT NULL';
  END IF;
  IF (SELECT column_default FROM information_schema.columns
      WHERE table_schema='public' AND table_name='ticket_checkout_sessions' AND column_name='currency') IS NOT NULL THEN
    RAISE EXCEPTION 'B-00 FAIL: ticket_checkout_sessions.currency still has a DEFAULT';
  END IF;
  -- trigger (d) re-attached WITH price_cents (0→paid flips must resolve-or-block).
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger t
    WHERE t.tgrelid = 'public.ticket_types'::regclass
      AND t.tgname = 'trg_enforce_event_ticket_currency'
      AND pg_get_triggerdef(t.oid) ILIKE '%price_cents%'
  ) THEN
    RAISE EXCEPTION 'B-00 FAIL: trg_enforce_event_ticket_currency not attached on price_cents';
  END IF;
  -- ONE-token contract: no raiser of the retired event_currency_not_found.
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace
      AND p.proname = 'tg_enforce_event_ticket_currency'
      AND pg_get_functiondef(p.oid) LIKE '%event_currency_not_found%'
  ) THEN
    RAISE EXCEPTION 'B-00 FAIL: tg_enforce_event_ticket_currency still raises event_currency_not_found';
  END IF;
  RAISE NOTICE 'B-00 PASS: schema contract (CHECKs, nullability, trigger attachment, one token)';
END$$;

-- ─── B-01 (T-7): draft→scheduled WITHOUT the flag on a currency-less brand
--     still fails close ────────────────────────────────────────────────────────
BEGIN;
DO $$
DECLARE
  v_user uuid := gen_random_uuid();
  v_brand uuid := gen_random_uuid();
  v_event uuid := gen_random_uuid();
BEGIN
  -- Fixture chain: brands.account_id → creator_accounts.id → auth.users.id.
  INSERT INTO auth.users (id) VALUES (v_user);
  INSERT INTO public.creator_accounts (id) VALUES (v_user);
  INSERT INTO public.brands (id, account_id, name, slug)
    VALUES (v_brand, v_user, 'issue1014 bare', 'issue1014-bare-' || v_brand);
  INSERT INTO public.events (id, brand_id, title, slug, event_type, status, visibility, timezone)
    VALUES (v_event, v_brand, 'i1014 free party', 'i1014-free-party', 'event', 'draft', 'draft', 'UTC');
  INSERT INTO public.event_dates (event_id, start_at, end_at, timezone, is_master)
    VALUES (v_event, now() + interval '7 days', now() + interval '7 days 4 hours', 'UTC', true);

  BEGIN
    UPDATE public.events SET status = 'scheduled', visibility = 'public', published_at = now()
     WHERE id = v_event;
    RAISE EXCEPTION 'B-01 FAIL: unflagged publish on a currency-less brand did NOT raise';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'event_currency_required' THEN
      RAISE EXCEPTION 'B-01 FAIL: expected event_currency_required, got %', SQLERRM;
    END IF;
  END;
  RAISE NOTICE 'B-01 PASS: unflagged draft→scheduled still raises event_currency_required';
END$$;
ROLLBACK;

-- ─── B-02 (T-1 trigger leg): the flagged free-only publish succeeds with
--     currency NULL; free tickets carry NULL ─────────────────────────────────
BEGIN;
DO $$
DECLARE
  v_user uuid := gen_random_uuid();
  v_brand uuid := gen_random_uuid();
  v_event uuid := gen_random_uuid();
  v_curr char(3);
  v_tt_curr char(3);
BEGIN
  -- Fixture chain: brands.account_id → creator_accounts.id → auth.users.id.
  INSERT INTO auth.users (id) VALUES (v_user);
  INSERT INTO public.creator_accounts (id) VALUES (v_user);
  INSERT INTO public.brands (id, account_id, name, slug)
    VALUES (v_brand, v_user, 'issue1014 bare2', 'issue1014-bare2-' || v_brand);
  INSERT INTO public.events (id, brand_id, title, slug, event_type, status, visibility, timezone)
    VALUES (v_event, v_brand, 'i1014 free party 2', 'i1014-free-party-2', 'event', 'draft', 'draft', 'UTC');
  INSERT INTO public.event_dates (event_id, start_at, end_at, timezone, is_master)
    VALUES (v_event, now() + interval '7 days', now() + interval '7 days 4 hours', 'UTC', true);
  -- Free ticket on the currency-less draft: trigger (d) must permit NULL.
  INSERT INTO public.ticket_types (event_id, name, price_cents, is_free, quantity_total, min_purchase_qty, available_online, available_in_person, display_order)
    VALUES (v_event, 'Free entry', 0, true, 100, 1, true, true, 0);

  PERFORM set_config('mingla.publish_free_only', 'on', true);
  UPDATE public.events SET status = 'scheduled', visibility = 'public', published_at = now()
   WHERE id = v_event;

  SELECT currency INTO v_curr FROM public.events WHERE id = v_event;
  IF v_curr IS NOT NULL THEN
    RAISE EXCEPTION 'B-02 FAIL: flagged free publish stamped currency % (expected NULL)', v_curr;
  END IF;
  IF (SELECT status FROM public.events WHERE id = v_event) <> 'scheduled' THEN
    RAISE EXCEPTION 'B-02 FAIL: flagged free publish did not reach scheduled';
  END IF;
  SELECT currency INTO v_tt_curr FROM public.ticket_types WHERE event_id = v_event AND deleted_at IS NULL LIMIT 1;
  IF v_tt_curr IS NOT NULL THEN
    RAISE EXCEPTION 'B-02 FAIL: free ticket carries currency % (expected NULL)', v_tt_curr;
  END IF;
  RAISE NOTICE 'B-02 PASS: flagged free-only publish → scheduled with events+ticket currency NULL';
END$$;
ROLLBACK;

-- ─── B-03 (§9 angle-8): steady-state non-draft transitions on the NULL-currency
--     published event do NOT raise; an explicit currency change DOES ──────────
BEGIN;
DO $$
DECLARE
  v_user uuid := gen_random_uuid();
  v_brand uuid := gen_random_uuid();
  v_event uuid := gen_random_uuid();
BEGIN
  -- Fixture chain: brands.account_id → creator_accounts.id → auth.users.id.
  INSERT INTO auth.users (id) VALUES (v_user);
  INSERT INTO public.creator_accounts (id) VALUES (v_user);
  INSERT INTO public.brands (id, account_id, name, slug)
    VALUES (v_brand, v_user, 'issue1014 bare3', 'issue1014-bare3-' || v_brand);
  INSERT INTO public.events (id, brand_id, title, slug, event_type, status, visibility, timezone)
    VALUES (v_event, v_brand, 'i1014 free party 3', 'i1014-free-party-3', 'event', 'draft', 'draft', 'UTC');
  INSERT INTO public.event_dates (event_id, start_at, end_at, timezone, is_master)
    VALUES (v_event, now() + interval '7 days', now() + interval '7 days 4 hours', 'UTC', true);
  PERFORM set_config('mingla.publish_free_only', 'on', true);
  UPDATE public.events SET status = 'scheduled', visibility = 'public', published_at = now() WHERE id = v_event;
  -- Kill the flag for the steady-state legs (fresh setting, same transaction).
  PERFORM set_config('mingla.publish_free_only', '', true);

  UPDATE public.events SET status = 'live' WHERE id = v_event;
  UPDATE public.events SET status = 'ended' WHERE id = v_event;
  UPDATE public.events SET status = 'cancelled' WHERE id = v_event;
  IF (SELECT currency FROM public.events WHERE id = v_event) IS NOT NULL THEN
    RAISE EXCEPTION 'B-03 FAIL: steady-state transitions stamped a currency';
  END IF;

  BEGIN
    UPDATE public.events SET currency = 'EUR' WHERE id = v_event;
    RAISE EXCEPTION 'B-03 FAIL: explicit currency change on a currency-less brand did NOT raise';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'event_currency_required' THEN
      RAISE EXCEPTION 'B-03 FAIL: expected event_currency_required on currency change, got %', SQLERRM;
    END IF;
  END;
  RAISE NOTICE 'B-03 PASS: scheduled→live→ended→cancelled permitted; explicit currency change fails close';
END$$;
ROLLBACK;

-- ─── B-04 (T-8): paid ticket onto a NULL-currency event AFTER the brand gains
--     NGN → stamps event + ticket in the same statement ───────────────────────
BEGIN;
DO $$
DECLARE
  v_user uuid := gen_random_uuid();
  v_brand uuid := gen_random_uuid();
  v_event uuid := gen_random_uuid();
  v_tt uuid;
BEGIN
  -- Fixture chain: brands.account_id → creator_accounts.id → auth.users.id.
  INSERT INTO auth.users (id) VALUES (v_user);
  INSERT INTO public.creator_accounts (id) VALUES (v_user);
  INSERT INTO public.brands (id, account_id, name, slug)
    VALUES (v_brand, v_user, 'issue1014 ng', 'issue1014-ng-' || v_brand);
  INSERT INTO public.events (id, brand_id, title, slug, event_type, status, visibility, timezone)
    VALUES (v_event, v_brand, 'i1014 lagos party', 'i1014-lagos-party', 'event', 'draft', 'draft', 'UTC');
  INSERT INTO public.event_dates (event_id, start_at, end_at, timezone, is_master)
    VALUES (v_event, now() + interval '7 days', now() + interval '7 days 4 hours', 'UTC', true);
  PERFORM set_config('mingla.publish_free_only', 'on', true);
  UPDATE public.events SET status = 'scheduled', visibility = 'public', published_at = now() WHERE id = v_event;
  PERFORM set_config('mingla.publish_free_only', '', true);

  -- The brand later completes Paystack onboarding (explicit NGN stamp).
  UPDATE public.brands SET default_currency = 'NGN' WHERE id = v_brand;

  -- Money enters: the stay-NULL-until-money stamping moment.
  INSERT INTO public.ticket_types (event_id, name, price_cents, is_free, quantity_total, min_purchase_qty, available_online, available_in_person, display_order)
    VALUES (v_event, 'VIP', 500000, false, 20, 1, true, false, 1)
    RETURNING id INTO v_tt;

  IF (SELECT currency FROM public.events WHERE id = v_event) IS DISTINCT FROM 'NGN' THEN
    RAISE EXCEPTION 'B-04 FAIL: paid ticket write did not stamp events.currency=NGN (got %)',
      (SELECT currency FROM public.events WHERE id = v_event);
  END IF;
  IF (SELECT currency FROM public.ticket_types WHERE id = v_tt) IS DISTINCT FROM 'NGN' THEN
    RAISE EXCEPTION 'B-04 FAIL: paid ticket row did not get NGN';
  END IF;
  RAISE NOTICE 'B-04 PASS: paid ticket onto NULL-currency event stamps event+ticket NGN';
END$$;
ROLLBACK;

-- ─── B-05 (T-9): money entering while the brand is STILL bare fails close;
--     the row-level CHECK is the bypass backstop ──────────────────────────────
BEGIN;
DO $$
DECLARE
  v_user uuid := gen_random_uuid();
  v_brand uuid := gen_random_uuid();
  v_event uuid := gen_random_uuid();
  v_tt uuid;
BEGIN
  -- Fixture chain: brands.account_id → creator_accounts.id → auth.users.id.
  INSERT INTO auth.users (id) VALUES (v_user);
  INSERT INTO public.creator_accounts (id) VALUES (v_user);
  INSERT INTO public.brands (id, account_id, name, slug)
    VALUES (v_brand, v_user, 'issue1014 bare4', 'issue1014-bare4-' || v_brand);
  INSERT INTO public.events (id, brand_id, title, slug, event_type, status, visibility, timezone)
    VALUES (v_event, v_brand, 'i1014 free party 4', 'i1014-free-party-4', 'event', 'draft', 'draft', 'UTC');
  INSERT INTO public.event_dates (event_id, start_at, end_at, timezone, is_master)
    VALUES (v_event, now() + interval '7 days', now() + interval '7 days 4 hours', 'UTC', true);
  INSERT INTO public.ticket_types (event_id, name, price_cents, is_free, quantity_total, min_purchase_qty, available_online, available_in_person, display_order)
    VALUES (v_event, 'Free entry', 0, true, 100, 1, true, true, 0)
    RETURNING id INTO v_tt;
  PERFORM set_config('mingla.publish_free_only', 'on', true);
  UPDATE public.events SET status = 'scheduled', visibility = 'public', published_at = now() WHERE id = v_event;
  PERFORM set_config('mingla.publish_free_only', '', true);

  -- Paid INSERT → resolve-or-block blocks.
  BEGIN
    INSERT INTO public.ticket_types (event_id, name, price_cents, is_free, quantity_total, min_purchase_qty, available_online, available_in_person, display_order)
      VALUES (v_event, 'VIP', 5000, false, 20, 1, true, false, 1);
    RAISE EXCEPTION 'B-05 FAIL: paid ticket INSERT on a bare brand did NOT raise';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'event_currency_required' THEN
      RAISE EXCEPTION 'B-05 FAIL: expected event_currency_required on paid INSERT, got %', SQLERRM;
    END IF;
  END;

  -- 0→paid price flip (the price_cents attachment leg) → blocks too.
  BEGIN
    UPDATE public.ticket_types SET price_cents = 500 WHERE id = v_tt;
    RAISE EXCEPTION 'B-05 FAIL: 0→paid price flip on a bare brand did NOT raise';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'event_currency_required' THEN
      RAISE EXCEPTION 'B-05 FAIL: expected event_currency_required on price flip, got %', SQLERRM;
    END IF;
  END;
  RAISE NOTICE 'B-05 PASS: money entering a bare brand''s NULL-currency event fails close (INSERT + price flip)';
END$$;
ROLLBACK;

-- ─── B-06 (T-10): free cart checkout on a NULL-currency event — session and
--     order land with total 0, currency NULL ──────────────────────────────────
BEGIN;
DO $$
DECLARE
  v_user uuid := gen_random_uuid();
  v_brand uuid := gen_random_uuid();
  v_event uuid := gen_random_uuid();
  v_tt uuid;
  v_session jsonb;
  v_session_id uuid;
  v_order jsonb;
  v_order_currency char(3);
  v_order_total int;
BEGIN
  -- Fixture chain: brands.account_id → creator_accounts.id → auth.users.id.
  INSERT INTO auth.users (id) VALUES (v_user);
  INSERT INTO public.creator_accounts (id) VALUES (v_user);
  INSERT INTO public.brands (id, account_id, name, slug)
    VALUES (v_brand, v_user, 'issue1014 bare5', 'issue1014-bare5-' || v_brand);
  INSERT INTO public.events (id, brand_id, title, slug, event_type, status, visibility, timezone)
    VALUES (v_event, v_brand, 'i1014 free party 5', 'i1014-free-party-5', 'event', 'draft', 'draft', 'UTC');
  INSERT INTO public.event_dates (event_id, start_at, end_at, timezone, is_master)
    VALUES (v_event, now() + interval '7 days', now() + interval '7 days 4 hours', 'UTC', true);
  INSERT INTO public.ticket_types (event_id, name, price_cents, is_free, quantity_total, min_purchase_qty, available_online, available_in_person, display_order)
    VALUES (v_event, 'Free entry', 0, true, 100, 1, true, true, 0)
    RETURNING id INTO v_tt;
  PERFORM set_config('mingla.publish_free_only', 'on', true);
  UPDATE public.events SET status = 'scheduled', visibility = 'public', published_at = now() WHERE id = v_event;
  PERFORM set_config('mingla.publish_free_only', '', true);

  v_session := public.biz_ticket_checkout_create_session(
    v_event, NULL, 'Issue Tester', 'issue1014@example.com', '+14155550123',
    false,
    jsonb_build_array(jsonb_build_object('ticketTypeId', v_tt, 'quantity', 1)),
    'issue1014-idem-' || v_event, now() + interval '15 minutes', 0, 'auto');

  IF v_session->>'status' <> 'pending_free' THEN
    RAISE EXCEPTION 'B-06 FAIL: free cart session status % (expected pending_free)', v_session->>'status';
  END IF;
  IF (v_session->>'totalCents')::int <> 0 THEN
    RAISE EXCEPTION 'B-06 FAIL: free cart totalCents % (expected 0)', v_session->>'totalCents';
  END IF;
  v_session_id := (v_session->>'checkoutSessionId')::uuid;
  IF (SELECT currency FROM public.ticket_checkout_sessions WHERE id = v_session_id) IS NOT NULL THEN
    RAISE EXCEPTION 'B-06 FAIL: free cart session persisted a currency (expected NULL)';
  END IF;

  v_order := public.biz_ticket_checkout_finalize(
    v_session_id, NULL, NULL, NULL, 'issue1014-test-pepper-0123456789abcdef0123456789', NULL, NULL, false);

  SELECT o.currency, o.total_cents INTO v_order_currency, v_order_total
    FROM public.orders o WHERE o.checkout_session_id = v_session_id;
  IF v_order_total IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'B-06 FAIL: free order total_cents % (expected 0)', v_order_total;
  END IF;
  IF v_order_currency IS NOT NULL THEN
    RAISE EXCEPTION 'B-06 FAIL: free order carries currency % (expected NULL)', v_order_currency;
  END IF;
  RAISE NOTICE 'B-06 PASS: free cart create+finalize on NULL-currency event → order total 0, currency NULL';
END$$;
ROLLBACK;

-- ─── Summary ────────────────────────────────────────────────────────────────
DO $$ BEGIN RAISE NOTICE 'issue #1014 behavioral probe complete: B-00..B-06 all passed.'; END $$;
