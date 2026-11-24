-- Issue #4490, spec 08 O2 fix round 1 (the independent money test's O2-T1, T2,
-- T3 and T4; O2-T5 is edge-only).
--
-- 1. O2-T4: a card payment nobody is watching lets go of the check. Before
--    cash, own machine, adding to the check, or starting a new card payment,
--    issue_4490_till_release_stale closes every code past its expires_at (its
--    payment is cancelled; money that still lands is late money, recorded once
--    by the finalizer) and cancels a pending tap payment that never got a
--    PaymentIntent once it is older than the tap window (15 minutes, the
--    door-tap-intent unfinished window). A live, unexpired code and a tap with
--    a PaymentIntent are never touched.
-- 2. O2-T1: with VENUE_TILL off (or the venue's till feature off) staff can no
--    longer read or text a pay code (till_not_enabled), but a payment that is
--    already live can still be cancelled: issue_4490_till_card_cancel checks
--    the seller, not the switch, and venue-till pay_code_cancel reads the code
--    through issue_4490_till_pay_code_lookup (the status read without the
--    switch). Money in flight still lands (webhooks, confirm_return, tap record
--    and apply never read the switch, T19).
-- 3. O2-T3: pay-link texts have rolling-hour windows on top of three per code:
--    at most 6 to one number per venue and 30 per seller
--    (issue_4490_till_text_limits, the one place to change them). Each text is
--    recorded in venue_till_pay_link_texts (service role only).
-- 4. O2-T2: one global budget of unknown pay-code answers per minute
--    (issue_4490_till_code_guess_budget) that does not depend on any header.
--
-- Function bodies: the four patched ones are checked patches of their live
-- (latest) definitions; the re-emitted pay-code status and text bodies come
-- from 20281203564490, their only definition.
-- Static SQL. Local stack only until Seth approves a production migration.

BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE FUNCTION pg_temp.issue_4490_o2f1_patch(
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
    RAISE EXCEPTION 'issue_4490 O2 fix 1 patch precondition failed for %: old % (expected %)',
      p_sig, v_old_count, p_count;
  END IF;
  EXECUTE replace(v_def, p_old, p_new);
END;
$patch$;

-- ---------------------------------------------------------------------------
-- 1. O2-T4: release what nobody is watching.
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.issue_4490_till_release_stale(p_sale_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  -- The tap window: door-tap-intent's TILL_UNFINISHED_AFTER_MS (15 minutes).
  c_tap_window constant interval := interval '15 minutes';
  v_count integer;
  v_row record;
BEGIN
  IF NOT public.issue_1389_service_role() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  -- Codes past their time (their payment is cancelled; late money is kept).
  v_count := public.issue_4490_till_expire_codes(p_sale_id);
  -- A tap whose card reader never started: no PaymentIntent on its intent row
  -- or its carrier, older than the tap window. No money can have moved.
  FOR v_row IN
    SELECT p.id FROM public.venue_till_payments p
    WHERE p.sale_id = p_sale_id AND p.method = 'tap' AND p.state = 'pending'
      AND p.created_at <= now() - c_tap_window
      AND NOT EXISTS (SELECT 1 FROM public.door_tap_intents i
                      WHERE i.till_payment_id = p.id AND i.stripe_payment_intent_id IS NOT NULL)
      AND NOT EXISTS (SELECT 1 FROM public.venue_orders o
                      WHERE o.id = p.carrier_order_id AND o.stripe_payment_intent_id IS NOT NULL)
    ORDER BY p.id
    FOR UPDATE OF p
  LOOP
    IF public.issue_4490_till_card_close(v_row.id) THEN
      UPDATE public.door_tap_intents
      SET status = 'cancelled', updated_at = now()
      WHERE till_payment_id = v_row.id AND status = 'created' AND stripe_payment_intent_id IS NULL;
      v_count := v_count + 1;
    END IF;
  END LOOP;
  RETURN v_count;
END;
$$;

-- Cash and own machine.
SELECT pg_temp.issue_4490_o2f1_patch(
  'public.issue_4490_till_take_payment(uuid,text,bigint,bigint,bigint,uuid,uuid,uuid,integer)'::regprocedure,
  $old$  v_sale := public.issue_4490_till_lock(p_sale_id, p_actor, p_expected_version);
$old$,
  $new$  v_sale := public.issue_4490_till_lock(p_sale_id, p_actor, p_expected_version);
  -- #4490 O2 fix 1 (O2-T4): a code past its time or a tap that never reached
  -- the reader no longer holds the check.
  IF public.issue_4490_till_release_stale(v_sale.id) > 0 THEN
    SELECT * INTO v_sale FROM public.venue_till_sales WHERE id = v_sale.id FOR UPDATE;
  END IF;
$new$
);

-- Adding to the check (menu round, offer line, balance line).
SELECT pg_temp.issue_4490_o2f1_patch(
  'public.issue_4490_till_attach_round(uuid,uuid,uuid,integer)'::regprocedure,
  $old$  v_sale := public.issue_4490_till_lock(p_sale_id, p_actor, p_expected_version);
$old$,
  $new$  v_sale := public.issue_4490_till_lock(p_sale_id, p_actor, p_expected_version);
  -- #4490 O2 fix 1 (O2-T4)
  IF public.issue_4490_till_release_stale(v_sale.id) > 0 THEN
    SELECT * INTO v_sale FROM public.venue_till_sales WHERE id = v_sale.id FOR UPDATE;
  END IF;
$new$
);
SELECT pg_temp.issue_4490_o2f1_patch(
  'public.issue_4490_till_add_offer_line(uuid,uuid,uuid,jsonb,uuid,text,uuid,integer)'::regprocedure,
  $old$  v_sale := public.issue_4490_till_lock(p_sale_id, p_actor, p_expected_version);
$old$,
  $new$  v_sale := public.issue_4490_till_lock(p_sale_id, p_actor, p_expected_version);
  -- #4490 O2 fix 1 (O2-T4)
  IF public.issue_4490_till_release_stale(v_sale.id) > 0 THEN
    SELECT * INTO v_sale FROM public.venue_till_sales WHERE id = v_sale.id FOR UPDATE;
  END IF;
$new$
);
SELECT pg_temp.issue_4490_o2f1_patch(
  'public.issue_4490_till_add_balance_line(uuid,uuid,bigint,uuid,text,integer)'::regprocedure,
  $old$  v_sale := public.issue_4490_till_lock(p_sale_id, p_actor, p_expected_version);
$old$,
  $new$  v_sale := public.issue_4490_till_lock(p_sale_id, p_actor, p_expected_version);
  -- #4490 O2 fix 1 (O2-T4)
  IF public.issue_4490_till_release_stale(v_sale.id) > 0 THEN
    SELECT * INTO v_sale FROM public.venue_till_sales WHERE id = v_sale.id FOR UPDATE;
  END IF;
$new$
);

-- A new card payment (tap or scan) also lets go of a stale tap, not only of
-- expired codes.
SELECT pg_temp.issue_4490_o2f1_patch(
  'public.issue_4490_till_card_prepare(uuid,uuid,integer)'::regprocedure,
  $old$  PERFORM public.issue_4490_till_expire_codes(v_sale.id);
$old$,
  $new$  -- #4490 O2 fix 1 (O2-T4): expired codes and taps that never reached the reader.
  PERFORM public.issue_4490_till_release_stale(v_sale.id);
$new$
);

-- ---------------------------------------------------------------------------
-- 2. O2-T1: cancel never needs the switch; staff code reads and texts do.
-- ---------------------------------------------------------------------------
SELECT pg_temp.issue_4490_o2f1_patch(
  'public.issue_4490_till_card_cancel(uuid,uuid)'::regprocedure,
  $old$  PERFORM public.issue_4490_till_lock(v_payment.sale_id, p_actor, NULL);
$old$,
  $new$  -- #4490 O2 fix 1 (O2-T1): a payment that is live when the Till is switched
  -- off can still be cancelled by anyone who may sell there (no switch check;
  -- issue_4490_till_lock would refuse with till_not_enabled).
  IF NOT public.issue_1389_service_role() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  PERFORM 1 FROM public.venue_till_sales s WHERE s.id = v_payment.sale_id FOR UPDATE;
  IF NOT public.issue_4490_can_sell(
       (SELECT s.venue_id FROM public.venue_till_sales s WHERE s.id = v_payment.sale_id), p_actor) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
$new$
);

-- The status read without the switch (venue-till pay_code_cancel uses it, so a
-- live code can be cancelled after the Till is switched off). Body = the
-- 20281203564490 issue_4490_till_pay_code_status body.
CREATE FUNCTION public.issue_4490_till_pay_code_lookup(p_code text, p_venue_id uuid, p_actor uuid)
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

-- Staff read a code's state (the sheet polls it): only while the Till is on.
CREATE OR REPLACE FUNCTION public.issue_4490_till_pay_code_status(p_code text, p_venue_id uuid, p_actor uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT public.issue_1389_service_role() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  -- #4490 O2 fix 1 (O2-T1): the release switch closes this for every role.
  IF NOT public.issue_4490_till_enabled(p_venue_id) THEN
    RAISE EXCEPTION 'till_not_enabled' USING ERRCODE = 'P0001';
  END IF;
  RETURN public.issue_4490_till_pay_code_lookup(p_code, p_venue_id, p_actor);
END;
$$;

-- ---------------------------------------------------------------------------
-- 3. O2-T3: pay-link text windows.
-- ---------------------------------------------------------------------------
-- The one place to change them (deviation for Seth's approval: 6 to one
-- number per venue and 30 per seller, each per rolling hour).
CREATE FUNCTION public.issue_4490_till_text_limits()
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT jsonb_build_object('perNumberPerVenueHour', 6, 'perSellerHour', 30)
$$;

CREATE TABLE public.venue_till_pay_link_texts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id uuid NOT NULL REFERENCES public.venue_listings(id) ON DELETE CASCADE,
  pay_code_id uuid NOT NULL REFERENCES public.venue_till_pay_codes(id) ON DELETE CASCADE,
  phone_e164 text NOT NULL CHECK (phone_e164 ~ '^\+[1-9][0-9]{6,14}$'),
  sent_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX venue_till_pay_link_texts_number_idx
  ON public.venue_till_pay_link_texts (venue_id, phone_e164, created_at);
CREATE INDEX venue_till_pay_link_texts_seller_idx
  ON public.venue_till_pay_link_texts (sent_by, created_at);
CREATE INDEX venue_till_pay_link_texts_code_idx
  ON public.venue_till_pay_link_texts (pay_code_id);
ALTER TABLE public.venue_till_pay_link_texts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.venue_till_pay_link_texts FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.venue_till_pay_link_texts TO service_role;
COMMENT ON TABLE public.venue_till_pay_link_texts IS
  '#4490 spec 08 O2 fix 1: one row per Till pay-link text, for the rolling-hour windows in issue_4490_till_text_limits. Service role only.';

-- "Text them the link": at most three texts per code (the door's rule and
-- its message), within the rolling-hour windows, only while the Till is on.
-- Body = the 20281203564490 body plus the switch check and the windows.
CREATE OR REPLACE FUNCTION public.issue_4490_till_pay_code_text(
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
  v_limits jsonb := public.issue_4490_till_text_limits();
BEGIN
  IF NOT public.issue_1389_service_role() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  -- #4490 O2 fix 1 (O2-T1): the release switch closes this for every role.
  IF NOT public.issue_4490_till_enabled(p_venue_id) THEN
    RAISE EXCEPTION 'till_not_enabled' USING ERRCODE = 'P0001';
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
  -- #4490 O2 fix 1 (O2-T3): rolling-hour windows per number at this venue and
  -- per seller, counted under one lock each so two taps cannot both pass.
  PERFORM pg_advisory_xact_lock(hashtextextended('issue_4490_till_text_seller:' || p_actor::text, 0));
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'issue_4490_till_text_number:' || v_sale.venue_id::text || ':' || p_phone_e164, 0));
  IF (SELECT count(*) FROM public.venue_till_pay_link_texts t
      WHERE t.venue_id = v_sale.venue_id AND t.phone_e164 = p_phone_e164
        AND t.created_at > now() - interval '1 hour') >= (v_limits->>'perNumberPerVenueHour')::integer
     OR (SELECT count(*) FROM public.venue_till_pay_link_texts t
         WHERE t.sent_by = p_actor AND t.created_at > now() - interval '1 hour')
        >= (v_limits->>'perSellerHour')::integer THEN
    RAISE EXCEPTION 'pay_code_text_window' USING ERRCODE = 'PT409';
  END IF;
  INSERT INTO public.venue_till_pay_link_texts (venue_id, pay_code_id, phone_e164, sent_by)
  VALUES (v_sale.venue_id, v_code.id, p_phone_e164, p_actor);
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

-- ---------------------------------------------------------------------------
-- 4. O2-T2: one global budget of unknown pay-code answers per minute.
-- ---------------------------------------------------------------------------
-- p_record = false: is this minute's budget spent? (no write)
-- p_record = true: count one unknown-code answer, then the same question.
-- The budget size lives in venue-till (TILL_UNKNOWN_CODE_LIMIT) with the
-- other code limits. No header, address or code is part of the key.
CREATE FUNCTION public.issue_4490_till_code_guess_budget(p_record boolean, p_limit integer)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  c_key constant text := 'issue_4490_till_unknown_code:global';
  v_hits integer;
BEGIN
  IF NOT public.issue_1389_service_role() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_limit IS NULL OR p_limit < 1 THEN
    RAISE EXCEPTION 'till_invalid_payload' USING ERRCODE = '22023';
  END IF;
  IF COALESCE(p_record, false) THEN
    v_hits := (public.pg_venue_order_rate_limit_hit(c_key, p_limit)->>'hits')::integer;
  ELSE
    SELECT r.hits INTO v_hits FROM public.venue_order_rate_limits r
    WHERE r.scope_key = c_key AND r.window_start = date_trunc('minute', now());
  END IF;
  RETURN COALESCE(v_hits, 0) >= p_limit;
END;
$$;

-- ---------------------------------------------------------------------------
-- 5. Privileges: every new function is internal (service role only). The
--    re-emitted and patched ones keep theirs (CREATE OR REPLACE keeps grants);
--    re-stated for the two re-emitted here.
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION
  public.issue_4490_till_release_stale(uuid),
  public.issue_4490_till_pay_code_lookup(text, uuid, uuid),
  public.issue_4490_till_pay_code_status(text, uuid, uuid),
  public.issue_4490_till_text_limits(),
  public.issue_4490_till_pay_code_text(text, uuid, uuid, text, text),
  public.issue_4490_till_code_guess_budget(boolean, integer)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
  public.issue_4490_till_release_stale(uuid),
  public.issue_4490_till_pay_code_lookup(text, uuid, uuid),
  public.issue_4490_till_pay_code_status(text, uuid, uuid),
  public.issue_4490_till_text_limits(),
  public.issue_4490_till_pay_code_text(text, uuid, uuid, text, text),
  public.issue_4490_till_code_guess_budget(boolean, integer)
TO service_role;

COMMIT;
