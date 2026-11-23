-- Issue #4490, spec 08 O4 fix round 1 (file number 608490). Four defects
-- from the independent O4 test, each fixed at its source:
--
-- O4-T1 (money paid twice). A paid table deposit used on a Till check could
--   also be refunded: the refund guard trusted reservations.deposit_applied_sale_id,
--   which any event manager could clear over REST, move the booking back to
--   confirmed and cancel it with a refund. Now
--   (a) the guard decides from the LIVE deposit_credit line (kind
--       deposit_credit, not voided, for that booking), and still refuses
--       while the stamp is set; it takes the booking's row lock first so a
--       seat or a void running at the same time is waited for;
--   (b) the stamp is server-owned: a BEFORE INSERT/UPDATE trigger on
--       reservations refuses any change to deposit_applied_sale_id that is
--       not made by the #4490 Till functions (a transaction-local marker the
--       seat and the void set for that one booking), except the foreign
--       key's own SET NULL when the check row is gone;
--   (c) while a booking's deposit is live on a check, its status can leave
--       'seated' only for 'completed'. Every other move (confirmed,
--       requested, waitlisted, cancelled_by_guest, cancelled_by_venue,
--       no_show), by any path, is refused with reservation_deposit_used.
--       Voiding the credit line (the only way a live deposit leaves a check)
--       lifts both rules: the deposit is refundable again, once, by the
--       booking's own rules.
--   With no deposit credit the three live cancel/refund RPCs behave exactly
--   as before (the guard and the trigger read nothing else and change
--   nothing).
--
-- O4-T3 ("Paid in today" wrong): see its section below. O4-T2 and O4-T4 follow.
--
-- Re-emits functions from their latest bodies (607490 or later): patched in
-- place where the change is small (precondition-counted), replaced whole
-- otherwise. pg_venue_order_finalize_payment is NOT touched. No venue_id
-- column (the #2099 seal is unchanged). Static SQL. Local stack only until
-- Seth approves a production migration.

BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE FUNCTION pg_temp.issue_4490_o4f1_patch(
  p_sig regprocedure,
  p_old text,
  p_new text,
  p_count integer DEFAULT 1
)
RETURNS void
LANGUAGE plpgsql
AS $patch$
DECLARE
  v_def text := pg_get_functiondef(p_sig);
  v_old_count integer;
BEGIN
  v_old_count := (length(v_def) - length(replace(v_def, p_old, ''))) / length(p_old);
  IF v_old_count <> p_count THEN
    RAISE EXCEPTION 'issue_4490 O4 fix 1 patch precondition failed for %: old % (expected %)',
      p_sig, v_old_count, p_count;
  END IF;
  EXECUTE replace(v_def, p_old, p_new);
END;
$patch$;

-- ===========================================================================
-- O4-T1 (a): the refund guard reads the live credit line.
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.issue_4490_reservation_deposit_refund_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- The booking's row lock first: a seat (which locks the booking before it
  -- puts the deposit on a check) or a void of the credit (which clears the
  -- stamp on the booking) running now is waited for, then read as committed.
  PERFORM 1 FROM public.reservations r WHERE r.id = NEW.subject_id FOR NO KEY UPDATE;
  IF EXISTS (SELECT 1 FROM public.venue_till_lines l
             WHERE l.reservation_id = NEW.subject_id AND l.kind = 'deposit_credit' AND l.state <> 'voided')
     OR EXISTS (SELECT 1 FROM public.reservations r
                WHERE r.id = NEW.subject_id AND r.deposit_applied_sale_id IS NOT NULL) THEN
    RAISE EXCEPTION 'reservation_deposit_used' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

-- ===========================================================================
-- O4-T1 (b) + (c): the stamp is server-owned; a booking whose deposit is on
-- a check stays seated (or completes).
-- ===========================================================================
CREATE FUNCTION public.issue_4490_reservation_deposit_owned()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.deposit_applied_sale_id IS NOT NULL THEN
      RAISE EXCEPTION 'reservation_deposit_server_owned' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.deposit_applied_sale_id IS DISTINCT FROM OLD.deposit_applied_sale_id
     AND current_setting('mingla.issue_4490_deposit_stamp', true) IS DISTINCT FROM NEW.id::text
     -- The foreign key's own ON DELETE SET NULL (the check row is gone).
     AND NOT (NEW.deposit_applied_sale_id IS NULL
              AND NOT EXISTS (SELECT 1 FROM public.venue_till_sales s WHERE s.id = OLD.deposit_applied_sale_id)) THEN
    RAISE EXCEPTION 'reservation_deposit_server_owned' USING ERRCODE = '42501';
  END IF;
  IF OLD.status = 'seated' AND NEW.status IS DISTINCT FROM OLD.status AND NEW.status IS DISTINCT FROM 'completed'
     AND EXISTS (SELECT 1 FROM public.venue_till_lines l
                 WHERE l.reservation_id = NEW.id AND l.kind = 'deposit_credit' AND l.state <> 'voided') THEN
    RAISE EXCEPTION 'reservation_deposit_used' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER issue_4490_reservation_deposit_owned_ins
  BEFORE INSERT ON public.reservations
  FOR EACH ROW WHEN (NEW.deposit_applied_sale_id IS NOT NULL)
  EXECUTE FUNCTION public.issue_4490_reservation_deposit_owned();
CREATE TRIGGER issue_4490_reservation_deposit_owned_upd
  BEFORE UPDATE ON public.reservations
  FOR EACH ROW WHEN (NEW.deposit_applied_sale_id IS DISTINCT FROM OLD.deposit_applied_sale_id
                     OR (OLD.status = 'seated' AND NEW.status IS DISTINCT FROM OLD.status))
  EXECUTE FUNCTION public.issue_4490_reservation_deposit_owned();

-- The two Till paths that own the stamp say so, for that booking only.
SELECT pg_temp.issue_4490_o4f1_patch(
  'public.issue_4490_till_seat(uuid,uuid,uuid,integer,uuid,text,uuid,text)'::regprocedure,
  $old$      UPDATE public.reservations SET deposit_applied_sale_id = v_sale.id WHERE id = v_res.id;$old$,
  $new$      PERFORM set_config('mingla.issue_4490_deposit_stamp', v_res.id::text, true);
      UPDATE public.reservations SET deposit_applied_sale_id = v_sale.id WHERE id = v_res.id;
      PERFORM set_config('mingla.issue_4490_deposit_stamp', '', true);$new$);
SELECT pg_temp.issue_4490_o4f1_patch(
  'public.issue_4490_till_line_voided()'::regprocedure,
  $old$    UPDATE public.reservations SET deposit_applied_sale_id = NULL
    WHERE id = NEW.reservation_id AND deposit_applied_sale_id = NEW.sale_id;$old$,
  $new$    PERFORM set_config('mingla.issue_4490_deposit_stamp', NEW.reservation_id::text, true);
    UPDATE public.reservations SET deposit_applied_sale_id = NULL
    WHERE id = NEW.reservation_id AND deposit_applied_sale_id = NEW.sale_id;
    PERFORM set_config('mingla.issue_4490_deposit_stamp', '', true);$new$);

-- ===========================================================================
-- O4-T3: "Paid in today" counts what each payment actually took.
-- ===========================================================================
-- Till money paid for an offer (entry, group package, a booking's balance, a
-- by-the-hour session) is recorded on its booking when the check is paid
-- (issue_4490_till_finalize_paid). It used to be recorded at the line's FULL
-- amount against the check's LAST payment, so a used table deposit was
-- counted twice (as a table deposit and again at the venue) and a split's
-- card share was counted as cash. Now each line is split over what funded
-- it (issue_4490_till_line_funding):
--   - a by-item share pays exactly the units of that line it holds;
--   - the rest of the line is shared pro rata over the table deposit used on
--     the check and every other payment that counts (whole-check payments,
--     part payments, even shares), by money each brought (net of refunds made
--     before the check was paid), remainders to the last source, so the
--     parts always add up to the line exactly;
--   - each payment's part is recorded against THAT payment, on the moment it
--     was paid (its own service day, its own method: tap/scan stays online);
--   - the deposit's part is recorded on the booking as method
--     'table_deposit' (the booking is fully paid, nothing is due twice) and
--     never counted again in "Paid in today" (it was counted as a table
--     deposit on the day it was paid).
-- Refunds: a line refund still comes off at the line's amount on its day; a
-- refund of one payment (one share) comes off by that payment's offer part,
-- pro rata, on the refund's own day (issue_4490_till_refund_offer_parts).
ALTER TABLE public.venue_offline_payments DROP CONSTRAINT venue_offline_payments_method_check;
ALTER TABLE public.venue_offline_payments ADD CONSTRAINT venue_offline_payments_method_check
  CHECK (method IN ('cash', 'transfer', 'card_at_venue', 'other', 'till', 'table_deposit'));

-- A payment's part is dated when that payment was taken.
CREATE OR REPLACE FUNCTION public.issue_4490_record_till_offer_payment(p_group_id uuid, p_amount_minor bigint, p_payment_id uuid, p_idempotency_key text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_group public.stay_reservation_groups%ROWTYPE;
  v_payment public.venue_till_payments%ROWTYPE;
  v_key text := btrim(COALESCE(p_idempotency_key, ''));
  v_id uuid;
BEGIN
  IF NOT public.issue_1389_service_role() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_amount_minor IS NULL OR p_amount_minor <= 0 OR p_amount_minor > 2147483647
     OR char_length(v_key) NOT BETWEEN 8 AND 200 THEN
    RAISE EXCEPTION 'till_invalid_payload' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_group FROM public.stay_reservation_groups WHERE id = p_group_id FOR UPDATE;
  SELECT * INTO v_payment FROM public.venue_till_payments WHERE id = p_payment_id;
  IF v_group.id IS NULL OR v_payment.id IS NULL OR v_group.offer_kind IS NULL THEN
    RAISE EXCEPTION 'offer_booking_not_found' USING ERRCODE = 'P0002';
  END IF;
  SELECT id INTO v_id FROM public.venue_offline_payments WHERE group_id = p_group_id AND idempotency_key = v_key;
  IF FOUND THEN
    RETURN v_id;
  END IF;
  PERFORM set_config('mingla.issue_4490_booking_change', p_group_id::text, true);
  INSERT INTO public.venue_offline_payments (
    group_id, amount_minor, currency_code, method, paid_on, note, recorded_by, idempotency_key, request_hash,
    till_payment_id, created_at
  ) VALUES (
    p_group_id, p_amount_minor, v_group.currency_code, 'till', v_payment.business_date, NULL,
    v_payment.taken_by_user_id, v_key,
    encode(pg_catalog.sha256(convert_to(jsonb_build_object('payment', p_payment_id, 'amount', p_amount_minor::text)::text,
      'UTF8')), 'hex'),
    p_payment_id,
    -- #4490 08-O4 fix 1 (O4-T3): the moment this payment was taken, so a
    -- part payment lands on its own service day.
    COALESCE(v_payment.paid_at, now())
  ) RETURNING id INTO v_id;
  UPDATE public.stay_reservation_groups SET version = version + 1, updated_at = now() WHERE id = p_group_id;
  INSERT INTO public.stay_reservation_events (
    group_id, event_type, actor_type, actor_user_id, idempotency_key, safe_metadata
  ) VALUES (
    p_group_id, 'stay_offer_paid_at_venue', 'staff', v_payment.taken_by_user_id, 'paid-at-till:' || v_id,
    jsonb_build_object('paymentId', v_id, 'amountMinor', p_amount_minor::text, 'method', 'till',
      'currencyCode', v_group.currency_code)
  );
  RETURN v_id;
END;
$function$;

-- The part of a line the table deposit paid: on the booking, never takings.
CREATE FUNCTION public.issue_4490_record_till_credit(p_group_id uuid, p_amount_minor bigint, p_sale_id uuid, p_actor uuid, p_idempotency_key text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_group public.stay_reservation_groups%ROWTYPE;
  v_sale public.venue_till_sales%ROWTYPE;
  v_key text := btrim(COALESCE(p_idempotency_key, ''));
  v_id uuid;
BEGIN
  IF NOT public.issue_1389_service_role() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_amount_minor IS NULL OR p_amount_minor <= 0 OR p_amount_minor > 2147483647
     OR char_length(v_key) NOT BETWEEN 8 AND 200 THEN
    RAISE EXCEPTION 'till_invalid_payload' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_group FROM public.stay_reservation_groups WHERE id = p_group_id FOR UPDATE;
  SELECT * INTO v_sale FROM public.venue_till_sales WHERE id = p_sale_id;
  IF v_group.id IS NULL OR v_sale.id IS NULL OR v_group.offer_kind IS NULL THEN
    RAISE EXCEPTION 'offer_booking_not_found' USING ERRCODE = 'P0002';
  END IF;
  SELECT id INTO v_id FROM public.venue_offline_payments WHERE group_id = p_group_id AND idempotency_key = v_key;
  IF FOUND THEN
    RETURN v_id;
  END IF;
  PERFORM set_config('mingla.issue_4490_booking_change', p_group_id::text, true);
  INSERT INTO public.venue_offline_payments (
    group_id, amount_minor, currency_code, method, paid_on, note, recorded_by, idempotency_key, request_hash
  ) VALUES (
    p_group_id, p_amount_minor, v_group.currency_code, 'table_deposit',
    public.issue_4490_till_business_date(v_sale.venue_id, now()), NULL,
    p_actor, v_key,
    encode(pg_catalog.sha256(convert_to(jsonb_build_object('sale', p_sale_id, 'amount', p_amount_minor::text)::text,
      'UTF8')), 'hex')
  ) RETURNING id INTO v_id;
  UPDATE public.stay_reservation_groups SET version = version + 1, updated_at = now() WHERE id = p_group_id;
  INSERT INTO public.stay_reservation_events (
    group_id, event_type, actor_type, actor_user_id, idempotency_key, safe_metadata
  ) VALUES (
    p_group_id, 'stay_offer_paid_at_venue', 'staff', p_actor, 'paid-at-till:' || v_id,
    jsonb_build_object('paymentId', v_id, 'amountMinor', p_amount_minor::text, 'method', 'table_deposit',
      'currencyCode', v_group.currency_code)
  );
  RETURN v_id;
END;
$function$;

-- What paid each offer line of a check (payment_id NULL = the table deposit).
CREATE FUNCTION public.issue_4490_till_line_funding(p_sale_id uuid)
RETURNS TABLE(line_id uuid, group_id uuid, payment_id uuid, amount_minor bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH sale AS (
    SELECT s.* FROM public.venue_till_sales s WHERE s.id = p_sale_id
  ), lines AS (
    SELECT l.id, l.stay_group_id, l.amount_minor
    FROM public.venue_till_lines l
    WHERE l.sale_id = p_sale_id AND l.kind IN ('entry', 'group_package', 'balance', 'by_the_hour')
      AND l.state IN ('held', 'committed') AND l.amount_minor > 0
  ), pays AS (
    -- The payments that count (late money only once kept), by what each
    -- still holds (refunds made before the check was paid made that money
    -- due again).
    SELECT p.id, p.seq, p.amount_minor AS gross, sh.mode AS share_mode, p.share_id,
           p.amount_minor - COALESCE((SELECT sum(r.amount_minor) FROM public.venue_till_refunds r
                                      WHERE r.payment_id = p.id), 0) AS net
    FROM public.venue_till_payments p
    LEFT JOIN public.venue_till_shares sh ON sh.id = p.share_id
    WHERE p.sale_id = p_sale_id AND p.state IN ('paid', 'partially_refunded', 'refunded')
      AND (NOT p.paid_late OR p.late_kept_at IS NOT NULL)
  ), exact AS (
    -- A by-item share pays exactly the units of the line it holds.
    SELECT si.till_line_id AS line_id, py.id AS payment_id,
           floor(sum(si.amount_minor)::numeric * GREATEST(py.net, 0) / py.gross)::bigint AS amount
    FROM pays py JOIN public.venue_till_share_items si ON si.share_id = py.share_id
    WHERE py.share_mode = 'by_item' AND py.gross > 0 AND si.till_line_id IN (SELECT id FROM lines)
    GROUP BY si.till_line_id, py.id, py.net, py.gross
  ), pool AS (
    -- The table deposit first, then every other payment in the order taken.
    SELECT NULL::uuid AS payment_id, 0::bigint AS ord,
           LEAST(s.credit_minor, s.subtotal_minor + s.service_charge_minor)::numeric AS w
    FROM sale s WHERE s.credit_minor > 0
    UNION ALL
    SELECT py.id, py.seq, py.net::numeric FROM pays py
    WHERE py.share_mode IS DISTINCT FROM 'by_item' AND py.net > 0
  ), cum AS (
    SELECT p.payment_id,
           sum(p.w) OVER (ORDER BY p.ord ROWS UNBOUNDED PRECEDING) AS c_to,
           sum(p.w) OVER (ORDER BY p.ord ROWS UNBOUNDED PRECEDING) - p.w AS c_from,
           sum(p.w) OVER () AS total
    FROM pool p WHERE p.w > 0
  ), rest AS (
    SELECT l.id, l.stay_group_id,
           l.amount_minor - COALESCE((SELECT sum(e.amount) FROM exact e WHERE e.line_id = l.id), 0) AS r
    FROM lines l
  )
  SELECT e.line_id, l.stay_group_id, e.payment_id, e.amount
  FROM exact e JOIN lines l ON l.id = e.line_id WHERE e.amount > 0
  UNION ALL
  SELECT x.line_id, x.stay_group_id, x.payment_id, x.amount FROM (
    SELECT r.id AS line_id, r.stay_group_id, c.payment_id,
           (floor(r.r::numeric * c.c_to / c.total) - floor(r.r::numeric * c.c_from / c.total))::bigint AS amount
    FROM rest r CROSS JOIN cum c WHERE r.r > 0 AND c.total > 0
  ) x WHERE x.amount > 0
$$;

-- The offer part of refunds of one payment (not a line refund), per booking,
-- on the refund's own moment: pro rata of what that payment paid for offers.
CREATE FUNCTION public.issue_4490_till_refund_offer_parts(p_venue_id uuid)
RETURNS TABLE(group_id uuid, amount_minor bigint, refunded_at timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH pay AS (
    SELECT p.id, p.amount_minor AS gross, s.paid_at AS sale_paid_at
    FROM public.venue_till_payments p JOIN public.venue_till_sales s ON s.id = p.sale_id
    WHERE s.venue_id = p_venue_id AND s.paid_at IS NOT NULL
  ), alloc AS (
    SELECT o.till_payment_id AS payment_id, o.group_id, sum(o.amount_minor) AS a
    FROM public.venue_offline_payments o JOIN pay ON pay.id = o.till_payment_id
    WHERE o.method = 'till'
    GROUP BY o.till_payment_id, o.group_id
  ), line_ref AS (
    -- Money a line refund already gave back from this payment, per booking.
    SELECT r.payment_id, l.stay_group_id AS group_id, sum(r.amount_minor) AS lr
    FROM public.venue_till_refunds r
    JOIN public.venue_till_lines l ON l.id = r.line_id
    JOIN pay ON pay.id = r.payment_id
    GROUP BY r.payment_id, l.stay_group_id
  ), refs AS (
    SELECT r.payment_id, r.amount_minor, r.created_at,
           sum(r.amount_minor) OVER (PARTITION BY r.payment_id ORDER BY r.created_at, r.id) AS c_to,
           pay.gross - COALESCE((SELECT sum(r0.amount_minor) FROM public.venue_till_refunds r0
                                 WHERE r0.payment_id = r.payment_id
                                   AND (r0.line_id IS NOT NULL OR r0.created_at < pay.sale_paid_at)), 0) AS m
    FROM public.venue_till_refunds r JOIN pay ON pay.id = r.payment_id
    WHERE r.line_id IS NULL AND r.created_at >= pay.sale_paid_at
  )
  SELECT a.group_id,
         (floor(refs.c_to::numeric * GREATEST(a.a - COALESCE(lr.lr, 0), 0) / refs.m + 0.5)
          - floor((refs.c_to - refs.amount_minor)::numeric * GREATEST(a.a - COALESCE(lr.lr, 0), 0) / refs.m + 0.5))::bigint,
         refs.created_at
  FROM refs
  JOIN alloc a ON a.payment_id = refs.payment_id
  LEFT JOIN line_ref lr ON lr.payment_id = a.payment_id AND lr.group_id = a.group_id
  WHERE refs.m > 0
$$;

-- The one finalizer (latest body: 594490 + 607490), now recording each offer
-- line by what paid it. With no payment (p_payment_id NULL) it only runs for
-- a check the deposit fully covers (O4-T2, issue_4490_till_close_covered).
CREATE OR REPLACE FUNCTION public.issue_4490_till_finalize_paid(p_sale_id uuid, p_payment_id uuid, p_actor uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_sale public.venue_till_sales%ROWTYPE;
  v_payment public.venue_till_payments%ROWTYPE;
  v_venue public.venue_listings%ROWTYPE;
  v_line record;
  v_fund record;
  v_hold public.stay_inventory_holds%ROWTYPE;
  v_pass uuid;
  v_actor uuid;
  v_now timestamptz := now();
  v_day date;
BEGIN
  IF NOT public.issue_1389_service_role() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_sale FROM public.venue_till_sales WHERE id = p_sale_id FOR UPDATE;
  IF p_payment_id IS NOT NULL THEN
    SELECT * INTO v_payment FROM public.venue_till_payments WHERE id = p_payment_id AND sale_id = p_sale_id;
  END IF;
  IF v_sale.id IS NULL OR (p_payment_id IS NOT NULL AND v_payment.id IS NULL)
     OR (p_payment_id IS NULL AND (v_sale.total_due_minor <> 0 OR v_sale.credit_minor <= 0)) THEN
    RAISE EXCEPTION 'till_payment_not_found' USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO v_venue FROM public.venue_listings WHERE id = v_sale.venue_id;
  v_actor := COALESCE(p_actor, v_payment.taken_by_user_id);
  v_day := public.issue_4490_till_business_date(v_sale.venue_id, v_now);

  -- Every child becomes final.
  FOR v_line IN
    SELECT l.* FROM public.venue_till_lines l WHERE l.sale_id = v_sale.id AND l.state = 'held' ORDER BY l.created_at, l.id
  LOOP
    IF v_line.kind IN ('entry', 'group_package') THEN
      -- As the gate's cash path: holds become commitments, the booking is
      -- confirmed, today's entry admits the guests.
      SELECT * INTO v_hold FROM public.stay_inventory_holds
      WHERE group_id = v_line.stay_group_id AND state = 'active' FOR UPDATE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'till_hold_lapsed' USING ERRCODE = 'PT409';
      END IF;
      UPDATE public.stay_reservation_groups SET state = 'finalizing', version = version + 1, updated_at = v_now
      WHERE id = v_line.stay_group_id;
      INSERT INTO public.stay_inventory_commitments (
        group_id, reservation_line_id, resource_type, offering_id, place_window_id, quantity
      )
      SELECT v_line.stay_group_id, s.reservation_line_id, s.resource_type, s.offering_id, s.place_window_id, s.quantity
      FROM public.stay_inventory_hold_slices s WHERE s.hold_id = v_hold.id ORDER BY s.id;
      UPDATE public.stay_inventory_holds SET state = 'converted', reason = 'till_paid', version = version + 1,
        updated_at = v_now
      WHERE id = v_hold.id;
      UPDATE public.stay_reservation_lines SET state = 'confirmed', version = version + 1, updated_at = v_now
      WHERE group_id = v_line.stay_group_id AND state = 'payment_pending';
      UPDATE public.stay_reservation_groups SET state = 'confirmed', version = version + 1, updated_at = v_now
      WHERE id = v_line.stay_group_id;
      INSERT INTO public.stay_reservation_events (
        group_id, event_type, actor_type, actor_user_id, idempotency_key, safe_metadata
      ) VALUES (
        v_line.stay_group_id, 'stay_offer_till_paid', 'staff', v_actor,
        'till-paid:' || v_line.stay_group_id,
        jsonb_build_object('method', COALESCE(v_payment.method, 'table_deposit'), 'amountMinor', v_line.amount_minor::text,
          'currencyCode', v_sale.currency, 'saleId', v_sale.id)
      );
      SELECT id INTO v_pass FROM public.venue_passes WHERE group_id = v_line.stay_group_id;
      IF v_pass IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.venue_passes p
        WHERE p.id = v_pass AND p.valid_local_date = public.issue_4490_venue_local_date(v_sale.venue_id)) THEN
        PERFORM public.issue_4490_admit_pass(v_venue, v_pass, NULL, true, v_actor, 'gate_sale');
      END IF;
    END IF;
    IF v_line.kind IN ('entry', 'group_package', 'balance', 'by_the_hour') THEN
      -- #4490 08-O4 fix 1 (O4-T3): recorded on its booking by what paid it,
      -- each payment's part against that payment, the deposit's part as
      -- table_deposit (never takings).
      FOR v_fund IN
        SELECT f.payment_id, f.amount_minor FROM public.issue_4490_till_line_funding(v_sale.id) f
        WHERE f.line_id = v_line.id ORDER BY f.payment_id NULLS FIRST
      LOOP
        IF v_fund.payment_id IS NULL THEN
          PERFORM public.issue_4490_record_till_credit(
            v_line.stay_group_id, v_fund.amount_minor, v_sale.id, v_actor, 'till-credit:' || v_line.id);
        ELSE
          PERFORM public.issue_4490_record_till_offer_payment(
            v_line.stay_group_id, v_fund.amount_minor, v_fund.payment_id,
            'till-line:' || v_line.id || ':' || v_fund.payment_id);
        END IF;
      END LOOP;
    END IF;
    UPDATE public.venue_till_lines SET state = 'committed', updated_at = v_now WHERE id = v_line.id;
  END LOOP;

  UPDATE public.venue_orders o
  SET payment_status = 'paid', confirmed_at = v_now, updated_at = v_now
  FROM public.venue_till_lines l
  WHERE l.sale_id = v_sale.id AND l.kind = 'menu_round' AND l.venue_order_id = o.id
    AND l.state = 'committed' AND o.payment_status = 'pending';
  UPDATE public.venue_order_sessions
  SET settlement_method = 'till',
      tab_state = CASE WHEN tab_state IN ('open', 'settling') THEN 'closed' ELSE tab_state END,
      closed_at = CASE WHEN tab_state IN ('open', 'settling') THEN v_now ELSE closed_at END,
      closed_by_user_id = CASE WHEN tab_state IN ('open', 'settling') THEN v_actor ELSE closed_by_user_id END,
      updated_at = v_now
  WHERE id = v_sale.session_id;
  UPDATE public.venue_till_sales
  SET state = 'paid', business_date = v_day, paid_at = v_now, version = version + 1, updated_at = v_now
  WHERE id = v_sale.id;
END;
$function$;

-- "Paid in today" (latest body: 589490 + 599490), the deposit part and
-- refunds of one payment counted as above.
CREATE OR REPLACE FUNCTION public.issue_4490_venue_money_day(p_venue_id uuid, p_local_date date)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_online bigint;
  v_at_venue bigint;
  v_members bigint;
  v_tables bigint;
  v_refunded bigint;
  v_f_online bigint;
  v_f_at_venue bigint;
  v_f_tables bigint;
  v_f_refunded bigint;
  v_cur text;
  v_other boolean;
  v_card bigint;
BEGIN
  -- N128: money is summed in the venue's currency only (its brand's
  -- default_currency); rows in any other currency are never added in, and
  -- otherCurrency says the day had some.
  SELECT upper(b.default_currency) INTO v_cur
  FROM public.venue_listings v JOIN public.brands b ON b.id = v.brand_id WHERE v.id = p_venue_id;
  -- (a) online, by the service day the payment succeeded
  SELECT COALESCE(sum(a.amount_minor), 0)::bigint INTO v_online
  FROM public.stay_payment_attempts a
  JOIN public.stay_reservation_groups g ON g.id = a.group_id
  WHERE g.venue_id = p_venue_id AND a.state = 'succeeded' AND upper(a.currency_code) = v_cur
    AND public.issue_4490_venue_service_date(p_venue_id, a.succeeded_at) = p_local_date;
  -- (b) at the venue (cash, transfer, card at the venue, pay-by-code).
  -- N127: one day rule for every source, the venue's service day. paid_on is
  -- written as the calendar day by default, so cash taken at 01:00 after a
  -- 02:00 close would land on the next day; when paid_on is that default (the
  -- calendar day the row was recorded), the service day of the recording time
  -- is used. A paid_on staff chose for another day is kept as chosen.
  SELECT COALESCE(sum(o.amount_minor), 0)::bigint INTO v_at_venue
  FROM public.venue_offline_payments o
  JOIN public.stay_reservation_groups g ON g.id = o.group_id
  WHERE g.venue_id = p_venue_id AND upper(o.currency_code) = v_cur
    -- #4490 08-O4 fix 1 (O4-T3): the part of a Till line the table deposit
    -- paid was counted as a table deposit on the day it was paid (d).
    AND o.method <> 'table_deposit'
    AND CASE
          -- #4490 08-O1 fix 2 (O1-B3): money taken in the Till lands on the
          -- service day it was taken, the same rule as its refund. Its paid_on
          -- is the Till's own business date, not a day staff chose.
          WHEN o.method = 'till'
            THEN public.issue_4490_venue_service_date(p_venue_id, o.created_at)
          WHEN o.paid_on = (o.created_at AT TIME ZONE public.issue_4490_venue_timezone(p_venue_id))::date
            THEN public.issue_4490_venue_service_date(p_venue_id, o.created_at)
          ELSE o.paid_on
        END = p_local_date;
  -- #4490 spec 08 O2: an offer paid in the Till by tap or scan is Mingla
  -- money: it moves from at-the-venue to online (counted once).
  SELECT COALESCE(sum(o.amount_minor), 0)::bigint INTO v_card
  FROM public.venue_offline_payments o
  JOIN public.stay_reservation_groups g ON g.id = o.group_id
  JOIN public.venue_till_payments tp ON tp.id = o.till_payment_id
  WHERE g.venue_id = p_venue_id AND upper(o.currency_code) = v_cur AND o.method = 'till'
    AND tp.method IN ('tap', 'scan')
    AND public.issue_4490_venue_service_date(p_venue_id, o.created_at) = p_local_date;
  v_at_venue := v_at_venue - v_card;
  v_online := v_online + v_card;
  -- #4490 08-O1 fix 2 (spec 08 §13): a gate sale paid in cash or by transfer
  -- was paid in full at the gate and writes no offline payment row; it counts
  -- on the service day it was taken (the stay_offer_gate_paid event).
  v_at_venue := v_at_venue + COALESCE((
    SELECT sum(g.total_minor) FROM public.stay_reservation_groups g
    JOIN public.stay_reservation_events e
      ON e.group_id = g.id AND e.event_type = 'stay_offer_gate_paid'
    WHERE g.venue_id = p_venue_id AND g.payment_collection = 'property'
      AND upper(g.currency_code) = v_cur
      AND public.issue_4490_venue_service_date(p_venue_id, e.created_at) = p_local_date), 0)::bigint;
  -- (c) membership periods paid at the venue (these write no offline payment row)
  SELECT COALESCE(sum(m.amount_minor), 0)::bigint INTO v_members
  FROM public.venue_membership_periods m
  WHERE m.paid_via = 'venue' AND m.paid_at IS NOT NULL AND upper(m.currency_code) = v_cur
    AND public.issue_4490_member_venue(m.subscription_id) = p_venue_id
    AND public.issue_4490_venue_service_date(p_venue_id, m.paid_at) = p_local_date;
  -- (d) table deposits paid that day. A deposit refunded later flips to
  -- 'refunded' when the refund settles; it was still received that day
  -- (N123), and the refund comes off on its own day through (e).
  SELECT COALESCE(sum(r.fee_cents), 0)::bigint INTO v_tables
  FROM public.reservations r
  WHERE r.venue_id = p_venue_id AND r.payment_status IN ('paid', 'refunded') AND COALESCE(r.fee_cents, 0) > 0
    AND upper(COALESCE(r.fee_currency, v_cur)) = v_cur
    AND public.issue_4490_venue_service_date(p_venue_id, r.created_at) = p_local_date;
  -- (e) refunds raised that day
  SELECT
    COALESCE((SELECT sum(f.amount_minor) FROM public.stay_refunds f
              JOIN public.stay_reservation_groups g ON g.id = f.group_id
              WHERE g.venue_id = p_venue_id
                AND f.state IN ('submitted', 'processing', 'succeeded', 'manual_reconciliation')
                AND upper(f.currency_code) = v_cur
                AND public.issue_4490_venue_service_date(p_venue_id, f.created_at) = p_local_date), 0)
  + COALESCE((SELECT sum(sr.buyer_refund_requested_cents) FROM public.source_refunds sr
              WHERE sr.source_type = 'venue_reservation' AND sr.venue_id = p_venue_id AND upper(sr.currency) = v_cur
                -- N125: a refund that failed or ended with no refund due moved no money.
                AND sr.buyer_state NOT IN ('failed_terminal', 'cancelled_no_refund_due')
                AND public.issue_4490_venue_service_date(p_venue_id, sr.requested_at) = p_local_date), 0)
  -- #4490 spec 08 O1 fix 1: an offer line sold in the Till and refunded there.
  + COALESCE((SELECT sum(l.amount_minor) FROM public.venue_till_lines l
              JOIN public.venue_till_sales s ON s.id = l.sale_id
              WHERE s.venue_id = p_venue_id AND l.state = 'refunded' AND l.kind IN ('entry', 'group_package')
                AND upper(s.currency) = v_cur
                -- #4490 08-O4 fix 1 (O4-T3): a line refunded by its own line
                -- refund; a line cancelled because its payments were refunded
                -- is counted by those refunds just below.
                AND EXISTS (SELECT 1 FROM public.venue_till_refunds r WHERE r.line_id = l.id)
                AND public.issue_4490_venue_service_date(p_venue_id, l.refunded_at) = p_local_date), 0)
  -- #4490 08-O4 fix 1 (O4-T3): a refund of one payment (one share) comes off
  -- by that payment's offer part, on the refund's day.
  + COALESCE((SELECT sum(x.amount_minor) FROM public.issue_4490_till_refund_offer_parts(p_venue_id) x
              JOIN public.stay_reservation_groups g ON g.id = x.group_id
              WHERE upper(g.currency_code) = v_cur
                AND public.issue_4490_venue_service_date(p_venue_id, x.refunded_at) = p_local_date), 0)
  INTO v_refunded;

  -- For today's bookings: the booking side only, all-time money of bookings dated that day.
  WITH day_groups AS (
    SELECT g.id FROM public.stay_reservation_groups g
    WHERE g.venue_id = p_venue_id
      AND g.offer_kind IN ('entry', 'group_package', 'private_hire', 'by_the_hour')
      AND (SELECT w.local_date FROM public.stay_place_windows w
           WHERE w.id = public.issue_4490_group_window_id(g.id)) = p_local_date
  )
  SELECT
    COALESCE((SELECT sum(a.amount_minor) FROM public.stay_payment_attempts a
              WHERE a.group_id IN (SELECT id FROM day_groups) AND a.state = 'succeeded' AND upper(a.currency_code) = v_cur), 0),
    COALESCE((SELECT sum(o.amount_minor) FROM public.venue_offline_payments o
              WHERE o.group_id IN (SELECT id FROM day_groups) AND upper(o.currency_code) = v_cur
                AND o.method <> 'table_deposit'), 0)
    -- #4490 08-O1 fix 2 (spec 08 §13): gate sales paid in cash or by transfer.
    + COALESCE((SELECT sum(g.total_minor) FROM public.stay_reservation_groups g
                WHERE g.id IN (SELECT id FROM day_groups) AND g.payment_collection = 'property'
                  AND upper(g.currency_code) = v_cur
                  AND EXISTS (SELECT 1 FROM public.stay_reservation_events e
                              WHERE e.group_id = g.id AND e.event_type = 'stay_offer_gate_paid')), 0),
    COALESCE((SELECT sum(f.amount_minor) FROM public.stay_refunds f
              WHERE f.group_id IN (SELECT id FROM day_groups)
                AND f.state IN ('submitted', 'processing', 'succeeded', 'manual_reconciliation')
                AND upper(f.currency_code) = v_cur), 0)
    + COALESCE((SELECT sum(l.amount_minor) FROM public.venue_till_lines l
                WHERE l.stay_group_id IN (SELECT id FROM day_groups) AND l.state = 'refunded'
                  AND l.kind IN ('entry', 'group_package')
                  AND EXISTS (SELECT 1 FROM public.venue_till_refunds r WHERE r.line_id = l.id)), 0)
    + COALESCE((SELECT sum(x.amount_minor) FROM public.issue_4490_till_refund_offer_parts(p_venue_id) x
                JOIN public.stay_reservation_groups g ON g.id = x.group_id
                WHERE x.group_id IN (SELECT id FROM day_groups) AND upper(g.currency_code) = v_cur), 0)
  INTO v_f_online, v_f_at_venue, v_f_refunded;

  WITH day_groups AS (
    SELECT g.id FROM public.stay_reservation_groups g
    WHERE g.venue_id = p_venue_id
      AND g.offer_kind IN ('entry', 'group_package', 'private_hire', 'by_the_hour')
      AND (SELECT w.local_date FROM public.stay_place_windows w
           WHERE w.id = public.issue_4490_group_window_id(g.id)) = p_local_date
  )
  SELECT COALESCE(sum(o.amount_minor), 0)::bigint INTO v_card
  FROM public.venue_offline_payments o
  JOIN public.venue_till_payments tp ON tp.id = o.till_payment_id
  WHERE o.group_id IN (SELECT id FROM day_groups) AND upper(o.currency_code) = v_cur
    AND o.method = 'till' AND tp.method IN ('tap', 'scan');
  v_f_at_venue := v_f_at_venue - v_card;
  v_f_online := v_f_online + v_card;

  WITH day_tables AS (
    SELECT r.id, r.fee_cents FROM public.reservations r
    WHERE r.venue_id = p_venue_id AND r.payment_status IN ('paid', 'refunded') AND COALESCE(r.fee_cents, 0) > 0
    AND upper(COALESCE(r.fee_currency, v_cur)) = v_cur
      AND public.issue_4490_venue_service_date(p_venue_id, r.reserved_for) = p_local_date
  )
  SELECT
    COALESCE((SELECT sum(fee_cents) FROM day_tables), 0),
    v_f_refunded + COALESCE((SELECT sum(sr.buyer_refund_requested_cents) FROM public.source_refunds sr
              WHERE sr.source_type = 'venue_reservation' AND sr.venue_id = p_venue_id AND upper(sr.currency) = v_cur
                -- N125: a refund that failed or ended with no refund due moved no money.
                AND sr.buyer_state NOT IN ('failed_terminal', 'cancelled_no_refund_due')
                -- N124: production writes source_id = the checkout session and
                -- subject_id = the reservation.
                AND sr.subject_id IN (SELECT id FROM day_tables)), 0)
  INTO v_f_tables, v_f_refunded;

  SELECT EXISTS (
      SELECT 1 FROM public.stay_payment_attempts a JOIN public.stay_reservation_groups g ON g.id = a.group_id
      WHERE g.venue_id = p_venue_id AND a.state = 'succeeded' AND upper(a.currency_code) <> v_cur
        AND public.issue_4490_venue_service_date(p_venue_id, a.succeeded_at) = p_local_date)
    OR EXISTS (
      SELECT 1 FROM public.venue_offline_payments o JOIN public.stay_reservation_groups g ON g.id = o.group_id
      WHERE g.venue_id = p_venue_id AND upper(o.currency_code) <> v_cur AND o.paid_on BETWEEN p_local_date - 1 AND p_local_date + 1)
    OR EXISTS (
      SELECT 1 FROM public.venue_membership_periods m
      WHERE m.paid_via = 'venue' AND m.paid_at IS NOT NULL AND upper(m.currency_code) <> v_cur
        AND public.issue_4490_member_venue(m.subscription_id) = p_venue_id
        AND public.issue_4490_venue_service_date(p_venue_id, m.paid_at) = p_local_date)
  INTO v_other;

  RETURN jsonb_build_object(
    'localDate', p_local_date,
    'currencyCode', v_cur,
    'otherCurrency', v_other,
    'paidInMinor', v_online + v_at_venue + v_members + v_tables - v_refunded,
    'paidIn', jsonb_build_object(
      'online', v_online, 'atVenue', v_at_venue, 'members', v_members,
      'tableDeposits', v_tables, 'refunded', v_refunded),
    'forTodayPaidMinor', v_f_online + v_f_at_venue + v_f_tables - v_f_refunded,
    'forToday', jsonb_build_object(
      'online', v_f_online, 'atVenue', v_f_at_venue, 'members', 0,
      'tableDeposits', v_f_tables, 'refunded', v_f_refunded)
  );
END;
$function$;

-- ===========================================================================
-- O4-T2: a check the table deposit fully pays can be closed.
-- ===========================================================================
-- Nothing is left to pay (due exactly 0) and something was bought: staff
-- with sell rights close it. No payment is recorded and no money moves; the
-- check is paid, its rounds are paid, the deposit is used (its credit line is
-- committed and can no longer be voided) and today's takings for it are 0.
-- Carries the check version (T10); a retry of a close that went through
-- answers it (replayed). Never a write-off: refused while anything is due.
CREATE FUNCTION public.issue_4490_till_close_covered(p_sale_id uuid, p_actor uuid, p_expected_version integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_sale public.venue_till_sales%ROWTYPE;
BEGIN
  IF p_sale_id IS NULL OR p_expected_version IS NULL THEN
    RAISE EXCEPTION 'till_invalid_payload' USING ERRCODE = '22023';
  END IF;
  v_sale := public.issue_4490_till_lock(p_sale_id, p_actor, NULL);
  -- A close that already went through: nothing more happens.
  IF v_sale.state = 'paid' AND v_sale.paid_minor = 0 AND v_sale.total_due_minor = 0 AND v_sale.credit_minor > 0
     AND NOT EXISTS (SELECT 1 FROM public.venue_till_payments p
                     WHERE p.sale_id = v_sale.id AND p.state IN ('paid', 'partially_refunded', 'refunded', 'pending')) THEN
    RETURN public.issue_4490_till_sale_projection(v_sale.id) || jsonb_build_object('replayed', true, 'closed', true);
  END IF;
  IF p_expected_version <> v_sale.version THEN
    RAISE EXCEPTION 'till_check_changed' USING ERRCODE = 'PT409';
  END IF;
  IF public.issue_4490_till_release_stale(v_sale.id) > 0 THEN
    SELECT * INTO v_sale FROM public.venue_till_sales WHERE id = v_sale.id FOR UPDATE;
  END IF;
  IF v_sale.state = 'paying'
     OR EXISTS (SELECT 1 FROM public.venue_till_payments p WHERE p.sale_id = v_sale.id AND p.state = 'pending') THEN
    RAISE EXCEPTION 'till_payment_in_progress' USING ERRCODE = 'PT409';
  END IF;
  IF v_sale.state <> 'open' THEN
    RAISE EXCEPTION 'till_check_closed' USING ERRCODE = 'PT409';
  END IF;
  -- As a payment would (T8): an unsent round is sent first; a round another
  -- path settled is never closed here; the check is priced from its children.
  PERFORM public.issue_4490_till_send(v_sale.id, p_actor);
  IF EXISTS (
    SELECT 1 FROM public.venue_till_lines l
    JOIN public.venue_orders o ON o.id = l.venue_order_id
    WHERE l.sale_id = v_sale.id AND l.kind = 'menu_round' AND l.state <> 'voided'
      AND (o.payment_status NOT IN ('pending', 'cancelled') OR o.money_path <> 'venue_collected')) THEN
    RAISE EXCEPTION 'till_round_settled_elsewhere' USING ERRCODE = 'PT409';
  END IF;
  PERFORM public.issue_4490_till_reprice(v_sale.id);
  SELECT * INTO v_sale FROM public.venue_till_sales WHERE id = v_sale.id FOR UPDATE;
  IF v_sale.total_due_minor <> 0 OR v_sale.paid_minor <> 0 OR v_sale.credit_minor <= 0
     OR v_sale.subtotal_minor + v_sale.service_charge_minor <= 0
     OR NOT EXISTS (SELECT 1 FROM public.venue_till_lines l
                    WHERE l.sale_id = v_sale.id AND l.kind = 'deposit_credit' AND l.state = 'held') THEN
    RAISE EXCEPTION 'till_close_not_covered' USING ERRCODE = 'PT409';
  END IF;
  PERFORM public.issue_4490_till_finalize_paid(v_sale.id, NULL, p_actor);
  RETURN public.issue_4490_till_sale_projection(v_sale.id) || jsonb_build_object('replayed', false, 'closed', true);
END;
$$;

-- ===========================================================================
-- O4-T4: a staff-started session needs its unit free from NOW.
-- ===========================================================================
-- "Start a session now" (latest body: 607490). The start is still rounded to
-- the offer's step and priced for that window; the claim now also covers the
-- time from now to the rounded start (the guests are admitted at once), so a
-- unit still in use is refused offer_space_taken with the time it frees up
-- (freeAt) or, when it is free now but booked before the session would end,
-- the next booking's time (nextAt). A start rounded down keeps its claim
-- from the rounded start (already before now), as built.
CREATE OR REPLACE FUNCTION public.issue_4490_till_start_session(
  p_sale_id uuid,
  p_offering_id uuid,
  p_space_id uuid,
  p_minutes integer,
  p_guests integer,
  p_actor uuid,
  p_idempotency_key text,
  p_expected_version integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_sale public.venue_till_sales%ROWTYPE;
  v_offer public.stay_offerings%ROWTYPE;
  v_day public.stay_place_windows%ROWTYPE;
  v_key text := btrim(COALESCE(p_idempotency_key, ''));
  v_step integer;
  v_start timestamptz;
  v_window uuid;
  v_claim tstzrange;
  v_units uuid[];
  v_unit uuid;
  v_free timestamptz;
  v_next timestamptz;
BEGIN
  IF char_length(v_key) NOT BETWEEN 8 AND 150 OR p_offering_id IS NULL OR p_minutes IS NULL
     OR p_minutes NOT BETWEEN 15 AND 1440 OR (p_guests IS NOT NULL AND p_guests NOT BETWEEN 1 AND 1000) THEN
    RAISE EXCEPTION 'till_invalid_payload' USING ERRCODE = '22023';
  END IF;
  v_sale := public.issue_4490_till_lock(p_sale_id, p_actor, p_expected_version);
  IF public.issue_4490_till_release_stale(v_sale.id) > 0 THEN
    SELECT * INTO v_sale FROM public.venue_till_sales WHERE id = v_sale.id FOR UPDATE;
  END IF;
  IF EXISTS (SELECT 1 FROM public.venue_till_lines l WHERE l.sale_id = v_sale.id AND l.idempotency_key = v_key) THEN
    RETURN public.issue_4490_till_sale_projection(v_sale.id) || jsonb_build_object('replayed', true);
  END IF;
  IF v_sale.state = 'paying' THEN
    RAISE EXCEPTION 'till_payment_in_progress' USING ERRCODE = 'PT409';
  END IF;
  IF v_sale.state <> 'open' THEN
    RAISE EXCEPTION 'till_check_closed' USING ERRCODE = 'PT409';
  END IF;
  SELECT * INTO v_offer FROM public.stay_offerings
  WHERE id = p_offering_id AND venue_id = v_sale.venue_id AND kind = 'by_the_hour' AND status = 'live';
  IF NOT FOUND OR NOT public.issue_4490_venue_feature_on(v_sale.venue_id, 'by_the_hour') THEN
    RAISE EXCEPTION 'offer_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF NOT v_offer.staff_can_start THEN
    RAISE EXCEPTION 'offer_staff_start_off' USING ERRCODE = 'PT409';
  END IF;
  IF NOT public.issue_4490_flag_on('VENUE_OFFERS_WRITES') THEN
    RAISE EXCEPTION 'offers_not_enabled' USING ERRCODE = 'P0001';
  END IF;
  -- Starts now, rounded to the offer's step on the day's grid (half up).
  v_step := COALESCE(v_offer.booking_length_step_minutes, 60);
  SELECT w.* INTO v_day FROM public.stay_place_windows w
  JOIN public.stay_place_schedule_rules r ON r.id = w.schedule_rule_id AND r.active AND r.mode = 'flexible'
  WHERE w.offering_id = v_offer.id AND NOT w.booked_block AND NOT w.stop_sell
    AND now() >= w.starts_at AND now() < w.ends_at
  ORDER BY w.starts_at LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'offer_window_unavailable' USING ERRCODE = 'PT409';
  END IF;
  v_start := v_day.starts_at + make_interval(mins => (v_step * floor(
    (extract(epoch FROM (now() - v_day.starts_at)) / 60.0 + v_step / 2.0) / v_step))::integer);
  IF v_start + make_interval(mins => p_minutes) > v_day.ends_at THEN
    RAISE EXCEPTION 'offer_window_unavailable' USING ERRCODE = 'PT409';
  END IF;
  v_window := public.issue_4490_flexible_window(v_offer.id, v_start, p_minutes);
  -- #4490 08-O4 fix 1 (O4-T4): the guests are let in now, so the unit is
  -- held from now (not only from the rounded start) to the session's end:
  -- a unit still in use is refused. The price stays the rounded window's.
  v_claim := tstzrange(LEAST(now(), v_start - make_interval(mins => v_offer.buffer_before_minutes)),
                       v_start + make_interval(mins => p_minutes + v_offer.buffer_after_minutes), '[)');
  BEGIN
    PERFORM public.issue_4490_till_session_book(
      v_sale.id, v_offer.id, v_window, p_space_id, p_guests, p_actor, v_key, v_claim, NULL);
  EXCEPTION WHEN SQLSTATE 'PT409' THEN
    IF SQLERRM <> 'offer_space_taken' THEN
      RAISE;
    END IF;
    -- Say when it frees up (in use now), or when the next booking starts.
    v_units := CASE WHEN p_space_id IS NOT NULL THEN ARRAY[p_space_id]
                    ELSE ARRAY(SELECT os.space_id FROM public.venue_offer_spaces os
                               WHERE os.offering_id = v_offer.id) END;
    IF NOT EXISTS (
         SELECT 1 FROM unnest(v_units) u(id)
         WHERE NOT EXISTS (SELECT 1 FROM public.venue_space_claims c
                           WHERE c.space_id = u.id AND c.state IN ('held', 'committed') AND c.claim_range @> now())) THEN
      SELECT c.space_id, upper(c.claim_range) INTO v_unit, v_free
      FROM public.venue_space_claims c
      WHERE c.space_id = ANY(v_units) AND c.state IN ('held', 'committed') AND c.claim_range @> now()
      ORDER BY upper(c.claim_range), c.space_id LIMIT 1;
    ELSE
      SELECT c.space_id, lower(c.booked_range) INTO v_unit, v_next
      FROM public.venue_space_claims c
      WHERE c.space_id = ANY(v_units) AND c.state IN ('held', 'committed') AND c.claim_range && v_claim
        AND NOT c.claim_range @> now()
      ORDER BY lower(c.booked_range), c.space_id LIMIT 1;
    END IF;
    RAISE EXCEPTION 'offer_space_taken' USING ERRCODE = 'PT409',
      DETAIL = jsonb_build_object('unitName', (SELECT s.name FROM public.venue_spaces s WHERE s.id = v_unit),
        'freeAt', v_free, 'nextAt', v_next)::text;
  END;
  PERFORM public.issue_4490_till_reprice(v_sale.id);
  RETURN public.issue_4490_till_sale_projection(v_sale.id) || jsonb_build_object('replayed', false);
END;
$$;

-- ---------------------------------------------------------------------------
-- Privileges: every new function is internal (service role only).
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION
  public.issue_4490_reservation_deposit_owned(),
  public.issue_4490_record_till_credit(uuid, bigint, uuid, uuid, text),
  public.issue_4490_till_line_funding(uuid),
  public.issue_4490_till_refund_offer_parts(uuid),
  public.issue_4490_till_close_covered(uuid, uuid, integer)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
  public.issue_4490_record_till_credit(uuid, bigint, uuid, uuid, text),
  public.issue_4490_till_line_funding(uuid),
  public.issue_4490_till_refund_offer_parts(uuid),
  public.issue_4490_till_close_covered(uuid, uuid, integer)
TO service_role;

COMMIT;
