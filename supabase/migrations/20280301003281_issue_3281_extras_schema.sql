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
       -- A free ticket has no refund to wait for, so it can't hold the extras.
       AND oli.unit_price_cents > 0
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
  -- An extra is returned once, even when a discount capped what it got back.
  SELECT COALESCE(SUM(item.total_cents), 0)::integer
    INTO v_cents
    FROM public.order_add_on_line_items item
   WHERE item.order_id = p_order_id
     AND NOT EXISTS (
       SELECT 1 FROM public.refund_add_on_line_items ra
         JOIN public.refunds r ON r.id = ra.refund_id
        WHERE ra.order_add_on_line_item_id = item.id
          AND r.status IN ('pending', 'succeeded')
          AND r.id IS DISTINCT FROM p_this_refund
     );
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

-- p_cap limits what the extras take in total when the refund can't cover them.
CREATE OR REPLACE FUNCTION public.issue_3281_record_extras_refund(
  p_refund_id uuid, p_order_id uuid, p_lines jsonb, p_cap integer DEFAULT NULL
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
  SELECT p_refund_id, due.id, due.quantity,
         CASE WHEN p_cap IS NULL THEN due.total_cents
              ELSE LEAST(due.total_cents, GREATEST(p_cap - due.before, 0))::integer END
    FROM (
      SELECT item.id, item.quantity, item.total_cents,
             COALESCE(SUM(item.total_cents) OVER (
               ORDER BY item.id ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
             ), 0) AS before
        FROM public.order_add_on_line_items item
       WHERE item.order_id = p_order_id
         AND NOT EXISTS (
           SELECT 1 FROM public.refund_add_on_line_items ra
             JOIN public.refunds r ON r.id = ra.refund_id
            WHERE ra.order_add_on_line_item_id = item.id
              AND r.status IN ('pending', 'succeeded')
         )
    ) due;
END;
$fn$;
REVOKE ALL ON FUNCTION public.issue_3281_refund_returns_all_tickets(uuid, jsonb, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.issue_3281_extras_refund_cents(uuid, jsonb, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.issue_3281_record_extras_refund(uuid, uuid, jsonb, integer) FROM PUBLIC, anon, authenticated;

-- A settled full cancellation means the whole charge goes back, so a free ticket
-- left on the order doesn't keep it partial, whichever refund settles last.
-- Without one, every line counts, free tickets included.
CREATE OR REPLACE FUNCTION public.issue_3281_settled_payment_status(
  p_order_id uuid
) RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM public.order_line_items oli
     WHERE oli.order_id = p_order_id
       AND NOT (oli.unit_price_cents = 0 AND EXISTS (
         SELECT 1 FROM public.refunds cancel
          WHERE cancel.order_id = p_order_id
            AND cancel.status = 'succeeded'
            AND cancel.metadata #>> '{refund_request_manifest,is_full_refund}' = 'true'
       ))
       AND oli.quantity > (
         SELECT COALESCE(SUM(rli.quantity), 0)
           FROM public.refund_line_items rli
           JOIN public.refunds r ON r.id = rli.refund_id
          WHERE rli.order_line_item_id = oli.id AND r.status = 'succeeded'
       )
  ) THEN 'refunded' ELSE 'partial_refund' END;
$fn$;
REVOKE ALL ON FUNCTION public.issue_3281_settled_payment_status(uuid) FROM PUBLIC, anon, authenticated;

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

  -- Would every paid line be fully refunded after this? A free ticket can't be
  -- refunded, so it must not keep fees, tax or extras from going back (#3281).
  v_full := public.issue_3281_refund_returns_all_tickets(p_order_id, v_lines, NULL);

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

  -- issue #3281 — the refund total is unchanged. Tickets share what extras don't.
  -- A discount can leave less than the list prices, so each side takes its share.
  v_extras := public.issue_3281_extras_refund_cents(p_order_id, v_lines, v_refund_id);
  IF v_amount < v_line_base + v_extras THEN
    v_extras := floor(v_amount::numeric * v_extras / (v_line_base + v_extras))::bigint;
  END IF;
  PERFORM public.issue_3281_record_extras_refund(v_refund_id, p_order_id, v_lines, v_extras::integer);
  v_pool := v_amount - v_extras;

  FOR v_line IN SELECT * FROM jsonb_array_elements(v_lines) ORDER BY value->>'order_line_item_id' LOOP
    v_idx := v_idx + 1;
    v_alloc := CASE WHEN v_idx = v_count THEN v_pool - v_allocated
      ELSE LEAST(
        GREATEST(floor(v_pool::numeric * (v_line->>'amount_cents')::bigint / v_line_base)::bigint, 1),
        v_pool - v_allocated - (v_count - v_idx)) END;
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

CREATE OR REPLACE FUNCTION public.admin_refund_order_commit(
  p_refund_id uuid,
  p_stripe_refund_id text,
  p_application_fee_refunded_cents integer,
  p_status text,
  p_stripe_tax_transaction_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_refund public.refunds%ROWTYPE;
  v_order public.orders%ROWTYPE;
  v_line_item record;
  v_new_payment_status text;
  v_total_refunded_cents int;
BEGIN
  -- TWIN GUARD (first executable statement) — see admin_refund_order.
  IF auth.uid() IS NOT NULL AND NOT public.is_admin_user() THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  SELECT * INTO v_refund FROM public.refunds WHERE id = p_refund_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'refund_not_found' USING ERRCODE = 'P0010';
  END IF;
  IF v_refund.status <> 'pending' THEN
    SELECT * INTO v_order FROM public.orders WHERE id = v_refund.order_id;
    RETURN jsonb_build_object(
      'refund_id', p_refund_id,
      'status', v_refund.status,
      'new_payment_status', v_order.payment_status,
      'total_refunded_cents', v_order.refunded_amount_cents,
      'idempotent_replay', true
    );
  END IF;
  IF p_status NOT IN ('succeeded', 'failed') THEN
    RAISE EXCEPTION 'invalid_commit_status' USING ERRCODE = 'P0012';
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = v_refund.order_id;
  -- Brand permission gate REMOVED (admin twin; gate is the edge fn + service_role grant).

  IF p_status = 'failed' THEN
    UPDATE public.refunds
    SET status = 'failed',
        stripe_tax_transaction_id = COALESCE(p_stripe_tax_transaction_id, stripe_tax_transaction_id),
        processed_at = now()
    WHERE id = p_refund_id;
    RETURN jsonb_build_object('refund_id', p_refund_id, 'status', 'failed', 'idempotent_replay', false);
  END IF;

  UPDATE public.refunds
  SET status = 'succeeded',
      stripe_refund_id = p_stripe_refund_id,
      stripe_tax_transaction_id = p_stripe_tax_transaction_id,
      application_fee_refunded_cents = COALESCE(p_application_fee_refunded_cents, 0),
      processed_at = now()
  WHERE id = p_refund_id;

  -- issue #3281 — two refunds settling together must see each other's result.
  -- NO KEY UPDATE stays compatible with the key-share lock a new refund row holds.
  PERFORM 1 FROM public.orders WHERE id = v_order.id FOR NO KEY UPDATE;
  SELECT COALESCE(SUM(amount_cents), 0) INTO v_total_refunded_cents
  FROM public.refunds
  WHERE order_id = v_order.id AND status = 'succeeded'
    AND order_installment_id IS NULL;  -- issue #3645: instalment refunds are not deposit refunds

  v_new_payment_status := public.issue_3281_settled_payment_status(v_order.id);

  UPDATE public.orders
  SET payment_status = v_new_payment_status,
      refunded_amount_cents = v_total_refunded_cents,
      updated_at = now()
  WHERE id = v_order.id;

  FOR v_line_item IN
    SELECT rli.ticket_type_id, rli.quantity
    FROM public.refund_line_items rli
    WHERE rli.refund_id = p_refund_id
  LOOP
    UPDATE public.tickets t
    SET status = 'refunded'
    WHERE t.id IN (
      SELECT t2.id
      FROM public.tickets t2
      WHERE t2.order_id = v_order.id
        AND t2.ticket_type_id = v_line_item.ticket_type_id
        AND t2.status = 'valid'
      ORDER BY t2.created_at ASC
      LIMIT v_line_item.quantity
    );
  END LOOP;

  RETURN jsonb_build_object(
    'refund_id', p_refund_id,
    'status', 'succeeded',
    'new_payment_status', v_new_payment_status,
    'total_refunded_cents', v_total_refunded_cents,
    'stripe_tax_transaction_id', p_stripe_tax_transaction_id,
    'idempotent_replay', false
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.biz_refund_order_commit(
  p_refund_id uuid,
  p_stripe_refund_id text,
  p_application_fee_refunded_cents integer,
  p_status text,
  p_stripe_tax_transaction_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_refund public.refunds%ROWTYPE;
  v_order public.orders%ROWTYPE;
  v_caller uuid := auth.uid();
  v_brand_id uuid;
  v_line_item record;
  v_new_payment_status text;
  v_total_refunded_cents int;
BEGIN
  SELECT * INTO v_refund FROM public.refunds WHERE id = p_refund_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'refund_not_found' USING ERRCODE = 'P0010';
  END IF;
  IF v_refund.status <> 'pending' THEN
    SELECT * INTO v_order FROM public.orders WHERE id = v_refund.order_id;
    RETURN jsonb_build_object(
      'refund_id', p_refund_id,
      'status', v_refund.status,
      'new_payment_status', v_order.payment_status,
      'total_refunded_cents', v_order.refunded_amount_cents,
      'idempotent_replay', true
    );
  END IF;
  IF p_status NOT IN ('succeeded', 'failed') THEN
    RAISE EXCEPTION 'invalid_commit_status' USING ERRCODE = 'P0012';
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = v_refund.order_id;
  SELECT brand_id INTO v_brand_id FROM public.events WHERE id = v_order.event_id;
  IF NOT public.biz_can_manage_payments_for_brand(v_brand_id, v_caller) THEN
    RAISE EXCEPTION 'permission_denied' USING ERRCODE = '42501';
  END IF;

  IF p_status = 'failed' THEN
    UPDATE public.refunds
    SET status = 'failed',
        stripe_tax_transaction_id = COALESCE(p_stripe_tax_transaction_id, stripe_tax_transaction_id),
        processed_at = now()
    WHERE id = p_refund_id;
    RETURN jsonb_build_object('refund_id', p_refund_id, 'status', 'failed', 'idempotent_replay', false);
  END IF;

  UPDATE public.refunds
  SET status = 'succeeded',
      stripe_refund_id = p_stripe_refund_id,
      stripe_tax_transaction_id = p_stripe_tax_transaction_id,
      application_fee_refunded_cents = COALESCE(p_application_fee_refunded_cents, 0),
      processed_at = now()
  WHERE id = p_refund_id;

  -- issue #3281 — two refunds settling together must see each other's result.
  -- NO KEY UPDATE stays compatible with the key-share lock a new refund row holds.
  PERFORM 1 FROM public.orders WHERE id = v_order.id FOR NO KEY UPDATE;
  SELECT COALESCE(SUM(amount_cents), 0) INTO v_total_refunded_cents
  FROM public.refunds
  WHERE order_id = v_order.id AND status = 'succeeded';

  v_new_payment_status := public.issue_3281_settled_payment_status(v_order.id);

  UPDATE public.orders
  SET payment_status = v_new_payment_status,
      refunded_amount_cents = v_total_refunded_cents,
      updated_at = now()
  WHERE id = v_order.id;

  FOR v_line_item IN
    SELECT rli.ticket_type_id, rli.quantity
    FROM public.refund_line_items rli
    WHERE rli.refund_id = p_refund_id
  LOOP
    UPDATE public.tickets t
    SET status = 'refunded'
    WHERE t.id IN (
      SELECT t2.id
      FROM public.tickets t2
      WHERE t2.order_id = v_order.id
        AND t2.ticket_type_id = v_line_item.ticket_type_id
        AND t2.status = 'valid'
      ORDER BY t2.created_at ASC
      LIMIT v_line_item.quantity
    );
  END LOOP;

  RETURN jsonb_build_object(
    'refund_id', p_refund_id,
    'status', 'succeeded',
    'new_payment_status', v_new_payment_status,
    'total_refunded_cents', v_total_refunded_cents,
    'stripe_tax_transaction_id', p_stripe_tax_transaction_id,
    'idempotent_replay', false
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.issue_2097_finalize_refund_attempt(
  p_attempt_id uuid,p_lease_owner uuid,p_lease_epoch bigint,p_status text,
  p_fee_refund_id text,p_fee_refund_amount_text text,p_after_amount_refunded_text text,
  p_stripe_event_id text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $function$
DECLARE v public.ticket_refund_attempts%ROWTYPE; v_refund public.refunds%ROWTYPE;
  v_total integer; v_order_status text; v_amount integer;
  v_attempt_count integer; v_expected_count integer; v_nonterminal_count integer;
  v_positive_total bigint; v_aggregate_status text;
BEGIN
  SELECT * INTO v FROM public.ticket_refund_attempts WHERE id=p_attempt_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'attempt_not_found'; END IF;
  IF v.status IN ('succeeded_positive','not_applicable','fee_evidence_unavailable','evidence_conflict') THEN
    RETURN jsonb_build_object('status',v.status,'application_fee_refunded_cents',v.fee_refund_amount_text,'idempotent_replay',true);
  END IF;
  IF v.lease_owner IS DISTINCT FROM p_lease_owner OR v.lease_epoch<>p_lease_epoch OR v.lease_expires_at<=now() THEN
    RAISE EXCEPTION 'stale_refund_lease';
  END IF;
  IF p_status NOT IN ('succeeded_positive','not_applicable','fee_evidence_unavailable','evidence_conflict') THEN RAISE EXCEPTION 'invalid_fee_status'; END IF;
  IF p_status='succeeded_positive' THEN
    IF p_fee_refund_id IS NULL OR p_fee_refund_amount_text !~ '^[1-9][0-9]{0,15}$'
      OR p_after_amount_refunded_text !~ '^[1-9][0-9]{0,15}$'
      OR p_after_amount_refunded_text::numeric-v.baseline_amount_refunded_text::numeric<>p_fee_refund_amount_text::numeric
      OR p_after_amount_refunded_text::numeric>v.application_fee_amount_text::numeric THEN
      RAISE EXCEPTION 'fee_evidence_conflict';
    END IF;
    v_amount:=p_fee_refund_amount_text::integer;
  ELSIF p_status='not_applicable' THEN
    IF v.application_fee_id IS NOT NULL OR v.application_fee_amount_text<>'0'
       OR p_fee_refund_id IS NOT NULL OR p_fee_refund_amount_text<>'0'
       OR p_after_amount_refunded_text<>'0' OR v.buyer_refund_id IS NULL THEN
      RAISE EXCEPTION 'no_fee_evidence_conflict';
    END IF;
    v_amount:=0;
  ELSIF p_status='evidence_conflict' AND p_fee_refund_amount_text IS NOT NULL THEN
    IF p_fee_refund_id IS NULL OR p_fee_refund_amount_text !~ '^(0|[1-9][0-9]{0,15})$' THEN
      RAISE EXCEPTION 'invalid_conflict_evidence';
    END IF;
  ELSIF p_fee_refund_amount_text IS NOT NULL THEN RAISE EXCEPTION 'unknown_fee_amount_must_be_null'; END IF;
  SELECT * INTO v_refund FROM public.refunds WHERE id=v.refund_id FOR UPDATE;
  INSERT INTO public.ticket_refund_fee_evidence(attempt_id,stripe_event_id,application_fee_id,
    fee_refund_id,amount_text,currency,connected_account_id,charge_id,provider_mode,evidence_kind)
  VALUES(v.id,p_stripe_event_id,v.application_fee_id,p_fee_refund_id,p_fee_refund_amount_text,
    v.currency,v.connected_account_id,v.charge_id,v.provider_mode,
    CASE WHEN p_status='succeeded_positive' THEN 'fee_refund' WHEN p_status='not_applicable' THEN 'no_fee'
      WHEN p_status='fee_evidence_unavailable' THEN 'visibility_exhausted' ELSE 'conflict' END);
  UPDATE public.ticket_refund_attempts SET status=p_status,fee_refund_id=p_fee_refund_id,
    fee_refund_amount_text=CASE WHEN p_status IN ('succeeded_positive','not_applicable') THEN p_fee_refund_amount_text END,
    observed_fee_refund_amount_text=p_fee_refund_amount_text,last_observed_at=now(),next_observation_at=NULL,
    updated_at=now() WHERE id=v.id;
  SELECT COUNT(*),MAX(expected_attempt_count),
    COUNT(*) FILTER (WHERE status NOT IN ('succeeded_positive','not_applicable')),
    COALESCE(SUM(fee_refund_amount_text::bigint) FILTER (WHERE status='succeeded_positive'),0)
    INTO v_attempt_count,v_expected_count,v_nonterminal_count,v_positive_total
  FROM public.ticket_refund_attempts WHERE refund_id=v.refund_id;
  v_aggregate_status:=CASE
    WHEN EXISTS(SELECT 1 FROM public.ticket_refund_attempts a WHERE a.refund_id=v.refund_id AND a.status='evidence_conflict') THEN 'evidence_conflict'
    WHEN EXISTS(SELECT 1 FROM public.ticket_refund_attempts a WHERE a.refund_id=v.refund_id AND a.status='fee_evidence_unavailable') THEN 'fee_evidence_unavailable'
    WHEN v_attempt_count=v_expected_count AND v_nonterminal_count=0 AND v_positive_total>0 THEN 'succeeded_positive'
    WHEN v_attempt_count=v_expected_count AND v_nonterminal_count=0 THEN 'not_applicable'
    ELSE 'pending_visibility' END;
  UPDATE public.refunds SET application_fee_refund_status=v_aggregate_status,
    application_fee_refunded_cents=CASE WHEN v_aggregate_status='succeeded_positive' THEN v_positive_total::integer
      WHEN v_aggregate_status='not_applicable' THEN 0 ELSE NULL END,
    status=CASE WHEN v_aggregate_status IN ('succeeded_positive','not_applicable') THEN 'succeeded' ELSE status END,
    processed_at=CASE WHEN v_aggregate_status IN ('succeeded_positive','not_applicable')
      THEN COALESCE(processed_at,now()) ELSE processed_at END
  WHERE id=v.refund_id;
  IF v_aggregate_status IN ('succeeded_positive','not_applicable') THEN
    UPDATE public.tickets t SET status='refunded' FROM public.ticket_refund_quarantine x
      JOIN public.ticket_refund_attempts a ON a.id=x.attempt_id
      WHERE a.refund_id=v.refund_id AND x.ticket_id=t.id AND t.status='refund_pending';
  -- issue #3281 — two refunds settling together must see each other's result.
  -- NO KEY UPDATE stays compatible with the key-share lock a new refund row holds.
  PERFORM 1 FROM public.orders WHERE id = v.order_id FOR NO KEY UPDATE;
    SELECT COALESCE(SUM(amount_cents),0) INTO v_total FROM public.refunds
      WHERE order_id=v.order_id AND status='succeeded';
    v_order_status:=public.issue_3281_settled_payment_status(v.order_id);
    UPDATE public.orders SET payment_status=v_order_status,refunded_amount_cents=v_total,updated_at=now() WHERE id=v.order_id;
    IF p_status='succeeded_positive' THEN
      UPDATE public.mingla_revenue_log SET refunded_amount_cents=LEAST(amount_cents,
        p_after_amount_refunded_text::integer),refunded=(p_after_amount_refunded_text::integer>=amount_cents),updated_at=now()
        WHERE stripe_application_fee_id=v.application_fee_id;
    END IF;
  END IF;
  RETURN jsonb_build_object('status',p_status,'aggregate_status',v_aggregate_status,
    'application_fee_refunded_cents',CASE WHEN v_aggregate_status='succeeded_positive' THEN v_positive_total::integer
      WHEN v_aggregate_status='not_applicable' THEN 0 END,
    'new_payment_status',v_order_status,'idempotent_replay',false);
END;$function$;

CREATE OR REPLACE FUNCTION public.biz_refund_order_commit_from_webhook(
  p_order_id uuid,
  p_stripe_refund_id text,
  p_amount_cents integer,
  p_currency character,
  p_application_fee_refunded_cents integer,
  p_idempotency_key_hint text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_order public.orders%ROWTYPE;
  v_existing_refund_id uuid;
  v_refund_id uuid;
  v_line record;
  v_remaining_to_allocate int;
  v_alloc_qty int;
  v_alloc_amount int;
  v_new_payment_status text;
  v_total_refunded_cents int;
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'order_not_found' USING ERRCODE = 'P0001';
  END IF;

  -- Match path 1: refunds.stripe_refund_id = p_stripe_refund_id (idempotent webhook replay).
  SELECT id INTO v_existing_refund_id
  FROM public.refunds
  WHERE stripe_refund_id = p_stripe_refund_id;

  -- Match path 2: in-app refund pre-recorded with idempotency_key hint, still pending.
  IF v_existing_refund_id IS NULL AND p_idempotency_key_hint IS NOT NULL THEN
    SELECT id INTO v_existing_refund_id
    FROM public.refunds
    WHERE order_id = p_order_id
      AND status = 'pending'
      AND metadata->>'idempotency_key' = p_idempotency_key_hint
    LIMIT 1;
  END IF;

  IF v_existing_refund_id IS NOT NULL THEN
    -- Advance the existing row to succeeded (if pending) — no-op if already terminal.
    UPDATE public.refunds
    SET status = 'succeeded',
        stripe_refund_id = COALESCE(stripe_refund_id, p_stripe_refund_id),
        application_fee_refunded_cents = COALESCE(p_application_fee_refunded_cents, 0),
        processed_at = COALESCE(processed_at, now())
    WHERE id = v_existing_refund_id
      AND status = 'pending';
    v_refund_id := v_existing_refund_id;
  ELSE
    -- Dashboard-initiated refund with no in-app pre-record.
    -- Create a new refund row + proportional refund_line_items (oldest-first allocation per Q-3).
    INSERT INTO public.refunds (
      order_id, amount_cents, currency, reason, initiated_by, status,
      stripe_payment_intent_id, stripe_charge_id, stripe_refund_id,
      application_fee_refunded_cents, processed_at, metadata
    ) VALUES (
      p_order_id,
      p_amount_cents,
      p_currency,
      'Dashboard-initiated refund (Stripe)',
      NULL,
      'succeeded',
      v_order.stripe_payment_intent_id,
      v_order.stripe_charge_id,
      p_stripe_refund_id,
      COALESCE(p_application_fee_refunded_cents, 0),
      now(),
      jsonb_build_object('source', 'webhook_reconciliation')
    ) RETURNING id INTO v_refund_id;

    -- Proportional allocation: walk order_line_items oldest-first, take as much qty as needed
    -- to cover p_amount_cents at unit_price_cents per ticket.
    v_remaining_to_allocate := p_amount_cents;
    FOR v_line IN
      SELECT id, ticket_type_id, quantity, unit_price_cents, total_cents,
             (
               SELECT COALESCE(SUM(rli.quantity), 0)
               FROM public.refund_line_items rli
               JOIN public.refunds r ON r.id = rli.refund_id
               WHERE rli.order_line_item_id = order_line_items.id
                 AND r.status = 'succeeded'
                 AND r.id <> v_refund_id
             ) AS already_refunded_qty
      FROM public.order_line_items
      WHERE order_id = p_order_id
      ORDER BY id ASC
    LOOP
      EXIT WHEN v_remaining_to_allocate <= 0;
      -- How many units can we refund from this line?
      v_alloc_qty := LEAST(
        v_line.quantity - v_line.already_refunded_qty,
        CASE WHEN v_line.unit_price_cents > 0
          THEN v_remaining_to_allocate / v_line.unit_price_cents
          ELSE 0
        END
      );
      IF v_alloc_qty <= 0 THEN
        CONTINUE;
      END IF;
      v_alloc_amount := v_alloc_qty * v_line.unit_price_cents;
      INSERT INTO public.refund_line_items (
        refund_id, order_line_item_id, ticket_type_id, quantity, amount_cents
      ) VALUES (
        v_refund_id, v_line.id, v_line.ticket_type_id, v_alloc_qty, v_alloc_amount
      );
      v_remaining_to_allocate := v_remaining_to_allocate - v_alloc_amount;
    END LOOP;
    -- If we couldn't fully allocate (e.g., partial-cent refund), the leftover stays at the
    -- order level only (orders.refunded_amount_cents reflects the Stripe truth via re-aggregation below).
  END IF;

  -- issue #3281 — two refunds settling together must see each other's result.
  -- NO KEY UPDATE stays compatible with the key-share lock a new refund row holds.
  PERFORM 1 FROM public.orders WHERE id = p_order_id FOR NO KEY UPDATE;
  -- Recompute cumulative refunded cents and new payment_status.
  SELECT COALESCE(SUM(amount_cents), 0) INTO v_total_refunded_cents
  FROM public.refunds
  WHERE order_id = p_order_id AND status = 'succeeded';

  -- issue #3281 — a replay must not undo a settled full cancellation.
  v_new_payment_status := public.issue_3281_settled_payment_status(p_order_id);

  UPDATE public.orders
  SET payment_status = v_new_payment_status,
      refunded_amount_cents = v_total_refunded_cents,
      updated_at = now()
  WHERE id = p_order_id;

  -- Defense-in-depth ticket void (idempotent — only flips tickets still 'valid').
  FOR v_line IN
    SELECT rli.ticket_type_id, rli.quantity
    FROM public.refund_line_items rli
    WHERE rli.refund_id = v_refund_id
  LOOP
    UPDATE public.tickets t
    SET status = 'refunded'
    WHERE t.id IN (
      SELECT t2.id
      FROM public.tickets t2
      WHERE t2.order_id = p_order_id
        AND t2.ticket_type_id = v_line.ticket_type_id
        AND t2.status = 'valid'
      ORDER BY t2.created_at ASC
      LIMIT v_line.quantity
    );
  END LOOP;

  RETURN jsonb_build_object(
    'refund_id', v_refund_id,
    'status', 'succeeded',
    'new_payment_status', v_new_payment_status,
    'total_refunded_cents', v_total_refunded_cents,
    'source', CASE WHEN v_existing_refund_id IS NULL THEN 'webhook_new' ELSE 'webhook_match' END
  );
END;
$function$;

NOTIFY pgrst, 'reload schema';

COMMIT;
