-- Issue #4490, spec 08 O2: tap to pay on Till sales, scan to pay, and a bank
-- transfer that confirms itself.
--
-- A card or scan payment rides on ONE carrier venue_orders row (spec 08 §3 O1
-- model): money_path 'mingla', fulfillment_status 'payment_only', no items,
-- till_payment_id set. The carrier is priced by the edge with the shared
-- venue-order engine (computeVenueOrderMoney, the venue-order fee rule, tip
-- never fee'd) and every number is held together by the venue_orders CHECKs;
-- the database decides the amount (what is left on the check, its service
-- charge share) and refuses a priced carrier that does not match.
--
-- 1. door_tap_intents is generalised: a row is an event door tap (event_id) or
--    a Till tap (till_payment_id), never both. Event rows are unchanged.
-- 2. issue_4490_till_tap_record records a succeeded Till tap through
--    pg_venue_order_finalize_payment (the same amount gate and fee snapshot as
--    the webhook; never a hand-written paid flip).
-- 3. venue_till_pay_codes: one code per scan payment (the payment is the
--    "share" until O4), same alphabet and length as door codes, 15 minutes,
--    60 once the guest starts paying. RLS read by venue viewers, no client writes.
-- 4. pg_venue_order_finalize_payment gains one branch: a paid Till carrier
--    writes the payment's channel and applies the payment to its check
--    (issue_4490_till_apply_payment: late money is recorded, never refused,
--    and lands in overpaid_minor).
-- 5. The day's money counts card and scan offer money of the Till once, as
--    online (Mingla rail) money on the service day.
--
-- No venue_id column is added (the #2099 dependency seal is unchanged): Till
-- tap rows and pay codes reach the venue through their payment's check.
-- Static SQL. Local stack only until Seth approves a production migration.

BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE FUNCTION pg_temp.issue_4490_o2_patch(
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
    RAISE EXCEPTION 'issue_4490 O2 patch precondition failed for %: old % (expected %)',
      p_sig, v_old_count, p_count;
  END IF;
  EXECUTE replace(v_def, p_old, p_new);
END;
$patch$;

-- ---------------------------------------------------------------------------
-- 1. Columns on the O1 tables.
-- ---------------------------------------------------------------------------
-- A carrier and its payment point at each other: the carrier's link is checked
-- at commit so both rows are written in one transaction.
ALTER TABLE public.venue_orders
  ALTER CONSTRAINT venue_orders_till_payment_id_fkey DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE public.venue_till_payments
  ADD COLUMN card_brand text NULL CHECK (card_brand IS NULL OR card_brand ~ '^[a-z_]{2,20}$'),
  ADD COLUMN card_last4 text NULL CHECK (card_last4 IS NULL OR card_last4 ~ '^[0-9]{4}$'),
  ADD COLUMN cancelled_at timestamptz NULL,
  ADD COLUMN late_kept_at timestamptz NULL;
-- One live Mingla-rail carrier per payment.
CREATE UNIQUE INDEX venue_orders_till_carrier_uniq ON public.venue_orders (till_payment_id)
  WHERE till_payment_id IS NOT NULL AND fulfillment_status = 'payment_only';

-- ---------------------------------------------------------------------------
-- 2. door_tap_intents: event door or Till.
-- ---------------------------------------------------------------------------
ALTER TABLE public.door_tap_intents
  ALTER COLUMN event_id DROP NOT NULL,
  ADD COLUMN till_payment_id uuid NULL REFERENCES public.venue_till_payments(id) ON DELETE RESTRICT,
  ADD CONSTRAINT door_tap_intents_one_scope CHECK ((event_id IS NULL) <> (till_payment_id IS NULL));
ALTER TABLE public.door_tap_intents DROP CONSTRAINT door_tap_intents_event_id_client_request_id_key;
CREATE UNIQUE INDEX door_tap_intents_event_request_uniq ON public.door_tap_intents (event_id, client_request_id)
  WHERE event_id IS NOT NULL;
CREATE UNIQUE INDEX door_tap_intents_till_request_uniq ON public.door_tap_intents (client_request_id)
  WHERE till_payment_id IS NOT NULL;
CREATE UNIQUE INDEX door_tap_intents_till_payment_uniq ON public.door_tap_intents (till_payment_id)
  WHERE till_payment_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 3. Pay codes.
-- ---------------------------------------------------------------------------
CREATE TABLE public.venue_till_pay_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE CHECK (code ~ '^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$'),
  payment_id uuid NOT NULL UNIQUE REFERENCES public.venue_till_payments(id) ON DELETE RESTRICT,
  provider text NOT NULL CHECK (provider IN ('stripe', 'paystack')),
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'opened', 'paid', 'expired', 'cancelled', 'failed')),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '15 minutes'),
  opened_at timestamptz NULL,
  pay_started_at timestamptz NULL,
  closed_at timestamptz NULL,
  text_link_count smallint NOT NULL DEFAULT 0 CHECK (text_link_count BETWEEN 0 AND 3),
  buyer_name text NULL CHECK (buyer_name IS NULL OR char_length(btrim(buyer_name)) BETWEEN 2 AND 120),
  buyer_email text NULL CHECK (buyer_email IS NULL OR char_length(buyer_email) <= 254),
  buyer_phone_e164 text NULL CHECK (buyer_phone_e164 IS NULL OR buyer_phone_e164 ~ '^\+[1-9][0-9]{6,14}$'),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT venue_till_pay_codes_closed_shape CHECK (
    (status IN ('open', 'opened')) = (closed_at IS NULL)),
  CONSTRAINT venue_till_pay_codes_expiry_cap CHECK (expires_at <= created_at + interval '61 minutes')
);
ALTER TABLE public.venue_till_pay_codes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.venue_till_pay_codes FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.venue_till_pay_codes TO service_role;
-- Staff read the code and its state; the guest's contact stays server-side.
GRANT SELECT (id, code, payment_id, provider, status, expires_at, opened_at, pay_started_at, closed_at,
  text_link_count, created_by, created_at, updated_at) ON public.venue_till_pay_codes TO authenticated;
CREATE POLICY venue_till_pay_codes_read ON public.venue_till_pay_codes
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.venue_till_payments p
    JOIN public.venue_till_sales s ON s.id = p.sale_id
    WHERE p.id = venue_till_pay_codes.payment_id
      AND public.issue_4490_can_view_venue(s.venue_id)));

-- ---------------------------------------------------------------------------
-- 4. Starting a card payment (tap or scan).
-- ---------------------------------------------------------------------------
-- Lazy expiry: a code past its time closes, and its payment is cancelled, so
-- the check can take money again. Money that still lands is late money.
CREATE FUNCTION public.issue_4490_till_expire_codes(p_sale_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_count integer := 0;
  v_row record;
BEGIN
  IF NOT public.issue_1389_service_role() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  FOR v_row IN
    SELECT c.id, c.payment_id FROM public.venue_till_pay_codes c
    JOIN public.venue_till_payments p ON p.id = c.payment_id
    WHERE p.sale_id = p_sale_id AND c.status IN ('open', 'opened') AND c.expires_at <= now()
    ORDER BY c.id
    FOR UPDATE OF c
  LOOP
    UPDATE public.venue_till_pay_codes
    SET status = 'expired', closed_at = now(), updated_at = now() WHERE id = v_row.id;
    PERFORM public.issue_4490_till_card_close(v_row.payment_id);
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$$;

-- The payment stops waiting: pending → cancelled, its carrier stops being
-- payable on our side, the check opens again. A paid payment is untouched.
CREATE FUNCTION public.issue_4490_till_card_close(p_payment_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_payment public.venue_till_payments%ROWTYPE;
BEGIN
  IF NOT public.issue_1389_service_role() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_payment FROM public.venue_till_payments WHERE id = p_payment_id FOR UPDATE;
  IF NOT FOUND OR v_payment.state <> 'pending' THEN
    RETURN false;
  END IF;
  UPDATE public.venue_till_payments
  SET state = 'cancelled', cancelled_at = now(), updated_at = now() WHERE id = v_payment.id;
  UPDATE public.venue_orders
  SET payment_status = 'cancelled', cancelled_at = COALESCE(cancelled_at, now()), updated_at = now()
  WHERE id = v_payment.carrier_order_id AND payment_status IN ('pending', 'failed');
  UPDATE public.venue_till_pay_codes
  SET status = 'cancelled', closed_at = now(), updated_at = now()
  WHERE payment_id = v_payment.id AND status IN ('open', 'opened');
  UPDATE public.venue_till_sales
  SET state = 'open', version = version + 1, updated_at = now()
  WHERE id = v_payment.sale_id AND state = 'paying';
  RETURN true;
END;
$$;

-- Step 1 of a card payment: sends any held round (T8), prices the check from
-- its children and says what is left. Nothing is taken. The edge prices the
-- carrier from this, then calls issue_4490_till_card_start with the version.
CREATE FUNCTION public.issue_4490_till_card_prepare(
  p_sale_id uuid,
  p_actor uuid,
  p_expected_version integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_sale public.venue_till_sales%ROWTYPE;
  v_sent jsonb;
  v_sc_left bigint;
BEGIN
  v_sale := public.issue_4490_till_lock(p_sale_id, p_actor, p_expected_version);
  PERFORM public.issue_4490_till_expire_codes(v_sale.id);
  SELECT * INTO v_sale FROM public.venue_till_sales WHERE id = v_sale.id FOR UPDATE;
  IF v_sale.state = 'paying'
     OR EXISTS (SELECT 1 FROM public.venue_till_payments p WHERE p.sale_id = v_sale.id AND p.state = 'pending') THEN
    RAISE EXCEPTION 'till_payment_in_progress' USING ERRCODE = 'PT409';
  END IF;
  IF v_sale.state <> 'open' THEN
    RAISE EXCEPTION 'till_check_closed' USING ERRCODE = 'PT409';
  END IF;
  v_sent := public.issue_4490_till_send(v_sale.id, p_actor);
  IF EXISTS (
    SELECT 1 FROM public.venue_till_lines l
    JOIN public.venue_orders o ON o.id = l.venue_order_id
    WHERE l.sale_id = v_sale.id AND l.kind = 'menu_round' AND l.state <> 'voided'
      AND (o.payment_status NOT IN ('pending', 'cancelled') OR o.money_path <> 'venue_collected')) THEN
    RAISE EXCEPTION 'till_round_settled_elsewhere' USING ERRCODE = 'PT409';
  END IF;
  PERFORM public.issue_4490_till_reprice(v_sale.id);
  SELECT * INTO v_sale FROM public.venue_till_sales WHERE id = v_sale.id FOR UPDATE;
  IF v_sale.total_due_minor - v_sale.paid_minor <= 0 THEN
    RAISE EXCEPTION 'till_nothing_to_pay' USING ERRCODE = 'PT409';
  END IF;
  v_sc_left := GREATEST(v_sale.service_charge_minor - COALESCE((
    SELECT sum(p.service_charge_minor) FROM public.venue_till_payments p
    WHERE p.sale_id = v_sale.id AND p.state IN ('paid', 'refunded', 'partially_refunded') AND NOT p.paid_late), 0), 0);
  RETURN jsonb_build_object(
    'saleId', v_sale.id, 'venueId', v_sale.venue_id, 'brandId', v_sale.brand_id,
    'currency', v_sale.currency, 'version', v_sale.version,
    'amountMinor', v_sale.total_due_minor - v_sale.paid_minor,
    'serviceChargeMinor', LEAST(v_sc_left, v_sale.total_due_minor - v_sale.paid_minor),
    'sentOrderIds', COALESCE(v_sent->'sentOrderIds', '[]'::jsonb));
END;
$$;

-- Step 2: the pending payment, its carrier and (scan) its code, in one
-- transaction. The amount is what is left on the check, never the body's; the
-- priced carrier must match it to the minor unit.
CREATE FUNCTION public.issue_4490_till_card_start(
  p_sale_id uuid,
  p_method text,
  p_tip_minor bigint,
  p_actor uuid,
  p_device_user uuid,
  p_client_request_id uuid,
  p_expected_version integer,
  p_money jsonb,
  p_code text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_sale public.venue_till_sales%ROWTYPE;
  v_existing public.venue_till_payments%ROWTYPE;
  v_settings public.venue_till_settings%ROWTYPE;
  v_remaining bigint;
  v_sc bigint;
  v_tip bigint := COALESCE(p_tip_minor, 0);
  v_payment_id uuid := gen_random_uuid();
  v_carrier_id uuid := gen_random_uuid();
  v_provider text := p_money->>'provider';
  v_total bigint := (p_money->>'totalCents')::bigint;
  v_code public.venue_till_pay_codes%ROWTYPE;
BEGIN
  IF p_method NOT IN ('tap', 'scan') OR p_client_request_id IS NULL OR v_tip < 0
     OR p_money IS NULL OR jsonb_typeof(p_money) <> 'object'
     OR v_provider NOT IN ('stripe', 'paystack') OR v_total IS NULL OR v_total <= 0
     OR (p_method = 'tap' AND (v_provider <> 'stripe' OR p_code IS NOT NULL))
     OR (p_method = 'scan' AND p_code IS NULL) THEN
    RAISE EXCEPTION 'till_invalid_payload' USING ERRCODE = '22023';
  END IF;
  -- Replay: the same request returns the payment (and code) it made.
  SELECT p.* INTO v_existing FROM public.venue_till_payments p
  WHERE p.sale_id = p_sale_id AND p.client_request_id = p_client_request_id;
  IF FOUND THEN
    PERFORM public.issue_4490_till_lock(p_sale_id, p_actor, NULL);
    IF v_existing.method <> p_method THEN
      RAISE EXCEPTION 'till_idempotency_conflict' USING ERRCODE = 'PT409';
    END IF;
    SELECT * INTO v_code FROM public.venue_till_pay_codes WHERE payment_id = v_existing.id;
    RETURN jsonb_build_object('paymentId', v_existing.id, 'carrierOrderId', v_existing.carrier_order_id,
      'replayed', true, 'state', v_existing.state, 'amountMinor', v_existing.amount_minor,
      'tipMinor', v_existing.tip_minor, 'chargedMinor', v_existing.charged_minor,
      'code', v_code.code, 'codeStatus', v_code.status, 'expiresAt', v_code.expires_at);
  END IF;
  v_sale := public.issue_4490_till_lock(p_sale_id, p_actor, p_expected_version);
  IF v_sale.state = 'paying'
     OR EXISTS (SELECT 1 FROM public.venue_till_payments p WHERE p.sale_id = v_sale.id AND p.state = 'pending') THEN
    RAISE EXCEPTION 'till_payment_in_progress' USING ERRCODE = 'PT409';
  END IF;
  IF v_sale.state <> 'open' THEN
    RAISE EXCEPTION 'till_check_closed' USING ERRCODE = 'PT409';
  END IF;
  -- prepare already sent and repriced at this version: a held round now means
  -- the check moved since.
  IF EXISTS (SELECT 1 FROM public.venue_till_lines l JOIN public.venue_orders o ON o.id = l.venue_order_id
             WHERE l.sale_id = v_sale.id AND l.kind = 'menu_round' AND o.fulfillment_status = 'held') THEN
    RAISE EXCEPTION 'till_check_changed' USING ERRCODE = 'PT409';
  END IF;
  v_remaining := v_sale.total_due_minor - v_sale.paid_minor;
  IF v_remaining <= 0 THEN
    RAISE EXCEPTION 'till_nothing_to_pay' USING ERRCODE = 'PT409';
  END IF;
  v_sc := LEAST(GREATEST(v_sale.service_charge_minor - COALESCE((
    SELECT sum(p.service_charge_minor) FROM public.venue_till_payments p
    WHERE p.sale_id = v_sale.id AND p.state IN ('paid', 'refunded', 'partially_refunded') AND NOT p.paid_late), 0), 0),
    v_remaining);
  SELECT * INTO v_settings FROM public.venue_till_settings WHERE venue_id = v_sale.venue_id;
  IF v_tip > 0 AND (COALESCE(v_settings.tips_enabled, true) = false OR v_tip > v_remaining) THEN
    RAISE EXCEPTION 'till_tip_invalid' USING ERRCODE = '22023';
  END IF;
  -- The priced carrier must be this payment: base + service charge = what is
  -- left, tip as chosen, same currency.
  IF (p_money->>'subtotalCents')::bigint IS DISTINCT FROM v_remaining - v_sc
     OR (p_money->>'serviceChargeCents')::bigint IS DISTINCT FROM v_sc
     OR (p_money->>'tipCents')::bigint IS DISTINCT FROM v_tip
     OR upper(COALESCE(p_money->>'currency', '')) <> v_sale.currency THEN
    RAISE EXCEPTION 'till_check_changed' USING ERRCODE = 'PT409';
  END IF;
  IF v_total > 2147483647 OR v_remaining + v_tip > 2147483647 THEN
    RAISE EXCEPTION 'till_payment_too_large' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.venue_orders (
    id, session_id, brand_id, venue_id, qr_spot_id, source, taken_by_user_id,
    money_path, provider, stripe_account_id, currency,
    subtotal_cents, list_subtotal_cents, discount_cents, service_charge_bps, service_charge_cents, tip_cents,
    effective_take_rate_bps, service_fee_bps, mingla_fee_cents, platform_service_fee_cents,
    pass_mingla_fee, pass_service_fee, pass_tax, buyer_subtotal_cents, tax_amount_cents, total_cents,
    pricing_breakdown, payment_status, fulfillment_status, idempotency_key, till_payment_id, metadata
  ) VALUES (
    v_carrier_id, v_sale.session_id, v_sale.brand_id, v_sale.venue_id, v_sale.qr_spot_id, 'staff', p_actor,
    'mingla', v_provider,
    CASE WHEN v_provider = 'stripe' THEN NULLIF(p_money->>'stripeAccountId', '') END, v_sale.currency,
    (v_remaining - v_sc)::integer, (v_remaining - v_sc)::integer, 0, 0, v_sc::integer, v_tip::integer,
    (p_money->>'effectiveTakeRateBps')::integer, (p_money->>'serviceFeeBps')::integer,
    (p_money->>'minglaFeeCents')::integer, (p_money->>'platformServiceFeeCents')::integer,
    COALESCE((p_money->>'passMinglaFee')::boolean, false), COALESCE((p_money->>'passServiceFee')::boolean, false),
    COALESCE((p_money->>'passTax')::boolean, false),
    (p_money->>'buyerSubtotalCents')::integer, (p_money->>'taxAmountCents')::integer, v_total::integer,
    p_money->'pricingBreakdown', 'pending', 'payment_only', 'till_carrier:' || v_payment_id::text, v_payment_id,
    jsonb_build_object('till_carrier', true, 'till_method', p_method));
  IF v_provider = 'stripe' AND NOT EXISTS (
       SELECT 1 FROM public.venue_orders WHERE id = v_carrier_id AND stripe_account_id IS NOT NULL) THEN
    RAISE EXCEPTION 'till_invalid_payload' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.venue_till_payments (
    id, sale_id, method, amount_minor, service_charge_minor, tip_minor, charged_minor, state, carrier_order_id,
    taken_by_user_id, device_user_id, server_user_id, client_request_id
  ) VALUES (
    v_payment_id, v_sale.id, p_method, v_remaining, v_sc, v_tip, v_total, 'pending', v_carrier_id,
    p_actor, COALESCE(p_device_user, p_actor), v_sale.server_user_id, p_client_request_id);
  IF p_method = 'scan' THEN
    INSERT INTO public.venue_till_pay_codes (code, payment_id, provider, created_by)
    VALUES (p_code, v_payment_id, v_provider, p_actor)
    RETURNING * INTO v_code;
  END IF;
  UPDATE public.venue_till_sales
  SET state = 'paying', version = version + 1, updated_at = now() WHERE id = v_sale.id;
  RETURN jsonb_build_object('paymentId', v_payment_id, 'carrierOrderId', v_carrier_id, 'replayed', false,
    'state', 'pending', 'amountMinor', v_remaining, 'tipMinor', v_tip, 'chargedMinor', v_total,
    'code', v_code.code, 'codeStatus', v_code.status, 'expiresAt', v_code.expires_at);
END;
$$;

-- Staff stop a card payment (Cancel payment, or a new code): the payment and
-- its code close, the check opens again. Money that lands later is late money.
CREATE FUNCTION public.issue_4490_till_card_cancel(p_payment_id uuid, p_actor uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_payment public.venue_till_payments%ROWTYPE;
BEGIN
  SELECT * INTO v_payment FROM public.venue_till_payments WHERE id = p_payment_id;
  IF NOT FOUND OR v_payment.method NOT IN ('tap', 'scan') THEN
    RAISE EXCEPTION 'till_payment_not_found' USING ERRCODE = 'P0002';
  END IF;
  PERFORM public.issue_4490_till_lock(v_payment.sale_id, p_actor, NULL);
  SELECT * INTO v_payment FROM public.venue_till_payments WHERE id = p_payment_id FOR UPDATE;
  IF v_payment.state IN ('paid', 'refunded', 'partially_refunded') THEN
    RAISE EXCEPTION 'till_payment_already_paid' USING ERRCODE = 'PT409';
  END IF;
  PERFORM public.issue_4490_till_card_close(v_payment.id);
  RETURN jsonb_build_object('paymentId', v_payment.id, 'state', 'cancelled',
    'sale', public.issue_4490_till_sale_projection(v_payment.sale_id));
END;
$$;

-- ---------------------------------------------------------------------------
-- 5. Recording a Till tap.
-- ---------------------------------------------------------------------------
-- T19: never checks a PIN or a seller (money already moved). Idempotent: the
-- webhook for the same PaymentIntent, the sweep and a retried complete all
-- land on the same carrier and the same payment once.
CREATE FUNCTION public.issue_4490_till_tap_record(
  p_payment_intent_id text,
  p_charge_id text,
  p_amount bigint,
  p_card_brand text,
  p_last4 text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_intent public.door_tap_intents%ROWTYPE;
  v_payment public.venue_till_payments%ROWTYPE;
  v_carrier public.venue_orders%ROWTYPE;
  v_brand text := lower(NULLIF(btrim(COALESCE(p_card_brand, '')), ''));
  v_last4 text := NULLIF(btrim(COALESCE(p_last4, '')), '');
  v_result jsonb;
BEGIN
  IF NOT public.issue_1389_service_role() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_intent FROM public.door_tap_intents
  WHERE stripe_payment_intent_id = p_payment_intent_id FOR UPDATE;
  IF NOT FOUND OR v_intent.till_payment_id IS NULL THEN
    RAISE EXCEPTION 'till_payment_not_found' USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO v_payment FROM public.venue_till_payments WHERE id = v_intent.till_payment_id;
  SELECT * INTO v_carrier FROM public.venue_orders WHERE id = v_payment.carrier_order_id;
  IF p_amount IS DISTINCT FROM v_carrier.total_cents::bigint THEN
    RAISE EXCEPTION 'till_tap_amount_mismatch' USING ERRCODE = '22023';
  END IF;
  v_result := public.pg_venue_order_finalize_payment(
    v_carrier.id, 'stripe', p_amount::integer, v_carrier.currency, p_payment_intent_id, p_charge_id, NULL, NULL);
  IF COALESCE(v_result->>'status', '') NOT IN ('finalized', 'replayed') THEN
    RAISE EXCEPTION 'till_tap_not_recorded' USING ERRCODE = 'P0001',
      DETAIL = COALESCE(v_result->>'status', 'unknown');
  END IF;
  UPDATE public.venue_till_payments
  SET card_brand = COALESCE(card_brand, CASE WHEN v_brand ~ '^[a-z_]{2,20}$' THEN v_brand END),
      card_last4 = COALESCE(card_last4, CASE WHEN v_last4 ~ '^[0-9]{4}$' THEN v_last4 END),
      updated_at = now()
  WHERE id = v_payment.id RETURNING * INTO v_payment;
  UPDATE public.door_tap_intents SET status = 'recorded', updated_at = now()
  WHERE id = v_intent.id AND status <> 'recorded';
  RETURN jsonb_build_object('paymentId', v_payment.id, 'saleId', v_payment.sale_id,
    'replayed', v_result->>'status' = 'replayed', 'paidLate', v_payment.paid_late,
    'state', v_payment.state, 'cardBrand', v_payment.card_brand, 'cardLast4', v_payment.card_last4,
    'sale', public.issue_4490_till_sale_projection(v_payment.sale_id));
END;
$$;

-- ---------------------------------------------------------------------------
-- 6. Pay codes: the guest's page and staff.
-- ---------------------------------------------------------------------------
-- The guest page (anonymous through venue-till): venue, lines, amount. Nothing
-- about who sold it or who paid. Opening flips open → opened.
CREATE FUNCTION public.issue_4490_till_pay_code_view(p_code text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_code public.venue_till_pay_codes%ROWTYPE;
  v_payment public.venue_till_payments%ROWTYPE;
  v_sale public.venue_till_sales%ROWTYPE;
  v_carrier public.venue_orders%ROWTYPE;
  v_venue text;
  v_lines jsonb;
BEGIN
  IF NOT public.issue_1389_service_role() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_code IS NULL OR p_code !~ '^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$' THEN
    RAISE EXCEPTION 'pay_code_not_found' USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO v_code FROM public.venue_till_pay_codes WHERE code = p_code FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'pay_code_not_found' USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO v_payment FROM public.venue_till_payments WHERE id = v_code.payment_id;
  SELECT * INTO v_sale FROM public.venue_till_sales WHERE id = v_payment.sale_id;
  SELECT * INTO v_carrier FROM public.venue_orders WHERE id = v_payment.carrier_order_id;
  IF v_code.status IN ('open', 'opened') AND v_code.expires_at <= now() THEN
    PERFORM public.issue_4490_till_expire_codes(v_sale.id);
    SELECT * INTO v_code FROM public.venue_till_pay_codes WHERE id = v_code.id;
  ELSIF v_code.status = 'open' THEN
    UPDATE public.venue_till_pay_codes SET status = 'opened', opened_at = now(), updated_at = now()
    WHERE id = v_code.id RETURNING * INTO v_code;
  END IF;
  SELECT v.name INTO v_venue FROM public.venue_listings v WHERE v.id = v_sale.venue_id;
  -- What is on the check (not voided), for the guest to recognise it.
  SELECT COALESCE(jsonb_agg(x.line ORDER BY x.at, x.seq), '[]'::jsonb) INTO v_lines FROM (
    SELECT jsonb_build_object('name', i.item_name_at_order, 'quantity', i.quantity,
             'amountMinor', i.line_total_cents) line, l.created_at at, i.line_no seq
    FROM public.venue_till_lines l
    JOIN public.venue_order_items i ON i.venue_order_id = l.venue_order_id
    WHERE l.sale_id = v_sale.id AND l.kind = 'menu_round' AND l.state <> 'voided' AND i.prep_state <> 'voided'
    UNION ALL
    SELECT jsonb_build_object('name', l.label_snapshot, 'quantity', 1, 'amountMinor', l.amount_minor), l.created_at, 0
    FROM public.venue_till_lines l
    WHERE l.sale_id = v_sale.id AND l.kind <> 'menu_round' AND l.state NOT IN ('voided', 'refunded')
  ) x;
  RETURN jsonb_build_object(
    'status', v_code.status, 'expiresAt', v_code.expires_at, 'provider', v_code.provider,
    'venueName', COALESCE(v_venue, ''), 'currency', v_carrier.currency, 'lines', v_lines,
    'subtotalMinor', v_sale.subtotal_minor, 'serviceChargeMinor', v_sale.service_charge_minor,
    'paidBeforeMinor', GREATEST(v_sale.paid_minor - CASE WHEN v_payment.state = 'paid' AND NOT v_payment.paid_late
                                                     THEN v_payment.amount_minor ELSE 0 END, 0),
    'tipMinor', v_carrier.tip_cents, 'feesMinor', v_carrier.total_cents - v_carrier.tip_cents - v_payment.amount_minor,
    'amountMinor', v_carrier.total_cents,
    'paid', v_payment.state IN ('paid', 'refunded', 'partially_refunded'),
    'paidLate', v_payment.paid_late);
END;
$$;

-- The guest starts paying: their contact goes on the carrier (Mingla money
-- needs it for receipts and refunds) and the code lives up to 60 minutes so a
-- bank transfer can land. Returns what the edge needs to start the provider.
CREATE FUNCTION public.issue_4490_till_pay_code_buyer(
  p_code text,
  p_name text,
  p_email text,
  p_phone_e164 text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_code public.venue_till_pay_codes%ROWTYPE;
  v_payment public.venue_till_payments%ROWTYPE;
  v_carrier public.venue_orders%ROWTYPE;
  v_venue text;
BEGIN
  IF NOT public.issue_1389_service_role() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_name IS NULL OR char_length(btrim(p_name)) NOT BETWEEN 2 AND 120
     OR p_email IS NULL OR p_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' OR char_length(p_email) > 254
     OR p_phone_e164 IS NULL OR p_phone_e164 !~ '^\+[1-9][0-9]{6,14}$' THEN
    RAISE EXCEPTION 'pay_code_buyer_invalid' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_code FROM public.venue_till_pay_codes WHERE code = p_code FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'pay_code_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_code.status NOT IN ('open', 'opened') OR v_code.expires_at <= now() THEN
    RAISE EXCEPTION 'pay_code_closed' USING ERRCODE = 'PT409';
  END IF;
  SELECT * INTO v_payment FROM public.venue_till_payments WHERE id = v_code.payment_id FOR UPDATE;
  IF v_payment.state <> 'pending' THEN
    RAISE EXCEPTION 'pay_code_closed' USING ERRCODE = 'PT409';
  END IF;
  UPDATE public.venue_orders
  SET buyer_name = btrim(p_name), buyer_email = lower(btrim(p_email)), buyer_phone_e164 = p_phone_e164,
      updated_at = now()
  WHERE id = v_payment.carrier_order_id AND payment_status IN ('pending', 'failed')
  RETURNING * INTO v_carrier;
  UPDATE public.venue_till_pay_codes
  SET buyer_name = btrim(p_name), buyer_email = lower(btrim(p_email)), buyer_phone_e164 = p_phone_e164,
      status = 'opened', opened_at = COALESCE(opened_at, now()), pay_started_at = COALESCE(pay_started_at, now()),
      expires_at = GREATEST(expires_at, LEAST(now() + interval '60 minutes', created_at + interval '61 minutes')),
      updated_at = now()
  WHERE id = v_code.id RETURNING * INTO v_code;
  SELECT v.name INTO v_venue FROM public.venue_listings v WHERE v.id = v_carrier.venue_id;
  RETURN jsonb_build_object(
    'carrierOrderId', v_carrier.id, 'paymentId', v_payment.id, 'brandId', v_carrier.brand_id,
    'provider', v_carrier.provider, 'stripeAccountId', v_carrier.stripe_account_id,
    'currency', v_carrier.currency, 'totalCents', v_carrier.total_cents,
    'applicationFeeCents', v_carrier.mingla_fee_cents + v_carrier.platform_service_fee_cents,
    'venueName', COALESCE(v_venue, ''), 'expiresAt', v_code.expires_at,
    'paystackReference', v_carrier.paystack_reference,
    'continuation', v_carrier.metadata->'payment_continuation');
END;
$$;

-- Staff read a code's state (the sheet polls it). Expired codes close here.
CREATE FUNCTION public.issue_4490_till_pay_code_status(p_code text, p_venue_id uuid, p_actor uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_code public.venue_till_pay_codes%ROWTYPE;
  v_payment public.venue_till_payments%ROWTYPE;
  v_sale public.venue_till_sales%ROWTYPE;
BEGIN
  IF NOT public.issue_1389_service_role() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_code FROM public.venue_till_pay_codes WHERE code = p_code;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'pay_code_not_found' USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO v_payment FROM public.venue_till_payments WHERE id = v_code.payment_id;
  SELECT * INTO v_sale FROM public.venue_till_sales WHERE id = v_payment.sale_id;
  IF v_sale.venue_id <> p_venue_id THEN
    RAISE EXCEPTION 'pay_code_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public.issue_4490_can_sell(v_sale.venue_id, p_actor) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  IF v_code.status IN ('open', 'opened') AND v_code.expires_at <= now() THEN
    PERFORM public.issue_4490_till_expire_codes(v_sale.id);
    SELECT * INTO v_code FROM public.venue_till_pay_codes WHERE id = v_code.id;
    SELECT * INTO v_payment FROM public.venue_till_payments WHERE id = v_code.payment_id;
  END IF;
  RETURN jsonb_build_object('code', v_code.code, 'status', v_code.status, 'expiresAt', v_code.expires_at,
    'payStarted', v_code.pay_started_at IS NOT NULL, 'textLinksLeft', 3 - v_code.text_link_count,
    'paymentId', v_payment.id, 'paymentState', v_payment.state, 'paidLate', v_payment.paid_late,
    'providerChannel', v_payment.provider_channel, 'saleId', v_sale.id);
END;
$$;

-- "Text them the link": at most three texts per code (the door's rule and
-- its message), sent to the number staff typed.
CREATE FUNCTION public.issue_4490_till_pay_code_text(
  p_code text,
  p_venue_id uuid,
  p_actor uuid,
  p_phone_e164 text,
  p_pay_url text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_code public.venue_till_pay_codes%ROWTYPE;
  v_sale public.venue_till_sales%ROWTYPE;
  v_venue text;
BEGIN
  IF NOT public.issue_1389_service_role() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_phone_e164 IS NULL OR p_phone_e164 !~ '^\+[1-9][0-9]{6,14}$' THEN
    RAISE EXCEPTION 'till_receipt_phone_invalid' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_code FROM public.venue_till_pay_codes WHERE code = p_code FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'pay_code_not_found' USING ERRCODE = 'P0002';
  END IF;
  SELECT s.* INTO v_sale FROM public.venue_till_sales s
  JOIN public.venue_till_payments p ON p.sale_id = s.id WHERE p.id = v_code.payment_id;
  IF v_sale.venue_id <> p_venue_id THEN
    RAISE EXCEPTION 'pay_code_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public.issue_4490_can_sell(v_sale.venue_id, p_actor) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  IF v_code.status NOT IN ('open', 'opened') OR v_code.expires_at <= now() THEN
    RAISE EXCEPTION 'pay_code_closed' USING ERRCODE = 'PT409';
  END IF;
  IF v_code.text_link_count >= 3 THEN
    RAISE EXCEPTION 'pay_code_text_limit' USING ERRCODE = 'PT409';
  END IF;
  UPDATE public.venue_till_pay_codes
  SET text_link_count = text_link_count + 1, updated_at = now() WHERE id = v_code.id;
  SELECT COALESCE(NULLIF(btrim(v.name), ''), 'the venue') INTO v_venue
  FROM public.venue_listings v WHERE v.id = v_sale.venue_id;
  INSERT INTO public.notification_outbox (
    category_key, user_id, contact, brand_id, payload, idempotency_key, country_code, status
  ) VALUES (
    'buyer_door_pay_link', NULL, p_phone_e164, v_sale.brand_id,
    jsonb_build_object('venue_id', v_sale.venue_id, 'till_pay_code_id', v_code.id,
      'event_title', v_venue, 'pay_url', p_pay_url, 'channel_hint', 'sms'),
    'buyer_till_pay_link:' || v_code.id::text || ':' || (v_code.text_link_count + 1)::text,
    public.mingla_e164_country(p_phone_e164), 'pending');
  RETURN jsonb_build_object('sent', true, 'textLinksLeft', 2 - v_code.text_link_count);
END;
$$;

-- "Keep it as payment": a cancelled payment that was paid later counts toward
-- what is still due on the check (never more); anything beyond stays in
-- overpaid_minor for a refund. The banner then clears.
CREATE FUNCTION public.issue_4490_till_keep_late_payment(
  p_payment_id uuid,
  p_actor uuid,
  p_expected_version integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_payment public.venue_till_payments%ROWTYPE;
  v_sale public.venue_till_sales%ROWTYPE;
  v_left bigint;
  v_move bigint;
BEGIN
  SELECT * INTO v_payment FROM public.venue_till_payments WHERE id = p_payment_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'till_payment_not_found' USING ERRCODE = 'P0002';
  END IF;
  v_sale := public.issue_4490_till_lock(v_payment.sale_id, p_actor, p_expected_version);
  SELECT * INTO v_payment FROM public.venue_till_payments WHERE id = p_payment_id FOR UPDATE;
  IF NOT v_payment.paid_late OR v_payment.late_kept_at IS NOT NULL OR v_payment.state <> 'paid' THEN
    RAISE EXCEPTION 'till_late_nothing_to_keep' USING ERRCODE = 'PT409';
  END IF;
  IF v_sale.state NOT IN ('open', 'paying') THEN
    RAISE EXCEPTION 'till_late_nothing_to_keep' USING ERRCODE = 'PT409';
  END IF;
  IF EXISTS (SELECT 1 FROM public.venue_till_payments p WHERE p.sale_id = v_sale.id AND p.state = 'pending') THEN
    RAISE EXCEPTION 'till_payment_in_progress' USING ERRCODE = 'PT409';
  END IF;
  v_left := GREATEST(v_sale.total_due_minor - v_sale.paid_minor, 0);
  v_move := LEAST(v_left, v_sale.overpaid_minor,
    v_payment.amount_minor - COALESCE((SELECT sum(r.amount_minor) FROM public.venue_till_refunds r
                                       WHERE r.payment_id = v_payment.id), 0));
  IF v_move <= 0 THEN
    RAISE EXCEPTION 'till_late_nothing_to_keep' USING ERRCODE = 'PT409';
  END IF;
  UPDATE public.venue_till_payments SET late_kept_at = now(), updated_at = now() WHERE id = v_payment.id;
  UPDATE public.venue_till_sales
  SET paid_minor = paid_minor + v_move, overpaid_minor = overpaid_minor - v_move,
      version = version + 1, updated_at = now()
  WHERE id = v_sale.id RETURNING * INTO v_sale;
  IF v_sale.paid_minor >= v_sale.total_due_minor THEN
    PERFORM public.issue_4490_till_finalize_paid(v_sale.id, v_payment.id, p_actor);
  END IF;
  RETURN jsonb_build_object('paymentId', v_payment.id, 'keptMinor', v_move,
    'sale', public.issue_4490_till_sale_projection(v_sale.id));
END;
$$;

-- ---------------------------------------------------------------------------
-- 7. pg_venue_order_finalize_payment: one new branch (re-emitted from its only
--    body, 20270312001790; signature and grants unchanged).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pg_venue_order_finalize_payment(
  p_order_id uuid, p_provider text, p_paid_amount_cents integer, p_currency text,
  p_payment_intent_id text DEFAULT NULL::text, p_charge_id text DEFAULT NULL::text,
  p_provider_fee_cents integer DEFAULT NULL::integer, p_provider_balance_transaction_id text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_order public.venue_orders%ROWTYPE;
  v_session public.venue_order_sessions%ROWTYPE;
  v_is_settlement boolean;
  v_till jsonb;
  v_channel text;
BEGIN
  IF current_user NOT IN ('postgres','service_role') THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  IF p_provider NOT IN ('stripe','paystack') THEN
    RAISE EXCEPTION 'invalid_provider' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_order FROM public.venue_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('matched', false, 'status', 'not_found');
  END IF;

  -- N147 (#4490): the provider evidence must belong to THIS order. A Paystack
  -- reference is the order's own paystack_reference; a Stripe payment intent,
  -- once recorded, must match. Refused before any write (no caller sends a
  -- foreign reference today: webhook and return both look the order up by it).
  IF p_provider = 'paystack'
     AND (p_payment_intent_id IS NULL OR v_order.paystack_reference IS DISTINCT FROM p_payment_intent_id) THEN
    RETURN jsonb_build_object('matched', false, 'status', 'reference_mismatch');
  END IF;
  IF p_provider = 'stripe' AND p_payment_intent_id IS NOT NULL
     AND v_order.stripe_payment_intent_id IS NOT NULL
     AND v_order.stripe_payment_intent_id <> p_payment_intent_id THEN
    RETURN jsonb_build_object('matched', false, 'status', 'reference_mismatch');
  END IF;

  -- A venue-collected order has no provider and never reaches this path.
  IF v_order.money_path <> 'mingla' THEN
    RETURN jsonb_build_object('matched', false, 'status', 'not_a_mingla_order');
  END IF;

  IF v_order.payment_status = 'paid' THEN
    RETURN jsonb_build_object(
      'matched', true, 'status', 'replayed', 'orderId', v_order.id,
      'brandId', v_order.brand_id);
  END IF;

  IF p_paid_amount_cents IS DISTINCT FROM v_order.total_cents
     OR upper(coalesce(p_currency,'')) <> v_order.currency THEN
    UPDATE public.venue_orders
       SET payment_status = 'failed', failed_at = now()
     WHERE id = p_order_id;
    RETURN jsonb_build_object(
      'matched', true, 'status', 'amount_or_currency_mismatch',
      'orderId', v_order.id, 'brandId', v_order.brand_id);
  END IF;

  UPDATE public.venue_orders
     SET payment_status = 'paid',
         confirmed_at = coalesce(confirmed_at, now()),
         provider = p_provider,
         stripe_payment_intent_id = coalesce(stripe_payment_intent_id, p_payment_intent_id),
         stripe_charge_id = coalesce(stripe_charge_id, p_charge_id)
   WHERE id = p_order_id;

  -- The snapshot the sweep INNER JOINs — written ONLY when the provider told us
  -- the REAL fee (Paystack returns `fees` on verify). A NULL fee writes NOTHING:
  -- per-charge provider fees are immutable ledger inputs and a zero placeholder
  -- would over-release the venue by exactly the processing cost. The order then
  -- WAITS, and `list_missing_payout_source_fees` (extended below) hands it to
  -- the shipped payout-release-sweep fee-capture loop, which resolves the true
  -- balance-transaction fee from the provider. Money is never released on a
  -- guess (P-49.3).
  IF p_provider_fee_cents IS NOT NULL THEN
    INSERT INTO public.payout_source_fee_snapshots (
      source_type, source_id, provider_fee_cents, provider_balance_transaction_id
    ) VALUES (
      'venue_menu_order', p_order_id, greatest(0, p_provider_fee_cents),
      p_provider_balance_transaction_id
    )
    ON CONFLICT (source_type, source_id) DO NOTHING;
  END IF;

  -- #4490 spec 08 O2: a Till carrier pays its Till payment. The channel is the
  -- provider's (Stripe is always a card; Paystack's verified `channel` was put
  -- on the carrier by the webhook or the return check). Late money (the
  -- payment was cancelled or its code expired) is recorded, never refused:
  -- issue_4490_till_apply_payment marks it paid_late into overpaid_minor.
  IF v_order.till_payment_id IS NOT NULL THEN
    v_channel := CASE WHEN p_provider = 'stripe' THEN 'card'
                      ELSE NULLIF(v_order.metadata->>'provider_channel', '') END;
    IF v_channel IS NOT NULL AND v_channel NOT IN ('card', 'bank_transfer', 'ussd', 'bank') THEN
      v_channel := NULL;
    END IF;
    UPDATE public.venue_till_payments
       SET provider_channel = COALESCE(provider_channel, v_channel), updated_at = now()
     WHERE id = v_order.till_payment_id;
    UPDATE public.venue_till_pay_codes
       SET status = 'paid', closed_at = COALESCE(closed_at, now()), updated_at = now()
     WHERE payment_id = v_order.till_payment_id AND status IN ('open', 'opened');
    v_till := public.issue_4490_till_apply_payment(v_order.till_payment_id);
    RETURN jsonb_build_object(
      'matched', true, 'status', 'finalized', 'orderId', v_order.id,
      'brandId', v_order.brand_id, 'tabClosed', false,
      'tillPaymentId', v_order.till_payment_id,
      'tillPaidLate', COALESCE((v_till->>'paidLate')::boolean, false));
  END IF;

  -- P-2a — a paid TAB SETTLEMENT order closes its tab and settles its children.
  -- `closed_by_user_id` is the settlement order's taken_by_user_id: the staff
  -- member who actually closed the tab. The webhook has no user of its own, and
  -- inventing one would make the close-shape CHECK a lie.
  v_is_settlement := coalesce(v_order.metadata->>'tab_settlement','') = 'true';
  IF v_is_settlement AND v_order.taken_by_user_id IS NOT NULL THEN
    SELECT * INTO v_session FROM public.venue_order_sessions
     WHERE id = v_order.session_id FOR UPDATE;
    IF FOUND AND v_session.tab_state = 'settling' THEN
      UPDATE public.venue_orders
         SET payment_status = 'paid',
             confirmed_at = coalesce(confirmed_at, now()),
             metadata = metadata || jsonb_build_object(
               'settled_by_venue_order_id', p_order_id::text)
       WHERE session_id = v_session.id
         AND money_path = 'venue_collected'
         AND payment_status = 'pending';
      UPDATE public.venue_order_sessions
         SET tab_state = 'closed', closed_at = now(),
             closed_by_user_id = v_order.taken_by_user_id
       WHERE id = v_session.id;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'matched', true, 'status', 'finalized', 'orderId', v_order.id,
    'brandId', v_order.brand_id, 'tabClosed', v_is_settlement);
END;
$function$;
REVOKE ALL ON FUNCTION public.pg_venue_order_finalize_payment(uuid, text, integer, text, text, text, integer, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pg_venue_order_finalize_payment(uuid, text, integer, text, text, text, integer, text)
  TO service_role;

-- ---------------------------------------------------------------------------
-- 8. The check's projection shows how each card payment ended.
-- ---------------------------------------------------------------------------
SELECT pg_temp.issue_4490_o2_patch(
  'public.issue_4490_till_sale_projection(uuid)'::regprocedure,
  $old$'receiptSends', p.receipt_sends)$old$,
  $new$'receiptSends', p.receipt_sends,
          'chargedMinor', p.charged_minor, 'providerChannel', p.provider_channel,
          'cardBrand', p.card_brand, 'cardLast4', p.card_last4, 'lateKept', p.late_kept_at IS NOT NULL,
          'payCode', (SELECT jsonb_build_object('code', c.code, 'status', c.status, 'expiresAt', c.expires_at,
                        'payStarted', c.pay_started_at IS NOT NULL, 'textLinksLeft', 3 - c.text_link_count)
                      FROM public.venue_till_pay_codes c WHERE c.payment_id = p.id))$new$
);

-- ---------------------------------------------------------------------------
-- 9. The day's money: card and scan money taken in the Till for an offer is
--    Mingla-rail money, counted once, as online, on the service day.
-- ---------------------------------------------------------------------------
SELECT pg_temp.issue_4490_o2_patch(
  'public.issue_4490_venue_money_day(uuid,date)'::regprocedure,
  $old$  v_other boolean;
$old$,
  $new$  v_other boolean;
  v_card bigint;
$new$
);
SELECT pg_temp.issue_4490_o2_patch(
  'public.issue_4490_venue_money_day(uuid,date)'::regprocedure,
  $old$  -- #4490 08-O1 fix 2 (spec 08 §13): a gate sale paid in cash or by transfer
  -- was paid in full at the gate and writes no offline payment row; it counts$old$,
  $new$  -- #4490 spec 08 O2: an offer paid in the Till by tap or scan is Mingla
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
  -- was paid in full at the gate and writes no offline payment row; it counts$new$
);
SELECT pg_temp.issue_4490_o2_patch(
  'public.issue_4490_venue_money_day(uuid,date)'::regprocedure,
  $old$  WITH day_tables AS ($old$,
  $new$  WITH day_groups AS (
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

  WITH day_tables AS ($new$
);

-- ---------------------------------------------------------------------------
-- 10. Privileges: every new function is internal (service role only).
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION
  public.issue_4490_till_expire_codes(uuid),
  public.issue_4490_till_card_close(uuid),
  public.issue_4490_till_card_prepare(uuid, uuid, integer),
  public.issue_4490_till_card_start(uuid, text, bigint, uuid, uuid, uuid, integer, jsonb, text),
  public.issue_4490_till_card_cancel(uuid, uuid),
  public.issue_4490_till_tap_record(text, text, bigint, text, text),
  public.issue_4490_till_pay_code_view(text),
  public.issue_4490_till_pay_code_buyer(text, text, text, text),
  public.issue_4490_till_pay_code_status(text, uuid, uuid),
  public.issue_4490_till_pay_code_text(text, uuid, uuid, text, text),
  public.issue_4490_till_keep_late_payment(uuid, uuid, integer)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
  public.issue_4490_till_expire_codes(uuid),
  public.issue_4490_till_card_close(uuid),
  public.issue_4490_till_card_prepare(uuid, uuid, integer),
  public.issue_4490_till_card_start(uuid, text, bigint, uuid, uuid, uuid, integer, jsonb, text),
  public.issue_4490_till_card_cancel(uuid, uuid),
  public.issue_4490_till_tap_record(text, text, bigint, text, text),
  public.issue_4490_till_pay_code_view(text),
  public.issue_4490_till_pay_code_buyer(text, text, text, text),
  public.issue_4490_till_pay_code_status(text, uuid, uuid),
  public.issue_4490_till_pay_code_text(text, uuid, uuid, text, text),
  public.issue_4490_till_keep_late_payment(uuid, uuid, integer)
TO service_role;

COMMIT;
