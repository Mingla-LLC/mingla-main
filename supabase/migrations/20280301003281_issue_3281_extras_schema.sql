-- issue #3281 — Extras, slice 1: the tables and the refund rule.
--
-- Nothing can be authored or sold yet, so no order has extras and every helper
-- below returns zero. Decisions from the approved design, 2026-09-12:
--   An extra is its own priced row, so ticket line arithmetic never widens.
--   Day scope uses the same stable date keys as tickets. NULL means all of the
--     parent ticket's dates.
--   Extras are refunded under the event's terms, as part of the whole order: the
--     refund that returns the last tickets also returns the extras. Refunding an
--     extra alone is a later round.
--
-- Provider-initiated refunds (biz_refund_order_commit_from_webhook) allocate to
-- ticket lines only. The sale slice must revisit that before extras can be sold.

BEGIN;

CREATE TABLE public.ticket_add_ons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_type_id uuid NOT NULL REFERENCES public.ticket_types(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  price_cents integer NOT NULL DEFAULT 0,
  quantity_total integer,
  is_unlimited boolean NOT NULL DEFAULT false,
  max_per_ticket integer NOT NULL DEFAULT 1,
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  valid_occurrence_keys text[],
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ticket_add_ons_name_length CHECK (length(btrim(name)) BETWEEN 1 AND 120),
  CONSTRAINT ticket_add_ons_description_length CHECK (length(description) <= 280),
  CONSTRAINT ticket_add_ons_price_not_negative CHECK (price_cents >= 0),
  CONSTRAINT ticket_add_ons_capacity_shape CHECK (
    (is_unlimited AND quantity_total IS NULL)
    OR (NOT is_unlimited AND quantity_total IS NOT NULL AND quantity_total > 0)
  ),
  CONSTRAINT ticket_add_ons_max_per_ticket CHECK (max_per_ticket BETWEEN 1 AND 20),
  CONSTRAINT ticket_add_ons_day_list_not_empty CHECK (
    valid_occurrence_keys IS NULL OR cardinality(valid_occurrence_keys) > 0
  )
);
CREATE INDEX idx_ticket_add_ons_ticket_type ON public.ticket_add_ons (ticket_type_id, sort_order);

CREATE TABLE public.order_add_on_line_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  ticket_add_on_id uuid REFERENCES public.ticket_add_ons(id) ON DELETE SET NULL,
  ticket_type_id uuid NOT NULL REFERENCES public.ticket_types(id) ON DELETE RESTRICT,
  add_on_name_at_order text NOT NULL,
  ticket_type_name_at_order text NOT NULL,
  day_scope_at_order text[],
  quantity integer NOT NULL,
  unit_price_cents integer NOT NULL,
  total_cents integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT order_add_on_line_items_quantity_positive CHECK (quantity > 0),
  CONSTRAINT order_add_on_line_items_price_not_negative CHECK (unit_price_cents >= 0),
  CONSTRAINT order_add_on_line_items_line_arith CHECK (total_cents = quantity * unit_price_cents)
);
CREATE INDEX idx_order_add_on_line_items_order ON public.order_add_on_line_items (order_id);

CREATE TABLE public.refund_add_on_line_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  refund_id uuid NOT NULL REFERENCES public.refunds(id) ON DELETE CASCADE,
  order_add_on_line_item_id uuid NOT NULL
    REFERENCES public.order_add_on_line_items(id) ON DELETE RESTRICT,
  quantity integer NOT NULL,
  amount_cents integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT refund_add_on_line_items_quantity_positive CHECK (quantity > 0),
  CONSTRAINT refund_add_on_line_items_amount_not_negative CHECK (amount_cents >= 0),
  UNIQUE (refund_id, order_add_on_line_item_id)
);
CREATE INDEX idx_refund_add_on_line_items_line
  ON public.refund_add_on_line_items (order_add_on_line_item_id);

-- Writes go through SECURITY DEFINER functions only. Host reads come in slice 3.
ALTER TABLE public.ticket_add_ons ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_add_on_line_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.refund_add_on_line_items ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ticket_add_ons FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.order_add_on_line_items FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.refund_add_on_line_items FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.ticket_add_ons TO service_role;
GRANT SELECT ON public.order_add_on_line_items TO service_role;
GRANT SELECT ON public.refund_add_on_line_items TO service_role;

-- True when this refund, plus every live refund before it, returns all tickets.
-- p_this_refund is excluded so the check reads the same before and after its
-- own ticket lines are written.
CREATE OR REPLACE FUNCTION public.issue_3281_refund_returns_all_tickets(
  p_order_id uuid, p_lines jsonb, p_this_refund uuid
) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT NOT EXISTS (
    SELECT 1 FROM public.order_line_items oli
     WHERE oli.order_id = p_order_id
       AND oli.quantity > (
         SELECT COALESCE(SUM(rli.quantity), 0)
           FROM public.refund_line_items rli
           JOIN public.refunds r ON r.id = rli.refund_id
          WHERE rli.order_line_item_id = oli.id
            AND r.status IN ('pending', 'succeeded')
            AND r.id IS DISTINCT FROM p_this_refund
       ) + COALESCE((
         SELECT SUM((l->>'quantity')::integer)
           FROM jsonb_array_elements(p_lines) l
          WHERE l->>'order_line_item_id' = oli.id::text
       ), 0)
  );
$fn$;

CREATE OR REPLACE FUNCTION public.issue_3281_extras_refund_cents(
  p_order_id uuid, p_lines jsonb, p_this_refund uuid
) RETURNS integer
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_cents integer;
BEGIN
  IF NOT public.issue_3281_refund_returns_all_tickets(p_order_id, p_lines, p_this_refund) THEN
    RETURN 0;
  END IF;
  SELECT COALESCE(SUM(GREATEST(item.total_cents - COALESCE((
      SELECT SUM(ra.amount_cents)
        FROM public.refund_add_on_line_items ra
        JOIN public.refunds r ON r.id = ra.refund_id
       WHERE ra.order_add_on_line_item_id = item.id
         AND r.status IN ('pending', 'succeeded')
         AND r.id IS DISTINCT FROM p_this_refund
    ), 0), 0)), 0)::integer
    INTO v_cents
    FROM public.order_add_on_line_items item
   WHERE item.order_id = p_order_id;
  RETURN v_cents;
END;
$fn$;

-- A manual refund that would return the extras must not rest on another refund
-- that can still fail, or the guest could keep a ticket after losing its
-- extras. It waits until that refund settles. A cancellation never waits: the
-- event is gone, so nothing is left to keep. Orders with no extras never wait.
CREATE OR REPLACE FUNCTION public.issue_3281_extras_refund_cents_settled(
  p_order_id uuid, p_lines jsonb
) RETURNS integer
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_cents integer := public.issue_3281_extras_refund_cents(p_order_id, p_lines, NULL);
BEGIN
  -- A free extra waits too: it is still recorded as returned.
  IF public.issue_3281_refund_returns_all_tickets(p_order_id, p_lines, NULL)
     AND EXISTS (
       SELECT 1 FROM public.order_add_on_line_items item
        WHERE item.order_id = p_order_id
          AND NOT EXISTS (
            SELECT 1 FROM public.refund_add_on_line_items ra
              JOIN public.refunds r ON r.id = ra.refund_id
             WHERE ra.order_add_on_line_item_id = item.id
               AND r.status IN ('pending', 'succeeded')
          )
     )
     AND EXISTS (
       SELECT 1 FROM public.refunds r
        WHERE r.order_id = p_order_id AND r.status = 'pending'
     ) THEN
    RAISE EXCEPTION 'refund_pending_on_order' USING ERRCODE = 'P0013';
  END IF;
  RETURN v_cents;
END;
$fn$;
REVOKE ALL ON FUNCTION public.issue_3281_extras_refund_cents_settled(uuid, jsonb) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.issue_3281_record_extras_refund(
  p_refund_id uuid, p_order_id uuid, p_lines jsonb
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  IF NOT public.issue_3281_refund_returns_all_tickets(p_order_id, p_lines, p_refund_id) THEN
    RETURN;
  END IF;
  INSERT INTO public.refund_add_on_line_items (
    refund_id, order_add_on_line_item_id, quantity, amount_cents
  )
  SELECT p_refund_id, item.id, item.quantity, item.total_cents
    FROM public.order_add_on_line_items item
   WHERE item.order_id = p_order_id
     AND NOT EXISTS (
       SELECT 1 FROM public.refund_add_on_line_items ra
         JOIN public.refunds r ON r.id = ra.refund_id
        WHERE ra.order_add_on_line_item_id = item.id
          AND r.status IN ('pending', 'succeeded')
     );
END;
$fn$;

REVOKE ALL ON FUNCTION public.issue_3281_refund_returns_all_tickets(uuid, jsonb, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.issue_3281_extras_refund_cents(uuid, jsonb, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.issue_3281_record_extras_refund(uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.refund_preview(
  p_order_id uuid,
  p_lines jsonb
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_order public.orders%ROWTYPE;
  v_brand_id uuid;
  v_lines jsonb;
  v_line jsonb;
  v_item public.order_line_items%ROWTYPE;
  v_existing integer;
  v_amount bigint := 0;
  v_remaining bigint;
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'order_not_found' USING ERRCODE = 'P0001';
  END IF;
  SELECT brand_id INTO v_brand_id FROM public.events WHERE id = v_order.event_id;
  IF NOT public.biz_can_manage_payments_for_brand(v_brand_id, auth.uid()) THEN
    RAISE EXCEPTION 'permission_denied' USING ERRCODE = '42501';
  END IF;

  v_lines := public.issue_3872_refund_server_lines(p_order_id, p_lines);
  FOR v_line IN SELECT * FROM jsonb_array_elements(v_lines) LOOP
    SELECT * INTO v_item FROM public.order_line_items
     WHERE id::text = v_line->>'order_line_item_id' AND order_id = p_order_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'line_item_not_found: %', v_line->>'order_line_item_id' USING ERRCODE = 'P0004';
    END IF;
    IF COALESCE((v_line->>'quantity')::int, 0) <= 0 THEN
      RAISE EXCEPTION 'refund_amount_zero' USING ERRCODE = 'P0008';
    END IF;
    SELECT COALESCE(SUM(rli.quantity), 0) INTO v_existing
    FROM public.refund_line_items rli
    JOIN public.refunds r ON r.id = rli.refund_id
    WHERE rli.order_line_item_id = v_item.id AND r.status IN ('pending', 'succeeded');
    IF v_existing + (v_line->>'quantity')::int > v_item.quantity THEN
      RAISE EXCEPTION 'line_overrefund: line=% requested=% existing=% capacity=%',
        v_item.id, v_line->>'quantity', v_existing, v_item.quantity USING ERRCODE = 'P0005';
    END IF;
    v_amount := v_amount + (v_line->>'amount_cents')::bigint;
  END LOOP;
  -- issue #3281 — the same rule the refund itself applies.
  v_amount := v_amount + public.issue_3281_extras_refund_cents(p_order_id, v_lines, NULL);

  v_remaining := COALESCE(v_order.buyer_total_cents, v_order.total_cents)
    - COALESCE(v_order.refunded_amount_cents, 0);
  RETURN jsonb_build_object(
    'order_id', p_order_id,
    'currency', v_order.currency,
    'lines', v_lines,
    'amount_cents', v_amount,
    'remaining_cents', v_remaining,
    'within_remaining', v_amount <= v_remaining
  );
END
$fn$;

CREATE OR REPLACE FUNCTION public.admin_refund_order(p_order_id uuid, p_lines jsonb, p_reason text, p_idempotency_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_order public.orders%ROWTYPE;
  v_caller uuid := auth.uid();
  v_refund_id uuid;
  v_refund_amount_cents int := 0;
  v_line jsonb;
  v_line_item public.order_line_items%ROWTYPE;
  v_existing_refunded int;
  v_all_lines_fully_refunded boolean;
  v_proposed_new_payment_status text;
  v_existing_refund public.refunds%ROWTYPE;
  v_remaining_cents int;
  v_canonical_lines jsonb;
  v_request_manifest jsonb;
  v_stored_manifest jsonb;
  v_client_lines jsonb;
  v_client_amount_cents bigint;
BEGIN
  -- I-PROPOSED-1278-ADMIN-GATE-FIRST: this remains the first executable
  -- statement, byte-for-byte equivalent to the approved service-role twin.
  IF auth.uid() IS NOT NULL AND NOT public.is_admin_user() THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'order_not_found' USING ERRCODE = 'P0001';
  END IF;

  IF p_reason IS NULL OR length(trim(p_reason)) < 10 OR length(trim(p_reason)) > 200 THEN
    RAISE EXCEPTION 'reason_invalid_length' USING ERRCODE = 'P0003';
  END IF;

  SELECT coalesce(
    jsonb_agg(
      jsonb_build_object(
        'order_line_item_id', line->>'order_line_item_id',
        'quantity', (line->>'quantity')::int,
        'amount_cents', (line->>'amount_cents')::int
      )
      ORDER BY
        line->>'order_line_item_id',
        (line->>'quantity')::int,
        (line->>'amount_cents')::int
    ),
    '[]'::jsonb
  )
  INTO v_client_lines
  FROM jsonb_array_elements(p_lines) AS line;

  -- Issue #3872 (F4): the refund amount is derived on the server from the
  -- order snapshot (quantity x order_line_items.unit_price_cents, the policy the
  -- Host app has always sent). A client-sent amount_cents is ignored; it is
  -- only logged below when it disagrees. Replays of a key minted before this
  -- change still match their stored client-shaped manifest.
  v_canonical_lines := public.issue_3872_refund_server_lines(p_order_id, p_lines);
  SELECT sum((l->>'amount_cents')::bigint) INTO v_client_amount_cents
  FROM jsonb_array_elements(v_client_lines) l;

  v_request_manifest := jsonb_build_object(
    'lines', v_canonical_lines,
    'reason', trim(p_reason),
    -- What the client sent, kept so a retry under the same key must repeat it.
    'client_lines', v_client_lines
  );
  PERFORM pg_advisory_xact_lock(
    hashtextextended(p_order_id::text || ':' || p_idempotency_key, 0)
  );

  SELECT * INTO v_existing_refund
  FROM public.refunds
  WHERE metadata->>'idempotency_key' = p_idempotency_key
    AND order_id = p_order_id
  LIMIT 1;

  IF FOUND THEN
    v_stored_manifest := v_existing_refund.metadata->'refund_request_manifest';
    IF v_stored_manifest IS NULL
       OR (v_stored_manifest->'lines' IS DISTINCT FROM v_canonical_lines
           AND v_stored_manifest->'lines' IS DISTINCT FROM v_client_lines)
       -- A request that names amounts must repeat the amounts first sent under
       -- this key (same key, different body is still a mismatch, #1175).
       OR (v_stored_manifest ? 'client_lines'
           AND v_client_amount_cents IS NOT NULL
           AND v_stored_manifest->'client_lines' IS DISTINCT FROM v_client_lines)
       OR v_stored_manifest->>'reason' IS DISTINCT FROM trim(p_reason) THEN
      RAISE EXCEPTION 'idempotency_request_mismatch'
        USING ERRCODE = '23505';
    END IF;

    RETURN jsonb_build_object(
      'refund_id', v_existing_refund.id,
      'order_id', p_order_id,
      'amount_cents', v_existing_refund.amount_cents,
      'currency', v_existing_refund.currency,
      'stripe_payment_intent_id', v_order.stripe_payment_intent_id,
      'stripe_charge_id', v_order.stripe_charge_id,
      'application_fee_amount_cents', v_order.stripe_application_fee_amount_cents,
      'proposed_new_payment_status',
        v_stored_manifest->>'proposed_new_payment_status',
      'is_full_refund',
        (v_stored_manifest->>'is_full_refund')::boolean,
      'lines', v_stored_manifest->'lines',
      'reason', v_stored_manifest->>'reason',
      'idempotent_replay', true
    );
  END IF;

  IF v_order.payment_status NOT IN ('paid', 'partial_refund') THEN
    RAISE EXCEPTION 'order_not_refundable: status=%', v_order.payment_status
      USING ERRCODE = 'P0002';
  END IF;

  FOR v_line IN SELECT * FROM jsonb_array_elements(v_canonical_lines) LOOP
    SELECT * INTO v_line_item
    FROM public.order_line_items
    WHERE id = (v_line->>'order_line_item_id')::uuid
      AND order_id = p_order_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'line_item_not_found: %',
        v_line->>'order_line_item_id' USING ERRCODE = 'P0004';
    END IF;

    SELECT COALESCE(SUM(rli.quantity), 0) INTO v_existing_refunded
    FROM public.refund_line_items rli
    JOIN public.refunds r ON r.id = rli.refund_id
    WHERE rli.order_line_item_id = v_line_item.id
      AND r.status IN ('pending', 'succeeded');

    IF COALESCE((v_line->>'quantity')::int, 0) <= 0 THEN
      RAISE EXCEPTION 'refund_amount_zero' USING ERRCODE = 'P0008';
    END IF;

    IF v_existing_refunded + (v_line->>'quantity')::int > v_line_item.quantity THEN
      RAISE EXCEPTION 'line_overrefund: line=% requested=% existing=% capacity=%',
        v_line_item.id, v_line->>'quantity', v_existing_refunded,
        v_line_item.quantity USING ERRCODE = 'P0005';
    END IF;

    v_refund_amount_cents :=
      v_refund_amount_cents + (v_line->>'amount_cents')::int;
  END LOOP;

  -- issue #3281 — returning the last tickets also returns the order's extras.
  v_refund_amount_cents := v_refund_amount_cents
    + public.issue_3281_extras_refund_cents_settled(p_order_id, v_canonical_lines);

  IF v_refund_amount_cents <= 0 THEN
    RAISE EXCEPTION 'refund_amount_zero' USING ERRCODE = 'P0008';
  END IF;

  v_remaining_cents :=
    v_order.total_cents - COALESCE(v_order.refunded_amount_cents, 0);
  IF v_refund_amount_cents > v_remaining_cents THEN
    RAISE EXCEPTION 'refund_exceeds_remaining: requested=% remaining=%',
      v_refund_amount_cents, v_remaining_cents USING ERRCODE = 'P0009';
  END IF;

  INSERT INTO public.refunds (
    order_id, amount_cents, currency, reason, initiated_by, status,
    stripe_payment_intent_id, stripe_charge_id, metadata
  ) VALUES (
    p_order_id,
    v_refund_amount_cents,
    v_order.currency,
    trim(p_reason),
    v_caller,
    'pending',
    v_order.stripe_payment_intent_id,
    v_order.stripe_charge_id,
    jsonb_build_object(
      'idempotency_key', p_idempotency_key,
      'refund_request_manifest', v_request_manifest
    ) || CASE
      WHEN v_client_amount_cents IS NOT NULL
        AND v_client_amount_cents IS DISTINCT FROM v_refund_amount_cents::bigint
      THEN jsonb_build_object('issue_3872_client_reported', jsonb_build_object(
        'amount_cents', v_client_amount_cents,
        'lines', v_client_lines,
        'server_amount_cents', v_refund_amount_cents))
      ELSE '{}'::jsonb
    END
  ) RETURNING id INTO v_refund_id;

  PERFORM public.issue_3281_record_extras_refund(v_refund_id, p_order_id, v_canonical_lines);

  FOR v_line IN SELECT * FROM jsonb_array_elements(v_canonical_lines) LOOP
    INSERT INTO public.refund_line_items (
      refund_id, order_line_item_id, ticket_type_id, quantity, amount_cents
    )
    SELECT
      v_refund_id,
      (v_line->>'order_line_item_id')::uuid,
      oli.ticket_type_id,
      (v_line->>'quantity')::int,
      (v_line->>'amount_cents')::int
    FROM public.order_line_items oli
    WHERE oli.id = (v_line->>'order_line_item_id')::uuid;
  END LOOP;

  SELECT NOT EXISTS (
    SELECT 1 FROM public.order_line_items oli
    WHERE oli.order_id = p_order_id
      AND oli.quantity > (
        SELECT COALESCE(SUM(rli.quantity), 0)
        FROM public.refund_line_items rli
        JOIN public.refunds r ON r.id = rli.refund_id
        WHERE rli.order_line_item_id = oli.id
          AND r.status IN ('pending', 'succeeded')
      )
  ) INTO v_all_lines_fully_refunded;

  v_proposed_new_payment_status := CASE
    WHEN v_all_lines_fully_refunded THEN 'refunded'
    ELSE 'partial_refund'
  END;
  v_request_manifest := v_request_manifest || jsonb_build_object(
    'amount_cents', v_refund_amount_cents,
    'proposed_new_payment_status', v_proposed_new_payment_status,
    'is_full_refund', v_all_lines_fully_refunded
  );
  UPDATE public.refunds
  SET metadata = metadata ||
    jsonb_build_object('refund_request_manifest', v_request_manifest)
  WHERE id = v_refund_id;

  RETURN jsonb_build_object(
    'refund_id', v_refund_id,
    'order_id', p_order_id,
    'amount_cents', v_refund_amount_cents,
    'currency', v_order.currency,
    'stripe_payment_intent_id', v_order.stripe_payment_intent_id,
    'stripe_charge_id', v_order.stripe_charge_id,
    'application_fee_amount_cents', v_order.stripe_application_fee_amount_cents,
    'proposed_new_payment_status', v_proposed_new_payment_status,
    'is_full_refund', v_all_lines_fully_refunded,
    'lines', v_canonical_lines,
    'reason', trim(p_reason),
    'idempotent_replay', false
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.biz_refund_order(p_order_id uuid, p_lines jsonb, p_reason text, p_idempotency_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_order public.orders%ROWTYPE;
  v_brand_id uuid;
  v_caller uuid := auth.uid();
  v_refund_id uuid;
  v_refund_amount_cents int := 0;
  v_line jsonb;
  v_line_item public.order_line_items%ROWTYPE;
  v_existing_refunded int;
  v_all_lines_fully_refunded boolean;
  v_proposed_new_payment_status text;
  v_existing_refund public.refunds%ROWTYPE;
  v_canonical_lines jsonb;
  v_request_manifest jsonb;
  v_stored_manifest jsonb;
  v_client_lines jsonb;
  v_client_amount_cents bigint;
BEGIN
  -- Authorization precedes the idempotency lookup so replay cannot disclose
  -- refund or payment identifiers to a caller outside the order's brand.
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'order_not_found' USING ERRCODE = 'P0001';
  END IF;

  SELECT brand_id INTO v_brand_id FROM public.events WHERE id = v_order.event_id;
  IF NOT public.biz_can_manage_payments_for_brand(v_brand_id, v_caller) THEN
    RAISE EXCEPTION 'permission_denied' USING ERRCODE = '42501';
  END IF;

  IF p_reason IS NULL OR length(trim(p_reason)) < 10 OR length(trim(p_reason)) > 200 THEN
    RAISE EXCEPTION 'reason_invalid_length' USING ERRCODE = 'P0003';
  END IF;

  SELECT coalesce(
    jsonb_agg(
      jsonb_build_object(
        'order_line_item_id', line->>'order_line_item_id',
        'quantity', (line->>'quantity')::int,
        'amount_cents', (line->>'amount_cents')::int
      )
      ORDER BY
        line->>'order_line_item_id',
        (line->>'quantity')::int,
        (line->>'amount_cents')::int
    ),
    '[]'::jsonb
  )
  INTO v_client_lines
  FROM jsonb_array_elements(p_lines) AS line;

  -- Issue #3872 (F4): the refund amount is derived on the server from the
  -- order snapshot (quantity x order_line_items.unit_price_cents, the policy the
  -- Host app has always sent). A client-sent amount_cents is ignored; it is
  -- only logged below when it disagrees. Replays of a key minted before this
  -- change still match their stored client-shaped manifest.
  v_canonical_lines := public.issue_3872_refund_server_lines(p_order_id, p_lines);
  SELECT sum((l->>'amount_cents')::bigint) INTO v_client_amount_cents
  FROM jsonb_array_elements(v_client_lines) l;

  v_request_manifest := jsonb_build_object(
    'lines', v_canonical_lines,
    'reason', trim(p_reason),
    -- What the client sent, kept so a retry under the same key must repeat it.
    'client_lines', v_client_lines
  );

  -- Serialize same-key requests before the lookup/insert pair. The existing
  -- unique expression index remains the final database backstop.
  PERFORM pg_advisory_xact_lock(
    hashtextextended(p_order_id::text || ':' || p_idempotency_key, 0)
  );

  SELECT * INTO v_existing_refund
  FROM public.refunds
  WHERE metadata->>'idempotency_key' = p_idempotency_key
    AND order_id = p_order_id
  LIMIT 1;

  IF FOUND THEN
    v_stored_manifest := v_existing_refund.metadata->'refund_request_manifest';
    IF v_stored_manifest IS NULL
       OR (v_stored_manifest->'lines' IS DISTINCT FROM v_canonical_lines
           AND v_stored_manifest->'lines' IS DISTINCT FROM v_client_lines)
       -- A request that names amounts must repeat the amounts first sent under
       -- this key (same key, different body is still a mismatch, #1175).
       OR (v_stored_manifest ? 'client_lines'
           AND v_client_amount_cents IS NOT NULL
           AND v_stored_manifest->'client_lines' IS DISTINCT FROM v_client_lines)
       OR v_stored_manifest->>'reason' IS DISTINCT FROM trim(p_reason) THEN
      RAISE EXCEPTION 'idempotency_request_mismatch'
        USING ERRCODE = '23505';
    END IF;

    RETURN jsonb_build_object(
      'refund_id', v_existing_refund.id,
      'order_id', p_order_id,
      'amount_cents', v_existing_refund.amount_cents,
      'currency', v_existing_refund.currency,
      'stripe_payment_intent_id', v_order.stripe_payment_intent_id,
      'stripe_charge_id', v_order.stripe_charge_id,
      'application_fee_amount_cents', v_order.stripe_application_fee_amount_cents,
      'proposed_new_payment_status',
        v_stored_manifest->>'proposed_new_payment_status',
      'is_full_refund',
        (v_stored_manifest->>'is_full_refund')::boolean,
      'lines', v_stored_manifest->'lines',
      'reason', v_stored_manifest->>'reason',
      'idempotent_replay', true
    );
  END IF;

  IF v_order.payment_status NOT IN ('paid', 'partial_refund') THEN
    RAISE EXCEPTION 'order_not_refundable: status=%', v_order.payment_status
      USING ERRCODE = 'P0002';
  END IF;

  FOR v_line IN SELECT * FROM jsonb_array_elements(v_canonical_lines) LOOP
    SELECT * INTO v_line_item
    FROM public.order_line_items
    WHERE id = (v_line->>'order_line_item_id')::uuid
      AND order_id = p_order_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'line_item_not_found: %',
        v_line->>'order_line_item_id' USING ERRCODE = 'P0004';
    END IF;

    SELECT COALESCE(SUM(rli.quantity), 0) INTO v_existing_refunded
    FROM public.refund_line_items rli
    JOIN public.refunds r ON r.id = rli.refund_id
    WHERE rli.order_line_item_id = v_line_item.id
      AND r.status IN ('pending', 'succeeded');

    IF COALESCE((v_line->>'quantity')::int, 0) <= 0 THEN
      RAISE EXCEPTION 'refund_amount_zero' USING ERRCODE = 'P0008';
    END IF;

    IF v_existing_refunded + (v_line->>'quantity')::int > v_line_item.quantity THEN
      RAISE EXCEPTION 'line_overrefund: line=% requested=% existing=% capacity=%',
        v_line_item.id, v_line->>'quantity', v_existing_refunded,
        v_line_item.quantity USING ERRCODE = 'P0005';
    END IF;

    v_refund_amount_cents :=
      v_refund_amount_cents + (v_line->>'amount_cents')::int;
  END LOOP;

  -- issue #3281 — returning the last tickets also returns the order's extras.
  v_refund_amount_cents := v_refund_amount_cents
    + public.issue_3281_extras_refund_cents_settled(p_order_id, v_canonical_lines);

  IF v_refund_amount_cents <= 0 THEN
    RAISE EXCEPTION 'refund_amount_zero' USING ERRCODE = 'P0008';
  END IF;

  -- Issue #3872: never more than the buyer paid and has not had back.
  IF v_refund_amount_cents >
     COALESCE(v_order.buyer_total_cents, v_order.total_cents)
       - COALESCE(v_order.refunded_amount_cents, 0) THEN
    RAISE EXCEPTION 'refund_exceeds_remaining: requested=% remaining=%',
      v_refund_amount_cents,
      COALESCE(v_order.buyer_total_cents, v_order.total_cents)
        - COALESCE(v_order.refunded_amount_cents, 0)
      USING ERRCODE = 'P0009';
  END IF;

  INSERT INTO public.refunds (
    order_id, amount_cents, currency, reason, initiated_by, status,
    stripe_payment_intent_id, stripe_charge_id, metadata
  ) VALUES (
    p_order_id,
    v_refund_amount_cents,
    v_order.currency,
    trim(p_reason),
    v_caller,
    'pending',
    v_order.stripe_payment_intent_id,
    v_order.stripe_charge_id,
    jsonb_build_object(
      'idempotency_key', p_idempotency_key,
      'refund_request_manifest', v_request_manifest
    ) || CASE
      WHEN v_client_amount_cents IS NOT NULL
        AND v_client_amount_cents IS DISTINCT FROM v_refund_amount_cents::bigint
      THEN jsonb_build_object('issue_3872_client_reported', jsonb_build_object(
        'amount_cents', v_client_amount_cents,
        'lines', v_client_lines,
        'server_amount_cents', v_refund_amount_cents))
      ELSE '{}'::jsonb
    END
  ) RETURNING id INTO v_refund_id;

  PERFORM public.issue_3281_record_extras_refund(v_refund_id, p_order_id, v_canonical_lines);

  FOR v_line IN SELECT * FROM jsonb_array_elements(v_canonical_lines) LOOP
    INSERT INTO public.refund_line_items (
      refund_id, order_line_item_id, ticket_type_id, quantity, amount_cents
    )
    SELECT
      v_refund_id,
      (v_line->>'order_line_item_id')::uuid,
      oli.ticket_type_id,
      (v_line->>'quantity')::int,
      (v_line->>'amount_cents')::int
    FROM public.order_line_items oli
    WHERE oli.id = (v_line->>'order_line_item_id')::uuid;
  END LOOP;

  SELECT NOT EXISTS (
    SELECT 1 FROM public.order_line_items oli
    WHERE oli.order_id = p_order_id
      AND oli.quantity > (
        SELECT COALESCE(SUM(rli.quantity), 0)
        FROM public.refund_line_items rli
        JOIN public.refunds r ON r.id = rli.refund_id
        WHERE rli.order_line_item_id = oli.id
          AND r.status IN ('pending', 'succeeded')
      )
  ) INTO v_all_lines_fully_refunded;

  v_proposed_new_payment_status := CASE
    WHEN v_all_lines_fully_refunded THEN 'refunded'
    ELSE 'partial_refund'
  END;
  v_request_manifest := v_request_manifest || jsonb_build_object(
    'amount_cents', v_refund_amount_cents,
    'proposed_new_payment_status', v_proposed_new_payment_status,
    'is_full_refund', v_all_lines_fully_refunded
  );
  UPDATE public.refunds
  SET metadata = metadata ||
    jsonb_build_object('refund_request_manifest', v_request_manifest)
  WHERE id = v_refund_id;

  RETURN jsonb_build_object(
    'refund_id', v_refund_id,
    'order_id', p_order_id,
    'amount_cents', v_refund_amount_cents,
    'currency', v_order.currency,
    'stripe_payment_intent_id', v_order.stripe_payment_intent_id,
    'stripe_charge_id', v_order.stripe_charge_id,
    'application_fee_amount_cents', v_order.stripe_application_fee_amount_cents,
    'proposed_new_payment_status', v_proposed_new_payment_status,
    'is_full_refund', v_all_lines_fully_refunded,
    'lines', v_canonical_lines,
    'reason', trim(p_reason),
    'idempotent_replay', false
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.issue_3872_cancel_refund_order(
  p_order_id uuid,
  p_lines jsonb,
  p_reason text,
  p_idempotency_key text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_order public.orders%ROWTYPE;
  v_lines jsonb;
  v_line jsonb;
  v_item public.order_line_items%ROWTYPE;
  v_existing_refunded integer;
  v_existing public.refunds%ROWTYPE;
  v_manifest jsonb;
  v_line_base bigint := 0;
  v_other bigint;
  v_charged bigint;
  v_amount bigint;
  v_allocated bigint := 0;
  v_alloc bigint;
  v_idx integer := 0;
  v_extras bigint := 0;
  v_pool bigint;
  v_count integer;
  v_full boolean;
  v_status text;
  v_refund_id uuid;
BEGIN
  IF auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  IF p_reason IS NULL OR length(trim(p_reason)) < 10 OR length(trim(p_reason)) > 200 THEN
    RAISE EXCEPTION 'reason_invalid_length' USING ERRCODE = 'P0003';
  END IF;
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'order_not_found' USING ERRCODE = 'P0001';
  END IF;

  v_lines := public.issue_3872_refund_server_lines(p_order_id, p_lines);

  SELECT * INTO v_existing FROM public.refunds
   WHERE metadata->>'idempotency_key' = p_idempotency_key AND order_id = p_order_id
   LIMIT 1;
  IF FOUND THEN
    v_manifest := v_existing.metadata->'refund_request_manifest';
    IF v_manifest IS NULL
       OR v_manifest->>'reason' IS DISTINCT FROM trim(p_reason)
       OR (SELECT coalesce(jsonb_agg(jsonb_build_object(
             'order_line_item_id', l->>'order_line_item_id', 'quantity', (l->>'quantity')::int)
             ORDER BY l->>'order_line_item_id'), '[]'::jsonb)
           FROM jsonb_array_elements(v_manifest->'lines') l)
          IS DISTINCT FROM
          (SELECT coalesce(jsonb_agg(jsonb_build_object(
             'order_line_item_id', l->>'order_line_item_id', 'quantity', (l->>'quantity')::int)
             ORDER BY l->>'order_line_item_id'), '[]'::jsonb)
           FROM jsonb_array_elements(v_lines) l) THEN
      RAISE EXCEPTION 'idempotency_request_mismatch' USING ERRCODE = '23505';
    END IF;
    RETURN jsonb_build_object(
      'refund_id', v_existing.id, 'order_id', p_order_id,
      'amount_cents', v_existing.amount_cents, 'currency', v_existing.currency,
      'stripe_payment_intent_id', v_order.stripe_payment_intent_id,
      'stripe_charge_id', v_order.stripe_charge_id,
      'application_fee_amount_cents', v_order.stripe_application_fee_amount_cents,
      'proposed_new_payment_status', v_manifest->>'proposed_new_payment_status',
      'is_full_refund', (v_manifest->>'is_full_refund')::boolean,
      'lines', v_manifest->'lines', 'reason', v_manifest->>'reason',
      'idempotent_replay', true
    );
  END IF;

  IF v_order.payment_status NOT IN ('paid', 'partial_refund') THEN
    RAISE EXCEPTION 'order_not_refundable: status=%', v_order.payment_status USING ERRCODE = 'P0002';
  END IF;

  FOR v_line IN SELECT * FROM jsonb_array_elements(v_lines) LOOP
    SELECT * INTO v_item FROM public.order_line_items
     WHERE id::text = v_line->>'order_line_item_id' AND order_id = p_order_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'line_item_not_found: %', v_line->>'order_line_item_id' USING ERRCODE = 'P0004';
    END IF;
    IF COALESCE((v_line->>'quantity')::int, 0) <= 0 THEN
      RAISE EXCEPTION 'refund_amount_zero' USING ERRCODE = 'P0008';
    END IF;
    SELECT COALESCE(SUM(rli.quantity), 0) INTO v_existing_refunded
    FROM public.refund_line_items rli JOIN public.refunds r ON r.id = rli.refund_id
    WHERE rli.order_line_item_id = v_item.id AND r.status IN ('pending', 'succeeded');
    IF v_existing_refunded + (v_line->>'quantity')::int > v_item.quantity THEN
      RAISE EXCEPTION 'line_overrefund: line=% requested=% existing=% capacity=%',
        v_item.id, v_line->>'quantity', v_existing_refunded, v_item.quantity USING ERRCODE = 'P0005';
    END IF;
    v_line_base := v_line_base + (v_line->>'amount_cents')::bigint;
  END LOOP;
  v_count := jsonb_array_length(v_lines);
  IF v_count = 0 OR v_line_base <= 0 THEN
    RAISE EXCEPTION 'refund_amount_zero' USING ERRCODE = 'P0008';
  END IF;

  -- Would every line be fully refunded after this?
  SELECT NOT EXISTS (
    SELECT 1 FROM public.order_line_items oli
    WHERE oli.order_id = p_order_id
      AND oli.quantity > (
        SELECT COALESCE(SUM(rli.quantity), 0) FROM public.refund_line_items rli
        JOIN public.refunds r ON r.id = rli.refund_id
        WHERE rli.order_line_item_id = oli.id AND r.status IN ('pending', 'succeeded')
      ) + COALESCE((SELECT (l->>'quantity')::int FROM jsonb_array_elements(v_lines) l
                    WHERE l->>'order_line_item_id' = oli.id::text), 0)
  ) INTO v_full;

  SELECT COALESCE(SUM(amount_cents), 0) INTO v_other
  FROM public.refunds WHERE order_id = p_order_id AND status IN ('pending', 'succeeded')
    AND order_installment_id IS NULL;  -- issue #3645: instalment refunds are not deposit refunds
  v_charged := COALESCE(v_order.buyer_total_cents, v_order.total_cents);
  -- Everything that remains when the last tickets go back; otherwise the lines
  -- (a cancellation always returns every remaining ticket, so this is the norm).
  v_amount := CASE WHEN v_full THEN v_charged - v_other ELSE LEAST(v_line_base, v_charged - v_other) END;
  IF v_amount <= 0 THEN
    RAISE EXCEPTION 'refund_amount_zero' USING ERRCODE = 'P0008';
  END IF;
  v_status := CASE WHEN v_full THEN 'refunded' ELSE 'partial_refund' END;

  INSERT INTO public.refunds (
    order_id, amount_cents, currency, reason, initiated_by, status,
    stripe_payment_intent_id, stripe_charge_id, metadata
  ) VALUES (
    p_order_id, v_amount::integer, v_order.currency, trim(p_reason), NULL, 'pending',
    v_order.stripe_payment_intent_id, v_order.stripe_charge_id,
    jsonb_build_object('idempotency_key', p_idempotency_key)
  ) RETURNING id INTO v_refund_id;

  PERFORM public.issue_3281_record_extras_refund(v_refund_id, p_order_id, v_lines);
  -- issue #3281 — the refund total is unchanged. Tickets share what extras don't.
  SELECT COALESCE(SUM(amount_cents), 0) INTO v_extras
    FROM public.refund_add_on_line_items WHERE refund_id = v_refund_id;
  v_pool := GREATEST(v_amount - v_extras, v_count);

  FOR v_line IN SELECT * FROM jsonb_array_elements(v_lines) ORDER BY value->>'order_line_item_id' LOOP
    v_idx := v_idx + 1;
    v_alloc := CASE WHEN v_idx = v_count THEN v_pool - v_allocated
      ELSE floor(v_pool::numeric * (v_line->>'amount_cents')::bigint / v_line_base)::bigint END;
    v_allocated := v_allocated + v_alloc;
    INSERT INTO public.refund_line_items (refund_id, order_line_item_id, ticket_type_id, quantity, amount_cents)
    SELECT v_refund_id, oli.id, oli.ticket_type_id, (v_line->>'quantity')::int, v_alloc::integer
    FROM public.order_line_items oli WHERE oli.id::text = v_line->>'order_line_item_id';
  END LOOP;

  v_manifest := jsonb_build_object(
    'lines', (SELECT jsonb_agg(jsonb_build_object(
        'order_line_item_id', rli.order_line_item_id::text, 'quantity', rli.quantity,
        'amount_cents', rli.amount_cents) ORDER BY rli.order_line_item_id::text)
      FROM public.refund_line_items rli WHERE rli.refund_id = v_refund_id),
    'reason', trim(p_reason),
    'amount_cents', v_amount,
    'proposed_new_payment_status', v_status,
    'is_full_refund', v_full,
    'issue_3872_cancellation', jsonb_build_object(
      'ticket_lines_cents', v_line_base,
      'extras_cents', v_extras,
      'fees_and_tax_cents', GREATEST(0, v_amount - v_extras - v_line_base),
      'charged_total_cents', v_charged)
  );
  UPDATE public.refunds
  SET metadata = metadata || jsonb_build_object('refund_request_manifest', v_manifest)
  WHERE id = v_refund_id;

  RETURN jsonb_build_object(
    'refund_id', v_refund_id, 'order_id', p_order_id,
    'amount_cents', v_amount, 'currency', v_order.currency,
    'stripe_payment_intent_id', v_order.stripe_payment_intent_id,
    'stripe_charge_id', v_order.stripe_charge_id,
    'application_fee_amount_cents', v_order.stripe_application_fee_amount_cents,
    'proposed_new_payment_status', v_status,
    'is_full_refund', v_full,
    'lines', v_manifest->'lines', 'reason', trim(p_reason),
    'idempotent_replay', false
  );
END
$fn$;

NOTIFY pgrst, 'reload schema';

COMMIT;
