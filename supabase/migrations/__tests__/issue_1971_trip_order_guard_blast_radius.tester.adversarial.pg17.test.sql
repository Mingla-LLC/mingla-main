\set ON_ERROR_STOP on

-- Issue #1971 — INDEPENDENT TESTER adversarial guard.
-- Run after the full migration chain on PostgreSQL 17.
--
-- DIFFERENT AXIS FROM THE IMPLEMENTOR SUITE.
-- `issue_1971_trip_lifecycle.implementor.happy.pg17.test.sql` section I proves the
-- guard does not UNDER-reach: a door sale blocks the delete, and a deleted trip
-- refuses a new confirmed order. This file proves the opposite and untested
-- direction — that the guard does not OVER-reach.
--
-- Why that direction is the dangerous one here: #1971 installs
-- `trg_biz_trip_order_delete_lock`, a BEFORE INSERT OR UPDATE trigger, on
-- `public.orders` — the money table. A BEFORE row trigger is the one trigger
-- class that can silently DESTROY a write: returning NULL cancels the row with
-- no error and no exception for the caller to catch, so revenue simply does not
-- land. It can also block writes that belong to entirely unrelated products
-- (concerts, stays, venues) that merely share the table, and it can serialise
-- high-volume checkout on an advisory key it never needed to take.
--
-- Nothing in the repository asserted any of that before this file.
--
-- NULL DISCIPLINE. Every value assertion below uses `IS DISTINCT FROM` or an
-- explicit `IS NULL` test, never bare `<>`. In SQL `NULL <> 'x'` is NULL and
-- `IF NULL THEN` does not execute, so a bare `<>` assertion is silently inert
-- for exactly the failure it is written to catch. That class cost this issue two
-- rounds already; this file does not re-introduce it.

BEGIN;

SELECT set_config('request.jwt.claim.sub', '19710000-0000-4000-8000-00000000ad01', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);

INSERT INTO auth.users(id) VALUES ('19710000-0000-4000-8000-00000000ad01');
INSERT INTO public.creator_accounts(id) VALUES ('19710000-0000-4000-8000-00000000ad01');

INSERT INTO public.brands(id, account_id, name, slug, default_currency)
VALUES ('19710000-0000-4000-8000-00000000ad10',
        '19710000-0000-4000-8000-00000000ad01',
        'Issue 1971 tester', 'issue-1971-tester', 'USD');

-- A CONCERT. Not a trip. #1971 has no authority over this row, and the guard
-- must be able to prove it leaves it alone.
INSERT INTO public.events(id, brand_id, title, slug, event_type, status)
VALUES ('19710000-0000-4000-8000-00000000adc1',
        '19710000-0000-4000-8000-00000000ad10',
        'Tester concert', 'issue-1971-tester-concert', 'event', 'live');

-- A TRIP, live and undeleted.
INSERT INTO public.events(id, brand_id, title, slug, event_type, status)
VALUES ('19710000-0000-4000-8000-00000000adf1',
        '19710000-0000-4000-8000-00000000ad10',
        'Tester trip', 'issue-1971-tester-trip', 'trip', 'live');

-- ---------------------------------------------------------------------------
-- X-01  A soft-deleted NON-TRIP event must still accept a new paid order.
--
--       The trigger's containment is the `event_type = 'trip'` predicate inside
--       its EXISTS. Without it, every cancelled/archived concert, stay and venue
--       in the product stops accepting money the moment it is soft-deleted —
--       a silent, cross-product revenue outage introduced by a trip issue.
-- ---------------------------------------------------------------------------
UPDATE public.events SET deleted_at = now()
 WHERE id = '19710000-0000-4000-8000-00000000adc1';

DO $$
DECLARE v_total int;
BEGIN
  BEGIN
    INSERT INTO public.orders(id, event_id, total_cents, payment_status,
                              payment_method, source, currency, buyer_phone_e164)
    VALUES ('19710000-0000-4000-8000-00000000ad21',
            '19710000-0000-4000-8000-00000000adc1',
            4500, 'paid', 'online_card', 'online_checkout', 'USD', '+12015550111');
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'X-01 the trip guard blocked an order on a soft-deleted NON-TRIP event: %', SQLERRM;
  END;

  -- X-02  …and the row must actually be THERE. A BEFORE trigger that returns
  --       NULL cancels the insert silently: no exception is raised, so the
  --       EXCEPTION block above would not fire and the money would simply be
  --       gone. Only reading the row back proves it landed.
  SELECT total_cents INTO v_total FROM public.orders
   WHERE id = '19710000-0000-4000-8000-00000000ad21';
  IF v_total IS NULL THEN
    RAISE EXCEPTION 'X-02 the order row is absent after a reportedly successful insert (BEFORE trigger returned NULL)';
  END IF;
  IF v_total IS DISTINCT FROM 4500 THEN
    RAISE EXCEPTION 'X-02 the BEFORE trigger corrupted the order total, got %', v_total;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- X-03  A soft-deleted NON-TRIP event must still accept an order TRANSITION.
--       Refund and reconciliation bookkeeping arrives long after an event ends
--       and is routinely applied to archived events.
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_status text;
BEGIN
  BEGIN
    UPDATE public.orders
       SET payment_status = 'refunded', refunded_amount_cents = 4500
     WHERE id = '19710000-0000-4000-8000-00000000ad21';
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'X-03 the trip guard blocked refund bookkeeping on a soft-deleted NON-TRIP event: %', SQLERRM;
  END;

  SELECT payment_status INTO v_status FROM public.orders
   WHERE id = '19710000-0000-4000-8000-00000000ad21';
  IF v_status IS DISTINCT FROM 'refunded' THEN
    RAISE EXCEPTION 'X-03 the refund transition did not persist, status is %', COALESCE(v_status, '<row gone>');
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- X-04  A LIVE, undeleted trip must accept orders on EVERY payment rail.
--       The guard's own short-circuit reads `NEW.payment_status`; a rail it
--       does not recognise must never become a blocked sale.
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_rail text; v_n int; v_i int := 0;
BEGIN
  FOREACH v_rail IN ARRAY ARRAY['online_card', 'apple_pay', 'google_pay', 'cash', 'manual', 'nfc', 'card_reader'] LOOP
    v_i := v_i + 1;
    BEGIN
      INSERT INTO public.orders(event_id, total_cents, payment_status,
                                payment_method, source, currency)
      VALUES ('19710000-0000-4000-8000-00000000adf1', 1000 + v_i, 'paid',
              v_rail, 'door_sale', 'USD');
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'X-04 the guard blocked a legitimate % sale on a LIVE trip: %', v_rail, SQLERRM;
    END;
  END LOOP;

  SELECT count(*) INTO v_n FROM public.orders
   WHERE event_id = '19710000-0000-4000-8000-00000000adf1';
  IF v_n IS DISTINCT FROM 7 THEN
    RAISE EXCEPTION 'X-04 expected 7 persisted rail orders, found %', COALESCE(v_n, -1);
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- X-05  An order carrying NO event_id must pass the guard untouched.
--       The guard dereferences NEW.event_id; an unscoped row must not be
--       collateral damage.
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_ok boolean;
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'orders'
                AND column_name = 'event_id' AND is_nullable = 'YES') THEN
    BEGIN
      INSERT INTO public.orders(id, event_id, total_cents, payment_status,
                                payment_method, source, currency)
      VALUES ('19710000-0000-4000-8000-00000000ad31', NULL, 900, 'paid',
              'cash', 'door_sale', 'USD');
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'X-05 the guard rejected an order with no event_id: %', SQLERRM;
    END;
    SELECT true INTO v_ok FROM public.orders WHERE id = '19710000-0000-4000-8000-00000000ad31';
    IF v_ok IS NOT TRUE THEN
      RAISE EXCEPTION 'X-05 the event_id-less order did not persist';
    END IF;
  ELSE
    -- event_id is NOT NULL in this schema, so the guard's NULL branch is
    -- unreachable by construction. Recorded, not silently skipped.
    RAISE NOTICE 'X-05 not applicable: public.orders.event_id is NOT NULL';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- X-06  The delete guard must reject on the whole payment_status VOCABULARY,
--       not merely on 'paid'.
--
--       The implementor suite proves the payment_METHOD axis (a door sale, the
--       rail `biz_trip_has_web_purchases` would have missed). This is the
--       orthogonal axis: an order sitting at 'pending', 'refunded' or
--       'partial_refund' is money the platform is still accountable for, and
--       each must independently block the soft delete.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_status text; v_event uuid; v_rev timestamptz; v_result jsonb; v_deleted boolean;
BEGIN
  FOREACH v_status IN ARRAY ARRAY['pending', 'paid', 'refunded', 'partial_refund'] LOOP
    v_event := gen_random_uuid();
    INSERT INTO public.events(id, brand_id, title, slug, event_type, status)
    VALUES (v_event, '19710000-0000-4000-8000-00000000ad10',
            'Vocab ' || v_status, 'issue-1971-vocab-' || v_status, 'trip', 'live');

    INSERT INTO public.orders(event_id, total_cents, payment_status,
                              payment_method, source, currency,
                              refunded_amount_cents)
    VALUES (v_event, 8000, v_status, 'cash', 'door_sale', 'USD',
            CASE WHEN v_status IN ('refunded', 'partial_refund') THEN 100 ELSE 0 END);

    SELECT updated_at INTO v_rev FROM public.events WHERE id = v_event;
    v_result := public.biz_soft_delete_trip(v_event, v_rev, gen_random_uuid());

    -- Missing key must read as "deleted", so a reshaped result fails LOUD.
    v_deleted := COALESCE((v_result->>'deleted')::boolean, true);
    IF v_deleted IS NOT FALSE THEN
      RAISE EXCEPTION 'X-06 a trip with a % order was soft-deleted, result=%', v_status, v_result;
    END IF;

    IF (SELECT deleted_at FROM public.events WHERE id = v_event) IS NOT NULL THEN
      RAISE EXCEPTION 'X-06 a trip with a % order was marked deleted on the row', v_status;
    END IF;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- X-07  …and the guard must NOT over-reach in the other direction: 'failed'
--       and 'cancelled' orders carry no live obligation and must not make a
--       legitimate delete impossible.
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_event uuid; v_rev timestamptz; v_result jsonb;
BEGIN
  v_event := gen_random_uuid();
  INSERT INTO public.events(id, brand_id, title, slug, event_type, status)
  VALUES (v_event, '19710000-0000-4000-8000-00000000ad10',
          'Deletable', 'issue-1971-deletable', 'trip', 'live');

  INSERT INTO public.orders(event_id, total_cents, payment_status, payment_method, source, currency)
  VALUES (v_event, 0, 'cancelled', 'free', 'door_sale', 'USD'),
         (v_event, 0, 'failed',    'free', 'door_sale', 'USD');

  SELECT updated_at INTO v_rev FROM public.events WHERE id = v_event;
  v_result := public.biz_soft_delete_trip(v_event, v_rev, gen_random_uuid());

  IF COALESCE((v_result->>'deleted')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'X-07 a trip whose only orders are failed/cancelled refused to delete, result=%', v_result;
  END IF;
  IF (SELECT deleted_at FROM public.events WHERE id = v_event) IS NULL THEN
    RAISE EXCEPTION 'X-07 the delete reported success but the row is not marked deleted';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- X-08  Structural containment of the trigger itself, asserted from the
--       catalog rather than from the migration text.
--
--       (a) It must be column-scoped to event_id/payment_status. An unscoped
--           trigger takes a per-event advisory lock on EVERY order UPDATE —
--           including PDF paths, tax fields and notification status — which
--           serialises unrelated high-volume checkout traffic on the money
--           table for the remainder of each transaction.
--       (b) Its name must sort BEFORE every other BEFORE row trigger on
--           `public.orders`. PostgreSQL fires same-timing triggers in name
--           order, so the guard has to reject the row before any sibling
--           BEFORE trigger has mutated it.
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_def text; v_first text;
BEGIN
  SELECT pg_get_triggerdef(oid) INTO v_def
    FROM pg_trigger
   WHERE tgrelid = 'public.orders'::regclass
     AND tgname = 'trg_biz_trip_order_delete_lock';

  IF v_def IS NULL THEN
    RAISE EXCEPTION 'X-08 trg_biz_trip_order_delete_lock is not installed on public.orders';
  END IF;
  IF v_def NOT LIKE '%UPDATE OF%' THEN
    RAISE EXCEPTION 'X-08 the orders guard is not column-scoped; it will lock every order UPDATE: %', v_def;
  END IF;
  IF v_def NOT LIKE '%payment_status%' THEN
    RAISE EXCEPTION 'X-08 the orders guard does not watch payment_status: %', v_def;
  END IF;

  SELECT tgname INTO v_first
    FROM pg_trigger
   WHERE tgrelid = 'public.orders'::regclass
     AND NOT tgisinternal
     AND (tgtype & 2) = 2      -- BEFORE
     AND (tgtype & 1) = 1      -- ROW
   ORDER BY tgname
   LIMIT 1;

  IF v_first IS DISTINCT FROM 'trg_biz_trip_order_delete_lock' THEN
    RAISE EXCEPTION
      'X-08 a BEFORE row trigger on public.orders fires before the trip guard: % — the guard must reject first',
      COALESCE(v_first, '<none>');
  END IF;
END $$;

ROLLBACK;

\echo 'issue_1971_trip_order_guard_blast_radius.tester.adversarial.pg17: PASS'
