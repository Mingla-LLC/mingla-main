-- Issue #4490, spec 08 O1 fix round 1 (slot 59, "spare for fixes").
--
-- One owner per truth: a tab and its Till check are the same bill.
--
-- 1. The old order pad and the Till (spec 08 §11 T18, §3 O1 subtract list).
--    a. A tab the pad closes (venue_collected, or a bill_to_phone bill that
--       lands) closes its Till check in the same transaction, with the pad's
--       settlement carried (no Till payment is invented). A tab closed with
--       nothing on it closes its check as voided.
--    b. While the Till runs at a venue the pad's money actions are refused
--       (tab_close here; settle in venue-order-staff through
--       issue_4490_pad_guard). A check that already holds Till money can
--       never be closed by the pad. tab_open refuses a check the Till opened.
--    c. Backfill: checks whose tab the pad already closed are closed now (the
--       pad's settlement carried; Till money already on such a check is beyond
--       what was due and is kept in overpaid_minor for a refund).
--    d. The Till refuses a check whose tab the pad closed or billed, and never
--       takes money for a round another path settled.
--    e. A standalone pad order at a venue running the Till joins a check
--       (the Till takes its money), as a pad tab does.
--    f. The Orders queue cannot cancel a round on an open Till check while
--       the Till runs (a void goes through the Till, sent items need money
--       rights); with the Till off a queue cancel reprices the check at once.
--       A venue's refund decision never applies to a Till round or carrier.
-- 2. A part-paid check can still be corrected: unpaid lines are voided by the
--    usual rights; if what was paid then covers the rest the check closes as
--    paid and any excess is kept in overpaid_minor (refund it in the Till).
-- 3. Refunding an offer line sold in the Till cancels its booking through the
--    venue offer cancel path (issue_4490_cancel: capacity released), marks its
--    pass refunded and counts the refund once in the day's money on the
--    service day it happens. A full refund of every payment does the same for
--    every offer line on the check. Line refunds are full-line only (spec 08
--    §3 O1 Refunds: "per line or amount"; nothing quantity-based).
-- 4. One guest-list arrival sits on at most one open check line.
-- 5. Payments carry a sequence number: receipts order "paid before" by it.
-- 6. The Till lists who may take over a check (T9 change server).
--
-- No venue_id column is added (the #2099 dependency seal is unchanged).
-- Static SQL. Local stack only until Seth approves a production migration.

BEGIN;
SET LOCAL lock_timeout = '5s';

-- Checked patches: each old text must appear exactly as many times as stated.
CREATE FUNCTION pg_temp.issue_4490_f1_patch(
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
    RAISE EXCEPTION 'issue_4490 O1 fix 1 patch precondition failed for %: old % (expected %)',
      p_sig, v_old_count, p_count;
  END IF;
  EXECUTE replace(v_def, p_old, p_new);
END;
$patch$;

-- Replace one block between two markers (each found once, end after start).
CREATE FUNCTION pg_temp.issue_4490_f1_patch_between(
  p_sig regprocedure,
  p_start text,
  p_end text,
  p_new text
)
RETURNS void
LANGUAGE plpgsql
AS $patch$
DECLARE
  v_def text := pg_get_functiondef(p_sig);
  v_start integer;
  v_end integer;
BEGIN
  IF (length(v_def) - length(replace(v_def, p_start, ''))) / length(p_start) <> 1 THEN
    RAISE EXCEPTION 'issue_4490 O1 fix 1 block start not found once in %', p_sig;
  END IF;
  v_start := strpos(v_def, p_start);
  v_end := strpos(substr(v_def, v_start), p_end);
  IF v_end = 0 THEN
    RAISE EXCEPTION 'issue_4490 O1 fix 1 block end not found in %', p_sig;
  END IF;
  v_end := v_start + v_end - 1 + length(p_end);
  EXECUTE substr(v_def, 1, v_start - 1) || p_new || substr(v_def, v_end);
END;
$patch$;

-- ---------------------------------------------------------------------------
-- 0. Columns.
-- ---------------------------------------------------------------------------
-- How a check was settled outside the Till (the old order pad closed its tab).
ALTER TABLE public.venue_till_sales
  ADD COLUMN settled_outside text NULL
    CHECK (settled_outside IS NULL OR settled_outside IN ('venue_collected', 'bill_to_phone'));

-- A real order for payments (receipts' "paid before"; never the uuid).
CREATE SEQUENCE public.venue_till_payments_seq AS bigint;
ALTER TABLE public.venue_till_payments ADD COLUMN seq bigint NULL;
UPDATE public.venue_till_payments p
SET seq = ordered.n
FROM (SELECT id, row_number() OVER (ORDER BY created_at, id) AS n FROM public.venue_till_payments) ordered
WHERE ordered.id = p.id;
SELECT setval('public.venue_till_payments_seq',
  GREATEST(COALESCE((SELECT max(seq) FROM public.venue_till_payments), 0), 1),
  (SELECT max(seq) FROM public.venue_till_payments) IS NOT NULL);
ALTER TABLE public.venue_till_payments
  ALTER COLUMN seq SET DEFAULT nextval('public.venue_till_payments_seq'),
  ALTER COLUMN seq SET NOT NULL;
ALTER SEQUENCE public.venue_till_payments_seq OWNED BY public.venue_till_payments.seq;
REVOKE ALL ON SEQUENCE public.venue_till_payments_seq FROM PUBLIC, anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.venue_till_payments_seq TO service_role;
CREATE UNIQUE INDEX venue_till_payments_seq_uniq ON public.venue_till_payments (seq);

-- An offer line refunded in the Till (its booking cancelled).
ALTER TABLE public.venue_till_lines
  ADD COLUMN refunded_at timestamptz NULL,
  ADD CONSTRAINT venue_till_lines_refund_shape CHECK ((state = 'refunded') = (refunded_at IS NOT NULL));
ALTER TABLE public.venue_till_refunds
  ADD COLUMN line_id uuid NULL REFERENCES public.venue_till_lines(id) ON DELETE RESTRICT;
CREATE INDEX venue_till_refunds_line_idx ON public.venue_till_refunds (line_id) WHERE line_id IS NOT NULL;

-- One guest-list arrival on at most one open check line.
CREATE UNIQUE INDEX venue_till_lines_guest_list_live_uniq ON public.venue_till_lines (guest_list_entry_id)
  WHERE guest_list_entry_id IS NOT NULL AND state = 'held';

-- ---------------------------------------------------------------------------
-- 1. The check's projection and receipts follow the new columns.
-- ---------------------------------------------------------------------------
SELECT pg_temp.issue_4490_f1_patch(
  'public.issue_4490_till_sale_projection(uuid)'::regprocedure,
  $old$'remainingMinor', GREATEST(s.total_due_minor - s.paid_minor, 0), 'overpaidMinor', s.overpaid_minor,$old$,
  $new$'remainingMinor', CASE WHEN s.settled_outside IS NOT NULL THEN 0
                             ELSE GREATEST(s.total_due_minor - s.paid_minor, 0) END,
    'overpaidMinor', s.overpaid_minor, 'settledOutside', s.settled_outside,$new$
);
SELECT pg_temp.issue_4490_f1_patch(
  'public.issue_4490_till_sale_projection(uuid)'::regprocedure,
  $old$'createdAt', l.created_at)$old$,
  $new$'createdAt', l.created_at, 'refundedAt', l.refunded_at)$new$
);
SELECT pg_temp.issue_4490_f1_patch(
  'public.issue_4490_till_sale_projection(uuid)'::regprocedure,
  $old$        ORDER BY p.created_at, p.id)
      FROM public.venue_till_payments p WHERE p.sale_id = s.id), '[]'::jsonb)$old$,
  $new$        ORDER BY p.seq)
      FROM public.venue_till_payments p WHERE p.sale_id = s.id), '[]'::jsonb)$new$
);
SELECT pg_temp.issue_4490_f1_patch(
  'public.issue_4490_till_receipt_build(uuid)'::regprocedure,
  $old$AND (o2.paid_at < p.paid_at OR (o2.paid_at = p.paid_at AND o2.id < p.id))), 0),$old$,
  $new$AND (o2.paid_at < p.paid_at OR (o2.paid_at = p.paid_at AND o2.seq < p.seq))), 0),$new$
);

-- ---------------------------------------------------------------------------
-- 2. Finalizing a fully paid check is one function (apply_payment and a void
--    that leaves the check covered both use it).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.issue_4490_till_finalize_paid(
  p_sale_id uuid,
  p_payment_id uuid,
  p_actor uuid
)
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
  SELECT * INTO v_payment FROM public.venue_till_payments WHERE id = p_payment_id AND sale_id = p_sale_id;
  IF v_sale.id IS NULL OR v_payment.id IS NULL THEN
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
        jsonb_build_object('method', v_payment.method, 'amountMinor', v_line.amount_minor::text,
          'currencyCode', v_sale.currency, 'saleId', v_sale.id)
      );
      PERFORM public.issue_4490_record_till_offer_payment(
        v_line.stay_group_id, v_line.amount_minor, v_payment.id, 'till-line:' || v_line.id);
      SELECT id INTO v_pass FROM public.venue_passes WHERE group_id = v_line.stay_group_id;
      IF v_pass IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.venue_passes p
        WHERE p.id = v_pass AND p.valid_local_date = public.issue_4490_venue_local_date(v_sale.venue_id)) THEN
        PERFORM public.issue_4490_admit_pass(v_venue, v_pass, NULL, true, v_actor, 'gate_sale');
      END IF;
    ELSIF v_line.kind = 'balance' THEN
      PERFORM public.issue_4490_record_till_offer_payment(
        v_line.stay_group_id, v_line.amount_minor, v_payment.id, 'till-line:' || v_line.id);
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

SELECT pg_temp.issue_4490_f1_patch_between(
  'public.issue_4490_till_apply_payment(uuid)'::regprocedure,
  $start$  -- Fully paid: every child becomes final.$start$,
  $end$'salePaid', true, 'paidLate', false);$end$,
  $new$  -- Fully paid: every child becomes final (one finalizer, #4490 O1 fix 1).
  PERFORM public.issue_4490_till_finalize_paid(v_sale.id, v_payment.id, v_payment.taken_by_user_id);
  RETURN jsonb_build_object('paymentId', v_payment.id, 'replayed', false, 'salePaid', true, 'paidLate', false);$new$
);

-- ---------------------------------------------------------------------------
-- 3. Voids on a part-paid check (O1-N3).
-- ---------------------------------------------------------------------------
-- After a void: if the money already taken covers what is left, the check is
-- paid (any excess kept in overpaid_minor for a refund).
CREATE OR REPLACE FUNCTION public.issue_4490_till_settle_after_void(p_sale_id uuid, p_actor uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_sale public.venue_till_sales%ROWTYPE;
  v_payment uuid;
BEGIN
  IF NOT public.issue_1389_service_role() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_sale FROM public.venue_till_sales WHERE id = p_sale_id FOR UPDATE;
  IF NOT FOUND OR v_sale.state <> 'open' OR v_sale.paid_minor = 0
     OR v_sale.paid_minor < v_sale.total_due_minor
     OR EXISTS (SELECT 1 FROM public.venue_till_payments p WHERE p.sale_id = v_sale.id AND p.state = 'pending') THEN
    RETURN;
  END IF;
  UPDATE public.venue_till_sales
  SET overpaid_minor = overpaid_minor + (paid_minor - total_due_minor),
      paid_minor = total_due_minor, updated_at = now()
  WHERE id = v_sale.id;
  SELECT p.id INTO v_payment FROM public.venue_till_payments p
  WHERE p.sale_id = v_sale.id AND p.state IN ('paid', 'partially_refunded', 'refunded') AND NOT p.paid_late
  ORDER BY p.seq DESC LIMIT 1;
  PERFORM public.issue_4490_till_finalize_paid(v_sale.id, v_payment, p_actor);
END;
$function$;

SELECT pg_temp.issue_4490_f1_patch(
  'public.issue_4490_till_void(uuid,uuid,uuid,uuid,text,boolean,integer)'::regprocedure,
  $old$  -- Money already taken on this check: what is paid is not voided (refund it).
  IF v_sale.paid_minor > 0 THEN
    RAISE EXCEPTION 'till_line_paid' USING ERRCODE = 'PT409';
  END IF;
$old$,
  $new$  -- #4490 O1 fix 1: a part payment no longer freezes the check. Until it is
  -- fully paid every line is unpaid and is voided by the usual rights (unsent:
  -- sell; sent: money rights); see issue_4490_till_settle_after_void below.
$new$
);
SELECT pg_temp.issue_4490_f1_patch(
  'public.issue_4490_till_void(uuid,uuid,uuid,uuid,text,boolean,integer)'::regprocedure,
  $old$  -- p_restock is the O5 stock seam: nothing is tracked until stock ships.
  PERFORM public.issue_4490_till_reprice(v_sale.id);
  RETURN public.issue_4490_till_sale_projection(v_sale.id);$old$,
  $new$  -- p_restock is the O5 stock seam: nothing is tracked until stock ships.
  PERFORM public.issue_4490_till_reprice(v_sale.id);
  PERFORM public.issue_4490_till_settle_after_void(v_sale.id, p_actor);
  RETURN public.issue_4490_till_sale_projection(v_sale.id);$new$
);

-- ---------------------------------------------------------------------------
-- 4. The Till side of one bill (O1-N1 d, O1-N2).
-- ---------------------------------------------------------------------------
SELECT pg_temp.issue_4490_f1_patch(
  'public.issue_4490_till_lock(uuid,uuid,integer)'::regprocedure,
  $old$  IF p_expected_version IS NOT NULL AND p_expected_version <> v_sale.version THEN$old$,
  $new$  -- #4490 O1 fix 1: a tab the old order pad closed, or billed to a phone with
  -- the bill still out, is not the Till's to change or take.
  IF EXISTS (
    SELECT 1 FROM public.venue_order_sessions os
    WHERE os.id = v_sale.session_id
      AND ((os.tab_state = 'closed' AND COALESCE(os.settlement_method, '') <> 'till')
           OR (os.tab_state = 'settling' AND EXISTS (
                 SELECT 1 FROM public.venue_orders o
                 WHERE o.session_id = os.id AND COALESCE(o.metadata->>'tab_settlement', '') = 'true'
                   AND o.money_path = 'mingla' AND o.payment_status = 'pending')))) THEN
    RAISE EXCEPTION 'till_tab_settled_on_pad' USING ERRCODE = 'PT409';
  END IF;
  IF p_expected_version IS NOT NULL AND p_expected_version <> v_sale.version THEN$new$
);

SELECT pg_temp.issue_4490_f1_patch(
  'public.issue_4490_till_take_payment(uuid,text,bigint,bigint,bigint,uuid,uuid,uuid,integer)'::regprocedure,
  $old$  PERFORM public.issue_4490_till_send(v_sale.id, p_actor);
  SELECT * INTO v_sale FROM public.venue_till_sales WHERE id = v_sale.id FOR UPDATE;$old$,
  $new$  PERFORM public.issue_4490_till_send(v_sale.id, p_actor);
  -- #4490 O1 fix 1: never take money for a round another path settled, and
  -- price the check from its children right before the money moves.
  IF EXISTS (
    SELECT 1 FROM public.venue_till_lines l
    JOIN public.venue_orders o ON o.id = l.venue_order_id
    WHERE l.sale_id = v_sale.id AND l.kind = 'menu_round' AND l.state <> 'voided'
      AND (o.payment_status NOT IN ('pending', 'cancelled') OR o.money_path <> 'venue_collected')) THEN
    RAISE EXCEPTION 'till_round_settled_elsewhere' USING ERRCODE = 'PT409';
  END IF;
  PERFORM public.issue_4490_till_reprice(v_sale.id);
  SELECT * INTO v_sale FROM public.venue_till_sales WHERE id = v_sale.id FOR UPDATE;$new$
);

-- One guest-list arrival on at most one open check line (O1-N8).
SELECT pg_temp.issue_4490_f1_patch(
  'public.issue_4490_till_add_offer_line(uuid,uuid,uuid,jsonb,uuid,text,uuid,integer)'::regprocedure,
  $old$    v_count := (p_lines->0->>'guests')::integer;$old$,
  $new$    IF EXISTS (SELECT 1 FROM public.venue_till_lines l
               WHERE l.guest_list_entry_id = v_entry.id AND l.state = 'held') THEN
      RAISE EXCEPTION 'guest_list_entry_on_check' USING ERRCODE = 'PT409';
    END IF;
    v_count := (p_lines->0->>'guests')::integer;$new$
);

-- ---------------------------------------------------------------------------
-- 5. The pad closes a tab: its check closes in the same transaction (O1-N1).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.issue_4490_till_close_on_pad(p_session_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_session public.venue_order_sessions%ROWTYPE;
  v_sale public.venue_till_sales%ROWTYPE;
  v_at timestamptz;
BEGIN
  SELECT * INTO v_session FROM public.venue_order_sessions WHERE id = p_session_id;
  IF NOT FOUND OR v_session.tab_state <> 'closed'
     OR COALESCE(v_session.settlement_method, '') NOT IN ('venue_collected', 'bill_to_phone') THEN
    RETURN;
  END IF;
  SELECT * INTO v_sale FROM public.venue_till_sales
  WHERE session_id = p_session_id AND state IN ('open', 'paying') FOR UPDATE;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  v_at := COALESCE(v_session.closed_at, now());
  -- Lines the pad never knew (an unpaid offer or balance line) are dropped;
  -- their held places lapse with the hold.
  UPDATE public.venue_till_lines
  SET state = 'voided', voided_at = v_at, voided_by_user_id = v_session.closed_by_user_id,
      void_reason = 'Closed on the order pad', updated_at = now()
  WHERE sale_id = v_sale.id AND kind <> 'menu_round' AND state = 'held';
  -- The rounds the pad settled are the check's lines, final.
  v_sale := public.issue_4490_till_reprice(v_sale.id);
  UPDATE public.venue_till_lines l
  SET state = 'committed', updated_at = now()
  FROM public.venue_orders o
  WHERE l.sale_id = v_sale.id AND l.kind = 'menu_round' AND l.venue_order_id = o.id
    AND l.state = 'held' AND o.payment_status = 'paid';
  IF v_sale.total_due_minor = 0 AND v_sale.paid_minor = 0 AND v_sale.overpaid_minor = 0 THEN
    UPDATE public.venue_till_sales
    SET state = 'voided', settled_outside = v_session.settlement_method, voided_at = v_at,
        voided_by_user_id = v_session.closed_by_user_id, version = version + 1, updated_at = now()
    WHERE id = v_sale.id;
  ELSE
    -- The pad's settlement covers the whole bill; Till money already on the
    -- check is beyond what was due and stays in overpaid_minor for a refund.
    UPDATE public.venue_till_sales
    SET state = 'paid', settled_outside = v_session.settlement_method,
        overpaid_minor = overpaid_minor + paid_minor, paid_minor = 0,
        paid_at = v_at, business_date = public.issue_4490_till_business_date(v_sale.venue_id, v_at),
        version = version + 1, updated_at = now()
    WHERE id = v_sale.id;
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.issue_4490_till_tab_closed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  PERFORM public.issue_4490_till_close_on_pad(NEW.id);
  RETURN NULL;
END;
$function$;
CREATE TRIGGER issue_4490_till_tab_closed
  AFTER UPDATE OF tab_state ON public.venue_order_sessions
  FOR EACH ROW WHEN (NEW.tab_state = 'closed' AND OLD.tab_state IS DISTINCT FROM 'closed')
  EXECUTE FUNCTION public.issue_4490_till_tab_closed();

-- The pad refuses money while the Till runs, and never touches Till money.
SELECT pg_temp.issue_4490_f1_patch(
  'public.biz_venue_tab_close(uuid,text)'::regprocedure,
  $old$  IF v_session.tab_state NOT IN ('open','settling') THEN
    RAISE EXCEPTION 'tab_not_open' USING ERRCODE = 'P0001';
  END IF;$old$,
  $new$  IF v_session.tab_state NOT IN ('open','settling') THEN
    RAISE EXCEPTION 'tab_not_open' USING ERRCODE = 'P0001';
  END IF;
  -- #4490 spec 08 O1 fix 1: one bill, one owner. While the Till runs at the
  -- venue it takes the money; a check holding Till money is never closed here.
  IF public.issue_4490_till_enabled(v_session.venue_id) OR EXISTS (
       SELECT 1 FROM public.venue_till_sales s
       JOIN public.venue_till_payments p ON p.sale_id = s.id
       WHERE s.session_id = p_session_id AND p.state NOT IN ('cancelled', 'failed')) THEN
    RAISE EXCEPTION 'tab_on_till' USING ERRCODE = 'P0001';
  END IF;$new$
);
SELECT pg_temp.issue_4490_f1_patch(
  'public.biz_venue_tab_open(uuid)'::regprocedure,
  $old$  IF v_session.tab_state <> 'none' THEN
    RAISE EXCEPTION 'tab_not_open' USING ERRCODE = 'P0001';
  END IF;$old$,
  $new$  IF v_session.tab_state <> 'none' THEN
    RAISE EXCEPTION 'tab_not_open' USING ERRCODE = 'P0001';
  END IF;
  -- #4490 spec 08 O1 fix 1: a check the Till opened is never turned into a tab.
  IF EXISTS (SELECT 1 FROM public.venue_till_sales s
             WHERE s.session_id = p_session_id AND s.idempotency_key IS NOT NULL) THEN
    RAISE EXCEPTION 'tab_on_till' USING ERRCODE = 'P0001';
  END IF;$new$
);

-- A round an old app adds reprices its check; while the Till runs, a
-- standalone pad order joins a check of its own so the Till takes its money.
CREATE OR REPLACE FUNCTION public.issue_4490_till_round_added()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_sale_id uuid;
  v_state text;
BEGIN
  IF NEW.till_payment_id IS NULL AND coalesce(NEW.metadata->>'tab_settlement', '') <> 'true'
     AND NEW.fulfillment_status NOT IN ('held', 'payment_only') THEN
    SELECT s.id, s.state INTO v_sale_id, v_state FROM public.venue_till_sales s
    WHERE s.session_id = NEW.session_id;
    IF v_sale_id IS NULL AND NEW.money_path = 'venue_collected' AND NEW.payment_status = 'pending'
       AND NEW.taken_by_user_id IS NOT NULL AND public.issue_4490_till_enabled(NEW.venue_id) THEN
      INSERT INTO public.venue_till_sales (
        brand_id, venue_id, session_id, check_label, qr_spot_id, server_user_id, opened_by_user_id,
        opened_business_date, currency, created_at
      ) VALUES (
        NEW.brand_id, NEW.venue_id, NEW.session_id,
        NULLIF(btrim(left(COALESCE(NEW.buyer_name,
          (SELECT q.label FROM public.qr_spots q WHERE q.id = NEW.qr_spot_id), ''), 40)), ''),
        CASE WHEN NOT EXISTS (SELECT 1 FROM public.venue_till_sales s
                              WHERE s.qr_spot_id = NEW.qr_spot_id AND s.state IN ('open', 'paying'))
             THEN NEW.qr_spot_id END,
        NEW.taken_by_user_id, NEW.taken_by_user_id,
        public.issue_4490_till_business_date(NEW.venue_id, NEW.created_at), upper(NEW.currency), NEW.created_at
      )
      ON CONFLICT (session_id) DO NOTHING
      RETURNING id, state INTO v_sale_id, v_state;
    END IF;
    IF v_sale_id IS NOT NULL AND v_state = 'open' AND NOT EXISTS (
      SELECT 1 FROM public.venue_till_lines l WHERE l.venue_order_id = NEW.id) THEN
      PERFORM public.issue_4490_till_reprice(v_sale_id);
    END IF;
  END IF;
  RETURN NULL;
END;
$function$;

-- The Orders queue: no cancel of an open Till check's round while the Till
-- runs; with the Till off the check is repriced in the same transaction.
SELECT pg_temp.issue_4490_f1_patch(
  'public.biz_venue_order_transition(uuid,text,text)'::regprocedure,
  $old$  UPDATE public.venue_orders SET fulfillment_status=p_to,$old$,
  $new$  -- #4490 spec 08 O1 fix 1: a Till round is voided in the Till (money rights
  -- for a sent item), never cancelled from the queue while the Till runs.
  IF p_to='cancelled' AND public.issue_4490_till_enabled(v_order.venue_id) AND EXISTS (
       SELECT 1 FROM public.venue_till_lines l JOIN public.venue_till_sales s ON s.id=l.sale_id
       WHERE l.venue_order_id=p_order_id AND s.state IN ('open','paying')) THEN
    RAISE EXCEPTION 'transition_not_allowed' USING ERRCODE='P0001';
  END IF;
  UPDATE public.venue_orders SET fulfillment_status=p_to,$new$
);
SELECT pg_temp.issue_4490_f1_patch(
  'public.biz_venue_order_transition(uuid,text,text)'::regprocedure,
  $old$  RETURN jsonb_build_object('orderId',p_order_id,'fulfillmentStatus',p_to,'actorUserId',v_uid);$old$,
  $new$  IF p_to='cancelled' THEN
    PERFORM public.issue_4490_till_reprice(s.id) FROM public.venue_till_sales s
    WHERE s.session_id=v_order.session_id AND s.state='open';
  END IF;
  RETURN jsonb_build_object('orderId',p_order_id,'fulfillmentStatus',p_to,'actorUserId',v_uid);$new$
);
SELECT pg_temp.issue_4490_f1_patch(
  'public.biz_venue_order_refund_decision(uuid,text,text)'::regprocedure,
  $old$  IF NOT FOUND THEN
    RAISE EXCEPTION 'order_not_found' USING ERRCODE = 'P0002';
  END IF;$old$,
  $new$  IF NOT FOUND THEN
    RAISE EXCEPTION 'order_not_found' USING ERRCODE = 'P0002';
  END IF;
  -- #4490 spec 08 O1 fix 1: Till rounds and card carriers are refunded in the Till.
  IF v_order.till_payment_id IS NOT NULL
     OR EXISTS (SELECT 1 FROM public.venue_till_lines l WHERE l.venue_order_id = v_order.id) THEN
    RAISE EXCEPTION 'transition_not_allowed' USING ERRCODE = 'P0001';
  END IF;$new$
);

-- The old pad's other money actions (venue-order-staff create / settle) ask
-- here first. 'ok' | 'not_found' | 'not_authorized' | 'session_closed' (a Till
-- check that is no longer open) | 'till_round' (the order belongs to a Till
-- check) | 'till_on' (the venue runs the Till). Access: a brand role
-- (rank > 0, the pad's own rule on main) or venue.sell at that venue.
CREATE OR REPLACE FUNCTION public.issue_4490_pad_guard(
  p_action text,
  p_order_id uuid,
  p_session_id uuid,
  p_venue_id uuid,
  p_actor uuid
)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_order public.venue_orders%ROWTYPE;
  v_venue uuid := p_venue_id;
  v_session uuid := p_session_id;
  v_brand uuid;
BEGIN
  IF NOT public.issue_1389_service_role() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_action IS NULL OR p_action NOT IN ('create', 'settle') THEN
    RAISE EXCEPTION 'till_invalid_payload' USING ERRCODE = '22023';
  END IF;
  IF p_order_id IS NOT NULL THEN
    SELECT * INTO v_order FROM public.venue_orders WHERE id = p_order_id;
    IF NOT FOUND THEN
      RETURN 'not_found';
    END IF;
    v_venue := v_order.venue_id;
    v_session := v_order.session_id;
  END IF;
  SELECT brand_id INTO v_brand FROM public.venue_listings WHERE id = v_venue;
  IF v_brand IS NULL THEN
    RETURN 'not_found';
  END IF;
  IF p_actor IS NULL OR NOT (
       public.biz_brand_effective_rank(v_brand, p_actor) > 0
       OR public.issue_4490_can_sell(v_venue, p_actor)) THEN
    RETURN 'not_authorized';
  END IF;
  IF p_action = 'create' THEN
    IF v_session IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.venue_till_sales s WHERE s.session_id = v_session AND s.state <> 'open') THEN
      RETURN 'session_closed';
    END IF;
    RETURN 'ok';
  END IF;
  IF p_order_id IS NULL THEN
    RAISE EXCEPTION 'till_invalid_payload' USING ERRCODE = '22023';
  END IF;
  IF v_order.till_payment_id IS NOT NULL OR (v_order.metadata ? 'till_sale_id')
     OR EXISTS (SELECT 1 FROM public.venue_till_lines l WHERE l.venue_order_id = v_order.id)
     OR EXISTS (SELECT 1 FROM public.venue_till_sales s WHERE s.session_id = v_order.session_id) THEN
    RETURN 'till_round';
  END IF;
  IF public.issue_4490_till_enabled(v_venue) THEN
    RETURN 'till_on';
  END IF;
  RETURN 'ok';
END;
$function$;

-- Backfill (O1-N1 c): checks whose tab the pad already closed.
SELECT public.issue_4490_till_close_on_pad(s.session_id)
FROM public.venue_till_sales s
JOIN public.venue_order_sessions os ON os.id = s.session_id
WHERE s.state IN ('open', 'paying') AND os.tab_state = 'closed'
  AND COALESCE(os.settlement_method, '') IN ('venue_collected', 'bill_to_phone')
ORDER BY s.created_at, s.id;

-- ---------------------------------------------------------------------------
-- 6. Refunding an offer line cancels its booking (O1-N4).
-- ---------------------------------------------------------------------------
-- Cancel the bookings of the check's paid offer lines (all, or the ones
-- named) through the venue offer cancel path, mark their passes refunded and
-- the lines refunded (counted once in the day's money on the refund's day).
CREATE OR REPLACE FUNCTION public.issue_4490_till_cancel_offer_lines(
  p_sale_id uuid,
  p_line_ids uuid[],
  p_actor uuid,
  p_reason text
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_line public.venue_till_lines%ROWTYPE;
  v_group public.stay_reservation_groups%ROWTYPE;
  v_preview jsonb;
  v_reason text := left('Refunded at the venue: ' || COALESCE(NULLIF(btrim(COALESCE(p_reason, '')), ''), 'refund'), 500);
  v_count integer := 0;
BEGIN
  IF NOT public.issue_1389_service_role() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  FOR v_line IN
    SELECT l.* FROM public.venue_till_lines l
    WHERE l.sale_id = p_sale_id AND l.kind IN ('entry', 'group_package') AND l.state = 'committed'
      AND (p_line_ids IS NULL OR l.id = ANY(p_line_ids))
    ORDER BY l.created_at, l.id
    FOR UPDATE
  LOOP
    SELECT * INTO v_group FROM public.stay_reservation_groups WHERE id = v_line.stay_group_id;
    IF v_group.state IN ('confirmed', 'partially_cancelled') THEN
      v_preview := public.issue_4490_cancel_preview(v_group.id, NULL, p_actor);
      PERFORM public.issue_4490_cancel(
        ARRAY(SELECT (x #>> '{}')::uuid FROM jsonb_array_elements(v_preview->'previewIds') x),
        v_preview->>'previewHash', 'till-refund:' || v_line.id, v_reason, NULL, p_actor);
    END IF;
    -- The cancel voids the pass; the Till says why: it was refunded.
    UPDATE public.venue_passes SET status = 'refunded', version = version + 1, updated_at = now()
    WHERE group_id = v_line.stay_group_id AND status <> 'refunded';
    UPDATE public.venue_till_lines SET state = 'refunded', refunded_at = now(), updated_at = now()
    WHERE id = v_line.id;
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$function$;

-- When every payment's amount is back, every offer line is refunded too.
CREATE OR REPLACE FUNCTION public.issue_4490_till_cancel_offers_if_refunded(
  p_sale_id uuid,
  p_actor uuid,
  p_reason text
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF NOT public.issue_1389_service_role() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
       SELECT 1 FROM public.venue_till_payments p
       WHERE p.sale_id = p_sale_id AND p.state IN ('paid', 'partially_refunded', 'refunded') AND NOT p.paid_late)
     OR EXISTS (
       SELECT 1 FROM public.venue_till_payments p
       WHERE p.sale_id = p_sale_id AND p.state IN ('paid', 'partially_refunded', 'refunded') AND NOT p.paid_late
         AND p.amount_minor > COALESCE((SELECT sum(r.amount_minor) FROM public.venue_till_refunds r
                                        WHERE r.payment_id = p.id), 0)) THEN
    RETURN 0;
  END IF;
  RETURN public.issue_4490_till_cancel_offer_lines(p_sale_id, NULL, p_actor, p_reason);
END;
$function$;

SELECT pg_temp.issue_4490_f1_patch(
  'public.issue_4490_till_refund(uuid,bigint,bigint,text,boolean,uuid,uuid,uuid)'::regprocedure,
  $old$  RETURN jsonb_build_object('refundId', v_refund_id, 'replayed', false,$old$,
  $new$  PERFORM public.issue_4490_till_cancel_offers_if_refunded(v_sale.id, p_actor, v_reason);
  RETURN jsonb_build_object('refundId', v_refund_id, 'replayed', false,$new$
);
SELECT pg_temp.issue_4490_f1_patch(
  'public.issue_4490_till_mint_carrier_refund(uuid,bigint,bigint,uuid,uuid,text,uuid)'::regprocedure,
  $old$  RETURN jsonb_build_object('refundId', v_till_refund_id, 'sourceRefundId', v_refund.id,$old$,
  $new$  PERFORM public.issue_4490_till_cancel_offers_if_refunded(v_sale.id, p_actor, v_reason);
  RETURN jsonb_build_object('refundId', v_till_refund_id, 'sourceRefundId', v_refund.id,$new$
);

-- Refund one paid offer line (full line). The money comes back from the
-- check's cash and own-machine payments (cash first, latest first), then the
-- booking is cancelled. Money rights.
CREATE OR REPLACE FUNCTION public.issue_4490_till_refund_line(
  p_line_id uuid,
  p_actor uuid,
  p_device_user uuid,
  p_reason text,
  p_client_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_line public.venue_till_lines%ROWTYPE;
  v_sale public.venue_till_sales%ROWTYPE;
  v_payment record;
  v_reason text := btrim(COALESCE(p_reason, ''));
  v_left bigint;
  v_take bigint;
  v_done_amount bigint;
  v_done_tip bigint;
BEGIN
  IF NOT public.issue_1389_service_role() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_line_id IS NULL OR p_client_request_id IS NULL OR char_length(v_reason) NOT BETWEEN 1 AND 60 THEN
    RAISE EXCEPTION 'till_invalid_payload' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_line FROM public.venue_till_lines WHERE id = p_line_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'till_line_not_found' USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO v_sale FROM public.venue_till_sales WHERE id = v_line.sale_id FOR UPDATE;
  SELECT * INTO v_line FROM public.venue_till_lines WHERE id = p_line_id FOR UPDATE;
  IF NOT public.issue_4490_till_enabled(v_sale.venue_id) THEN
    RAISE EXCEPTION 'till_not_enabled' USING ERRCODE = 'P0001';
  END IF;
  IF NOT public.issue_4490_can_manage_money(v_sale.venue_id, p_actor) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  -- Replay: the same request returns what it did.
  IF EXISTS (SELECT 1 FROM public.venue_till_refunds r
             WHERE r.line_id = v_line.id AND r.client_request_id = p_client_request_id) THEN
    RETURN jsonb_build_object('replayed', true, 'sale', public.issue_4490_till_sale_projection(v_sale.id));
  END IF;
  IF v_line.kind NOT IN ('entry', 'group_package') THEN
    RAISE EXCEPTION 'till_refund_line_invalid' USING ERRCODE = '22023';
  END IF;
  IF v_line.state <> 'committed' THEN
    RAISE EXCEPTION 'till_line_not_paid' USING ERRCODE = 'PT409';
  END IF;
  v_left := v_line.amount_minor;
  FOR v_payment IN
    SELECT p.* FROM public.venue_till_payments p
    WHERE p.sale_id = v_sale.id AND p.state IN ('paid', 'partially_refunded') AND NOT p.paid_late
      AND p.method IN ('cash', 'own_machine')
    ORDER BY (p.method = 'cash') DESC, p.seq DESC
    FOR UPDATE
  LOOP
    EXIT WHEN v_left <= 0;
    SELECT COALESCE(sum(r.amount_minor), 0), COALESCE(sum(r.tip_minor), 0) INTO v_done_amount, v_done_tip
    FROM public.venue_till_refunds r WHERE r.payment_id = v_payment.id;
    v_take := LEAST(v_payment.amount_minor - v_done_amount, v_left);
    CONTINUE WHEN v_take <= 0;
    INSERT INTO public.venue_till_refunds (
      payment_id, amount_minor, tip_minor, method, reason, by_user_id, device_user_id, business_date,
      restocked, client_request_id, line_id
    ) VALUES (
      v_payment.id, v_take, 0, v_payment.method, v_reason, p_actor, COALESCE(p_device_user, p_actor),
      public.issue_4490_till_business_date(v_sale.venue_id, now()), false, p_client_request_id, v_line.id
    );
    UPDATE public.venue_till_payments
    SET state = CASE WHEN v_done_amount + v_take = amount_minor AND v_done_tip = tip_minor
                     THEN 'refunded' ELSE 'partially_refunded' END,
        updated_at = now()
    WHERE id = v_payment.id;
    v_left := v_left - v_take;
  END LOOP;
  IF v_left > 0 THEN
    RAISE EXCEPTION 'till_refund_over_paid' USING ERRCODE = '22023';
  END IF;
  UPDATE public.venue_till_sales
  SET state = CASE WHEN NOT EXISTS (
        SELECT 1 FROM public.venue_till_payments p
        WHERE p.sale_id = v_sale.id AND p.state IN ('paid', 'partially_refunded')) THEN 'refunded'
      ELSE 'partially_refunded' END,
      version = version + 1, updated_at = now()
  WHERE id = v_sale.id AND state IN ('paid', 'partially_refunded', 'refunded');
  PERFORM public.issue_4490_till_cancel_offer_lines(v_sale.id, ARRAY[v_line.id], p_actor, v_reason);
  PERFORM public.issue_4490_till_cancel_offers_if_refunded(v_sale.id, p_actor, v_reason);
  RETURN jsonb_build_object('replayed', false, 'refundedMinor', v_line.amount_minor,
    'sale', public.issue_4490_till_sale_projection(v_sale.id));
END;
$function$;

-- The day's money: a Till offer refund comes off on its service day, once.
SELECT pg_temp.issue_4490_f1_patch(
  'public.issue_4490_venue_money_day(uuid,date)'::regprocedure,
  $old$                AND public.issue_4490_venue_service_date(p_venue_id, sr.requested_at) = p_local_date), 0)
  INTO v_refunded;$old$,
  $new$                AND public.issue_4490_venue_service_date(p_venue_id, sr.requested_at) = p_local_date), 0)
  -- #4490 spec 08 O1 fix 1: an offer line sold in the Till and refunded there.
  + COALESCE((SELECT sum(l.amount_minor) FROM public.venue_till_lines l
              JOIN public.venue_till_sales s ON s.id = l.sale_id
              WHERE s.venue_id = p_venue_id AND l.state = 'refunded' AND l.kind IN ('entry', 'group_package')
                AND upper(s.currency) = v_cur
                AND public.issue_4490_venue_service_date(p_venue_id, l.refunded_at) = p_local_date), 0)
  INTO v_refunded;$new$
);
SELECT pg_temp.issue_4490_f1_patch(
  'public.issue_4490_venue_money_day(uuid,date)'::regprocedure,
  $old$                AND upper(f.currency_code) = v_cur), 0)
  INTO v_f_online, v_f_at_venue, v_f_refunded;$old$,
  $new$                AND upper(f.currency_code) = v_cur), 0)
    + COALESCE((SELECT sum(l.amount_minor) FROM public.venue_till_lines l
                WHERE l.stay_group_id IN (SELECT id FROM day_groups) AND l.state = 'refunded'
                  AND l.kind IN ('entry', 'group_package')), 0)
  INTO v_f_online, v_f_at_venue, v_f_refunded;$new$
);

-- ---------------------------------------------------------------------------
-- 7. Who may take over a check (T9 change server): people who may sell here.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.issue_4490_till_servers(p_venue_id uuid, p_actor uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_venue public.venue_listings%ROWTYPE;
BEGIN
  IF NOT public.issue_1389_service_role() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_venue FROM public.venue_listings WHERE id = p_venue_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'venue_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public.issue_4490_till_enabled(p_venue_id) THEN
    RAISE EXCEPTION 'till_not_enabled' USING ERRCODE = 'P0001';
  END IF;
  IF NOT public.issue_4490_can_sell(p_venue_id, p_actor) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
        'userId', m.user_id,
        'name', COALESCE(
          NULLIF(btrim(ca.display_name), ''),
          NULLIF(btrim(p.display_name), ''),
          NULLIF(btrim(concat_ws(' ', NULLIF(btrim(p.first_name), ''), NULLIF(btrim(p.last_name), ''))), '')),
        'role', m.role,
        'openChecks', (SELECT count(*) FROM public.venue_till_sales s
                       WHERE s.venue_id = p_venue_id AND s.server_user_id = m.user_id
                         AND s.state IN ('open', 'paying')))
      ORDER BY m.accepted_at, m.id)
    FROM public.brand_team_members m
    LEFT JOIN public.creator_accounts ca ON ca.id = m.user_id AND ca.deleted_at IS NULL
    LEFT JOIN public.profiles p ON p.id = m.user_id
    WHERE m.brand_id = v_venue.brand_id AND m.accepted_at IS NOT NULL AND m.removed_at IS NULL
      AND public.issue_4490_can_sell(p_venue_id, m.user_id)), '[]'::jsonb);
END;
$function$;

-- ---------------------------------------------------------------------------
-- 8. Grants (every new function is internal: service role only).
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION
  public.issue_4490_till_finalize_paid(uuid, uuid, uuid),
  public.issue_4490_till_settle_after_void(uuid, uuid),
  public.issue_4490_till_close_on_pad(uuid),
  public.issue_4490_till_tab_closed(),
  public.issue_4490_pad_guard(text, uuid, uuid, uuid, uuid),
  public.issue_4490_till_cancel_offer_lines(uuid, uuid[], uuid, text),
  public.issue_4490_till_cancel_offers_if_refunded(uuid, uuid, text),
  public.issue_4490_till_refund_line(uuid, uuid, uuid, text, uuid),
  public.issue_4490_till_servers(uuid, uuid)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
  public.issue_4490_till_finalize_paid(uuid, uuid, uuid),
  public.issue_4490_till_settle_after_void(uuid, uuid),
  public.issue_4490_till_close_on_pad(uuid),
  public.issue_4490_pad_guard(text, uuid, uuid, uuid, uuid),
  public.issue_4490_till_cancel_offer_lines(uuid, uuid[], uuid, text),
  public.issue_4490_till_cancel_offers_if_refunded(uuid, uuid, text),
  public.issue_4490_till_refund_line(uuid, uuid, uuid, text, uuid),
  public.issue_4490_till_servers(uuid, uuid)
TO service_role;

COMMIT;
