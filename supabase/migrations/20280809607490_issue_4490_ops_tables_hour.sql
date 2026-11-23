-- Issue #4490, spec 08 O4, migration "51" (tables, by the hour started by
-- staff, the table-deposit credit, the charge-to-room seam), file number
-- 607490 (the spec's 514490 sorts before the migrations it depends on).
--
-- 1. By the hour at the Till (spec §3 O4, §11 T13, A10). For an offer with
--    staff_can_start, issue_4490_till_start_session books a session that
--    starts now (rounded to the offer's step), priced by
--    issue_4490_quote_hour_internal and claimed with issue_4490_claim_hour_unit
--    (or the unit staff picked; a taken unit is PT409 offer_space_taken). The
--    booking is a walk-in, collected by the Till, confirmed and admitted at
--    once (its claim is committed); the money is a by_the_hour line paid with
--    the check. "Add 30 min" (issue_4490_till_extend_session) quotes and
--    claims the next block on the same unit in one transaction (its own
--    booking) and adds it to the check; a taken unit is offer_space_taken
--    with the next booking's time in the detail. Voiding a session's line
--    cancels its booking and frees the unit. The quote's "too soon" cutoff
--    is lifted only for the window the Till is starting
--    (mingla.issue_4490_till_start, checked patch of the quote).
-- 2. Tables (spec §3 O4): issue_4490_till_seat opens a check at a table. A
--    walk-in at a venue with Table reservations on gets a staff reservation
--    for now (seated, walk-in) linked to the check; the booked table's
--    minimum spend shows as "{amount} to reach the minimum spend".
-- 3. The table deposit (§11 T12, A11, §12 item 9, spec 07 §11 B1). Seating a
--    booking whose table deposit was paid puts the deposit on the check as a
--    `deposit_credit` line (reservation_id set; once per booking: partial
--    UNIQUE -> PT409 deposit_already_used) and stamps
--    reservations.deposit_applied_sale_id. The bill is
--    subtotal + service charge - deposit (floor 0); the service charge is on
--    the full bill and the deposit carries its pro-rata part of it. While the
--    deposit is applied, every refund obligation for that booking is refused
--    (BEFORE INSERT on source_refunds, venue_reservation rows only:
--    reservation_deposit_used). Voiding the credit line clears the stamp and
--    the deposit follows the booking's own rules again.
-- 4. Charge to room (D13): the tender exists and is refused
--    (till_room_not_ready, 606490's take_payment), [TRANSITIONAL] until the
--    stay venue work ships a room folio.
--
-- Live paths this touches: source_refunds (a BEFORE INSERT trigger that only
-- reads when source_type = 'venue_reservation' and does nothing unless a
-- deposit was applied at the Till, which needs the Till: off in production)
-- and reservations (one nullable column, no default, no backfill). Every
-- other change is on Till tables and Till functions. pg_venue_order_finalize_payment
-- is NOT touched. No venue_id column (the #2099 seal is unchanged).
-- Static SQL. Local stack only until Seth approves a production migration.

BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE FUNCTION pg_temp.issue_4490_o4t_patch(
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
    RAISE EXCEPTION 'issue_4490 O4 tables patch precondition failed for %: old % (expected %)',
      p_sig, v_old_count, p_count;
  END IF;
  EXECUTE replace(v_def, p_old, p_new);
END;
$patch$;

-- ---------------------------------------------------------------------------
-- 1. Columns and shapes.
-- ---------------------------------------------------------------------------
ALTER TABLE public.venue_till_lines
  ADD COLUMN reservation_id uuid NULL REFERENCES public.reservations(id) ON DELETE RESTRICT,
  ADD COLUMN extends_line_id uuid NULL REFERENCES public.venue_till_lines(id) ON DELETE RESTRICT;
ALTER TABLE public.venue_till_lines DROP CONSTRAINT venue_till_lines_kind_check;
ALTER TABLE public.venue_till_lines ADD CONSTRAINT venue_till_lines_kind_check CHECK (kind IN (
  'menu_round', 'entry', 'group_package', 'by_the_hour', 'table', 'plan', 'balance', 'deposit_credit'));
ALTER TABLE public.venue_till_lines DROP CONSTRAINT venue_till_lines_shape;
ALTER TABLE public.venue_till_lines ADD CONSTRAINT venue_till_lines_shape CHECK (
  (kind = 'menu_round' AND venue_order_id IS NOT NULL AND stay_group_id IS NULL AND reservation_id IS NULL)
  OR (kind = 'deposit_credit' AND reservation_id IS NOT NULL AND stay_group_id IS NULL AND venue_order_id IS NULL)
  OR (kind NOT IN ('menu_round', 'deposit_credit') AND venue_order_id IS NULL AND stay_group_id IS NOT NULL
      AND reservation_id IS NULL));
ALTER TABLE public.venue_till_lines ADD CONSTRAINT venue_till_lines_extends_shape CHECK (
  extends_line_id IS NULL OR kind = 'by_the_hour');
-- T12: a booking's deposit is on one check at a time.
CREATE UNIQUE INDEX venue_till_lines_deposit_once_uniq ON public.venue_till_lines (reservation_id)
  WHERE kind = 'deposit_credit' AND state <> 'voided';
CREATE INDEX venue_till_lines_extends_idx ON public.venue_till_lines (extends_line_id)
  WHERE extends_line_id IS NOT NULL;

ALTER TABLE public.venue_till_sales
  ADD COLUMN credit_minor bigint NOT NULL DEFAULT 0 CHECK (credit_minor >= 0);
ALTER TABLE public.venue_till_sales DROP CONSTRAINT venue_till_sales_totals;
ALTER TABLE public.venue_till_sales ADD CONSTRAINT venue_till_sales_totals CHECK (
  total_due_minor = GREATEST(subtotal_minor + service_charge_minor - credit_minor, 0));

-- The check a booking's paid deposit is used on (NULL: not used at the Till).
ALTER TABLE public.reservations
  ADD COLUMN deposit_applied_sale_id uuid NULL REFERENCES public.venue_till_sales(id) ON DELETE SET NULL;
COMMENT ON COLUMN public.reservations.deposit_applied_sale_id IS
  '#4490 spec 08 §11 T12: the Till check this booking''s paid deposit is credited on. While set, no refund '
  'of the deposit can be raised (issue_4490_reservation_deposit_refund_guard).';

-- ---------------------------------------------------------------------------
-- 2. The bill: subtotal + service charge - deposit (floor 0).
-- ---------------------------------------------------------------------------
SELECT pg_temp.issue_4490_o4t_patch(
  'public.issue_4490_till_reprice(uuid)'::regprocedure,
  $old$  v_hold_minutes integer;$old$,
  $new$  v_hold_minutes integer;
  v_credit bigint;$new$);
SELECT pg_temp.issue_4490_o4t_patch(
  'public.issue_4490_till_reprice(uuid)'::regprocedure,
  $old$  WHERE l.sale_id = v_sale.id AND l.kind <> 'menu_round' AND l.state IN ('held', 'committed');$old$,
  $new$  WHERE l.sale_id = v_sale.id AND l.kind NOT IN ('menu_round', 'deposit_credit') AND l.state IN ('held', 'committed');
  -- #4490 08-O4 (T12): a paid table deposit comes off the bill.
  SELECT COALESCE(sum(l.amount_minor), 0) INTO v_credit
  FROM public.venue_till_lines l
  WHERE l.sale_id = v_sale.id AND l.kind = 'deposit_credit' AND l.state IN ('held', 'committed');$new$);
SELECT pg_temp.issue_4490_o4t_patch(
  'public.issue_4490_till_reprice(uuid)'::regprocedure,
  $old$      total_due_minor = v_rounds_sub + v_lines + v_rounds_sc,$old$,
  $new$      credit_minor = v_credit,
      total_due_minor = GREATEST(v_rounds_sub + v_lines + v_rounds_sc - v_credit, 0),$new$);

-- The service charge payments still carry: the deposit carries its pro-rata
-- part of the full bill's service charge (round half up).
CREATE OR REPLACE FUNCTION public.issue_4490_till_sc_left(p_sale_id uuid)
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT GREATEST(s.service_charge_minor
    - CASE WHEN s.credit_minor > 0 AND s.subtotal_minor + s.service_charge_minor > 0
           THEN LEAST(s.service_charge_minor, floor(
                  (s.service_charge_minor::numeric * LEAST(s.credit_minor, s.subtotal_minor + s.service_charge_minor))
                  / (s.subtotal_minor + s.service_charge_minor) + 0.5)::bigint)
           ELSE 0 END
    - COALESCE((
    SELECT sum(p.service_charge_minor) FROM public.venue_till_payments p
    WHERE p.sale_id = s.id AND p.state IN ('paid', 'refunded', 'partially_refunded') AND NOT p.paid_late), 0), 0)::bigint
  FROM public.venue_till_sales s WHERE s.id = p_sale_id
$$;

-- The receipt and the guest's pay page show the deposit as money off.
SELECT pg_temp.issue_4490_o4t_patch(
  'public.issue_4490_till_receipt_build(uuid)'::regprocedure,
  $old$'amountMinor', l.amount_minor, 'modifiers', '[]'::jsonb)$old$,
  $new$'amountMinor', CASE WHEN l.kind = 'deposit_credit' THEN -l.amount_minor ELSE l.amount_minor END,
                             'modifiers', '[]'::jsonb)$new$);
SELECT pg_temp.issue_4490_o4t_patch(
  'public.issue_4490_till_pay_code_view(text)'::regprocedure,
  $old$SELECT jsonb_build_object('name', l.label_snapshot, 'quantity', 1, 'amountMinor', l.amount_minor), l.created_at, 0$old$,
  $new$SELECT jsonb_build_object('name', l.label_snapshot, 'quantity', 1,
             'amountMinor', CASE WHEN l.kind = 'deposit_credit' THEN -l.amount_minor ELSE l.amount_minor END),
           l.created_at, 0$new$);

-- A session paid with the check is recorded on its booking like a balance.
SELECT pg_temp.issue_4490_o4t_patch(
  'public.issue_4490_till_finalize_paid(uuid,uuid,uuid)'::regprocedure,
  $old$    ELSIF v_line.kind = 'balance' THEN$old$,
  $new$    ELSIF v_line.kind IN ('balance', 'by_the_hour') THEN$new$);

-- The quote's "too soon" cutoff does not apply to the one window the Till is
-- starting now (staff at the venue start a session that is already running).
SELECT pg_temp.issue_4490_o4t_patch(
  'public.issue_4490_quote_hour_internal(uuid,uuid,jsonb,text,uuid,text,jsonb)'::regprocedure,
  $old$  IF now() >= public.issue_4490_window_cutoff(v_offer.id, v_window.id) THEN$old$,
  $new$  IF now() >= public.issue_4490_window_cutoff(v_offer.id, v_window.id)
     AND current_setting('mingla.issue_4490_till_start', true) IS DISTINCT FROM v_window.id::text THEN$new$);

-- ---------------------------------------------------------------------------
-- 3. The deposit guard on the booking's refund paths (T12).
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.issue_4490_reservation_deposit_refund_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.reservations r
             WHERE r.id = NEW.subject_id AND r.deposit_applied_sale_id IS NOT NULL) THEN
    RAISE EXCEPTION 'reservation_deposit_used' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER issue_4490_reservation_deposit_refund_guard
  BEFORE INSERT ON public.source_refunds
  FOR EACH ROW WHEN (NEW.source_type = 'venue_reservation')
  EXECUTE FUNCTION public.issue_4490_reservation_deposit_refund_guard();

-- ---------------------------------------------------------------------------
-- 4. When a line goes: the deposit returns to its booking, a session frees
--    its unit.
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.issue_4490_till_line_voided()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.state <> 'voided' OR OLD.state = 'voided' THEN
    RETURN NULL;
  END IF;
  IF NEW.kind = 'deposit_credit' THEN
    UPDATE public.reservations SET deposit_applied_sale_id = NULL
    WHERE id = NEW.reservation_id AND deposit_applied_sale_id = NEW.sale_id;
  ELSIF NEW.kind = 'by_the_hour' THEN
    UPDATE public.venue_space_claims
    SET state = 'released', held_until = NULL, released_at = now(), release_reason = 'till_void', updated_at = now()
    WHERE group_id = NEW.stay_group_id AND state IN ('held', 'committed');
    UPDATE public.stay_inventory_commitments
    SET state = 'released', released_at = now(), release_reason = 'reservation_cancelled'
    WHERE group_id = NEW.stay_group_id AND state = 'active';
    UPDATE public.stay_reservation_lines
    SET state = 'cancelled', version = version + 1, updated_at = now()
    WHERE group_id = NEW.stay_group_id AND state = 'confirmed';
    UPDATE public.stay_reservation_groups
    SET state = 'cancelled', version = version + 1, updated_at = now()
    WHERE id = NEW.stay_group_id AND state = 'confirmed';
    INSERT INTO public.stay_reservation_events (
      group_id, event_type, actor_type, actor_user_id, idempotency_key, safe_metadata
    ) VALUES (
      NEW.stay_group_id, 'stay_offer_till_voided', 'staff', NEW.voided_by_user_id, 'till-void:' || NEW.id,
      jsonb_build_object('reason', COALESCE(NEW.void_reason, 'void'))
    ) ON CONFLICT (group_id, idempotency_key) DO NOTHING;
  END IF;
  RETURN NULL;
END;
$$;
CREATE TRIGGER issue_4490_till_line_voided
  AFTER UPDATE OF state ON public.venue_till_lines
  FOR EACH ROW WHEN (NEW.kind IN ('deposit_credit', 'by_the_hour'))
  EXECUTE FUNCTION public.issue_4490_till_line_voided();

-- ---------------------------------------------------------------------------
-- 5. Booking a by-the-hour session from the Till (shared by start and add).
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.issue_4490_till_session_book(
  p_sale_id uuid,
  p_offering_id uuid,
  p_window_id uuid,
  p_space_id uuid,
  p_guests integer,
  p_actor uuid,
  p_key text,
  p_claim tstzrange,
  p_extends_line_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_sale public.venue_till_sales%ROWTYPE;
  v_venue public.venue_listings%ROWTYPE;
  v_offer public.stay_offerings%ROWTYPE;
  v_window public.stay_place_windows%ROWTYPE;
  v_option public.venue_offer_price_options%ROWTYPE;
  v_actor_key text;
  v_quote jsonb;
  v_quote_row public.stay_quotes%ROWTYPE;
  v_qline public.stay_quote_lines%ROWTYPE;
  v_group_id uuid := gen_random_uuid();
  v_line_id uuid;
  v_hold_id uuid := gen_random_uuid();
  v_spaces uuid[];
  v_booked tstzrange;
  v_place text;
  v_pass uuid;
  v_label text;
  v_till_line uuid;
BEGIN
  IF NOT public.issue_1389_service_role() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_sale FROM public.venue_till_sales WHERE id = p_sale_id FOR UPDATE;
  SELECT * INTO v_venue FROM public.venue_listings WHERE id = v_sale.venue_id;
  SELECT * INTO v_offer FROM public.stay_offerings WHERE id = p_offering_id;
  SELECT * INTO v_window FROM public.stay_place_windows WHERE id = p_window_id;
  SELECT * INTO v_option FROM public.venue_offer_price_options
  WHERE offering_id = v_offer.id AND status = 'active' AND unit = 'hour'
  ORDER BY sort_order, created_at LIMIT 1;
  IF v_option.id IS NULL THEN
    RAISE EXCEPTION 'offer_option_unavailable' USING ERRCODE = 'P0002';
  END IF;
  v_actor_key := encode(pg_catalog.sha256(convert_to('till:' || p_actor::text, 'UTF8')), 'hex');
  PERFORM set_config('mingla.issue_4490_till_start', v_window.id::text, true);
  v_quote := public.issue_4490_quote_hour_internal(
    v_offer.id, v_window.id,
    jsonb_build_array(jsonb_build_object('priceOptionId', v_option.id,
      'guests', GREATEST(COALESCE(p_guests, v_option.guest_min), v_option.guest_min))),
    v_actor_key, NULL, 'till-session-quote:' || p_key, '[]'::jsonb);
  PERFORM set_config('mingla.issue_4490_till_start', '', true);
  SELECT * INTO v_quote_row FROM public.stay_quotes WHERE id = (v_quote->>'quoteId')::uuid FOR UPDATE;
  SELECT * INTO v_qline FROM public.stay_quote_lines WHERE quote_id = v_quote_row.id ORDER BY id LIMIT 1;
  v_booked := tstzrange(v_window.starts_at, v_window.ends_at, '[)');

  -- A walk-in, collected by the Till, created by this member (the gate GUC
  -- is the one rule that lets staff create such a booking).
  PERFORM set_config('mingla.issue_4490_gate_sale', v_group_id::text, true);
  INSERT INTO public.stay_reservation_groups (
    id, public_reference, quote_id, user_id, actor_key_hash, venue_id, brand_id, currency_code,
    mode, state, request_deadline, payment_deadline, guest_snapshot,
    source_subtotal_minor, fee_total_minor, tax_total_minor, total_minor,
    idempotency_key, request_hash, offer_kind, buyer_token_hash, payment_plan_snapshot,
    booking_source, payment_collection, created_by_staff_user_id, deposit_minor, balance_due_at, till_sale_id
  ) VALUES (
    v_group_id, 'VB-' || upper(substr(replace(v_group_id::text, '-', ''), 1, 20)),
    v_quote_row.id, NULL, v_actor_key, v_quote_row.venue_id, v_quote_row.brand_id, v_quote_row.currency_code,
    'instant', 'instant_payment_pending', NULL, NULL,
    jsonb_build_object('name', COALESCE(v_sale.check_label, 'Walk-in')),
    v_quote_row.source_subtotal_minor, v_quote_row.fee_total_minor, v_quote_row.tax_total_minor, v_quote_row.total_minor,
    'till-session:' || p_key, v_quote_row.request_hash, 'by_the_hour', NULL,
    jsonb_build_object('stagePlan', 'full', 'depositKind', 'none', 'currencyCode', v_quote_row.currency_code,
      'setupMinutes', v_offer.buffer_before_minutes, 'cleanupMinutes', v_offer.buffer_after_minutes,
      'localDate', v_window.local_date, 'staffStarted', true),
    'walk_in', 'till', p_actor, NULL, NULL, v_sale.id
  );
  PERFORM set_config('mingla.issue_4490_gate_sale', '', true);
  INSERT INTO public.stay_reservation_lines (
    id, group_id, quote_line_id, offering_id, kind, state, place_window_id, place_units, place_guests,
    adults, children, base_minor, fee_minor, tax_minor, total_minor,
    offering_snapshot, price_snapshot, policy_snapshot, price_option_id, booked_minutes
  ) VALUES (
    gen_random_uuid(), v_group_id, v_qline.id, v_qline.offering_id, v_qline.kind, 'payment_pending',
    v_qline.place_window_id, v_qline.place_units, v_qline.place_guests, 0, 0,
    v_qline.base_minor, v_qline.fee_minor, v_qline.tax_minor, v_qline.total_minor,
    v_qline.offering_snapshot, v_qline.price_snapshot, v_qline.policy_snapshot, v_qline.price_option_id,
    v_qline.booked_minutes
  ) RETURNING id INTO v_line_id;
  INSERT INTO public.stay_inventory_holds (id, group_id, state, expires_at, reason)
  VALUES (v_hold_id, v_group_id, 'active', now() + interval '15 minutes', 'gate_sale');
  INSERT INTO public.stay_inventory_hold_slices (
    hold_id, reservation_line_id, resource_type, offering_id, place_window_id, quantity
  ) VALUES (v_hold_id, v_line_id, 'place_window', v_offer.id, v_window.id, v_qline.place_guests);
  -- The unit: the one staff picked, else the first free one (any one of).
  IF p_space_id IS NOT NULL AND v_offer.space_allocation = 'any_one' THEN
    IF NOT EXISTS (SELECT 1 FROM public.venue_offer_spaces os
                   WHERE os.offering_id = v_offer.id AND os.space_id = p_space_id) THEN
      RAISE EXCEPTION 'offer_space_taken' USING ERRCODE = 'PT409';
    END IF;
    v_spaces := ARRAY[p_space_id];
    PERFORM public.issue_4490_claim_spaces(v_group_id, v_line_id, v_hold_id, v_spaces, NULL,
      v_booked, p_claim, now() + interval '15 minutes');
  ELSE
    v_spaces := public.issue_4490_claim_hour_unit(v_group_id, v_line_id, v_hold_id, v_offer.id,
      ARRAY(SELECT jsonb_array_elements_text(v_qline.inventory_snapshot->'spaceIds')::uuid),
      v_booked, p_claim, now() + interval '15 minutes');
  END IF;
  UPDATE public.stay_quotes SET status = 'consumed', consumed_at = now(), version = version + 1
  WHERE id = v_quote_row.id;
  -- Admitted on create: the hold becomes the commitment (the claim is
  -- committed with it), the booking is confirmed (its pass is issued) and the
  -- guests are let in, as the gate's cash path does.
  UPDATE public.stay_reservation_groups SET state = 'finalizing', version = version + 1, updated_at = now()
  WHERE id = v_group_id;
  INSERT INTO public.stay_inventory_commitments (
    group_id, reservation_line_id, resource_type, offering_id, place_window_id, quantity
  )
  SELECT v_group_id, s.reservation_line_id, s.resource_type, s.offering_id, s.place_window_id, s.quantity
  FROM public.stay_inventory_hold_slices s WHERE s.hold_id = v_hold_id ORDER BY s.id;
  UPDATE public.stay_inventory_holds SET state = 'converted', reason = 'till_paid', version = version + 1,
    updated_at = now()
  WHERE id = v_hold_id;
  UPDATE public.stay_reservation_lines SET state = 'confirmed', version = version + 1, updated_at = now()
  WHERE group_id = v_group_id AND state = 'payment_pending';
  UPDATE public.stay_reservation_groups SET state = 'confirmed', version = version + 1, updated_at = now()
  WHERE id = v_group_id;
  SELECT string_agg(s.name, ' + ' ORDER BY s.sort_order, s.name) INTO v_place
  FROM public.venue_spaces s WHERE s.id = ANY(v_spaces);
  INSERT INTO public.stay_reservation_events (
    group_id, event_type, actor_type, actor_user_id, idempotency_key, safe_metadata
  ) VALUES (
    v_group_id, 'stay_offer_till_started', 'staff', p_actor, 'till-session:' || v_group_id,
    jsonb_build_object('saleId', v_sale.id, 'placeName', v_place, 'minutes', v_qline.booked_minutes,
      'extends', p_extends_line_id IS NOT NULL)
  );
  -- The guests are here now: a session that starts at the next step (start
  -- rounded up) can be let in at once.
  UPDATE public.venue_passes SET valid_from = LEAST(valid_from, now()), version = version + 1, updated_at = now()
  WHERE group_id = v_group_id AND valid_from > now();
  SELECT id INTO v_pass FROM public.venue_passes WHERE group_id = v_group_id;
  IF v_pass IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.venue_passes p
    WHERE p.id = v_pass AND p.status = 'valid'
      AND p.valid_local_date = public.issue_4490_venue_local_date(v_sale.venue_id)) THEN
    PERFORM public.issue_4490_admit_pass(v_venue, v_pass, NULL, true, p_actor, 'gate_sale');
  END IF;
  v_label := left(CASE WHEN p_extends_line_id IS NOT NULL
                       THEN v_offer.name || ' · +' || v_qline.booked_minutes || ' min'
                       WHEN v_place IS NULL OR v_place = v_offer.name THEN v_offer.name
                       ELSE v_offer.name || ' · ' || v_place END, 120);
  INSERT INTO public.venue_till_lines (
    sale_id, kind, stay_group_id, amount_minor, label_snapshot, state, idempotency_key, extends_line_id
  ) VALUES (
    v_sale.id, 'by_the_hour', v_group_id, v_quote_row.total_minor, v_label, 'held', p_key, p_extends_line_id
  ) RETURNING id INTO v_till_line;
  RETURN v_till_line;
END;
$$;

-- When a session (and every block added to it) ends.
CREATE FUNCTION public.issue_4490_till_session_span(p_root_line_id uuid)
RETURNS TABLE(starts_at timestamptz, ends_at timestamptz, space_ids uuid[])
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT min(lower(c.booked_range)), max(upper(c.booked_range)),
         array_agg(DISTINCT c.space_id ORDER BY c.space_id)
  FROM public.venue_till_lines l
  JOIN public.venue_space_claims c ON c.group_id = l.stay_group_id AND c.state IN ('held', 'committed')
  WHERE (l.id = p_root_line_id OR l.extends_line_id = p_root_line_id)
    AND l.kind = 'by_the_hour' AND l.state IN ('held', 'committed')
$$;

-- "Start a session now".
CREATE FUNCTION public.issue_4490_till_start_session(
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
  PERFORM public.issue_4490_till_session_book(
    v_sale.id, v_offer.id, v_window, p_space_id, p_guests, p_actor, v_key,
    tstzrange(v_start - make_interval(mins => v_offer.buffer_before_minutes),
              v_start + make_interval(mins => p_minutes + v_offer.buffer_after_minutes), '[)'),
    NULL);
  PERFORM public.issue_4490_till_reprice(v_sale.id);
  RETURN public.issue_4490_till_sale_projection(v_sale.id) || jsonb_build_object('replayed', false);
END;
$$;

-- "Add 30 min": the next block on the same unit, claimed and on the check.
CREATE FUNCTION public.issue_4490_till_extend_session(
  p_sale_id uuid,
  p_line_id uuid,
  p_minutes integer,
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
  v_line public.venue_till_lines%ROWTYPE;
  v_root uuid;
  v_offer public.stay_offerings%ROWTYPE;
  v_day public.stay_place_windows%ROWTYPE;
  v_span record;
  v_key text := btrim(COALESCE(p_idempotency_key, ''));
  v_step integer;
  v_end timestamptz;
  v_window uuid;
  v_guests integer;
  v_next timestamptz;
  v_unit text;
  v_last_group uuid;
BEGIN
  IF char_length(v_key) NOT BETWEEN 8 AND 150 OR p_line_id IS NULL OR p_minutes IS NULL
     OR p_minutes NOT BETWEEN 15 AND 240 THEN
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
  SELECT * INTO v_line FROM public.venue_till_lines
  WHERE id = p_line_id AND sale_id = v_sale.id AND kind = 'by_the_hour' AND state = 'held';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'till_line_not_found' USING ERRCODE = 'P0002';
  END IF;
  v_root := COALESCE(v_line.extends_line_id, v_line.id);
  SELECT o.* INTO v_offer FROM public.stay_reservation_lines rl
  JOIN public.stay_offerings o ON o.id = rl.offering_id
  WHERE rl.group_id = (SELECT stay_group_id FROM public.venue_till_lines WHERE id = v_root)
  ORDER BY rl.created_at LIMIT 1;
  IF v_offer.id IS NULL OR v_offer.status <> 'live' OR NOT v_offer.staff_can_start THEN
    RAISE EXCEPTION 'offer_staff_start_off' USING ERRCODE = 'PT409';
  END IF;
  v_step := COALESCE(v_offer.booking_length_step_minutes, 60);
  IF p_minutes % v_step <> 0 THEN
    RAISE EXCEPTION 'offer_length_invalid' USING ERRCODE = '22023',
      DETAIL = jsonb_build_object('stepMinutes', v_step)::text;
  END IF;
  SELECT * INTO v_span FROM public.issue_4490_till_session_span(v_root);
  IF v_span.ends_at IS NULL THEN
    RAISE EXCEPTION 'till_line_not_found' USING ERRCODE = 'P0002';
  END IF;
  v_end := v_span.ends_at;
  SELECT string_agg(s.name, ' + ' ORDER BY s.sort_order, s.name) INTO v_unit
  FROM public.venue_spaces s WHERE s.id = ANY(v_span.space_ids);
  SELECT (rl.place_guests)::integer INTO v_guests FROM public.stay_reservation_lines rl
  WHERE rl.group_id = (SELECT stay_group_id FROM public.venue_till_lines WHERE id = v_root)
  ORDER BY rl.created_at LIMIT 1;
  -- The session's cleanup time moves to after the added block.
  SELECT l.stay_group_id INTO v_last_group
  FROM public.venue_till_lines l
  JOIN public.venue_space_claims c ON c.group_id = l.stay_group_id AND c.state IN ('held', 'committed')
  WHERE (l.id = v_root OR l.extends_line_id = v_root) AND l.state IN ('held', 'committed')
  ORDER BY upper(c.booked_range) DESC LIMIT 1;
  UPDATE public.venue_space_claims
  SET claim_range = tstzrange(lower(claim_range), v_end, '[)'), updated_at = now()
  WHERE group_id = v_last_group AND state IN ('held', 'committed') AND upper(claim_range) > v_end;
  BEGIN
    SELECT w.* INTO v_day FROM public.stay_place_windows w
    JOIN public.stay_place_schedule_rules r ON r.id = w.schedule_rule_id AND r.active AND r.mode = 'flexible'
    WHERE w.offering_id = v_offer.id AND NOT w.booked_block AND NOT w.stop_sell
      AND v_end >= w.starts_at AND v_end + make_interval(mins => p_minutes) <= w.ends_at
    ORDER BY w.starts_at LIMIT 1;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'offer_window_unavailable' USING ERRCODE = 'PT409';
    END IF;
    INSERT INTO public.stay_place_windows (
      offering_id, schedule_rule_id, brand_id, venue_id, local_date, starts_at, ends_at,
      sellable_units, sellable_capacity, dst_resolution, booked_block
    ) VALUES (
      v_offer.id, v_day.schedule_rule_id, v_offer.brand_id, v_offer.venue_id, v_day.local_date,
      v_end, v_end + make_interval(mins => p_minutes),
      v_day.sellable_units, v_day.sellable_capacity, 'unambiguous', true
    ) ON CONFLICT (offering_id, starts_at, ends_at) DO NOTHING;
    SELECT id INTO v_window FROM public.stay_place_windows
    WHERE offering_id = v_offer.id AND starts_at = v_end AND ends_at = v_end + make_interval(mins => p_minutes);
    PERFORM public.issue_4490_till_session_book(
      v_sale.id, v_offer.id, v_window,
      CASE WHEN v_offer.space_allocation = 'any_one' THEN v_span.space_ids[1] END,
      v_guests, p_actor, v_key,
      tstzrange(v_end, v_end + make_interval(mins => p_minutes + v_offer.buffer_after_minutes), '[)'),
      v_root);
  EXCEPTION WHEN SQLSTATE 'PT409' THEN
    IF SQLERRM <> 'offer_space_taken' THEN
      RAISE;
    END IF;
    -- T13: say when the next booking for that unit starts.
    SELECT min(lower(c.booked_range)) INTO v_next
    FROM public.venue_space_claims c
    WHERE c.space_id = ANY(v_span.space_ids) AND c.state IN ('held', 'committed')
      AND upper(c.claim_range) > v_end
      AND NOT EXISTS (SELECT 1 FROM public.venue_till_lines l
                      WHERE l.stay_group_id = c.group_id AND (l.id = v_root OR l.extends_line_id = v_root));
    RAISE EXCEPTION 'offer_space_taken' USING ERRCODE = 'PT409',
      DETAIL = jsonb_build_object('unitName', COALESCE(v_unit, v_offer.name), 'nextAt', v_next)::text;
  END;
  PERFORM public.issue_4490_till_reprice(v_sale.id);
  RETURN public.issue_4490_till_sale_projection(v_sale.id) || jsonb_build_object('replayed', false);
END;
$$;

-- ---------------------------------------------------------------------------
-- 6. Seating a table (walk-in, or a booking with its deposit).
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.issue_4490_till_seat(
  p_venue_id uuid,
  p_actor uuid,
  p_spot_id uuid,
  p_party_size integer,
  p_reservation_id uuid,
  p_label text,
  p_server uuid,
  p_idempotency_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_open jsonb;
  v_sale public.venue_till_sales%ROWTYPE;
  v_spot public.qr_spots%ROWTYPE;
  v_res public.reservations%ROWTYPE;
  v_from text;
  v_label text := NULLIF(btrim(COALESCE(p_label, '')), '');
  v_deposit bigint;
  v_new uuid;
BEGIN
  IF NOT public.issue_1389_service_role() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_spot_id IS NULL OR (p_party_size IS NOT NULL AND p_party_size NOT BETWEEN 1 AND 100) THEN
    RAISE EXCEPTION 'till_invalid_payload' USING ERRCODE = '22023';
  END IF;
  IF p_reservation_id IS NOT NULL THEN
    SELECT * INTO v_res FROM public.reservations WHERE id = p_reservation_id AND venue_id = p_venue_id FOR UPDATE;
    IF NOT FOUND OR v_res.status NOT IN ('requested', 'confirmed', 'seated') THEN
      RAISE EXCEPTION 'till_booking_not_found' USING ERRCODE = 'P0002';
    END IF;
    v_label := COALESCE(v_label, left(NULLIF(btrim(COALESCE(v_res.guest_name, '')), ''), 40));
  END IF;
  v_open := public.issue_4490_till_open(p_venue_id, p_actor, p_server, v_label, p_spot_id, p_idempotency_key);
  IF COALESCE((v_open->>'replayed')::boolean, false) THEN
    RETURN v_open;
  END IF;
  SELECT * INTO v_sale FROM public.venue_till_sales WHERE id = (v_open->>'id')::uuid FOR UPDATE;
  SELECT * INTO v_spot FROM public.qr_spots WHERE id = p_spot_id;

  IF v_res.id IS NOT NULL THEN
    -- T12: two devices seating the same booking: its deposit is on one check.
    IF v_res.deposit_applied_sale_id IS NOT NULL THEN
      RAISE EXCEPTION 'deposit_already_used' USING ERRCODE = 'PT409';
    END IF;
    IF v_res.table_id IS NOT NULL AND v_spot.venue_table_id IS NOT NULL
       AND v_res.table_id <> v_spot.venue_table_id
       AND NOT (v_spot.venue_table_id = ANY(v_res.joined_table_ids)) THEN
      RAISE EXCEPTION 'till_booking_other_table' USING ERRCODE = 'PT409';
    END IF;
    v_from := v_res.status;
    IF v_from <> 'seated' AND NOT public.pg_reservation_transition_is_legal(v_from, 'seated') THEN
      RAISE EXCEPTION 'till_booking_not_seatable' USING ERRCODE = 'PT409';
    END IF;
    IF v_from <> 'seated' THEN
      UPDATE public.reservations
      SET status = 'seated', table_id = COALESCE(table_id, v_spot.venue_table_id), updated_at = now()
      WHERE id = v_res.id RETURNING * INTO v_res;
      INSERT INTO public.audit_log (user_id, brand_id, action, target_type, target_id, before, after)
      VALUES (p_actor, v_res.brand_id, 'venue_reservation.transition', 'reservation', v_res.id::text,
        jsonb_build_object('status', v_from),
        jsonb_build_object('status', 'seated', 'table_id', v_res.table_id, 'reason', 'seated at the Till',
          'till_sale_id', v_sale.id));
    END IF;
    UPDATE public.venue_till_sales SET reservation_id = v_res.id WHERE id = v_sale.id;
    UPDATE public.venue_order_sessions SET reservation_id = v_res.id WHERE id = v_sale.session_id;
    -- T12 / A11: a paid deposit (none of it refunded or being refunded), in
    -- the check's currency, comes off the bill.
    IF v_res.payment_status = 'paid' AND COALESCE(v_res.fee_cents, 0) > 0
       AND upper(COALESCE(v_res.fee_currency::text, v_sale.currency)) = v_sale.currency
       AND NOT EXISTS (SELECT 1 FROM public.source_refunds sr
                       WHERE sr.source_type = 'venue_reservation' AND sr.subject_id = v_res.id) THEN
      v_deposit := v_res.fee_cents;
      BEGIN
        INSERT INTO public.venue_till_lines (
          sale_id, kind, reservation_id, amount_minor, label_snapshot, state, idempotency_key
        ) VALUES (
          v_sale.id, 'deposit_credit', v_res.id, v_deposit, 'Deposit paid online', 'held',
          'deposit-credit:' || v_res.id
        );
      EXCEPTION WHEN unique_violation THEN
        RAISE EXCEPTION 'deposit_already_used' USING ERRCODE = 'PT409';
      END;
      UPDATE public.reservations SET deposit_applied_sale_id = v_sale.id WHERE id = v_res.id;
    END IF;
  ELSIF v_spot.venue_table_id IS NOT NULL
        AND public.issue_4490_venue_feature_on(p_venue_id, 'table_reservations') THEN
    -- A walk-in at a venue that takes table bookings: a staff reservation for
    -- now holds the table (the staff reservation insert, as
    -- biz_reservation_create writes it; a walk-in seated at the Till may have
    -- no phone).
    INSERT INTO public.reservations (
      brand_id, venue_id, reserved_for, party_size, status, source, created_via,
      guest_name, table_id, tags, booked_by_user_id
    ) VALUES (
      v_sale.brand_id, p_venue_id, now(), COALESCE(p_party_size, 1), 'seated', 'walk_in', 'operator',
      COALESCE(v_label, v_spot.label), v_spot.venue_table_id, '{}'::text[], p_actor
    ) RETURNING id INTO v_new;
    INSERT INTO public.audit_log (user_id, brand_id, action, target_type, target_id, after)
    VALUES (p_actor, v_sale.brand_id, 'venue_reservation.create', 'reservation', v_new::text,
      jsonb_build_object('source', 'walk_in', 'party_size', COALESCE(p_party_size, 1),
        'reserved_for', now(), 'status', 'seated', 'created_via', 'operator', 'venue_id', p_venue_id,
        'till_sale_id', v_sale.id));
    UPDATE public.venue_till_sales SET reservation_id = v_new WHERE id = v_sale.id;
    UPDATE public.venue_order_sessions SET reservation_id = v_new WHERE id = v_sale.session_id;
  END IF;
  PERFORM public.issue_4490_till_reprice(v_sale.id);
  RETURN public.issue_4490_till_sale_projection(v_sale.id) || jsonb_build_object('replayed', false);
END;
$$;

-- ---------------------------------------------------------------------------
-- 7. What the Till reads: tables, sessions staff can start, the minimum
--    spend, the deposit, the sessions on a check.
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.issue_4490_till_catalog_extras(p_venue_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'tableReservationsOn', public.issue_4490_venue_feature_on(p_venue_id, 'table_reservations'),
    'minSpendOn', public.issue_4490_venue_feature_on(p_venue_id, 'min_spend_tables'),
    'tables', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
          'spotId', q.id, 'tableId', t.id, 'name', COALESCE(t.name, q.label), 'capacity', t.capacity,
          'minSpendMinor', CASE WHEN public.issue_4490_venue_feature_on(p_venue_id, 'min_spend_tables')
                                THEN NULLIF(t.min_spend_minor, 0) END,
          'hasCheck', EXISTS (SELECT 1 FROM public.venue_till_sales s
                              WHERE s.qr_spot_id = q.id AND s.state IN ('open', 'paying')),
          'bookings', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'reservationId', r.id, 'name', r.guest_name, 'partySize', r.party_size,
                'reservedFor', r.reserved_for, 'status', r.status,
                'depositMinor', CASE WHEN r.payment_status = 'paid' AND COALESCE(r.fee_cents, 0) > 0
                                       AND r.deposit_applied_sale_id IS NULL
                                       AND NOT EXISTS (SELECT 1 FROM public.source_refunds sr
                                                       WHERE sr.source_type = 'venue_reservation'
                                                         AND sr.subject_id = r.id)
                                     THEN r.fee_cents END,
                'depositUsed', r.deposit_applied_sale_id IS NOT NULL,
                'note', r.guest_notes)
              ORDER BY abs(extract(epoch FROM (r.reserved_for - now()))))
            FROM public.reservations r
            WHERE r.venue_id = p_venue_id
              AND (r.table_id = t.id OR t.id = ANY(r.joined_table_ids))
              AND r.status IN ('requested', 'confirmed')
              AND r.reserved_for BETWEEN now() - interval '3 hours' AND now() + interval '2 hours'), '[]'::jsonb))
        ORDER BY q.sort_order, q.label)
      FROM public.qr_spots q
      JOIN public.venue_tables t ON t.id = q.venue_table_id AND t.is_active AND t.deleted_at IS NULL
      WHERE q.venue_id = p_venue_id AND q.is_active), '[]'::jsonb),
    'hourOffers', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
          'id', o.id, 'name', o.name, 'allocation', o.space_allocation,
          'stepMinutes', COALESCE(o.booking_length_step_minutes, 60),
          'minMinutes', GREATEST(COALESCE(o.booking_length_min_minutes, o.booking_length_step_minutes, 60),
                                 COALESCE(o.booking_length_step_minutes, 60)),
          'maxMinutes', COALESCE(o.booking_length_max_minutes, 1440),
          'guestMin', opt.guest_min, 'guestMax', opt.guest_max,
          'pricePerHourMinor', (SELECT pv.amount_minor FROM public.stay_price_versions pv
                                WHERE pv.price_option_id = opt.id AND pv.effective_to IS NULL LIMIT 1),
          'units', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'spaceId', s.id, 'name', s.name,
                'busy', EXISTS (SELECT 1 FROM public.venue_space_claims c
                                WHERE c.space_id = s.id AND c.state IN ('held', 'committed')
                                  AND c.claim_range @> now())) ORDER BY s.sort_order, s.name)
            FROM public.venue_offer_spaces os JOIN public.venue_spaces s ON s.id = os.space_id
            WHERE os.offering_id = o.id AND s.is_active AND s.archived_at IS NULL), '[]'::jsonb))
        ORDER BY o.name)
      FROM public.stay_offerings o
      JOIN LATERAL (SELECT po.* FROM public.venue_offer_price_options po
                    WHERE po.offering_id = o.id AND po.status = 'active' AND po.unit = 'hour'
                    ORDER BY po.sort_order, po.created_at LIMIT 1) opt ON true
      WHERE o.venue_id = p_venue_id AND o.kind = 'by_the_hour' AND o.status = 'live' AND o.staff_can_start
        AND public.issue_4490_venue_feature_on(p_venue_id, 'by_the_hour')), '[]'::jsonb))
$$;

SELECT pg_temp.issue_4490_o4t_patch(
  'public.issue_4490_till_catalog(uuid,uuid)'::regprocedure,
  $old$      FROM public.qr_spots q WHERE q.venue_id = v_venue.id AND q.is_active), '[]'::jsonb));$old$,
  $new$      FROM public.qr_spots q WHERE q.venue_id = v_venue.id AND q.is_active), '[]'::jsonb))
    || public.issue_4490_till_catalog_extras(v_venue.id);$new$);

-- The sale extras (606490) plus the deposit, the minimum spend and the
-- sessions on the check.
CREATE OR REPLACE FUNCTION public.issue_4490_till_sale_extras(p_sale_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'shares', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
          'id', sh.id, 'shareNo', sh.share_no, 'mode', sh.mode, 'state', sh.state,
          'amountMinor', sh.amount_minor, 'serviceChargeMinor', sh.service_charge_minor,
          'setVersion', sh.set_version,
          'paymentId', (SELECT p.id FROM public.venue_till_payments p
                        WHERE p.share_id = sh.id
                          AND (p.state = 'pending' OR (p.state IN ('paid', 'partially_refunded', 'refunded')
                               AND (NOT p.paid_late OR p.late_kept_at IS NOT NULL)))
                        ORDER BY p.seq DESC LIMIT 1),
          'items', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'orderItemId', si.venue_order_item_id, 'lineId', si.till_line_id,
                'units', si.units, 'amountMinor', si.amount_minor)
              ORDER BY si.created_at, si.id)
            FROM public.venue_till_share_items si WHERE si.share_id = sh.id), '[]'::jsonb))
        ORDER BY sh.share_no)
      FROM public.venue_till_shares sh WHERE sh.sale_id = p_sale_id), '[]'::jsonb),
    'split', jsonb_build_object(
      'evenOnly', EXISTS (SELECT 1 FROM public.venue_till_payments p
                          WHERE p.sale_id = p_sale_id AND p.share_id IS NULL
                            AND p.state IN ('paid', 'partially_refunded', 'refunded')
                            AND (NOT p.paid_late OR p.late_kept_at IS NOT NULL))
               OR EXISTS (SELECT 1 FROM public.venue_till_shares sh WHERE sh.sale_id = p_sale_id AND sh.mode = 'even')
               OR EXISTS (SELECT 1 FROM public.venue_till_refunds r JOIN public.venue_till_payments p ON p.id = r.payment_id
                          WHERE p.sale_id = p_sale_id)
               OR EXISTS (SELECT 1 FROM public.venue_till_lines l
                          WHERE l.sale_id = p_sale_id AND l.kind = 'deposit_credit' AND l.state IN ('held', 'committed')),
      'serviceChargeLeftMinor', public.issue_4490_till_sc_left(p_sale_id),
      'unitsPaid', COALESCE((
        SELECT jsonb_object_agg(x.ref, x.units) FROM (
          SELECT COALESCE(si.venue_order_item_id, si.till_line_id)::text AS ref, sum(si.units) AS units
          FROM public.venue_till_share_items si
          JOIN public.venue_till_shares sh ON sh.id = si.share_id
          WHERE sh.sale_id = p_sale_id AND sh.state = 'paid'
          GROUP BY 1) x), '{}'::jsonb)),
    'creditMinor', s.credit_minor,
    'creditUsedMinor', LEAST(s.credit_minor, s.subtotal_minor + s.service_charge_minor),
    'reservation', (SELECT jsonb_build_object('id', r.id, 'name', r.guest_name, 'partySize', r.party_size,
                      'reservedFor', r.reserved_for, 'status', r.status, 'source', r.source)
                    FROM public.reservations r WHERE r.id = s.reservation_id),
    'minimumSpend', (
      SELECT CASE WHEN m.minimum > 0 THEN jsonb_build_object(
          'minimumMinor', m.minimum, 'spentMinor', s.subtotal_minor,
          'shortMinor', GREATEST(m.minimum - s.subtotal_minor, 0)) END
      FROM (
        SELECT GREATEST(
          COALESCE((SELECT t.min_spend_minor FROM public.qr_spots q
                    JOIN public.venue_tables t ON t.id = q.venue_table_id WHERE q.id = s.qr_spot_id), 0),
          COALESCE((SELECT r.min_spend_minor FROM public.reservations r WHERE r.id = s.reservation_id), 0)) AS minimum
        WHERE public.issue_4490_venue_feature_on(s.venue_id, 'min_spend_tables')
      ) m),
    'hourSessions', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
          'lineId', l.id, 'rootLineId', COALESCE(l.extends_line_id, l.id), 'groupId', l.stay_group_id,
          'startsAt', (SELECT min(lower(c.booked_range)) FROM public.venue_space_claims c
                       WHERE c.group_id = l.stay_group_id AND c.state IN ('held', 'committed', 'released')),
          'endsAt', (SELECT max(upper(c.booked_range)) FROM public.venue_space_claims c
                     WHERE c.group_id = l.stay_group_id AND c.state IN ('held', 'committed', 'released')),
          'unitName', (SELECT string_agg(sp.name, ' + ' ORDER BY sp.sort_order, sp.name)
                       FROM public.venue_space_claims c JOIN public.venue_spaces sp ON sp.id = c.space_id
                       WHERE c.group_id = l.stay_group_id AND c.state IN ('held', 'committed', 'released')),
          'stepMinutes', (SELECT COALESCE(o.booking_length_step_minutes, 60)
                          FROM public.stay_reservation_lines rl JOIN public.stay_offerings o ON o.id = rl.offering_id
                          WHERE rl.group_id = l.stay_group_id ORDER BY rl.created_at LIMIT 1))
        ORDER BY l.created_at, l.id)
      FROM public.venue_till_lines l
      WHERE l.sale_id = s.id AND l.kind = 'by_the_hour' AND l.state IN ('held', 'committed')), '[]'::jsonb))
  FROM public.venue_till_sales s WHERE s.id = p_sale_id
$$;

-- ---------------------------------------------------------------------------
-- 8. Privileges: every new function is internal (service role only).
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION
  public.issue_4490_reservation_deposit_refund_guard(),
  public.issue_4490_till_line_voided(),
  public.issue_4490_till_session_book(uuid, uuid, uuid, uuid, integer, uuid, text, tstzrange, uuid),
  public.issue_4490_till_session_span(uuid),
  public.issue_4490_till_start_session(uuid, uuid, uuid, integer, integer, uuid, text, integer),
  public.issue_4490_till_extend_session(uuid, uuid, integer, uuid, text, integer),
  public.issue_4490_till_seat(uuid, uuid, uuid, integer, uuid, text, uuid, text),
  public.issue_4490_till_catalog_extras(uuid),
  public.issue_4490_till_sc_left(uuid),
  public.issue_4490_till_sale_extras(uuid)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
  public.issue_4490_till_session_book(uuid, uuid, uuid, uuid, integer, uuid, text, tstzrange, uuid),
  public.issue_4490_till_session_span(uuid),
  public.issue_4490_till_start_session(uuid, uuid, uuid, integer, integer, uuid, text, integer),
  public.issue_4490_till_extend_session(uuid, uuid, integer, uuid, text, integer),
  public.issue_4490_till_seat(uuid, uuid, uuid, integer, uuid, text, uuid, text),
  public.issue_4490_till_catalog_extras(uuid),
  public.issue_4490_till_sc_left(uuid),
  public.issue_4490_till_sale_extras(uuid)
TO service_role;

COMMIT;
