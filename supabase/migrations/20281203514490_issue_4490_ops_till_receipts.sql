-- Issue #4490, spec 08 O1 (running the floor): Till receipts (slot 47).
--
-- 1. Every paid Till payment gets a receipt: a per-venue number and a snapshot
--    taken when the money lands (lines, service charge, included tax, tender,
--    change, venue and brand details, footer). Later menu, price, name or
--    footer edits never change a receipt; refunds are read live from the
--    append-only venue_till_refunds rows and shown on top of it.
-- 2. "Send receipt" (text and/or email, at most three sends per payment, spec
--    08 §3 O1 Receipts): one outbox row per channel, category
--    buyer_till_receipt. The private receipt link is built by the drain at
--    SEND time from a token derived from the payment id (05 ruling: guest
--    links are generated when the message is sent); only sha256(token) is
--    stored (venue_till_payments.receipt_token_hash). No contact or token in
--    any URL query; the token rides in the URL fragment (#t=).
-- 3. The receipt page (buyer web /receipt/till/<paymentId>#t=<token>,
--    anonymous) reads one payment's receipt only with its token (T20).
-- 4. Claim kind venue_till_sale resolves (spec 06 W1 addendum), so "Open in
--    Mingla" can lead a receipt once VENUE_APP_HANDOFF is on (T20: hidden
--    until then; the drain mints nothing while that switch is off).
--
-- No venue_id column is added anywhere here (#2099 dependency seal unchanged;
-- the receipt counter is a column on venue_till_settings).
-- Static SQL. Local stack only until Seth approves a production migration.

BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE FUNCTION pg_temp.issue_4490_o1r_patch(
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
    RAISE EXCEPTION 'issue_4490 O1 receipts patch precondition failed for %: old % (expected %)',
      p_sig, v_old_count, p_count;
  END IF;
  EXECUTE replace(v_def, p_old, p_new);
END;
$patch$;

-- ---------------------------------------------------------------------------
-- 1. The message category (Purchases, transactional, text + email).
-- ---------------------------------------------------------------------------
INSERT INTO public.notification_categories
  (key, section, is_transactional, urgency, default_channels, reach_mode, active)
VALUES (
  'buyer_till_receipt', 'Purchases', true, 'high',
  ARRAY['sms', 'email'], 'reach_once', true
)
ON CONFLICT (key) DO UPDATE SET
  section = EXCLUDED.section,
  is_transactional = EXCLUDED.is_transactional,
  urgency = EXCLUDED.urgency,
  default_channels = EXCLUDED.default_channels,
  reach_mode = EXCLUDED.reach_mode,
  active = true;

-- ---------------------------------------------------------------------------
-- 2. Receipt numbers and snapshots.
-- ---------------------------------------------------------------------------
ALTER TABLE public.venue_till_settings
  ADD COLUMN last_receipt_no bigint NOT NULL DEFAULT 0 CHECK (last_receipt_no >= 0);

CREATE TABLE public.venue_till_receipts (
  payment_id uuid PRIMARY KEY REFERENCES public.venue_till_payments(id) ON DELETE RESTRICT,
  receipt_no bigint NOT NULL CHECK (receipt_no > 0),
  snapshot jsonb NOT NULL CHECK (jsonb_typeof(snapshot) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.venue_till_receipts IS
  '#4490 spec 08 O1: one receipt per paid Till payment, numbered per venue (venue_till_settings.last_receipt_no). The snapshot is written once, when the payment is paid, and never updated.';

-- Immutable once written (I-4490-TILL-RECEIPT-SNAPSHOT-IMMUTABLE).
CREATE OR REPLACE FUNCTION public.issue_4490_till_receipt_immutable()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  RAISE EXCEPTION 'till_receipt_immutable' USING ERRCODE = '42501';
END;
$function$;
CREATE TRIGGER issue_4490_till_receipt_immutable
  BEFORE UPDATE OR DELETE ON public.venue_till_receipts
  FOR EACH ROW EXECUTE FUNCTION public.issue_4490_till_receipt_immutable();

-- The snapshot of one payment's receipt (lines, totals, tender, venue).
CREATE OR REPLACE FUNCTION public.issue_4490_till_receipt_build(p_payment_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT jsonb_build_object(
    'paymentId', p.id,
    'saleId', s.id,
    'venueName', v.name,
    'venueAddress', NULLIF(concat_ws(', ', NULLIF(btrim(COALESCE(v.address, '')), ''),
                                         NULLIF(btrim(COALESCE(v.city, '')), '')), ''),
    'brandName', b.name,
    'timezone', public.issue_4490_venue_timezone(s.venue_id),
    'currency', s.currency,
    'checkLabel', COALESCE(s.check_label, (SELECT q.label FROM public.qr_spots q WHERE q.id = s.qr_spot_id)),
    'paidAt', p.paid_at,
    'businessDate', p.business_date,
    'lines', COALESCE((
      SELECT jsonb_agg(x.line ORDER BY x.at, x.ord)
      FROM (
        SELECT l.created_at AS at, i.line_no AS ord,
          jsonb_build_object(
            'label', i.item_name_at_order, 'quantity', i.quantity,
            'amountMinor', i.line_total_cents,
            'modifiers', COALESCE((SELECT jsonb_agg(m.modifier_name_at_order ORDER BY m.modifier_name_at_order)
                                   FROM public.venue_order_item_modifiers m WHERE m.venue_order_item_id = i.id),
                                  '[]'::jsonb)) AS line
        FROM public.venue_till_lines l
        JOIN public.venue_orders o ON o.id = l.venue_order_id
        JOIN public.venue_order_items i ON i.venue_order_id = o.id
        WHERE l.sale_id = s.id AND l.kind = 'menu_round' AND l.state IN ('held', 'committed')
          AND i.prep_state <> 'voided'
        UNION ALL
        SELECT l.created_at, 0,
          jsonb_build_object('label', COALESCE(l.label_snapshot, 'Item'), 'quantity', 1,
                             'amountMinor', l.amount_minor, 'modifiers', '[]'::jsonb)
        FROM public.venue_till_lines l
        WHERE l.sale_id = s.id AND l.kind <> 'menu_round' AND l.state IN ('held', 'committed')
      ) x), '[]'::jsonb),
    'subtotalMinor', s.subtotal_minor,
    'serviceChargeMinor', s.service_charge_minor,
    -- Offer prices include their tax (the quote's tax_total); menu rounds carry none.
    'taxIncludedMinor', COALESCE((
      SELECT sum(g.tax_total_minor) FROM public.venue_till_lines l
      JOIN public.stay_reservation_groups g ON g.id = l.stay_group_id
      WHERE l.sale_id = s.id AND l.kind IN ('entry', 'group_package') AND l.state IN ('held', 'committed')), 0),
    'totalMinor', s.total_due_minor,
    'paidBeforeMinor', COALESCE((
      SELECT sum(o2.amount_minor) FROM public.venue_till_payments o2
      WHERE o2.sale_id = s.id AND o2.id <> p.id AND NOT o2.paid_late
        AND o2.state IN ('paid', 'refunded', 'partially_refunded')
        AND (o2.paid_at < p.paid_at OR (o2.paid_at = p.paid_at AND o2.id < p.id))), 0),
    'payment', jsonb_build_object(
      'method', p.method, 'amountMinor', p.amount_minor, 'serviceChargeMinor', p.service_charge_minor,
      'tipMinor', p.tip_minor, 'cashGivenMinor', p.cash_given_minor,
      'changeMinor', CASE WHEN p.cash_given_minor IS NOT NULL
        THEN p.cash_given_minor - p.amount_minor - p.tip_minor END,
      'paidLate', p.paid_late,
      'reference', upper(right(replace(p.id::text, '-', ''), 8))),
    'footer', (SELECT t.receipt_footer FROM public.venue_till_settings t WHERE t.venue_id = s.venue_id)
  )
  FROM public.venue_till_payments p
  JOIN public.venue_till_sales s ON s.id = p.sale_id
  JOIN public.venue_listings v ON v.id = s.venue_id
  LEFT JOIN public.brands b ON b.id = s.brand_id
  WHERE p.id = p_payment_id;
$function$;

-- Write the receipt (number + snapshot) once. Idempotent.
CREATE OR REPLACE FUNCTION public.issue_4490_till_receipt_capture(p_payment_id uuid)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_existing bigint;
  v_venue uuid;
  v_brand uuid;
  v_no bigint;
  v_snapshot jsonb;
BEGIN
  SELECT r.receipt_no INTO v_existing FROM public.venue_till_receipts r WHERE r.payment_id = p_payment_id;
  IF FOUND THEN
    RETURN v_existing;
  END IF;
  SELECT s.venue_id, s.brand_id INTO v_venue, v_brand
  FROM public.venue_till_payments p JOIN public.venue_till_sales s ON s.id = p.sale_id
  WHERE p.id = p_payment_id AND p.state IN ('paid', 'refunded', 'partially_refunded');
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  v_snapshot := public.issue_4490_till_receipt_build(p_payment_id);
  -- The per-venue counter (row lock on the venue's settings row).
  INSERT INTO public.venue_till_settings AS t (venue_id, brand_id, last_receipt_no)
  VALUES (v_venue, v_brand, 1)
  ON CONFLICT (venue_id) DO UPDATE SET last_receipt_no = t.last_receipt_no + 1
  RETURNING t.last_receipt_no INTO v_no;
  INSERT INTO public.venue_till_receipts (payment_id, receipt_no, snapshot)
  VALUES (p_payment_id, v_no, v_snapshot || jsonb_build_object('receiptNo', v_no));
  RETURN v_no;
END;
$function$;

-- When a payment is paid, its receipt is written. A receipt can never block
-- money: any failure here is logged and the payment stands (the send path
-- captures it again).
CREATE OR REPLACE FUNCTION public.issue_4490_till_receipt_on_paid()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  BEGIN
    PERFORM public.issue_4490_till_receipt_capture(NEW.id);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'issue_4490_till_receipt_capture_failed %', SQLSTATE;
  END;
  RETURN NULL;
END;
$function$;
CREATE TRIGGER issue_4490_till_receipt_on_paid
  AFTER INSERT OR UPDATE OF state ON public.venue_till_payments
  FOR EACH ROW WHEN (NEW.state = 'paid')
  EXECUTE FUNCTION public.issue_4490_till_receipt_on_paid();

-- Receipts for payments taken before this migration.
SELECT public.issue_4490_till_receipt_capture(p.id)
FROM public.venue_till_payments p
WHERE p.state IN ('paid', 'refunded', 'partially_refunded')
ORDER BY p.paid_at, p.id;

-- What a receipt shows now: the snapshot plus refunds made since (read live
-- from the append-only refund rows).
CREATE OR REPLACE FUNCTION public.issue_4490_till_receipt_projection(p_payment_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT r.snapshot || jsonb_build_object(
    'receiptNo', r.receipt_no,
    'paymentState', p.state,
    'refundedMinor', COALESCE((SELECT sum(f.amount_minor + f.tip_minor) FROM public.venue_till_refunds f
                               WHERE f.payment_id = p.id), 0),
    'refunds', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                           'amountMinor', f.amount_minor + f.tip_minor, 'at', f.created_at)
                           ORDER BY f.created_at, f.id)
                         FROM public.venue_till_refunds f WHERE f.payment_id = p.id), '[]'::jsonb))
  FROM public.venue_till_receipts r
  JOIN public.venue_till_payments p ON p.id = r.payment_id
  WHERE r.payment_id = p_payment_id;
$function$;

-- ---------------------------------------------------------------------------
-- 3. Send a receipt (staff who may sell at the venue; at most three sends per
--    payment). One outbox row per channel; the drain builds the link.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.issue_4490_till_receipt_send(
  p_payment_id uuid,
  p_venue_id uuid,
  p_actor uuid,
  p_phone_e164 text,
  p_email text,
  p_token_hash bytea
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_payment public.venue_till_payments%ROWTYPE;
  v_sale public.venue_till_sales%ROWTYPE;
  v_venue_name text;
  v_phone text := NULLIF(btrim(COALESCE(p_phone_e164, '')), '');
  v_email text := lower(NULLIF(btrim(COALESCE(p_email, '')), ''));
  v_n smallint;
  v_payload jsonb;
BEGIN
  IF NOT public.issue_1389_service_role() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF (v_phone IS NULL AND v_email IS NULL)
     OR (v_phone IS NOT NULL AND v_phone !~ '^\+[1-9][0-9]{6,14}$')
     OR (v_email IS NOT NULL AND (char_length(v_email) > 254
         OR v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'))
     OR p_token_hash IS NULL OR octet_length(p_token_hash) <> 32 THEN
    RAISE EXCEPTION 'till_invalid_payload' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_payment FROM public.venue_till_payments WHERE id = p_payment_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'till_payment_not_found' USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO v_sale FROM public.venue_till_sales WHERE id = v_payment.sale_id;
  IF v_sale.venue_id IS DISTINCT FROM p_venue_id THEN
    RAISE EXCEPTION 'till_payment_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public.issue_4490_can_sell(v_sale.venue_id, p_actor) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  IF v_payment.state NOT IN ('paid', 'refunded', 'partially_refunded') THEN
    RAISE EXCEPTION 'till_receipt_not_paid' USING ERRCODE = 'PT409';
  END IF;
  IF v_payment.receipt_sends >= 3 THEN
    RAISE EXCEPTION 'till_receipt_limit' USING ERRCODE = 'PT409';
  END IF;
  PERFORM public.issue_4490_till_receipt_capture(v_payment.id);
  v_n := v_payment.receipt_sends + 1;
  UPDATE public.venue_till_payments
  SET receipt_phone_e164 = COALESCE(v_phone, receipt_phone_e164),
      receipt_email = COALESCE(v_email, receipt_email),
      receipt_token_hash = COALESCE(receipt_token_hash, p_token_hash),
      receipt_sends = v_n,
      updated_at = now()
  WHERE id = v_payment.id;
  SELECT v.name INTO v_venue_name FROM public.venue_listings v WHERE v.id = v_sale.venue_id;
  v_payload := jsonb_build_object(
    'till_payment_id', v_payment.id,
    'till_sale_id', v_sale.id,
    'venue_id', v_sale.venue_id,
    'venue_name', COALESCE(NULLIF(btrim(v_venue_name), ''), 'the venue'));
  IF v_phone IS NOT NULL THEN
    INSERT INTO public.notification_outbox (
      category_key, user_id, contact, brand_id, payload, idempotency_key, country_code, status
    ) VALUES (
      'buyer_till_receipt', NULL, v_phone, v_sale.brand_id,
      v_payload || jsonb_build_object('channel_hint', 'sms'),
      'buyer_till_receipt:' || v_payment.id::text || ':sms:' || v_n::text,
      public.mingla_e164_country(v_phone), 'pending'
    ) ON CONFLICT (idempotency_key) DO NOTHING;
  END IF;
  IF v_email IS NOT NULL THEN
    INSERT INTO public.notification_outbox (
      category_key, user_id, contact, brand_id, payload, idempotency_key, country_code, status
    ) VALUES (
      'buyer_till_receipt', NULL, v_email, v_sale.brand_id,
      v_payload || jsonb_build_object('channel_hint', 'email'),
      'buyer_till_receipt:' || v_payment.id::text || ':email:' || v_n::text,
      NULL, 'pending'
    ) ON CONFLICT (idempotency_key) DO NOTHING;
  END IF;
  RETURN jsonb_build_object(
    'queued', jsonb_build_object('sms', v_phone IS NOT NULL, 'email', v_email IS NOT NULL),
    'sendsLeft', 3 - v_n);
END;
$function$;

-- The anonymous receipt page: one payment's receipt, only with its token.
-- A wrong token and an unknown payment answer the same.
CREATE OR REPLACE FUNCTION public.issue_4490_till_receipt_view(p_payment_id uuid, p_token_hash bytea)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_result jsonb;
BEGIN
  IF NOT public.issue_1389_service_role() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_payment_id IS NULL OR p_token_hash IS NULL OR octet_length(p_token_hash) <> 32 THEN
    RAISE EXCEPTION 'receipt_not_found' USING ERRCODE = 'P0002';
  END IF;
  SELECT public.issue_4490_till_receipt_projection(p.id) INTO v_result
  FROM public.venue_till_payments p
  WHERE p.id = p_payment_id AND p.receipt_token_hash IS NOT NULL
    AND p.receipt_token_hash = p_token_hash;
  IF v_result IS NULL THEN
    RAISE EXCEPTION 'receipt_not_found' USING ERRCODE = 'P0002';
  END IF;
  RETURN v_result;
END;
$function$;

-- The drain reads the stored token hash to re-derive the link at send time.
CREATE OR REPLACE FUNCTION public.issue_4490_till_receipt_link_facts(p_payment_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT jsonb_build_object(
    'tokenHashHex', encode(p.receipt_token_hash, 'hex'),
    'receipt', public.issue_4490_till_receipt_projection(p.id))
  FROM public.venue_till_payments p
  WHERE p.id = p_payment_id;
$function$;

-- ---------------------------------------------------------------------------
-- 4. Claim kind venue_till_sale resolves (spec 06 W1 addendum, noun receipt).
--    The subject is the sale; the guest proves the contact the receipt went to.
-- ---------------------------------------------------------------------------
SELECT pg_temp.issue_4490_o1r_patch(
  'public.issue_4063_claim_subject(text,uuid)'::regprocedure,
  $old$    WHEN 'venue_till_sale' THEN
      v_result := NULL;$old$,
  $new$    WHEN 'venue_till_sale' THEN
      SELECT jsonb_build_object(
        'email', lower(btrim(coalesce(p.receipt_email, ''))),
        'phone', nullif(btrim(coalesce(p.receipt_phone_e164, '')), ''),
        'name', nullif(btrim(coalesce(s.check_label, '')), ''),
        'title', coalesce(v.name, b.name, 'Receipt'),
        'brandName', b.name,
        'startsAt', coalesce(s.paid_at, s.created_at),
        'anchor', coalesce(s.paid_at, s.created_at),
        'timezone', NULL,
        'quantity', 1,
        'noun', 'receipt',
        'orderLabel', 'Receipt ' || upper(right(replace(coalesce(p.id, s.id)::text, '-', ''), 8)),
        'preferredProof', CASE
          WHEN nullif(btrim(coalesce(p.receipt_email, '')), '') IS NOT NULL THEN 'email'
          WHEN nullif(btrim(coalesce(p.receipt_phone_e164, '')), '') IS NOT NULL THEN 'phone'
          ELSE 'any'
        END,
        'claimed', false
      ) INTO v_result
      FROM public.venue_till_sales s
      LEFT JOIN public.venue_listings v ON v.id = s.venue_id
      LEFT JOIN public.brands b ON b.id = s.brand_id
      LEFT JOIN LATERAL (
        SELECT tp.id, tp.receipt_email, tp.receipt_phone_e164
        FROM public.venue_till_payments tp
        WHERE tp.sale_id = s.id AND tp.receipt_sends > 0
        ORDER BY tp.updated_at DESC, tp.id
        LIMIT 1
      ) p ON true
      WHERE s.id = p_subject_id AND s.state IN ('paid', 'partially_refunded', 'refunded');$new$
);

-- ---------------------------------------------------------------------------
-- 5. RLS and grants. Receipts are read through the edge (service role);
--    signed-in readers of the venue may read the snapshot (no contact in it).
-- ---------------------------------------------------------------------------
ALTER TABLE public.venue_till_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.venue_till_receipts FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.venue_till_receipts TO authenticated;
GRANT ALL ON public.venue_till_receipts TO service_role;
CREATE POLICY "venue till receipts venue readers" ON public.venue_till_receipts
  FOR SELECT TO authenticated USING (EXISTS (
    SELECT 1 FROM public.venue_till_payments p JOIN public.venue_till_sales s ON s.id = p.sale_id
    WHERE p.id = venue_till_receipts.payment_id AND public.issue_4490_can_view_venue(s.venue_id)));

REVOKE ALL ON FUNCTION
  public.issue_4490_till_receipt_immutable(),
  public.issue_4490_till_receipt_build(uuid),
  public.issue_4490_till_receipt_capture(uuid),
  public.issue_4490_till_receipt_on_paid(),
  public.issue_4490_till_receipt_projection(uuid),
  public.issue_4490_till_receipt_send(uuid, uuid, uuid, text, text, bytea),
  public.issue_4490_till_receipt_view(uuid, bytea),
  public.issue_4490_till_receipt_link_facts(uuid)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
  public.issue_4490_till_receipt_build(uuid),
  public.issue_4490_till_receipt_capture(uuid),
  public.issue_4490_till_receipt_projection(uuid),
  public.issue_4490_till_receipt_send(uuid, uuid, uuid, text, text, bytea),
  public.issue_4490_till_receipt_view(uuid, bytea),
  public.issue_4490_till_receipt_link_facts(uuid)
TO service_role;

COMMIT;
