BEGIN;

-- Issue #3859 slice 4A: the versioned checkout contract is additive. Legacy
-- sessions/orders remain truthful as NULL (unknown historical per-line choice)
-- rather than being rewritten from the old checkout-wide scalar.
ALTER TABLE public.ticket_checkout_sessions
  ADD COLUMN checkout_contract_version smallint,
  ADD COLUMN checkout_attempt_id uuid,
  ADD COLUMN checkout_fingerprint text,
  ADD CONSTRAINT ticket_checkout_sessions_contract_version_check
    CHECK (checkout_contract_version IS NULL OR checkout_contract_version = 2),
  ADD CONSTRAINT ticket_checkout_sessions_fingerprint_check
    CHECK (checkout_fingerprint IS NULL OR checkout_fingerprint ~ '^[0-9a-f]{64}$');

CREATE UNIQUE INDEX ticket_checkout_sessions_v2_attempt_unique
  ON public.ticket_checkout_sessions(event_id, checkout_attempt_id)
  WHERE checkout_attempt_id IS NOT NULL;

ALTER TABLE public.ticket_checkout_session_items
  ADD COLUMN payment_plan_choice text,
  ADD CONSTRAINT ticket_checkout_session_items_plan_choice_check
    CHECK (payment_plan_choice IS NULL OR payment_plan_choice IN ('full', 'installments'));

ALTER TABLE public.order_line_items
  ADD COLUMN payment_plan_choice text,
  ADD CONSTRAINT order_line_items_plan_choice_check
    CHECK (payment_plan_choice IS NULL OR payment_plan_choice IN ('full', 'installments'));

ALTER TABLE public.order_installments
  ADD COLUMN ticket_type_id uuid REFERENCES public.ticket_types(id) ON DELETE RESTRICT;

CREATE INDEX order_installments_ticket_type
  ON public.order_installments(ticket_type_id)
  WHERE ticket_type_id IS NOT NULL;

-- Resolve an already-bound logical attempt before the legacy session creator
-- can tombstone a terminal session and reserve inventory a second time. This
-- is deliberately service-only and returns the same bounded envelope as the
-- canonical session creator; it exposes no provider secret or buyer detail.
CREATE FUNCTION public.issue_3859_resolve_checkout_attempt(
  p_event_id uuid,
  p_checkout_attempt_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $function$
DECLARE
  v_session public.ticket_checkout_sessions%ROWTYPE;
  v_items jsonb;
BEGIN
  IF p_event_id IS NULL OR p_checkout_attempt_id IS NULL THEN
    RAISE EXCEPTION 'checkout_attempt_invalid';
  END IF;

  SELECT * INTO v_session
    FROM public.ticket_checkout_sessions
   WHERE event_id = p_event_id
     AND checkout_attempt_id = p_checkout_attempt_id
     AND checkout_contract_version = 2;
  IF NOT FOUND THEN RETURN NULL; END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'ticketTypeId', i.ticket_type_id,
    'ticketName', i.ticket_name_at_purchase,
    'quantity', i.quantity,
    'unitPriceCents', i.unit_price_cents,
    'totalCents', i.total_cents,
    'paymentPlanChoice', i.payment_plan_choice
  ) ORDER BY i.created_at, i.id), '[]'::jsonb)
    INTO v_items
    FROM public.ticket_checkout_session_items i
   WHERE i.checkout_session_id = v_session.id;

  RETURN jsonb_build_object(
    'checkoutSessionId', v_session.id,
    'eventId', v_session.event_id,
    'brandId', v_session.brand_id,
    'status', v_session.status,
    'totalCents', v_session.total_cents,
    'subtotalCents', v_session.subtotal_cents,
    'currency', trim(v_session.currency),
    'stripeAccountId', v_session.stripe_account_id,
    'orderId', v_session.order_id,
    'items', v_items,
    'lineItems', v_items,
    'installmentSchedule', v_session.installment_schedule
  );
END
$function$;

REVOKE ALL ON FUNCTION public.issue_3859_resolve_checkout_attempt(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_3859_resolve_checkout_attempt(uuid, uuid)
  TO service_role;

-- One atomic owner binds normalized input to the already server-priced session.
-- It never accepts prices from the caller; p_full_price_cents is compared with
-- the sum of canonical session items under the session row lock.
CREATE FUNCTION public.issue_3859_bind_checkout_contract(
  p_checkout_session_id uuid,
  p_event_id uuid,
  p_idempotency_key text,
  p_checkout_attempt_id uuid,
  p_checkout_fingerprint text,
  p_lines jsonb,
  p_due_today_cents integer,
  p_full_price_cents integer,
  p_installment_schedule jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $function$
DECLARE
  v_session public.ticket_checkout_sessions%ROWTYPE;
  v_line jsonb;
  v_item public.ticket_checkout_session_items%ROWTYPE;
  v_choice text;
  v_ticket_type_id uuid;
  v_quantity integer;
  v_seen integer := 0;
  v_item_count integer;
  v_full_price bigint;
  v_scheduled_total bigint := 0;
  v_installment jsonb;
  v_expected_ordinal integer := 1;
  v_seen_ticket_ids uuid[] := ARRAY[]::uuid[];
BEGIN
  IF p_checkout_attempt_id IS NULL
     OR p_checkout_fingerprint IS NULL
     OR p_due_today_cents IS NULL
     OR p_full_price_cents IS NULL
     OR p_checkout_fingerprint !~ '^[0-9a-f]{64}$'
     OR p_idempotency_key IS DISTINCT FROM
       ('ticket_checkout:v2:' || p_event_id::text || ':' || p_checkout_attempt_id::text) THEN
    RAISE EXCEPTION 'checkout_contract_invalid';
  END IF;

  SELECT * INTO v_session
    FROM public.ticket_checkout_sessions
   WHERE id = p_checkout_session_id
     AND event_id = p_event_id
     AND idempotency_key = p_idempotency_key
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'checkout_session_not_found';
  END IF;

  -- Same attempt + same canonical fingerprint is reconciliation. Same attempt
  -- + changed cart/contact/consent/intake/quote is a review conflict.
  IF v_session.checkout_contract_version IS NOT NULL THEN
    IF v_session.checkout_contract_version = 2
       AND v_session.checkout_attempt_id = p_checkout_attempt_id
       AND v_session.checkout_fingerprint = p_checkout_fingerprint THEN
      RETURN jsonb_build_object(
        'outcome', 'reconciled',
        'totalCents', v_session.total_cents,
        'installmentSchedule', v_session.installment_schedule
      );
    END IF;
    RAISE EXCEPTION 'checkout_fingerprint_conflict';
  END IF;

  IF v_session.order_id IS NOT NULL
     OR v_session.stripe_payment_intent_id IS NOT NULL
     OR v_session.status NOT IN ('pending_free', 'requires_payment') THEN
    RAISE EXCEPTION 'checkout_contract_too_late';
  END IF;
  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array'
     OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'checkout_lines_conflict';
  END IF;

  SELECT count(*), COALESCE(sum(total_cents), 0)
    INTO v_item_count, v_full_price
    FROM public.ticket_checkout_session_items
   WHERE checkout_session_id = p_checkout_session_id;
  IF v_item_count <> jsonb_array_length(p_lines)
     OR v_full_price <> p_full_price_cents THEN
    RAISE EXCEPTION 'checkout_lines_conflict';
  END IF;

  FOR v_line IN SELECT value FROM jsonb_array_elements(p_lines)
  LOOP
    IF jsonb_typeof(v_line) <> 'object'
       OR COALESCE(v_line->>'ticketTypeId', '') !~
         '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'
       OR COALESCE(v_line->>'quantity', '') !~ '^[1-9][0-9]*$'
       OR COALESCE(v_line->>'paymentPlanChoice', '') NOT IN ('full', 'installments') THEN
      RAISE EXCEPTION 'checkout_lines_conflict';
    END IF;
    v_ticket_type_id := (v_line->>'ticketTypeId')::uuid;
    v_quantity := (v_line->>'quantity')::integer;
    v_choice := v_line->>'paymentPlanChoice';

    SELECT * INTO v_item
      FROM public.ticket_checkout_session_items
     WHERE checkout_session_id = p_checkout_session_id
       AND ticket_type_id = v_ticket_type_id;
    IF NOT FOUND OR v_item.quantity <> v_quantity THEN
      RAISE EXCEPTION 'checkout_lines_conflict';
    END IF;

    IF v_ticket_type_id = ANY(v_seen_ticket_ids) THEN
      RAISE EXCEPTION 'checkout_lines_conflict';
    END IF;
    v_seen_ticket_ids := array_append(v_seen_ticket_ids, v_ticket_type_id);
    UPDATE public.ticket_checkout_session_items
       SET payment_plan_choice = v_choice
     WHERE id = v_item.id;
    v_seen := v_seen + 1;
  END LOOP;
  IF v_seen <> v_item_count THEN
    RAISE EXCEPTION 'checkout_lines_conflict';
  END IF;

  IF p_due_today_cents < 0 OR p_due_today_cents > p_full_price_cents THEN
    RAISE EXCEPTION 'checkout_quote_invalid';
  END IF;
  IF p_installment_schedule IS NULL THEN
    IF p_due_today_cents <> p_full_price_cents
       OR EXISTS (
         SELECT 1 FROM public.ticket_checkout_session_items
          WHERE checkout_session_id = p_checkout_session_id
            AND payment_plan_choice = 'installments'
       ) THEN
      RAISE EXCEPTION 'checkout_quote_invalid';
    END IF;
  ELSE
    IF jsonb_typeof(p_installment_schedule) <> 'object'
       OR COALESCE(p_installment_schedule->>'fullPriceCents', '') !~ '^[0-9]+$'
       OR COALESCE(p_installment_schedule->>'depositCents', '') !~ '^[0-9]+$'
       OR upper(COALESCE(p_installment_schedule->>'currency', '')) <>
         upper(trim(v_session.currency))
       OR jsonb_typeof(p_installment_schedule->'installments') <> 'array'
       OR p_due_today_cents <= 0 THEN
      RAISE EXCEPTION 'checkout_quote_invalid';
    END IF;
    IF jsonb_array_length(p_installment_schedule->'installments') = 0
       OR (p_installment_schedule->>'fullPriceCents')::bigint <> p_full_price_cents
       OR (p_installment_schedule->>'depositCents')::bigint <> p_due_today_cents THEN
      RAISE EXCEPTION 'checkout_quote_invalid';
    END IF;
    FOR v_installment IN
      SELECT value FROM jsonb_array_elements(p_installment_schedule->'installments')
    LOOP
      IF COALESCE(v_installment->>'ordinal', '') !~ '^[1-9][0-9]*$'
         OR (v_installment->>'ordinal')::integer <> v_expected_ordinal
         OR COALESCE(v_installment->>'amountCents', '') !~ '^[1-9][0-9]*$'
         OR COALESCE(v_installment->>'sourceTicketTypeId', '') !~
           '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'
         OR NOT EXISTS (
           SELECT 1 FROM public.ticket_checkout_session_items
            WHERE checkout_session_id = p_checkout_session_id
              AND ticket_type_id = (v_installment->>'sourceTicketTypeId')::uuid
              AND payment_plan_choice = 'installments'
         ) THEN
        RAISE EXCEPTION 'checkout_quote_invalid';
      END IF;
      IF (v_installment->>'dueAt')::timestamptz <= v_session.created_at THEN
        RAISE EXCEPTION 'checkout_quote_invalid';
      END IF;
      v_scheduled_total := v_scheduled_total +
        (v_installment->>'amountCents')::bigint;
      v_expected_ordinal := v_expected_ordinal + 1;
    END LOOP;
    IF p_due_today_cents + v_scheduled_total <> p_full_price_cents
       OR EXISTS (
         SELECT 1 FROM public.ticket_checkout_session_items l
          WHERE l.checkout_session_id = p_checkout_session_id
            AND l.payment_plan_choice = 'installments'
            AND NOT EXISTS (
              SELECT 1
                FROM jsonb_array_elements(p_installment_schedule->'installments') i
               WHERE i->>'sourceTicketTypeId' = l.ticket_type_id::text
            )
       ) THEN
      RAISE EXCEPTION 'checkout_quote_invalid';
    END IF;
  END IF;

  UPDATE public.ticket_checkout_sessions
     SET checkout_contract_version = 2,
         checkout_attempt_id = p_checkout_attempt_id,
         checkout_fingerprint = p_checkout_fingerprint,
         cart_fingerprint = p_checkout_fingerprint,
         subtotal_cents = p_due_today_cents,
         total_cents = p_due_today_cents,
         installment_schedule = p_installment_schedule,
         updated_at = now()
   WHERE id = p_checkout_session_id;

  RETURN jsonb_build_object(
    'outcome', 'bound',
    'totalCents', p_due_today_cents,
    'installmentSchedule', p_installment_schedule
  );
END
$function$;

REVOKE ALL ON FUNCTION public.issue_3859_bind_checkout_contract(
  uuid, uuid, text, uuid, text, jsonb, integer, integer, jsonb
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_3859_bind_checkout_contract(
  uuid, uuid, text, uuid, text, jsonb, integer, integer, jsonb
) TO service_role;

-- Finalize remains the single order writer. These narrow BEFORE INSERT
-- adapters copy the already-bound session provenance without re-emitting that
-- large, security-sensitive function.
CREATE FUNCTION public.issue_3859_copy_order_line_plan_choice()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
DECLARE v_choice text;
BEGIN
  SELECT si.payment_plan_choice INTO v_choice
    FROM public.orders o
    JOIN public.ticket_checkout_session_items si
      ON si.checkout_session_id = o.checkout_session_id
     AND si.ticket_type_id = NEW.ticket_type_id
   WHERE o.id = NEW.order_id
   ORDER BY si.created_at, si.id
   LIMIT 1;
  IF FOUND THEN NEW.payment_plan_choice := v_choice; END IF;
  RETURN NEW;
END
$function$;

CREATE TRIGGER issue_3859_order_line_plan_choice
BEFORE INSERT ON public.order_line_items
FOR EACH ROW EXECUTE FUNCTION public.issue_3859_copy_order_line_plan_choice();

REVOKE ALL ON FUNCTION public.issue_3859_copy_order_line_plan_choice() FROM PUBLIC;

CREATE FUNCTION public.issue_3859_copy_installment_ticket_type()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
DECLARE v_ticket_type_id uuid;
BEGIN
  SELECT NULLIF(i.value->>'sourceTicketTypeId', '')::uuid
    INTO v_ticket_type_id
    FROM public.orders o
    JOIN public.ticket_checkout_sessions s ON s.id = o.checkout_session_id
    CROSS JOIN LATERAL jsonb_array_elements(s.installment_schedule->'installments') i(value)
   WHERE o.id = NEW.order_id
     AND (i.value->>'ordinal')::smallint = NEW.ordinal
   LIMIT 1;
  IF FOUND THEN NEW.ticket_type_id := v_ticket_type_id; END IF;
  RETURN NEW;
END
$function$;

CREATE TRIGGER issue_3859_installment_ticket_type
BEFORE INSERT ON public.order_installments
FOR EACH ROW EXECUTE FUNCTION public.issue_3859_copy_installment_ticket_type();

REVOKE ALL ON FUNCTION public.issue_3859_copy_installment_ticket_type() FROM PUBLIC;

COMMIT;
